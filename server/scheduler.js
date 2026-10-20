'use strict';
/* ==========================================================================
   server/scheduler.js — timezone-aware, persisted workflow scheduler

   Explicit by design:
     * schedules are persisted (storage.schedules) and survive restarts
     * every job must be explicitly enabled — nothing recurs by default, and
       the background loop only runs when AH_SCHEDULER_ENABLED=1
     * duplicate-run prevention: each firing is keyed by (schedule id, slot)
       and passed to the workflow engine as an idempotency key, so a restart,
       a double tick or a replay can never start the same slot twice
     * misfire policy per job: 'skip' (default) or 'run-once', with a grace
       window; late fires are recorded in history either way
     * per-job limits: maxRunsPerDay, bounded retries with exponential backoff,
       pause/resume/disable/delete, run history and next-run visibility
     * the engine counts scheduler-created runs against maxConcurrentJobs

   Honest limitation: this is a SINGLE-INSTANCE scheduler. There is no
   distributed lease/leader election; running two server processes against
   separate storage could double-fire. See reference/jarvis-workflows.md.
   ========================================================================= */
'use strict';

const { newId } = require('./storage');
const { ValidationError, NotFoundError, ConflictError, AppError } = require('./errors');

const DAILY_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MAX_RETRIES = 3;

function tzValid(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (e) { return false; }
}

function tzParts(tz, ms) {
  const dtf = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const p = {};
  for (const { type, value } of dtf.formatToParts(ms)) p[type] = value;
  const h = Number(p.hour);
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: h === 24 ? 0 : h, min: Number(p.minute) };
}

/** Next occurrence of local HH:MM in `tz` strictly after `afterMs`. */
function nextDaily(tz, at, afterMs) {
  const [hh, mm] = at.split(':').map(Number);
  for (let i = 0; i < 5; i++) {
    const probe = afterMs + i * 86400000;
    const p = tzParts(tz, probe);
    // Offset of `tz` around that local day (stable within ±1 day for all real zones).
    const noon = Date.UTC(p.y, p.m - 1, p.d, 12, 0, 0);
    const w = tzParts(tz, noon);
    const off = Date.UTC(w.y, w.m - 1, w.d, w.h, w.min) - noon;
    const cand = Date.UTC(p.y, p.m - 1, p.d, hh, mm) - off;
    if (cand > afterMs) return new Date(cand).toISOString();
  }
  return null;
}

function nextInterval(everyMinutes, startAt, afterMs) {
  const every = everyMinutes * 60000;
  if (startAt) {
    const s = Date.parse(startAt);
    if (Number.isNaN(s)) throw new ValidationError('startAt must be an ISO date/time.');
    if (s > afterMs) return new Date(s).toISOString();
    const n = Math.ceil((afterMs - s) / every);
    return new Date(s + n * every).toISOString();
  }
  return new Date(afterMs + every).toISOString();
}

function computeNext(job, afterMs) {
  if (job.recurrence.kind === 'daily') return nextDaily(job.tz, job.recurrence.at, afterMs);
  return nextInterval(job.recurrence.everyMinutes, job.startAt, afterMs);
}

/** Slot key → day bucket in the job timezone (for maxRunsPerDay). */
function dayKey(tz, ms) {
  const p = tzParts(tz, ms);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/**
 * @param {object} deps
 * @param {object} deps.cfg
 * @param {ReturnType<import('./storage').createStorage>} deps.storage
 * @param {object} deps.audit
 * @param {object} deps.logger
 * @param {object} deps.engine  workflow engine (createRun/execute/get/activeCount/validateInputs)
 * @param {()=>number} [deps.now]
 */
function createScheduler({ cfg, storage, audit, logger, engine, now }) {
  const clock = typeof now === 'function' ? now : () => Date.now();
  const scfg = cfg.scheduler;
  let timer = null;

  const iso = () => new Date(clock()).toISOString();
  const save = async (job) => { job.updatedAt = iso(); await storage.schedules.save(job); return job; };

  function pushHistory(job, entry) {
    job.history = job.history || [];
    job.history.push(Object.assign({ at: iso() }, entry));
    const max = scfg.maxHistory || 50;
    if (job.history.length > max) job.history = job.history.slice(job.history.length - max);
  }

  function auditRec(action, job, outcome, meta) {
    if (audit) return audit.record({ action, actor: job.createdBy, target: job.id, outcome, meta: meta || {} });
  }

  /* ------------------------------------------------------------- CRUD */

  async function createJob({ workflowId, args, recurrence, tz, startAt, misfirePolicy, misfireGraceMs, maxRunsPerDay, maxRetries, enabled, createdBy }) {
    if (!workflowId || !engine.availability(workflowId)) throw new NotFoundError(`Unknown workflow "${workflowId}".`);
    const avail = engine.availability(workflowId);
    if (!avail.ok) throw new AppError('workflow_unsupported', `Workflow "${workflowId}" cannot be scheduled: ${avail.reason}.`, 501, { reason: avail.reason });

    if (!recurrence || typeof recurrence !== 'object') throw new ValidationError('recurrence is required ({kind:"daily",at:"HH:MM"} or {kind:"interval",everyMinutes:N}).');
    let rec;
    if (recurrence.kind === 'daily') {
      if (!DAILY_RE.test(String(recurrence.at || ''))) throw new ValidationError('daily recurrence needs at="HH:MM" (24h local time).');
      rec = { kind: 'daily', at: recurrence.at };
    } else if (recurrence.kind === 'interval') {
      const n = Number(recurrence.everyMinutes);
      if (!Number.isInteger(n) || n < 5 || n > 14400) throw new ValidationError('interval recurrence needs everyMinutes between 5 and 14400.');
      rec = { kind: 'interval', everyMinutes: n };
    } else {
      throw new ValidationError('recurrence.kind must be "daily" or "interval".');
    }

    const zone = tz || scfg.timezone;
    if (!tzValid(zone)) throw new ValidationError(`"${zone}" is not a valid IANA timezone.`);
    const policy = misfirePolicy || scfg.misfirePolicy;
    if (!['skip', 'run-once'].includes(policy)) throw new ValidationError('misfirePolicy must be "skip" or "run-once".');
    const retries = maxRetries === undefined ? 0 : maxRetries;
    if (!Number.isInteger(retries) || retries < 0 || retries > MAX_RETRIES) throw new ValidationError(`maxRetries must be 0..${MAX_RETRIES}.`);
    const perDay = maxRunsPerDay === undefined ? 0 : maxRunsPerDay;
    if (!Number.isInteger(perDay) || perDay < 0 || perDay > 100) throw new ValidationError('maxRunsPerDay must be 0..100.');
    if (startAt !== undefined && startAt !== null && Number.isNaN(Date.parse(startAt))) throw new ValidationError('startAt must be an ISO date/time.');
    if (args !== undefined && args !== null) engine.validateInputs(workflowId, args); // fail early on bad parameters

    const nowMs = clock();
    const job = {      id: newId('sched'),
      workflowId,
      args: args ? JSON.parse(JSON.stringify(args)) : {},
      recurrence: rec,
      tz: zone,
      startAt: startAt || null,
      misfirePolicy: policy,
      misfireGraceMs: Number.isFinite(misfireGraceMs) ? misfireGraceMs : scfg.misfireGraceMs,
      maxRunsPerDay: perDay,
      maxRetries: retries,
      retryBackoffMs: 60000,
      enabled: !!enabled, // explicit opt-in: an un-enabled job never fires
      paused: false,
      createdBy: createdBy || 'unknown',
      createdAt: iso(),
      updatedAt: iso(),
      nextRunAt: null,
      lastRunId: null,
      lastSlotKey: null,
      retryAttempt: 0,
      pendingRetry: null,
      runCount: 0,
      history: []
    };
    /* First firing: an explicit future startAt wins; otherwise the next
       occurrence of the recurrence from now. */
    job.nextRunAt = (job.startAt && Date.parse(job.startAt) > nowMs)
      ? new Date(Date.parse(job.startAt)).toISOString()
      : computeNext(job, nowMs);
    await save(job);
    await auditRec('scheduler.create', job, 'info', { workflow: workflowId, recurrence: rec, enabled: job.enabled, nextRunAt: job.nextRunAt });
    return job;
  }

  const listJobs = () => storage.schedules.list();
  async function getJob(id) {
    if (typeof id !== 'string' || !id) return null;
    return storage.schedules.get(id);
  }

  async function setFlag(id, patch, action, actor) {
    const job = await getJob(id);
    if (!job) throw new NotFoundError('Schedule not found.');
    if (patch.enabled !== undefined && !job.enabled && patch.enabled) {
      // re-enable: recompute a fresh next run instead of firing a backlog
      patch.nextRunAt = computeNext(job, clock());
    }
    if (patch.paused === false && job.paused) {
      patch.nextRunAt = computeNext(job, clock()); // resume without a catch-up burst
    }
    Object.assign(job, patch);
    await save(job);
    await auditRec(`scheduler.${action}`, job, 'info', { actor: actor && actor.id });
    return job;
  }

  async function deleteJob(id, actor) {
    const job = await getJob(id);
    if (!job) throw new NotFoundError('Schedule not found.');
    await storage.schedules.delete(id);
    await auditRec('scheduler.delete', job, 'info', { actor: actor && actor.id, workflow: job.workflowId });
    return job;
  }

  /* -------------------------------------------------------------- tick */

  async function fireRun(job, key, actor, kind) {
    const { run, replayed } = await engine.createRun({
      workflowId: job.workflowId,
      inputs: job.args || {},
      actor,
      idempotencyKey: key,
      source: 'scheduler'
    });
    job.lastRunId = run.id;
    job.lastSlotKey = key;
    if (!replayed) job.runCount = (job.runCount || 0) + 1;
    if (!replayed) {
      /* Execute in the background; failures are visible on the run record and
         in history — the scheduler never claims a run succeeded. */
      engine.execute(run.id, { actor }).catch((e) => {
        if (logger) logger.warn('scheduled_run_failed', { job: job.id, run: run.id, message: e && e.message });
      });
    }
    return { run, replayed };
  }

  /**
   * Evaluate all schedules against `atMs` (default: now).
   * Safe to call manually (tests, ops) and from the interval loop.
   */
  async function tick(atMs) {
    const nowMs = Number.isFinite(atMs) ? atMs : clock();
    const jobs = (await listJobs()).slice().sort((a, b) => String(a.nextRunAt || '').localeCompare(String(b.nextRunAt || '')));
    const active = await engine.activeCount((r) => r.source === 'scheduler');
    let budget = Math.max(0, scfg.maxConcurrentJobs - active);
    const fired = [];
    const skipped = [];

    for (const job of jobs) {
      if (!job.enabled || job.paused) continue;

      /* --- bounded retry of a failed scheduled run ------------------- */
      const retryAtMs = job.pendingRetry ? (Number.isFinite(job.pendingRetry.retryAt) ? job.pendingRetry.retryAt : Date.parse(job.pendingRetry.retryAt)) : NaN;
      if (job.pendingRetry && retryAtMs <= nowMs) {
        if (budget <= 0) { skipped.push({ jobId: job.id, reason: 'max_concurrent_jobs' }); continue; }
        const key = `${job.pendingRetry.baseKey}:r${job.pendingRetry.attempt}`;
        try {
          const actor = { type: 'scheduler', id: `schedule:${job.id}` };
          const { run, replayed } = await fireRun(job, key, actor, 'retry');
          job.pendingRetry = null;
          pushHistory(job, { slot: job.lastSlotKey, runId: run.id, outcome: 'retry_started', attempt: key.split(':r').pop(), replayed });
          await save(job);
          await auditRec('scheduler.retry', job, 'info', { runId: run.id });
          budget--;
          fired.push({ jobId: job.id, runId: run.id, kind: 'retry' });
        } catch (e) {
          job.pendingRetry = null;
          pushHistory(job, { outcome: 'retry_failed', reason: e && e.code || 'error' });
          await save(job);
          skipped.push({ jobId: job.id, reason: e && e.code || 'error' });
        }
        continue;
      }

      if (!job.nextRunAt) {
        job.nextRunAt = computeNext(job, nowMs);
        await save(job);
        continue;
      }
      const slotMs = Date.parse(job.nextRunAt);
      if (Number.isNaN(slotMs)) { job.enabled = false; await save(job); continue; }
      if (slotMs > nowMs) continue;

      const grace = Number.isFinite(job.misfireGraceMs) ? job.misfireGraceMs : scfg.misfireGraceMs;
      const late = nowMs - slotMs;
      if (late > grace) {
        if (job.misfirePolicy === 'skip') {
          pushHistory(job, { slot: job.nextRunAt, outcome: 'misfired', lateMs: late });
          job.nextRunAt = computeNext(job, nowMs);
          await save(job);
          await auditRec('scheduler.misfire', job, 'info', { slot: new Date(slotMs).toISOString(), policy: 'skip' });
          skipped.push({ jobId: job.id, reason: 'misfire_skipped', slot: job.nextRunAt });
          continue;
        }
        /* run-once: fall through and fire exactly one catch-up run now. */
      }

      /* per-day execution limit for this timezone */
      const bucket = job.maxRunsPerDay > 0 ? dayKey(job.tz, slotMs) : undefined;
      if (job.maxRunsPerDay > 0) {
        const usedToday = (job.history || []).filter((h) => h.outcome === 'started' && h.slotDay === bucket).length;
        if (usedToday >= job.maxRunsPerDay) {
          pushHistory(job, { slot: job.nextRunAt, slotDay: bucket, outcome: 'limit_reached' });
          job.nextRunAt = computeNext(job, nowMs);
          await save(job);
          skipped.push({ jobId: job.id, reason: 'max_runs_per_day' });
          continue;
        }
      }

      if (budget <= 0) {
        /* stay due; the next tick retries within the misfire window */
        skipped.push({ jobId: job.id, reason: 'max_concurrent_jobs' });
        continue;
      }

      const slotIso = job.nextRunAt;
      const key = `sched:${job.id}:${slotIso}`;
      try {
        const actor = { type: 'scheduler', id: `schedule:${job.id}` };
        const { run, replayed } = await fireRun(job, key, actor, 'slot');
        pushHistory(job, { slot: slotIso, slotDay: bucket, runId: run.id, outcome: 'started', replayed });
        if (!replayed) job.retryAttempt = 0;
        /* Advance BEFORE anything else can crash: combined with the
           slot-keyed idempotency key this makes double-firing impossible. */
        job.nextRunAt = computeNext(job, nowMs);
        await save(job);
        await auditRec('scheduler.fire', job, 'info', { slot: slotIso, runId: run.id, replayed });
        budget--;
        fired.push({ jobId: job.id, runId: run.id, slot: slotIso, replayed });
      } catch (e) {
        /* e.g. workflow concurrency limit — keep the slot due and retry next
           tick (the misfire window still applies). */
        pushHistory(job, { slot: slotIso, outcome: 'skipped', reason: e && e.code || 'error' });
        await save(job);
        skipped.push({ jobId: job.id, reason: e && e.code || 'error' });
      }
    }

    /* --- schedule retries for failed scheduled runs ------------------- */
    for (const job of jobs) {
      if (!job.enabled || job.paused || !job.lastRunId || !job.maxRetries) continue;
      if ((job.retryAttempt || 0) >= job.maxRetries) continue;
      if (job.pendingRetry) continue;
      const run = await engine.get(job.lastRunId);
      if (!run || !['failed', 'timed_out'].includes(run.status)) continue;
      const attempt = (job.retryAttempt || 0) + 1;
      const backoff = Math.min(3600000, (job.retryBackoffMs || 60000) * Math.pow(2, attempt - 1));
      job.retryAttempt = attempt;
      job.pendingRetry = { attempt, retryAt: new Date(nowMs + backoff).toISOString(), baseKey: job.lastSlotKey || `sched:${job.id}:manual`, reason: run.error };
      pushHistory(job, { runId: run.id, outcome: 'failed', attempt, retryInMs: backoff, reason: run.error });
      await save(job);
      await auditRec('scheduler.run_failed', job, 'info', { runId: run.id, attempt, retryInMs: backoff });
    }

    return { fired, skipped, at: new Date(nowMs).toISOString() };
  }

  /* ------------------------------------------------- loop lifecycle */

  function start() {
    if (timer) return;
    timer = setInterval(() => {
      tick().catch((e) => { if (logger) logger.warn('scheduler_tick_failed', { message: e && e.message }); });
    }, scfg.tickMs);
    if (timer.unref) timer.unref();
    if (logger) logger.info('scheduler_started', { tickMs: scfg.tickMs, tz: scfg.timezone });
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { createJob, listJobs, getJob, setFlag, deleteJob, tick, start, stop, computeNext: (job, after) => computeNext(job, Number.isFinite(after) ? after : clock()) };
}

module.exports = { createScheduler };
