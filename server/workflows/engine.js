'use strict';
/* ==========================================================================
   server/workflows/engine.js — bounded, permission-controlled execution

   Reuses the existing task manager (server/tasks.js) as the step loop:
   ordered execution, bounded retries with backoff, checkpoints, cooperative
   cancellation and the approval pause all live there. The engine adds the
   workflow layer on top:

     * explicit run states: queued | running | waiting_for_approval | paused |
       completed | failed | cancelled | timed_out
     * default-deny: registered workflow + declared tools only
     * argument interpolation from validated inputs / previous step results
       (a tiny ${...} reference resolver — never eval, never shell)
     * approval records bound to task + step + exact arguments + expiry; only
       backend code (an admin HTTP call) can approve — a model reply cannot
     * final verification: a run never reports "completed" until its declared
       success criteria pass and the result schema matches
     * idempotency keys (duplicate-delivery protection), per-workflow and
       global concurrency limits, durable history, restart recovery
     * side effects are never auto-retried unless the step declares the tool
       idempotent
   ========================================================================= */
'use strict';

const crypto = require('crypto');
const { newId } = require('../storage');
const {
  AppError, ValidationError, NotFoundError, ConflictError, ForbiddenError,
  ApprovalRequiredError, TimeoutError, ToolDeniedError
} = require('../errors');

const RUN_STATES = ['queued', 'running', 'waiting_for_approval', 'paused', 'completed', 'failed', 'cancelled', 'timed_out'];
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'timed_out']);
const ACTIVE = new Set(['queued', 'running', 'waiting_for_approval', 'paused']);

/* Transient = eligible for bounded retry. Everything else fails fast. */
const TRANSIENT_CODES = new Set(['timeout', 'agent_busy', 'provider_error', 'rate_limited']);
/* Deterministic rejections are never worth retrying. */
const NON_RETRYABLE_CODES = new Set([
  'invalid_request', 'tool_denied', 'forbidden', 'not_found', 'auth_required',
  'payload_too_large', 'approval_required', 'conflict', 'workflow_unsupported'
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

/** Stable JSON (sorted keys) so approval hashes cannot drift with key order. */
function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}

const REF_RE = /\$\{(inputs|steps)\.([a-zA-Z][a-zA-Z0-9_.-]*)\}/g;
const WHOLE_REF_RE = /^\$\{(inputs|steps)\.([a-zA-Z][a-zA-Z0-9_.-]*)\}$/;

function lookupPath(root, dotted) {
  let cur = root;
  for (const part of dotted.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

function resolveRef(kind, refPath, ctx) {
  if (kind === 'inputs') {
    const v = lookupPath(ctx.inputs, refPath);
    if (v === undefined || v === null) throw new ValidationError(`Step argument references missing input "${refPath}".`);
    return v;
  }
  const [stepId, ...rest] = refPath.split('.');
  const step = (ctx.steps || []).find((s) => s.id === stepId);
  if (!step) throw new ValidationError(`Step argument references unknown step "${stepId}".`);
  if (step.status !== 'done') throw new ValidationError(`Step argument references step "${stepId}" which has not completed.`);
  const v = rest.length ? lookupPath(step.result, rest.join('.')) : step.result;
  if (v === undefined || v === null) throw new ValidationError(`Step "${stepId}" produced no value for "${refPath}".`);
  if (typeof v === 'object') {
    const j = JSON.stringify(v);
    if (j.length > 65536) throw new ValidationError(`Step "${stepId}" value for "${refPath}" is too large to pass between steps.`);
    return j;
  }
  return v;
}

/**
 * Resolve ${inputs.x} / ${steps.<id>.<path>} references in step argument
 * templates. Untrusted structure only — no expressions, no code, no eval.
 * A template that is exactly one reference preserves the original type
 * (so numbers/booleans reach numeric/boolean schema fields intact).
 */
function interpolate(value, ctx) {
  if (typeof value === 'string') {
    const whole = value.match(WHOLE_REF_RE);
    if (whole) {
      const v = resolveRef(whole[1], whole[2], ctx);
      if (typeof v === 'number' || typeof v === 'boolean') return v;
      return typeof v === 'object' ? JSON.stringify(v) : String(v);
    }
    return value.replace(REF_RE, (m, kind, refPath) => {
      const v = resolveRef(kind, refPath, ctx);
      if (Array.isArray(v)) return v.join(',');
      return typeof v === 'object' ? JSON.stringify(v) : String(v);
    });
  }
  if (Array.isArray(value)) return value.map((v) => interpolate(v, ctx));
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[k] = interpolate(value[k], ctx);
    return out;
  }
  return value;
}

/** Bound a stored step result so a runaway tool cannot bloat storage/audit. */
function boundResult(result, maxBytes) {
  let json;
  try { json = JSON.stringify(result); } catch (e) { return { unserializable: true }; }
  if (json === undefined) return null;
  if (Buffer.byteLength(json, 'utf8') <= maxBytes) return result;
  return { truncated: true, bytes: Buffer.byteLength(json, 'utf8'), preview: json.slice(0, maxBytes) };
}

function boundedMessage(e) {
  return String((e && e.message) || e).slice(0, 300);
}

/**
 * @param {object} deps
 * @param {object} deps.cfg
 * @param {ReturnType<import('./registry')>} deps.wfRegistry
 * @param {ReturnType<import('../tools/registry').createToolRegistry>} deps.tools
 * @param {ReturnType<import('../tasks').createTaskManager>} deps.tasks
 * @param {ReturnType<import('../storage').createStorage>} deps.storage
 * @param {object} deps.audit
 * @param {object} deps.logger
 * @param {object} [deps.providers]
 * @param {object} [deps.notifications]
 * @param {()=>number} [deps.now] clock injection for tests
 */
function createWorkflowEngine({ cfg, wfRegistry, tools, tasks, storage, audit, logger, providers, notifications, now }) {
  const clock = typeof now === 'function' ? now : () => Date.now();
  const iso = () => new Date(clock()).toISOString();
  /** @type {Map<string, Promise>} in-flight executions (single-flight per run) */
  const inflight = new Map();

  const wcfg = () => cfg.workflows;

  async function save(run) {
    run.updatedAt = iso();
    await storage.workflowRuns.save(run);
    return run;
  }

  async function get(id) {
    if (typeof id !== 'string' || !id) return null;
    const run = await storage.workflowRuns.get(id);
    if (run) await sweepApproval(run);
    return run;
  }

  const listRuns = () => storage.workflowRuns.list();

  async function findRunByKey(key) {
    if (!key) return null;
    const all = await listRuns();
    return all.find((r) => r.idempotencyKey === key) || null;
  }

  async function countActive(filter) {
    const all = await listRuns();
    return all.filter((r) => ACTIVE.has(r.status) && (!filter || filter(r))).length;
  }

  /* ---------------------------------------------------------- approvals */

  function makeApproval(scope, run, stepId, argsHash) {
    return {
      scope,
      stepId: stepId || null,
      argsHash: argsHash || null,
      token: crypto.randomBytes(16).toString('hex'),
      issuedAt: iso(),
      expiresAt: new Date(clock() + (wcfg().approvalTtlMs || 900000)).toISOString(),
      approvedBy: null,
      approvedAt: null
    };
  }

  const approvalExpired = (ap) => !ap || Date.parse(ap.expiresAt) <= clock();

  function approvalUsable(ap) {
    return !!ap && !approvalExpired(ap) && !!ap.approvedBy;
  }

  /** An expired waiting run is not silently resumable — it fails honestly. */
  async function sweepApproval(run) {
    if (run.status !== 'waiting_for_approval') return;
    if (!run.approval || !approvalExpired(run.approval) || run.approval.approvedBy) return;
    run.status = 'failed';
    run.error = 'approval expired';
    run.finishedAt = iso();
    run.checkpoints.push({ at: iso(), status: 'approval_expired', note: 'approval window elapsed before an admin approved the run' });
    await save(run);
    if (audit) await audit.record({ action: 'workflow.approval_expired', actor: run.createdBy, target: run.id, outcome: 'failed', meta: { workflow: run.workflowId } });
  }

  /* --------------------------------------------------------- createRun */

  /**
   * @param {{workflowId:string, inputs?:object, actor?:object|null,
   *          idempotencyKey?:string, source?:string}} opts
   * @returns {Promise<{run:object, replayed:boolean}>}
   */
  async function createRun({ workflowId, inputs, actor, idempotencyKey, source }) {
    if (!wcfg().enabled) throw new AppError('workflows_disabled', 'Workflow execution is disabled on this server.', 503);

    const wf = wfRegistry.get(workflowId);
    if (!wf) throw new NotFoundError(`Unknown workflow "${workflowId}".`);
    wfRegistry.assertAvailable(wf, { providers, tools });

    /* Duplicate delivery: the same idempotency key never creates a second run. */
    if (idempotencyKey) {
      if (typeof idempotencyKey !== 'string' || idempotencyKey.length > 100) throw new ValidationError('idempotencyKey must be a string of at most 100 characters.');
      const existing = await findRunByKey(idempotencyKey);
      if (existing) return { run: existing, replayed: true };
    }

    /* Default-deny: anonymous callers may only start read-class workflows. */
    if (wf.permissionClass !== 'read' && !actor) throw new ForbiddenError('Authentication required to start this workflow.');

    const parsedInputs = wfRegistry.applyInputs(wf.inputs, inputs);

    /* Concurrency: per-workflow then global. */
    const perWf = await countActive((r) => r.workflowId === wf.id);
    if (perWf >= (wf.limits.maxActiveRuns || 1)) {
      throw new ConflictError(`Workflow "${wf.id}" already has an active run.`, { reason: 'max_active_runs', active: perWf, max: wf.limits.maxActiveRuns });
    }
    const total = await countActive();
    if (total >= (wcfg().maxConcurrentRuns || 3)) {
      throw new ConflictError('Too many workflow runs are active right now.', { reason: 'busy', active: total, max: wcfg().maxConcurrentRuns });
    }

    /* Expanded steps are validated exactly like registered ones. */
    const steps = wfRegistry.resolveSteps(wf, parsedInputs, cfg);
    for (const s of steps) {
      const t = tools.get(s.tool);
      if (!t || !t.enabled) throw new ValidationError(`Workflow "${wf.id}" needs tool "${s.tool}" which is not available.`);
    }

    const nowIso = iso();
    const run = {
      id: newId('wr'),
      workflowId: wf.id,
      workflowVersion: wf.version,
      title: wf.title,
      permissionClass: wf.permissionClass,
      source: source || 'manual',
      idempotencyKey: idempotencyKey || null,
      createdBy: (actor && actor.id) || 'anon',
      status: wf.requiresApproval ? 'waiting_for_approval' : 'queued',
      inputs: parsedInputs,
      steps: steps.map((s) => ({
        id: s.id,
        label: String(s.label || s.id).slice(0, 200),
        tool: s.tool,
        argsTemplate: s.argsTemplate || {},
        dependsOn: (s.dependsOn || []).slice(),
        timeoutMs: Number.isFinite(s.timeoutMs) ? s.timeoutMs : null,
        retryable: s.retryable !== false,
        idempotencyKey: !!s.idempotencyKey,
        optional: !!s.optional,
        status: 'pending',
        attempts: 0,
        result: null,
        error: null,
        startedAt: null,
        finishedAt: null
      })),
      checkpoints: [{ at: nowIso, status: wf.requiresApproval ? 'waiting_for_approval' : 'queued', note: 'run created' }],
      approval: wf.requiresApproval ? makeApproval('workflow', null, null, sha256(canonical(parsedInputs))) : null,
      taskRef: null,
      deadlineAt: null,
      currentStepId: null,
      createdAt: nowIso,
      updatedAt: nowIso,
      startedAt: null,
      finishedAt: null,
      error: null,
      verification: null,
      report: null,
      notification: { delivered: false, provider: 'none', reason: 'not sent' }
    };
    await save(run);

    if (audit) await audit.record({
      action: 'workflow.create',
      actor: run.createdBy,
      target: run.id,
      outcome: 'info',
      meta: { workflow: wf.id, version: wf.version, steps: steps.length, permissionClass: wf.permissionClass, source: run.source, requiresApproval: wf.requiresApproval }
    });
    if (wf.requiresApproval && audit) {
      await audit.record({ action: 'workflow.approval_required', actor: run.createdBy, target: run.id, outcome: 'pending', meta: { scope: 'workflow', expiresAt: run.approval.expiresAt } });
    }
    return { run, replayed: false };
  }

  /* ----------------------------------------------------------- executor */

  async function markStep(run, runStep, patch) {
    Object.assign(runStep, patch);
    await save(run);
  }

  function buildExecutor(run, wf, actor) {
    return async function executor(taskStep) {
      const index = Number(String(taskStep.id).replace(/^s/, '')) - 1;
      const runStep = run.steps[index];
      if (!runStep) throw new ValidationError('Step mapping error.');

      /* Fresh cooperative checks at every step boundary. */
      const fresh = await storage.workflowRuns.get(run.id);
      if (fresh && fresh.status === 'cancelled') {
        const e = new ConflictError('Run cancelled.');
        e.retryable = false;
        throw e;
      }
      /* Pause: the current step finishes, the next one waits here (bounded by
         the run deadline), so state stays truthful and resumable. */
      while (fresh && fresh.status === 'paused') {
        if (clock() > Date.parse(run.deadlineAt || iso())) {
          const e = new TimeoutError('Run deadline exceeded while paused.');
          e.retryable = false;
          throw e;
        }
        await sleep(100);
        const r2 = await storage.workflowRuns.get(run.id);
        if (!r2 || r2.status === 'cancelled') {
          const e = new ConflictError('Run cancelled.');
          e.retryable = false;
          throw e;
        }
        if (r2.status !== 'paused') break;
      }

      if (clock() > Date.parse(run.deadlineAt || iso())) {
        const e = new TimeoutError('Run deadline exceeded.');
        e.retryable = false;
        throw e;
      }

      await markStep(run, runStep, { status: 'running', startedAt: iso(), attempts: taskStep.attempts || 1 });
      run.currentStepId = runStep.id;
      await save(run);

      /* Argument resolution from validated inputs + verified step results. */
      const resolved = interpolate(runStep.argsTemplate, { inputs: run.inputs, steps: run.steps });
      const argsHash = sha256(canonical(resolved));

      /* Defence in depth: the tool must be registered AND declared for this
         workflow's step. Unknown/unauthorized tools are denied here even if a
         definition were somehow tampered with in storage. */
      const wfDef = wfRegistry.get(`${run.workflowId}@${run.workflowVersion}`) || wfRegistry.get(run.workflowId);
      if (!wfDef || !wfDef.tools.includes(runStep.tool)) {
        const e = new ToolDeniedError(`Tool "${runStep.tool}" is not permitted for this workflow.`);
        e.retryable = false;
        await markStep(run, runStep, { status: 'failed', error: boundedMessage(e), finishedAt: iso() });
        throw e;
      }
      const toolDef = tools.get(runStep.tool);
      if (!toolDef || !toolDef.enabled) {
        const e = new NotFoundError(`Tool "${runStep.tool}" is not available.`);
        e.retryable = false;
        await markStep(run, runStep, { status: 'failed', error: boundedMessage(e), finishedAt: iso() });
        throw e;
      }

      /* ---- confirmation decision (backend code; a model reply is irrelevant)
         1. a workflow-level admin approval, still valid for THESE inputs
         2. a step-level admin approval, still valid for THESE exact arguments
         3. the one approved automatic-write policy (create-only tools) */
      let confirmed = false;
      let approvalSource = null;
      const ap = run.approval;
      const workflowScoped = ap && ap.scope === 'workflow' && ap.argsHash === sha256(canonical(run.inputs)) && approvalUsable(ap);
      const stepScoped = taskStep.confirmed && ap && ap.scope === 'step' && ap.stepId === runStep.id && ap.argsHash === argsHash && approvalUsable(ap);
      if (workflowScoped) { confirmed = true; approvalSource = 'workflow'; }
      else if (stepScoped) { confirmed = true; approvalSource = 'step'; }
      else if (taskStep.confirmed && ap && ((ap.scope === 'step' && ap.stepId === runStep.id) || ap.scope === 'workflow')) {
        /* Confirmed once, but the window closed or the parameters changed. */
        const e = new ApprovalRequiredError('Approval expired or no longer matches these parameters.');
        e.retryable = false;
        throw e;
      }
      let autoPolicy = false;
      if (!confirmed && toolDef.risk !== 'read' && (wcfg().autoWriteTools || []).includes(toolDef.name)) {
        confirmed = true;
        autoPolicy = true;
      }

      try {
        const result = await tools.invoke(runStep.tool, resolved, { actor, confirmed });
        const bounded = boundResult(result, wcfg().maxResultBytes || 16384);
        if (autoPolicy && audit) {
          await audit.record({
            action: 'workflow.auto_write', actor: run.createdBy, target: run.id, outcome: 'success',
            meta: { tool: toolDef.name, policy: 'approved-automatic-write' }
          });
        }
        await markStep(run, runStep, {
          status: 'done', result: bounded, error: null, finishedAt: iso(),
          approvalSource: approvalSource || (autoPolicy ? 'auto_write_policy' : null)
        });
        if (wfDef.checkpoint) run.checkpoints.push({ at: iso(), status: 'step_done', note: `step ${runStep.id} verified (${runStep.tool})` });
        await save(run);
        if (audit) await audit.record({
          action: 'workflow.step', actor: run.createdBy, target: run.id, outcome: 'success',
          meta: { step: runStep.id, tool: runStep.tool, attempt: taskStep.attempts, optional: runStep.optional }
        });
        return bounded;
      } catch (e) {
        if (e instanceof ApprovalRequiredError) {
          /* Bind the approval to this run, this step and these exact arguments. */
          run.approval = makeApproval('step', run, runStep.id, argsHash);
          run.status = 'running'; // tasks will transition the task; run state fixed in finalize
          await markStep(run, runStep, { status: 'pending', error: null, startedAt: null });
          run.checkpoints.push({ at: iso(), status: 'approval_required', note: `step ${runStep.id} needs approval` });
          await save(run);
          if (audit) await audit.record({ action: 'workflow.approval_required', actor: run.createdBy, target: run.id, outcome: 'pending', meta: { scope: 'step', step: runStep.id, tool: runStep.tool, expiresAt: run.approval.expiresAt } });
          e.retryable = false;
          throw e;
        }

        await markStep(run, runStep, { error: boundedMessage(e), attempts: taskStep.attempts });
        if (audit) await audit.record({
          action: 'workflow.step', actor: run.createdBy, target: run.id, outcome: 'error',
          meta: { step: runStep.id, tool: runStep.tool, attempt: taskStep.attempts, error: e && e.code || 'error' }
        });

        /* Optional steps degrade to "suspected": their failure is evidence, not
           a reason to abort the whole audit. Required steps propagate. */
        if (runStep.optional) {
          await markStep(run, runStep, {
            status: 'done', finishedAt: iso(),
            result: { ok: false, suspected: true, error: boundedMessage(e) },
            error: null
          });
          run.checkpoints.push({ at: iso(), status: 'step_suspected', note: `optional step ${runStep.id} failed: ${boundedMessage(e)}` });
          await save(run);
          if (audit) await audit.record({ action: 'workflow.step', actor: run.createdBy, target: run.id, outcome: 'suspected', meta: { step: runStep.id, tool: runStep.tool } });
          return { ok: false, suspected: true, error: boundedMessage(e) };
        }

        /* Retry eligibility:
           - non-read steps are side effects: retried only if the definition
             declares the tool idempotent for this step;
           - deterministic rejections never retry;
           - transient faults retry within the task manager's bounded budget. */
        const code = e && e.code;
        if (NON_RETRYABLE_CODES.has(code)) e.retryable = false;
        if (toolDef.risk !== 'read' && !runStep.idempotencyKey) e.retryable = false;
        if (e.retryable === undefined && code && !TRANSIENT_CODES.has(code)) e.retryable = false;
        throw e;
      }
    };
  }

  /* ---------------------------------------------------------- finalization */

  function evaluateCriteria(run, wfDef, list) {
    const checks = [];
    for (const c of list) {
      const targets = run.steps.filter((s) =>
        c.step === s.id || (c.step.endsWith('*') && s.id.startsWith(c.step.slice(0, -1))));
      if (!targets.length) {
        checks.push({ step: c.step, ok: false, detail: 'no matching step ran' });
        continue;
      }
      for (const s of targets) {
        for (const [key, expected] of Object.entries(c.expect)) {
          const actual = key === 'status' ? s.status : lookupPath(s.result, key);
          const ok = actual === expected;
          checks.push({ step: s.id, field: key, expected, actual: actual === undefined ? null : actual, ok });
        }
      }
    }
    return checks;
  }

  function buildReport(run, wfDef) {
    const exitCodes = {};
    const paths = [];
    const confirmed = [];
    const suspected = [];
    for (const s of run.steps) {
      const res = s.result;
      if (res && typeof res === 'object' && !res.truncated && typeof res.exitCode === 'number') {
        const suite = (res && res.suite) || s.id;
        exitCodes[suite] = res.exitCode;
      }
      for (const p of [res && res.path, res && res.draftPath, res && res.reportPath]) {
        if (typeof p === 'string' && p.length <= 300) paths.push(p);
      }
      if (s.status === 'failed') {
        confirmed.push({ step: s.id, tool: s.tool, reason: s.error || 'step failed' });
      } else if (s.status === 'done' && res && res.suspected) {
        suspected.push({ step: s.id, tool: s.tool, reason: res.error || 'optional check failed' });
      }
    }
    if (run.verification && run.verification.ok === false) {
      for (const c of run.verification.checks) {
        if (!c.ok) confirmed.push({ step: c.step, reason: `verification failed: ${c.field || 'criteria'} expected ${JSON.stringify(c.expected)}, got ${JSON.stringify(c.actual)}` });
      }
    }
    return { exitCodes, paths, confirmed, suspected };
  }

  async function finalize(run, task, wfDef) {
    let status;
    let error = null;
    let timedOut = false;

    if (!task) { status = 'failed'; error = 'execution did not produce a task result.'; }
    else if (task.status === 'completed') status = 'completed';
    else if (task.status === 'awaiting_approval') status = 'waiting_for_approval';
    else if (task.status === 'cancelled') status = 'cancelled';
    else if (task.status === 'blocked') { status = 'timed_out'; timedOut = true; error = task.error || 'Run deadline exceeded.'; }
    else if (task.status === 'failed') {
      const t = String(task.error || '');
      timedOut = /timed out|deadline exceeded/i.test(t);
      status = timedOut ? 'timed_out' : 'failed';
      error = t || 'A step failed.';
    } else { status = 'failed'; error = `unexpected task state "${task.status}".`; }

    /* Final verification — completion is never claimed before it passes. */
    if (status === 'completed') {
      const successChecks = evaluateCriteria(run, wfDef, wfDef.successCriteria);
      const failureChecks = wfDef.failureCriteria.length ? evaluateCriteria(run, wfDef, wfDef.failureCriteria) : [];
      const successOk = successChecks.every((c) => c.ok);
      const failureHit = failureChecks.some((c) => c.ok);
      run.verification = { ok: successOk && !failureHit, checks: successChecks, failureTriggers: failureChecks };
      run.report = buildReport(run, wfDef);
      if (!successOk) { status = 'failed'; error = 'final verification failed.'; }
      else if (failureHit) { status = 'failed'; error = 'a failure criterion matched.'; }
      else if (wfDef.resultSchema && wfDef.resultSchema.required) {
        const missing = wfDef.resultSchema.required.filter((k) => run.report[k] === undefined);
        if (missing.length) { status = 'failed'; error = `report is missing required fields: ${missing.join(', ')}`; run.verification.ok = false; }
      }
    } else if (run.verification == null) {
      run.verification = { ok: false, checks: [], note: 'run ended before final verification' };
      run.report = buildReport(run, wfDef);
    }

    const firstPending = run.steps.find((s) => s.status !== 'done');
    run.currentStepId = firstPending ? firstPending.id : run.steps.length ? run.steps[run.steps.length - 1].id : null;
    run.status = status;
    run.error = error ? String(error).slice(0, 300) : null;
    if (TERMINAL.has(status)) run.finishedAt = iso();
    run.checkpoints.push({
      at: iso(), status,
      note: status === 'waiting_for_approval' ? 'paused for admin approval' : (run.error || 'run finished')
    });

    if (notifications) {
      run.notification = await notifications.notify({
        type: 'workflow.finished',
        workflow: run.workflowId,
        runId: run.id,
        status,
        durationMs: run.startedAt ? clock() - Date.parse(run.startedAt) : null
      }) || run.notification;
    }

    await save(run);
    if (audit) await audit.record({
      action: status === 'completed' ? 'workflow.complete' : 'workflow.' + status,
      actor: run.createdBy, target: run.id, outcome: status,
      meta: {
        workflow: run.workflowId, version: run.workflowVersion,
        steps: run.steps.length, durationMs: run.startedAt ? clock() - Date.parse(run.startedAt) : null,
        error: run.error
      }
    });
    if (logger && status !== 'completed') logger.warn('workflow_run_' + status, { run: run.id, workflow: run.workflowId, error: run.error });
    return run;
  }

  /* ----------------------------------------------------------- execute */

  async function ensureTask(run, wfDef, actor) {
    if (run.taskRef) {
      const existing = await tasks.get(run.taskRef);
      if (existing) return existing;
    }
    const remainingMs = Math.max(1000, Date.parse(run.deadlineAt) - clock());
    const task = await tasks.create({
      goal: `workflow ${run.workflowId} — ${run.title}`,
      scope: 'workflow',
      createdBy: run.createdBy,
      steps: run.steps.map((s) => ({
        label: s.label,
        tool: s.tool,
        args: {},
        timeoutMs: s.timeoutMs || undefined,
        confirmed: false
      })),
      limits: {
        maxSteps: run.steps.length,
        maxRetries: wfDef.limits.maxRetries || 0,
        timeoutMs: remainingMs,
        backoffBaseMs: wfDef.limits.backoffBaseMs || 150
      }
    });
    run.taskRef = task.id;
    await save(run);
    return task;
  }

  /**
   * Execute (or continue) a run. Single-flight per run id.
   * @returns {Promise<object>} the final run record
   */
  async function execute(runId, { actor } = {}) {
    const run = await get(runId);
    if (!run) throw new NotFoundError('Workflow run not found.');
    if (TERMINAL.has(run.status)) throw new ConflictError('Run already finished.', { status: run.status });
    if (run.status === 'waiting_for_approval') throw new ConflictError('Run is waiting for approval.', { status: run.status, expiresAt: run.approval && run.approval.expiresAt });
    if (run.status === 'paused') throw new ConflictError('Run is paused. Resume it first.', { status: run.status });
    if (inflight.has(runId)) throw new ConflictError('Run is already executing.', { status: 'running' });

    const promise = (async () => {
      const wfDef = wfRegistry.get(`${run.workflowId}@${run.workflowVersion}`) || wfRegistry.get(run.workflowId);
      if (!wfDef) throw new NotFoundError('Workflow definition is no longer registered.');

      if (!run.deadlineAt) run.deadlineAt = new Date(clock() + (wfDef.limits.timeoutMs || wcfg().defaultTimeoutMs)).toISOString();
      run.status = 'running';
      run.startedAt = run.startedAt || iso();
      run.checkpoints.push({ at: iso(), status: 'running', note: 'execution started' });
      await save(run);
      if (audit) await audit.record({ action: 'workflow.execute', actor: run.createdBy, target: run.id, outcome: 'info', meta: { workflow: run.workflowId, source: run.source } });

      let task;
      try {
        task = await ensureTask(run, wfDef, actor);
        task = await tasks.run(task.id, buildExecutor(run, wfDef, actor));
      } catch (e) {
        if (TERMINAL.has(run.status)) return run; // cancelled mid-flight
        run.status = 'failed';
        run.error = boundedMessage(e);
        run.finishedAt = iso();
        run.checkpoints.push({ at: iso(), status: 'failed', note: run.error });
        await save(run);
        if (audit) await audit.record({ action: 'workflow.failed', actor: run.createdBy, target: run.id, outcome: 'failed', meta: { workflow: run.workflowId, error: e && e.code || 'error' } });
        return run;
      }
      return finalize(run, task, wfDef);
    })();

    inflight.set(runId, promise);
    try { return await promise; } finally { inflight.delete(runId); }
  }

  /* --------------------------------------------------- approval / control */

  async function approve(runId, { token, actor } = {}) {
    /* Raw read (no sweep): an expired window must surface as approval_expired
       here, not as a generic conflict from an auto-failed run. */
    const run = await storage.workflowRuns.get(runId);
    if (!run) throw new NotFoundError('Workflow run not found.');
    if (run.status !== 'waiting_for_approval') throw new ConflictError('Run is not waiting for approval.', { status: run.status });
    const ap = run.approval;
    if (!ap) throw new ConflictError('Run has no pending approval.');
    if (approvalExpired(ap)) {
      run.status = 'failed';
      run.error = 'approval expired';
      run.finishedAt = iso();
      run.checkpoints.push({ at: iso(), status: 'approval_expired', note: 'approval window elapsed' });
      await save(run);
      if (audit) await audit.record({ action: 'workflow.approval_expired', actor: actor && actor.id, target: run.id, outcome: 'failed', meta: { workflow: run.workflowId } });
      throw new AppError('approval_expired', 'This approval request expired. Start a new run.', 409, { expiresAt: ap.expiresAt });
    }
    /* The token binds the approval to THIS run/step/arguments; no parameters
       can be supplied here, so a confirmation can never be re-pointed. */
    if (!token || typeof token !== 'string' || token !== ap.token) {
      if (audit) await audit.record({ action: 'workflow.approve_denied', actor: actor && actor.id, target: run.id, outcome: 'deny', meta: { reason: 'missing or invalid approval token' } });
      throw new ForbiddenError('A valid approval token is required.');
    }
    ap.approvedBy = (actor && actor.id) || 'unknown';
    ap.approvedAt = iso();
    run.status = 'queued';
    run.checkpoints.push({ at: iso(), status: 'queued', note: `approved by ${ap.approvedBy} (expires ${ap.expiresAt})` });
    await save(run);

    if (run.taskRef) {
      const task = await tasks.get(run.taskRef);
      if (task && task.status === 'awaiting_approval') await tasks.approve(run.taskRef, actor);
    }
    if (audit) await audit.record({ action: 'workflow.approve', actor: ap.approvedBy, target: run.id, outcome: 'success', meta: { workflow: run.workflowId, scope: ap.scope, step: ap.stepId } });
    return run;
  }

  async function pause(runId, actor) {
    const run = await get(runId);
    if (!run) throw new NotFoundError('Workflow run not found.');
    if (TERMINAL.has(run.status)) throw new ConflictError('Run already finished.');
    if (run.status === 'paused') return run;
    const prev = run.status;
    run.status = 'paused';
    run.checkpoints.push({ at: iso(), status: 'paused', note: `paused by ${actor && actor.id || 'unknown'} (was ${prev})` });
    await save(run);
    if (audit) await audit.record({ action: 'workflow.pause', actor: actor && actor.id, target: run.id, outcome: 'info', meta: { from: prev } });
    return run;
  }

  async function resume(runId, actor) {
    const run = await get(runId);
    if (!run) throw new NotFoundError('Workflow run not found.');
    if (run.status !== 'paused') throw new ConflictError('Run is not paused.', { status: run.status });
    if (run.approval && !run.approval.approvedBy && approvalExpired(run.approval)) {
      throw new AppError('approval_expired', 'The approval request expired while paused. Start a new run.', 409, { expiresAt: run.approval.expiresAt });
    }
    run.status = (run.approval && !run.approval.approvedBy) ? 'waiting_for_approval' : (run.taskRef ? 'queued' : 'queued');
    run.checkpoints.push({ at: iso(), status: run.status, note: `resumed by ${actor && actor.id || 'unknown'}` });
    await save(run);
    if (audit) await audit.record({ action: 'workflow.resume', actor: actor && actor.id, target: run.id, outcome: 'info', meta: { to: run.status } });
    return run;
  }

  async function cancel(runId, actor) {
    const run = await get(runId);
    if (!run) throw new NotFoundError('Workflow run not found.');
    if (TERMINAL.has(run.status)) throw new ConflictError('Run already finished.', { status: run.status });
    run.status = 'cancelled';
    run.finishedAt = iso();
    run.error = null;
    run.checkpoints.push({ at: iso(), status: 'cancelled', note: `cancelled by ${actor && actor.id || 'unknown'}` });
    await save(run);
    if (run.taskRef) {
      try {
        const task = await tasks.get(run.taskRef);
        if (task && !['completed', 'failed', 'cancelled'].includes(task.status)) await tasks.cancel(run.taskRef, actor);
      } catch (e) { if (logger) logger.warn('workflow_cancel_task_failed', { run: run.id, message: e && e.message }); }
    }
    if (audit) await audit.record({ action: 'workflow.cancel', actor: actor && actor.id, target: run.id, outcome: 'cancelled', meta: { workflow: run.workflowId } });
    return run;
  }

  /* ------------------------------------------------------------ reporting */

  /** Client-facing progress + results (no secrets, bounded sizes). */
  function reportView(run) {
    if (!run) return null;
    const done = run.steps.filter((s) => s.status === 'done').length;
    const pendingApproval = run.status === 'waiting_for_approval' && run.approval && !run.approval.approvedBy
      ? { scope: run.approval.scope, step: run.approval.stepId, expiresAt: run.approval.expiresAt, token: run.approval.token }
      : null;
    return {
      run: {
        id: run.id,
        workflow: run.workflowId,
        workflowVersion: run.workflowVersion,
        title: run.title,
        status: run.status,
        currentStepId: run.currentStepId,
        currentStepLabel: (run.steps.find((s) => s.id === run.currentStepId) || {}).label || null,
        progress: { completed: done, total: run.steps.length },
        source: run.source,
        createdBy: run.createdBy,
        createdAt: run.createdAt,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        durationMs: run.startedAt ? (Date.parse(run.finishedAt || new Date().toISOString()) - Date.parse(run.startedAt)) : null,
        error: run.error,
        approval: pendingApproval
      },
      steps: run.steps.map((s) => ({
        id: s.id, label: s.label, tool: s.tool, status: s.status,
        attempts: s.attempts, optional: s.optional,
        approvalSource: s.approvalSource || null,
        startedAt: s.startedAt, finishedAt: s.finishedAt,
        durationMs: s.startedAt && s.finishedAt ? Date.parse(s.finishedAt) - Date.parse(s.startedAt) : null,
        exitCode: s.result && typeof s.result === 'object' && typeof s.result.exitCode === 'number' ? s.result.exitCode : null,
        suspected: !!(s.result && s.result.suspected),
        error: s.error,
        result: s.result
      })),
      verification: run.verification,
      report: run.report,
      notification: run.notification,
      checkpoints: run.checkpoints
    };
  }

  /* ------------------------------------------- lifecycle: recovery + sweep */

  /** Mark runs interrupted by a restart as resumable (never auto-resume). */
  async function recover() {
    const all = await listRuns();
    let recovered = 0;
    for (const run of all) {
      if (run.status === 'running' || (run.status === 'queued' && run.taskRef)) {
        run.status = 'paused';
        run.checkpoints.push({ at: iso(), status: 'paused', note: 'recovered after backend restart — resume explicitly' });
        await save(run);
        recovered++;
        if (audit) await audit.record({ action: 'workflow.recover', actor: 'system', target: run.id, outcome: 'info', meta: { workflow: run.workflowId, previous: 'running' } });
      }
    }
    if (recovered && logger) logger.warn('workflow_runs_recovered', { count: recovered });
    return recovered;
  }

  return {
    RUN_STATES, TERMINAL_STATES: Array.from(TERMINAL),
    createRun, execute, approve, pause, resume, cancel,
    get, listRuns, reportView, recover,
    availability: (id) => {
      const wf = wfRegistry.get(id);
      if (!wf) return null;
      return Object.assign({ id: wf.id, version: wf.version }, wfRegistry.availability(wf, { providers, tools }));
    },
    listWorkflows: () => wfRegistry.list().map((w) => Object.assign({}, w, wfRegistry.availability(wfRegistry.get(w.id) || w, { providers, tools }))),
    activeCount: (filter) => countActive(filter),
    /** Validate inputs for a workflow without creating a run (scheduler/preview). */
    validateInputs: (workflowId, inputs) => {
      const wf = wfRegistry.get(workflowId);
      if (!wf) throw new NotFoundError(`Unknown workflow "${workflowId}".`);
      return wfRegistry.applyInputs(wf.inputs, inputs);
    },
    /** test/ops helper: runs whose approval window has elapsed */
    sweepExpiredApprovals: async () => {
      const all = await listRuns();
      for (const r of all) await sweepApproval(r);
    }
  };
}

module.exports = { createWorkflowEngine, RUN_STATES, TERMINAL, canonical, interpolate, boundResult };
