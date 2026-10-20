# JARVIS — Architecture & Milestone 1 Foundation

Status: **Milestones 1–5 complete** (M1 backend foundation + security design;
M2 reasoning/chat + permissioned tools; M3 voice relay/WebRTC;M4 local-agent
hub + holographic/QA integration; M5 bounded autonomy — workflows, approvals
and scheduling, see `jarvis-workflows.md`). Memory and security-hardening
milestones are planned below but **not** started.
Scope of this document: the hosted assistant backend. It does not change the
existing website or the Netlify functions.

---

## 1. Objective

Build **JARVIS**: a real, working AI assistant for AH Solution that combines a
hosted backend, a configurable cloud/local model, voice, a permission-controlled
tool layer, and a holographic interface tied to the existing V2.2 core — while
preserving everything that already works.

Fixed requirements (from the brief):

- Hybrid cloud AI with an optional local fallback.
- A hosted reasoning backend **plus** a separately-controlled local agent.
- Bounded, predefined workflows may auto-execute; anything destructive,
  external, or privileged requires explicit confirmation.
- The existing website and the V2.2 holographic core must keep working.
- Local development first; **no production deploy without approval**.

Delivery is **incremental**: Milestone 1 delivers the audit, the backend
foundation, the security design and tests, then stops.

---

## 2. Stage 0 audit — current capabilities & gaps

### 2.1 What already exists (inventory)

| Area | Artefact | Notes |
| --- | --- | --- |
| Site | `index.html`, `blog.html`, `tutorials.html`, `vlogs.html`, `article/*`, `guides/*` | Static HTML/CSS/vanilla JS. No build step. |
| Hero core | `assets/js/globe.js` (+ `assets/vendor/three.module.min.js`) | V2.2 mechanical core, WebGL + transparent 2D fallback. |
| Site assistant (client) | `assets/js/ai.js` | Homepage panel; site-knowledge retrieval + optional hosted AI; browser Web Speech API (no server STT/TTS). |
| AI endpoint | `netlify/functions/solution-ai-chat.js` | Server-side retrieval over `_shared/ai-index.json`; optional Gemini / OpenAI-compatible call; origin allowlist; durable (Upstash) or in-memory rate limiting; never exposes the key. |
| Admin auth | `netlify/functions/admin-auth/admin-auth.js` | Supabase login/refresh/reset via a proxy so the anon key never ships to the browser. |
| Data layer | `netlify/functions/_shared/supabase-rest.cjs` | Zero-dep Supabase REST helpers; service-role key stays server-side. |
| Content | `assets/data/ai-index.json`, `assets/data/videos.json`, `blog-manifest` | Public knowledge + media data. |
| Dev server | `scripts/serve.cjs` | Dependency-free static server (`npm start`, port 8000). |
| QA | `scripts/qa-*.cjs`, `scripts/ai-qa.cjs` | Playwright-based suites for device/pages/scroll/admin/ai. |

### 2.2 Capabilities (what we can build on)

- A working retrieval pipeline and a proven server-side AI-call pattern
  (provider abstraction, secret hygiene, rate limiting, config validation).
- A working Supabase auth + admin pattern already in production.
- A zero-dependency, no-build CommonJS codebase with an established testing
  idiom and a rich QA harness.

### 2.3 Gaps (what the brief requires that does not exist yet)

| Gap | Needed for |
| --- | --- |
| No standalone assistant **backend service** (only a single Netlify function) | Sessions, tools, tasks, audit, local-agent routing |
| No **tool layer** (registry, schemas, authorization) | Permission-controlled actions |
| No **task/task-manager** (bounded autonomous workflows) | Multi-step actions with checkpoints/cancel |
| No **local agent** or transport | Local Windows execution behind a separate credential |
| No **voice backend** (only browser Web Speech API) | Real STT/TTS or realtime speech-to-speech |
| No **long-term memory** interface | User-visible, controllable memory |
| No **audit trail** | Security review, post-hoc verification |
| No streaming/transport between core UI and backend | Realtime states (listening/processing/speaking) |

### 2.4 Constraints discovered

- **No `node_modules` / no dependencies.** The whole project is zero-dependency
  CommonJS with no build step. Netlify functions are deployed as plain JS.
- **`appsignal`-style plugins or bundlers must not be introduced** for the site.
- Admin tokens are stored in `sessionStorage` (`admin/admin.js`); the browser
  only ever holds a Supabase user JWT.
- The static dev server does **not** route `/api/*`; the assistant runs as its
  own process on its own port.
- WebGL requires `http://localhost`, so the core cannot run from `file://`.
- No Supabase credentials or AI provider are currently configured in the repo.

---

## 3. Target architecture & module boundaries

```
   Browser (index.html / V2.2 core)          Local Windows agent
        │  fetch /api/* (JWT or anon)              │  signed protocol
        ▼                                          ▼
 ┌────────────────────────────  server/  ────────────────────────────┐
 │  http.js        router, CORS, body caps, timeouts, error mapping   │
 │  routes.js      /health /ready /api/{chat,sessions,tools,tasks,audit}│
 │  security.js    AuthN/AuthZ (admin|agent|user), HMAC, redaction    │
 │  permissions.js tool risk model + confirmation gate (source of truth)│
 │  providers.js   cloud (openai-compatible|gemini) + local + none, routing │
 │  tools/         registry → schema → authorize → invoke → audit      │
 │  tasks.js       bounded executor: steps, retries, cancel, approval  │
 │  agent.js       signed, versioned local-agent protocol + link       │
 │  voice.js       provider-agnostic voice session (stub)              │
 │  storage.js     memory | jsonfile (conversations/messages/tasks/    │
 │                 memory/settings/audit) — swappable adapter          │
 │  audit.js       secret-free audit trail                             │
 │  config.js      env schema, validation, safe defaults               │
 │  logger.js      structured logs with redaction                      │
 │  errors.js      typed errors → safe HTTP                            │
 └────────────────────────────────────────────────────────────────────┘
```

### Module boundaries (each is independently testable)

- **config** — the only module that reads env; validates and produces a safe
  summary. Secrets never leave this object except to the modules that call the
  provider.
- **security** — the only module that decides "who is this caller".
- **permissions** — the only module that decides "may this caller run this
  tool". Routes and the task runner both defer to it, so the rule cannot drift.
- **providers** — the only module that talks to a model; swappable, no vendor
  hard-coded.
- **tools** — the only path to a side effect; every call is validated,
  authorized, timed-out and audited.
- **tasks** — orchestration only; it never executes anything directly, it calls
  tools through the registry (so authorization always applies).
- **agent** — local execution transport; isolated behind a link interface.
- **storage** — persistence only; swappable adapter.

---

## 4. Dependencies & supported versions

- **Node.js** ≥ 18 (developed on **v24.20.0**). Uses built-in
  `http`, `crypto`, `fs`, global `fetch`/`AbortSignal`, and `node:test`.
- **Runtime dependencies: none.**
- **Dev dependencies: none** (tests use `node:test`).

### Why JavaScript, not TypeScript (decision)

The brief said "use TypeScript **if compatible** ... avoid replacing working
infrastructure". This project is zero-dependency, no-build-step CommonJS; its
Netlify functions are deployed as plain JS, and there is no `typescript`/bundler
toolchain in the repo. Introducing TypeScript would require adding a compiler
and a build pipeline — i.e. replacing working infrastructure — with no evidence
it is necessary. **Decision: plain JavaScript (CommonJS) with JSDoc types**,
which runs directly on `node` with no build step and matches every existing
file. TypeScript can be adopted later as an *isolated* typed layer (e.g. native
Node type-stripping) without touching the site if the operator prefers.

---

## 5. Required credentials & service setup

The server runs with **none of these** (`AH_PROVIDER=none`), serving the site
knowledge index. Add only what each milestone needs.

| Capability | Variables | Where to obtain |
| --- | --- | --- |
| Cloud model | `AH_PROVIDER`, `AH_API_KEY`, `AH_MODEL`, `AH_BASE_URL` | Provider dashboard (OpenAI, Groq, OpenRouter, …) |
| Local model | `AH_LOCAL_ENABLED=1`, `AH_LOCAL_BASE_URL`, `AH_LOCAL_MODEL` | Ollama / LM Studio / vLLM on the machine |
| Admin auth | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `ADMIN_EMAILS` **or** `AH_ADMIN_TOKEN` (dev) | Supabase project settings |
| Local agent | `AH_AGENT_TOKEN`, `AH_SESSION_SECRET` | Generate random strings (≥24 chars) |
| Production CORS | `AH_ASSISTANT_ALLOWED_ORIGINS` | e.g. `https://ahsolution.live` |

**Never** commit real credentials. `.env` is git-ignored; `server/.data/` is
git-ignored. `.env.example` contains placeholders only.

---

## 6. Cloud/local model routing

`providers.js` exposes one `chat()` used by the whole system. Providers are
ordered by `AH_ROUTING`:

| Policy | Order |
| --- | --- |
| `cloud-first` (default) | cloud → local → none |
| `local-first` | local → cloud → none |
| `cloud-only` | cloud → none |
| `local-only` | local → none |

If the first provider fails (network, timeout, HTTP error) the next is tried;
the `none` provider always succeeds and returns an empty candidate so the
router can fall back to the deterministic knowledge answer. A local target
(hostname `localhost`/`127.0.0.1`) is treated as local and needs no key.

---

## 7. Local-agent communication design

- The agent is a **separate process** with its **own** credential
  (`AH_AGENT_TOKEN`), distinct from the admin token, so a compromised browser
  session cannot drive local execution.
- Messages are **JSON, versioned (`v:1`) and HMAC-SHA256 signed** over a
  canonical encoding with `AH_SESSION_SECRET`; the signature is verified on
  every inbound message (`agent.js`).
- Message types: `hello`, `hello_ack`, `heartbeat`, `heartbeat_ack`,
  `tool_invoke`, `tool_result`, `error`, `bye`.
- The agent only runs tools on its **explicit allowlist**; today the loopback
  link advertises read-only tools. `tool_invoke` is executed through the shared
  tool registry, so the permission model still applies.
- Milestone 1 ships `createLoopbackAgentLink` (in-process) to prove the
  handshake + authorization path. A real WebSocket transport plugs in behind the
  same interface in a later milestone; callers never depend on the transport.

---

## 8. Tool permissions & data flow

Risk classes (`permissions.js`) — the single source of truth:

| Risk | Examples | Default |
| --- | --- | --- |
| `read` | site search, read project file, time | **allow** (auto) |
| `write` | draft/create a project file | confirm |
| `destructive` | overwrite/delete existing work | confirm |
| `external` | email, post, publish, 3rd-party call | confirm |
| `privileged` | deploy, DNS, credentials, shell | confirm |
| `financial` | purchases, payments | confirm |

Additionally, tool names matching shell/exec/credentials/DNS/purchase/private-key
patterns are **hard-denied** regardless of actor or confirmation.

Invocation data flow (`tools/registry.js`):

```
model or route → registry.invoke(name, args)
  1. lookup (unknown → deny, audited)
  2. validate args against tool.schema   (untrusted input)
  3. permissions.authorize(actor, tool)  (confirm gate, audited)
  4. execute handler under a hard timeout
  5. audit the outcome (never secrets)
```

Untrusted content (retrieved pages, tool output) is passed to the model inside a
"data" block with an explicit instruction not to follow instructions found
inside it, and `permissions.containsInjection()` flags override attempts.

---

## 9. Staged plan

- **Milestone 1 (DONE)** — audit, architecture doc, secure backend foundation,
  security design, tests.
- **Milestone 2 (DONE)** — reasoning: conversation management, provider
  routing/streaming, tool-aware planning, verified-vs-assumed reporting;
  `assets/js/ai.js` wired to the backend (existing panel preserved).
- **Milestone 3 (DONE)** — voice: WebRTC relay + `voice.js` adapters with
  mock-only fallback (no cloud voice credentials yet).
- **Milestone 4 (DONE)** — local-agent hub (outbound-only, HMAC, allowlists),
  holographic integration, QA suites, chat/voice panel over the V2.2 core.
- **Milestone 5 (DONE)** — bounded autonomy: workflow registry/engine,
  approval-gated runs, single-instance scheduler, honest notifications —
  details in `jarvis-workflows.md`. Bounded tool surface (read + create-only
  drafts + QA/agent tools); no arbitrary shell execution; the
  `approved-file-change` workflow is explicitly unsupported (501).
- **Milestone 6** — memory: durable, user-visible, correctable memory with
  source references and access controls.
- **Milestone 7** — further autonomy: real local-agent transport hardening +
  recurring scheduled tasks in production (currently opt-in, single-instance).
- **Milestone 8** — security/QA: full authz, injection, failure and a11y
  testing; run the existing suites.

---

## 10. Tests & acceptance criteria

Command: `npm run assistant:test` (equivalently
`node --test "server/test/*.test.js"`).

**Current status: 165 tests, all passing** across:

- `config.test.js` — defaults, enum/range validation, cloud-vs-local key rules,
  production hardening, no secret leakage.
- `security.test.js` — constant-time compare, HMAC, admin/agent authn, role
  guards, masking/scrubbing.
- `permissions.test.js` — read auto-allowed, all other risks require
  confirmation, hard-deny list, error types, injection detection.
- `schema.test.js` — required/type/bounds/enum/extra-key/default handling.
- `tools.test.js` — register/invoke, unknown/invalid, confirmation gate,
  hard-deny, timeouts, builtin path containment.
- `tasks.test.js` — lifecycle, approval pause/resume, bounded retries, cancel,
  terminal-state conflicts.
- `http.test.js` — health/ready, 404 vs 405, 400/413, auth boundaries, chat
  persistence, full task run + audit.
- `errors.test.js` — status mapping, no internal leakage, secret stripping.
- `regression.test.js` — existing site/function/script integrity, backend
  isolation.
- Chat/reasoning, voice relay, agent hub, workflow registry
  (`workflows-registry.test.js`), workflow engine (`workflows.test.js`) and
  scheduler (`scheduler.test.js`) suites added in later milestones.

The browser suites (`qa:device`, `qa:pages`, `qa:admin`, `qa:scroll`, `qa:ai`)
remain the authoritative behavioural checks for the site and are run separately.

Acceptance: the backend starts with no credentials, `/health` and `/ready`
succeed, the test suite is green, the site suites are unaffected, and no
secret is ever returned to a client or written to a log.

---

## 11. Configuration reference

See `server/.env.example` for the full list with descriptions. Key safety
defaults: `AH_PROVIDER=none`, `AH_ENABLE_VOICE=0`, scheduler off
(`AH_SCHEDULER_ENABLED=0`, every job `enabled=false`), and in production
`AH_ASSISTANT_ALLOWED_ORIGINS` + `AH_SESSION_SECRET` are required and
`AH_ADMIN_TOKEN` is rejected. Workflow/scheduler variables are documented in
`jarvis-workflows.md` §9.

---

## 12. Security decisions & explicit constraints

- The hosted model has **no** filesystem/shell/production access; only allowlisted
  tools via the agent, each validated/authorized/timed-out/audited.
- Auto-execution is limited to `read` tools; everything else needs confirmation
  (workflow runs add argument-bound, TTL-limited admin approvals — see
  `jarvis-workflows.md` §4).
- Bounded workflows may auto-execute within their declared tool allowlist;
  there is no arbitrary command execution path.
- The scheduler is single-instance and disabled by default; no production
  recurring jobs are provisioned.
- Admin and agent secrets are separate; neither is ever sent to the browser.
- Provider keys stay in server env; scrubbed from logs and error bodies.
- No commit/push/deploy/DNS change is performed by this milestone.
