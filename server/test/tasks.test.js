'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../config');
const { createStorage } = require('../storage');
const { createAudit } = require('../audit');
const { createTaskManager } = require('../tasks');
const { ApprovalRequiredError, ValidationError, ConflictError } = require('../errors');

const cfg = loadConfig({ AH_ASSISTANT_ENV: 'test' });
const logger = { debug() {}, info() {}, warn() {}, error() {} };
const mk = () => createTaskManager(createStorage(cfg), createAudit(createStorage(cfg), logger), logger);

test('create validates the goal and steps', async () => {
  const tm = mk();
  await assert.rejects(() => tm.create({ goal: '' }), ValidationError);
  await assert.rejects(() => tm.create({ goal: 'x', steps: [] }), ValidationError);
  const t = await tm.create({ goal: 'do a thing', steps: [{ label: 's1' }], createdBy: 'admin' });
  assert.equal(t.status, 'queued');
  assert.equal(t.steps.length, 1);
});

test('a simple task runs to completion with checkpoints', async () => {
  const tm = mk();
  const t = await tm.create({ goal: 'g', steps: [{ label: 'a' }, { label: 'b' }], createdBy: 'admin' });
  const done = await tm.run(t.id, async () => 'ok');
  assert.equal(done.status, 'completed');
  assert.ok(done.steps.every((s) => s.status === 'done'));
  assert.ok(done.checkpoints.length >= 3); // running + completed at least
  assert.ok(done.finishedAt);
});

test('approval-required pauses the task, and approve resumes it', async () => {
  const tm = mk();
  const t = await tm.create({ goal: 'g', steps: [{ label: 'risky' }], createdBy: 'admin' });
  const paused = await tm.run(t.id, async (step) => {
    if (!step.confirmed) throw new ApprovalRequiredError('needs approval');
    return 'done';
  });
  assert.equal(paused.status, 'awaiting_approval');
  assert.equal(paused.steps[0].status, 'pending');

  const approved = await tm.approve(t.id, { id: 'admin' });
  assert.equal(approved.status, 'queued');
  assert.equal(approved.steps[0].confirmed, true);

  const finished = await tm.run(t.id, async () => 'done');
  assert.equal(finished.status, 'completed');
});

test('retries are bounded, then the task fails', async () => {
  const tm = mk();
  const t = await tm.create({ goal: 'g', steps: [{ label: 'flaky' }], createdBy: 'admin', limits: { maxRetries: 1 } });
  let calls = 0;
  const failed = await tm.run(t.id, async () => { calls++; throw new Error('nope'); });
  assert.equal(failed.status, 'failed');
  assert.equal(calls, 2); // 1 try + 1 retry
});

test('transient failure recovers within the retry budget', async () => {
  const tm = mk();
  const t = await tm.create({ goal: 'g', steps: [{ label: 'flaky' }], createdBy: 'admin', limits: { maxRetries: 2 } });
  let calls = 0;
  const done = await tm.run(t.id, async () => { calls++; if (calls < 2) throw new Error('nope'); return 'ok'; });
  assert.equal(done.status, 'completed');
  assert.equal(done.steps[0].attempts, 2);
});

test('finished tasks cannot be cancelled or re-run', async () => {
  const tm = mk();
  const t = await tm.create({ goal: 'g', steps: [{ label: 'a' }], createdBy: 'admin' });
  await tm.run(t.id, async () => 'ok');
  await assert.rejects(() => tm.cancel(t.id, { id: 'admin' }), ConflictError);
  await assert.rejects(() => tm.run(t.id, async () => 'ok'), ConflictError);
});

test('cancel stops a queued task', async () => {
  const tm = mk();
  const t = await tm.create({ goal: 'g', steps: [{ label: 'a' }], createdBy: 'admin' });
  const c = await tm.cancel(t.id, { id: 'admin' });
  assert.equal(c.status, 'cancelled');
});
