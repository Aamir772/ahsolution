/* ==========================================================================
   server/limits.js — in-process rate limiting

   Fixed-window per key plus an optional daily cap. This is best-effort and
   process-local; the existing Netlify function uses Upstash for durable limits.
   When AH_REQUIRE_DURABLE_LIMIT=1 the server refuses to start a cloud provider
   without a durable limiter (guarded in index.js).
   ========================================================================== */
'use strict';

/**
 * @param {{ limit:number, windowMs:number, dailyLimit?:number }} opts
 */
function createRateLimiter(opts) {
  const limit = opts.limit;
  const windowMs = opts.windowMs;
  const dailyLimit = opts.dailyLimit || 0;

  const buckets = new Map(); // key -> { count, resetAt }
  const days = new Map();    // key -> { count, day }

  function check(key) {
    const now = Date.now();
    const day = new Date(now).toISOString().slice(0, 10);
    let b = buckets.get(key);
    if (!b || now >= b.resetAt) { b = { count: 0, resetAt: now + windowMs }; buckets.set(key, b); }

    let d = days.get(key);
    if (!d || d.day !== day) { d = { count: 0, day }; days.set(key, d); }

    if (dailyLimit && d.count >= dailyLimit) {
      return { ok: false, remaining: 0, retryAfterMs: windowMs, reason: 'daily' };
    }
    if (b.count >= limit) {
      return { ok: false, remaining: 0, retryAfterMs: Math.max(0, b.resetAt - now), reason: 'window' };
    }
    b.count += 1; d.count += 1;
    return { ok: true, remaining: Math.max(0, limit - b.count) };
  }

  function reset(key) { if (key) { buckets.delete(key); days.delete(key); } else { buckets.clear(); days.clear(); } }

  return { check, reset };
}

module.exports = { createRateLimiter };
