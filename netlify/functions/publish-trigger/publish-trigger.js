/* ==========================================================================
   netlify/functions/publish-trigger/publish-trigger.js
   Secure Netlify build trigger for the AH Solution CMS.

   Accepts an authorized admin request and triggers a Netlify build
   via a server-side build hook URL. The browser never sees the hook URL.

   POST { action: 'trigger', reason?: 'publish'|'unpublish'|'update' }

   Responses:
     202 { ok: true, status: 'accepted', trigger_id: '...' }
     401 { ok: false, error: 'auth_required' | 'invalid_token' }
     403 { ok: false, error: 'forbidden' }
     400 { ok: false, error: 'invalid_request' | 'missing_action' }
     500 { ok: false, error: 'configuration_error' | 'trigger_failed' }
     429 { ok: false, error: 'rate_limited' }

   Environment:
     NETLIFY_BUILD_HOOK_URL  — server-side build hook (never in browser)
     SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAILS (existing)
   ========================================================================== */
'use strict';

const crypto = require('crypto');
const {
  json, requireAdmin, serviceConfig, sbFetch,
  str
} = require('../_shared/supabase-rest.cjs');

const fail = (event, code, status, extra) => json(event, status, Object.assign({ ok: false, error: code }, extra || {}));

/* ------------------------------------------------------------------ *
 * Rate limiter (per-IP, in-memory, same pattern as articles.js)
 * ------------------------------------------------------------------ */
const RATE_LIMIT = Number(process.env.PUBLISH_TRIGGER_RATE_LIMIT || 10);
const RATE_WINDOW_MS = Number(process.env.PUBLISH_TRIGGER_RATE_WINDOW_MS || 300000);
const rateBuckets = new Map();

function clientIp(event) {
  const h = event.headers || {};
  return (h['x-nf-client-connection-ip'] || (h['x-forwarded-for'] || '').split(',')[0] ||
    (h['client-ip'] || '')).trim() || 'unknown';
}

function checkRate(event) {
  const ip = clientIp(event);
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.start > RATE_WINDOW_MS) {
    bucket = { start: now, count: 0 };
    rateBuckets.set(ip, bucket);
  }
  bucket.count++;
  return bucket.count <= RATE_LIMIT;
}

/* ------------------------------------------------------------------ *
 * Duplicate trigger protection (per-instance, 5-minute window)
 * ------------------------------------------------------------------ */
const recentTriggers = new Map();
const DEDUP_WINDOW_MS = 300000; // 5 minutes

function isDuplicate(triggerKey) {
  const now = Date.now();
  const last = recentTriggers.get(triggerKey);
  if (last && now - last < DEDUP_WINDOW_MS) return true;
  recentTriggers.set(triggerKey, now);
  return false;
}

/* ------------------------------------------------------------------ *
 * Handler
 * ------------------------------------------------------------------ */
exports.handler = async (event) => {
  const method = event.httpMethod || 'GET';
  const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: json(event, 204, {}).headers, body: '' };
  }

  if (method !== 'POST') {
    return fail(event, 'method_not_allowed', 405);
  }

  if (!serviceConfig()) return fail(event, 'missing_keys', 500);

  if (!checkRate(event)) {
    return fail(event, 'rate_limited', 429, { retry_after_ms: RATE_WINDOW_MS });
  }

  /* Auth: verify admin JWT */
  const auth = await requireAdmin(event);
  if (!auth.ok) return auth.response;

  /* Parse body */
  let payload;
  try {
    payload = event.body ? JSON.parse(event.body) : {};
  } catch (e) {
    return fail(event, 'bad_json', 400);
  }

  const action = str(payload.action, 40).trim();
  if (action !== 'trigger') {
    return fail(event, 'invalid_request', 400, { detail: 'action must be "trigger"' });
  }

  const reason = str(payload.reason, 40).trim() || 'publish';
  const allowedReasons = ['publish', 'unpublish', 'update', 'archive', 'restore'];
  if (!allowedReasons.includes(reason)) {
    return fail(event, 'invalid_request', 400, { detail: 'invalid reason' });
  }

  /* Build hook URL from server-side env var */
  const buildHookUrl = process.env.NETLIFY_BUILD_HOOK_URL;
  if (!buildHookUrl) {
    /* Log configuration error (no sensitive data) */
    console.error('[publish-trigger] NETLIFY_BUILD_HOOK_URL not configured');
    return fail(event, 'configuration_error', 500, { detail: 'Build hook not configured' });
  }

  /* Duplicate trigger protection */
  const triggerKey = auth.user.email + ':' + reason + ':' + (payload.article_id || 'global');
  if (isDuplicate(triggerKey)) {
    return json(event, 202, {
      ok: true,
      status: 'accepted',
      detail: 'Duplicate trigger suppressed (recent trigger within 5 minutes)',
      trigger_id: null
    });
  }

  /* Trigger the build */
  const triggerId = crypto.randomUUID();
  try {
    const res = await fetch(buildHookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger_id: triggerId, reason: reason, triggered_by: auth.user.email })
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[publish-trigger] Build hook failed: HTTP ' + res.status);
      return fail(event, 'trigger_failed', 502, { detail: 'Build hook returned ' + res.status });
    }

    /* Log success (no sensitive data) */
    console.log('[publish-trigger] Build triggered: reason=' + reason + ' by=' + auth.user.email + ' trigger_id=' + triggerId);

    return json(event, 202, {
      ok: true,
      status: 'accepted',
      detail: 'Build triggered. Deployment will complete asynchronously.',
      trigger_id: triggerId
    });
  } catch (e) {
    console.error('[publish-trigger] Build hook request failed: ' + (e && e.message ? e.message : e));
    return fail(event, 'trigger_failed', 502, { detail: 'Build hook request failed' });
  }
};
