'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuth, timingSafeEqualStr, sign, verifySignature, maskToken, scrubText, bearerFrom } = require('../security');
const { loadConfig } = require('../config');
const { AuthError, ForbiddenError } = require('../errors');

const req = (token) => ({ headers: token ? { authorization: 'Bearer ' + token } : {} });

test('timingSafeEqualStr compares correctly', () => {
  assert.equal(timingSafeEqualStr('abc', 'abc'), true);
  assert.equal(timingSafeEqualStr('abc', 'abd'), false);
  assert.equal(timingSafeEqualStr('abc', 'abcd'), false);
  assert.equal(timingSafeEqualStr('', ''), true);
});

test('HMAC sign / verify round-trips', () => {
  const sig = sign('secret', 'payload');
  assert.equal(verifySignature('secret', 'payload', sig), true);
  assert.equal(verifySignature('secret', 'payloaD', sig), false);
  assert.equal(verifySignature('other', 'payload', sig), false);
});

test('bearerFrom parses the header', () => {
  assert.equal(bearerFrom(req('tok')), 'tok');
  assert.equal(bearerFrom({ headers: {} }), '');
  assert.equal(bearerFrom({ headers: { authorization: 'tok' } }), '');
});

test('admin token authenticates as admin and a bad token is anonymous', async () => {
  const cfg = loadConfig({ AH_ASSISTANT_ENV: 'test', AH_ADMIN_TOKEN: 'dev-secret' });
  const auth = createAuth(cfg);
  assert.deepEqual(await auth.authenticate(req('dev-secret')), { type: 'admin', id: 'admin-token' });
  assert.equal(await auth.authenticate(req('wrong')), null);
  assert.equal(await auth.authenticate(req()), null);
});

test('agent token authenticates as the local agent', async () => {
  const cfg = loadConfig({ AH_ASSISTANT_ENV: 'test', AH_ADMIN_TOKEN: 'dev-secret', AH_AGENT_TOKEN: 'agent-secret' });
  const auth = createAuth(cfg);
  assert.deepEqual(await auth.authenticate(req('agent-secret')), { type: 'agent', id: 'local-agent' });
});

test('role guards enforce boundaries', () => {
  const auth = createAuth(loadConfig({ AH_ASSISTANT_ENV: 'test', AH_ADMIN_TOKEN: 'x' }));
  assert.throws(() => auth.requireAdmin(null), AuthError);
  assert.throws(() => auth.requireAdmin({ type: 'agent', id: 'a' }), ForbiddenError);
  assert.throws(() => auth.requireAdmin({ type: 'user', id: 'u' }), ForbiddenError);
  assert.equal(auth.requireAdmin({ type: 'admin', id: 'a' }).id, 'a');
  assert.equal(auth.requireAgent({ type: 'agent', id: 'a' }).id, 'a');
});

test('masking and scrubbing hide secrets', () => {
  assert.equal(maskToken('sk-abcdef123456'), 'sk-***56');
  assert.equal(maskToken('abc'), '***');
  assert.equal(scrubText('failed with key sk-abcdef123456 here', ['sk-abcdef123456']), 'failed with key [redacted] here');
});
