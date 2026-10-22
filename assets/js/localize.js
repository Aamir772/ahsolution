/* ==========================================================================
   assets/js/localize.js — AH Solution global language selector + Gemini
   localization layer.  Server half: /api/localize (Netlify Function).

   - English is the default. No IP/geo auto-detection: a non-English language
     is used ONLY after the visitor explicitly selects it, and the explicit
     choice persists in localStorage.
   - Translated text is applied through safe text-node / attribute updates.
     Raw HTML is never injected.
   - Skipped: <script>/<style>/<pre>/<code>/SVG and the SOLUTION AI panel.
     Brand terminology is protected server-side by the translation prompt.
   - Client cache: localStorage, key = target language + exact source text
     (stable content id → any source edit misses the cache). Bounded.
   - Identical in-flight batches are de-duplicated. Visible loading state,
     retries on retryable errors, permanent English fallback on failures.
   - RTL languages switch document dir/lang attributes.
   ========================================================================== */
'use strict';
(function () {

  /* ------------------------------------------------------------------ *
   * 0. Verified supported-language inventory (mirrors the shared endpoint)
   * ------------------------------------------------------------------ */
  var LANGS = {
    en: { name: 'English', alt: 'english', dir: 'ltr' },
    hi: { name: 'हिन्दी', alt: 'hindi', dir: 'ltr' },
    bn: { name: 'বাংলা', alt: 'bengali bangla', dir: 'ltr' },
    ta: { name: 'தமிழ்', alt: 'tamil', dir: 'ltr' },
    te: { name: 'తెలుగు', alt: 'telugu', dir: 'ltr' },
    mr: { name: 'मराठी', alt: 'marathi', dir: 'ltr' },
    gu: { name: 'ગુજરાતી', alt: 'gujarati', dir: 'ltr' },
    kn: { name: 'ಕನ್ನಡ', alt: 'kannada', dir: 'ltr' },
    ml: { name: 'മലയാളം', alt: 'malayalam', dir: 'ltr' },
    pa: { name: 'ਪੰਜਾਬੀ', alt: 'punjabi', dir: 'ltr' },
    es: { name: 'Español', alt: 'spanish castellano', dir: 'ltr' },
    fr: { name: 'Français', alt: 'french francais', dir: 'ltr' },
    de: { name: 'Deutsch', alt: 'german', dir: 'ltr' },
    pt: { name: 'Português', alt: 'portuguese', dir: 'ltr' },
    ar: { name: 'العربية', alt: 'arabic', dir: 'rtl' },
    ja: { name: '日本語', alt: 'japanese nihongo', dir: 'ltr' },
    ko: { name: '한국어', alt: 'korean hangul', dir: 'ltr' },
    zh: { name: '中文', alt: 'chinese mandarin zhongwen', dir: 'ltr' }
  };
  var EN = 'en';

  var STORAGE_LANG = 'ah_lang';
  var STORAGE_CACHE = 'ah_lang_cache_v1';
  var API = '/api/localize';

  var MAX_NODES_PER_BATCH = 80;
  var MAX_CHARS_PER_BATCH = 12000;

  /* ------------------------------------------------------------------ *
   * 1. Micro-helpers
   * ------------------------------------------------------------------ */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }

  var currentLang = EN;
  var translating = false;
  var inflight = new Map();       /* batch signature -> Promise  (dedupe)   */
  var touchedTextNodes = new Set(); /* nodes whose value we translated      */
  var selfMutating = false;

  function loadCache() {
    try { return JSON.parse(localStorage.getItem(STORAGE_CACHE) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function saveCache(c) {
    try {
      var keys = Object.keys(c);
      while (keys.length > 400) { delete c[keys[0]]; keys = Object.keys(c); }
      localStorage.setItem(STORAGE_CACHE, JSON.stringify(c));
    } catch (e) { /* quota/private mode: cache stays best-effort */ }
  }
  function ckey(lang, text) { return lang + '\n' + text; }

  function setSelfMutating(on) {
    selfMutating = on;
  }
  var quietTimer = null;
  function beginQuiet() {
    setSelfMutating(true);
    if (quietTimer) clearTimeout(quietTimer);
  }
  function endQuietSoon() {
    if (quietTimer) clearTimeout(quietTimer);
    quietTimer = setTimeout(function () { setSelfMutating(false); }, 400);
  }

  /* ------------------------------------------------------------------ *
   * 2. Language selector UI (injected into the existing nav-right area)
   * ------------------------------------------------------------------ */
  var ui = null;

  function injectUI() {
    var anchor = $('.nav-right');
    if (!anchor || $('.lang', document)) return;
    var wrap = document.createElement('div');
    wrap.className = 'lang';
    wrap.innerHTML =
      '<button type="button" class="lang-btn" aria-haspopup="listbox" aria-expanded="false" aria-controls="ah-lang-list" aria-label="Select language: English">' +
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>' +
      '<span class="lang-label">English</span>' +
      '</button>' +
      '<div class="lang-panel" id="ah-lang-panel" role="dialog" aria-label="Select language" hidden>' +
      '<div class="lang-search"><input id="ah-lang-search" type="text" aria-label="Search languages" placeholder="Search languages…" autocomplete="off"></div>' +
      '<ul id="ah-lang-list" class="lang-list" role="listbox" aria-label="Languages"></ul>' +
      '</div>' +
      '<div class="lang-chip" role="status" aria-live="polite" hidden></div>';
    anchor.insertBefore(wrap, anchor.firstChild);

    var btn = $('.lang-btn', wrap);
    var panel = $('.lang-panel', wrap);
    var input = $('#ah-lang-search', wrap);
    var list = $('#ah-lang-list', wrap);
    var chip = $('.lang-chip', wrap);

    function buildList(filter) {
      var f = (filter || '').trim().toLowerCase();
      var html = '';
      for (var code in LANGS) {
        var l = LANGS[code];
        var hay = (l.name + ' ' + l.alt + ' ' + code).toLowerCase();
        if (f && hay.indexOf(f) === -1) continue;
        html += '<li role="option" tabindex="-1" id="ah-lang-opt-' + code + '" data-lang="' + code + '" aria-selected="' + (code === currentLang) + '">' + esc(l.name) + ' <span class="lang-code">' + esc(code.toUpperCase()) + '</span></li>';
      }
      list.innerHTML = html || '<li class="lang-empty" aria-disabled="true">No language matches.</li>';
      return $$('li[data-lang]', list);
    }

    function highlighted() { return $('li.focus', list) || null; }
    function clearHighlight() { $$('li[data-lang]', list).forEach(function (li) { li.classList.remove('focus'); }); }

    function open() {
      panel.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      buildList('');
      input.value = '';
      input.focus();
    }
    function close(focusBack) {
      if (panel.hidden) return;
      panel.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      clearHighlight();
      if (focusBack) btn.focus();
    }

    btn.addEventListener('click', function () { if (panel.hidden) open(); else close(true); });
    document.addEventListener('click', function (e) {
      if (!wrap.contains(e.target) && !panel.hidden) close(false);
    });
    wrap.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { close(true); }
    });
    input.addEventListener('input', function () { clearHighlight(); buildList(input.value); });
    input.addEventListener('keydown', function (e) {
      var items = $$('li[data-lang]', list);
      var h = highlighted();
      var idx = items.indexOf(h);
      var next = null;
      if (e.key === 'ArrowDown') next = items[idx + 1] || items[0];
      else if (e.key === 'ArrowUp') next = items[Math.max(0, idx - 1)] || items[items.length - 1];
      else if (e.key === 'Enter') {
        e.preventDefault();
        var target = h || items[0];
        if (target) select(target.dataset.lang);
        return;
      } else return;
      e.preventDefault();
      clearHighlight();
      if (next) {
        next.classList.add('focus');
        next.scrollIntoView({ block: 'nearest' });
      }
    });
    list.addEventListener('click', function (e) {
      var li = e.target.closest('li[data-lang]');
      if (li) select(li.dataset.lang);
    });

    ui = { wrap: wrap, btn: btn, panel: panel, input: input, list: list, chip: chip, label: $('.lang-label', wrap), buildList: buildList };
  }

  function paint() {
    if (!ui) return;
    ui.label.textContent = LANGS[currentLang].name;
    ui.btn.setAttribute('aria-label', 'Select language: ' + LANGS[currentLang].name);
    ui.buildList('');
    $$('li[data-lang]', ui.list).forEach(function (li) { li.setAttribute('aria-selected', String(li.dataset.lang === currentLang)); });
  }

  /* ------------------------------------------------------------------ *
   * 3. Status chip (loading / ready / errors with retry)
   * ------------------------------------------------------------------ */
  function chipMessage(text, opts) {
    if (!ui) return;
    ui.chip.textContent = text;
    ui.chip.hidden = false;
    if (ui.chip._t) clearTimeout(ui.chip._t);
    if (!opts || !opts.stick) ui.chip._t = setTimeout(function () { ui.chip.hidden = true; }, (opts && opts.ms) || 2800);
  }
  function chipWithRetry(text, retryable) {
    if (!ui) return;
    if (ui.chip._t) clearTimeout(ui.chip._t);
    ui.chip.textContent = '';
    var span = document.createElement('span');
    span.textContent = text;
    var act = document.createElement('button');
    act.type = 'button';
    act.className = 'lang-retry';
    act.textContent = retryable ? 'Retry' : 'Dismiss';
    act.addEventListener('click', function () {
      ui.chip.hidden = true;
      if (retryable) translate(currentLang).catch(function () {});
    });
    ui.chip.appendChild(span);
    ui.chip.appendChild(act);
    ui.chip.hidden = false;
  }

  /* ------------------------------------------------------------------ *
   * 4. Collecting translatable content (skips code + AI panel + scripts)
   * ------------------------------------------------------------------ */
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, CODE: 1, PRE: 1, SVG: 1, NOSCRIPT: 1, TEXTAREA: 1, KBD: 1, SAMP: 1, VAR: 1 };
  var SKIP_SEL = 'pre, code, kbd, samp, [data-no-i18n], [data-ai-panel], noscript, script, style';

  function meaningfulText(n) {
    if (!n || n.nodeType !== 3) return '';
    var p = n.parentElement;
    if (!p) return '';
    if (SKIP_TAGS[p.tagName] || p.closest(SKIP_SEL)) return '';
    return n.nodeValue;
  }
  function collect(root) {
    var texts = [];
    var textNodes = [];
    var walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var n;
    while ((n = walk.nextNode())) {
      var t = meaningfulText(n);
      t = t.replace(/\s+/g, ' ').trim();
      if (t.length > 1 && t.length <= 4000) { storeOriginal(n, t); textNodes.push(n); texts.push(t); }
    }
    var attrs = [];
    $$('img[alt]', root).forEach(function (img) {
      var v = (img.getAttribute('alt') || '').trim();
      if (v.length > 1) {
        img._locOrigAlt = v;
        attrs.push({ el: img, kind: 'alt', text: v });
      }
    });
    $$('input[placeholder]', root).forEach(function (el) {
      var v = (el.getAttribute('placeholder') || '').trim();
      if (v.length > 1) {
        el._locOrigPh = v;
        attrs.push({ el: el, kind: 'ph', text: v });
      }
    });
    attrs.forEach(function (a) { texts.push(a.text); });
    var title = (document.title || '').replace(/\s+/g, ' ').trim();
    if (title) texts.push(title);
    return { textNodes: textNodes, attrs: attrs, title: title, texts: texts };
  }
  function storeOriginal(node, trimmed) {
    if (!node._locOriginal) node._locOriginal = node.nodeValue;
    touchedTextNodes.add(node);
  }

  function restoreEnglishText() {
    beginQuiet();
    touchedTextNodes.forEach(function (n) {
      if (n._locOriginal != null) n.nodeValue = n._locOriginal;
    });
    $$('img').forEach(function (img) {
      if (img._locOrigAlt != null) { img.setAttribute('alt', img._locOrigAlt); delete img._locOrigAlt; }
    });
    $$('input, textarea').forEach(function (el) {
      if (el._locOrigPh != null) { el.setAttribute('placeholder', el._locOrigPh); delete el._locOrigPh; }
    });
    if (titleOriginal != null) {
      document.title = titleOriginal;
    }
    endQuietSoon();
  }
  var titleOriginal = (document.title || '').trim();

  /* ------------------------------------------------------------------ *
   * 5. Pipelines: translate / cache store / apply (safe updates only)
   * ------------------------------------------------------------------ */
  function fetchBatch(lang, texts) {
    var sig = lang + '|' + JSON.stringify(texts);
    if (inflight.has(sig)) return inflight.get(sig);
    var p = (async function () {
      var res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang: lang, items: texts })
      });
      var data = null;
      try { data = await res.json(); } catch (e) { data = null; }
      if (!res.ok || !data || !data.ok || !Array.isArray(data.items) || data.items.length !== texts.length) {
        var code = (data && data.error) || 'network';
        var e2 = new Error(code);
        e2.code = code;
        throw e2;
      }
      return data.items;
    })();
    /* de-dupe bookkeeping; this handles the promise so a rejected batch is
       only ever surfaced through callers (Promise.allSettled), never as an
       unhandled rejection in the console. */
    var cleanup = function () { inflight.delete(sig); };
    p.then(cleanup, cleanup);
    inflight.set(sig, p);
    return p;
  }

  function batchesFor(pending) {
    var out = [];
    var cur = [];
    var chars = 0;
    pending.forEach(function (t) {
      if (cur.length >= MAX_NODES_PER_BATCH || chars + t.length > MAX_CHARS_PER_BATCH) {
        if (cur.length) out.push(cur);
        cur = []; chars = 0;
      }
      cur.push(t); chars += t.length;
    });
    if (cur.length) out.push(cur);
    return out;
  }

  function translate(lang) {
    if (!LANGS[lang]) return Promise.resolve();
    if (lang === EN) {
      currentLang = EN;
      document.documentElement.lang = 'en';
      document.documentElement.dir = 'ltr';
      restoreEnglishText();
      paint();
      return Promise.resolve();
    }
    if (translating) return Promise.resolve();
    translating = true;
    restoreEnglishText();
    currentLang = lang;
    document.documentElement.lang = lang;
    document.documentElement.dir = LANGS[lang].dir;
    paint();

    var c = collect(document.body);
    var cache = loadCache();
    var pending = [];
    var seen = {};
    c.texts.forEach(function (t) {
      if (seen[t]) return;
      seen[t] = true;
      if (!cache[ckey(lang, t)]) pending.push(t);
    });

    /* apply everything the cache already has */
    var map = {};
    var hasCached = false;
    c.textNodes.forEach(function (n) {
      var orig = n._locOriginal || n.nodeValue;
      var t = n.nodeValue.replace(/\s+/g, ' ').trim();
      var hit = cache[ckey(lang, t)];
      if (hit) { map[t] = hit; hasCached = true; }
    });
    c.attrs.forEach(function (a) {
      var hit = cache[ckey(lang, a.text)];
      if (hit) { map[a.text] = hit; hasCached = true; }
    });
    if (c.title) {
      var th = cache[ckey(lang, c.title)];
      if (th) { map[c.title] = th; hasCached = true; }
    }
    if (hasCached) applyMap(map);

    if (!pending.length) {
      translating = false;
      chipMessage('Language: ' + LANGS[lang].name);
      return Promise.resolve();
    }

    chipMessage('Translating…', { stick: true });
    var batches = batchesFor(pending);
    var jobs = batches.map(function (b) { return fetchBatch(lang, b); });

    return Promise.allSettled(jobs).then(function (settled) {
      translating = false;
      var fresh = loadCache();
      var map2 = {};
      var firstErr = null;
      batches.forEach(function (b, bi) {
        var r = settled[bi];
        if (r.status === 'fulfilled') {
          b.forEach(function (src, i) {
            map2[src] = r.value[i];
            fresh[ckey(lang, src)] = r.value[i];
          });
        } else if (!firstErr) firstErr = r.reason;
      });
      if (Object.keys(map2).length) { saveCache(fresh); applyMap(map2); }
      if (firstErr) {
        var retryable = firstErr.code !== 'not_configured' && firstErr.code !== 'needs_durable_limiter';
        var msg = firstErr.code === 'not_configured' || firstErr.code === 'needs_durable_limiter'
          ? 'Translation service is not configured — English content shown.'
          : firstErr.code === 'rate_limited'
            ? 'Too many requests — please retry in a moment.'
            : firstErr.code === 'upstream_rate_limited'
              ? 'The translation service is busy — please retry.'
              : 'Translation failed for part of this page.';
        if (retryable) chipWithRetry(msg + ' ', true);
        else chipMessage(msg, { ms: 6000 });
      } else {
        chipMessage('Translation ready');
      }
      endQuietSoon();
    });
  }

  function applyMap(map) {
    beginQuiet();
    touchedTextNodes.forEach(function (n) {
      var t = n.nodeValue.replace(/\s+/g, ' ').trim();
      if (map[t] != null && n.nodeValue !== map[t]) n.nodeValue = n.nodeValue.replace(t, map[t]);
    });
    $$('img').forEach(function (img) {
      if (img._locOrigAlt != null && map[img._locOrigAlt]) img.setAttribute('alt', map[img._locOrigAlt]);
    });
    $$('input[placeholder]').forEach(function (el) {
      if (el._locOrigPh != null && map[el._locOrigPh]) el.setAttribute('placeholder', map[el._locOrigPh]);
    });
    if (currentLang !== EN && map[titleOriginal]) document.title = map[titleOriginal];
    endQuietSoon();
  }

  /* ------------------------------------------------------------------ *
   * 6. Dynamic content (video grids, blog cards) → gentle re-translate
   * ------------------------------------------------------------------ */
  function startObserver() {
    if (!('MutationObserver' in window)) return;
    var timer = null;
    var obs = new MutationObserver(function () {
      if (selfMutating || currentLang === EN || translating) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { translate(currentLang).catch(function () {}); }, 1000);
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  /* ------------------------------------------------------------------ *
   * 7. Selection + persistence (explicit choice only — never geo-based)
   * ------------------------------------------------------------------ */
  function select(code) {
    if (!LANGS[code]) return;
    try { localStorage.setItem(STORAGE_LANG, code); } catch (e) {}
    if (ui) ui.panel.hidden = true, ui.btn.setAttribute('aria-expanded', 'false');
    translate(code).catch(function () {});
  }

  function boot() {
    injectUI();
    var saved = EN;
    try { saved = localStorage.getItem(STORAGE_LANG) || EN; } catch (e) {}
    currentLang = LANGS[saved] ? saved : EN;
    paint();
    if (currentLang !== EN) {
      document.documentElement.lang = currentLang;
      document.documentElement.dir = LANGS[currentLang].dir;
      translate(currentLang).catch(function () {});
    }
    startObserver();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  /* Tiny test surface (no secrets, no key material) */
  window.AHLocalize = {
    select: select,
    current: function () { return currentLang; },
    langs: function () { return Object.keys(LANGS).sort(); },
    openPanel: function () { if (ui && ui.panel.hidden) ui.btn.click(); },
    closePanel: function () { if (ui) { ui.panel.hidden = true; ui.btn.setAttribute('aria-expanded', 'false'); } },
    panelOpen: function () { return !!(ui && !ui.panel.hidden); }
  };
})();
