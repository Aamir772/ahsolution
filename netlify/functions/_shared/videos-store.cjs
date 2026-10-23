/* ==========================================================================
   netlify/functions/_shared/videos-store.cjs
   Durable store for the hourly YouTube dataset.

   Reuses the Upstash Redis REST credentials already used by the localize
   function (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN) instead of
   adding new infrastructure. Zero SDK dependencies: plain HTTPS commands
   through the /pipeline endpoint.

   Keys:
     ah:yt:dataset:v1   envelope { version, dataset, syncedAt, source }
     ah:yt:sync:v1      last attempt/success metadata for the status line
     ah:yt:refresh:lock:v1  short-lived NX lock so two workers cannot publish
                            conflicting datasets at the same time
   ========================================================================== */
'use strict';

const DATA_KEY = 'ah:yt:dataset:v1';
const STATUS_KEY = 'ah:yt:sync:v1';
const LOCK_KEY = 'ah:yt:refresh:lock:v1';
const TIMEOUT_MS = 8000;
const UNLOCK_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

function config() {
  const url = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || '';
  return url && token ? { url, token } : null;
}

function configured() { return !!config(); }

async function pipeline(commands) {
  const cfg = config();
  if (!cfg) throw new Error('store_not_configured');
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
  try {
    const res = await fetch(cfg.url + '/pipeline', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(commands),
      signal: ctrl ? ctrl.signal : undefined
    });
    if (!res.ok) throw new Error('store_http_' + res.status);
    const out = await res.json();
    if (!Array.isArray(out)) throw new Error('store_bad_response');
    const failed = out.find((r) => r && r.error);
    if (failed) throw new Error('store_error:' + String(failed.error).slice(0, 80));
    return out;
  } catch (err) {
    if (err && err.name === 'AbortError') throw new Error('store_timeout');
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function parse(value) {
  if (typeof value !== 'string' || !value) return null;
  try { return JSON.parse(value); } catch (e) { return null; }
}

async function readAll() {
  const out = await pipeline([['GET', DATA_KEY], ['GET', STATUS_KEY]]);
  const envelope = parse(out[0] && out[0].result);
  const status = parse(out[1] && out[1].result);
  const valid = envelope && envelope.dataset && typeof envelope.dataset === 'object' ? envelope : null;
  return { envelope: valid, status };
}

async function writeDataset(envelope) {
  await pipeline([['SET', DATA_KEY, JSON.stringify(envelope)]]);
  return envelope;
}

async function writeStatus(status) {
  await pipeline([['SET', STATUS_KEY, JSON.stringify(status)]]);
  return status;
}

async function acquireLock(token, ttlMs) {
  const ttl = Math.max(15000, Math.min(Number(ttlMs) || 120000, 600000));
  const out = await pipeline([['SET', LOCK_KEY, token, 'NX', 'PX', String(ttl)]]);
  return !!(out[0] && out[0].result === 'OK');
}

async function releaseLock(token) {
  try {
    await pipeline([['EVAL', UNLOCK_SCRIPT, '1', LOCK_KEY, token]]);
  } catch (e) { /* the TTL expires the lock anyway */ }
}

module.exports = {
  keys: { DATA_KEY, STATUS_KEY, LOCK_KEY },
  configured,
  readAll,
  writeDataset,
  writeStatus,
  acquireLock,
  releaseLock
};
