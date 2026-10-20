'use strict';
/* ==========================================================================
   Milestone 5 — workflow engine + HTTP API + chat intents
   Covers: multi-step execution over the task manager, default-deny,
   bound/expiring approvals (workflow + step scope), idempotency,
   concurrency limits, retries, optional-step evidence, final verification,
   pause/resume/cancel, restart recovery, unsupported/disabled honesty,
   notifications honesty, scheduler-independent reporting, chat intents,
   and a real approval-gated write workflow (blog draft, mock model).
   ========================================================================= */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fsp = require('fs/promises');
const { loadConfig } = require('../config');
const { createApp } = require('../index');
const { register: wfRegister } = require('../workflows');
const { createNotifications } = require('../notifications');
const { startMockModel, listen } = require('./_mock-model');

const ADMIN = 'test-admin-token';
const auth = { authorization: 'Bearer ' + ADMIN };
const ADMIN_ACTOR = { type: 'admin', id: 'admin' };

let app;
let base;
let mock;
let mockPort;
let draftDir;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jsonReq = (body, headers) => ({ method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers || {}), body: JSON.stringify(body) });

async function waitFor(fn, ms = 5000, every = 40) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('waitFor: condition not met in time');
    await sleep(every);
  }
}

/* ---------------------------------------------------- test tools & workflows */

function registerTestTools(tools) {
  const attempts = new Map();
  tools.register({
    name: 't_echo', description: 'test echo', risk: 'read',
    schema: { type: 'object', properties: { value: { type: 'integer' }, tag: { type: 'string', maxLength: 40 } }, additionalProperties: false },
    handler: async (args) => ({ value: args.value, tag: args.tag || null, echo: true })
  });
  tools.register({
    name: 't_slow', description: 'test slow step', risk: 'read',
    schema: { type: 'object', properties: { delayMs: { type: 'integer', min: 1, max: 5000, default: 400 } }, additionalProperties: false },
    handler: async (args) => { await sleep(args.delayMs || 400); return { ok: true, delayed: args.delayMs || 400 }; }
  });
  tools.register({
    name: 't_flaky', description: 'fails once with a transient error', risk: 'read',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      const n = (attempts.get('t_flaky') || 0) + 1;
      attempts.set('t_flaky', n);
      if (n < 2) { const e = new Error('temporary provider hiccup'); e.code = 'provider_error'; e.status = 502; throw e; }
      return { ok: true, attempt: n };
    }
  });
  tools.register({
    name: 't_always_bad', description: 'always rejected deterministically', risk: 'read',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => { const e = new Error('bad arguments'); e.code = 'invalid_request'; e.status = 400; throw e; }
  });
  tools.register({
    name: 't_offline', description: 'always reports an offline agent', risk: 'read',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => { const e = new Error('agent not connected'); e.code = 'agent_offline'; e.status = 503; throw e; }
  });
  tools.register({
    name: 't_code', description: 'returns an exit code', risk: 'read',
    schema: { type: 'object', properties: { code: { type: 'integer', default: 0 } }, additionalProperties: false },
    handler: async (args) => ({ exitCode: args.code === undefined ? 0 : args.code, suite: 't-code', durationMs: 1 })
  });
  tools.register({
    name: 't_write', description: 'test write tool (confirmation-gated)', risk: 'write',
    schema: { type: 'object', properties: { data: { type: 'string', required: true, maxLength: 500 } }, additionalProperties: false },
    handler: async (args) => ({ written: true, bytes: args.data.length })
  });
  return attempts;
}

function registerTestWorkflows() {
  wfRegister({
    id: 'test-multi', version: '1.0.0', title: 'Test multi-step', description: 'two chained read steps',
    permissionClass: 'read',
    inputs: { type: 'object', properties: { base: { type: 'integer', default: 2, min: 1, max: 10 } }, additionalProperties: false },
    tools: ['t_echo', 't_slow'],
    steps: [
      { id: 'one', label: 'first step', tool: 't_echo', argsTemplate: { value: '${inputs.base}', tag: 'first' }, dependsOn: [] },
      { id: 'two', label: 'second step', tool: 't_echo', argsTemplate: { value: '${steps.one.value}', tag: 'second' }, dependsOn: ['one'] }
    ],
    successCriteria: [{ step: 'two', expect: { echo: true } }],
    resultSchema: { type: 'object', required: ['exitCodes'] },
    limits: { timeoutMs: 30000, maxRetries: 0, maxActiveRuns: 1 }
  });
  wfRegister({
    id: 'test-slow', version: '1.0.0', title: 'Test slow', description: 'slow steps for concurrency',
    permissionClass: 'read',
    tools: ['t_slow'],
    steps: [{ id: 'slow1', tool: 't_slow', argsTemplate: { delayMs: 400 }, dependsOn: [] }],
    limits: { timeoutMs: 30000, maxActiveRuns: 1 }
  });
  wfRegister({
    id: 'test-verify-fail', version: '1.0.0', title: 'Test verification failure', description: 'criteria cannot pass',
    permissionClass: 'read',
    tools: ['t_code'],
    steps: [{ id: 'run', tool: 't_code', argsTemplate: { code: 1 }, dependsOn: [] }],
    successCriteria: [{ step: 'run', expect: { exitCode: 0 } }],
    resultSchema: { type: 'object', required: ['exitCodes'] },
    limits: { timeoutMs: 30000 }
  });
  wfRegister({
    id: 'test-write', version: '1.0.0', title: 'Test write', description: 'confirmation-gated write',
    permissionClass: 'write',
    inputs: { type: 'object', properties: { data: { type: 'string', required: true, maxLength: 200 } }, additionalProperties: false },
    tools: ['t_write'],
    steps: [{ id: 'save', tool: 't_write', argsTemplate: { data: '${inputs.data}' }, dependsOn: [] }],
    successCriteria: [{ step: 'save', expect: { written: true } }],
    limits: { timeoutMs: 30000 }
  });
  wfRegister({
    id: 'test-write-approval', version: '1.0.0', title: 'Test write with approval', description: 'workflow-scope approval gate',
    permissionClass: 'write', requiresApproval: true,
    inputs: { type: 'object', properties: { data: { type: 'string', required: true, maxLength: 200 } }, additionalProperties: false },
    tools: ['t_write'],
    steps: [{ id: 'save', tool: 't_write', argsTemplate: { data: '${inputs.data}' }, dependsOn: [] }],
    successCriteria: [{ step: 'save', expect: { written: true } }],
    limits: { timeoutMs: 30000 }
  });
  wfRegister({
    id: 'test-retry', version: '1.0.0', title: 'Test retries', description: 'transient error retries once',
    permissionClass: 'read',
    tools: ['t_flaky'],
    steps: [{ id: 'flaky', tool: 't_flaky', argsTemplate: {}, dependsOn: [] }],
    successCriteria: [{ step: 'flaky', expect: { ok: true } }],
    limits: { timeoutMs: 30000, maxRetries: 1 }
  });
  wfRegister({
    id: 'test-bad', version: '1.0.0', title: 'Test deterministic failure', description: 'fails without retry',
    permissionClass: 'read',
    tools: ['t_always_bad'],
    steps: [{ id: 'bad', tool: 't_always_bad', argsTemplate: {}, dependsOn: [] }],
    limits: { timeoutMs: 30000, maxRetries: 3 }
  });
  wfRegister({
    id: 'test-optional', version: '1.0.0', title: 'Test optional step', description: 'optional failure degrades to suspected',
    permissionClass: 'read',
    tools: ['t_echo', 't_offline'],
    steps: [
      { id: 'good', tool: 't_echo', argsTemplate: { value: 1 }, dependsOn: [] },
      { id: 'maybe', tool: 't_offline', argsTemplate: {}, dependsOn: ['good'], optional: true }
    ],
    successCriteria: [{ step: 'good', expect: { value: 1 } }],
    limits: { timeoutMs: 30000 }
  });
  wfRegister({
    id: 'test-pauser', version: '1.0.0', title: 'Test pause window', description: 'long step window for pause/resume',
    permissionClass: 'read',
    tools: ['t_slow'],
    steps: [
      { id: 's1', tool: 't_slow', argsTemplate: { delayMs: 500 }, dependsOn: [] },
      { id: 's2', tool: 't_slow', argsTemplate: { delayMs: 100 }, dependsOn: ['s1'] }
    ],
    limits: { timeoutMs: 30000 }
  });
}

before(async () => {
  registerTestWorkflows();
  draftDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ah-drafts-'));
  mock = startMockModel({
    reply: () => {
      const words = Array.from({ length: 260 }, (_, i) => 'word' + (i + 1)).join(' ');
      return `# Workflow Draft Article\n\n${words} See [AH Solution](https://ahsolution.live) for more.`;
    }
  });
  mockPort = await listen(mock.server);
  const cfg = loadConfig({
    AH_ASSISTANT_ENV: 'test', AH_STORAGE_DRIVER: 'memory', AH_ADMIN_TOKEN: ADMIN,
    AH_ENABLE_AGENT: '1',
    AH_PROVIDER: 'local', AH_LOCAL_BASE_URL: `http://127.0.0.1:${mockPort}/v1`, AH_LOCAL_MODEL: 'mock-model',
    AH_DATA_DIR: draftDir,
    AH_WORKFLOW_APPROVAL_TTL_MS: '60000'
  });
  app = createApp(cfg);
  registerTestTools(app.tools);
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + app.server.address().port;
  await app.recovered;
});

after(async () => {
  await new Promise((r) => app.server.close(r));
  mock.server.close();
  await fsp.rm(draftDir, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ engine */

test('multi-step run executes over the task manager and verifies honestly', async () => {
  const { run, replayed } = await app.engine.createRun({ workflowId: 'test-multi', inputs: { base: 2 }, actor: ADMIN_ACTOR, source: 'manual' });
  assert.equal(replayed, false);
  assert.equal(run.status, 'queued');
  assert.equal(run.steps.length, 2);

  const done = await app.engine.execute(run.id, { actor: ADMIN_ACTOR });
  assert.equal(done.status, 'completed');
  assert.ok(done.verification && done.verification.ok === true, 'final verification passed');
  assert.ok(done.verification.checks.some((c) => c.field === 'echo' && c.ok === true));
  assert.equal(done.steps[0].result.value, 2, 'interpolated input reached step one');
  assert.equal(done.steps[1].result.value, 2, 'step two consumed step one result');
  assert.equal(done.steps[0].status, 'done');
  assert.equal(done.steps[1].status, 'done');
  assert.ok(done.report && typeof done.report.exitCodes === 'object', 'a report with real exit codes exists');
  assert.equal(done.notification.delivered, false, 'never claims a notification was sent');
  assert.match(done.notification.reason, /no notification provider/);

  const view = app.engine.reportView(done);
  assert.deepEqual(view.run.progress, { completed: 2, total: 2 });

  const entries = await app.audit.list(50);
  const actions = entries.map((e) => e.action);
  for (const needed of ['workflow.create', 'workflow.execute', 'workflow.step', 'workflow.complete']) {
    assert.ok(actions.includes(needed), `audit records ${needed}`);
  }
});

test('idempotency keys replay the same run instead of creating a second', async () => {
  const a = await app.engine.createRun({ workflowId: 'test-multi', inputs: {}, actor: ADMIN_ACTOR, idempotencyKey: 'idem-demo-1' });
  const b = await app.engine.createRun({ workflowId: 'test-multi', inputs: {}, actor: ADMIN_ACTOR, idempotencyKey: 'idem-demo-1' });
  assert.equal(a.replayed, false);
  assert.equal(b.replayed, true);
  assert.equal(a.run.id, b.run.id);
  await app.engine.cancel(a.run.id, ADMIN_ACTOR); // free the concurrency slot
});

test('per-workflow concurrency limit rejects a second active run', async () => {
  const first = await app.engine.createRun({ workflowId: 'test-slow', inputs: {}, actor: ADMIN_ACTOR });
  const exec = app.engine.execute(first.run.id, { actor: ADMIN_ACTOR });
  await sleep(80); // let it enter running
  await assert.rejects(
    () => app.engine.createRun({ workflowId: 'test-slow', inputs: {}, actor: ADMIN_ACTOR }),
    (e) => e.code === 'conflict' && e.details && e.details.reason === 'max_active_runs'
  );
  const done = await exec;
  assert.equal(done.status, 'completed');
});

test('default-deny: anonymous callers may only start read-class workflows', async () => {
  const read = await app.engine.createRun({ workflowId: 'test-multi', inputs: {}, actor: null });
  assert.equal(read.run.status, 'queued');
  await app.engine.cancel(read.run.id, null);

  await assert.rejects(
    () => app.engine.createRun({ workflowId: 'test-write', inputs: { data: 'x' }, actor: null }),
    (e) => e.code === 'forbidden' && e.status === 403
  );
});

test('workflow-scope approval: bound token, wrong token refused, then runs', async () => {
  const { run } = await app.engine.createRun({ workflowId: 'test-write-approval', inputs: { data: 'hello world' }, actor: ADMIN_ACTOR });
  assert.equal(run.status, 'waiting_for_approval');
  assert.ok(run.approval && run.approval.scope === 'workflow');
  assert.ok(run.approval.token && run.approval.expiresAt);

  await assert.rejects(() => app.engine.approve(run.id, { token: 'not-the-token', actor: ADMIN_ACTOR }),
    (e) => e.code === 'forbidden' && e.status === 403);
  assert.equal((await app.engine.get(run.id)).status, 'waiting_for_approval', 'wrong token does not advance the run');

  await assert.rejects(() => app.engine.execute(run.id, { actor: ADMIN_ACTOR }),
    (e) => e.code === 'conflict' && /waiting for approval/.test(e.message));

  const approved = await app.engine.approve(run.id, { token: run.approval.token, actor: ADMIN_ACTOR });
  assert.equal(approved.status, 'queued');
  const done = await app.engine.execute(run.id, { actor: ADMIN_ACTOR });
  assert.equal(done.status, 'completed');
  assert.equal(done.steps[0].approvalSource, 'workflow');
  assert.equal(done.steps[0].result.written, true);
});

test('approval expiry fails the run honestly (injected clock, no sleeping)', async () => {
  let t = Date.now();
  const cfg2 = loadConfig({
    AH_ASSISTANT_ENV: 'test', AH_STORAGE_DRIVER: 'memory', AH_ADMIN_TOKEN: ADMIN,
    AH_WORKFLOW_APPROVAL_TTL_MS: '5000'
  });
  const app2 = createApp(cfg2, { now: () => t });
  registerTestTools(app2.tools);
  try {
    const { run } = await app2.engine.createRun({ workflowId: 'test-write-approval', inputs: { data: 'x' }, actor: ADMIN_ACTOR });
    t += 6000; // approval window elapses
    await assert.rejects(() => app2.engine.approve(run.id, { token: run.approval.token, actor: ADMIN_ACTOR }),
      (e) => e.code === 'approval_expired' && e.status === 409);
    const after = await app2.engine.get(run.id);
    assert.equal(after.status, 'failed');
    assert.match(after.error, /expired/);
  } finally {
    await new Promise((r) => app2.server.close(r));
  }
});

test('step-scope approval: unconfirmed write pauses the run, then completes', async () => {
  const { run } = await app.engine.createRun({ workflowId: 'test-write', inputs: { data: 'stepwise' }, actor: ADMIN_ACTOR });
  assert.equal(run.status, 'queued', 'no workflow-level gate');

  const afterFirst = await app.engine.execute(run.id, { actor: ADMIN_ACTOR });
  assert.equal(afterFirst.status, 'waiting_for_approval', 'write tool demanded confirmation');
  assert.equal(afterFirst.approval.scope, 'step');
  assert.equal(afterFirst.approval.stepId, 'save');
  assert.ok(afterFirst.approval.argsHash && afterFirst.approval.argsHash.length === 64);
  assert.equal(afterFirst.steps[0].status, 'pending', 'no step result is recorded before approval');

  await assert.rejects(() => app.engine.approve(run.id, { token: 'wrong', actor: ADMIN_ACTOR }),
    (e) => e.code === 'forbidden');

  await app.engine.approve(run.id, { token: afterFirst.approval.token, actor: ADMIN_ACTOR });
  const done = await app.engine.execute(run.id, { actor: ADMIN_ACTOR });
  assert.equal(done.status, 'completed');
  assert.equal(done.steps[0].approvalSource, 'step');
  assert.equal(done.steps[0].result.written, true);
});

test('pause blocks execution, resume continues, checkpoints stay truthful', async () => {
  const { run } = await app.engine.createRun({ workflowId: 'test-multi', inputs: {}, actor: ADMIN_ACTOR });
  await app.engine.pause(run.id, ADMIN_ACTOR);
  await assert.rejects(() => app.engine.execute(run.id, { actor: ADMIN_ACTOR }),
    (e) => e.code === 'conflict' && /paused/i.test(e.message));
  await app.engine.resume(run.id, ADMIN_ACTOR);
  const done = await app.engine.execute(run.id, { actor: ADMIN_ACTOR });
  assert.equal(done.status, 'completed');
  assert.ok(done.checkpoints.some((c) => c.status === 'paused'));
  assert.ok(done.checkpoints.some((c) => c.status === 'step_done'));
});

test('cooperative pause mid-run waits at the step boundary and resumes', async () => {
  const { run } = await app.engine.createRun({ workflowId: 'test-pauser', inputs: {}, actor: ADMIN_ACTOR });
  const exec = app.engine.execute(run.id, { actor: ADMIN_ACTOR });
  await sleep(150); // inside step s1 (500ms)
  await app.engine.pause(run.id, ADMIN_ACTOR);
  await sleep(700); // s1 finishes; s2 must be waiting at the pause gate
  const paused = await app.engine.get(run.id);
  assert.equal(paused.status, 'paused');
  assert.equal(paused.steps[1].status, 'pending', 'second step did not run while paused');
  await app.engine.resume(run.id, ADMIN_ACTOR);
  const done = await exec;
  assert.equal(done.status, 'completed');
  assert.ok(done.checkpoints.some((c) => c.status === 'paused'));
});

test('cancel stops a run and a cancelled run cannot be executed', async () => {
  const { run } = await app.engine.createRun({ workflowId: 'test-pauser', inputs: {}, actor: ADMIN_ACTOR });
  const exec = app.engine.execute(run.id, { actor: ADMIN_ACTOR });
  await sleep(120);
  const cancelled = await app.engine.cancel(run.id, ADMIN_ACTOR);
  assert.equal(cancelled.status, 'cancelled');
  const done = await exec;
  assert.equal(done.status, 'cancelled');
  assert.equal(done.steps[1].status, 'pending', 'later steps never ran');

  await assert.rejects(() => app.engine.execute(run.id, { actor: ADMIN_ACTOR }),
    (e) => e.code === 'conflict');
});

test('transient failures retry within the bounded budget; deterministic ones do not', async () => {
  const retried = await app.engine.createRun({ workflowId: 'test-retry', inputs: {}, actor: ADMIN_ACTOR });
  const done = await app.engine.execute(retried.run.id, { actor: ADMIN_ACTOR });
  assert.equal(done.status, 'completed');
  assert.equal(done.steps[0].attempts, 2, 'one retry after the transient error');
  assert.equal(done.steps[0].result.attempt, 2);

  const bad = await app.engine.createRun({ workflowId: 'test-bad', inputs: {}, actor: ADMIN_ACTOR });
  const failed = await app.engine.execute(bad.run.id, { actor: ADMIN_ACTOR });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.steps[0].attempts, 1, 'invalid_request is never retried');
});

test('an optional step failure degrades to suspected evidence, not failure', async () => {
  const { run } = await app.engine.createRun({ workflowId: 'test-optional', inputs: {}, actor: ADMIN_ACTOR });
  const done = await app.engine.execute(run.id, { actor: ADMIN_ACTOR });
  assert.equal(done.status, 'completed');
  assert.equal(done.steps[1].status, 'done');
  assert.equal(done.steps[1].result.suspected, true);
  assert.ok(done.report.suspected.some((s) => s.step === 'maybe'));
  assert.ok(done.verification.ok === true);
});

test('final verification can fail an otherwise completed task', async () => {
  const { run } = await app.engine.createRun({ workflowId: 'test-verify-fail', inputs: {}, actor: ADMIN_ACTOR });
  const done = await app.engine.execute(run.id, { actor: ADMIN_ACTOR });
  assert.equal(done.status, 'failed');
  assert.match(done.error, /final verification/);
  assert.equal(done.verification.ok, false);
  assert.equal(done.report.exitCodes['t-code'], 1, 'real exit code is preserved in the report');
});

test('a tampered step tool is denied at execution time (defence in depth)', async () => {
  const { run } = await app.engine.createRun({ workflowId: 'test-multi', inputs: {}, actor: ADMIN_ACTOR });
  const stored = await app.storage.workflowRuns.get(run.id);
  stored.steps[1].tool = 't_write'; // not permitted for this workflow
  await app.storage.workflowRuns.save(stored);

  const done = await app.engine.execute(run.id, { actor: ADMIN_ACTOR });
  assert.equal(done.status, 'failed');
  assert.match(done.error, /not permitted for this workflow/);
  assert.equal(done.steps[0].status, 'done', 'the first step still completed');
});

test('unsupported workflows are refused up front with 501 workflow_unsupported', async () => {
  await assert.rejects(
    () => app.engine.createRun({ workflowId: 'approved-file-change', inputs: { target: 'index.html', instruction: 'x' }, actor: ADMIN_ACTOR }),
    (e) => e.code === 'workflow_unsupported' && e.status === 501
  );
  const av = app.engine.availability('blog-draft-production');
  assert.ok(av.ok, 'blog draft is available here because the mock model is configured');
});

test('restart recovery pauses interrupted runs instead of auto-resuming', async () => {
  const interrupted = {
    id: 'wr_recovered0000000001', workflowId: 'test-multi', workflowVersion: '1.0.0', title: 'Test multi-step',
    permissionClass: 'read', source: 'manual', idempotencyKey: null, createdBy: 'tester', status: 'running',
    inputs: { base: 2 },
    steps: [{ id: 'one', label: 'first step', tool: 't_echo', argsTemplate: {}, dependsOn: [], timeoutMs: null, retryable: true, idempotencyKey: false, optional: false, status: 'done', attempts: 1, result: { value: 2 }, error: null, startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:00:01.000Z' }],
    checkpoints: [], approval: null, taskRef: null, deadlineAt: null, currentStepId: 'one',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:00.000Z', finishedAt: null, error: null, verification: null, report: null,
    notification: { delivered: false, provider: 'none', reason: 'not sent' }
  };
  await app.storage.workflowRuns.save(interrupted);
  const n = await app.engine.recover();
  assert.ok(n >= 1);
  const back = await app.engine.get(interrupted.id);
  assert.equal(back.status, 'paused', 'an interrupted run waits for an explicit resume');
  assert.ok(back.checkpoints.some((c) => /resume explicitly/.test(c.note)));
  await app.storage.workflowRuns.delete(interrupted.id).catch(() => {});
});

test('notifications report honestly when no provider is configured', async () => {
  const n = createNotifications({ cfg: { notifications: { provider: 'none' } } });
  assert.deepEqual(n.describe(), { provider: 'none', configured: false });
  const res = await n.notify({ type: 'workflow.finished', workflow: 'test-multi', runId: 'wr_x', status: 'completed' });
  assert.equal(res.delivered, false);
  assert.match(res.reason, /no notification provider configured/);
});

/* ------------------------------------------------------------------ HTTP */

test('workflow metadata is public; run routes require authentication', async () => {
  const list = await (await fetch(base + '/api/workflows')).json();
  assert.ok(list.workflows.some((w) => w.id === 'website-qa'));
  assert.ok(list.workflows.some((w) => w.id === 'approved-file-change' && w.supported === false));
  assert.ok(list.workflows.every((w) => typeof w.ok === 'boolean'), 'each entry carries its availability');

  const detail = await fetch(base + '/api/workflows/website-qa');
  assert.equal(detail.status, 200);
  const d = await detail.json();
  assert.equal(d.workflow.version, '1.0.0');
  assert.equal(d.workflow.expandable, true);
  assert.ok(d.workflow.limits.timeoutMs > 0);

  assert.equal((await fetch(base + '/api/workflows/does-not-exist')).status, 404);
  assert.equal((await fetch(base + '/api/workflows/runs')).status, 401, 'run list requires auth');
  assert.equal((await fetch(base + '/api/workflows/test-multi/run', { method: 'POST' })).status, 401, 'starting requires auth');
  assert.equal((await fetch(base + '/api/workflows/runs/wr_missing')).status, 401);
});

test('HTTP: start, poll, pause/resume/cancel a read workflow run', async () => {
  const start = await fetch(base + '/api/workflows/test-multi/run', jsonReq({ inputs: { base: 3 }, idempotencyKey: 'http-idem-1' }, auth));
  assert.equal(start.status, 200);
  const sj = await start.json();
  assert.equal(sj.replayed, false);
  const id = sj.run.id;
  assert.equal(sj.run.workflow, 'test-multi');

  const replay = await (await fetch(base + '/api/workflows/test-multi/run', jsonReq({ inputs: { base: 3 }, idempotencyKey: 'http-idem-1' }, auth))).json();
  assert.equal(replay.replayed, true);
  assert.equal(replay.run.id, id);

  const done = await waitFor(async () => {
    const v = await (await fetch(base + '/api/workflows/runs/' + id, { headers: auth })).json();
    return ['completed', 'failed', 'cancelled', 'timed_out'].includes(v.run.status) ? v : null;
  });
  assert.equal(done.run.status, 'completed');
  assert.equal(done.run.progress.completed, 2);
  assert.equal(done.report.confirmed.length, 0);

  const list = await (await fetch(base + '/api/workflows/runs', { headers: auth })).json();
  assert.ok(list.runs.some((r) => r.id === id));
});

test('HTTP: approval endpoints are admin-only and token-bound', async () => {
  const created = await (await fetch(base + '/api/workflows/test-write-approval/run', jsonReq({ inputs: { data: 'via-http' } }, auth))).json();
  const id = created.run.id;
  assert.equal(created.run.status, 'waiting_for_approval');
  assert.ok(created.run.approval && created.run.approval.token, 'an admin viewer receives the bound token');

  assert.equal((await fetch(base + '/api/workflows/runs/' + id + '/approve', jsonReq({ token: 'nope' }))).status, 401, 'anonymous cannot approve');
  const wrong = await fetch(base + '/api/workflows/runs/' + id + '/approve', jsonReq({ token: 'nope' }, auth));
  assert.equal(wrong.status, 403, 'wrong token is forbidden');

  const ok = await fetch(base + '/api/workflows/runs/' + id + '/approve', jsonReq({ token: created.run.approval.token }, auth));
  assert.equal(ok.status, 200);
  assert.ok(['queued', 'running'].includes((await ok.json()).run.status), 'the approved run leaves the approval state');

  const done = await waitFor(async () => {
    const v = await (await fetch(base + '/api/workflows/runs/' + id, { headers: auth })).json();
    return ['completed', 'failed', 'timed_out'].includes(v.run.status) ? v : null;
  });
  assert.equal(done.run.status, 'completed');
  assert.equal(done.steps[0].approvalSource, 'workflow');

  const pausedRun = await (await fetch(base + '/api/workflows/test-pauser/run', jsonReq({}, auth))).json();
  const pId = pausedRun.run.id;
  const resumed = await fetch(base + '/api/workflows/runs/' + pId + '/pause', { method: 'POST', headers: auth });
  assert.equal(resumed.status, 200);
  assert.equal((await resumed.json()).run.status, 'paused');
  const cancelled = await fetch(base + '/api/workflows/runs/' + pId + '/cancel', { method: 'POST', headers: auth });
  assert.equal(cancelled.status, 200);
  assert.equal((await cancelled.json()).run.status, 'cancelled');
});

test('HTTP: unsupported workflow refuses the start; disabled workflows are honest', async () => {
  const r = await fetch(base + '/api/workflows/approved-file-change/run', jsonReq({ inputs: { target: 'x', instruction: 'y' } }, auth));
  assert.equal(r.status, 501);
  const j = await r.json();
  assert.equal(j.error, 'workflow_unsupported');
  assert.ok(/patch/i.test(j.message + (j.reason || '')));

  const cfgOff = loadConfig({ AH_ASSISTANT_ENV: 'test', AH_STORAGE_DRIVER: 'memory', AH_ADMIN_TOKEN: ADMIN, AH_ENABLE_WORKFLOWS: '0' });
  const offApp = createApp(cfgOff);
  try {
    await assert.rejects(() => offApp.engine.createRun({ workflowId: 'test-multi', inputs: {}, actor: ADMIN_ACTOR }),
      (e) => e.code === 'workflows_disabled' && e.status === 503);
  } finally {
    await new Promise((r2) => offApp.server.close(r2));
  }
});

/* --------------------------------------------------------- chat interface */

test('chat can start a registered workflow and report run status', async () => {
  const startRes = await fetch(base + '/api/chat', jsonReq({ message: 'Please run the website health audit workflow now.' }));
  assert.equal(startRes.status, 200);
  const sj = await startRes.json();
  assert.equal(sj.mode, 'workflow');
  assert.ok(sj.workflow && sj.workflow.runId, 'a run was created');
  assert.match(sj.reply, /started|created/i);
  assert.ok(/workflow/i.test(sj.reply));

  const runId = sj.workflow.runId;
  const storedMsgs = await app.storage.messages.list(sj.sessionId);
  const assistantMsg = storedMsgs.filter((m) => m.role === 'assistant').pop();
  assert.equal(assistantMsg.meta.mode, 'workflow');

  const statusAnon = await (await fetch(base + '/api/chat', jsonReq({ message: 'workflow status', sessionId: sj.sessionId }))).json();
  assert.equal(statusAnon.mode, 'workflow-status');
  assert.match(statusAnon.reply, /sign in/i, 'anonymous callers are not shown run internals');

  const statusAuth = await fetch(base + '/api/chat', jsonReq({ message: 'workflow status', sessionId: sj.sessionId }, auth));
  const sa = await statusAuth.json();
  assert.equal(sa.mode, 'workflow-status');
  assert.match(sa.reply, /Status:/);
  assert.ok(sa.reply.includes(runId), 'status names the run');

  await waitFor(async () => {
    const r = await app.engine.get(runId);
    return ['completed', 'failed', 'timed_out'].includes(r.status) ? r : null;
  }, 15000);
});

test('the M4 direct QA intent still wins when no workflow word is present', async () => {
  const r = await (await fetch(base + '/api/chat', jsonReq({ message: 'Run the website page QA.' }))).json();
  assert.notEqual(r.mode, 'workflow');
  assert.notEqual(r.mode, 'workflow-status');
});

/* ------------------------------------------- real write workflow (mock model) */

test('blog draft workflow: approval gate, real model call, create-only save', async () => {
  const created = await (await fetch(base + '/api/workflows/blog-draft-production/run',
    jsonReq({ inputs: { topic: 'workflow testing basics', words: 200, slug: 'workflow-draft-test' } }, auth))).json();
  assert.equal(created.run.status, 'waiting_for_approval');
  assert.ok(created.run.approval && created.run.approval.token);

  const approved = await fetch(base + '/api/workflows/runs/' + created.run.id + '/approve',
    jsonReq({ token: created.run.approval.token }, auth));
  assert.equal(approved.status, 200);

  const done = await waitFor(async () => {
    const v = await (await fetch(base + '/api/workflows/runs/' + created.run.id, { headers: auth })).json();
    return ['completed', 'failed', 'timed_out'].includes(v.run.status) ? v : null;
  }, 20000, 100);
  assert.equal(done.run.status, 'completed', `run finished: ${done.run.error || ''}`);
  assert.equal(done.verification.ok, true);
  assert.ok(mock.state.chatCalls >= 1, 'the model provider was actually called');
  assert.ok(done.report.paths.length >= 1, 'a draft path is reported');

  const draftPath = path.resolve(draftDir, 'drafts', 'workflow-draft-test.md');
  const content = await fsp.readFile(draftPath, 'utf8');
  assert.match(content, /ah-draft: unreviewed/, 'the draft is marked unreviewed');
  assert.match(content, /# Workflow Draft Article/);
  assert.ok(!content.includes('ah-draft: unreviewed') || content.startsWith('<!-- ah-draft: unreviewed'), 'marker is prepended');
  assert.equal(done.steps[2].approvalSource, 'workflow', 'save step ran under the admin approval');

  /* A second run with the same slug must never overwrite: it picks a fresh name. */
  const again = await (await fetch(base + '/api/workflows/blog-draft-production/run',
    jsonReq({ inputs: { topic: 'second run', words: 200, slug: 'workflow-draft-test' } }, auth))).json();
  await fetch(base + '/api/workflows/runs/' + again.run.id + '/approve', jsonReq({ token: again.run.approval.token }, auth));
  const second = await waitFor(async () => {
    const v = await (await fetch(base + '/api/workflows/runs/' + again.run.id, { headers: auth })).json();
    return ['completed', 'failed', 'timed_out'].includes(v.run.status) ? v : null;
  }, 20000, 100);
  assert.equal(second.run.status, 'completed');
  const suffixed = path.resolve(draftDir, 'drafts', 'workflow-draft-test-1.md');
  await fsp.access(suffixed);
  const originalStill = await fsp.readFile(draftPath, 'utf8');
  assert.match(originalStill, /workflow testing basics|Workflow Draft Article/, 'the first draft was untouched');
});
