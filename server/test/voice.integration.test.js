'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../config');
const { createApp } = require('../index');
const { startMockVoice, listen, DEFAULT_ANSWER } = require('./_mock-voice');

const SDP = 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';

function startApp(env) {
  const cfg = loadConfig(Object.assign({ AH_ASSISTANT_ENV: 'test', AH_STORAGE_DRIVER: 'memory' }, env));
  const app = createApp(cfg);
  return listen(app.server).then((port) => ({
    app,
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((r) => app.server.close(r))
  }));
}

async function postVoice(base, body, headers) {
  const res = await fetch(`${base}/api/voice/session`, {
    method: 'POST',
    headers: Object.assign({ 'content-type': 'application/json' }, headers || {}),
    body: JSON.stringify(body)
  });
  return { status: res.status, json: await res.json() };
}

async function voiceEnv(mockOpts, env) {
  const mock = startMockVoice(mockOpts || {});
  const port = await listen(mock.server);
  const app = await startApp(Object.assign({
    AH_ENABLE_VOICE: '1',
    AH_VOICE_API_KEY: 'sk-voice-super-secret',
    AH_VOICE_BASE_URL: `http://127.0.0.1:${port}/v1`
  }, env));
  return { mock, app };
}

test('GET /api/voice reports availability and never leaks the key', async () => {
  const { mock, app } = await voiceEnv();
  try {
    const res = await fetch(`${app.base}/api/voice`);
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.voice.available, true);
    assert.equal(json.voice.transport, 'webrtc');
    assert.ok(!JSON.stringify(json).includes('sk-voice-super-secret'));
  } finally { await app.close(); mock.server.close(); }
});

test('POST /api/voice/session returns the SDP answer and never the key', async () => {
  const { mock, app } = await voiceEnv();
  try {
    const { status, json } = await postVoice(app.base, { sdp: SDP });
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.session.sdp, DEFAULT_ANSWER.trim());
    assert.equal(json.session.transport, 'webrtc');
    assert.equal(json.session.voice, 'marin');
    assert.equal(mock.state.calls, 1);
    assert.ok(!JSON.stringify(json).includes('sk-voice-super-secret'));
  } finally { await app.close(); mock.server.close(); }
});

test('a missing SDP offer is a 400 with a stable code', async () => {
  const { mock, app } = await voiceEnv();
  try {
    const { status, json } = await postVoice(app.base, {});
    assert.equal(status, 400);
    assert.equal(json.error, 'invalid_request');
    assert.equal(mock.state.calls, 0);
  } finally { await app.close(); mock.server.close(); }
});

test('voice remains unavailable (503) when the feature is off', async () => {
  const { mock, app } = await voiceEnv({}, { AH_ENABLE_VOICE: '0' });
  try {
    const info = await (await fetch(`${app.base}/api/voice`)).json();
    assert.equal(info.voice.available, false);
    const { status, json } = await postVoice(app.base, { sdp: SDP });
    assert.equal(status, 503);
    assert.equal(json.error, 'voice_unavailable');
    assert.equal(mock.state.calls, 0);
  } finally { await app.close(); mock.server.close(); }
});

test('when AH_VOICE_REQUIRE_AUTH is set, anonymous callers are rejected', async () => {
  const { mock, app } = await voiceEnv({}, { AH_VOICE_REQUIRE_AUTH: '1', AH_ADMIN_TOKEN: 'adm-secret-token' });
  try {
    const anon = await postVoice(app.base, { sdp: SDP });
    assert.equal(anon.status, 401);

    const admin = await postVoice(app.base, { sdp: SDP }, { authorization: 'Bearer adm-secret-token' });
    assert.equal(admin.status, 200);
    assert.equal(mock.state.calls, 1);
  } finally { await app.close(); mock.server.close(); }
});

test('a failing provider surfaces a safe 502', async () => {
  const { mock, app } = await voiceEnv({ fail: true });
  try {
    const { status, json } = await postVoice(app.base, { sdp: SDP });
    assert.equal(status, 502);
    assert.equal(json.error, 'provider_error');
    assert.ok(!JSON.stringify(json).includes('sk-voice-super-secret'));
  } finally { await app.close(); mock.server.close(); }
});
