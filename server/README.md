# AH Solution — JARVIS assistant backend (`server/`)

An isolated, dependency-free Node.js service that provides the secure foundation
for the JARVIS assistant. It does **not** modify the existing website or the
Netlify functions under `netlify/functions/`.

- Runtime: Node.js 18+ (developed on Node 24). **Zero runtime dependencies.**
- Language: JavaScript (CommonJS), matching the rest of the project. Interfaces
  are documented with JSDoc types. (See the architecture note on TypeScript.)
- Tests: the built-in `node:test` runner (no install required).

## Run

```sh
npm run assistant            # start with env configuration (default 127.0.0.1:8787)
npm run assistant:test       # run the backend test suite
```

Configure by copying `server/.env.example` → `server/.env` (or exporting the
variables). The server starts with **no configuration** and answers from the
bundled site knowledge index (`AH_PROVIDER=none`). Add a provider only when you
have credentials.

Health check: `GET http://127.0.0.1:8787/health`

## Layout

| File | Responsibility |
| --- | --- |
| `index.js` | Bootstrap + `createApp()` (also exported for tests) |
| `config.js` | Env schema, validation, safe defaults, secret-free summary |
| `errors.js` | Typed errors + safe HTTP mapping |
| `logger.js` | Structured JSON logs with secret redaction |
| `security.js` | AuthN/AuthZ (admin/agent/user), HMAC signing, redaction |
| `permissions.js` | Tool risk model + confirmation gate (single source of truth) |
| `storage.js` | Memory + JSON-file adapters (conversations/messages/tasks/memory/settings/audit) |
| `audit.js` | Secret-free audit trail |
| `providers.js` | Model-provider abstraction (openai-compatible, gemini, none) + routing |
| `limits.js` | In-process rate limiting |
| `tools/schema.js` | Untrusted-argument validation |
| `tools/registry.js` | Register / validate / authorize / invoke / audit tools |
| `tools/builtin.js` | Read-only first-party tools |
| `tasks.js` | Bounded task executor (checkpoints, retries, cancel, approval) |
| `agent.js` | Local-agent protocol (signed, versioned) + loopback link |
| `voice.js` | Provider-agnostic voice session (interface + stub) |
| `http.js` | Router + Node http server (CORS, body limits, timeouts) |
| `routes.js` | HTTP API surface |

## Security model (Milestone 1)

- The hosted model never receives filesystem, shell or production access.
- Local execution happens only through a **separately authenticated agent**
  (`AH_AGENT_TOKEN`), over a **signed, versioned** protocol, and only for tools
  on an explicit allowlist.
- The tool permission model is the single source of truth
  (`permissions.js`): only `read` runs automatically; `write`, `destructive`,
  `external`, `privileged` and `financial` require per-invocation confirmation.
- Shell / exec / credentials / DNS / purchase-style tool names are hard-denied.
- Any retrieved page content or tool output is treated as untrusted data.
- Model API keys live only in server env; they are never returned to the client
  and are scrubbed from logs and error bodies.

## Not yet implemented (later milestones)

Real WebSocket agent transport, real STT/TTS providers, write/privileged tools,
long-term memory UI, scheduled autonomy, and the holographic state integration
with the V2.2 core. See `../reference/jarvis-architecture.md`.
