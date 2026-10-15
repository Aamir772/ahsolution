/* ==========================================================================
   netlify/functions/admin-auth/admin-auth.js
   Password sign-in and password reset for the admin panel, proxied so the Supabase
   anon key never has to be shipped to the browser.

   POST { action:'login',   email, password }
   POST { action:'refresh', refresh_token }
   POST { action:'me' }                      (Bearer: access token)
   POST { action:'send_password_reset', email }  (supabase GoTrue password reset)
   POST { action:'update_password', password }   (verify reset token + update pwd)
   POST { action:'me' }                      (Bearer: access token)

   Environment: SUPABASE_URL, SUPABASE_ANON_KEY  (the publishable key)
   ========================================================================== */
'use strict';

const { json, env, serviceConfig, userFromToken, isAdmin } = require('../_shared/supabase-rest.cjs');

const fail = (event, code, status, extra) => json(event, status, Object.assign({ ok: false, error: code }, extra || {}));

function authHeaders() {
  const url = env('SUPABASE_URL').replace(/\/$/, '');
  const key = env('SUPABASE_ANON_KEY') || env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return null;
  return { url, headers: { apikey: key, 'Content-Type': 'application/json' } };
}

exports.handler = async (event) => {
  const method = event.httpMethod || 'GET';
  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: json(event, 204, {}).headers, body: '' };
  }
  if (method !== 'POST') return fail(event, 'method_not_allowed', 405);
  if (!serviceConfig()) return fail(event, 'missing_keys', 500);

  const cfg = authHeaders();
  if (!cfg) return fail(event, 'missing_keys', 500);

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch (e) { return fail(event, 'bad_json', 400); }
  const action = payload.action;

  try {
    if (action === 'login') {
      const email = String(payload.email || '').trim().toLowerCase();
      const password = String(payload.password || '');
      if (!email || !password) return fail(event, 'missing_credentials', 400);

      const res = await fetch(cfg.url + '/auth/v1/token?grant_type=password', {
        method: 'POST',
        headers: cfg.headers,
        body: JSON.stringify({ email, password })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = String((data && data.error_description) || (data && data.msg) || data?.error || res.status);
        return fail(event, res.status === 400 || res.status === 401 ? 'bad_credentials' : 'auth_failed', res.status === 400 || res.status === 401 ? 401 : 502, { detail: msg });
      }
      const user = data.user || null;
      if (!isAdmin(user)) {
        return fail(event, 'not_admin', 403);
      }
      return json(event, 200, {
        ok: true,
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
        expires_at: data.expires_at,
        token_type: data.token_type,
        user: publicUser(user)
      });
    }

    if (action === 'refresh') {
      const refreshToken = String(payload.refresh_token || '');
      if (!refreshToken) return fail(event, 'missing_refresh_token', 400);
      const res = await fetch(cfg.url + '/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        headers: cfg.headers,
        body: JSON.stringify({ refresh_token: refreshToken })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) return fail(event, 'refresh_failed', 401);
      const user = data.user || null;
      if (user && !isAdmin(user)) return fail(event, 'not_admin', 403);
      return json(event, 200, {
        ok: true,
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
        expires_at: data.expires_at,
        token_type: data.token_type,
        user: publicUser(user)
      });
    }

    if (action === 'me') {
      const h = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
      const m = /^Bearer\s+(.+)$/i.exec(h);
      if (!m) return fail(event, 'auth_required', 401);
      const user = await userFromToken(m[1].trim());
      if (!user) return fail(event, 'invalid_token', 401);
      if (!isAdmin(user)) return fail(event, 'not_admin', 403);
      return json(event, 200, { ok: true, user: publicUser(user) });
    }

    if (action === 'send_password_reset') {
      const email = String(payload.email || '').trim().toLowerCase();
      if (!email) return fail(event, 'missing_email', 400);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(event, 'invalid_email', 400);

      // Send password reset request via Supabase GoTrue API
      const res = await fetch(cfg.url + '/auth/v1/password_reset', {
        method: 'POST',
        headers: cfg.headers,
        body: JSON.stringify({ email: email })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = String((data && data.error_description) || (data && data.msg) || data?.error || res.status);
        // Distinguish expired link vs other errors
        if (res.status === 410 || msg.toLowerCase().includes('expired') || msg.toLowerCase().includes('invalid')) {
          return fail(event, 'otp_expired', 410, { detail: msg, allow_retry: true });
        }
        return fail(event, 'password_reset_failed', res.status, { detail: msg });
      }
      // Return success - the user will receive an email with a reset link
      // The redirect URL must be configured in Supabase Auth → URL Configuration
      return json(event, 200, {
        ok: true,
        message: 'Password reset link sent to your email address.'
      });
    }

    if (action === 'update_password') {
      const password = String(payload.password || '');
      const jwt = payload.jwt;
      if (!password) return fail(event, 'missing_password', 400);
      if (!jwt) return fail(event, 'missing_jwt', 400);
      if (password.length < 8) return fail(event, 'password_too_short', 400);

      // Verify the reset token and update the password
      // Use the JWT from the reset link as the Bearer token
      const res = await fetch(cfg.url + '/auth/v1/update_password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + jwt
        },
        body: JSON.stringify({ password: password })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        // Token expired or invalid
        if (res.status === 410 || (data && data.error_description && data.error_description.toLowerCase().includes('expired'))) {
          return fail(event, 'otp_expired', 410, { detail: data && data.error_description, allow_retry: true });
        }
        return fail(event, 'password_update_failed', res.status, { detail: data && data.error_description || 'Failed to update password' });
      }
      // Password updated successfully
      return json(event, 200, {
        ok: true,
        message: 'Password updated successfully. You can now sign in with your new password.'
      });
    }

    return fail(event, 'unknown_action', 400);
  } catch (e) {
    return fail(event, 'server_error', 500, { detail: String((e && e.message) || e).slice(0, 200) });
  }
};

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id || null,
    email: user.email || null,
    role: (user.app_metadata && user.app_metadata.role) || 'admin',
    last_sign_in_at: user.last_sign_in_at || null
  };
}