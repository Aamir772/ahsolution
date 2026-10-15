/* ==========================================================================
   admin/admin.js — shared admin panel runtime
   * session storage + silent refresh (Supabase user JWT)
   * typed API client for /.netlify/functions/{admin-auth,articles,upload-cover}
   * small DOM helpers
   No privileged key ever reaches this file: every privileged call is made
   by a Netlify Function which verifies the Bearer token server-side.
   ========================================================================== */
(function () {
  'use strict';

  var API = '/.netlify/functions';
  var KEY = 'ah-admin-session';

  /* ---------------- storage ---------------- */
  function readSession() {
    try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
  }
  function writeSession(s) {
    try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
  }
  function clearSession() {
    try { sessionStorage.removeItem(KEY); } catch (e) {}
  }

  /* ---------------- http ---------------- */
  function post(fn, body, token) {
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    return fetch(API + '/' + fn, { method: 'POST', headers: headers, body: JSON.stringify(body || {}) })
      .then(function (r) {
        return r.text().then(function (text) {
          var j;
          try { j = text ? JSON.parse(text) : {}; } catch (_) { j = { error: 'invalid_server_response' }; }
          return { status: r.status, body: j };
        });
      }).catch(function (err) {
        var e = new Error('network_error');
        e.detail = err && err.message;
        throw e;
      });
  }
  function get(fn, qs, token) {
    var headers = {};
    if (token) headers.Authorization = 'Bearer ' + token;
    var url = API + '/' + fn + (qs ? '?' + qs : '');
    return fetch(url, { headers: headers }).then(function (r) {
      return r.text().then(function (text) {
        var j;
        try { j = text ? JSON.parse(text) : {}; } catch (_) { j = { error: 'invalid_server_response' }; }
        return { status: r.status, body: j };
      });
    }).catch(function (err) {
      var e = new Error('network_error');
      e.detail = err && err.message;
      throw e;
    });
  }

  /* ---------------- session lifecycle ---------------- */
  function accessToken() {
    var s = readSession();
    if (!s || !s.access_token) return null;
    if (s.expires_at && s.expires_at * 1000 < Date.now() + 60000) return null;
    return s.access_token;
  }

  function login(email, password) {
    return post('admin-auth', { action: 'login', email: email, password: password }).then(function (res) {
      if (!res.body || !res.body.ok) {
        var err = new Error((res.body && res.body.error) || 'login_failed');
        err.detail = res.body && res.body.detail;
        throw err;
      }
      var b = res.body;
      writeSession({
        access_token: b.access_token,
        refresh_token: b.refresh_token,
        expires_at: b.expires_at || Math.floor(Date.now() / 1000) + (b.expires_in || 3600),
        user: b.user
      });
      return b.user;
    });
  }

  function refresh() {
    var s = readSession();
    if (!s || !s.refresh_token) return Promise.resolve(null);
    return post('admin-auth', { action: 'refresh', refresh_token: s.refresh_token }).then(function (res) {
      if (!res.body || !res.body.ok) { clearSession(); return null; }
      var b = res.body;
      writeSession({
        access_token: b.access_token,
        refresh_token: b.refresh_token,
        expires_at: b.expires_at || Math.floor(Date.now() / 1000) + (b.expires_in || 3600),
        user: b.user || s.user
      });
      return b.access_token;
    }).catch(function () { clearSession(); return null; });
  }

  /** Resolve a usable access token, refreshing once if needed. */
  function token() {
    var t = accessToken();
    if (t) return Promise.resolve(t);
    return refresh();
  }

  /** Authenticated API call with one automatic refresh + retry. */
  function call(fn, body) {
    return token().then(function (t) {
      if (!t) { var e = new Error('auth_required'); e.code = 'auth_required'; throw e; }
      return post(fn, body, t).then(function (res) {
        if (res.status === 401) {
          return refresh().then(function (t2) {
            if (!t2) { var e2 = new Error('auth_required'); e2.code = 'auth_required'; throw e2; }
            return post(fn, body, t2);
          });
        }
        if (res.status >= 400) {
          var apiErr = new Error((res.body && res.body.error) || 'request_failed');
          apiErr.status = res.status;
          apiErr.detail = res.body && res.body.detail;
          throw apiErr;
        }
        return res;
      });
    });
  }

  function logout() {
    clearSession();
    location.href = 'login.html';
  }

  /** Require a signed-in admin on a protected page. */
  function requireAuth() {
    var s = readSession();
    if (!s || !s.access_token) { location.replace('login.html'); return null; }
    return s;
  }

  /* ---------------- dom helpers ---------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function notice(el, kind, text) {
    if (!el) return;
    el.className = 'notice notice--' + (kind || 'ok');
    el.textContent = text || '';
    el.hidden = !text;
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (e) { return iso; }
  }
  function debounce(fn, ms) {
    var t;
    return function () {
      var a = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, a); }, ms || 220);
    };
  }

  window.AHAdmin = {
    login: login, logout: logout, call: call, token: token,
    requireAuth: requireAuth, session: readSession, clearSession: clearSession,
    articles: {
      list: function (opts) { return call('articles', Object.assign({ action: 'list' }, opts || {})); },
      create: function (data) { return call('articles', Object.assign({ action: 'create' }, data)); },
      update: function (data) { return call('articles', Object.assign({ action: 'update' }, data)); },
      publish: function (id) { return call('articles', { action: 'publish', id: id }); },
      unpublish: function (id) { return call('articles', { action: 'unpublish', id: id }); },
      remove: function (id) { return call('articles', { action: 'delete', id: id, confirm: true }); }
    },
    uploadCover: function (file) {
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onerror = function () { reject(new Error('read_failed')); };
        reader.onload = function () {
          var base64 = String(reader.result).split(',')[1] || '';
          call('upload-cover', { filename: file.name, contentType: file.type, dataBase64: base64 })
            .then(function (res) {
              if (!res.body || !res.body.ok) reject(new Error((res.body && res.body.error) || 'upload_failed'));
              else resolve(res.body);
            }).catch(reject);
        };
        reader.readAsDataURL(file);
      });
    },
    $: $, $$: $$, esc: esc, notice: notice, fmtDate: fmtDate, debounce: debounce
  };
})();
