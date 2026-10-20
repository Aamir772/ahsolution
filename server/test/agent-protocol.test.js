'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAgentProtocol, createGuard, canonical, PROTOCOL_VERSION, TYPES } = require('../agent-protocol');
const { AuthError, ValidationError } = require('../errors');

const SECRET = 'test-agent-shared-secret-0123456789';

test('encode() builds a signed, versioned envelope and never exposes the secret', () => {
  const p = createAgentProtocol({ secret: SECRET });
  const msg = p.encode({ type: 'heartbeat', agentId: 'a1', payload: { hello: true } });
  assert.equal(msg.v, PROTOCOL_VERSION);
  assert.equal(msg.type, 'heartbeat');
  assert.equal(msg.agentId, 'a1');
  assert.equal(typeof msg.id, 'string');
  assert.equal(msg.id.length > 4, true);
  assert.equal(typeof msg.nonce, 'string');
  assert.equal(typeof msg.ts, 'number');
  assert.equal(typeof msg.sig, 'string');
  assert.equal(msg.payload.hello, true);
  assert.equal(JSON.stringify(msg).includes(SECRET), false);
});

test('encode() rejects a missing secret, a missing type and unknown types', () => {
  assert.throws(() => createAgentProtocol({}), ValidationError);
  assert.throws(() => createAgentProtocol({ secret: SECRET, version: 99 }), ValidationError);
  const p = createAgentProtocol({ secret: SECRET });
  assert.throws(() => p.encode({}), ValidationError);
  assert.throws(() => p.encode({ type: 'shell' }), ValidationError);
  // only the documented message types exist — no free-form channel to the PC
  assert.deepEqual(p.TYPES, TYPES);
});

test('decode() accepts a freshly encoded message (string or object)', () => {
  const p = createAgentProtocol({ secret: SECRET });
  const msg = p.encode({ type: 'task_invoke', agentId: 'a1', payload: { taskId: 't1' } });
  assert.equal(p.decode(JSON.stringify(msg), { agentId: 'a1' }).type, 'task_invoke');
  const out = p.decode(msg, { agentId: 'a1' });
  assert.deepEqual(out.payload, { taskId: 't1' });
  assert.equal(out.id, msg.id);
});

test('decode() rejects a tampered payload, a wrong secret and a forged signature', () => {
  const p = createAgentProtocol({ secret: SECRET });
  const other = createAgentProtocol({ secret: 'a-completely-different-secret' });
  const msg = p.encode({ type: 'task_invoke', agentId: 'a1', payload: { args: { path: 'package.json' } } });

  const tampered = JSON.parse(JSON.stringify(msg));
  tampered.payload = { args: { path: '../../etc/passwd' } };
  assert.throws(() => p.decode(tampered, { agentId: 'a1' }), AuthError);

  assert.throws(() => other.decode(msg, { agentId: 'a1' }), AuthError);

  const forged = JSON.parse(JSON.stringify(msg));
  forged.sig = 'a'.repeat(64);
  assert.throws(() => p.decode(forged, { agentId: 'a1' }), AuthError);
});

test('decode() enforces identity binding, version and known types', () => {
  const p = createAgentProtocol({ secret: SECRET });
  const msg = p.encode({ type: 'heartbeat', agentId: 'a1' });
  assert.throws(() => p.decode(msg, { agentId: 'a2' }), AuthError, 'bound connection rejects another identity');
  assert.equal(p.decode(msg, { agentId: null }).type, 'heartbeat', 'pre-auth messages are unbound');
  // version and type are checked before anything else, so a bogus header is a
  // clean validation error rather than an auth failure.
  assert.throws(() => p.decode(Object.assign({}, msg, { v: 99 })), ValidationError);
  assert.throws(() => p.decode(Object.assign({}, msg, { type: 'exec' })), ValidationError);
  assert.throws(() => p.decode('not json'), ValidationError);
  assert.throws(() => p.decode([msg]), ValidationError);
});

test('decode() rejects messages outside the clock window', () => {
  const p = createAgentProtocol({ secret: SECRET });
  const old = p.encode({ type: 'heartbeat', agentId: 'a1', ts: Date.now() - 600000 });
  assert.throws(() => p.decode(old, { agentId: 'a1' }), ValidationError);
  // ...but a message inside the window is accepted, including clock skew.
  const near = p.encode({ type: 'heartbeat', agentId: 'a1', ts: Date.now() - 5000 });
  assert.equal(p.decode(near, { agentId: 'a1', skewMs: 10000 }).type, 'heartbeat');
});

test('the guard makes replayed and duplicate deliveries idempotent', () => {
  const p = createAgentProtocol({ secret: SECRET });
  const guard = createGuard({ ttlMs: 60000, max: 10 });
  const msg = p.encode({ type: 'task_result', agentId: 'a1', payload: { taskId: 't1' } });

  assert.equal(p.decode(msg, { agentId: 'a1', guard }).type, 'task_result');
  assert.throws(() => p.decode(msg, { agentId: 'a1', guard }), ValidationError, 'exact replay rejected');
  assert.throws(() => p.decode(JSON.parse(JSON.stringify(msg)), { agentId: 'a1', guard }), ValidationError);

  // a fresh message (new id/nonce) is still accepted — retries are not blocked
  const fresh = p.encode({ type: 'task_result', agentId: 'a1', payload: { taskId: 't2' } });
  assert.equal(p.decode(fresh, { agentId: 'a1', guard }).type, 'task_result');
});

test('the guard is bounded and exposes once() for duplicate task handling', () => {
  const guard = createGuard({ ttlMs: 60000, max: 3 });
  for (let i = 0; i < 10; i++) guard.replay(`id${i}`, `nonce${i}`, Date.now());
  assert.equal(guard.size() <= 6, true, 'memory stays bounded at max');

  assert.equal(guard.once('task-1'), true);
  assert.equal(guard.once('task-1'), false, 'second delivery does not re-run the work');
});

test('canonical() has a fixed key order and excludes the signature', () => {
  const p = createAgentProtocol({ secret: SECRET });
  const msg = p.encode({ type: 'bye', agentId: 'a1' });
  const c1 = canonical(msg);
  const shuffled = { sig: msg.sig, payload: msg.payload, nonce: msg.nonce, ts: msg.ts, seq: msg.seq, agentId: msg.agentId, id: msg.id, type: msg.type, v: msg.v };
  assert.equal(canonical(shuffled), c1, 'key order does not depend on property insertion order');
  assert.equal(c1.includes('sig'), false);
  assert.equal(p.canonical(msg), c1);
});
