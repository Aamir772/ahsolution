'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../config');
const { createToolRegistry } = require('../tools/registry');
const { registerBuiltinTools } = require('../tools/builtin');
const { createAudit } = require('../audit');
const { createStorage } = require('../storage');
const { NotFoundError, ValidationError, ApprovalRequiredError, ToolDeniedError, TimeoutError } = require('../errors');

const cfg = loadConfig({ AH_ASSISTANT_ENV: 'test' });
const logger = { debug() {}, info() {}, warn() {}, error() {} };
const admin = { type: 'admin', id: 'admin' };

function freshRegistry() {
  const audit = createAudit(createStorage(cfg), logger);
  return { registry: createToolRegistry({ cfg, logger, audit }), audit };
}

test('registers and invokes a read tool', async () => {
  const { registry } = freshRegistry();
  registry.register({ name: 'add', risk: 'read', schema: { type: 'object', properties: { a: { type: 'number', required: true }, b: { type: 'number', required: true } } }, handler: async (args) => ({ sum: args.a + args.b }) });
  assert.deepEqual(await registry.invoke('add', { a: 2, b: 3 }, { actor: admin }), { sum: 5 });
});

test('unknown tool → NotFound, invalid args → ValidationError', async () => {
  const { registry } = freshRegistry();
  registry.register({ name: 'tt', risk: 'read', schema: { type: 'object', properties: { q: { type: 'string', required: true } } }, handler: async (a) => a.q });
  await assert.rejects(() => registry.invoke('missing', {}, { actor: admin }), NotFoundError);
  await assert.rejects(() => registry.invoke('tt', {}, { actor: admin }), ValidationError);
});

test('write tool needs confirmation; hard-denied is blocked', async () => {
  const { registry } = freshRegistry();
  registry.register({ name: 'write_file', risk: 'write', schema: { type: 'object', properties: {} }, handler: async () => 'wrote' });
  registry.register({ name: 'run_shell', risk: 'read', schema: { type: 'object', properties: {} }, handler: async () => 'boom' });
  await assert.rejects(() => registry.invoke('write_file', {}, { actor: admin }), ApprovalRequiredError);
  assert.equal(await registry.invoke('write_file', {}, { actor: admin, confirmed: true }), 'wrote');
  await assert.rejects(() => registry.invoke('run_shell', {}, { actor: admin }), ToolDeniedError);
});

test('handler timeouts are enforced', async () => {
  const { registry } = freshRegistry();
  registry.register({ name: 'slow', risk: 'read', timeoutMs: 60, schema: { type: 'object', properties: {} }, handler: () => new Promise(() => {}) });
  await assert.rejects(() => registry.invoke('slow', {}, { actor: admin }), TimeoutError);
});

test('builtin read tools work and enforce path containment', async () => {
  const { registry } = freshRegistry();
  registerBuiltinTools(registry, { projectRoot: require('path').resolve(__dirname, '..', '..') });
  assert.match(JSON.stringify(await registry.invoke('time_now', {}, { actor: admin })), /utc/);
  assert.deepEqual(await registry.invoke('echo', { text: 'hi' }, { actor: admin }), { text: 'hi' });
  const read = await registry.invoke('project_read_file', { path: 'server/index.js' }, { actor: admin });
  assert.match(read.content, /JARVIS/);
  await assert.rejects(() => registry.invoke('project_read_file', { path: '../../../Windows/win.ini' }, { actor: admin }), ValidationError);
  await assert.rejects(() => registry.invoke('project_read_file', { path: '.env' }, { actor: admin }), ValidationError);
});
