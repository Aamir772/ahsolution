/* ==========================================================================
   AH SOLUTION — main.js (v4)
   Zero-dependency vanilla JS. Everything degrades gracefully.
   Sections:
      1 mobile nav   2 nav indicator  3 year   4 sticky header  5 scroll reveal
      6 tilt         7 hero parallax  8 globe (see globe.js)  9 video facades (delegated)
      10 dynamic video data   11 blog filter   12 reading progress
      13 search modal   14 newsletter   15 copy link
   Motion notes: durations/easings come from tokens.css (Motion-Primitives
   patterns reimplemented in CSS). Reveal elements use .reveal/.in and are
   observed once, including content injected later (see window.ahReveal).
   ========================================================================== */
(() => {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s = '') => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* Device-world aware scroll source: the monitor scroller when nested-scrolling
     is active, otherwise the window (mobile / full-width / no device markup). */
  const deviceScreen = $('[data-device-screen]');
  const nestedScroll = () => !!deviceScreen && getComputedStyle(deviceScreen).overflowY === 'auto';
  const scrollTopOf = () => nestedScroll() ? deviceScreen.scrollTop : window.scrollY;
  const viewportHeight = () => nestedScroll() ? deviceScreen.clientHeight : window.innerHeight;
  const scrollRoot = deviceScreen || window;

  /* ------------------------------------------------------------------ *
   * 0. Active navigation state (route + hash aware, single source)
   *    Static per-page classes stay as a fallback for JS-off rendering;
   *    JS refines the choice so e.g. vlogs.html#shorts highlights Shorts,
   *    vlogs.html highlights Videos, and article pages highlight Blog.
   * ------------------------------------------------------------------ */
  (function initActiveNav() {
    const nav = $('.nav-links');
    if (!nav) return;
    const norm = (p) => (p || '').toLowerCase().replace(/\/index\.html$/, '/').replace(/\/+$/, '') || '/';
    const mark = () => {
      const path = norm(location.pathname);
      const hash = (location.hash || '').toLowerCase().replace(/^#/, '');
      const links = $$('a', nav);
      let match = null;
      links.forEach((a) => {
        const href = a.getAttribute('href') || '';
        if (href.startsWith('http')) return;
        const parts = href.split('#');
        const h = (parts[1] || '').toLowerCase();
        const hOk = h ? h === hash : hash === '';
        if (parts[0] && norm(parts[0]) === path && hOk) match = a;
      });
      if (!match && path.indexOf('/article') === 0) {
        match = links.find(a => (a.getAttribute('href') || '').indexOf('blog') !== -1) || null;
      }
      if (!match && hash) {
        match = links.find(a => (a.getAttribute('href') || '').toLowerCase().endsWith('#' + hash)) || null;
      }
      if (!match) return; /* keep the page's static choice when no route matches */
      links.forEach(a => { a.classList.remove('active'); a.removeAttribute('aria-current'); });
      match.classList.add('active');
      match.setAttribute('aria-current', 'page');
    };
    mark();
    window.addEventListener('hashchange', mark);
  })();

  /* ------------------------------------------------------------------ *
   * 1. Mobile navigation
   * ------------------------------------------------------------------ */
  const toggle = $('.menu-toggle');
  const navLinksEl = $('.nav-links');
  if (toggle && navLinksEl) {
    const setOpen = (open) => {
      toggle.setAttribute('aria-expanded', String(open));
      navLinksEl.classList.toggle('open', open);
      if (open) { const first = $('a', navLinksEl); if (first) first.focus({ preventScroll: true }); }
    };
    // each link gets an index so CSS can stagger the open animation
    $$('a', navLinksEl).forEach((a, i) => a.style.setProperty('--i', i));
    toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
    $$('a', navLinksEl).forEach(a => a.addEventListener('click', () => setOpen(false)));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && navLinksEl.classList.contains('open')) setOpen(false); });
  }

  /* ------------------------------------------------------------------ *
   * 2. Animated nav indicator (glass pill follows active / hover)
   * ------------------------------------------------------------------ */
  (function navIndicator() {
    const pill = $('.nav-pill');
    const nav = $('.nav-links');
    if (!pill || !nav) return;
    const links = $$('a', nav);
    const activeLink = $('a.active', nav) || links[0];
    const moveTo = (el) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      const pr = nav.getBoundingClientRect();
      pill.style.width = r.width + 'px';
      pill.style.transform = `translate(${Math.round(r.left - pr.left)}px, -50%)`;
      pill.classList.add('ready');
    };
    const reset = () => moveTo(activeLink);
    links.forEach(a => {
      a.addEventListener('pointerenter', () => moveTo(a));
      a.addEventListener('focus', () => moveTo(a));
    });
    nav.addEventListener('pointerleave', reset);
    window.addEventListener('resize', reset, { passive: true });
    window.addEventListener('load', reset);
    setTimeout(reset, 60);
  })();

  /* ------------------------------------------------------------------ *
   * 3. Current year
   * ------------------------------------------------------------------ */
  $$('[data-year]').forEach(el => { el.textContent = new Date().getFullYear(); });

  /* ------------------------------------------------------------------ *
   * 3b. 3D social icons (hero lower area; footer brand as fallback)
   * ------------------------------------------------------------------ */
  (function socialIcons() {
    const host = $('.hero-copy') || $('.footer-brand');
    if (!host || $('.social-3d', host)) return;
    const ICONS = [
      { cls: 'social-3d__btn--yt', label: 'AH Solution on YouTube', href: 'https://www.youtube.com/channel/UC_LdZmWha8cvotco41D77fw',
        svg: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M23.5 6.6a3 3 0 0 0-2.1-2.1C19.5 4 12 4 12 4s-7.5 0-9.4.5A3 3 0 0 0 .5 6.6 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.4 3 3 0 0 0 2.1 2.1C4.5 20 12 20 12 20s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.4zM9.6 15.6V8.4l6.2 3.6-6.2 3.6z"/></svg>' },
      { cls: 'social-3d__btn--ig', label: 'AH Solution on Instagram', href: 'https://www.instagram.com/ahsolutions01/',
        svg: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 2.2c3.2 0 3.6 0 4.9.1 1.2.1 1.8.3 2.2.4.6.2 1 .5 1.4.9.4.4.7.8.9 1.4.2.4.4 1 .4 2.2.1 1.3.1 1.7.1 4.9s0 3.6-.1 4.9c-.1 1.2-.3 1.8-.4 2.2-.2.6-.5 1-.9 1.4-.4.4-.8.7-1.4.9-.4.2-1 .4-2.2.4-1.3.1-1.7.1-4.9.1s-3.6 0-4.9-.1c-1.2-.1-1.8-.3-2.2-.4a3.8 3.8 0 0 1-1.4-.9 3.8 3.8 0 0 1-.9-1.4c-.2-.4-.4-1-.4-2.2C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.9c.1-1.2.3-1.8.4-2.2.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.2 1-.4 2.2-.4C8.4 2.2 8.8 2.2 12 2.2zm0 1.8c-3.1 0-3.5 0-4.7.1-.9 0-1.4.2-1.7.3-.4.2-.7.4-1 .7-.3.3-.5.6-.7 1-.1.3-.3.8-.3 1.7C3.5 8.9 3.5 9.3 3.5 12s0 3.1.1 4.3c0 .9.2 1.4.3 1.7.2.4.4.7.7 1 .3.3.6.5 1 .7.3.1.8.3 1.7.3 1.2.1 1.6.1 4.7.1s3.5 0 4.7-.1c.9 0 1.4-.2 1.7-.3.4-.2.7-.4 1-.7.3-.3.5-.6.7-1 .1-.3.3-.8.3-1.7.1-1.2.1-1.6.1-4.3s0-3.1-.1-4.3c0-.9-.2-1.4-.3-1.7a2.7 2.7 0 0 0-.7-1 2.7 2.7 0 0 0-1-.7c-.3-.1-.8-.3-1.7-.3-1.2-.1-1.6-.1-4.7-.1zm0 3.1a4.7 4.7 0 1 1 0 9.4 4.7 4.7 0 0 1 0-9.4zm0 7.7a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm6-7.9a1.1 1.1 0 1 1-2.2 0 1.1 1.1 0 0 1 2.2 0z"/></svg>' },
      { cls: 'social-3d__btn--fb', label: 'AH Solution on Facebook', href: 'https://www.facebook.com/ahsolutions001',
        svg: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M24 12a12 12 0 1 0-13.9 11.9v-8.4H7.1V12h3V9.4c0-3 1.8-4.6 4.5-4.6 1.3 0 2.7.2 2.7.2v2.9h-1.5c-1.5 0-2 .9-2 1.9V12h3.3l-.5 3.5h-2.8v8.4A12 12 0 0 0 24 12z"/></svg>' }
    ];
    const nav = document.createElement('nav');
    nav.className = 'social-3d';
    nav.setAttribute('aria-label', 'AH Solution on social media');
    nav.innerHTML = ICONS.map(i =>
      `<a class="social-3d__btn ${i.cls}" href="${i.href}" target="_blank" rel="noopener noreferrer" aria-label="${i.label}">${i.svg}</a>`
    ).join('');
    host.appendChild(nav);
  })();

  /* ------------------------------------------------------------------ *
   * 4. Sticky header state
   * ------------------------------------------------------------------ */
  const header = $('.site-header');
  if (header) {
    const onScroll = () => header.classList.toggle('scrolled', scrollTopOf() > 12);
    onScroll();
    scrollRoot.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ------------------------------------------------------------------ *
   * 5. Scroll-reveal  (one observer; works for content injected later)
   * ------------------------------------------------------------------ */
  const revealSeen = new WeakSet();
  let revealIO = null;
  if ('IntersectionObserver' in window && !reduceMotion) {
    revealIO = new IntersectionObserver((entries) => {
      entries.forEach(en => {
        if (!en.isIntersecting) return;
        en.target.classList.add('in');
        revealIO.unobserve(en.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
  }
  const observeReveal = (el) => {
    if (!el || revealSeen.has(el)) return;
    revealSeen.add(el);
    if (revealIO) revealIO.observe(el); else el.classList.add('in');
  };
  window.ahReveal = (root) => {
    const scope = root || document;
    if (scope.classList && scope.classList.contains('reveal')) observeReveal(scope);
    $$('.reveal', scope).forEach(observeReveal);
  };
  $$('.reveal').forEach(observeReveal);
  // cards rendered by scripts (video data, CMS lists, filters) reveal too
  if ('MutationObserver' in window) {
    new MutationObserver((muts) => {
      muts.forEach(m => m.addedNodes.forEach(n => {
        if (n.nodeType !== 1) return;
        if (n.classList && n.classList.contains('reveal')) observeReveal(n);
        $$('.reveal', n).forEach(observeReveal);
      }));
    }).observe(document.body, { childList: true, subtree: true });
  }

  /* ------------------------------------------------------------------ *
   * 6. 3D tilt on cards
   * ------------------------------------------------------------------ */
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (fine && !reduceMotion) {
    $$('[data-tilt]').forEach(el => {
      const max = Number(el.dataset.tilt) || 7;
      let frame = null;
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width;
        const py = (e.clientY - r.top) / r.height;
        el.style.setProperty('--gx', (px * 100).toFixed(1) + '%');
        el.style.setProperty('--gy', (py * 100).toFixed(1) + '%');
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = null;
          el.style.transform = `perspective(1000px) rotateX(${(0.5 - py) * max}deg) rotateY(${(px - 0.5) * max}deg) translateY(-4px)`;
        });
      });
      el.addEventListener('pointerleave', () => { el.style.transform = ''; });
    });
  }

  /* ------------------------------------------------------------------ *
   * 7. Hero parallax
   * ------------------------------------------------------------------ */
  const hero = $('.hero');
  if (hero && fine && !reduceMotion) {
    const core = $('[data-hero-core]');
    hero.addEventListener('pointermove', (e) => {
      const r = hero.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width;
      const ny = (e.clientY - r.top) / r.height;
      hero.style.setProperty('--mx', (nx * 100).toFixed(1) + '%');
      hero.style.setProperty('--my', (ny * 100).toFixed(1) + '%');
      hero.style.setProperty('--px', (nx - 0.5).toFixed(3));
      hero.style.setProperty('--py', (ny - 0.5).toFixed(3));
      if (core && core.pointer) core.pointer(nx - 0.5, ny - 0.5);
    });
    hero.addEventListener('pointerleave', () => {
      hero.style.setProperty('--px', '0'); hero.style.setProperty('--py', '0');
      hero.style.setProperty('--mx', '78%'); hero.style.setProperty('--my', '20%');
      if (core && core.pointer) core.pointer(0, 0);
    });
  }

  /* ------------------------------------------------------------------ *
   * 9. Video facades — click to load the real YouTube embed (delegated,
   *    so cards rendered later from data also work)
   * ------------------------------------------------------------------ */
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-video-id]');
    if (btn) { e.preventDefault(); loadFacade(btn); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const btn = e.target.closest && e.target.closest('[data-video-id]');
    if (btn) { e.preventDefault(); loadFacade(btn); }
  });
  function loadFacade(btn) {
    const id = btn.dataset.videoId;
    const title = btn.dataset.videoTitle || 'YouTube video';
    const frame = document.createElement('iframe');
    frame.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
    frame.title = title;
    frame.loading = 'lazy';
    frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.allowFullscreen = true;
    btn.replaceWith(frame);
  }

  /* ------------------------------------------------------------------ *
   * 10. Dynamic video highlights / library / shorts (from videos.json)
   * ------------------------------------------------------------------ */
  (function videoData() {
    const containers = {
      highlights: $$('[data-video-highlights]'),
      latest: $$('[data-latest-videos]'),
      shorts: $$('[data-shorts-rail]')
    };
    if (!containers.highlights.length && !containers.latest.length && !containers.shorts.length) return;

    const base = location.pathname.includes('/guides/') ? '../' : '';
    const statusEls = $$('[data-video-status]');

    // Clearly-labelled offline snapshot. Used only if the live JSON cannot load,
    // and marked as cached in the UI so it is never mistaken for live data.
    const FALLBACK = {
      source: 'cached-snapshot', generatedAt: null,
      videos: [
        { id: 'iyHKLgdU2Rs', title: 'HP Pavilion Ryzen 5 Laptop Unboxing Teaser', url: 'https://www.youtube.com/shorts/iyHKLgdU2Rs', isShort: true, published: '2021-08-22T16:59:05+00:00', thumbnail: 'https://i2.ytimg.com/vi/iyHKLgdU2Rs/hqdefault.jpg', views: 15501, likes: 25, durationSeconds: 22 },
        { id: 'GVZDxvv6Ew0', title: 'How to Set Live Wallpaper on PC Using MLWApp', url: 'https://www.youtube.com/watch?v=GVZDxvv6Ew0', isShort: false, published: '2020-12-16T04:02:39+00:00', thumbnail: 'https://i4.ytimg.com/vi/GVZDxvv6Ew0/hqdefault.jpg', views: 563, likes: 29, durationSeconds: 206 },
        { id: 'TSajmI9B0Lc', title: 'AQFIT W15 Smartwatch Unboxing & Review', url: 'https://www.youtube.com/watch?v=TSajmI9B0Lc', isShort: false, published: '2021-06-24T16:34:44+00:00', thumbnail: 'https://i1.ytimg.com/vi/TSajmI9B0Lc/hqdefault.jpg', views: 3466, likes: 163, durationSeconds: 289 },
        { id: 'StUH6IwFz-k', title: '5 Unique Android Apps You Should Try!', url: 'https://www.youtube.com/watch?v=StUH6IwFz-k', isShort: false, published: '2021-05-12T05:30:02+00:00', thumbnail: 'https://i4.ytimg.com/vi/StUH6IwFz-k/hqdefault.jpg', views: 3435, likes: 274, durationSeconds: 428 },
        { id: 'MMWnwjDwdbw', title: 'HP Pavilion Gaming Ryzen 5 Unboxing & Review', url: 'https://www.youtube.com/watch?v=MMWnwjDwdbw', isShort: false, published: '2021-10-04T07:18:51+00:00', thumbnail: 'https://i2.ytimg.com/vi/MMWnwjDwdbw/hqdefault.jpg', views: 3752, likes: 45, durationSeconds: 307 }
      ]
    };

    const playSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
    const shortSvg = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10 8l6 4-6 4V8z"/><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';

    const fmtViews = (n) => n == null ? null : n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K' : String(n);
    /* Category classifier for the Videos-page filter chips. Keyword first-match
       wins; smartwatch/photography are checked before unboxing so "...Watch
       Unboxing" lands on Smartwatches, and unboxing before reviews so
       "...Unboxing & Review" lands on Unboxing. */
    const catOf = (v) => {
      const t = (v.title || '').toLowerCase();
      if (/smartwatch|aqfit|\bwatch\b/.test(t)) return 'smartwatch';
      if (/night photo|long exposure|photography|\bphoto/.test(t)) return 'photography';
      if (/unbox|first look/.test(t)) return 'unboxing';
      if (/tips|trick/.test(t)) return 'tips';
      if (/windows|\bpc\b|laptop|chrome|remote desktop|mirror android|keyboard/.test(t)) return 'windows';
      if (/\bapp/.test(t)) return 'android';
      if (/review/.test(t)) return 'reviews';
      return 'guides';
    };
    const fmtDur = (s) => {
      if (s == null) return null;
      const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
      return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(sec).padStart(2, '0');
    };
    const days = (v) => Math.max(1, (Date.now() - new Date(v.published).getTime()) / 86400000);
    const meta = (v, extra) => {
      const bits = [];
      if (v.views != null) bits.push('<b>' + fmtViews(v.views) + '</b> views');
      if (v.likes != null) bits.push('<b>' + fmtViews(v.likes) + '</b> likes');
      const d = fmtDur(v.durationSeconds);
      if (d) bits.push('<b>' + d + '</b>');
      if (extra) bits.push(extra);
      return '<div class="video-stats">' + bits.map(b => '<span>' + b + '</span>').join('') + '</div>';
    };

    const facade = (v, cls) => {
      const t = esc(v.title);
      const d = fmtDur(v.durationSeconds);
      return `<button class="${cls}" data-video-id="${esc(v.id)}" data-video-title="${t}" aria-label="Play: ${t}">` +
        `<img src="${esc(v.thumbnail)}" alt="" loading="lazy" decoding="async" width="480" height="360" onerror="this.onerror=null;this.src='https://i.ytimg.com/vi/${esc(v.id)}/mqdefault.jpg'">` +
        (d ? `<span class="facade-dur">${esc(d)}</span>` : '') +
        `<span class="facade-play" aria-hidden="true">${playSvg}</span></button>`;
    };

    const latestCard = (v, delay) => `<div class="video-card reveal" data-delay="${delay || 0}" data-video-cat="${catOf(v)}" data-video-published="${esc(v.published || '')}" data-video-views="${v.views ?? 0}">` +
      facade(v, 'video-facade') +
      `<div class="video-info"><h3>${esc(v.title)}</h3>${meta(v, v.isShort ? 'Short' : '')}</div></div>`;

    const highlightDefs = {
      top: { cls: 'hl-card--top', label: 'Top video', rule: 'Highest total views on the channel' },
      trending: { cls: 'hl-card--trending', label: 'Trending', rule: 'Highest average views per day since upload (view velocity)' },
      liked: { cls: 'hl-card--liked', label: 'Most liked', rule: 'Highest public like count' }
    };
    const highlightCard = (kind, v, rule) => {
      const def = highlightDefs[kind];
      const t = esc(v.title);
      const statVal = kind === 'liked' ? fmtViews(v.likes) : fmtViews(v.views);
      const statLbl = kind === 'liked' ? 'likes' : 'views';
      const extra = fmtDur(v.durationSeconds);
      return `<article class="hl-card ${def.cls} reveal">` +
        `<button class="hl-thumb" data-video-id="${esc(v.id)}" data-video-title="${t}" aria-label="Play: ${t}">` +
        `<img src="${esc(v.thumbnail)}" alt="" loading="lazy" decoding="async" width="480" height="360" onerror="this.onerror=null;this.src='https://i.ytimg.com/vi/${esc(v.id)}/mqdefault.jpg'">` +
        `<span class="hl-tag"><span class="dot"></span>${esc(def.label)}${v.isShort ? ' · Short' : ''}</span>` +
        `<span class="hl-play" aria-hidden="true">${playSvg}</span></button>` +
        `<div class="hl-body"><h3>${t}</h3>` +
        `<div class="hl-stat">${statVal != null ? `<b>${statVal}</b><span>${statLbl}</span>` : '<b>—</b><span>' + statLbl + ' unavailable</span>'}${extra ? `<span>· ${extra}</span>` : ''}</div>` +
        `<div class="hl-foot"><a href="${esc(v.url)}" target="_blank" rel="noopener noreferrer">Watch on YouTube ↗</a><span class="muted" style="font-size:10px">${esc(rule)}</span></div>` +
        `</div></article>`;
    };

    const shortCard = (v) => {
      const t = esc(v.title);
      const d = fmtDur(v.durationSeconds);
      return `<a class="short-card" href="${esc(v.url)}" target="_blank" rel="noopener noreferrer" aria-label="Watch Short: ${t}">` +
        `<img src="${esc(v.thumbnail)}" alt="" loading="lazy" decoding="async" width="480" height="360" onerror="this.onerror=null;this.src='https://i.ytimg.com/vi/${esc(v.id)}/mqdefault.jpg'">` +
        (d ? `<span class="facade-dur facade-dur--corner">${esc(d)}</span>` : '') +
        `<span class="short-badge">${shortSvg} Short</span>` +
        `<span class="short-play" aria-hidden="true">${playSvg}</span>` +
        `<span class="short-info"><h3>${t}</h3>${meta(v, null)}</span></a>`;
    };

    function setStatus(text, cached) {
      statusEls.forEach(el => {
        el.innerHTML = '<span class="data-badge' + (cached ? ' is-cache' : '') + '"><span class="dot"></span>' +
          (cached ? 'Cached snapshot' : 'Live channel data') + '</span><span>' + esc(text) + '</span>';
      });
    }

    /* Chunked stream renderer: paints the first batch immediately, then
       appends further batches as a sentinel scrolls into view. Keeps the
       site responsive with a 100+ item video library (lazy images stay
       lazy; reveal observers are (re)armed per batch). */
    function chunked(el, items, makeCard, first, step, emptyMsg) {
      el.innerHTML = '';
      if (!items.length) { el.innerHTML = '<p class="muted">' + emptyMsg + '</p>'; return; }
      let i = 0;
      const sentinel = document.createElement('div');
      sentinel.className = 'rail-sentinel';
      sentinel.setAttribute('role', 'status');
      sentinel.setAttribute('aria-label', 'Loading more videos');
      const io = ('IntersectionObserver' in window) ? new IntersectionObserver((entries) => {
        if (entries.some(e => e.isIntersecting)) append();
      }, { rootMargin: '320px 0px' }) : null;
      const done = () => { if (io) io.disconnect(); sentinel.remove(); };
      const append = () => {
        const tpl = document.createElement('template');
        tpl.innerHTML = items.slice(i, i + step).map((v, k) => makeCard(v, i + k)).join('');
        el.insertBefore(tpl.content, sentinel);
        i += step;
        if (window.ahReveal) window.ahReveal(el);
        if (i >= items.length) { done(); return; }
        /* keep streaming while the sentinel is already within range (tall
           viewports); the observer covers scrolling from further away */
        requestAnimationFrame(() => {
          if (i < items.length && sentinel.isConnected) {
            const r = sentinel.getBoundingClientRect();
            if (r.top < window.innerHeight + 320) append();
          }
        });
      };
      el.appendChild(sentinel);
      if (io) io.observe(sentinel);
      else sentinel.addEventListener('click', append);
      append();
    }

    /* Videos-page filter + sort state. The toolbar only exists on the Videos
       page; on pages without chips/sorting this stays untouched and the latest
       grid renders in the feed's default (newest-first) order. */
    let lastData = null;
    let activeCat = 'all';
    let activeSort = 'latest';

    function applyLatest() {
      if (!lastData) return;
      const videos = (lastData.videos || []).filter(v => v && v.id);
      const byViews = [...videos].sort((a, b) => (b.views ?? 0) - (a.views ?? 0));
      const top = byViews[0];
      const liked = videos.filter(v => v.likes != null).sort((a, b) => b.likes - a.likes)[0];
      const trending = videos
        .filter(v => v.id !== top?.id && v.id !== liked?.id)
        .sort((a, b) => ((b.views ?? 0) / days(b)) - ((a.views ?? 0) / days(a)))[0];
      const hlIds = new Set([top, trending, liked].filter(Boolean).map(v => v.id));
      let latest = videos.filter(v => !v.isShort && !hlIds.has(v.id));
      if (activeSort === 'latest') latest = [...latest].sort((a, b) => new Date(b.published) - new Date(a.published));
      else if (activeSort === 'oldest') latest = [...latest].sort((a, b) => new Date(a.published) - new Date(b.published));
      else if (activeSort === 'views') latest = [...latest].sort((a, b) => (b.views ?? 0) - (a.views ?? 0));
      if (activeCat !== 'all') latest = latest.filter(v => catOf(v) === activeCat);
      const emptyMsg = activeCat === 'all'
        ? 'No published long-form videos were found in the current feed.'
        : 'No long-form videos in this category yet — try another filter.';
      containers.latest.forEach(el => {
        const first = Number(el.dataset.limit) || 12;
        chunked(el, latest, (v, k) => latestCard(v, (k % 3) + 1), first, 12, emptyMsg);
      });
    }

    const chipBtns = $$('[data-video-filter]');
    chipBtns.forEach(btn => btn.addEventListener('click', () => {
      activeCat = btn.dataset.videoFilter || 'all';
      chipBtns.forEach(b => {
        const on = b === btn;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      applyLatest();
    }));
    $$('[data-video-sort]').forEach(sel => sel.addEventListener('change', () => {
      activeSort = sel.value || 'latest';
      applyLatest();
    }));

    function render(data, cached) {
      lastData = data;
      applyLatest();

      const videos = (data.videos || []).filter(v => v && v.id);
      const byViews = [...videos].sort((a, b) => (b.views ?? 0) - (a.views ?? 0));
      const top = byViews[0];
      const liked = videos.filter(v => v.likes != null).sort((a, b) => b.likes - a.likes)[0];
      const trending = videos
        .filter(v => v.id !== top?.id && v.id !== liked?.id)
        .sort((a, b) => ((b.views ?? 0) / days(b)) - ((a.views ?? 0) / days(a)))[0];

      const hlPicks = [['top', top], ['trending', trending], ['liked', liked]].filter(([, v]) => v);
      const hlIds = new Set(hlPicks.map(([, v]) => v.id));

      containers.highlights.forEach(el => {
        el.innerHTML = hlPicks.map(([kind, v]) => highlightCard(kind, v, highlightDefs[kind].rule)).join('');
        if (window.ahReveal) window.ahReveal(el);
      });

      const shorts = videos.filter(v => v.isShort);
      containers.shorts.forEach(el => {
        chunked(el, shorts, (v) => shortCard(v), Math.min(8, Number(el.dataset.limit) || 8), 8,
          'No Shorts were found in the current feed.');
      });

      const when = data.generatedAt ? new Date(data.generatedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'unknown date';
      setStatus(`Source: YouTube public feed · refreshed ${when}. Stats update when the data file is rebuilt (npm run fetch:videos).`, cached);
    }

    fetch(base + 'assets/data/videos.json', { cache: 'no-cache' })
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(data => { render(data, data.source === 'cached-snapshot'); tryLive(data); })
      .catch(() => { render(FALLBACK, true); tryLive(FALLBACK); });

    /* Live refresh: the snapshot above renders instantly (and works offline),
       then the server-side feed function may deliver fresher channel data.
       Only a newer payload replaces the current one — on any failure the last
       successful dataset stays on screen. One attempt per page load. */
    function tryLive(current) {
      let ctrl = null;
      try { if (typeof AbortController === 'function') ctrl = new AbortController(); } catch { /* old browsers */ }
      const timer = ctrl ? setTimeout(() => ctrl.abort(), 6000) : null;
      const url = base ? base.replace(/\/$/, '') + '/api/videos' : 'api/videos';
      fetch(url, { cache: 'no-cache', signal: ctrl ? ctrl.signal : undefined })
        .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(live => {
          if (!live || !Array.isArray(live.videos) || !live.videos.length) return;
          const snapAt = Date.parse(current && current.generatedAt || '') || 0;
          const liveAt = Date.parse(live.generatedAt || '') || 0;
          if (liveAt > snapAt + 1000) render(live, false);
        })
        .catch(() => { /* snapshot stays */ })
        .finally(() => { if (timer) clearTimeout(timer); });
    }
  })();

  /* ------------------------------------------------------------------ *
   * 11. Blog filtering + search
   * ------------------------------------------------------------------ */
  const blogSearch = $('[data-blog-search]');
  const chips = $$('[data-filter]');
  if ($('[data-blog-card]')) {
    let activeFilter = 'all';
    const grid = $('[data-cms-grid]');
    const sortSel = $('[data-blog-sort]');
    const countEl = $('[data-blog-count]');
    const emptyState = $('[data-empty-state]');
    const run = () => {
      const cards = $$('[data-blog-card]');
      const query = (blogSearch?.value || '').trim().toLowerCase();
      let shown = 0;
      cards.forEach(card => {
        const text = (card.dataset.search || card.textContent).toLowerCase();
        const cat = (card.dataset.category || '').toLowerCase();
        const show = (!query || text.includes(query)) && (activeFilter === 'all' || cat === activeFilter);
        card.classList.toggle('hidden', !show);
        if (show) shown++;
      });
      emptyState?.classList.toggle('hidden', shown !== 0);
      if (countEl) countEl.textContent = 'Showing ' + shown + ' of ' + cards.length + ' articles';
      applyLayout();
    };
    /* Editorial grid sizing: the first visible card is the feature, the next
       two are compact, the rest a regular 3-up rhythm. Driven by DOM order so
       it survives sorting, filtering and CMS cards. Hand-written guides
       (data-static) never lead. */
    const applyLayout = () => {
      if (!grid) return;
      let feature = false, compact = 0;
      $$('[data-blog-card]', grid).forEach(c => {
        if (c.classList.contains('hidden')) { c.classList.remove('is-feature', 'is-compact'); return; }
        if (c.dataset.static) { c.classList.remove('is-feature', 'is-compact'); return; }
        c.classList.remove('is-feature', 'is-compact');
        if (!feature) { c.classList.add('is-feature'); feature = true; }
        else if (compact < 2) { c.classList.add('is-compact'); compact++; }
      });
    };
    const applySort = () => {
      if (!sortSel || !grid) return;
      const mode = sortSel.value;
      const list = $$('[data-blog-card]', grid);
      list.sort((a, b) => {
        if (mode === 'title') return (a.dataset.title || '').localeCompare(b.dataset.title || '');
        if (mode === 'time') return (Number(a.dataset.min) || Infinity) - (Number(b.dataset.min) || Infinity);
        return (Number(a.dataset.order) || Infinity) - (Number(b.dataset.order) || Infinity);
      });
      list.forEach(card => emptyState ? grid.insertBefore(card, emptyState) : grid.appendChild(card));
      applyLayout();
    };
    blogSearch?.addEventListener('input', run);
    sortSel?.addEventListener('change', applySort);
    chips.forEach(chip => chip.addEventListener('click', () => {
      activeFilter = (chip.dataset.filter || 'all').toLowerCase();
      chips.forEach(c => c.classList.toggle('active', c === chip));
      run();
    }));
    $$('[data-filter-reset]').forEach(btn => btn.addEventListener('click', () => {
      if (blogSearch) blogSearch.value = '';
      const all = chips.find(c => (c.dataset.filter || '').toLowerCase() === 'all');
      if (all) all.click(); else { activeFilter = 'all'; run(); }
    }));
    document.addEventListener('ah:blog:refresh', () => { applySort(); run(); });
    const params = new URLSearchParams(location.search);
    if (blogSearch && params.get('q')) blogSearch.value = params.get('q');
    const cat = (params.get('category') || '').toLowerCase();
    if (cat) {
      const chip = chips.find(c => (c.dataset.filter || '').toLowerCase() === cat);
      if (chip) chip.click(); else run();
    } else {
      run();
    }
  }

  /* ------------------------------------------------------------------ *
   * 12. Reading progress (article pages)
   * ------------------------------------------------------------------ */
  const progress = $('.reading-progress');
  const article = $('[data-article-content]');
  if (progress && article) {
    const update = () => {
      const rect = article.getBoundingClientRect();
      const total = article.offsetHeight - viewportHeight();
      const done = Math.min(1, Math.max(0, -rect.top / Math.max(1, total)));
      progress.style.width = (done * 100) + '%';
    };
    scrollRoot.addEventListener('scroll', update, { passive: true });
    update();
  }

  /* ------------------------------------------------------------------ *
   * 13. Site search modal
   * ------------------------------------------------------------------ */
  (function searchModal() {
    const modal = $('[data-search-modal]');
    if (!modal) return;
    const input = $('input', modal);
    const results = $('[data-search-results]', modal);
    const INDEX = [
      { t: 'Home', d: 'AH Solution — Tips, tricks and techniques', u: 'index.html', k: 'home start tips tricks and techniques' },
      { t: 'Videos', d: 'Watch practical tech tutorials and first looks', u: 'vlogs.html', k: 'videos youtube watch tutorials library' },
      { t: 'Shorts', d: 'Short vertical clips and quick first looks', u: 'vlogs.html#shorts', k: 'shorts vertical quick clips reels' },
      { t: 'Blog', d: 'Written guides, checklists and explainers', u: 'blog.html', k: 'blog articles guides read' },
      { t: 'Categories', d: 'Browse every topic on AH Solution', u: 'index.html#categories', k: 'categories topics browse explore' },
      { t: 'Tutorials', d: 'Interactive tutorial explorer', u: 'tutorials.html', k: 'tutorials how to explore' },
      { t: 'Mobile Tips', d: 'Everyday tips for the phone you own', u: 'tutorials.html?category=mobile', k: 'mobile phone android tips' },
      { t: 'Android Apps', d: 'Useful and safe app recommendations', u: 'blog.html?category=android', k: 'apps android software recommendations' },
      { t: 'PC & Windows', d: 'Customisation and everyday PC tasks', u: 'blog.html?category=windows', k: 'pc windows computer laptop' },
      { t: 'Software Guides', d: 'Written guides and explainers', u: 'tutorials.html?category=guides', k: 'software guides written explainers' },
      { t: 'Gadgets', d: 'First looks and gadget checklists', u: 'blog.html?category=gadgets', k: 'gadgets smartwatch laptop review' },
      { t: 'About', d: 'The AH Solution mission', u: 'about.html', k: 'about mission brand' },
      { t: 'Contact', d: 'Reach AH Solution by email or socials', u: 'contact.html', k: 'contact email collaboration' },
      { t: 'Live wallpaper on PC', d: 'Set a video as your Windows wallpaper', u: 'guides/live-wallpaper-on-pc.html', k: 'pc windows wallpaper video mlwapp customization' },
      { t: 'Choose Android apps safely', d: 'Safety checklist before installing an app', u: 'guides/choose-android-apps-safely.html', k: 'android app safety permissions install privacy' },
      { t: 'Budget smartwatch checklist', d: 'What to check before buying', u: 'guides/budget-smartwatch-checklist.html', k: 'smartwatch buying guide wearable battery' },
      { t: 'Privacy notice', d: 'How this website handles information', u: 'privacy.html', k: 'privacy policy' },
      { t: 'Terms & conditions', d: 'Terms of use for this website', u: 'terms.html', k: 'terms legal conditions' }
    ];
    const base = location.pathname.includes('/guides/') ? '../' : '';
    const render = (items) => {
      if (!items.length) { results.innerHTML = '<div class="search-empty">No matches. Try “android”, “pc”, “wallpaper” or “smartwatch”.</div>'; return; }
      results.innerHTML = items.map(i => `<a class="search-result" href="${base}${i.u}"><strong>${esc(i.t)}</strong><span>${esc(i.d)}</span></a>`).join('');
    };
    const query = (q) => {
      q = q.trim().toLowerCase();
      if (!q) return INDEX.slice(0, 6);
      return INDEX.filter(i => (i.t + ' ' + i.d + ' ' + i.k).toLowerCase().includes(q)).slice(0, 8);
    };
    let isOpen = false;
    let lastFocus = null;
    const FOCUSABLE = 'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])';
    const focusables = () => $$(FOCUSABLE, modal).filter(el => el.offsetParent !== null || el === document.activeElement);
    const open = () => {
      if (isOpen) return;
      isOpen = true;
      lastFocus = document.activeElement;
      modal.classList.add('open');
      document.body.style.overflow = 'hidden';
      render(INDEX.slice(0, 6));
      // force a reflow so display:none -> block is committed before the
      // backdrop/panel transition starts (no rAF dependency on GPU load)
      void modal.offsetWidth;
      modal.classList.add('is-shown');
      input.focus({ preventScroll: true });
    };
    const close = () => {
      if (!isOpen) return;
      isOpen = false;
      modal.classList.remove('is-shown');
      document.body.style.overflow = '';
      const settle = () => { if (!isOpen) modal.classList.remove('open'); };
      modal.addEventListener('transitionend', settle, { once: true });
      setTimeout(settle, 320);
      if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus({ preventScroll: true });
      lastFocus = null;
    };
    $$('[data-search-open]').forEach(b => b.addEventListener('click', open));
    $$('[data-search-close]', modal).forEach(b => b.addEventListener('click', close));
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); isOpen ? close() : open(); return; }
      if (e.key === '/' && !/input|textarea/i.test(document.activeElement.tagName)) { e.preventDefault(); open(); return; }
      if (!isOpen) return;
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (!modal.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    input.addEventListener('input', () => render(query(input.value)));
  })();

  /* ------------------------------------------------------------------ *
   * 14. Newsletter (honest, no-backend handling)
   * ------------------------------------------------------------------ */
  $$('[data-newsletter]').forEach(form => {
    const status = $('[data-newsletter-status]', form);
    form.addEventListener('submit', (e) => {
      const email = $('input[type=email]', form)?.value.trim() || '';
      const endpoint = (form.dataset.endpoint || '').trim();
      if (endpoint) return;
      e.preventDefault();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { if (status) status.textContent = 'Please enter a valid email address.'; return; }
      const subject = encodeURIComponent('Newsletter subscription — AH Solution');
      const body = encodeURIComponent(`Please add this address to the AH Solution updates list:\n\n${email}`);
      window.location.href = `mailto:official.ahsolution@gmail.com?subject=${subject}&body=${body}`;
      if (status) status.textContent = 'Opening your email app to confirm…';
      form.reset();
    });
  });

  /* ------------------------------------------------------------------ *
   * 15. Share / copy link
   * ------------------------------------------------------------------ */
  $$('[data-copy-link]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(location.href);
        const prev = btn.textContent;
        btn.textContent = 'Link copied ✓';
        setTimeout(() => { btn.textContent = prev; }, 1800);
      } catch { btn.textContent = location.href; }
    });
  });
})();
