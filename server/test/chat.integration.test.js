'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../config');
const { createApp } = require('../index');
const { startMockModel, listen } = require('./_mock-model');

function startApp(env) {
  const cfg = loadConfig({ AH_ASSISTANT_ENV: 'test', AH_STORAGE_DRIVER: 'memory', ...env });
  const app = createApp(cfg);
  return listen(app.server).then((port) => ({
    app,
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((r) => app.server.close(r))
  }));
}

async function postChat(base, body) {
  const res = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
}

test('chat uses the configured local model and reports mode=model', async () => {
  const { server, state } = startMockModel({ reply: 'Hello from the local model.' });
  const port = await listen(server);
  const app = await startApp({ AH_PROVIDER: 'local', AH_LOCAL_BASE_URL: `http://127.0.0.1:${port}/v1`, AH_LOCAL_MODEL: 'mock-model' });
  try {
    const { status, json } = await postChat(app.base, { message: 'What does AH Solution do?' });
    assert.equal(status, 200);
    assert.equal(json.mode, 'model');
    assert.equal(json.provider, 'local');
    assert.equal(json.reply, 'Hello from the local model.');
    assert.equal(json.modelConfigured, true);
    assert.equal(json.degraded, false);
    assert.ok(json.sessionId, 'a session id is returned');
    assert.equal(state.chatCalls, 1);
  } finally { await app.close(); server.close(); }
});

test('multi-turn chat keeps context and persists messages', async () => {
  const { server, state } = startMockModel({ reply: (body) => (body.includes('first question') ? 'Noted the first question.' : 'Second answer.') });
  const port = await listen(server);
  const app = await startApp({ AH_PROVIDER: 'local', AH_LOCAL_BASE_URL: `http://127.0.0.1:${port}/v1`, AH_LOCAL_MODEL: 'mock-model' });
  try {
    const first = await postChat(app.base, { message: 'first question' });
    assert.equal(first.json.mode, 'model');
    const sessionId = first.json.sessionId;

    const second = await postChat(app.base, { message: 'follow up', sessionId });
    assert.equal(second.json.sessionId, sessionId, 'same session is reused');
    assert.equal(state.chatCalls, 2);

    // The second model request must include the earlier turn (multi-turn context).
    assert.ok(/first question/.test(state.lastBody), 'prior user turn is sent to the model');

    const history = await app.app.storage.messages.list(sessionId);
    assert.equal(history.length, 4, 'user+assistant stored for both turns');
    assert.equal(history[0].role, 'user');
    assert.equal(history[1].role, 'assistant');
  } finally { await app.close(); server.close(); }
});

test('/health reports the local provider as live-available', async () => {
  const { server } = startMockModel({});
  const port = await listen(server);
  const app = await startApp({ AH_PROVIDER: 'local', AH_LOCAL_BASE_URL: `http://127.0.0.1:${port}/v1` });
  try {
    const res = await fetch(`${app.base}/health`);
    const json = await res.json();
    assert.equal(json.ok, true);
    const local = json.providers.find((p) => p.kind === 'local');
    assert.equal(local.available, true);
  } finally { await app.close(); server.close(); }
});

test('with no model configured the server stays knowledge-only (no fabricated reply)', async () => {
  const app = await startApp({ AH_PROVIDER: 'none' });
  try {
    const { status, json } = await postChat(app.base, { message: 'Tell me about AH Solution services' });
    assert.equal(status, 200);
    assert.equal(json.mode, 'knowledge');
    assert.equal(json.modelConfigured, false);
    assert.equal(json.degraded, false);
    assert.ok(typeof json.reply === 'string' && json.reply.length > 0);
  } finally { await app.close(); }
});

test('a configured model that fails degrades to knowledge with degraded=true', async () => {
  const { server } = startMockModel({ fail: true });
  const port = await listen(server);
  const app = await startApp({ AH_PROVIDER: 'local', AH_LOCAL_BASE_URL: `http://127.0.0.1:${port}/v1` });
  try {
    const { status, json } = await postChat(app.base, { message: 'Are you online?' });
    assert.equal(status, 200);
    assert.equal(json.mode, 'knowledge');
    assert.equal(json.modelConfigured, true);
    assert.equal(json.degraded, true, 'client can show an honest degraded state');
  } finally { await app.close(); server.close(); }
});
