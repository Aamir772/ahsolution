/* ==========================================================================
   assets/js/cms.js — public CMS client
   Loads published articles from the Netlify Function API and hydrates:
     * blog.html       -> prepends CMS cards into the guide grid
     * article.html    -> renders a single article by ?slug=
   The browser only ever calls the public GET endpoint; no keys, no auth.
   Every failure is swallowed so a missing/unconfigured backend never
   breaks the static site.
   ========================================================================== */
(function () {
  'use strict';

  var ENDPOINT = '/.netlify/functions/articles';
  var FALLBACK_COVER = 'assets/img/og-default.jpg';

  function qs(params) {
    var parts = [];
    Object.keys(params || {}).forEach(function (k) {
      if (params[k] === undefined || params[k] === null || params[k] === '') return;
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
    });
    return parts.length ? '?' + parts.join('&') : '';
  }

  function getJSON(path) {
    return fetch(path, { headers: { Accept: 'application/json' } }).then(function (r) {
      if (!r.ok) { var e = new Error('http_' + r.status); e.status = r.status; throw e; }
      return r.json();
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtDate(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    } catch (e) { return ''; }
  }

  function plain(html) {
    return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /* Categories in the CMS are human labels; the blog filter chips use keys.
     Must stay in sync with filterKey() in scripts/blog-md.js.
     Chip keys: android · windows · gadgets · photography · privacy · remote · about */
  function filterKey(cat) {
    var c = String(cat || '').toLowerCase();
    if (/photograph|camera|night photo/.test(c)) return 'photography';
    if (/privacy|browser|streaming|safety|whatsapp|wamr/.test(c)) return 'privacy';
    if (/remote/.test(c)) return 'remote';
    if (/android|apps|connectivity/.test(c)) return 'android';
    if (/pc|windows|laptop|gaming/.test(c)) return 'windows';
    if (/gadget|watch|wear|smartphone|phone/.test(c)) return 'gadgets';
    if (/about|welcome/.test(c)) return 'about';
    return '';
  }

  function articleUrl(slug) {
    return 'article.html?slug=' + encodeURIComponent(slug);
  }

  function cardHTML(a) {
    var cover = a.cover_image_url || FALLBACK_COVER;
    var cat = a.category || 'Article';
    var mins = a.reading_minutes || 1;
    var text = [a.title, a.excerpt, a.category, a.tags].join(' ');
    return '<a class="content-card tilt" data-tilt="6" data-blog-card' +
      ' data-slug="' + esc(a.slug) + '"' +
      ' data-category="' + esc(filterKey(cat)) + '"' +
      ' data-search="' + esc(text.toLowerCase()) + '"' +
      ' data-cms-card href="' + esc(articleUrl(a.slug)) + '">' +
      '<div class="card-image"><img src="' + esc(cover) + '" alt="" loading="lazy" decoding="async" width="900" height="600"' +
      (cover === FALLBACK_COVER ? '' : ' onerror="this.onerror=null;this.src=\'' + FALLBACK_COVER + '\'"') +
      '><span class="card-tag">' + esc(cat) + '</span></div>' +
      '<div class="card-body"><div class="card-meta">' + esc(cat.toUpperCase()) + ' · ' + mins + ' MIN READ</div>' +
      '<h3>' + esc(a.title) + '</h3>' +
      (a.excerpt ? '<p>' + esc(a.excerpt) + '</p>' : '') +
      '<div class="card-bottom"><span>Read article</span><span class="arrow">↗</span></div></div></a>';
  }

  /* ------------------------------------------------------------------ *
   * blog.html — prepend published CMS cards into the existing grid
   * ------------------------------------------------------------------ */
  function initBlog() {
    var grid = document.querySelector('[data-cms-grid]');
    if (!grid) return;
    return getJSON(ENDPOINT + qs({ action: 'list', limit: 6 })).then(function (res) {
      /* Never render a card for an article already present as a static card
         (the manifest-built listing). Prevents the same article appearing
         twice on the main Blog page. */
      var have = {};
      grid.querySelectorAll('[data-slug]').forEach(function (el) { have[el.getAttribute('data-slug')] = true; });
      var list = ((res && res.articles) || []).filter(function (a) { return a.slug && !have[a.slug]; });
      if (!list.length) return;
      grid.insertAdjacentHTML('afterbegin', list.map(cardHTML).join(''));
      document.dispatchEvent(new CustomEvent('ah:blog:refresh'));
    }).catch(function () { /* backend not available — keep the static page */ });
  }

  /* ------------------------------------------------------------------ *
   * article.html — render one published article by slug
   * ------------------------------------------------------------------ */
  function setMeta(tag, attr, value) {
    var el = document.head.querySelector(tag + '[' + attr + '="' + value.key + '"]') ||
      (tag === 'meta' ? document.createElement('meta') : document.createElement('link'));
    if (!el.parentNode) {
      el.setAttribute(attr, value.key);
      document.head.appendChild(el);
    }
    el.setAttribute('content', value.content);
  }

  function applyMeta(a, canonical) {
    document.title = a.title + ' | AH Solution';
    setMeta('meta', 'property', { key: 'og:title', content: a.title });
    setMeta('meta', 'property', { key: 'og:description', content: a.seo_description || a.excerpt || '' });
    setMeta('meta', 'property', { key: 'og:url', content: canonical });
    setMeta('meta', 'property', { key: 'og:type', content: 'article' });
    if (a.cover_image_url) setMeta('meta', 'property', { key: 'og:image', content: a.cover_image_url });
    var desc = document.head.querySelector('meta[name="description"]');
    if (desc) desc.setAttribute('content', a.seo_description || a.excerpt || '');

    var old = document.getElementById('cms-ld');
    if (old) old.remove();

    /* VideoObject is only emitted when the body carries verified video
       metadata (data-ah-video written by scripts/blog-import-drafts.cjs).
       Nothing about the video is guessed. */
    var graph = [];
    var post = {
      '@type': 'BlogPosting',
      headline: a.title,
      description: a.seo_description || a.excerpt || '',
      inLanguage: 'en-IN',
      articleSection: a.category || undefined,
      keywords: a.tags || undefined,
      author: { '@type': 'Organization', name: 'AH Solution Editorial Team' },
      publisher: { '@type': 'Organization', name: 'AH Solution', url: 'https://ahsolution.live/' },
      mainEntityOfPage: { '@type': 'WebPage', '@id': canonical }
    };
    if (a.cover_image_url) post.image = [a.cover_image_url];
    if (a.published_at) post.datePublished = a.published_at;
    if (a.updated_at) post.dateModified = a.updated_at;
    graph.push(post);

    var vd = document.body.querySelector('[data-ah-video]');
    if (vd) {
      try {
        var v = JSON.parse(vd.getAttribute('data-ah-video'));
        if (v && v.id && v.title) {
          graph.push({
            '@type': 'VideoObject',
            name: v.title,
            description: a.seo_description || a.excerpt || undefined,
            thumbnailUrl: v.thumbnail ? [v.thumbnail] : undefined,
            duration: v.duration || undefined,
            uploadDate: v.datePublished || undefined,
            contentUrl: 'https://www.youtube.com/watch?v=' + v.id,
            embedUrl: 'https://www.youtube-nocookie.com/embed/' + v.id
          });
        }
      } catch (e) { /* malformed metadata — omit rather than invent */ }
    }

    var ld = document.createElement('script');
    ld.type = 'application/ld+json';
    ld.id = 'cms-ld';
    ld.textContent = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph });
    document.head.appendChild(ld);
  }

  function fill(root, a, canonical) {
    var f = function (sel) { return root.querySelector('[data-f="' + sel + '"]'); };
    if (f('crumb')) f('crumb').textContent = a.title;
    if (f('title')) f('title').textContent = a.title;
    if (f('excerpt')) {
      var ex = a.excerpt || plain(a.body).slice(0, 180) + '…';
      f('excerpt').textContent = ex;
    }
    if (f('kicker')) {
      f('kicker').textContent = (a.category || 'Article') + ' · ' + (a.reading_minutes || 1) + ' MIN READ';
    }
    if (f('meta')) {
      var bits = ['AH Solution Editorial'];
      if (a.category) bits.push(a.category);
      if (a.published_at) bits.push('Published ' + fmtDate(a.published_at));
      f('meta').innerHTML = bits.map(function (b) { return '<span>' + esc(b) + '</span>'; }).join('');
    }
    if (f('tags') && a.tags) {
      f('tags').textContent = a.tags;
      f('tags').hidden = false;
    }
    var slot = f('cover-slot');
    if (slot) {
      slot.textContent = '';
      if (a.cover_image_url) {
        var img = document.createElement('img');
        img.className = 'article-cover';
        img.src = a.cover_image_url;
        img.alt = a.title;
        img.decoding = 'async';
        img.loading = 'eager';
        img.width = 1400;
        img.height = 800;
        slot.appendChild(img);
      }
    }
    if (f('body')) f('body').innerHTML = a.body || '';

    root.querySelectorAll('[data-share-url]').forEach(function (el) {
      el.setAttribute('href', String(el.dataset.shareHref || el.href).replace(/url=[^&]*/, 'url=' + encodeURIComponent(canonical)));
    });
    var wa = root.querySelector('[data-share-wa]');
    if (wa) wa.setAttribute('href', 'https://wa.me/?text=' + encodeURIComponent(a.title + ' ' + canonical));

    applyMeta(a, canonical);
  }

  function initArticle() {
    var root = document.querySelector('[data-cms-article]');
    if (!root) return;
    var status = root.querySelector('[data-cms-status]');
    var slug = new URLSearchParams(location.search).get('slug');
    if (!slug) {
      if (status) status.textContent = 'Pick an article from the blog to read it here.';
      return;
    }
    var canonical = 'https://ahsolution.live/article.html?slug=' + encodeURIComponent(slug);
    if (status) status.textContent = 'Loading article…';

    return getJSON(ENDPOINT + qs({ action: 'list', slug: slug })).then(function (res) {
      var a = res && res.article;
      if (!a) throw new Error('not_found');
      fill(root, a, canonical);
      if (status) status.hidden = true;
      document.dispatchEvent(new CustomEvent('ah:article:ready', { detail: a }));
      return loadRelated(a, root);
    }).catch(function (err) {
      if (status) {
        status.hidden = false;
        status.textContent = err && err.status === 404
          ? 'This article could not be found. It may have been unpublished.'
          : 'The article could not be loaded right now. Please try again later.';
      }
      var t = root.querySelector('[data-f="title"]');
      if (t && err && err.status === 404) t.textContent = 'Article not found';
    });
  }

  function loadRelated(a, root) {
    var box = root.querySelector('[data-cms-related]');
    if (!box) return;
    return getJSON(ENDPOINT + qs({ action: 'list', limit: 4 })).then(function (res) {
      var list = ((res && res.articles) || []).filter(function (x) { return x.slug !== a.slug; }).slice(0, 2);
      if (!list.length) { box.hidden = true; return; }
      box.innerHTML = list.map(function (x) {
        return '<a class="content-card tilt" data-tilt="6" href="' + esc(articleUrl(x.slug)) + '">' +
          '<div class="card-image"><img src="' + esc(x.cover_image_url || FALLBACK_COVER) + '" alt="" loading="lazy" decoding="async" width="900" height="600">' +
          '<span class="card-tag">' + esc(x.category || 'Article') + '</span></div>' +
          '<div class="card-body"><div class="card-meta">' + esc((x.category || 'Article').toUpperCase()) + ' · ' + (x.reading_minutes || 1) + ' MIN READ</div>' +
          '<h3>' + esc(x.title) + '</h3>' +
          '<div class="card-bottom"><span>Read article</span><span class="arrow">↗</span></div></div></a>';
      }).join('');
      var wrap = box.closest('[data-cms-related-wrap]');
      if (wrap) wrap.removeAttribute('hidden');
    }).catch(function () { box.hidden = true; });
  }

  window.AHCms = {
    endpoint: ENDPOINT,
    listPublished: function (limit) { return getJSON(ENDPOINT + qs({ action: 'list', limit: limit || 24 })); },
    bySlug: function (slug) { return getJSON(ENDPOINT + qs({ action: 'list', slug: slug })); },
    cardHTML: cardHTML,
    initBlog: initBlog,
    initArticle: initArticle
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { initBlog(); initArticle(); });
  } else {
    initBlog(); initArticle();
  }
})();
