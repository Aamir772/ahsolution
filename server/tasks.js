/* ==========================================================================
   server/tasks.js — bounded task executor

   A task is an explicit, finite goal with an explicit list of steps. There is
   NO recursive planning here: the run loop is bounded by maxSteps, maxRetries
   and a wall-clock deadline. Every state transition is checkpointed and
   audited. Actions that need confirmation pause the task in
   "awaiting_approval" instead of silently proceeding.
   ========================================================================== */
'use strict';

const { newId } = require('./storage');
const { ConflictError, ValidationError, TimeoutError } = require('./errors');
const { ApprovalRequiredError } = require('./errors');

const STATUS = ['queued', 'running', 'awaiting_approval', 'completed', 'failed', 'blocked', 'cancelled'];
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

const DEFAULT_LIMITS = { maxSteps: 12, maxRetries: 1, timeoutMs: 120000, backoffBaseMs: 150, backoffMaxMs: 4000 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function stepTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, rej) => { timer = setTimeout(() => rej(new TimeoutError(`${label} exceeded ${ms}ms.`)), ms); })
  ]).finally(() => clearTimeout(timer));
}

/**
 * @param {{ tasks: object }} storage
 * @param {{ record: Function }} audit
 * @param {{ info: Function, warn: Function }} logger
 */
function createTaskManager(storage, audit, logger) {
  async function create({ goal, scope, steps, createdBy, limits }) {
    if (!goal || typeof goal !== 'string') throw new ValidationError('A task goal is required.');
    const list = Array.isArray(steps) ? steps : [];
    if (!list.length) throw new ValidationError('At least one step is required.');
    if (list.length > (limits && limits.maxSteps || DEFAULT_LIMITS.maxSteps)) throw new ValidationError('Too many steps for the configured limit.');
    const now = new Date().toISOString();
    const task = {
      id: newId('task'),
      goal: goal.slice(0, 500),
      scope: (scope || 'general').slice(0, 100),
      createdBy: createdBy || 'anon',
      status: 'queued',
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
      error: null,
      limits: Object.assign({}, DEFAULT_LIMITS, limits || {}),
      checkpoints: [],
      steps: list.map((s, i) => ({
        id: `s${i + 1}`,
        label: String((s && s.label) || `step ${i + 1}`).slice(0, 200),
        tool: s && s.tool ? String(s.tool) : null,
        args: s && s.args ? s.args : {},
        timeoutMs: s && Number.isFinite(s.timeoutMs) ? s.timeoutMs : null,
        confirmed: !!(s && s.confirmed),
        status: 'pending',
        attempts: 0,
        result: null,
        error: null,
        startedAt: null,
        finishedAt: null
      }))
    };
    await storage.tasks.save(task);
    await audit.record({ action: 'task.create', actor: task.createdBy, target: task.id, outcome: 'info', meta: { scope: task.scope, steps: task.steps.length } });
    return task;
  }

  const get = (id) => storage.tasks.get(id);
  const list = () => storage.tasks.list();

  async function transition(task, status, meta) {
    task.status = status;
    task.updatedAt = new Date().toISOString();
    if (TERMINAL.has(status)) task.finishedAt = new Date().toISOString();
    task.checkpoints.push({ at: task.updatedAt, status, note: meta && meta.note || null });
    await storage.tasks.save(task);
    await audit.record({ action: 'task.transition', actor: task.createdBy, target: task.id, outcome: status, meta: meta || {} });
    return task;
  }

  async function cancel(id, actor) {
    const task = await get(id);
    if (!task) throw new ValidationError('Unknown task.');
    if (TERMINAL.has(task.status)) throw new ConflictError('Task already finished.');
    await transition(task, 'cancelled', { note: `cancelled by ${actor && actor.id || 'unknown'}` });
    return task;
  }

  /**
   * Run a task to completion (or a safe stopping point).
   * @param {string} id
   * @param {(step:object, task:object)=>Promise<any>} executor
   */
  async function run(id, executor) {
    const task = await get(id);
    if (!task) throw new ValidationError('Unknown task.');
    if (TERMINAL.has(task.status)) throw new ConflictError('Task already finished.');
    if (typeof executor !== 'function') throw new ValidationError('An executor function is required.');

    await transition(task, 'running');
    const deadline = Date.now() + (task.limits.timeoutMs || DEFAULT_LIMITS.timeoutMs);

    for (const step of task.steps) {
      if (step.status === 'done') continue;

      // Cooperative cancellation: re-read the persisted status.
      const fresh = await get(id);
      if (!fresh || fresh.status === 'cancelled') return transition(task, 'cancelled', { note: 'cancelled during run' });

      if (Date.now() > deadline) {
        task.error = 'Task deadline exceeded.';
        return transition(task, 'blocked', { note: 'deadline exceeded' });
      }

      step.status = 'running';
      step.startedAt = new Date().toISOString();
      await storage.tasks.save(task);

      const maxRetries = task.limits.maxRetries || 0;
      let lastErr = null;
      let approved = false;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        step.attempts = attempt + 1;
        try {
          const remaining = Math.max(1000, deadline - Date.now());
          const stepBudget = Number.isFinite(step.timeoutMs) && step.timeoutMs > 0 ? step.timeoutMs : 30000;
          step.result = await stepTimeout(Promise.resolve(executor(step, task)), Math.min(remaining, stepBudget), `step ${step.id}`);
          step.status = 'done';
          step.finishedAt = new Date().toISOString();
          task.checkpoints.push({ at: step.finishedAt, status: 'step_done', note: `step ${step.id} done` });
          await storage.tasks.save(task);
          await audit.record({ action: 'task.step', actor: task.createdBy, target: task.id, outcome: 'success', meta: { step: step.id, tool: step.tool, attempt: step.attempts } });
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          if (e instanceof ApprovalRequiredError) {
            step.status = 'pending';
            await transition(task, 'awaiting_approval', { note: `step ${step.id} requires approval: ${e.message}` });
            return task;
          }
          if (logger) logger.warn('task_step_failed', { task: task.id, step: step.id, attempt: attempt + 1, message: e && e.message });
          step.error = String(e && e.message || e).slice(0, 300);
          /* Non-idempotent / non-transient failures are never retried: an error
             may opt out with `retryable = false` (e.g. denied, invalid, not
             found). Everything else gets bounded exponential backoff. */
          if (e && e.retryable === false) break;
          if (attempt < maxRetries) {
            const base = task.limits.backoffBaseMs || DEFAULT_LIMITS.backoffBaseMs;
            const cap = task.limits.backoffMaxMs || DEFAULT_LIMITS.backoffMaxMs;
            await sleep(Math.min(cap, base * Math.pow(2, attempt)));
          }
        }
      }

      if (lastErr) {
        step.status = 'failed';
        task.error = step.error;
        return transition(task, 'failed', { note: `step ${step.id} failed` });
      }
      approved = approved || false;
    }

    return transition(task, 'completed', { note: 'all steps completed' });
  }

  /** Explicit human approval of an awaiting_approval task's next step. */
  async function approve(id, actor) {
    const task = await get(id);
    if (!task) throw new ValidationError('Unknown task.');
    if (task.status !== 'awaiting_approval') throw new ConflictError('Task is not awaiting approval.');
    const pending = task.steps.find((s) => s.status === 'pending');
    if (pending) pending.confirmed = true;
    await transition(task, 'queued', { note: `approved by ${actor && actor.id || 'unknown'}` });
    return task;
  }

  return { create, get, list, run, cancel, approve, STATUS };
}

module.exports = { createTaskManager, DEFAULT_LIMITS, TERMINAL };
