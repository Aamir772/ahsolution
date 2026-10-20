'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../config');
const { createVoiceService } = require('../voice');
const { ValidationError, ProviderError, AppError, TimeoutError } = require('../errors');
const { startMockVoice, listen, DEFAULT_ANSWER } = require('./_mock-voice');

const SDP = 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';

async function withService(mockOpts, env, fn) {
  const mock = startMockVoice(mockOpts);
  const port = await listen(mock.server);
  const cfg = loadConfig(Object.assign({
    AH_ASSISTANT_ENV: 'test',
    AH_ENABLE_VOICE: '1',
    AH_VOICE_API_KEY: 'sk-voice-super-secret',
    AH_VOICE_BASE_URL: `http://127.0.0.1:${port}/v1`
  }, env));
  const voice = createVoiceService({ cfg });
  try { return await fn(voice, mock, cfg); } finally { await new Promise((r) => mock.server.close(r)); }
}

test('describe() reports availability without exposing the key', async () => {
  await withService({}, {}, async (voice) => {
    const info = voice.describe();
    assert.equal(info.available, true);
    assert.equal(info.enabled, true);
    assert.equal(info.transport, 'webrtc');
    assert.equal(info.model, 'gpt-realtime');
    assert.equal(info.voice, 'marin');
    assert.ok(Array.isArray(info.voices) && info.voices.includes('marin'));
    assert.ok(!JSON.stringify(info).includes('sk-voice-super-secret'));
  });
});

test('createSession relays the SDP offer and returns only the SDP answer', async () => {
  await withService({}, {}, async (voice, mock) => {
    const out = await voice.createSession({ sdp: SDP, principal: { type: 'user', id: 'u1' } });
    assert.equal(out.sdp, DEFAULT_ANSWER.trim());
    assert.equal(out.voice, 'marin');
    assert.equal(out.model, 'gpt-realtime');
    assert.equal(mock.state.calls, 1);

    // The permanent key is used server-side against the provider...
    assert.equal(mock.state.lastAuth, 'Bearer sk-voice-super-secret');
    assert.ok(/^multipart\/form-data/.test(mock.state.lastContentType), 'body is multipart form-data');
    // ...and the real offer + session config are forwarded.
    assert.ok(mock.state.lastBody.includes('v=0'), 'offer SDP is in the body');
    assert.ok(mock.state.lastBody.includes('gpt-realtime'), 'session config carries the model');
    assert.ok(mock.state.lastBody.includes('marin'), 'session config carries the voice');
    // ...but the answer returned to the caller never contains the key.
    assert.ok(!JSON.stringify(out).includes('sk-voice-super-secret'));
  });
});

test('a valid client-requested voice is honoured, an unknown one is rejected', async () => {
  await withService({}, {}, async (voice, mock) => {
    const out = await voice.createSession({ sdp: SDP, voice: 'cedar' });
    assert.equal(out.voice, 'cedar');
    assert.ok(mock.state.lastBody.includes('cedar'));
    await assert.rejects(() => voice.createSession({ sdp: SDP, voice: 'evil-voice' }), ValidationError);
  });
});

test('missing or malformed SDP is rejected before any provider call', async () => {
  await withService({}, {}, async (voice, mock) => {
    await assert.rejects(() => voice.createSession({}), ValidationError);
    await assert.rejects(() => voice.createSession({ sdp: 'not-an-sdp' }), ValidationError);
    assert.equal(mock.state.calls, 0, 'no provider call for invalid input');
  });
});

test('a provider error becomes a safe ProviderError (no key leak)', async () => {
  await withService({ fail: true, failStatus: 401 }, {}, async (voice) => {
    await assert.rejects(
      () => voice.createSession({ sdp: SDP }),
      (e) => e instanceof ProviderError && e.status === 502 && !JSON.stringify(e).includes('sk-voice-super-secret')
    );
  });
});

test('when voice is unconfigured createSession fails closed', async () => {
  const cfg = loadConfig({ AH_ASSISTANT_ENV: 'test', AH_ENABLE_VOICE: '1', AH_VOICE_PROVIDER: 'none' });
  const voice = createVoiceService({ cfg });
  assert.equal(voice.describe().available, false);
  await assert.rejects(() => voice.createSession({ sdp: SDP }), (e) => e instanceof AppError && e.code === 'voice_unavailable');
});

test('a slow provider is cut off by the timeout', async () => {
  await withService({ delayMs: 1500 }, { AH_VOICE_TIMEOUT_MS: '1000' }, async (voice) => {
    await assert.rejects(() => voice.createSession({ sdp: SDP }), TimeoutError);
  });
});
