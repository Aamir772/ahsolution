'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../config');
const { createProviders } = require('../providers');
const { startMockModel, listen } = require('./_mock-model');

const logger = { debug() {}, info() {}, warn() {}, error() {} };

test('local provider reaches a live model and reports live availability', async () => {
  const { server } = startMockModel({ reply: 'LOCAL OK' });
  const port = await listen(server);
  try {
    const cfg = loadConfig({ AH_ASSISTANT_ENV: 'test', AH_PROVIDER: 'local', AH_LOCAL_BASE_URL: `http://127.0.0.1:${port}/v1`, AH_LOCAL_MODEL: 'mock-model' });
    const p = createProviders(cfg, logger);
    assert.equal(p.hasModel(), true);

    const live = await p.describeLive();
    const local = live.find((x) => x.kind === 'local');
    assert.equal(local.configured, true);
    assert.equal(local.available, true);

    const out = await p.chat({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 50 });
    assert.equal(out.text, 'LOCAL OK');
    assert.equal(out.provider, 'local');
  } finally { server.close(); }
});

test('local provider is reported unavailable when nothing is listening (no false fallback claim)', async () => {
  const cfg = loadConfig({ AH_ASSISTANT_ENV: 'test', AH_PROVIDER: 'local', AH_LOCAL_BASE_URL: 'http://127.0.0.1:1/v1' });
  const p = createProviders(cfg, logger);
  const live = await p.describeLive();
  const local = live.find((x) => x.kind === 'local');
  assert.equal(local.configured, true, 'configured reflects the URL being set');
  assert.equal(local.available, false, 'available reflects the live probe result');
});

test('cloud path sends the bearer key and returns the model text', async () => {
  const { server, state } = startMockModel({ reply: 'CLOUD OK' });
  const port = await listen(server);
  try {
    const cfg = loadConfig({ AH_ASSISTANT_ENV: 'test', AH_PROVIDER: 'openai', AH_API_KEY: 'sk-test-key', AH_MODEL: 'gpt-x', AH_BASE_URL: `http://127.0.0.1:${port}/v1` });
    const p = createProviders(cfg, logger);
    const out = await p.chat({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 50 });
    assert.equal(out.text, 'CLOUD OK');
    assert.equal(state.lastAuth, 'Bearer sk-test-key');
  } finally { server.close(); }
});

test('cloud-first routing falls back to a reachable local model when the cloud call fails', async () => {
  const cloud = startMockModel({ fail: true });
  const cport = await listen(cloud.server);
  const local = startMockModel({ reply: 'LOCAL FALLBACK OK' });
  const lport = await listen(local.server);
  try {
    const cfg = loadConfig({
      AH_ASSISTANT_ENV: 'test', AH_PROVIDER: 'openai', AH_API_KEY: 'sk-x', AH_MODEL: 'gpt',
      AH_BASE_URL: `http://127.0.0.1:${cport}/v1`,
      AH_LOCAL_ENABLED: '1', AH_LOCAL_BASE_URL: `http://127.0.0.1:${lport}/v1`, AH_LOCAL_MODEL: 'mock',
      AH_ROUTING: 'cloud-first'
    });
    const p = createProviders(cfg, logger);
    const out = await p.chat({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 50 });
    assert.equal(out.text, 'LOCAL FALLBACK OK');
    assert.equal(out.provider, 'local');
  } finally { cloud.server.close(); local.server.close(); }
});

test('a failing provider falls back to none instead of throwing', async () => {
  const { server } = startMockModel({ fail: true });
  const port = await listen(server);
  try {
    const cfg = loadConfig({ AH_ASSISTANT_ENV: 'test', AH_PROVIDER: 'local', AH_LOCAL_BASE_URL: `http://127.0.0.1:${port}/v1` });
    const p = createProviders(cfg, logger);
    const out = await p.chat({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 50 });
    assert.equal(out.provider, 'none');
    assert.equal(out.text, '');
  } finally { server.close(); }
});

test('a slow provider is cut off by the timeout and falls back', async () => {
  const { server } = startMockModel({ delayMs: 2500 });
  const port = await listen(server);
  try {
    const cfg = loadConfig({ AH_ASSISTANT_ENV: 'test', AH_PROVIDER: 'local', AH_LOCAL_BASE_URL: `http://127.0.0.1:${port}/v1`, AH_PROVIDER_TIMEOUT_MS: '1000' });
    const p = createProviders(cfg, logger);
    const started = Date.now();
    const out = await p.chat({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 50 });
    assert.equal(out.provider, 'none');
    assert.ok(Date.now() - started < 2400, 'should give up before the model responds');
  } finally { server.close(); }
});
