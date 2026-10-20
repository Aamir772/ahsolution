'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../config');
const { createToolRegistry } = require('../tools/registry');
const { createAgentHub } = require('../agent-hub');
const { registerAgentTools, SUITE_RE } = require('../agent-tools');
const { AgentOfflineError, AgentBusyError, ToolDeniedError, PayloadTooLargeError, NotFoundError, ValidationError, ToolError } = require('../errors');

const TOKEN = 'hub-token-value-for-tests-123456';
const SECRET = 'hub-session-secret-for-tests-0123456789';
const silent = { debug() {}, info() {}, warn() {}, error() {} };
const ACTOR = { type: 'admin', id: 'test-admin' };

function agentCfg(extra) {
  const cfg = loadConfig(Object.assign({
    AH_ASSISTANT_ENV: 'test',
    AH_ENABLE_AGENT: '1',
    AH_AGENT_ID: 'test-agent',
    AH_AGENT_HUB_TOKEN: TOKEN,
    AH_SESSION_SECRET: SECRET
  }, extra || {}));
  cfg.agent.port = 0;
  return cfg;
}

function registryWith(cfg, hub) {
  const registry = createToolRegistry({ cfg, logger: silent, audit: { record: async () => {} } });
  registerAgentTools(registry, { cfg, hub, logger: silent });
  return registry;
}

test('all agent tools are registered as read-only with a schema', () => {
  const cfg = agentCfg();
  const registry = registryWith(cfg, null);
  for (const name of ['agent_status', 'files_list', 'files_read', 'project_inspect', 'qa_run']) {
    const tool = registry.get(name);
    assert.ok(tool, `${name} is registered`);
    assert.equal(tool.risk, 'read', `${name} is non-destructive`);
    assert.equal(typeof tool.description, 'string');
    assert.ok(tool.schema && tool.schema.type === 'object', `${name} has a schema`);
  }
  // the agent tool allowlist only ever contains these five names
  assert.deepEqual(cfg.agent.tools.slice().sort(), ['agent_status', 'files_list', 'files_read', 'project_inspect', 'qa_run']);
});

test('agent_status degrades honestly when the feature is disabled', async () => {
  const cfg = loadConfig({ AH_ASSISTANT_ENV: 'test', AH_ENABLE_AGENT: '0' });
  cfg.agent.port = 0;
  const registry = registryWith(cfg, null);
  const out = await registry.invoke('agent_status', {}, { actor: ACTOR });
  assert.equal(out.available, false);
  assert.equal(out.online, false);
  assert.equal(typeof out.reason, 'string');
});

test('agent tools fail closed when no agent is connected', async () => {
  const cfg = agentCfg();
  const hub = createAgentHub({ cfg, logger: silent, audit: { record: async () => {} } });
  await hub.start();
  const registry = registryWith(cfg, hub);
  try {
    await assert.rejects(() => registry.invoke('files_list', { path: 'server' }, { actor: ACTOR }), AgentOfflineError);
    await assert.rejects(() => registry.invoke('qa_run', { suite: 'qa-pages' }, { actor: ACTOR }), AgentOfflineError);
  } finally { await hub.stop(); }
});

test('QA suites must be a well-formed id on the backend allowlist', async () => {
  const cfg = agentCfg({ AH_AGENT_QA_SUITES: 'qa-pages,assistant-test' });
  const hub = { dispatch: async () => ({ ok: true, result: {} }), status: () => ({ online: false, count: 0, agents: [] }) };
  const registry = registryWith(cfg, hub);

  await assert.rejects(() => registry.invoke('qa_run', { suite: 'rm -rf /' }, { actor: ACTOR }), ValidationError);
  await assert.rejects(() => registry.invoke('qa_run', { suite: '../../etc' }, { actor: ACTOR }), ValidationError);
  await assert.rejects(() => registry.invoke('qa_run', { suite: 'qa-admin' }, { actor: ACTOR }),
    (e) => e instanceof ValidationError && /allowlist/.test(e.message), 'an id outside the allowlist is refused');
  await assert.rejects(() => registry.invoke('qa_run', { suite: 'QA_PAGES' }, { actor: ACTOR }), ValidationError, 'ids are lowercase');
  assert.equal(SUITE_RE.test('qa-pages'), true);
  assert.equal(SUITE_RE.test('a'.repeat(41)), false, 'suite ids are length-bounded');
});

test('an allowlisted suite is forwarded with validated arguments only', async () => {
  const cfg = agentCfg({ AH_AGENT_QA_SUITES: 'qa-pages' });
  const seen = [];
  const hub = {
    dispatch: async (tool, args) => { seen.push({ tool, args }); return { ok: true, result: { suite: args.suite, exitCode: 0 } }; },
    status: () => ({ online: true, count: 1, agents: [] })
  };
  const registry = registryWith(cfg, hub);
  const out = await registry.invoke('qa_run', { suite: 'qa-pages' }, { actor: ACTOR });
  assert.equal(out.exitCode, 0);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].tool, 'qa_run');
  assert.equal(seen[0].args.suite, 'qa-pages', 'only the validated suite id crosses the wire — no command text');
  assert.equal('command' in seen[0].args, false);
  assert.equal('shell' in seen[0].args, false);
});

test('agent-reported failures become truthful typed errors', async () => {
  const cfg = agentCfg();
  const cases = [
    ['path_denied', ToolDeniedError, 403],
    ['too_large', PayloadTooLargeError, 413],
    ['not_found', NotFoundError, 404],
    ['busy', AgentBusyError, 409],
    ['invalid_args', ValidationError, 400],
    ['suite_not_allowed', ValidationError, 400],
    ['whoops', ToolError, 500]
  ];
  for (const [error, cls, status] of cases) {
    const hub = { dispatch: async () => ({ ok: false, error, message: `agent said ${error}` }), status: () => ({}) };
    const registry = registryWith(cfg, hub);
    await assert.rejects(() => registry.invoke('files_read', { path: 'package.json' }, { actor: ACTOR }),
      (e) => e instanceof cls && e.status === status && /agent said/.test(e.message), `${error} -> ${status}`);
  }
});

test('without a hub the tools still register and report the feature as unavailable', async () => {
  const cfg = agentCfg();
  const registry = registryWith(cfg, undefined);
  const out = await registry.invoke('agent_status', {}, { actor: ACTOR });
  assert.equal(out.available, false, 'enabled but un-hubbed means nothing can run');
  assert.equal(out.online, false);
  assert.equal(typeof out.reason, 'string');
  await assert.rejects(() => registry.invoke('project_inspect', {}, { actor: ACTOR }), AgentOfflineError);
});
