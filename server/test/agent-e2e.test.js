'use strict';
/* ==========================================================================
   Milestone 4 end-to-end acceptance.

   Starts a real backend hub, spawns the local agent as a SEPARATE OS process
   (node agent/index.js) configured only from environment variables, and drives
   it through the tool registry and the public HTTP API. Nothing is stubbed, so
   a failure here means the real architecture is broken — not a mock.

   The headline assertion is the acceptance test: asking JARVIS to "Run the
   website page QA" must run the registered suite on the PC and report the
   ACTUAL exit code, including a truthful failure when the suite fails or the
   agent is not connected.
   ========================================================================== */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawn } = require('child_process');
const { loadConfig } = require('../config');
const { createApp } = require('../index');
const { createToolRegistry } = require('../tools/registry');
const { createAgentHub } = require('../agent-hub');
const { registerAgentTools } = require('../agent-tools');
const { AgentOfflineError, ToolDeniedError } = require('../errors');

const ROOT = path.resolve(__dirname, '..', '..');
const TOKEN = 'e2e-hub-token-value-1234567890';
const SECRET = 'e2e-session-secret-0123456789abcdef';
const AGENT_ID = 'e2e-agent';
const silent = { debug() {}, info() {}, warn() {}, error() {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, ms, label) {
  const deadline = Date.now() + (ms || 15000);
  for (;;) {
    if (await fn()) return true;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(50);
  }
}

function qaMap(spec) {
  const map = {};
  for (const [id, def] of Object.entries(spec)) map[id] = { args: ['-e', def] };
  return JSON.stringify(map);
}

function backendEnv(extra) {
  return Object.assign({
    AH_ASSISTANT_ENV: 'test',
    AH_STORAGE_DRIVER: 'memory',
    AH_ENABLE_AGENT: '1',
    AH_AGENT_ID: AGENT_ID,
    AH_AGENT_HUB_TOKEN: TOKEN,
    AH_AGENT_SESSION_SECRET: SECRET
  }, extra || {});
}

/** Spawn the agent exactly as an operator would: a bare node process + env. */
function spawnAgent(backendPort, extraEnv) {
  const child = spawn(process.execPath, ['agent/index.js'], {
    cwd: ROOT,
    env: Object.assign({
      AH_AGENT_BACKEND_HOST: '127.0.0.1',
      AH_AGENT_BACKEND_PORT: String(backendPort),
      AH_AGENT_ID: AGENT_ID,
      AH_AGENT_HUB_TOKEN: TOKEN,
      AH_AGENT_SESSION_SECRET: SECRET,
      AH_AGENT_ROOTS: ROOT,
      AH_AGENT_HEARTBEAT_MS: '1000',
      AH_AGENT_LOG_LEVEL: 'error'
    }, extraEnv || {}),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const logs = { out: '', err: '' };
  child.stdout.on('data', (d) => { logs.out += d.toString(); });
  child.stderr.on('data', (d) => { logs.err += d.toString(); });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  return {
    child,
    logs,
    exited,
    async stop() {
      if (child.exitCode === null) { child.kill(); await exited; }
    }
  };
}

async function withHub(env, fn) {
  const cfg = loadConfig(backendEnv(env));
  cfg.agent.port = 0;
  const hub = createAgentHub({ cfg, logger: silent, audit: { record: async () => {} } });
  const addr = await hub.start();
  const registry = createToolRegistry({ cfg, logger: silent, audit: { record: async () => {} } });
  registerAgentTools(registry, { cfg, hub, logger: silent });
  const agent = spawnAgent(addr.port, env ? {
    AH_AGENT_QA_SUITES: env.AH_AGENT_QA_SUITES || '',
    AH_AGENT_QA_MAP: env.AH_AGENT_QA_MAP || ''
  } : undefined);
  try {
    await waitFor(() => hub.status().online, 15000, 'the agent to come online');
    return await fn({ cfg, hub, registry, agent, port: addr.port });
  } finally {
    await agent.stop();
    await hub.stop();
  }
}

test('a separately-spawned agent connects, runs registered suites and reports the real exit code', async () => {
  await withHub({ AH_AGENT_QA_SUITES: 'qa-pages,qa-fail', AH_AGENT_QA_MAP: qaMap({ 'qa-pages': "console.log('page QA ok'); process.exit(0)", 'qa-fail': "console.error('boom'); process.exit(3)" }) }, async ({ registry, hub }) => {
    const actor = { type: 'admin', id: 'e2e' };

    const st = await registry.invoke('agent_status', {}, { actor });
    assert.equal(st.online, true);
    assert.equal(st.count, 1);
    assert.equal(st.agents[0].agentId, AGENT_ID);
    assert.equal(st.agents[0].client.platform, `${process.platform}/${process.arch}`, 'the agent identifies its platform');

    const list = await registry.invoke('files_list', { path: 'server', limit: 5 }, { actor });
    assert.equal(typeof list.root, 'string');
    assert.ok(list.count > 0 && list.entries.length > 0, 'it can list real project files');
    assert.ok(list.entries.every((e) => e.path.startsWith('server')), 'entries stay inside the requested directory');

    const read = await registry.invoke('files_read', { path: 'package.json' }, { actor });
    assert.equal(JSON.parse(read.content).name, 'ah-solution');

    const insp = await registry.invoke('project_inspect', { depth: 1 }, { actor });
    assert.ok(insp.files > 0 && insp.dirs > 0);

    const pass = await registry.invoke('qa_run', { suite: 'qa-pages' }, { actor });
    assert.equal(pass.exitCode, 0);
    assert.equal(pass.ok, true);
    assert.equal(pass.timedOut, false);
    assert.ok(pass.stdout.includes('page QA ok'), 'actual stdout is returned');
    assert.ok(pass.durationMs >= 0);

    // a failing suite is reported as a failure, not dressed up as success
    const fail = await registry.invoke('qa_run', { suite: 'qa-fail' }, { actor });
    assert.equal(fail.exitCode, 3);
    assert.equal(fail.ok, false);
    assert.ok(fail.stderr.includes('boom'));

    // the suite id is the ONLY thing that can reach the child process
    assert.equal(hub.status().online, true, 'the agent survives the whole run');
  });
});

test('the agent refuses anything outside its approved roots and never runs arbitrary commands', async () => {
  await withHub({}, async ({ registry }) => {
    const actor = { type: 'admin', id: 'e2e' };
    for (const escape of ['../../../Windows/win.ini', '..\\..\\..\\Windows\\win.ini', 'C:\\Windows\\win.ini']) {
      await assert.rejects(
        () => registry.invoke('files_read', { path: escape }, { actor }),
        (e) => e instanceof ToolDeniedError || e.code === 'invalid_request',
        `path escape refused: ${escape}`
      );
    }
    // no tool accepts free-form command text
    const notAnAgentArg = (e) => e.code === 'invalid_request';
    for (const name of ['files_list', 'files_read', 'project_inspect', 'qa_run']) {
      await assert.rejects(() => registry.invoke(name, { command: 'rm -rf /' }, { actor }), notAnAgentArg, `${name} rejects a command string`);
      await assert.rejects(() => registry.invoke(name, { args: ['--eval', 'process.exit(1)'] }, { actor }), notAnAgentArg, `${name} rejects an args array`);
      await assert.rejects(() => registry.invoke(name, { shell: true }, { actor }), notAnAgentArg, `${name} rejects a shell flag`);
    }
  });
});

test('when the agent goes offline the tools say so instead of pretending to work', async () => {
  await withHub({ AH_AGENT_QA_SUITES: 'qa-pages', AH_AGENT_QA_MAP: qaMap({ 'qa-pages': 'process.exit(0)' }) }, async ({ registry, agent }) => {
    const actor = { type: 'admin', id: 'e2e' };
    assert.equal((await registry.invoke('agent_status', {}, { actor })).online, true);

    await agent.stop();
    await waitFor(async () => !(await registry.invoke('agent_status', {}, { actor })).online, 10000, 'the agent to go offline');

    await assert.rejects(() => registry.invoke('qa_run', { suite: 'qa-pages' }, { actor }), AgentOfflineError);
    await assert.rejects(() => registry.invoke('files_list', {}, { actor }), AgentOfflineError);
  });
});

/* ------------------------------------------------------------------ HTTP API */

async function startApp(env) {
  const cfg = loadConfig(backendEnv(env));
  cfg.agent.port = 0;
  const app = createApp(cfg);
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const httpPort = app.server.address().port;
  const addr = await app.hub.start();
  const agent = spawnAgent(addr.port, env);
  return { app, agent, base: `http://127.0.0.1:${httpPort}`, hubPort: addr.port };
}

async function closeApp(appState) {
  if (appState) { await appState.agent.stop(); await appState.app.hub.stop(); await new Promise((r) => appState.app.server.close(r)); }
}

const PASS_MAP = { 'qa-pages': "console.log('page QA ok'); process.exit(0)" };
const FAIL_MAP = { 'qa-pages': "console.error('page QA broke'); process.exit(3)" };

test('acceptance: "Run the website page QA" runs the suite on the PC and reports the verified result', async () => {
  const state = await startApp({ AH_AGENT_QA_SUITES: 'qa-pages', AH_AGENT_QA_MAP: qaMap(PASS_MAP) });
  try {
    await waitFor(() => state.app.hub.status().online, 15000, 'the agent to come online');

    const status = await (await fetch(`${state.base}/api/agent`)).json();
    assert.equal(status.available, true);
    assert.equal(status.online, true);
    assert.equal(status.count, 1);
    assert.equal(JSON.stringify(status).includes(TOKEN), false, 'the hub token is never exposed');

    const res = await fetch(`${state.base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Run the website page QA.' })
    });
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.agent.tool, 'qa_run');
    assert.equal(json.agent.ok, true, 'JARVIS reports success only when the suite really passed');
    assert.equal(json.mode, 'agent');
    assert.equal(json.provider, 'none', 'the model is not involved in a verified local task');
    assert.ok(/passed/i.test(json.reply), `reply states the outcome: ${json.reply}`);
    assert.ok(/exit code 0/i.test(json.reply));
    assert.ok(/page QA ok/.test(json.reply), 'the real child-process output is quoted back');
    assert.ok(!/process\.exit/.test(json.reply), 'the raw command is not echoed to the user');
  } finally { await closeApp(state); }
});

test('acceptance: when the suite fails, JARVIS reports the real failure — not success', async () => {
  const state = await startApp({ AH_AGENT_QA_SUITES: 'qa-pages', AH_AGENT_QA_MAP: qaMap(FAIL_MAP) });
  try {
    await waitFor(() => state.app.hub.status().online, 15000, 'the agent to come online');
    const json = await (await fetch(`${state.base}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Run the website page QA' })
    })).json();
    assert.equal(json.agent.ok, false, 'a failing suite is never reported as success');
    assert.ok(/FAILED/i.test(json.reply));
    assert.ok(/exit code 3/i.test(json.reply), 'the actual exit code is reported');
    assert.ok(/page QA broke/.test(json.reply), 'the failing stderr is quoted');
  } finally { await closeApp(state); }
});

test('acceptance: with the PC agent disconnected, JARVIS says so instead of inventing a result', async () => {
  const state = await startApp({ AH_AGENT_QA_SUITES: 'qa-pages', AH_AGENT_QA_MAP: qaMap(PASS_MAP) });
  try {
    await waitFor(() => state.app.hub.status().online, 15000, 'the agent to come online');
    await state.agent.stop();
    await waitFor(() => !state.app.hub.status().online, 10000, 'the agent to go offline');

    const status = await (await fetch(`${state.base}/api/agent`)).json();
    assert.equal(status.available, true);
    assert.equal(status.online, false);

    const json = await (await fetch(`${state.base}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Run the website page QA.' })
    })).json();
    assert.equal(json.agent.ok, false);
    assert.ok(/not connected/i.test(json.reply), `reply must be honest about the offline agent: ${json.reply}`);
    assert.ok(!/passed/i.test(json.reply), 'it must not claim the suite passed');
  } finally { await closeApp(state); }
});

test('a chat question that is not an agent request still behaves normally', async () => {
  const state = await startApp({});
  try {
    await waitFor(() => state.app.hub.status().online, 15000, 'the agent to come online');
    const json = await (await fetch(`${state.base}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'What is the capital of France?' })
    })).json();
    assert.equal(json.agent, undefined, 'no agent work was attempted');
    assert.ok(typeof json.reply === 'string' && json.reply.length > 0);
  } finally { await closeApp(state); }
});
