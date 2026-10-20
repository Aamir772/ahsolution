# JARVIS — Bounded Autonomy: Workflows, Approvals & Scheduling (Milestone 5)

Status: **complete** (backend, tests, docs). This document is the operator
reference for Milestone 5 of the JARVIS assistant
(`server/workflows/`, `server/scheduler.js`, `server/notifications.js`).

---

## 1. What this milestone adds

- A **workflow registry** of named, versioned, bounded automations with
  declared inputs, steps, tool allowlists, limits and (optional) approval
  requirements.
- A **workflow engine** that executes runs as first-class records inside the
  existing task system, with honest progress, verification, reports and
  recovery — never silent success.
- **Approval gates** (workflow-scope and per-write-step) with single-use,
  argument-bound, TTL-limited tokens, admin-only over HTTP.
- A **single-instance scheduler**: persisted daily/interval schedules, explicit
  enable, slot-keyed idempotent firing, misfire policy, per-day limits, bounded
  retries, pause/resume/enable/disable/delete, run-now.
- **Honest notifications**: when no provider is configured, results report
  `delivered: false` with a reason — never a fabricated send.

Constraints that shaped the design (per the milestone brief):

- No arbitrary model-generated shell commands — steps may only invoke
  registered, allowlisted tools.
- Unsupported capability is **marked clearly**, not faked:
  `approved-file-change` exists as a definition but reports
  `501 workflow_unsupported` (no patch/apply tool in this milestone).
- Web/generated content is **untrusted data** flowing through steps, never
  instructions to the engine.
- Scheduler is **single-instance** (no distributed lease) — documented here,
  in `.env.example`, and in the `/api/scheduler` response itself.
- No production recurring jobs are created by default; nothing fires without
  `enabled=true` **and** `AH_SCHEDULER_ENABLED=1`.

---

## 2. Built-in workflows

| id | class | approval | summary |
|----|-------|----------|---------|
| `website-qa` | read | no | backend + agent health, then the registered QA suites via `qa_run`, consolidating real exit codes |
| `website-health-audit` | read | no | read routes, structural metadata/link checks, optional browser console pass; outputs confirmed vs **suspected** evidence |
| `blog-draft-production` | write | yes | model draft → structural/editorial checks → **create-only** save marked UNREVIEWED (never publishes, never touches the sitemap) |
| `approved-file-change` | write | yes | **unsupported by design** — `501 workflow_unsupported` until a patch/apply tool exists |

Availability is always reported honestly: `GET /api/workflows` items carry
top-level `ok`/`reason` (e.g. model missing, tool not registered, workflows
disabled via `AH_ENABLE_WORKFLOWS=0`).

## 3. Execution model

- `POST /api/workflows/:id/run` validates inputs, enforces the per-workflow
  active-run limit and the global `AH_WORKFLOW_MAX_CONCURRENT`, then executes
  in the background. The response is the **run view** (see §5) plus
  `replayed: true` when an `idempotencyKey` matched an existing run.
- Steps run through `server/tasks.js` (same executor as plain tasks): bounded
  retries with exponential backoff, per-step `timeoutMs`, whole-run
  `AH_WORKFLOW_TIMEOUT_MS` deadline.
  - **Transient** errors retry: timeout, agent_busy, provider_error,
    rate_limited.
  - **Deterministic** errors do not: invalid_request, tool_denied, forbidden,
    not_found, auth_required, approval_required, conflict,
    workflow_unsupported… Write-class steps never auto-retry.
- `argsTemplate` interpolation supports only `${inputs.<path>}` and
  `${steps.<stepId>.<path>}` — no code evaluation. Results and content are
  data.
- Optional steps that fail degrade the run to **suspected** evidence instead
  of failing it; final verification (`verification.ok`) can fail an otherwise
  completed run — both are surfaced, never smoothed over.
- Pause is cooperative (takes effect at the next step boundary); `resume`
  continues from `checkpoints`. On restart, `recover()` marks interrupted
  `queued/running` runs as `paused` and does **not** auto-resume them.
- A tampered step (tool changed after registration) is denied at execution
  time — defence in depth on top of registration-time allowlists.

## 4. Approvals

- **Workflow-scope**: write-class runs stop with `waiting_for_approval`;
  the view exposes a single-use token bound to `run + step + sha256(canonical
  args) + expiry`. Only an admin may approve; the token is stripped from views
  for non-admins.
- **Step-scope**: unconfirmed write-class steps (tool not in
  `AH_WORKFLOW_AUTO_WRITE_TOOLS`, default `draft_write` only) pause the run
  until an admin confirms the step via the same approve endpoint.
- Tokens expire after `AH_WORKFLOW_APPROVAL_TTL_MS` (default 15 min). An
  expired run fails honestly with `approval expired`; approving an expired
  window returns `409 approval_expired`.
- Wrong/run-mismatched/second-use tokens are refused (constant-time compare).

## 5. Run view (what HTTP returns)

Routes return the view object directly (plus `replayed` on creation):

```
{ run: { id, workflow, workflowVersion, status, progress: {completed,total},
         source, createdBy, createdAt, startedAt, finishedAt, durationMs,
         error, approval },        // approval.token admin-only
  steps: [ { id, label, tool, status, attempts, optional, approvalSource,
             startedAt, finishedAt, durationMs, exitCode, suspected,
             error, result } ],
  verification,                    // final checks, honest ok/mismatches
  report,                          // exitCodes, paths, notifications…
  checkpoints, notification }      // notification: delivered:false + reason
                                   // when no provider is configured
}
```

Statuses: `queued → running → waiting_for_approval? → completed | failed |
cancelled | timed_out | paused`. The engine's `run.status` is the single
source of truth.

## 6. HTTP surface

Workflows (auth required; run creation of write-class workflows is
admin-only):

```
GET    /api/workflows                 registry + honest ok/reason (public)
GET    /api/workflows/runs            run list (auth)
GET    /api/workflows/:id             one workflow + availability
POST   /api/workflows/:id/run         start (idempotencyKey optional)
GET    /api/workflows/runs/:id        run view
POST   /api/workflows/runs/:id/approve   admin + token
POST   /api/workflows/runs/:id/cancel    auth
POST   /api/workflows/runs/:id/pause     auth
POST   /api/workflows/runs/:id/resume    auth
```

Scheduler (all admin):

```
GET    /api/scheduler                 loop state + jobs
POST   /api/scheduler                 create (note: disabled by default)
GET    /api/scheduler/:id             one job
POST   /api/scheduler/:id/pause|resume|enable|disable
POST   /api/scheduler/:id/run-now     fire once immediately (source: manual)
DELETE /api/scheduler/:id             delete
```

Chat intents: "run/start the website QA/health audit workflow" starts a run;
"status of the workflow/run" reports the latest run honestly (signed-in
users). The M4 direct QA intent ("Run the website page QA.") still wins when
no workflow word is present.

## 7. Scheduler

- Defaults: `AH_SCHEDULER_ENABLED=0`, every job `enabled=false` — **two
  explicit opt-ins** before anything recurs. No production recurring jobs are
  provisioned by this milestone.
- Recurrence: `daily` at local `HH:MM` in `AH_SCHEDULER_TZ`, or `interval`
  (`everyMinutes` 5..14400, optional future `startAt`).
- **Idempotent firing**: each firing is keyed `sched:<jobId>:<slotISO>`
  (retries `:rN`) and passed to the engine as an idempotency key — a double
  tick, restart or replay can never start the same slot twice.
- **Misfire**: slots later than `AH_SCHEDULER_MISFIRE_GRACE_MS` (5 min) are
  `skip`ped (recorded as `misfired`) or, with `run-once`, one catch-up run.
- `maxRunsPerDay` buckets executions per timezone day; exceeding it records
  `limit_reached` and moves on.
- **Budget**: `AH_SCHEDULER_MAX_CONCURRENT` (3) scheduled runs active per
  tick; extra jobs stay due and fire on a later tick inside the misfire window.
- **Retries**: failed/timed-out scheduled runs retry up to `maxRetries` (≤3)
  with exponential backoff (60s·2ⁿ, 1h cap), each attempt keyed `:rN`.
- History: per-job bounded history (`AH_SCHEDULER_MAX_HISTORY`) with honest
  outcomes: `started`, `failed`, `misfired`, `limit_reached`,
  `retry_started`, `skipped`, `replayed`.
- Loop: `scheduler.start()` is only called from `server/index.js main()` when
  `AH_SCHEDULER_ENABLED=1`; `stop()` on shutdown. Manual ticks
  (`scheduler.tick(atMs)`) are available for ops and tests.
- **Honest limitation**: single instance, no lease/leader election — two
  processes on separate storage could double-fire.

## 8. Notifications

`server/notifications.js` reports `delivered: false` with
`reason: 'no notification provider configured'` until a provider is wired.
No code path claims a notification was sent when it was not.

## 9. Configuration

See `server/.env.example` (sections "bounded workflow automation" and
"scheduler") for all variables with descriptions: `AH_ENABLE_WORKFLOWS`,
`AH_WORKFLOW_MAX_CONCURRENT`, `AH_WORKFLOW_TIMEOUT_MS`,
`AH_WORKFLOW_APPROVAL_TTL_MS`, `AH_WORKFLOW_AUTO_WRITE_TOOLS`,
`AH_WORKFLOW_MAX_RESULT_BYTES`, `AH_SCHEDULER_ENABLED`, `AH_SCHEDULER_TICK_MS`,
`AH_SCHEDULER_TZ`, `AH_SCHEDULER_MISFIRE_*`, `AH_SCHEDULER_MAX_CONCURRENT`,
`AH_SCHEDULER_MAX_HISTORY`.

## 10. Tests

- `server/test/workflows-registry.test.js` — strict registration/validation,
  object inputs, versioning, availability honesty.
- `server/test/workflows.test.js` — execution, idempotency, concurrency,
  default-deny permissions, both approval types + expiry, pause/resume/cancel,
  retry semantics, optional/suspected degradation, verification failure,
  tamper defence, 501 unsupported, restart recovery, notification honesty,
  HTTP routes, chat intents, blog-draft end-to-end (mock model).
- `server/test/scheduler.test.js` — validation, default-off, slot idempotency,
  misfire policies, daily limits, interval math, bounded retries,
  pause/resume/enable/disable/delete, concurrency budget, admin HTTP API.

Run everything with `npm run assistant:test`.
