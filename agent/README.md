# JARVIS local agent (Milestone 4)

A small, separate Node process that gives JARVIS the ability to run **approved,
bounded, read-only** tasks on your Windows PC.

It is deliberately *not* a remote-control tool. It executes nothing that is not
on an allowlist, and it never opens an inbound port on your machine — it dials
out to the backend and waits to be asked.

```
┌──────────────┐  outbound TLS/TCP   ┌──────────────────┐
│  agent/      │ ──────────────────► │ hosted backend    │  (server/agent-hub.js)
│  (your PC)   │  signed NDJSON      │  + tool registry  │
└──────────────┘                     └──────────────────┘
```

## What it can do

| Tool | What it does | Risk |
| --- | --- | --- |
| `agent_status` | Report whether the agent is online, its identity and last heartbeat | `read` |
| `files_list` | List files/folders inside an approved root | `read` |
| `files_read` | Read a UTF-8 text file inside an approved root (size-capped) | `read` |
| `project_inspect` | Summarise the structure of an approved root | `read` |
| `qa_run` | Run a **predefined** QA suite (allowlisted id → fixed argument list) | `read` |

There is no `exec`/`shell` tool, no write tool, no deploy, no purchases, no DNS
changes, and no scheduling. Anything not on that list is refused before it
reaches the agent.

### Permission and safety model

Default-deny, enforced **twice** — once in the backend tool registry (schema
validation, permission gate, audit trail, timeout) and again inside the agent,
which is the real execution boundary:

- **No arbitrary commands.** `qa_run` takes a suite *id*. The agent maps that id
  to a fixed argument array and spawns `process.execPath` with `shell: false`.
  Model output and user text never become command-line arguments.
- **Path containment.** Every path is canonicalised and must stay inside an
  approved root. Symlinks that resolve outside, device paths (`\\?\`, `\\.\`),
  NUL bytes and `..` escapes are rejected.
- **Bounded.** Per-message size, per-file size, per-task output, task wall-clock
  time, and one concurrent task by default.
- **Authenticated.** The agent presents a unique, revocable hub token at
  handshake; every message is HMAC-SHA256 signed and checked for version,
  identity binding, clock skew and replay.
- **Fail closed.** No hub token or shared secret → it refuses to start. Backend
  unreachable → it retries with backoff and reports `offline`; it never pretends
  a task succeeded.

## Setup

### 1. Local development (backend and agent on the same PC)

Backend — `server/.env`:

```env
AH_ENABLE_AGENT=1
AH_AGENT_HOST=127.0.0.1
AH_AGENT_PORT=8788
AH_AGENT_HUB_TOKEN=replace-with-a-long-random-string
AH_SESSION_SECRET=replace-with-another-long-random-string
```

Agent — `agent/.env` (or your shell):

```env
AH_AGENT_BACKEND_HOST=127.0.0.1
AH_AGENT_BACKEND_PORT=8788
AH_AGENT_ID=local-agent
AH_AGENT_HUB_TOKEN=replace-with-a-long-random-string
AH_AGENT_SESSION_SECRET=replace-with-another-long-random-string
AH_AGENT_ROOTS=F:\AI Project\AH Solution
```

Start the backend, then the agent:

```bat
npm run assistant
npm run agent
```

Check it:

```bat
curl http://127.0.0.1:8787/api/agent
```

Stop the agent with `Ctrl+C`. Stop the backend with `Ctrl+C` — it sends a `bye`
and the agent goes `offline` instead of hanging.

### 2. Remote backend (hosted server + your PC)

Requirements, in order:

1. The backend must be reachable over **HTTPS/TLS** — set `AH_AGENT_TLS=1` on
   the backend with a real certificate and key, and `AH_AGENT_TLS_CA` on the
   agent pointing at the CA that signed it.
2. `AH_AGENT_BACKEND_HOST` must be the server's real hostname, not a guessed
   URL. Configure your own DNS / hosting; this project never publishes or
   guesses a public address for you.
3. Use a **dedicated** hub token and a **dedicated**
   `AH_AGENT_SESSION_SECRET` on both sides, so the agent process never has to
   hold the HTTP session secret.
4. Keep `AH_AGENT_TLS_INSECURE=0`. It exists only for local debugging and
   disables certificate verification.

The backend refuses to bind a non-local `AH_AGENT_HOST` in production without
TLS, so you cannot expose an unencrypted hub by accident.

## Multiple PCs

Use a token map on the backend so each machine has its own revocable credential:

```env
AH_AGENT_HUB_TOKENS={"office-pc":"token-one-example","lab-pc":"token-two-example"}
```

and give each agent `AH_AGENT_ID=office-pc` / `AH_AGENT_ID=lab-pc` with the
matching `AH_AGENT_HUB_TOKEN`. Revoke a single machine by deleting its entry.

## Running the QA suites

Ask JARVIS in chat — "Run the website page QA" — or call the tool directly:

```bat
curl -X POST http://127.0.0.1:8787/api/tools/qa_run/invoke ^
  -H "content-type: application/json" ^
  -d "{\"args\":{\"suite\":\"qa-pages\"}}"
```

The reply contains the **actual** exit code, duration and the tail of the real
stdout/stderr. If the suite fails, or the agent is not connected, JARVIS says so
instead of inventing a result.

## Tests

```bat
npm run assistant:test
```

Includes `server/test/agent-e2e.test.js`, which starts a real hub, spawns this
agent as a separate OS process and asserts the path-escape, allowlist,
failure-reporting and offline behaviours end to end.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `AH_AGENT_HUB_TOKEN is required` | The agent refuses to start without credentials. Fill in `agent/.env`. |
| Agent logs `unauthorized` and exits | Token or `AH_AGENT_ID` does not match the backend's hub token map. |
| `The local agent is not connected` | The agent is stopped, or it could not reach the backend host/port. |
| `QA suite "x" is not on the allowlist` | Add it to `AH_AGENT_QA_SUITES` **and** define it in `AH_AGENT_QA_MAP`. |
| `Path escapes the approved root` | The file is outside `AH_AGENT_ROOTS`, or a symlink points outside. |
| TLS errors on a remote backend | `AH_AGENT_TLS_CA` does not match the server certificate's issuer. |
