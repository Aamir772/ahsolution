/* ==========================================================================
   netlify/functions/_shared/supabase-rest.cjs
   Zero-dependency Supabase helpers for AH Solution.

   * Supabase talks plain HTTPS JSON — no SDK is required, so the functions
     have no package.json dependencies at all.
   * The service-role key never leaves the server: privileged calls go through
     these helpers, and the browser only ever holds a Supabase *user* JWT.
   * Public reads are limited to published rows by the helpers below.
   ========================================================================== */
'use strict';

/* ------------------------------------------------------------------ *
 * HTTP plumbing
 * ------------------------------------------------------------------ */

function env(name) { return process.env[name] || ''; }

function serviceConfig() {
  const url = env('SUPABASE_URL').replace(/\/$/, '');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return null;
  return { url, key };
}

async function sbFetch(path, options) {
  const cfg = serviceConfig();
  if (!cfg) throw new Error('missing_keys');
  const res = await fetch(cfg.url + path, Object.assign({
    headers: {
      apikey: cfg.key,
      Authorization: 'Bearer ' + cfg.key,
      'Content-Type': 'application/json'
    }
  }, options || {}));
  return res;
}

/* ------------------------------------------------------------------ *
 * CORS — same allowlist idea as solution-ai-chat
 * ------------------------------------------------------------------ */
function allowedOrigin(origin) {
  if (!origin) return null;
  let host;
  try { host = new URL(origin).hostname; } catch (e) { return null; }
  if (host === 'localhost' || host === '127.0.0.1') return origin;
  if (host === 'ahsolution.live' || host === 'www.ahsolution.live') return origin;
  const extra = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (extra.includes('*')) return origin;
  return extra.includes(host) ? origin : null;
}

function corsHeaders(event) {
  const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';
  const allow = allowedOrigin(origin) || origin || '*';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}

function json(event, statusCode, body, extraHeaders) {
  const headers = Object.assign(
    { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' },
    corsHeaders(event),
    extraHeaders || {}
  );
  return { statusCode, headers, body: JSON.stringify(body) };
}

/* ------------------------------------------------------------------ *
 * Auth — verify a Supabase user JWT, then require an admin email
 * ------------------------------------------------------------------ */
function bearer(event) {
  const h = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

async function userFromToken(token) {
  const cfg = serviceConfig();
  if (!cfg) throw new Error('missing_keys');
  const res = await fetch(cfg.url + '/auth/v1/user', {
    headers: { apikey: cfg.key, Authorization: 'Bearer ' + token }
  });
  if (!res.ok) return null;
  try { return await res.json(); } catch (e) { return null; }
}

function adminEmails() {
  return (process.env.ADMIN_EMAILS || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function isAdmin(user) {
  if (!user || !user.email) return false;
  const email = String(user.email).toLowerCase();
  const list = adminEmails();
  if (list.length) return list.includes(email);
  // No allowlist configured: fall back to the app_metadata role claim.
  const meta = user.app_metadata || user.app_metadata || {};
  return meta.role === 'admin' || (Array.isArray(meta.roles) && meta.roles.includes('admin'));
}

/**
 * Resolve the request to an admin user, or return an error response.
 * Returns { ok:true, user } or { ok:false, response }.
 */
async function requireAdmin(event) {
  const token = bearer(event);
  if (!token) {
    return { ok: false, response: json(event, 401, { ok: false, error: 'auth_required' }) };
  }
  const user = await userFromToken(token);
  if (!user) {
    return { ok: false, response: json(event, 401, { ok: false, error: 'invalid_token' }) };
  }
  if (!isAdmin(user)) {
    return { ok: false, response: json(event, 403, { ok: false, error: 'forbidden' }) };
  }
  return { ok: true, user };
}

/* ------------------------------------------------------------------ *
 * Validation helpers
 * ------------------------------------------------------------------ */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function cleanSlug(input) {
  return String(input || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

function str(input, max) {
  if (input === undefined || input === null) return '';
  return String(input).slice(0, max || 2000);
}

function tagsToString(input) {
  if (Array.isArray(input)) return input.map((t) => String(t).trim()).filter(Boolean).slice(0, 12).join(', ');
  return str(input, 200);
}

/* ------------------------------------------------------------------ *
 * HTML sanitiser (allowlist) — body copy is authored in the admin panel,
 * but pasted markup must never be able to run script or load remote code.
 * ------------------------------------------------------------------ */
const ALLOWED_TAGS = new Set([
  'p', 'br', 'hr', 'h2', 'h3', 'h4',
  'ul', 'ol', 'li',
  'strong', 'b', 'em', 'i', 'u', 's', 'mark', 'small', 'sub', 'sup',
  'code', 'pre', 'blockquote', 'figure', 'figcaption',
  'a', 'img', 'span', 'iframe',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption'
]);
const VOID_TAGS = new Set(['br', 'hr', 'img']);
const ALLOWED_ATTRS = {
  a: ['href', 'target', 'rel', 'title'],
  img: ['src', 'alt', 'width', 'height', 'loading'],
  iframe: ['src', 'title', 'width', 'height', 'loading', 'referrerpolicy', 'allow', 'allowfullscreen', 'frameborder'],
  th: ['colspan', 'rowspan', 'scope'],
  td: ['colspan', 'rowspan'],
  '*': ['class']
};
const SAFE_URL = /^(https?:\/\/|mailto:|\/|\.\/|\.\.\/|#)/i;

/* Only YouTube's privacy-enhanced / standard embed player may be framed.
   Everything else (ads, third-party widgets, javascript: iframes) is dropped. */
const EMBED_URL = /^https:\/\/www\.youtube(?:-nocookie)?\.com\/embed\/[A-Za-z0-9_-]{6,20}(?:[?&][A-Za-z0-9_=&%-]*)?$/;

function safeEmbedUrl(value) {
  const v = String(value || '').trim();
  return EMBED_URL.test(v) ? v : '';
}

function safeUrl(value) {
  const v = String(value || '').trim();
  if (!v) return '';
  if (/^(javascript|data|vbscript|file):/i.test(v)) return '';
  return SAFE_URL.test(v) ? v : '';
}

function sanitizeAttrs(tag, raw) {
  const allowed = (ALLOWED_ATTRS[tag] || []).concat(ALLOWED_ATTRS['*']);
  const out = [];
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m;
  while ((m = re.exec(raw))) {
    const name = m[1].toLowerCase();
    if (!allowed.includes(name)) continue;
    if (name.startsWith('on')) continue;
    let value = m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : (m[5] || ''));
    if (name === 'src') {
      value = tag === 'iframe' ? safeEmbedUrl(value) : safeUrl(value);
      if (!value) continue;
    }
    if (name === 'href') {
      value = safeUrl(value);
      if (!value) continue;
    }
    if (name === 'target') {
      if (!/^_blank$/i.test(value)) continue;
      out.push('target="_blank" rel="noopener noreferrer"');
      continue;
    }
    if (name === 'rel') continue; // always forced with target=_blank above
    if (name === 'loading' && !/^lazy$/i.test(value)) continue;
    if ((name === 'width' || name === 'height') && !/^\d{1,4}$/.test(value)) continue;
    if (name === 'frameborder' && !/^[01]$/.test(value)) continue;
    out.push(name + '="' + String(value).replace(/"/g, '&quot;') + '"');
  }
  // bare boolean attribute on embeds: allowfullscreen / allowfullscreen=""
  if (tag === 'iframe' && /\ballowfullscreen\b/i.test(raw) && !/allowfullscreen\s*=/i.test(raw)) {
    out.push('allowfullscreen');
  }
  return out.length ? ' ' + out.join(' ') : '';
}

/* Keep only genuine YouTube embeds; drop every other iframe (incl. empty src). */
function keepEmbedIframe(full, attrs) {
  const m = /src\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attrs || '');
  const raw = m ? (m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : (m[4] || ''))) : '';
  return safeEmbedUrl(raw) ? '<iframe' + (attrs || '') + '></iframe>' : '';
}

function sanitizeHtml(html) {
  let src = String(html || '');
  // 1. drop whole elements that can execute or fetch code
  src = src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|object|embed|link|meta|base|form|input|button|textarea|select|video|audio|source)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|style|object|embed|link|meta|base|form|input|button|textarea|select|video|audio|source)\b[^>]*\/?>/gi, '')
    // iframes survive only when they point at the YouTube embed player
    .replace(/<iframe\b([^>]*)>[\s\S]*?<\/iframe\s*>/gi, keepEmbedIframe)
    .replace(/<iframe\b([^>]*?)\/?>/gi, keepEmbedIframe);
  // 2. rebuild from an allowlist
  let out = '';
  const re = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let last = 0;
  let m;
  while ((m = re.exec(src))) {
    out += escapeText(src.slice(last, m.index));
    last = re.lastIndex;
    const tag = m[1].toLowerCase();
    const closing = m[0].charAt(1) === '/';
    if (!ALLOWED_TAGS.has(tag)) continue; // drop the tag, keep inner text
    if (closing) {
      if (!VOID_TAGS.has(tag)) out += '</' + tag + '>';
    } else {
      const attrs = sanitizeAttrs(tag, m[2] || '');
      // an iframe without a surviving embed src is useless — drop the element
      if (tag === 'iframe' && attrs.indexOf('src=') === -1) continue;
      out += '<' + tag + attrs + (VOID_TAGS.has(tag) ? ' />' : '>');
    }
  }
  out += escapeText(src.slice(last));
  return out.trim();
}

function escapeText(s) {
  return String(s || '').replace(/&(?!#?\w+;)/g, '&amp;');
}

/* ------------------------------------------------------------------ *
 * Articles table access
 * ------------------------------------------------------------------ */
const ARTICLE_COLUMNS = 'id,slug,title,excerpt,body,cover_image_url,category,tags,status,seo_description,reading_minutes,created_at,updated_at,published_at,author_email,view_count';

function articleRow(payload) {
  const status = ['draft', 'published', 'archived'].includes(payload.status) ? payload.status : 'draft';
  const bodyHtml = sanitizeHtml(payload.body);
  const plain = bodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const words = plain ? plain.split(' ').length : 0;
  return {
    title: str(payload.title, 200).trim(),
    slug: cleanSlug(payload.slug || payload.title),
    excerpt: str(payload.excerpt, 400),
    body: bodyHtml,
    cover_image_url: str(payload.cover_image_url, 400),
    category: str(payload.category, 50),
    tags: tagsToString(payload.tags),
    seo_description: str(payload.seo_description, 300) || str(payload.excerpt, 300),
    reading_minutes: Math.max(1, Math.round(words / 200)),
    status
  };
}

async function slugTaken(slug, exceptId) {
  let path = '/rest/v1/articles?select=id&slug=eq.' + encodeURIComponent(slug) + '&limit=1';
  if (exceptId) path += '&id=neq.' + encodeURIComponent(exceptId);
  const res = await sbFetch(path);
  if (!res.ok) throw new Error('lookup_failed');
  const rows = await res.json();
  return rows.length > 0;
}

async function insertArticle(row, authorEmail) {
  const res = await sbFetch('/rest/v1/articles', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(Object.assign({}, row, { author_email: authorEmail || null }))
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.message) || 'insert_failed');
  return data[0] || data;
}

async function updateArticle(id, row) {
  row.updated_at = new Date().toISOString();
  const res = await sbFetch('/rest/v1/articles?id=eq.' + encodeURIComponent(id), {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(row)
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.message) || 'update_failed');
  return data[0] || data;
}

async function deleteArticle(id) {
  const res = await sbFetch('/rest/v1/articles?id=eq.' + encodeURIComponent(id), { method: 'DELETE' });
  if (!res.ok) throw new Error('delete_failed');
  return true;
}

async function listArticles(opts) {
  const o = opts || {};
  const params = ['select=' + ARTICLE_COLUMNS];
  if (o.publishedOnly) params.push('status=eq.published');
  if (o.status) params.push('status=eq.' + encodeURIComponent(o.status));
  if (o.slug) params.push('slug=eq.' + encodeURIComponent(o.slug));
  if (o.category) params.push('category=eq.' + encodeURIComponent(o.category));
  const limit = Math.min(100, Math.max(1, Number(o.limit) || 24));
  const offset = Math.max(0, Number(o.offset) || 0);
  params.push('order=' + (o.order || 'published_at.desc.nullslast,created_at.desc'));
  params.push('limit=' + limit);
  params.push('offset=' + offset);
  const res = await sbFetch('/rest/v1/articles?' + params.join('&'));
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.message) || 'list_failed');
  return { rows: data || [], limit, offset };
}

async function bumpViews(id) {
  try {
    // backed by the increment_view(p_id uuid) RPC in the migration
    await sbFetch('/rest/v1/rpc/increment_view', {
      method: 'POST',
      body: JSON.stringify({ p_id: id })
    });
  } catch (e) { /* never fail a read because of a counter */ }
}

module.exports = {
  env, serviceConfig, sbFetch, json, corsHeaders, allowedOrigin,
  bearer, userFromToken, isAdmin, requireAdmin,
  SLUG_RE, cleanSlug, str, tagsToString,
  sanitizeHtml, articleRow, slugTaken, insertArticle, updateArticle,
  deleteArticle, listArticles, bumpViews, ARTICLE_COLUMNS
};
