/* ==========================================================================
   server/agent-protocol.js — signed, versioned local-agent message protocol

   Shared by the hosted backend (server/agent-hub.js) and the separate local
   agent process (agent/). It defines the ONLY message envelope both sides
   speak, so the contract cannot drift between them.

   Envelope (every message):
     {
       v: 1,                 protocol version
       type: string,         one of TYPES
       id: string,           unique message id (idempotency / correlation)
       agentId: string|null, identity binding (null only before hello_ack)
       seq: number|null,      per-direction monotonic sequence (optional)
       ts: number,            epoch ms (replay/expiry window)
       nonce: string,         random per message (replay protection)
       payload: object|null,
       sig: hex              HMAC-SHA256 over the canonical encoding
     }

   Decoding enforces: known version, known type, well-formed fields, an
   optional expected agentId (identity binding), a valid HMAC signature, a
   timestamp inside the allowed clock window, and (when a guard is supplied)
   replay/duplicate rejection.

   Nothing here logs or returns the shared secret.
   ========================================================================== */
'use strict';

const crypto = require('crypto');
const { ValidationError, AuthError } = require('./errors');
const { sign, verifySignature } = require('./security');

const PROTOCOL_VERSION = 1;

/* Message types. Server → agent and agent → server share this list. */
const TYPES = [
  'hello', 'hello_ack',
  'heartbeat', 'heartbeat_ack',
  'task_invoke', 'task_result', 'task_progress', 'task_cancel', 'task_cancelled',
  'error', 'bye'
];

const DEFAULT_SKEW_MS = 60000;

/** Deterministic encoding signed by HMAC (fixed key order; sig excluded). */
function canonical(msg) {
  return JSON.stringify({
    v: msg.v,
    type: msg.type,
    id: msg.id,
    agentId: msg.agentId === undefined ? null : msg.agentId,
    seq: msg.seq === undefined ? null : msg.seq,
    ts: msg.ts,
    nonce: msg.nonce,
    payload: msg.payload === undefined ? null : msg.payload
  });
}

/**
 * @param {{ secret: string, version?: number }} opts
 */
function createAgentProtocol({ secret, version = PROTOCOL_VERSION } = {}) {
  if (!secret || typeof secret !== 'string') throw new ValidationError('Agent protocol requires a shared secret.');
  if (version !== PROTOCOL_VERSION) throw new ValidationError(`Unsupported agent protocol version ${version}.`);

  /**
   * @param {{type:string, payload?:object, id?:string, agentId?:string|null, seq?:number, ts?:number, nonce?:string}} msg
   */
  function encode(msg) {
    if (!msg || !msg.type) throw new ValidationError('Agent message type is required.');
    const full = {
      v: version,
      type: msg.type,
      id: msg.id || `m_${crypto.randomBytes(9).toString('hex')}`,
      agentId: msg.agentId === undefined ? null : msg.agentId,
      seq: Number.isFinite(msg.seq) ? msg.seq : null,
      ts: Number.isFinite(msg.ts) ? msg.ts : Date.now(),
      nonce: msg.nonce || crypto.randomBytes(12).toString('hex'),
      payload: msg.payload === undefined ? null : msg.payload
    };
    if (!TYPES.includes(full.type)) throw new ValidationError(`Unknown agent message type "${full.type}".`);
    full.sig = sign(secret, canonical(full));
    return full;
  }

  /**
   * @param {object|string} raw
   * @param {{ agentId?:string|null, now?:number, skewMs?:number, guard?:object }} [opts]
   */
  function decode(raw, opts = {}) {
    let msg;
    try { msg = typeof raw === 'string' ? JSON.parse(raw) : raw; }
    catch (e) { throw new ValidationError('Malformed agent message.'); }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) throw new ValidationError('Malformed agent message.');
    if (msg.v !== version) throw new ValidationError(`Unsupported agent protocol version ${msg.v}.`);
    if (!TYPES.includes(msg.type)) throw new ValidationError('Unknown agent message type.');
    if (typeof msg.id !== 'string' || !msg.id) throw new ValidationError('Agent message id is required.');
    if (typeof msg.nonce !== 'string' || !msg.nonce) throw new ValidationError('Agent message nonce is required.');
    if (typeof msg.ts !== 'number' || !Number.isFinite(msg.ts)) throw new ValidationError('Agent message timestamp is required.');
    // Identity binding: once a connection has an agentId, every message must carry it.
    if (opts.agentId !== undefined && opts.agentId !== null && msg.agentId !== opts.agentId) {
      throw new AuthError('Agent identity mismatch.');
    }
    if (typeof msg.sig !== 'string' || !verifySignature(secret, canonical(msg), msg.sig)) {
      throw new AuthError('Invalid agent message signature.');
    }
    const now = Number.isFinite(opts.now) ? opts.now : Date.now();
    const skew = Number.isFinite(opts.skewMs) ? opts.skewMs : DEFAULT_SKEW_MS;
    if (Math.abs(now - msg.ts) > skew) throw new ValidationError('Agent message timestamp outside the allowed window.');
    if (opts.guard && typeof opts.guard.replay === 'function') {
      if (!opts.guard.replay(msg.id, msg.nonce, msg.ts)) throw new ValidationError('Replayed agent message rejected.');
    }
    return msg;
  }

  return { encode, decode, PROTOCOL_VERSION: version, TYPES, canonical };
}

/**
 * Bounded replay + duplicate-delivery guard. Remembers message ids and nonces
 * for ttlMs (capped at max entries), so replayed or duplicated deliveries are
 * rejected while genuine retries within the window are still safe.
 * @param {{ ttlMs?:number, max?:number }} [opts]
 */
function createGuard({ ttlMs = 120000, max = 10000 } = {}) {
  const ids = new Map();     // id -> expiresAt
  const nonces = new Map();  // nonce -> expiresAt

  function prune(map, now) {
    for (const [k, exp] of map) {
      if (exp > now) break; // insertion order ≈ expiry order (fixed ttl)
      map.delete(k);
    }
    while (map.size > max) { map.delete(map.keys().next().value); }
  }

  return {
    /** @returns {boolean} true if newly seen (accept), false if replayed (reject) */
    replay(id, nonce, ts) {
      const now = Date.now();
      prune(ids, now); prune(nonces, now);
      const exp = now + ttlMs;
      if (ids.has(id) || nonces.has(nonce)) return false;
      ids.set(id, exp); nonces.set(nonce, exp);
      // cap after insertion too, so `max` is a hard bound and not max+1
      prune(ids, now); prune(nonces, now);
      return true;
    },
    /** @returns {boolean} true the first time an id is seen (do the work once) */
    once(id) {
      const now = Date.now();
      prune(ids, now);
      if (ids.has(id)) return false;
      ids.set(id, now + ttlMs);
      prune(ids, now);
      return true;
    },
    size: () => ids.size + nonces.size
  };
}

module.exports = { createAgentProtocol, createGuard, canonical, PROTOCOL_VERSION, TYPES, DEFAULT_SKEW_MS };
