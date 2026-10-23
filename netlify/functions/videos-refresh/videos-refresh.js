/* ==========================================================================
   netlify/functions/videos-refresh/videos-refresh.js
   Hourly server-side YouTube sync for AH Solution.

   Invocation:
     - Netlify Scheduled Function, cron "0 * * * *" (see netlify.toml).
       Netlify sets event.next_run on scheduled invocations.
     - Optional manual run: POST/GET with an Authorization: Bearer
       VIDEOS_REFRESH_TOKEN or X-AH-Refresh-Token header. Manual runs are
       rejected unless VIDEOS_REFRESH_TOKEN is configured.

   Behaviour:
     - Fetches the public channel RSS (and YouTube Data API counts when
       YT_API_KEY is present) using the shared feed builder.
     - Validates the payload before publishing; an empty/malformed feed never
       overwrites the known-good dataset.
     - Rejects implausible feed shrinkage (more than 50% of a previously
       healthy dataset) unless VIDEOS_ALLOW_FEED_SHRINK=1.
     - Publishes { dataset, syncedAt } to the durable Upstash store read by
       videos-fresh (/api/videos). The static assets/data/videos.json snapshot
       stays as an offline fallback.
     - Uses an NX lock so concurrent workers cannot publish conflicting data.
     - Records last attempt/success metadata; failures keep the last good
       dataset and surface a sanitized status to the public endpoint.
   ========================================================================== */
'use strict';

const crypto = require('crypto');
const feed = require('../_shared/youtube-feed.cjs');
const store = require('../_shared/videos-store.cjs');

const LOCK_TTL_MS = 120000;
const allowShrink = () => process.env.VIDEOS_ALLOW_FEED_SHRINK === '1';

function reply(statusCode, body, extraHeaders) {
  return {
    statusCode,
    headers: Object.assign({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }, extraHeaders || {}),
    body: JSON.stringify(body)
  };
}

function header(event, name) {
  const headers = (event && event.headers) || {};
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key];
  }
  return '';
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (!ab.length || ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function authorized(event) {
  if (event && event.next_run) return true;
  const expected = process.env.VIDEOS_REFRESH_TOKEN || '';
  if (!expected) return false;
  const bearer = (header(event, 'authorization').match(/^Bearer\s+(.+)$/i) || [])[1];
  const custom = header(event, 'x-ah-refresh-token');
  return (!!bearer && safeEqual(bearer.trim(), expected)) || (!!custom && safeEqual(custom.trim(), expected));
}

function cleanError(err) {
  return String(err && err.message || err)
    .replace(/\bkey=[^&\s]+/gi, 'key=***')
    .replace(/Bearer\s+\S+/gi, 'Bearer ***')
    .slice(0, 160);
}

exports.handler = async (event) => {
  const started = Date.now();
  if (!authorized(event)) {
    return reply(401, { ok: false, error: 'unauthorized' });
  }
  if (!store.configured()) {
    return reply(503, {
      ok: false,
      error: 'store_not_configured',
      message: 'Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN so the hourly sync has a durable destination.'
    });
  }

  const lockToken = crypto.randomBytes(12).toString('hex');
  let locked = false;
  const attemptedAt = new Date().toISOString();

  try {
    locked = await store.acquireLock(lockToken, LOCK_TTL_MS);
    if (!locked) {
      return reply(409, { ok: false, error: 'refresh_in_progress' });
    }

    let previous = null;
    try {
      previous = await store.readAll();
    } catch (e) {
      previous = null; // a read failure must not block a valid publish
    }

    let dataset;
    try {
      dataset = await feed.buildDataset();
    } catch (err) {
      const status = {
        ok: false,
        lastAttemptAt: attemptedAt,
        lastSuccessAt: (previous && previous.status && previous.status.lastSuccessAt) ||
          (previous && previous.envelope && previous.envelope.syncedAt) || null,
        lastError: cleanError(err)
      };
      try { await store.writeStatus(status); } catch (e) { /* keep serving last good */ }
      return reply(502, {
        ok: false,
        error: 'refresh_failed',
        message: 'YouTube feed unavailable; the previously saved dataset was kept.',
        lastSuccessAt: status.lastSuccessAt
      });
    }

    const prevVideos = previous && previous.envelope && previous.envelope.dataset &&
      Array.isArray(previous.envelope.dataset.videos) ? previous.envelope.dataset.videos.length : 0;
    if (!allowShrink() && prevVideos >= 6 && dataset.videos.length < Math.ceil(prevVideos / 2)) {
      const status = {
        ok: false,
        lastAttemptAt: attemptedAt,
        lastSuccessAt: (previous && previous.status && previous.status.lastSuccessAt) ||
          (previous && previous.envelope && previous.envelope.syncedAt) || null,
        lastError: 'implausible_feed_shrink:' + dataset.videos.length + '_of_' + prevVideos
      };
      try { await store.writeStatus(status); } catch (e) { /* ignore */ }
      return reply(502, {
        ok: false,
        error: 'refresh_rejected',
        message: 'Feed shrank unexpectedly; the previously saved dataset was kept.',
        lastSuccessAt: status.lastSuccessAt
      });
    }

    const syncedAt = new Date().toISOString();
    await store.writeDataset({
      version: 1,
      dataset,
      syncedAt,
      source: dataset.source
    });
    await store.writeStatus({
      ok: true,
      lastAttemptAt: attemptedAt,
      lastSuccessAt: syncedAt,
      lastError: null,
      datasetGeneratedAt: dataset.generatedAt,
      videoCount: dataset.videos.length
    });

    return reply(200, {
      ok: true,
      syncedAt,
      source: dataset.source,
      videos: dataset.videos.length,
      durationMs: Date.now() - started
    }, { 'X-Sync-Store': 'upstash' });
  } catch (err) {
    return reply(500, {
      ok: false,
      error: 'refresh_error',
      message: cleanError(err)
    });
  } finally {
    if (locked) await store.releaseLock(lockToken);
  }
};
