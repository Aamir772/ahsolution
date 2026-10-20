'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../config');
const { createApp } = require('../index');

let app;
let base;
const ADMIN = 'test-admin-token';

before(async () => {
  const cfg = loadConfig({ AH_ASSISTANT_ENV: 'test', AH_ADMIN_TOKEN: ADMIN, AH_MAX_BODY_BYTES: '2048' });
  app = createApp(cfg);
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + app.server.address().port;
});
after(() => new Promise((r) => app.server.close(r)));

const json = (body, headers) => ({ method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers || {}), body: JSON.stringify(body) });
const auth = { authorization: 'Bearer ' + ADMIN };

test('GET /health reports capabilities without secrets', async () => {
  const r = await fetch(base + '/health');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.status, 'ok');
  assert.ok(Array.isArray(j.providers));
  assert.ok(j.tools >= 4);
  assert.ok(!JSON.stringify(j).includes(ADMIN));
});

test('GET /ready reports readiness', async () => {
  const r = await fetch(base + '/ready');
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ready, true);
});

test('unknown path → 404, wrong method → 405', async () => {
  assert.equal((await fetch(base + '/does-not-exist')).status, 404);
  assert.equal((await fetch(base + '/health', { method: 'DELETE' })).status, 405);
});

test('malformed JSON → 400 and oversized body → 413', async () => {
  const bad = await fetch(base + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' });
  assert.equal(bad.status, 400);
  const big = await fetch(base + '/api/chat', json({ message: 'x'.repeat(5000) }));
  assert.equal(big.status, 413);
});

test('GET /api/tools lists every tool with a known risk class', async () => {
  const j = await (await fetch(base + '/api/tools')).json();
  const names = j.tools.map((t) => t.name);
  assert.ok(names.includes('site_search'));
  const known = ['read', 'write', 'destructive', 'external', 'privileged', 'financial'];
  assert.ok(j.tools.length > 0);
  assert.ok(j.tools.every((t) => known.includes(t.risk)), 'every tool declares a known risk class');
  assert.ok(j.tools.some((t) => t.risk === 'read'), 'read-only tools still exist');
  assert.ok(j.tools.some((t) => t.risk !== 'read'), 'confirmation-gated tools are registered');
});

test('admin routes require authentication', async () => {
  assert.equal((await fetch(base + '/api/tasks')).status, 401);
  assert.equal((await fetch(base + '/api/audit')).status, 401);
  const ok = await fetch(base + '/api/tasks', { headers: auth });
  assert.equal(ok.status, 200);
});

test('POST /api/chat returns a knowledge answer without a model', async () => {
  const r = await fetch(base + '/api/chat', json({ message: 'What tutorials do you have?' }));
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.mode, 'knowledge');
  assert.ok(j.reply.length > 0);
  assert.ok(j.sessionId);
});

test('chat persists the conversation and supports continuation', async () => {
  const first = await (await fetch(base + '/api/chat', json({ message: 'hello there' }))).json();
  const second = await (await fetch(base + '/api/chat', json({ message: 'more please', sessionId: first.sessionId }))).json();
  assert.equal(second.sessionId, first.sessionId);
  const conv = await fetch(base + '/api/sessions/' + first.sessionId, { headers: auth });
  assert.equal(conv.status, 200);
  const j = await conv.json();
  assert.equal(j.messages.length, 4);
});

test('a full task can be created, run and audited', async () => {
  const created = await (await fetch(base + '/api/tasks', json({ goal: 'demo', steps: [{ label: 't', tool: 'time_now' }] }, auth))).json();
  const id = created.task.id;
  const run = await fetch(base + '/api/tasks/' + id + '/run', { method: 'POST', headers: auth });
  const j = await run.json();
  assert.equal(j.task.status, 'completed');
  const audit = await (await fetch(base + '/api/audit', { headers: auth })).json();
  assert.ok(audit.entries.some((e) => e.action === 'task.transition'));
});
