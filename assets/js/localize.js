/* ==========================================================================
   assets/js/localize.js — AH Solution localization runtime (dictionary-first)

   Locale model
   ------------
   - Canonical source: locales/en.json (English). Hinglish is retired and
     must not be reintroduced.
   - Supported locales: en (default/fallback) + hi, es, fr, de, pt, ar, bn, ja.
   - English needs no dictionary application: the HTML is already English, so
     selecting English restores the original nodes with zero network calls.
   - UI/chrome strings (nav, footer, hero, section headings, filter chips,
     search placeholder, form labels, page titles, selector/chip text) come
     ONLY from the validated local JSON dictionaries in locales/. Switching
     locales never calls the API for them.
   - Article/video/dynamic content is translated on demand through the secure
     backend endpoint (/api/localize) with client caching keyed by exact
     source text — that path is unchanged.
   - A locale whose dictionary meta.complete === false is treated as pending:
     the runtime falls back to English for UI strings, marks it "pending" in
     the selector and never pretends the translation is complete.
   - Raw HTML is never injected; text nodes and attributes are updated in
     place. RTL locales flip dir/lang; code/brand/product names such as
     AH Solution, Android, Windows, YouTube are preserved server-side and by
     dictionary validation.
   ========================================================================== */
'use strict';
(function () {

  /* ------------------------------------------------------------------ *
   * 0. Configured locale inventory (must mirror the server function)
   * ------------------------------------------------------------------ */
  var LOCALES = {
    en: { name: 'English', dir: 'ltr', alt: 'english', source: true },
    hi: { name: 'हिन्दी', dir: 'ltr', alt: 'hindi' },
    es: { name: 'Español', dir: 'ltr', alt: 'spanish espanol' },
    fr: { name: 'Français', dir: 'ltr', alt: 'french francais' },
    de: { name: 'Deutsch', dir: 'ltr', alt: 'german deutsch' },
    pt: { name: 'Português', dir: 'ltr', alt: 'portuguese portugues' },
    ar: { name: 'العربية', dir: 'rtl', alt: 'arabic' },
    bn: { name: 'বাংলা', dir: 'ltr', alt: 'bengali bangla' },
    ja: { name: '日本語', dir: 'ltr', alt: 'japanese' }
  };
  var DEFAULT_LOCALE = 'en';
  var SUPPORTED = Object.keys(LOCALES);

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
    /* locale is always whitelisted before this runs — no path from raw input */
    return scriptPrefix() + 'locales/' + locale + '.json';
  }
  function flatten(obj, prefix, out) {
    out = out || {};
    prefix = prefix || '';
    Object.keys(obj || {}).forEach(function (k) {
      if (!prefix && k === 'meta') return;
      var v = obj[k];
      var key = prefix ? prefix + '.' + k : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
      else out[key] = v;
    });
    return out;
  }
  function loadDictionary(locale) {
    if (dicts[locale]) return Promise.resolve(dicts[locale]);
    if (!LOCALES[locale]) return Promise.reject(new Error('bad_locale'));
    return fetch(dictPath(locale), { headers: { Accept: 'application/json' } })
      .then(function (res) { if (!res.ok) throw new Error('dict_http_' + res.status); return res.json(); })
      .then(function (j) {
        var strings = flatten(j, '', {});
        var d = {
          strings: strings,
          complete: !!(j && j.meta && j.meta.complete),
          langTag: (j && j.meta && j.meta.langTag) || locale,
          dir: (j && j.meta && j.meta.dir) || LOCALES[locale].dir
        };
        dicts[locale] = d;
        return d;
      });
  }
  function reverseMap() {
    if (reverse) return Promise.resolve(reverse);
    return loadDictionary(DEFAULT_LOCALE)
      .then(function (d) {
        reverse = {};
        Object.keys(d.strings || {}).forEach(function (k) {
          var v = d.strings[k];
          if (typeof v === 'string' && v && reverse[v] == null) reverse[v] = k;
        });
        return reverse;
      })
      .catch(function () { reverse = {}; return reverse; });
  }

  /* Interpolation for runtime-managed chrome strings ({{lang}}, {{date}}…) */
  function interpolate(str, vars) {
    return String(str).replace(/\{\{\s*(\w+)\s*\}\}/g, function (m, k) {
      return vars && vars[k] != null ? vars[k] : m;
    });
  }
  function t(locale, key, vars, fallback) {
    var d = dicts[locale];
    var s = d && d.strings && d.strings[key];
    if (typeof s !== 'string' || !s) {
      var base = dicts[DEFAULT_LOCALE];
      s = base && base.strings && base.strings[key];
    }
    if (typeof s !== 'string' || !s) return fallback != null ? interpolate(fallback, vars) : key;
    return interpolate(s, vars);
  }
  function defaultCopy(key, locale) {
    var d = dicts[DEFAULT_LOCALE] || dicts[locale];
    var s = d && d.strings && d.strings[key];
    return typeof s === 'string' && s ? s : key;
  }

  /* ------------------------------------------------------------------ *
   * 3. Language selector UI (same a11y contract as before)
   * ------------------------------------------------------------------ */
  var ui = null;

  /* Shared notification root: the status chip is portaled to <body> so it can
     never be clipped by the scrolling .device-screen, never inherit a
     transformed/containing-block ancestor, and always paints above the header,
     cards and the decorative device chrome by its own documented z-index. */
  function notifyRoot() {
    var el = document.getElementById('ah-notify-root');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ah-notify-root';
      document.body.appendChild(el);
    }
    return el;
  }

  function injectUI() {
    var anchor = $('.nav-right');
    if (!anchor || $('.lang', document)) return;
    var wrap = document.createElement('div');
    wrap.className = 'lang';
    wrap.innerHTML =
      '<button type="button" class="lang-btn" aria-haspopup="listbox" aria-expanded="false" aria-controls="ah-lang-list" aria-label="' + esc(t(currentLocale, 'language.select', null, 'Select language')) + '">' +
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>' +
      '<span class="lang-label">' + esc(t(currentLocale, 'language.label', null, 'Language')) + '</span>' +
      '</button>' +
      '<div class="lang-panel" id="ah-lang-panel" role="dialog" aria-label="' + esc(t(currentLocale, 'language.panel', null, 'Select language')) + '" hidden>' +
      '<div class="lang-search"><input id="ah-lang-search" type="text" aria-label="' + esc(t(currentLocale, 'language.searchAria', null, 'Search languages')) + '" placeholder="' + esc(t(currentLocale, 'language.searchPlaceholder', null, 'Search languages…')) + '" autocomplete="off"></div>' +
      '<ul id="ah-lang-list" class="lang-list" role="listbox" aria-label="' + esc(t(currentLocale, 'language.panel', null, 'Select language')) + '"></ul>' +
      '</div>';
    anchor.insertBefore(wrap, anchor.firstChild);
    var chip = document.createElement('div');
    chip.className = 'lang-chip';
    chip.setAttribute('role', 'status');
    chip.setAttribute('aria-live', 'polite');
    chip.hidden = true;
    notifyRoot().appendChild(chip);

    var btn = $('.lang-btn', wrap);
    var panel = $('.lang-panel', wrap);
    var input = $('#ah-lang-search', wrap);
    var list = $('#ah-lang-list', wrap);

    function isPending(code) { return !(dicts[code] && dicts[code].complete); }

    function buildList(filter) {
      var f = (filter || '').trim().toLowerCase();
      var html = '';
      var en = LOCALES[DEFAULT_LOCALE];
      var enHay = (en.name + ' ' + en.alt + ' ' + DEFAULT_LOCALE).toLowerCase();
      if (!f || enHay.indexOf(f) !== -1) {
        html += '<li role="option" tabindex="-1" id="ah-lang-opt-en" data-locale="en" aria-selected="' + (currentLocale === DEFAULT_LOCALE) + '">' + esc(en.name) + ' <span class="lang-code">EN</span></li>';
      }
      for (var code in LOCALES) {
        if (code === DEFAULT_LOCALE) continue;
        var l = LOCALES[code];
        var hay = (l.name + ' ' + l.alt + ' ' + code).toLowerCase();
        if (f && hay.indexOf(f) === -1) continue;
        var pending = isPending(code);
        html += '<li role="option" tabindex="-1" id="ah-lang-opt-' + code + '" data-locale="' + code + '" aria-selected="' + (code === currentLocale) + '">' + esc(l.name) +
          (pending ? ' <span class="lang-soon">' + esc(t(currentLocale, 'language.pendingLabel', null, 'pending')) + '</span>' : '') +
          ' <span class="lang-code">' + esc(code.toUpperCase()) + '</span></li>';
      }
      list.innerHTML = html || '<li class="lang-empty" aria-disabled="true">' + esc(t(currentLocale, 'language.noMatch', null, 'No language matches.')) + '</li>';
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
    var name = LOCALES[currentLocale] ? LOCALES[currentLocale].name : currentLocale;
    ui.label.textContent = currentLocale === DEFAULT_LOCALE ? t(currentLocale, 'language.label', null, 'Language') : name;
    var ariaName = currentLocale === DEFAULT_LOCALE ? t(currentLocale, 'language.ariaDefault', null, 'English (default)') : name;
    ui.btn.setAttribute('aria-label', t(currentLocale, 'language.ariaOpen', { lang: ariaName }, 'Select language: ' + ariaName));
    ui.panel.setAttribute('aria-label', t(currentLocale, 'language.panel', null, 'Select language'));
    ui.input.setAttribute('aria-label', t(currentLocale, 'language.searchAria', null, 'Search languages'));
    ui.input.placeholder = t(currentLocale, 'language.searchPlaceholder', null, 'Search languages…');
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
    /* Coalesce repeated failures: if the identical notice is already visible,
       keep its single timer instead of stacking notifications or resetting it. */
    if (!ui.chip.hidden && ui.chip._msg === text && ui.chip._retryable === retryable) return;
    ui.chip._msg = text;
    ui.chip._retryable = retryable;
    if (ui.chip._t) clearTimeout(ui.chip._t);
    ui.chip.textContent = '';
    var span = document.createElement('span');
    span.textContent = text;
    var act = document.createElement('button');
    act.type = 'button';
    act.className = 'lang-retry';
    act.textContent = retryable ? t(currentLocale, 'common.retry', null, 'Retry') : t(currentLocale, 'common.dismiss', null, 'Dismiss');
    act.addEventListener('click', function () {
      if (ui.chip._t) clearTimeout(ui.chip._t);
      ui.chip._t = null;
      ui.chip.hidden = true;
      if (retryable) {
        retryLock = false; /* explicit user action re-enables attempts */
        translate(currentLocale).catch(function () {});
      }
    });
    ui.chip.appendChild(span);
    ui.chip.appendChild(act);
    ui.chip.hidden = false;
    /* translation error toast: auto-dismiss after 2 seconds */
    ui.chip._t = setTimeout(function () {
      ui.chip._t = null;
      ui.chip.hidden = true;
    }, 2000);
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
      var res;
      try { res = await fetch(API, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ lang:locale, items:texts }) }); }
      catch (e) { throw errCode('network'); }
      var data = null;
      try { data = await res.json(); } catch (e) { data = null; } /* HTML 404/5xx bodies */
      if (!res.ok || !data || !data.ok || !Array.isArray(data.items) || data.items.length !== texts.length) {
        /* keep the server's own code when present, otherwise identify the HTTP
           level failure (missing function, deployment gap…) instead of calling
           everything "network" */
        throw errCode((data && data.error) || ('http_' + res.status));
      }
      return data.items;
    })();
    var cleanup = function () { inflight.delete(sig); };
    p.then(cleanup, cleanup);
    inflight.set(sig, p);
    return p;
  }
  function errCode(code) {
    var e = new Error(code);
    e.code = code;
    return e;
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
    /* Sequential batches: stop at the first failure so an unavailable or
       rate-limited service is not hammered by every remaining batch. */
    return (function () {
      var fresh = loadCache();
      var map2 = {};
      var firstErr = null;
      var chain = Promise.resolve();
      batches.forEach(function (b) {
        chain = chain.then(function () {
          if (firstErr) return;
          return fetchBatch(locale, b).then(function (vals) {
            b.forEach(function (src, i) {
              map2[src] = vals[i];
              fresh[ckey(locale, src)] = vals[i];
            });
          }).catch(function (err) { firstErr = err; });
        });
      });
      return chain.then(function () {
        if (Object.keys(map2).length) { saveCache(fresh); applyContentMap(map2); }
        return { ok: !firstErr, error: firstErr ? firstErr.code : null };
      });
    })();
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
    if (!LOCALES[locale]) return Promise.resolve();
    if (translating) return Promise.resolve();
    translating = true;
    retryLock = false; /* explicit switch always gets a fresh chance */
    restoreCanonical();
    currentLocale = locale;

    document.documentElement.lang = LOCALES[locale].langTag || locale;
    document.documentElement.dir = LOCALES[locale].dir;
    return loadDictionary(DEFAULT_LOCALE)
      .catch(function () { return null; })
      .then(function () { return locale === DEFAULT_LOCALE ? null : loadDictionary(locale); })
      .then(function () { paint(); return applyDictionary(locale); })
      .then(function () {
        if (translate_on_demand && locale !== DEFAULT_LOCALE) return translateContent(locale);
        return { ok: true, skipped: true }; /* English restore: no API */
      })
      .then(function (contentResult) {
        translating = false;
        var name = LOCALES[locale].name;
        var pending = dicts[locale] && !dicts[locale].complete;
        if (contentResult && contentResult.ok) {
          retryLock = false;
          chipMessage(
            locale === DEFAULT_LOCALE ? t(currentLocale, 'language.default', null, 'Default language')
              : pending ? t(currentLocale, 'language.pending', { lang: name }, 'Interface strings pending for ' + name + ' — article content can still be translated on demand.')
                : t(currentLocale, 'language.translated', { lang: name }, 'Translated: ' + name)
          );
        } else {
          var code = contentResult && contentResult.error;
          var kind = failureKind(code);
          if (kind === 'stale') { retryLock = true; } /* stop observer auto-retries until an explicit action */
          if (pending) {
            /* the interface dictionary is knowingly incomplete: say so instead
               of masking it with a content-translation error */
            chipMessage(t(currentLocale, 'language.pending', { lang: name }, 'Interface strings pending for ' + name + ' — article content can still be translated on demand.'));
          } else {
            var msg = failureMessage(code, kind);
            if (kind === 'retryable') chipWithRetry(msg + ' ', true);
            else chipWithRetry(msg, false); /* stale/request: dismissible + auto-hide ~2s */
          }
        }
      })
      .catch(function (e) { translating = false; if (typeof console !== 'undefined' && console.warn) console.warn('[localize] vocabulary switch failed:', e && (e.message || e)); });
  }
  var translate_on_demand = true;
  /* Latch: once the backend proves unavailable in a way Retry cannot fix
     (not deployed / not configured / blocked), stop the MutationObserver from
     hammering it automatically. Explicit user actions (language switch or the
     Retry button) clear the latch. */
  var retryLock = false;

  /* Classify client-visible failure codes:
     - "stale" = the deployment/config cannot serve translation right now;
       shown once, no Retry button, auto-retry locked off.
     - "retryable" = transient (network, limits, upstream hiccups); Retry works.
     - "request" = our request was structurally rejected; shown, not auto-retried. */
  function failureKind(code) {
    if (code === 'not_configured' || code === 'needs_durable_limiter' ||
        code === 'http_403' || code === 'http_404' || code === 'http_405' ||
        code === 'forbidden') return 'stale';
    if (code === 'bad_lang' || code === 'bad_items' || code === 'bad_json' ||
        code === 'too_large' || code === 'method_not_allowed') return 'request';
    return 'retryable'; /* network, rate_limited, upstream_*, timeout, http_5xx */
  }
  function failureMessage(code, kind) {
    if (code === 'not_configured') {
      return t(currentLocale, 'language.notConfigured', null, 'Translation service is not configured — current content shown.');
    }
    if (kind === 'stale') {
      return t(currentLocale, 'language.unavailable', null, 'Translation service is not available on this site yet — the page keeps its original content. Interface strings from the local dictionary still apply.');
    }
    if (kind === 'request') {
      return t(currentLocale, 'language.requestInvalid', null, 'This page could not be sent for translation (request too large or invalid).');
    }
    switch (code) {
      case 'rate_limited': return t(currentLocale, 'language.rateLimited', null, 'Too many requests — please retry in a moment.');
      case 'upstream_rate_limited': return t(currentLocale, 'language.busy', null, 'The translation service is busy — please retry.');
      case 'timeout': return t(currentLocale, 'language.timeout', null, 'The translation took too long — please retry.');
      case 'upstream_invalid': return t(currentLocale, 'language.upstreamInvalid', null, 'The translation service returned an unexpected answer — please retry.');
      case 'http_429': return t(currentLocale, 'language.rateLimited', null, 'Too many requests — please retry in a moment.');
      default: return t(currentLocale, 'language.failedKept', null, 'Translation failed for part of this page. Successfully translated sections were kept.');
    }
  }

  /* ------------------------------------------------------------------ *
   * 8. Dynamic content → bounded re-translate (cache-first, no chrome API)
   * ------------------------------------------------------------------ */
  function startObserver() {
    if (!('MutationObserver' in window)) return;
    var timer = null;
    var obs = new MutationObserver(function () {
      if (selfMutating || currentLocale === DEFAULT_LOCALE || translating || !translate_on_demand) return;
      if (retryLock) return; /* backend is down/not configured: no automatic hammering */
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { translateContent(currentLocale).catch(function () {}); }, 1000);
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  /* ------------------------------------------------------------------ *
   * 9. Selection + persistence (explicit choice only — never geo-based)
   * ------------------------------------------------------------------ */
  function select(code) {
    if (!LOCALES[code]) return Promise.resolve();
    try { localStorage.setItem(STORAGE_LANG, code); } catch (e) {}
    if (ui) ui.panel.hidden = true, ui.btn.setAttribute('aria-expanded', 'false');
    return translate(code);
  }

  function boot() {
    injectUI();
    var saved = DEFAULT_LOCALE;
    try { saved = localStorage.getItem(STORAGE_LANG) || DEFAULT_LOCALE; } catch (e) {}
    currentLocale = LOCALES[saved] ? saved : DEFAULT_LOCALE;
    document.documentElement.lang = LOCALES[currentLocale].langTag || currentLocale;
    document.documentElement.dir = LOCALES[currentLocale].dir;
    reverseMap();
    loadDictionary(DEFAULT_LOCALE).catch(function () {}).then(function () { paint(); });
    if (currentLocale !== DEFAULT_LOCALE) {
      translate(currentLocale).catch(function () {});
    }
    startObserver();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  /* Tiny test surface (no secrets, no key material) */
  window.AHLocalize = {
    t: function (key, vars, fallback) { return t(currentLocale, key, vars, fallback); },
    setLocale: select,
    getLocale: function () { return currentLocale; },
    getSupportedLocales: function () { return SUPPORTED.slice(); },
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
