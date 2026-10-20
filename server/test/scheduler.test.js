'use strict';
/* ==========================================================================
   Milestone 5 — persisted, timezone-aware scheduler
   Covers: validation, explicit enable (default off), slot-keyed idempotent
   firing, misfire policies, daily limits, interval math, bounded retries,
   pause/resume/enable/disable/delete, the concurrency budget, and the
   admin-only HTTP surface. No real wall-clock waiting: tick(atMs) is driven
   with explicit timestamps.
   ========================================================================= */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../config');
const { createApp } = require('../index');
const { register: wfRegister } = require('../workflows');

const ADMIN = 'sched-admin-token';
const auth = { authorization: 'Bearer ' + ADMIN };
const jsonReq = (body, headers) => ({ method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers || {}), body: JSON.stringify(body) });

let app;
let base;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 5000, every = 40) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('waitFor: condition not met in time');
    await sleep(every);
  }
}

before(async () => {
  wfRegister({
    id: 'sched-echo', version: '1.0.0', title: 'Sched echo', description: 'single fast read step',
    permissionClass: 'read',
    inputs: { type: 'object', properties: { n: { type: 'integer', default: 1, min: 1, max: 10 } }, additionalProperties: false },
    tools: ['time_now'],
    steps: [{ id: 'once', label: 'once', tool: 'time_now', argsTemplate: {}, dependsOn: [] }],
    limits: { timeoutMs: 15000, maxActiveRuns: 16 }
  });
  wfRegister({
    id: 'sched-bad', version: '1.0.0', title: 'Sched bad', description: 'always fails deterministically',
    permissionClass: 'read',
    tools: ['sched_fail'],
    steps: [{ id: 'boom', label: 'boom', tool: 'sched_fail', argsTemplate: {}, dependsOn: [] }],
    limits: { timeoutMs: 15000, maxActiveRuns: 4 }
  });

  const cfg = loadConfig({ AH_ASSISTANT_ENV: 'test', AH_STORAGE_DRIVER: 'memory', AH_ADMIN_TOKEN: ADMIN });
  app = createApp(cfg);
  app.tools.register({
    name: 'sched_fail', description: 'always fails', risk: 'read',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => { const e = new Error('scheduled step failed'); e.code = 'invalid_request'; e.status = 400; throw e; }
  });
  await app.recovered;
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + app.server.address().port;
});

after(async () => {
  app.scheduler.stop();
  await new Promise((r) => app.server.close(r));
});

const sched = () => app.scheduler;

async function forceSlot(id, iso) {
  const job = await sched().getJob(id);
  job.nextRunAt = iso;
  await app.storage.schedules.save(job);
  return job;
}

async function schedulerRunCount() {
  const runs = await app.engine.listRuns();
  return runs.filter((r) => r.source === 'scheduler').length;
}

/* Background scheduled runs take a task-loop interval to reach a terminal
   state; budget and per-workflow concurrency count active runs, so every
   firing test starts from a drained engine for deterministic ticks. */
async function drain() {
  await waitFor(async () => {
    const runs = await app.engine.listRuns();
    return runs.filter((r) => r.source === 'scheduler' && !['completed', 'failed', 'cancelled', 'timed_out'].includes(r.status)).length === 0;
  });
}

/* -------------------------------------------------------------- validation */

test('createJob validates workflow, recurrence, timezone and inputs', async () => {
  await assert.rejects(() => sched().createJob({ workflowId: 'nope', recurrence: { kind: 'daily', at: '03:00' } }),
    (e) => e.code === 'not_found');
  await assert.rejects(() => sched().createJob({ workflowId: 'approved-file-change', recurrence: { kind: 'daily', at: '03:00' } }),
    (e) => e.code === 'workflow_unsupported' && e.status === 501);
  await assert.rejects(() => sched().createJob({ workflowId: 'sched-echo', recurrence: { kind: 'yearly' } }),
    (e) => e.code === 'invalid_request');
  await assert.rejects(() => sched().createJob({ workflowId: 'sched-echo', recurrence: { kind: 'daily', at: '25:99' } }),
    (e) => e.code === 'invalid_request');
  await assert.rejects(() => sched().createJob({ workflowId: 'sched-echo', recurrence: { kind: 'interval', everyMinutes: 3 } }),
    (e) => e.code === 'invalid_request');
  await assert.rejects(() => sched().createJob({ workflowId: 'sched-echo', recurrence: { kind: 'daily', at: '03:00' }, tz: 'Mars/Olympus' }),
    (e) => e.code === 'invalid_request');
  await assert.rejects(() => sched().createJob({ workflowId: 'sched-echo', recurrence: { kind: 'daily', at: '03:00' }, args: { n: 99 } }),
    (e) => e.code === 'invalid_request', 'workflow input validation runs up front');
  await assert.rejects(() => sched().createJob({ workflowId: 'sched-echo', recurrence: { kind: 'daily', at: '03:00' }, maxRetries: 99 }),
    (e) => e.code === 'invalid_request');
});

test('jobs default to disabled with a computed next run', async () => {
  const job = await sched().createJob({ workflowId: 'sched-echo', recurrence: { kind: 'daily', at: '03:30' }, createdBy: 'admin' });
  assert.equal(job.enabled, false, 'a schedule never fires until explicitly enabled');
  assert.equal(job.paused, false);
  assert.ok(job.nextRunAt && !Number.isNaN(Date.parse(job.nextRunAt)), 'next occurrence is computed');
  assert.ok(Date.parse(job.nextRunAt) > Date.now(), 'the first daily occurrence is in the future');
  assert.deepEqual(job.history, []);
});

/* ------------------------------------------------------------------- firing */

test('an enabled job fires exactly once per slot with an idempotency key', async () => {
  await drain();
  const job = await sched().createJob({ workflowId: 'sched-echo', recurrence: { kind: 'daily', at: '03:00' }, createdBy: 'admin' });
  await sched().setFlag(job.id, { enabled: true }, 'enable', { id: 'admin' });
  const T = Date.now();
  const slot = new Date(T - 1000).toISOString();
  await forceSlot(job.id, slot);

  const first = await sched().tick(T);
  assert.equal(first.fired.length, 1);
  assert.equal(first.fired[0].slot, slot);
  const runId = first.fired[0].runId;
  const run = await app.engine.get(runId);
  assert.equal(run.source, 'scheduler');
  assert.equal(run.createdBy, 'schedule:' + job.id);
  assert.equal(run.workflowId, 'sched-echo');

  const afterFirst = await sched().getJob(job.id);
  assert.ok(Date.parse(afterFirst.nextRunAt) > T, 'the schedule advanced to the next occurrence');
  assert.equal(afterFirst.runCount, 1);
  assert.equal(afterFirst.history.filter((h) => h.outcome === 'started').length, 1);

  /* Same slot again (e.g. duplicated tick or restart): replay, never re-run. */
  await forceSlot(job.id, slot);
  const second = await sched().tick(T);
  assert.equal(second.fired.length, 1);
  assert.equal(second.fired[0].replayed, true, 'the slot key replays the existing run');
  assert.equal(second.fired[0].runId, runId, 'the same run id, not a new run');
  const afterSecond = await sched().getJob(job.id);
  assert.equal(afterSecond.runCount, 1, 'runCount did not double-count the replay');
  assert.equal(await schedulerRunCount(), 1, 'only one scheduled run exists');
  await waitFor(async () => {
    const r = await app.engine.get(runId);
    return r.status === 'completed' ? r : null;
  }, 5000); // the scheduled run really executed (bg task loop)
  assert.equal(run.status, 'completed');
});

test('misfire policy: skip older-than-grace slots, run-once catches up', async () => {
  await drain();
  const T = Date.now();
  const ancient = new Date(T - 3600000).toISOString(); // far beyond the 5min grace

  const skipJob = await sched().createJob({ workflowId: 'sched-echo', recurrence: { kind: 'interval', everyMinutes: 60 }, createdBy: 'admin' });
  await sched().setFlag(skipJob.id, { enabled: true }, 'enable', { id: 'admin' });
  await forceSlot(skipJob.id, ancient);
  const skipped = await sched().tick(T);
  assert.equal(skipped.fired.length, 0);
  assert.ok(skipped.skipped.some((s) => s.jobId === skipJob.id && s.reason === 'misfire_skipped'));
  const skipState = await sched().getJob(skipJob.id);
  assert.ok(skipState.history.some((h) => h.outcome === 'misfired'), 'the missed slot is recorded, not silently dropped');
  assert.ok(Date.parse(skipState.nextRunAt) > T, 'the schedule moved on');

  const onceJob = await sched().createJob({ workflowId: 'sched-echo', recurrence: { kind: 'interval', everyMinutes: 60 }, misfirePolicy: 'run-once', createdBy: 'admin' });
  await sched().setFlag(onceJob.id, { enabled: true }, 'enable', { id: 'admin' });
  await forceSlot(onceJob.id, ancient);
  const caught = await sched().tick(T);
  assert.equal(caught.fired.filter((f) => f.jobId === onceJob.id).length, 1, 'exactly one catch-up run');
  const onceState = await sched().getJob(onceJob.id);
  assert.ok(Date.parse(onceState.nextRunAt) > T, 'catch-up fires only once, then the schedule continues');
});

test('maxRunsPerDay caps executions per timezone day', async () => {
  await drain();
  const T = Date.now();
  const job = await sched().createJob({ workflowId: 'sched-echo', recurrence: { kind: 'interval', everyMinutes: 30 }, maxRunsPerDay: 1, createdBy: 'admin' });
  await sched().setFlag(job.id, { enabled: true }, 'enable', { id: 'admin' });
  await forceSlot(job.id, new Date(T - 1000).toISOString());
  const r1 = await sched().tick(T);
  assert.equal(r1.fired.filter((f) => f.jobId === job.id).length, 1);

  await forceSlot(job.id, new Date(T + 10000).toISOString());
  const r2 = await sched().tick(T + 11000);
  assert.equal(r2.fired.filter((f) => f.jobId === job.id).length, 0);
  assert.ok(r2.skipped.some((s) => s.jobId === job.id && s.reason === 'max_runs_per_day'));
  const state = await sched().getJob(job.id);
  assert.ok(state.history.some((h) => h.outcome === 'limit_reached'));
});

test('interval recurrence computes from startAt and advances by the period', async () => {
  await drain();
  const startAt = new Date(Date.now() + 3600000).toISOString();
  const job = await sched().createJob({ workflowId: 'sched-echo', recurrence: { kind: 'interval', everyMinutes: 60 }, startAt, createdBy: 'admin' });
  assert.equal(job.nextRunAt, startAt, 'a future startAt is the first firing');

  await sched().setFlag(job.id, { enabled: true }, 'enable', { id: 'admin' });
  const T = Date.parse(startAt) + 1000;
  const slot = new Date(Date.parse(startAt)).toISOString();
  await forceSlot(job.id, slot);
  const res = await sched().tick(T);
  assert.equal(res.fired.filter((f) => f.jobId === job.id).length, 1);
  const state = await sched().getJob(job.id);
  assert.equal(Date.parse(state.nextRunAt), Date.parse(startAt) + 3600000, 'next = slot + period');
});

test('failed scheduled runs retry with backoff, bounded by maxRetries', async () => {
  await drain();
  const T = Date.now();
  const job = await sched().createJob({ workflowId: 'sched-bad', recurrence: { kind: 'interval', everyMinutes: 1440 }, maxRetries: 1, createdBy: 'admin' });
  await sched().setFlag(job.id, { enabled: true }, 'enable', { id: 'admin' });
  await forceSlot(job.id, new Date(T - 1000).toISOString());
  const first = await sched().tick(T);
  assert.equal(first.fired.length, 1);
  const runId = first.fired[0].runId;
  await waitFor(async () => {
    const r = await app.engine.get(runId);
    return r.status === 'failed' ? r : null;
  });

  /* Too early: the failure tick starts the backoff clock (retryAt = T+5s+60s). */
  const early = await sched().tick(T + 5000);
  assert.equal(early.fired.filter((f) => f.kind === 'retry').length, 0);

  /* Backoff elapsed: one retry fires under a distinct :r1 key. */
  const late = await sched().tick(T + 70000);
  assert.equal(late.fired.filter((f) => f.jobId === job.id && f.kind === 'retry').length, 1);
  const retryRunId = late.fired.find((f) => f.jobId === job.id).runId;
  assert.notEqual(retryRunId, runId);
  const retryRun = await app.engine.get(retryRunId);
  assert.ok(retryRun.idempotencyKey.endsWith(':r1'), 'the retry uses its own idempotency key');
  await waitFor(async () => {
    const r = await app.engine.get(retryRunId);
    return r.status === 'failed' ? r : null;
  });

  /* maxRetries reached: no third attempt is scheduled. */
  const exhausted = await sched().tick(T + 200000);
  const state = await sched().getJob(job.id);
  assert.equal(state.pendingRetry, null, 'retries stop at maxRetries');
  assert.equal(state.retryAttempt, 1);
  assert.ok(state.history.some((h) => h.outcome === 'failed' && h.attempt === 1));
  assert.ok(!exhausted.fired.some((f) => f.kind === 'retry'));
  await drain();
});

test('pause/resume/enable/disable/delete behave truthfully', async () => {
  const job = await sched().createJob({ workflowId: 'sched-echo', recurrence: { kind: 'daily', at: '04:00' }, createdBy: 'admin' });
  const T = Date.now();

  const paused = await sched().setFlag(job.id, { paused: true }, 'pause', { id: 'admin' });
  assert.equal(paused.paused, true);
  await sched().setFlag(job.id, { enabled: true }, 'enable', { id: 'admin' });
  await forceSlot(job.id, new Date(T - 1000).toISOString());
  const whilePaused = await sched().tick(T);
  assert.equal(whilePaused.fired.filter((f) => f.jobId === job.id).length, 0, 'a paused job never fires');

  const resumed = await sched().setFlag(job.id, { paused: false }, 'resume', { id: 'admin' });
  assert.equal(resumed.paused, false);
  assert.ok(Date.parse(resumed.nextRunAt) > T, 'resuming schedules a fresh next run instead of a catch-up burst');

  const disabled = await sched().setFlag(job.id, { enabled: false }, 'disable', { id: 'admin' });
  assert.equal(disabled.enabled, false);

  await sched().deleteJob(job.id, { id: 'admin' });
  assert.equal(await sched().getJob(job.id), null);
  await assert.rejects(() => sched().deleteJob(job.id, { id: 'admin' }), (e) => e.code === 'not_found');
});

test('the loop can be started and stopped safely', () => {
  sched().start();
  sched().start(); // idempotent
  sched().stop();
  sched().stop();
});

test('the scheduler loop stays off unless explicitly configured', () => {
  assert.equal(app.config.scheduler.enabled, false, 'default configuration never starts the loop');
});

test('the concurrency budget caps scheduled runs per tick', async () => {
  const cfg2 = loadConfig({ AH_ASSISTANT_ENV: 'test', AH_STORAGE_DRIVER: 'memory', AH_ADMIN_TOKEN: ADMIN, AH_SCHEDULER_MAX_CONCURRENT: '1' });
  const app2 = createApp(cfg2);
  try {
    await app2.recovered;
    const T = Date.now();
    const a = await app2.scheduler.createJob({ workflowId: 'sched-echo', recurrence: { kind: 'interval', everyMinutes: 60 }, createdBy: 'admin' });
    const b = await app2.scheduler.createJob({ workflowId: 'sched-echo', recurrence: { kind: 'interval', everyMinutes: 60 }, createdBy: 'admin' });
    await app2.scheduler.setFlag(a.id, { enabled: true }, 'enable', { id: 'admin' });
    await app2.scheduler.setFlag(b.id, { enabled: true }, 'enable', { id: 'admin' });
    await app2.storage.schedules.save(Object.assign(await app2.storage.schedules.get(a.id), { nextRunAt: new Date(T - 1000).toISOString() }));
    await app2.storage.schedules.save(Object.assign(await app2.storage.schedules.get(b.id), { nextRunAt: new Date(T - 1000).toISOString() }));

    const res = await app2.scheduler.tick(T);
    assert.equal(res.fired.length, 1, 'only one job fires within the budget');
    assert.ok(res.skipped.some((s) => s.reason === 'max_concurrent_jobs'), 'the other job stays due for the next tick');

    /* The skipped job fires on the next tick once capacity frees up. */
    await waitFor(async () => {
      const runs = await app2.engine.listRuns();
      return runs.filter((r) => r.source === 'scheduler' && r.status === 'completed').length >= 1;
    });
    const res2 = await app2.scheduler.tick(T + 60000);
    assert.equal(res2.fired.length, 1, 'the deferred job fires next tick');
  } finally {
    app2.scheduler.stop();
    await new Promise((r) => app2.server.close(r));
  }
});

/* -------------------------------------------------------------------- HTTP */

test('scheduler HTTP API is admin-only and honest about loop state', async () => {
  assert.equal((await fetch(base + '/api/scheduler')).status, 401);
  assert.equal((await fetch(base + '/api/scheduler/sched_missing')).status, 401);

  const list = await (await fetch(base + '/api/scheduler', { headers: auth })).json();
  assert.equal(list.scheduler.enabled, false, 'the response reports the real loop state');
  assert.match(list.scheduler.loop, /single instance/);
  assert.ok(Array.isArray(list.jobs));

  const created = await fetch(base + '/api/scheduler', jsonReq({ workflowId: 'sched-echo', recurrence: { kind: 'daily', at: '05:00' } }, auth));
  assert.equal(created.status, 200);
  const cj = await created.json();
  assert.equal(cj.job.enabled, false);
  assert.ok(/enabled=true/.test(cj.note), 'the response explains how to actually enable firing');

  const bad = await fetch(base + '/api/scheduler', jsonReq({ workflowId: 'sched-echo', recurrence: { kind: 'daily', at: '99:99' } }, auth));
  assert.equal(bad.status, 400);

  const id = cj.job.id;
  assert.equal((await (await fetch(base + '/api/scheduler/' + id, { headers: auth })).json()).job.id, id);
  assert.equal((await fetch(base + '/api/scheduler/sched_nope', { headers: auth })).status, 404);

  const enabled = await fetch(base + '/api/scheduler/' + id + '/enable', { method: 'POST', headers: auth });
  assert.equal((await enabled.json()).job.enabled, true);
  const paused = await fetch(base + '/api/scheduler/' + id + '/pause', { method: 'POST', headers: auth });
  assert.equal((await paused.json()).job.paused, true);
  const resumed = await fetch(base + '/api/scheduler/' + id + '/resume', { method: 'POST', headers: auth });
  assert.equal((await resumed.json()).job.paused, false);
  const disabled = await fetch(base + '/api/scheduler/' + id + '/disable', { method: 'POST', headers: auth });
  assert.equal((await disabled.json()).job.enabled, false);

  const runNow = await fetch(base + '/api/scheduler/' + id + '/run-now', jsonReq({}, auth));
  assert.equal(runNow.status, 200);
  const rn = await runNow.json();
  assert.equal(rn.run.workflow, 'sched-echo');
  assert.equal(rn.replayed, false);
  await waitFor(async () => {
    const r = await app.engine.get(rn.run.id);
    return ['completed', 'failed'].includes(r.status) ? r : null;
  });

  const del = await fetch(base + '/api/scheduler/' + id, { method: 'DELETE', headers: auth });
  assert.equal(del.status, 200);
  assert.equal((await del.json()).deleted, true);
  assert.equal((await fetch(base + '/api/scheduler/' + id, { headers: auth })).status, 404);
  assert.equal((await fetch(base + '/api/scheduler/' + id + '/enable', { method: 'POST' })).status, 401, 'flag routes still require auth even for unknown ids');
});
