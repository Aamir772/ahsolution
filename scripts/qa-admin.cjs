/* ==========================================================================
   qa-admin.cjs — function-level QA for the CMS backend
   Spins up a local mock Supabase (GoTrue + PostgREST + Storage), points the
   Netlify Functions at it via env, and verifies:
     * auth gating (401 / 403) on every privileged route
     * login / refresh / me flows, admin allowlist enforcement
     * create / update / publish / unpublish / delete article flows
     * server-side HTML sanitiser output
     * upload-cover validation (type / size / auth) and public URL shape
     * init-admin setup-token gating
     * the service-role key never appears in any response
   No browser and no network access beyond 127.0.0.1.
   Run: npm run qa:admin
   ========================================================================== */
'use strict';
const http = require('http');

/* ------------------------------------------------------------------ *
 * Environment the functions expect
 * ------------------------------------------------------------------ */
const SERVICE_KEY = 'svc-secret-key-do-not-leak-9f3a';
const ANON_KEY = 'anon-publishable-key-7c2b';
const SETUP_TOKEN = 'setup-token-once-4d1e';
const ADMIN_EMAIL = 'admin@ahsolution.live';
const ADMIN_PASS = 'correct-horse-battery';
const AUTHOR_EMAIL = 'author@example.com';
const AUTHOR_PASS = 'password123';

/* ------------------------------------------------------------------ *
 * In-memory mock Supabase
 * ------------------------------------------------------------------ */
const store = { users: [], tokens: new Map(), refresh: new Map(), articles: [], admins: [], uploads: [] };
let tokenSeq = 0;

function publicUser(u) {
  const { password, ...rest } = u;
  return rest;
}
function issue(u) {
  tokenSeq += 1;
  const access = 'tok_a_' + tokenSeq;
  const refresh = 'tok_r_' + tokenSeq;
  store.tokens.set(access, u.id);
  store.refresh.set(refresh, u.id);
  return {
    access_token: access,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: refresh,
    user: publicUser(u)
  };
}
function userByToken(header) {
  const m = /^Bearer\s+(.+)$/i.exec(header || '');
  if (!m) return null;
  const id = store.tokens.get(m[1].trim());
  return store.users.find((u) => u.id === id) || null;
}
function seed() {
  store.users = [
    { id: 'u-admin', email: ADMIN_EMAIL, password: ADMIN_PASS, app_metadata: { role: 'admin' }, user_metadata: {}, created_at: new Date().toISOString() },
    { id: 'u-author', email: AUTHOR_EMAIL, password: AUTHOR_PASS, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }
  ];
  store.articles = [
    { id: 'a-pub', slug: 'first-published-post', title: 'First published post', excerpt: 'Public excerpt', body: '<p>Public body</p>', cover_image_url: '', category: 'Android', tags: 'android, tips', status: 'published', seo_description: 'Seo text', reading_minutes: 1, author_email: ADMIN_EMAIL, view_count: 0, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', published_at: '2026-01-02T00:00:00.000Z' },
    { id: 'a-draft', slug: 'draft-post', title: 'Draft post', excerpt: '', body: '<p>Secret draft</p>', cover_image_url: '', category: 'Gadgets', tags: '', status: 'draft', seo_description: '', reading_minutes: 1, author_email: ADMIN_EMAIL, view_count: 0, created_at: '2026-01-03T00:00:00.000Z', updated_at: '2026-01-03T00:00:00.000Z', published_at: null }
  ];
  store.admins = [];
  store.uploads = [];
  store.tokens.clear();
  store.refresh.clear();
}
seed();

function jsonRes(res, status, obj) {
  const body = obj === undefined ? '' : JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function matchArticles(params) {
  let rows = store.articles.slice();
  if (params.status) rows = rows.filter((r) => r.status === params.status);
  if (params.slug) rows = rows.filter((r) => r.slug === params.slug);
  if (params.idEq) rows = rows.filter((r) => r.id === params.idEq);
  if (params.idNeq) rows = rows.filter((r) => r.id !== params.idNeq);
  rows.sort((a, b) => String(b.published_at || b.created_at).localeCompare(String(a.published_at || a.created_at)));
  const offset = Number(params.offset) || 0;
  const limit = Number(params.limit) || 100;
  return rows.slice(offset, offset + limit);
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  const p = u.pathname;
  const apikey = req.headers.apikey || '';
  const keyOk = apikey === SERVICE_KEY || apikey === ANON_KEY;
  const chunks = [];
  req.on('data', (c) => { chunks.push(c); });
  req.on('end', () => {
    const rawBuf = Buffer.concat(chunks);
    const raw = rawBuf.toString('utf8');
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch (e) { body = null; }

    /* ---- GoTrue ---- */
    if (p === '/auth/v1/token') {
      if (!keyOk) return jsonRes(res, 401, { msg: 'bad apikey' });
      const grant = u.searchParams.get('grant_type');
      if (grant === 'password') {
        const user = store.users.find((x) => x.email === String(body && body.email).toLowerCase());
        if (!user || user.password !== (body && body.password)) {
          return jsonRes(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
        }
        return jsonRes(res, 200, issue(user));
      }
      if (grant === 'refresh_token') {
        const id = store.refresh.get(body && body.refresh_token);
        const user = store.users.find((x) => x.id === id);
        if (!user) return jsonRes(res, 400, { error: 'invalid_grant', error_description: 'Invalid refresh token' });
        store.refresh.delete(body.refresh_token);
        return jsonRes(res, 200, issue(user));
      }
      return jsonRes(res, 400, { error: 'unsupported_grant_type' });
    }
    if (p === '/auth/v1/user') {
      const user = userByToken(req.headers.authorization);
      if (!user) return jsonRes(res, 401, { msg: 'invalid token' });
      return jsonRes(res, 200, publicUser(user));
    }
    if (p === '/auth/v1/admin/users') {
      if (apikey !== SERVICE_KEY) return jsonRes(res, 401, { msg: 'service role required' });
      const email = String((body && body.email) || '').toLowerCase();
      if (store.users.some((x) => x.email === email)) {
        return jsonRes(res, 422, { code: 422, msg: 'A user with this email address has already been registered' });
      }
      const user = { id: 'u-' + (store.users.length + 1), email, password: body.password, app_metadata: body.app_metadata || {}, user_metadata: body.user_metadata || {}, created_at: new Date().toISOString() };
      store.users.push(user);
      return jsonRes(res, 200, publicUser(user));
    }

    /* ---- PostgREST: articles ---- */
    if (p === '/rest/v1/articles') {
      const idParam = u.searchParams.get('id') || '';
      const params = {
        status: (u.searchParams.get('status') || '').replace(/^eq\./, '') || undefined,
        slug: (u.searchParams.get('slug') || '').replace(/^eq\./, '') || undefined,
        idEq: idParam.startsWith('eq.') ? idParam.slice(3) : undefined,
        idNeq: idParam.startsWith('neq.') ? idParam.slice(4) : undefined,
        limit: u.searchParams.get('limit'),
        offset: u.searchParams.get('offset')
      };
      if (req.method === 'GET') return jsonRes(res, 200, matchArticles(params));
      if (req.method === 'POST') {
        const rows = (Array.isArray(body) ? body : [body]).map((r, i) => Object.assign({
          id: 'a-' + Math.random().toString(36).slice(2, 10) + i,
          view_count: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          published_at: null
        }, r));
        store.articles.push(...rows);
        return jsonRes(res, 201, rows);
      }
      if (req.method === 'PATCH') {
        const id = u.searchParams.get('id').replace(/^eq\./, '');
        const row = store.articles.find((x) => x.id === id);
        if (!row) return jsonRes(res, 404, { message: 'row not found' });
        Object.assign(row, body);
        return jsonRes(res, 200, [row]);
      }
      if (req.method === 'DELETE') {
        const id = u.searchParams.get('id').replace(/^eq\./, '');
        store.articles = store.articles.filter((x) => x.id !== id);
        res.writeHead(204);
        return res.end();
      }
    }
    if (p === '/rest/v1/rpc/increment_view') {
      const row = store.articles.find((x) => x.id === (body && body.p_id));
      if (row) row.view_count = (row.view_count || 0) + 1;
      return jsonRes(res, 200, row || {});
    }
    if (p === '/rest/v1/admins') {
      const rows = Array.isArray(body) ? body : [body];
      rows.forEach((r) => { if (!store.admins.some((a) => a.id === r.id)) store.admins.push(r); });
      return jsonRes(res, 201, store.admins);
    }

    /* ---- Storage ---- */
    if (p.startsWith('/storage/v1/object/covers/')) {
      if (apikey !== SERVICE_KEY) return jsonRes(res, 401, { msg: 'service role required' });
      store.uploads.push({ path: p.slice('/storage/v1/object/covers/'.length), bytes: rawBuf.length, contentType: req.headers['content-type'] });
      return jsonRes(res, 200, { Message: 'Successfully uploaded' });
    }

    return jsonRes(res, 404, { message: 'mock route not found: ' + p });
  });
});

/* ------------------------------------------------------------------ *
 * Test helpers
 * ------------------------------------------------------------------ */
const captured = [];
function counter() {
  const c = { pass: 0, fail: 0 };
  c.ok = (cond, name, extra) => {
    if (cond) { c.pass++; console.log('  ✓ ' + name); }
    else { c.fail++; console.log('  ✗ ' + name + (extra ? '  -> ' + extra : '')); }
  };
  return c;
}
const c = counter();

function ev(opts) {
  const o = opts || {};
  const path = o.path || '/';
  const u = new URL(path, 'http://local.test');
  const q = {};
  u.searchParams.forEach((v, k) => { q[k] = v; });
  const headers = Object.assign({ origin: 'http://localhost:8000' }, o.headers || {});
  return {
    httpMethod: o.method || 'GET',
    path: u.pathname,
    queryStringParameters: q,
    headers,
    body: o.body === undefined || o.body === null ? null : (typeof o.body === 'string' ? o.body : JSON.stringify(o.body))
  };
}

async function call(handler, opts) {
  const event = ev(opts);
  const out = await handler.handler(event);
  let body = null;
  try { body = out.body ? JSON.parse(out.body) : null; } catch (e) { body = out.body || null; }
  const rec = { status: out.statusCode, headers: out.headers || {}, body, raw: out.body || '', label: (opts && opts.label) || '' };
  captured.push(rec);
  return rec;
}

async function main() {
  const articles = require('../netlify/functions/articles/articles.js');
  const adminAuth = require('../netlify/functions/admin-auth/admin-auth.js');
  const uploadCover = require('../netlify/functions/upload-cover/upload-cover.js');
  const initAdmin = require('../netlify/functions/init-admin/init-admin.js');
  const { sanitizeHtml, cleanSlug, SLUG_RE } = require('../netlify/functions/_shared/supabase-rest.cjs');

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  process.env.SUPABASE_ANON_KEY = ANON_KEY;
  process.env.ADMIN_EMAILS = ADMIN_EMAIL;
  process.env.ADMIN_SETUP_TOKEN = SETUP_TOKEN;

  console.log('ADMIN / CMS FUNCTION QA  (mock Supabase on :' + port + ')\n');

  /* ---------------- 1. sanitiser + slug unit tests ---------------- */
  console.log('sanitiser + slug helpers');
  const dirty = '<script>alert(1)</script><p onclick="steal()">Safe text</p>' +
    '<a href="javascript:alert(1)">bad</a>' +
    '<a href="https://example.com" target="_blank">good</a>' +
    '<img src="https://example.com/x.png" onerror="alert(1)" alt="pic">' +
    '<iframe src="https://evil.test"></iframe><style>body{display:none}</style>';
  const clean = sanitizeHtml(dirty);
  c.ok(!/<script/i.test(clean), 'sanitiser removes <script> elements');
  c.ok(!/<iframe/i.test(clean), 'sanitiser removes <iframe> elements');
  c.ok(!/<style/i.test(clean), 'sanitiser removes <style> elements');
  c.ok(!/onclick/i.test(clean) && !/onerror/i.test(clean), 'sanitiser strips event-handler attributes');
  c.ok(!/javascript:/i.test(clean), 'sanitiser drops javascript: hrefs');
  c.ok(/<p>Safe text<\/p>/.test(clean), 'sanitiser keeps safe text in allowed tags', clean);
  c.ok(/rel="noopener noreferrer"/.test(clean), 'sanitiser forces rel on target=_blank links');
  c.ok(/<img src="https:\/\/example.com\/x.png" alt="pic"/.test(clean), 'sanitiser keeps safe img src/alt', clean);
  c.ok(cleanSlug('Hello World!!') === 'hello-world', 'cleanSlug normalises a title');
  c.ok(SLUG_RE.test(cleanSlug('Hello World!!')), 'cleanSlug output satisfies SLUG_RE');

  /* ---------------- 2. missing configuration ---------------- */
  console.log('\nconfiguration');
  const savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const noKeys = await call(articles, { path: '/?action=list', label: 'nokeys' });
  c.ok(noKeys.status === 500 && noKeys.body && noKeys.body.error === 'missing_keys', 'articles returns missing_keys without a service key');
  process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey;

  /* ---------------- 3. CORS + preflight ---------------- */
  console.log('\nCORS preflight');
  const pre = await call(articles, { method: 'OPTIONS', label: 'options' });
  c.ok(pre.status === 204, 'OPTIONS answers 204');
  c.ok(!!pre.headers['Access-Control-Allow-Origin'], 'preflight returns Access-Control-Allow-Origin');
  c.ok(/Authorization/.test(pre.headers['Access-Control-Allow-Headers'] || ''), 'preflight allows the Authorization header');

  /* ---------------- 4. admin-auth ---------------- */
  console.log('\nadmin-auth: login / refresh / me');
  const missCreds = await call(adminAuth, { method: 'POST', body: { action: 'login', email: ADMIN_EMAIL }, label: 'login-missing' });
  c.ok(missCreds.status === 400 && missCreds.body.error === 'missing_credentials', 'login without a password -> 400 missing_credentials');

  const badLogin = await call(adminAuth, { method: 'POST', body: { action: 'login', email: ADMIN_EMAIL, password: 'nope' }, label: 'login-bad' });
  c.ok(badLogin.status === 401 && badLogin.body.error === 'bad_credentials', 'wrong password -> 401 bad_credentials');

  const nonAdmin = await call(adminAuth, { method: 'POST', body: { action: 'login', email: AUTHOR_EMAIL, password: AUTHOR_PASS }, label: 'login-nonadmin' });
  c.ok(nonAdmin.status === 403 && nonAdmin.body.error === 'not_admin', 'valid non-admin account -> 403 not_admin');

  const login = await call(adminAuth, { method: 'POST', body: { action: 'login', email: ADMIN_EMAIL, password: ADMIN_PASS }, label: 'login-admin' });
  c.ok(login.status === 200 && login.body.ok === true, 'admin login succeeds');
  const TOKEN = login.body && login.body.access_token;
  c.ok(!!TOKEN && login.body.user && login.body.user.email === ADMIN_EMAIL, 'login returns an access token + admin user');

  const meNone = await call(adminAuth, { method: 'POST', body: { action: 'me' }, label: 'me-none' });
  c.ok(meNone.status === 401 && meNone.body.error === 'auth_required', 'me without a bearer token -> 401 auth_required');

  const me = await call(adminAuth, { method: 'POST', body: { action: 'me' }, headers: { Authorization: 'Bearer ' + TOKEN }, label: 'me-admin' });
  c.ok(me.status === 200 && me.body.user && me.body.user.email === ADMIN_EMAIL, 'me with an admin token -> 200');

  const refresh = await call(adminAuth, { method: 'POST', body: { action: 'refresh', refresh_token: login.body.refresh_token }, label: 'refresh' });
  c.ok(refresh.status === 200 && !!refresh.body.access_token, 'refresh grant returns a new access token');
  const TOKEN2 = refresh.body.access_token || TOKEN;

  const refreshBad = await call(adminAuth, { method: 'POST', body: { action: 'refresh', refresh_token: 'tok_r_bogus' }, label: 'refresh-bad' });
  c.ok(refreshBad.status === 401 && refreshBad.body.error === 'refresh_failed', 'bad refresh token -> 401 refresh_failed');

  /* ---------------- 5. public article reads ---------------- */
  console.log('\narticles: public reads');
  const pubList = await call(articles, { path: '/?action=list&limit=24', label: 'public-list' });
  c.ok(pubList.status === 200 && pubList.body.ok === true, 'public list succeeds without auth');
  const pubSlugs = (pubList.body.articles || []).map((a) => a.slug);
  c.ok(pubSlugs.includes('first-published-post') && !pubSlugs.includes('draft-post'), 'public list returns only published rows', JSON.stringify(pubSlugs));

  const pubOne = await call(articles, { path: '/?action=list&slug=first-published-post', label: 'public-slug' });
  c.ok(pubOne.status === 200 && pubOne.body.article && pubOne.body.article.body === '<p>Public body</p>', 'public slug request returns the full article');

  const draftBySlug = await call(articles, { path: '/?action=list&slug=draft-post', label: 'public-draft' });
  c.ok(draftBySlug.status === 404 && draftBySlug.body.error === 'not_found', 'a draft slug is invisible publicly (404)');

  const badAction = await call(articles, { path: '/?action=explode', label: 'public-badaction' });
  c.ok(badAction.status === 400 && badAction.body.error === 'unknown_action', 'unknown public action -> 400');

  c.ok(store.articles.find((a) => a.id === 'a-pub').view_count === 1, 'slug reads bump the view counter via the RPC');

  /* ---------------- 6. admin article writes ---------------- */
  console.log('\narticles: admin writes');
  const anonPost = await call(articles, { method: 'POST', body: { action: 'list' }, label: 'admin-anon' });
  c.ok(anonPost.status === 401 && anonPost.body.error === 'auth_required', 'POST without a token -> 401 auth_required');

  const badTok = await call(articles, { method: 'POST', body: { action: 'list' }, headers: { Authorization: 'Bearer tok_a_bogus' }, label: 'admin-badtok' });
  c.ok(badTok.status === 401 && badTok.body.error === 'invalid_token', 'POST with a bogus token -> 401 invalid_token');

  const authorTok = issue(store.users.find((u) => u.email === AUTHOR_EMAIL)).access_token;
  const nonAdminPost = await call(articles, { method: 'POST', body: { action: 'list' }, headers: { Authorization: 'Bearer ' + authorTok }, label: 'admin-nonadmin' });
  c.ok(nonAdminPost.status === 403 && nonAdminPost.body.error === 'forbidden', 'POST as a non-admin user -> 403 forbidden');

  const noTitle = await call(articles, { method: 'POST', body: { action: 'create', title: '', body: '<p>x</p>' }, headers: { Authorization: 'Bearer ' + TOKEN2 }, label: 'create-notitle' });
  c.ok(noTitle.status === 400 && noTitle.body.error === 'missing_title', 'create without a title -> 400 missing_title');

  const created = await call(articles, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN2 },
    body: {
      action: 'create',
      title: 'How to clean up Android storage',
      slug: 'How To Clean Up Android Storage!!',
      excerpt: 'Free space without factory resets.',
      body: '<script>alert(1)</script><p onclick="x()">Real content</p><a href="javascript:alert(1)">bad</a><img src="https://example.com/c.png" onerror="alert(1)" alt="cover">',
      category: 'Android',
      tags: ['storage', 'android'],
      status: 'published'
    },
    label: 'create-ok'
  });
  c.ok(created.status === 201 && created.body.ok === true, 'create succeeds for an admin');
  const row = created.body.article || {};
  c.ok(row.slug === 'how-to-clean-up-android-storage', 'slug is generated + normalised from the title', row.slug);
  c.ok(row.status === 'published' && !!row.published_at, 'creating as published stamps published_at');
  c.ok(!/<script/i.test(row.body) && !/onclick/i.test(row.body) && !/javascript:/i.test(row.body), 'stored body is sanitised');
  c.ok(/<p>Real content<\/p>/.test(row.body), 'safe markup survives the sanitiser', row.body);
  c.ok(row.author_email === ADMIN_EMAIL, 'author_email is stamped from the verified JWT');
  c.ok(row.reading_minutes >= 1, 'reading_minutes is computed', String(row.reading_minutes));
  c.ok(row.tags === 'storage, android', 'tag arrays are joined to a string', row.tags);

  const dup = await call(articles, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN2 },
    body: { action: 'create', title: 'Dup', slug: 'how-to-clean-up-android-storage', body: '<p>x</p>' },
    label: 'create-dup'
  });
  c.ok(dup.status === 400 && dup.body.error === 'slug_taken', 'duplicate slug -> 400 slug_taken');

  const adminList = await call(articles, { method: 'POST', body: { action: 'list', limit: 50 }, headers: { Authorization: 'Bearer ' + TOKEN2 }, label: 'admin-list' });
  c.ok(adminList.status === 200 && (adminList.body.articles || []).some((a) => a.status === 'draft'), 'admin list includes drafts');

  const updated = await call(articles, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN2 },
    body: { action: 'update', id: row.id, title: 'Android storage cleanup, revised', body: '<p>Updated body</p>', status: 'draft' },
    label: 'update-ok'
  });
  c.ok(updated.status === 200 && updated.body.article.title === 'Android storage cleanup, revised', 'update changes the title');
  c.ok(updated.body.article.status === 'draft', 'update can move an article back to draft');
  c.ok(updated.body.article.slug === row.slug, 'slug is preserved when not supplied on update');

  const updNoId = await call(articles, { method: 'POST', body: { action: 'update', title: 'x', body: '<p>x</p>' }, headers: { Authorization: 'Bearer ' + TOKEN2 }, label: 'update-noid' });
  c.ok(updNoId.status === 400 && updNoId.body.error === 'missing_id', 'update without an id -> 400 missing_id');

  const collide = await call(articles, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN2 },
    body: { action: 'update', id: row.id, title: 'x', slug: 'first-published-post', body: '<p>x</p>' },
    label: 'update-collide'
  });
  c.ok(collide.status === 400 && collide.body.error === 'slug_taken', 'update onto an existing slug -> 400 slug_taken');

  const pub = await call(articles, { method: 'POST', body: { action: 'publish', id: row.id }, headers: { Authorization: 'Bearer ' + TOKEN2 }, label: 'publish' });
  c.ok(pub.status === 200 && pub.body.article.status === 'published' && !!pub.body.article.published_at, 'publish sets status + published_at');

  const unp = await call(articles, { method: 'POST', body: { action: 'unpublish', id: row.id }, headers: { Authorization: 'Bearer ' + TOKEN2 }, label: 'unpublish' });
  c.ok(unp.status === 200 && unp.body.article.status === 'draft', 'unpublish returns the article to draft');

  const noConfirm = await call(articles, { method: 'POST', body: { action: 'delete', id: row.id }, headers: { Authorization: 'Bearer ' + TOKEN2 }, label: 'delete-noconfirm' });
  c.ok(noConfirm.status === 400 && noConfirm.body.error === 'missing_id_or_confirm', 'delete without confirm:true -> 400');

  const del = await call(articles, { method: 'POST', body: { action: 'delete', id: row.id, confirm: true }, headers: { Authorization: 'Bearer ' + TOKEN2 }, label: 'delete-ok' });
  c.ok(del.status === 200 && del.body.ok === true, 'delete with confirmation succeeds');
  c.ok(!store.articles.some((a) => a.id === row.id), 'the row is gone from the store');

  /* ---------------- 7. upload-cover ---------------- */
  console.log('\nupload-cover');
  const px = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'); // PNG magic
  const b64 = px.toString('base64');
  const upNoAuth = await call(uploadCover, { method: 'POST', body: { filename: 'a.png', contentType: 'image/png', dataBase64: b64 }, label: 'upload-noauth' });
  c.ok(upNoAuth.status === 401 && upNoAuth.body.error === 'auth_required', 'upload without a token -> 401');

  const upType = await call(uploadCover, { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN2 }, body: { filename: 'a.gif', contentType: 'image/gif', dataBase64: b64 }, label: 'upload-type' });
  c.ok(upType.status === 415 && upType.body.error === 'unsupported_type', 'unsupported image type -> 415');

  const upEmpty = await call(uploadCover, { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN2 }, body: { filename: 'a.png', contentType: 'image/png', dataBase64: '' }, label: 'upload-empty' });
  c.ok(upEmpty.status === 400 && upEmpty.body.error === 'empty_file', 'empty file -> 400');

  const big = Buffer.alloc(3 * 1024 * 1024 + 1, 7).toString('base64');
  const upBig = await call(uploadCover, { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN2 }, body: { filename: 'big.png', contentType: 'image/png', dataBase64: big }, label: 'upload-big' });
  c.ok(upBig.status === 413 && upBig.body.error === 'too_large', 'file over 3 MB -> 413');

  const upOk = await call(uploadCover, { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN2 }, body: { filename: 'My Cover!!.png', contentType: 'image/png', dataBase64: b64 }, label: 'upload-ok' });
  c.ok(upOk.status === 200 && upOk.body.ok === true, 'valid upload succeeds');
  c.ok(/^https?:\/\/.+\/storage\/v1\/object\/public\/covers\//.test(upOk.body.url || ''), 'returns a public covers URL', upOk.body.url);
  c.ok(store.uploads.length === 1 && /\.png$/.test(store.uploads[0].path), 'the object landed in the covers bucket with a sanitised name', store.uploads[0] && store.uploads[0].path);
  c.ok(store.uploads[0].bytes === px.length, 'the uploaded byte length matches the source image');

  /* ---------------- 8. init-admin ---------------- */
  console.log('\ninit-admin');
  const savedToken = process.env.ADMIN_SETUP_TOKEN;
  delete process.env.ADMIN_SETUP_TOKEN;
  const setupOff = await call(initAdmin, { method: 'POST', body: { email: 'x@y.z', password: 'long-enough-pass' }, label: 'init-off' });
  c.ok(setupOff.status === 403 && setupOff.body.error === 'setup_disabled', 'init-admin is disabled without ADMIN_SETUP_TOKEN');
  process.env.ADMIN_SETUP_TOKEN = savedToken;

  const initBad = await call(initAdmin, { method: 'POST', headers: { Authorization: 'Bearer wrong' }, body: { email: 'new@ahsolution.live', password: 'long-enough-pass' }, label: 'init-badtoken' });
  c.ok(initBad.status === 403 && initBad.body.error === 'forbidden', 'wrong setup token -> 403 forbidden');

  const initShort = await call(initAdmin, { method: 'POST', headers: { Authorization: 'Bearer ' + SETUP_TOKEN }, body: { email: 'new@ahsolution.live', password: 'short' }, label: 'init-shortpass' });
  c.ok(initShort.status === 400 && initShort.body.error === 'password_too_short', 'short password -> 400 password_too_short');

  const initEmail = await call(initAdmin, { method: 'POST', headers: { Authorization: 'Bearer ' + SETUP_TOKEN }, body: { email: 'not-an-email', password: 'long-enough-pass' }, label: 'init-bademail' });
  c.ok(initEmail.status === 400 && initEmail.body.error === 'invalid_email', 'invalid email -> 400 invalid_email');

  const initOk = await call(initAdmin, { method: 'POST', headers: { Authorization: 'Bearer ' + SETUP_TOKEN }, body: { email: 'new@ahsolution.live', password: 'long-enough-pass' }, label: 'init-ok' });
  c.ok(initOk.status === 200 && initOk.body.ok === true && initOk.body.created === true, 'valid setup token creates the admin user');
  c.ok(store.users.some((u) => u.email === 'new@ahsolution.live'), 'the user exists in the auth store');
  c.ok(store.admins.some((a) => a.email === 'new@ahsolution.live'), 'the admins table was written');

  const initAgain = await call(initAdmin, { method: 'POST', headers: { Authorization: 'Bearer ' + SETUP_TOKEN }, body: { email: 'new@ahsolution.live', password: 'long-enough-pass' }, label: 'init-again' });
  c.ok(initAgain.status === 200 && initAgain.body.already_exists === true, 're-running init-admin is idempotent');

  /* ---------------- 9. secret leak scan ---------------- */
  console.log('\nsecret hygiene');
  const leaks = captured.filter((r) => (r.raw + JSON.stringify(r.headers)).includes(SERVICE_KEY));
  c.ok(leaks.length === 0, 'the service-role key never appears in any response body or header');
  c.ok(!JSON.stringify(login.body || {}).includes(ANON_KEY) && !JSON.stringify(created.body || {}).includes(ANON_KEY), 'the anon key is not echoed back either');
  const storageCalls = captured.filter((r) => r.label.startsWith('upload') && r.status === 200);
  c.ok(storageCalls.every((r) => !('apikey' in (r.headers || {}))), 'responses never echo request apikeys');

  server.close();
  const failed = c.fail;
  console.log('\nadmin: ' + c.pass + ' passed, ' + c.fail + ' failed');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); server.close(); process.exit(1); });
