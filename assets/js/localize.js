/* ==========================================================================
   assets/js/localize.js — AH Solution localization runtime (dictionary-first)

   Locale model
   ------------
   - 10 configured locales: `hinglish` (the site's canonical mixed Hinglish
     copy, extracted verbatim into the dictionary — never regenerated) +
     hi, bn, ta, te, mr, gu, kn, ml, pa.
   - The DEFAULT display locale is the site's own copy (English/mixed) —
     no dictionary application, no flash of anything, no network request.
   - UI/chrome strings (nav, footer, announcement, hero, section headings on
     the homepage, vlog/blog filter chips, search placeholder, form labels,
     page titles) come ONLY from the validated local JSON dictionaries in
     assets/i18n/locales/. Switching locales never calls the API for them.
   - Article/video/dynamic content is translated on demand through the secure
     backend endpoint (/api/localize) with client caching keyed by exact
     source text — that path is unchanged.
   - A locale whose dictionary meta.complete === false is treated as pending:
     the runtime falls back to the canonical copy for UI strings and never
     pretends the translation is complete.
   - Hinglish language-tag limitation: HTML has no standard tag for mixed
     Hinglish text; the runtime sets a private-use tag (en-IN-x-hinglish) on
     <html lang> only when explicitly selected, and documents that it is
     best-effort metadata.
   - Raw HTML is never injected; text nodes and attributes are updated in
     place. RTL languages flip dir/lang; code/brand/product names such as
     AH Solution, Android, Windows, YouTube are preserved server-side and by
     dictionary validation.
   ========================================================================== */
'use strict';
(function () {

  /* ------------------------------------------------------------------ *
   * 0. Configured locale inventory (must mirror the server function)
   * ------------------------------------------------------------------ */
  var LOCALES = {
    hinglish: { name: 'Hinglish', dir: 'ltr', alt: 'hinglish hindi english' },
    hi: { name: 'हिन्दी', dir: 'ltr', alt: 'hindi' },
    bn: { name: 'বাংলা', dir: 'ltr', alt: 'bengali bangla' },
    ta: { name: 'தமிழ்', dir: 'ltr', alt: 'tamil' },
    te: { name: 'తెలుగు', dir: 'ltr', alt: 'telugu' },
    mr: { name: 'मराठी', dir: 'ltr', alt: 'marathi' },
    gu: { name: 'ગુજરાતી', dir: 'ltr', alt: 'gujarati' },
    kn: { name: 'ಕನ್ನಡ', dir: 'ltr', alt: 'kannada' },
    ml: { name: 'മലയാളം', dir: 'ltr', alt: 'malayalam' },
    pa: { name: 'ਪੰਜਾਬੀ', dir: 'ltr', alt: 'punjabi' }
  };
  var DEFAULT_LOCALE = 'en'; /* the site's own canonical copy */

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
  function scriptPrefix() {
    var s = document.querySelector('script[src*="localize.js"]');
    var src = s ? s.getAttribute('src') : '';
    return (src.match(/^(\.\.\/)+|^(\.\/)?/) || [''])[0].replace(/localize\.js$/, '').replace(/assets\/js\/$/, '');
  }

  var currentLocale = DEFAULT_LOCALE;
  var dicts = { /* locale -> {strings, complete, langTag, dir} — resolved lazily */ };
  var reverse = null;           /* canonical copy text -> stable key */
  var translating = false;
  var inflight = new Map();     /* batch signature -> Promise (dedupe) */
  var touchedTextNodes = new Set();
  var touchedAttrs = [];
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
    } catch (e) { /* quota or private mode: cache stays best-effort */ }
  }
  function ckey(locale, text) { return locale + '\n' + text; }

  function beginQuiet() { selfMutating = true; if (quietTimer) clearTimeout(quietTimer); }
  var quietTimer = null;
  function endQuietSoon() {
    if (quietTimer) clearTimeout(quietTimer);
    quietTimer = setTimeout(function () { selfMutating = false; }, 400);
  }

  /* ------------------------------------------------------------------ *
   * 2. Dictionary loading (runtime read path: local JSON only)
   * ------------------------------------------------------------------ */
  function dictPath(locale) {
    return scriptPrefix() + 'assets/i18n/locales/' + locale + '.json';
  }
  function loadDictionary(locale) {
    if (dicts[locale]) return Promise.resolve(dicts[locale]);
    if (locale === DEFAULT_LOCALE) return Promise.resolve({ strings: {}, complete: true, base: true });
    return fetch(dictPath(locale), { headers: { Accept: 'application/json' } })
      .then(function (res) { if (!res.ok) throw new Error('dict_http_' + res.status); return res.json(); })
      .then(function (j) {
        var d = { strings: (j && j.strings) || {}, complete: !!(j && j.meta && j.meta.complete), langTag: (j && j.meta && j.meta.langTag) || locale, dir: (j && j.meta && j.meta.dir) || 'ltr' };
        dicts[locale] = d;
        return d;
      });
  }
  function reverseMap() {
    if (reverse) return Promise.resolve(reverse);
    return fetch(dictPath('hinglish'), { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var strings = (j && j.strings) || {};
        reverse = {};
        Object.keys(strings).forEach(function (k) {
          var v = strings[k];
          if (v && reverse[v] == null) reverse[v] = k;
        });
        return reverse;
      })
      .catch(function () { reverse = {}; return reverse; });
  }

  /* Interpolation for runtime-managed chrome strings ({lang}, {year}...) */
  function t(locale, key, vars) {
    var d = dicts[locale];
    var s = d && d.strings && d.strings[key];
    if (locale === DEFAULT_LOCALE || !d) return defaultCopy(key, locale);
    if (s == null) return defaultCopy(key, locale);
    return String(s).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? vars[k] : m; });
  }
  function defaultCopy(key, locale) {
    /* canonical copy fallback: return the base (Hinglish dictionary) value */
    var d = dicts[locale === DEFAULT_LOCALE ? 'hinglish' : locale];
    var s = d && d.strings && d.strings[key];
    return s == null ? key : String(s);
  }

  /* ------------------------------------------------------------------ *
   * 3. Language selector UI (same a11y contract as before)
   * ------------------------------------------------------------------ */
  var ui = null;

  function injectUI() {
    var anchor = $('.nav-right');
    if (!anchor || $('.lang', document)) return;
    var wrap = document.createElement('div');
    wrap.className = 'lang';
    wrap.innerHTML =
      '<button type="button" class="lang-btn" aria-haspopup="listbox" aria-expanded="false" aria-controls="ah-lang-list" aria-label="Select language">' +
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>' +
      '<span class="lang-label">Language</span>' +
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
      html += '<li role="option" tabindex="-1" id="ah-lang-opt-en" data-locale="en" aria-selected="' + (currentLocale === DEFAULT_LOCALE) + '">English <span class="lang-code">EN</span></li>';
      for (var code in LOCALES) {
        var l = LOCALES[code];
        var hay = (l.name + ' ' + l.alt + ' ' + code).toLowerCase();
        if (f && hay.indexOf(f) === -1) continue;
        var pending = dicts[code] && !dicts[code].complete;
        html += '<li role="option" tabindex="-1" id="ah-lang-opt-' + code + '" data-locale="' + code + '" aria-selected="' + (code === currentLocale) + '">' + esc(l.name) + (pending ? ' <span class="lang-soon" aria-hidden="true">·</span>' : '') + ' <span class="lang-code">' + esc(code.toUpperCase()) + '</span></li>';
      }
      list.innerHTML = html || '<li class="lang-empty" aria-disabled="true">No language matches.</li>';
      return $$('li[data-locale]', list);
    }

    function highlighted() { return $('li.focus', list) || null; }
    function clearHighlight() { $$('li[data-locale]', list).forEach(function (li) { li.classList.remove('focus'); }); }

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
      var items = $$('li[data-locale]', list);
      var h = highlighted();
      var idx = items.indexOf(h);
      var next = null;
      if (e.key === 'ArrowDown') next = items[idx + 1] || items[0];
      else if (e.key === 'ArrowUp') next = items[Math.max(0, idx - 1)] || items[items.length - 1];
      else if (e.key === 'Enter') {
        e.preventDefault();
        var target = h || items[0];
        if (target) select(target.dataset.locale);
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
      var li = e.target.closest('li[data-locale]');
      if (li) select(li.dataset.locale);
    });

    ui = { wrap: wrap, btn: btn, panel: panel, input: input, list: list, chip: chip, label: $('.lang-label', wrap), buildList: buildList };
  }

  function paint() {
    if (!ui) return;
    ui.label.textContent = currentLocale === DEFAULT_LOCALE ? 'Language' : (LOCALES[currentLocale] ? LOCALES[currentLocale].name : currentLocale);
    ui.btn.setAttribute('aria-label', 'Select language: ' + (currentLocale === DEFAULT_LOCALE ? 'English (default)' : currentLocale));
    ui.buildList('');
  }

  /* ------------------------------------------------------------------ *
   * 4. Status chip
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
      if (retryable) translate(currentLocale).catch(function () {});
    });
    ui.chip.appendChild(span);
    ui.chip.appendChild(act);
    ui.chip.hidden = false;
  }

  /* ------------------------------------------------------------------ *
   * 5. Dictionary application phase (chrome strings — no API involved)
   * ------------------------------------------------------------------ */
  var CHROME_SEL = 'header.site-header, .site-header, .announcement, footer.site-footer, .site-footer, .hero, .page-hero, .search-modal, .site-footer--panel';
  function isChrome(el) { return !!(el && el.closest && el.closest(CHROME_SEL)); }

  function applyDictionary(locale) {
    /* Applies dictionary values to chrome text nodes, aria-labels,
       placeholders and document title by matching the canonical copy. */
    var d = locale === DEFAULT_LOCALE ? { strings: null } : dicts[locale];
    if (locale !== DEFAULT_LOCALE && (!d || !d.strings)) return Promise.resolve(false);
    return reverseMap().then(function (map) {
      beginQuiet();
      var strings = locale === DEFAULT_LOCALE ? null : d.strings;
      var applied = 0;
      var n;
      /* text nodes inside chrome regions */
      var walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      var touched = [];
      while ((n = walk.nextNode())) {
        var p = n.parentElement;
        if (!p || !isChrome(p)) continue;
        if (/^(script|style|code|pre)$/i.test(p.tagName) || p.closest('pre, code, svg')) continue;
        var t = n.nodeValue.replace(/\s+/g, ' ').trim();
        if (t.length < 2) continue;
        var key = locale === DEFAULT_LOCALE ? null : (reverse[t] || null);
        if (locale !== DEFAULT_LOCALE && key && strings[key] != null) {
          if (!n._locOriginal) n._locOriginal = n.nodeValue;
          n.nodeValue = n.nodeValue.replace(t, strings[key]);
          touchedTextNodes.add(n);
          touched.push(n);
          applied++;
        } else if (locale === DEFAULT_LOCALE && n._locOriginal != null) {
          n.nodeValue = n._locOriginal;
        }
      }
      /* aria-labels and placeholders whose canonical value matches exactly */
      $$('[aria-label]', document).forEach(function (el) {
        if (!isChrome(el)) return;
        var v = el.getAttribute('aria-label');
        if (locale === DEFAULT_LOCALE) {
          if (el._locOrigAria != null) { el.setAttribute('aria-label', el._locOrigAria); delete el._locOrigAria; }
          return;
        }
        var key = reverse[v];
        if (key && strings[key] != null) {
          el._locOrigAria = el._locOrigAria != null ? el._locOrigAria : v;
          el.setAttribute('aria-label', strings[key]);
          touchedAttrs.push(el);
          applied++;
        }
      });
      if (document.title) {
        var tkey = locale === DEFAULT_LOCALE ? null : reverse[document.title.replace(/\s+/g, ' ').trim()];
        if (locale === DEFAULT_LOCALE) {
          if (titleOriginal != null && document.title !== titleOriginal) document.title = titleOriginal;
        } else if (tkey && strings[tkey] != null) {
          document.title = strings[tkey];
          applied++;
        }
      }
      endQuietSoon();
      return applied > 0;
    });
  }

  var titleOriginal = (document.title || '').trim();

  /* ------------------------------------------------------------------ *
   * 6. On-demand content translation (articles, video/blog cards — API path
   *    with secure backend, cache, dedupe; unchanged from the reviewed build)
   * ------------------------------------------------------------------ */
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, CODE: 1, PRE: 1, SVG: 1, NOSCRIPT: 1, TEXTAREA: 1, KBD: 1, SAMP: 1, VAR: 1 };
  var SKIP_SEL = 'pre, code, kbd, samp, [data-no-i18n], [data-ai-panel], noscript, script, style';

  function contentText(n) {
    if (!n || n.nodeType !== 3) return '';
    var p = n.parentElement;
    if (!p) return '';
    if (SKIP_TAGS[p.tagName] || p.closest(SKIP_SEL) || isChrome(p)) return '';
    return n.nodeValue;
  }
  function storeOriginal(node) {
    if (!node._locOriginal) node._locOriginal = node.nodeValue;
    touchedTextNodes.add(node);
  }

  function collectContent(root) {
    var texts = [];
    var textNodes = [];
    var walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var n;
    while ((n = walk.nextNode())) {
      var raw = contentText(n);
      if (!raw) continue;
      var trimmed = raw.replace(/\s+/g, ' ').trim();
      if (trimmed.length > 1 && trimmed.length <= 4000) { storeOriginal(n); textNodes.push(n); texts.push(trimmed); }
    }
    /* content images (alt) + content inputs (placeholder) */
    var attrs = [];
    $$('img[alt]', root).forEach(function (img) {
      if (isChrome(img)) return;
      var v = (img.getAttribute('alt') || '').trim();
      if (v.length > 1) { img._locOrigAlt = v; attrs.push({ el: img, kind: 'alt', text: v }); }
    });
    $$('input[placeholder], textarea[placeholder]', root).forEach(function (el) {
      if (isChrome(el)) return;
      var v = (el.getAttribute('placeholder') || '').trim();
      if (v.length > 1) { el._locOrigPh = v; attrs.push({ el: el, kind: 'ph', text: v }); }
    });
    attrs.forEach(function (a) { texts.push(a.text); });
    return { textNodes: textNodes, attrs: attrs, texts: texts };
  }

  function fetchBatch(locale, texts) {
    var sig = locale + '|' + JSON.stringify(texts);
    if (inflight.has(sig)) return inflight.get(sig);
    var p = (async function () {
      var res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang: locale, items: texts })
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
    var cleanup = function () { inflight.delete(sig); };
    p.then(cleanup, cleanup);
    inflight.set(sig, p);
    return p;
  }

  function batchesFor(pending) {
    var out = [];
    var cur = [];
    var chars = 0;
    pending.forEach(function (tx) {
      if (cur.length >= MAX_NODES_PER_BATCH || chars + tx.length > MAX_CHARS_PER_BATCH) {
        if (cur.length) out.push(cur);
        cur = []; chars = 0;
      }
      cur.push(tx); chars += tx.length;
    });
    if (cur.length) out.push(cur);
    return out;
  }

  function translateContent(locale) {
    var c = collectContent(document.body);
    var cache = loadCache();
    var pending = [];
    var seen = {};
    c.texts.forEach(function (tx) {
      if (seen[tx]) return;
      seen[tx] = true;
      if (!cache[ckey(locale, tx)]) pending.push(tx);
    });

    var map = {};
    var hasCached = false;
    c.textNodes.forEach(function (n) {
      var tx = n.nodeValue.replace(/\s+/g, ' ').trim();
      var hit = cache[ckey(locale, tx)];
      if (hit) { map[tx] = hit; hasCached = true; }
    });
    c.attrs.forEach(function (a) {
      var hit = cache[ckey(locale, a.text)];
      if (hit) { map[a.text] = hit; hasCached = true; }
    });
    if (hasCached) applyContentMap(map);

    if (!pending.length) return Promise.resolve({ ok: true, cachedOnly: true });

    var batches = batchesFor(pending);
    var jobs = batches.map(function (b) { return fetchBatch(locale, b); });
    return Promise.allSettled(jobs).then(function (settled) {
      var fresh = loadCache();
      var map2 = {};
      var firstErr = null;
      batches.forEach(function (b, bi) {
        var r = settled[bi];
        if (r.status === 'fulfilled') {
          b.forEach(function (src, i) {
            map2[src] = r.value[i];
            fresh[ckey(locale, src)] = r.value[i];
          });
        } else if (!firstErr) firstErr = r.reason;
      });
      if (Object.keys(map2).length) { saveCache(fresh); applyContentMap(map2); }
      return { ok: !firstErr, error: firstErr ? firstErr.code : null };
    });
  }

  function applyContentMap(map) {
    beginQuiet();
    touchedTextNodes.forEach(function (n) {
      var tx = n.nodeValue.replace(/\s+/g, ' ').trim();
      if (map[tx] != null && n.nodeValue !== map[tx]) n.nodeValue = n.nodeValue.replace(tx, map[tx]);
    });
    $$('img').forEach(function (img) {
      if (img._locOrigAlt != null && map[img._locOrigAlt]) img.setAttribute('alt', map[img._locOrigAlt]);
    });
    $$('input[placeholder]').forEach(function (el) {
      if (el._locOrigPh != null && map[el._locOrigPh]) el.setAttribute('placeholder', map[el._locOrigPh]);
    });
    endQuietSoon();
  }

  /* ------------------------------------------------------------------ *
   * 7. Locale switching flow
   * ------------------------------------------------------------------ */
  function restoreCanonical() {
    beginQuiet();
    touchedTextNodes.forEach(function (n) {
      if (n._locOriginal != null) n.nodeValue = n._locOriginal;
    });
    $$('img').forEach(function (img) {
      if (img._locOrigAlt != null) { img.setAttribute('alt', img._locOrigAlt); delete img._locOrigAlt; }
    });
    touchedAttrs.forEach(function (el) {
      if (el._locOrigAria != null) { el.setAttribute('aria-label', el._locOrigAria); delete el._locOrigAria; }
    });
    $$('input[placeholder], textarea[placeholder]').forEach(function (el) {
      if (el._locOrigPh != null) { el.setAttribute('placeholder', el._locOrigPh); delete el._locOrigPh; }
    });
    if (titleOriginal != null) document.title = titleOriginal;
    endQuietSoon();
  }

  function translate(locale) {
    if (locale !== DEFAULT_LOCALE && !LOCALES[locale]) return Promise.resolve();
    if (translating) return Promise.resolve();
    translating = true;
    restoreCanonical();
    currentLocale = locale;

    document.documentElement.lang = locale === DEFAULT_LOCALE ? 'en' : (locale === 'hinglish' ? 'en-IN-x-hinglish' : locale);
    document.documentElement.dir = locale === DEFAULT_LOCALE ? 'ltr' : LOCALES[locale].dir;
    return loadDictionary(locale)
      .then(function () { paint(); return applyDictionary(locale); })
      .then(function () {
        if (translate_on_demand && locale !== 'hinglish' && locale !== DEFAULT_LOCALE) return translateContent(locale);
        return { ok: true, skipped: true }; /* dictionary-only or default restore: no API */
      })
      .then(function (contentResult) {
        translating = false;
        if (contentResult && contentResult.ok) {
          var pending = dicts[locale] && !dicts[locale].complete;
          chipMessage(
            locale === DEFAULT_LOCALE ? 'Default language'
              : locale === 'hinglish' ? 'Hinglish (canonical copy)'
                : pending ? 'Interface strings pending for ' + (LOCALES[locale] ? LOCALES[locale].name : locale) + ' — article content can still be translated on demand.'
                  : 'Translated: ' + (LOCALES[locale] ? LOCALES[locale].name : locale)
          );
        } else {
          var code = contentResult && contentResult.error;
          var retryable = code !== 'not_configured' && code !== 'needs_durable_limiter';
          var msg = code === 'not_configured' || code === 'needs_durable_limiter'
            ? 'Translation service is not configured — showing current content for this language switch failure.'
            : code === 'rate_limited'
              ? 'Too many requests — please retry in a moment.'
              : code === 'upstream_rate_limited'
                ? 'The translation service is busy — please retry.'
                : 'Translation failed for part of this page.';
          if (retryable) chipWithRetry(msg + ' ', true);
          else chipMessage(msg, { ms: 6000 });
        }
      })
      .catch(function (e) { translating = false; if (typeof console !== 'undefined' && console.warn) console.warn('[localize] vocabulary switch failed:', e && (e.message || e)); });
  }
  var translate_on_demand = true;

  /* ------------------------------------------------------------------ *
   * 8. Dynamic content → bounded re-translate (cache-first, no chrome API)
   * ------------------------------------------------------------------ */
  function startObserver() {
    if (!('MutationObserver' in window)) return;
    var timer = null;
    var obs = new MutationObserver(function () {
      if (selfMutating || currentLocale === DEFAULT_LOCALE || currentLocale === 'hinglish' || translating || !translate_on_demand) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { translateContent(currentLocale).catch(function () {}); }, 1000);
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  /* ------------------------------------------------------------------ *
   * 9. Selection + persistence (explicit choice only — never geo-based)
   * ------------------------------------------------------------------ */
  function select(code) {
    if (code !== DEFAULT_LOCALE && !LOCALES[code]) return Promise.resolve();
    try { localStorage.setItem(STORAGE_LANG, code); } catch (e) {}
    if (ui) ui.panel.hidden = true, ui.btn.setAttribute('aria-expanded', 'false');
    return translate(code);
  }

  function boot() {
    injectUI();
    var saved = DEFAULT_LOCALE;
    try { saved = localStorage.getItem(STORAGE_LANG) || DEFAULT_LOCALE; } catch (e) {}
    currentLocale = (saved === DEFAULT_LOCALE || LOCALES[saved]) ? saved : DEFAULT_LOCALE;
    reverseMap();
    paint();
    if (currentLocale !== DEFAULT_LOCALE) {
      translate(currentLocale).catch(function () {});
    }
    startObserver();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  /* Tiny test surface (no secrets, no key material) */
  window.AHLocalize = {
    select: select,
    current: function () { return currentLocale; },
    locales: function () { return Object.keys(LOCALES).sort(); },
    loadedDicts: function () { return Object.keys(dicts); },
    dictComplete: function (l) { return !!(dicts[l] && dicts[l].complete); },
    openPanel: function () { if (ui && ui.panel.hidden) ui.btn.click(); },
    closePanel: function () { if (ui) { ui.panel.hidden = true; ui.btn.setAttribute('aria-expanded', 'false'); } },
    panelOpen: function () { return !!(ui && !ui.panel.hidden); },
    /* explicit for tests: static set/unset of the on-demand flag */
    setOnDemand: function (v) { translate_on_demand = !!v; }
  };
})();
