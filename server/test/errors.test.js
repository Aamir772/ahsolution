'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { toHttp, ValidationError, AuthError, ForbiddenError, RateLimitError, ProviderError, ApprovalRequiredError, ToolDeniedError } = require('../errors');

test('client errors map to their status codes and expose the message', () => {
  assert.equal(toHttp(new ValidationError('bad')).status, 400);
  assert.equal(toHttp(new AuthError()).status, 401);
  assert.equal(toHttp(new ForbiddenError('no')).status, 403);
  assert.equal(toHttp(new RateLimitError('slow')).status, 429);
  assert.equal(toHttp(new ApprovalRequiredError('confirm')).status, 409);
  const r = toHttp(new ValidationError('bad field'));
  assert.equal(r.body.message, 'bad field');
});

test('server errors do not leak internals', () => {
  const r = toHttp(new ProviderError('boom', { detail: 'secret upstream trace' }));
  assert.equal(r.status, 502);
  assert.equal(r.body.message, undefined);
  assert.equal(r.body.error, 'provider_error');
});

test('unknown errors become a generic 500', () => {
  const r = toHttp(new Error('some internal detail'));
  assert.equal(r.status, 500);
  assert.equal(r.body.error, 'internal_error');
  assert.ok(!r.body.message.includes('some internal detail'));
});

test('secret-looking detail fields are stripped', () => {
  const r = toHttp(new ProviderError('x', { apiKey: 'sk-secret', token: 'abc', safe: 1 }));
  assert.equal(r.body.apiKey, undefined);
  assert.equal(r.body.token, undefined);
});

test('ToolDeniedError is a 403', () => {
  assert.equal(toHttp(new ToolDeniedError('blocked')).status, 403);
});
