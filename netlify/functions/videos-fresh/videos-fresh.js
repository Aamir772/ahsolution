/* ==========================================================================
   netlify/functions/videos-fresh/videos-fresh.js
   Public YouTube dataset for the AH Solution channel.

   GET /.netlify/functions/videos-fresh  (also mounted at /api/videos)

   Source order:
     1. Durable hourly dataset written by videos-refresh to Upstash
        (X-Fresh-Cache: DURABLE). Includes syncedAt + sync metadata so the
        site can show an honest "last synced" time and failure state.
     2. If the store is unavailable/empty, a live request-time build with a
        short in-process TTL cache (X-Fresh-Cache: LIVE / HIT / STALE).
     3. 503 JSON with no-store when nothing can be produced.

   The API key never leaves the server; errors are sanitized.
   ========================================================================== */
'use strict';

const feed = require('../_shared/youtube-feed.cjs');
const store = require('../_shared/videos-store.cjs');

const TTL_SECONDS = (() => {
  const n = parseInt(process.env.VIDEOS_CACHE_TTL_SECONDS || '900', 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), 86400) : 900;
})();

/* Older than two missed hourly runs -> flag as stale but keep serving. */
const STALE_AFTER_MS = 2 * 60 * 60 * 1000;
const CACHE_CONTROL = 'public, max-age=60, must-revalidate, stale-while-revalidate=300';

let cache = null; // { payload, atMs } for the live fallback path

function payloadFrom(envelope, status) {
  const dataset = envelope.dataset;
  const syncedAt = envelope.syncedAt || dataset.generatedAt || null;
  const syncedMs = Date.parse(syncedAt || '');
  const sync = status ? {
    ok: status.ok !== false,
    lastAttemptAt: status.lastAttemptAt || null,
    lastSuccessAt: status.lastSuccessAt || syncedAt,
    lastError: status.ok === false ? String(status.lastError || 'sync_failed').slice(0, 160) : null
  } : {
    ok: true,
    lastAttemptAt: syncedAt,
    lastSuccessAt: syncedAt,
    lastError: null
  };
  return Object.assign({}, dataset, {
    syncedAt,
    sync,
    stale: !Number.isFinite(syncedMs) || Date.now() - syncedMs > STALE_AFTER_MS
  });
}

function json(payload, extraHeaders, statusCode) {
  return {
    statusCode: statusCode || 200,
    headers: Object.assign({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': CACHE_CONTROL,
      'X-Content-Type-Options': 'nosniff',
      'X-Feed-Source': payload.source || 'unknown'
    }, extraHeaders || {}),
    body: JSON.stringify(payload)
  };
}

exports.handler = async (event) => {
  const method = event && event.httpMethod;
  if (method && method !== 'GET' && method !== 'HEAD') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Allow: 'GET, HEAD' },
      body: JSON.stringify({ error: 'method_not_allowed' })
    };
  }

  if (store.configured()) {
    try {
      const { envelope, status } = await store.readAll();
      if (envelope && feed.validateDataset(envelope.dataset).ok) {
        return json(payloadFrom(envelope, status), { 'X-Fresh-Cache': 'DURABLE', 'X-Data-Synced-At': envelope.syncedAt || '' });
      }
    } catch (e) { /* fall through to the live fallback */ }
  }

  const now = Date.now();
  if (cache && now - cache.atMs < TTL_SECONDS * 1000) {
    return json(cache.payload, { 'X-Fresh-Cache': 'HIT' });
  }
  try {
    const payload = await feed.buildDataset();
    cache = { payload, atMs: now };
    return json(payload, { 'X-Fresh-Cache': 'LIVE' });
  } catch (err) {
    if (cache) return json(cache.payload, { 'X-Fresh-Cache': 'STALE' });
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      body: JSON.stringify({
        error: 'YouTube feed unavailable',
        detail: String(err && err.message || err).replace(/[?&]key=[^&\s]+/gi, '&key=***').slice(0, 120)
      })
    };
  }
};
