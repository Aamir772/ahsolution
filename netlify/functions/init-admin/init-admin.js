/* ==========================================================================
   netlify/functions/init-admin/init-admin.js
   One-time bootstrap: create the first administrator account.

   POST /.netlify/functions/init-admin
   headers: { Authorization: 'Bearer <ADMIN_SETUP_TOKEN>' }
   body:    { email, password }

   Environment:
     SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (never sent to the browser)
     ADMIN_SETUP_TOKEN                         (one-time shared secret)
     ADMIN_EMAILS                              (comma separated allowlist)

   After the user exists, sign in at /admin/login.html.
   ========================================================================== */
'use strict';

const { json, env, sbFetch, serviceConfig } = require('../_shared/supabase-rest.cjs');

const fail = (event, code, status) => json(event, status, { ok: false, error: code });

exports.handler = async (event) => {
  const method = event.httpMethod || 'GET';
  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: json(event, 204, {}).headers, body: '' };
  }
  if (method !== 'POST') return fail(event, 'method_not_allowed', 405);

  if (!serviceConfig()) return fail(event, 'missing_keys', 500);
  const token = env('ADMIN_SETUP_TOKEN');
  if (!token) return fail(event, 'setup_disabled', 403);

  const header = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  if (!new RegExp('^Bearer\\s+' + token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i').test(header)) {
    return fail(event, 'forbidden', 403);
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch (e) { return fail(event, 'bad_json', 400); }

  const email = String(payload.email || '').trim().toLowerCase();
  const password = String(payload.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(event, 'invalid_email', 400);
  if (password.length < 10) return fail(event, 'password_too_short', 400);

  try {
    // GoTrue admin API — creates the user without needing a login session.
    const res = await sbFetch('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        app_metadata: { role: 'admin' },
        user_metadata: { role: 'admin' }
      })
    });
    const data = await res.json().catch(() => null);
    if (!res.ok && res.status !== 422) {
      return json(event, 502, { ok: false, error: 'auth_create_failed', detail: String((data && data.message) || res.status) });
    }
    const userId = data && (data.id || (data.user && data.user.id));

    if (userId) {
      // record the admin in the admins table (idempotent)
      await sbFetch('/rest/v1/admins', {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates' },
        body: JSON.stringify([{ id: userId, email }])
      }).catch(() => {});
    }

    const allow = (env('ADMIN_EMAILS') || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    return json(event, 200, {
      ok: true,
      created: res.status !== 422,
      already_exists: res.status === 422,
      user_id: userId || null,
      allowlisted: allow.includes(email) || allow.length === 0
    });
  } catch (e) {
    return json(event, 500, { ok: false, error: 'server_error', detail: String((e && e.message) || e).slice(0, 200) });
  }
};
