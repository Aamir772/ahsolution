/* ==========================================================================
   server/security.js — authentication, authorization & secret handling

   Principals
     admin   — full control (Supabase admin user, or AH_ADMIN_TOKEN in dev)
     agent   — the separately-authenticated local Windows agent (AH_AGENT_TOKEN)
     user    — a Supabase-authenticated non-admin user (future)
     anon    — no credential

   The hosted model/website NEVER holds admin or agent credentials. The agent
   token is intentionally a separate secret from the admin token so a
   compromised browser session cannot drive local execution.
   ========================================================================== */
'use strict';

const crypto = require('crypto');
const { AuthError, ForbiddenError } = require('./errors');

const ROLES = { anon: 0, user: 1, agent: 2, admin: 3 };

/** Constant-time string compare that is safe for unequal lengths. */
function timingSafeEqualStr(a, b) {
  const ab = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (ab.length !== bb.length) {
    // Compare against itself to keep timing flat, then fail.
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

function bearerFrom(req) {
  const h = req && req.headers ? (req.headers.authorization || '') : '';
  const m = /^Bearer\s+(.+)$/i.exec(String(h).trim());
  return m ? m[1].trim() : '';
}

/** HMAC-SHA256 signature (hex) used to authenticate local-agent messages. */
function sign(secret, payload) {
  return crypto.createHmac('sha256', String(secret)).update(String(payload)).digest('hex');
}
function verifySignature(secret, payload, signature) {
  return timingSafeEqualStr(sign(secret, payload), signature);
}

function looksLikeJwt(t) { return /^[\w-]+\.[\w-]+\.[\w-]+$/.test(String(t || '')); }

/**
 * @param {object} config
 * @param {{warn:Function}} [logger]
 */
function createAuth(config, logger) {
  const log = logger;
  const canSupabase = !!(config.auth.supabaseUrl && (config.auth.supabaseAnonKey || config.auth.supabaseServiceRoleKey));

  async function verifySupabaseToken(token) {
    try {
      const apiKey = config.auth.supabaseAnonKey || config.auth.supabaseServiceRoleKey;
      const res = await fetch(`${config.auth.supabaseUrl}/auth/v1/user`, {
        headers: { apikey: apiKey, Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000)
      });
      if (!res.ok) return null;
      const user = await res.json();
      if (!user || !user.email) return null;
      const email = String(user.email).toLowerCase();
      if (config.auth.adminEmails.includes(email)) return { type: 'admin', id: email };
      // Authenticated but not an allowlisted admin → treated as a normal user.
      return { type: 'user', id: email };
    } catch (e) {
      if (log) log.warn('supabase_verify_failed', { message: e && e.message });
      return null;
    }
  }

  /**
   * Resolve the caller's principal. Never throws for a missing/invalid token.
   * @param {import('http').IncomingMessage} req
   * @returns {Promise<{type:string,id:string}|null>}
   */
  async function authenticate(req) {
    const token = bearerFrom(req);
    if (!token) return null;

    if (config.auth.adminToken && timingSafeEqualStr(token, config.auth.adminToken)) {
      return { type: 'admin', id: 'admin-token' };
    }
    if (config.auth.agentToken && timingSafeEqualStr(token, config.auth.agentToken)) {
      return { type: 'agent', id: 'local-agent' };
    }
    if (canSupabase && looksLikeJwt(token)) {
      return await verifySupabaseToken(token);
    }
    return null;
  }

  function requireRole(principal, minRole) {
    const have = principal ? ROLES[principal.type] ?? 0 : 0;
    const need = ROLES[minRole] ?? 99;
    if (!principal) throw new AuthError();
    if (have < need) throw new ForbiddenError(`This action requires role "${minRole}".`);
    return principal;
  }

  return {
    authenticate,
    requireAuth: (p) => requireRole(p, 'user'),
    requireAdmin: (p) => requireRole(p, 'admin'),
    requireAgent: (p) => requireRole(p, 'agent'),
    canSupabase
  };
}

/* ------------------------------------------------------------------ redaction */

const SECRET_KEY = /(api[_-]?key|token|secret|password|authorization|service[_-]?role|bearer)/i;

/** Mask a secret for display: keep only a short, non-reversible hint. */
function maskToken(t) {
  const s = String(t || '');
  if (!s) return '';
  if (s.length <= 6) return '***';
  return s.slice(0, 3) + '***' + s.slice(-2);
}

/** Redact any secret-looking key from an object tree (defence in depth). */
function redact(obj, depth = 0) {
  if (depth > 6 || obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((v) => redact(v, depth + 1));
  const out = {};
  for (const k of Object.keys(obj)) out[k] = SECRET_KEY.test(k) ? '[redacted]' : redact(obj[k], depth + 1);
  return out;
}

/** Replace known secret strings inside free text (e.g. provider error bodies). */
function scrubText(text, secrets = []) {
  let s = String(text == null ? '' : text);
  for (const sec of secrets) {
    if (sec && typeof sec === 'string' && sec.length >= 6) s = s.split(sec).join('[redacted]');
  }
  return s;
}

module.exports = { createAuth, ROLES, timingSafeEqualStr, bearerFrom, sign, verifySignature, maskToken, redact, scrubText };
