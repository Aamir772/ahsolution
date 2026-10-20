/* ==========================================================================
   scripts/blog-build.js — build the PUBLIC blog from the manifest

   Single source of truth: blog/blog-manifest.json. This one script:
     1. generates a real, indexable article page for every manifest record at
        article/<slug>/index.html  (canonical = <SITE>/article/<slug>/)
     2. injects the 17 listing cards into blog.html between the
        BLOG:ARTICLES markers (the main, public Blog page)
     3. injects the article URLs into sitemap.xml between its markers

   It replaces the old local-only preview generator (scripts/blog-preview.js).
   Nothing is committed or deployed here — it only writes files into the repo.

   Run: node scripts/blog-build.js
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  loadManifest, parseArticle, renderBody, filterKey, readingMinutes,
  articleWordCount, videoJsonDiv, isoDuration, ARTICLES_DIR
} = require('./blog-md.js');

const SITE = 'https://ahsolution.live';
const ROOT = path.join(__dirname, '..');
const BLOG_HTML = path.join(ROOT, 'blog.html');
const SITEMAP = path.join(ROOT, 'sitemap.xml');
const ARTICLE_DIR = path.join(ROOT, 'article');
const AUTHORS = 'AH Solution Editorial Team';
const FALLBACK_IMG = '/assets/img/og-default.jpg';

const MARK_START = '<!-- BLOG:ARTICLES:START -->';
const MARK_END = '<!-- BLOG:ARTICLES:END -->';

/* Editorial reading order for the listing (position 1 = the feature card).
   This is a deliberate, hand-picked sequence — not an engagement metric —
   so the first card a reader sees is always a broadly useful how-to. */
const EDITORIAL_ORDER = [
  'control-laptop-from-android-chrome-remote-desktop',
  'windows-10-11-keyboard-shortcuts-productivity',
  'mirror-android-screen-to-tv-pc-wireless-guide',
  'android-night-photography-long-exposure-guide',
  'five-unique-android-apps-useful-apps-guide',
  'eight-android-apps-free-alternatives-guide',
  'wamr-whatsapp-deleted-messages-limitations-privacy',
  'windows-startup-welcome-voice-jarvis-style',
  'pc-live-wallpaper-mlwapp-guide',
  'brave-vs-chrome-privacy-speed-comparison',
  'thop-tv-free-streaming-apps-legal-security-risks',
  'hp-pavilion-ryzen-5-laptop-unboxing-short',
  'iqoo-z5-5g-unboxing-first-look',
  'aqfit-w15-smartwatch-review-buying-guide',
  'msi-gf63-gaming-laptop-review-buying-guide',
  'hp-pavilion-gaming-ryzen-5-3550h-review',
  'welcome-to-ah-solution-tech-tips-tutorials'
];
const editorialPos = (slug) => {
  const i = EDITORIAL_ORDER.indexOf(slug);
  return i === -1 ? 90 : i + 1;
};

/* -------------------------------- helpers -------------------------------- */

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const asset = (p) => '/' + String(p || '').replace(/^\/+/, '');
const abs = (p) => SITE + '/' + String(p || '').replace(/^\/+/, '');

function replaceRegion(text, inner, label) {
  const a = text.indexOf(MARK_START);
  const b = text.indexOf(MARK_END);
  if (a === -1 || b === -1 || b < a) throw new Error('missing ' + MARK_START + ' / ' + MARK_END + ' in ' + label);
  return text.slice(0, a + MARK_START.length) + '\n' + inner + '\n' + text.slice(b);
}

/* ------------------------------- site chrome ----------------------------- */

const SEARCH_MODAL = `<div class="search-modal" data-search-modal role="dialog" aria-modal="true" aria-label="Site search">
  <div class="search-panel">
    <div class="search-field">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#A5A5B0" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input type="search" placeholder="Search tutorials, guides and pages…" aria-label="Search">
      <button class="icon-btn" data-search-close aria-label="Close search">✕</button>
    </div>
    <div class="search-results" data-search-results></div>
    <div class="search-hint">Tip: press <strong>/</strong> to search · <strong>Esc</strong> to close</div>
  </div>
</div>`;

const HEADER = `<header class="site-header">
  <div class="container nav">
    <a class="brand" href="/index.html" aria-label="AH Solution — home">
      <img class="brand-logo" src="/assets/img/logo.svg" alt="AH Solution" width="152" height="40" decoding="async">
    </a>
    <nav class="nav-links" id="primary-nav" aria-label="Main navigation">
      <span class="nav-pill" aria-hidden="true"></span>
      <a href="/index.html">Home</a>
      <a href="/vlogs.html">Videos</a>
      <a href="/vlogs.html#shorts">Shorts</a>
      <a href="/blog.html" class="active" aria-current="page">Blog</a>
      <a href="/index.html#categories">Categories</a>
      <a href="/about.html">About</a>
      <a href="/contact.html">Contact</a>
    </nav>
    <div class="nav-right">
      <button class="icon-btn" data-search-open aria-label="Search the website" title="Search (press /)">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      </button>
      <a class="nav-cta" href="https://www.youtube.com/channel/UC_LdZmWha8cvotco41D77fw" target="_blank" rel="noopener noreferrer">Watch on YouTube <span aria-hidden="true">↗</span></a>
      <button class="menu-toggle" aria-label="Toggle navigation" aria-expanded="false" aria-controls="primary-nav"><span></span><span></span><span></span></button>
    </div>
  </div>
</header>`;

const FOOTER = `<footer class="site-footer">
  <div class="container">
    <div class="footer-top">
      <div class="footer-brand">
        <a class="brand" href="/index.html" aria-label="AH Solution — home">
          <img class="brand-logo brand-logo--sm" src="/assets/img/logo.svg" alt="AH Solution" width="129" height="34" decoding="async">
        </a>
        <p>Simple solutions for everyday tech problems. Practical tutorials, digital tools, and honest discoveries made easier to understand.</p>
      </div>
      <div class="footer-col">
        <strong>Explore</strong>
        <a href="/vlogs.html">Videos</a>
        <a href="/vlogs.html#shorts">Shorts</a>
        <a href="/blog.html">Blog &amp; guides</a>
        <a href="/index.html#categories">Categories</a>
      </div>
      <div class="footer-col">
        <strong>Company</strong>
        <a href="/about.html">About</a>
        <a href="/contact.html">Contact</a>
        <a href="/tutorials.html">Tutorials</a>
        <a href="/privacy.html">Privacy Policy</a>
        <a href="/terms.html#disclaimer">Disclaimer</a>
      </div>
      <div class="footer-col">
        <strong>Connect</strong>
        <a href="https://www.youtube.com/channel/UC_LdZmWha8cvotco41D77fw" target="_blank" rel="noopener noreferrer">YouTube ↗</a>
        <a href="https://www.instagram.com/ahsolutions01/" target="_blank" rel="noopener noreferrer">Instagram ↗</a>
        <a href="https://www.facebook.com/ahsolutions001" target="_blank" rel="noopener noreferrer">Facebook ↗</a>
        <a href="mailto:official.ahsolution@gmail.com">official.ahsolution@gmail.com ↗</a>
      </div>
    </div>
    <div class="footer-bottom">
      <span>© <span data-year></span> AH Solution. Built for curious minds.</span>
      <div class="footer-socials">
        <a href="/privacy.html">Privacy</a>
        <a href="/terms.html">Terms</a>
        <a href="/terms.html#disclaimer">Disclaimer</a>
        <a href="/contact.html">Contact</a>
      </div>
    </div>
  </div>
</footer>`;

const BOOT = `<div class="boot" data-boot aria-hidden="true">
  <div class="boot-inner">
    <div class="boot-emblem">
      <svg class="boot-ring" viewBox="0 0 128 128" aria-hidden="true" focusable="false">
        <defs><linearGradient id="ahBootGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#F0445E"></stop><stop offset="100%" stop-color="#3B82F6"></stop></linearGradient></defs>
        <circle class="boot-ring-track" cx="64" cy="64" r="56"></circle>
        <circle class="boot-ring-arc" cx="64" cy="64" r="56" stroke="url(#ahBootGrad)"></circle>
      </svg>
      <img class="boot-logo" src="/assets/img/logo.svg" alt="AH Solution" width="216" height="57" decoding="async">
      <span class="boot-wordmark" aria-hidden="true">AH SOLUTION</span>
    </div>
    <div class="boot-bar" aria-hidden="true"><span></span></div>
    <p class="boot-text">Starting AH Solution</p>
    <p class="boot-quote" data-boot-quote>Work smarter, not just harder.</p>
  </div>
</div>`;

const ANNOUNCE = `<div class="announcement">
  <div class="container">
    <span><i class="ann-dot"></i><strong>AH SOLUTION</strong> &nbsp; TIPS, TRICKS AND TECHNIQUES</span>
    <span>Practical guides for everyday tech</span>
  </div>
</div>`;

const DEVICE_TAIL = `  </div><!-- /device-screen -->
  <div class="device-chrome" aria-hidden="true">
    <span class="device-cam" aria-hidden="true"></span>
    <span class="device-stand" aria-hidden="true"></span>
  </div>
  <button class="device-toggle" data-device-toggle type="button" aria-pressed="false" aria-label="Toggle full-width view">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M16 21h3a2 2 0 0 0 2-2v-3M8 21H5a2 2 0 0 1-2-2v-3"/></svg>
    <span data-device-toggle-label>Full width</span>
  </button>
</div><!-- /device-shell -->`;

function head(o) {
  return `<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<script>/* AH session boot flag: set BEFORE first paint so the intro plays once per tab */(function(){var h=document.documentElement,skip=false;try{skip=sessionStorage.getItem("ah-intro")==="1";}catch(e){skip=false;}if(skip){h.classList.add("booted");}else{h.classList.add("boot-intro");try{sessionStorage.setItem("ah-intro","1");}catch(e){}}})();</script>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="google-adsense-account" content="ca-pub-1564978792055470">
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1564978792055470" crossorigin="anonymous"></script>
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}">
${o.robots ? '<meta name="robots" content="' + esc(o.robots) + '">' : ''}
<meta name="theme-color" content="#08080B">
${o.canonical ? '<link rel="canonical" href="' + esc(o.canonical) + '">' : ''}
<meta property="og:type" content="${o.ogType || 'article'}">
<meta property="og:site_name" content="AH Solution">
<meta property="og:title" content="${esc(o.ogTitle || o.title)}">
<meta property="og:description" content="${esc(o.description)}">
${o.canonical ? '<meta property="og:url" content="' + esc(o.canonical) + '">' : ''}
<meta property="og:image" content="${esc(o.image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:type" content="${o.imageType || 'image/png'}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/assets/img/favicon.ico" sizes="any">
<link rel="icon" type="image/svg+xml" href="/assets/img/favicon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/assets/img/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/assets/img/favicon-16x16.png">
<link rel="apple-touch-icon" sizes="180x180" href="/assets/img/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@400;500;600;700;800&display=swap">
<link rel="stylesheet" href="/assets/css/tokens.css">
<link rel="stylesheet" href="/assets/css/styles.css">
<link rel="stylesheet" href="/assets/css/editorial.css">
<link rel="stylesheet" href="/assets/css/device.css">
<noscript><style>.boot{display:none !important}.device-shell{opacity:1 !important}</style></noscript>
${o.jsonld ? '<script type="application/ld+json">' + o.jsonld + '</script>' : ''}
</head>
<body${o.bodyClass ? ' class="' + o.bodyClass + '"' : ''}>
${BOOT}
<div class="device-shell" data-device-shell>
  <div class="device-screen" data-device-screen>
<a class="skip-link" href="#main">Skip to content</a>
${ANNOUNCE}
${HEADER}
${SEARCH_MODAL}`;
}

/* ------------------------------ listing card ----------------------------- */

function card(row, words, indent, size) {
  const pad = ' '.repeat(indent == null ? 8 : indent);
  const thumb = asset(row.thumbnail_image_path || ('blog/assets/' + row.slug + '-thumbnail.svg'));
  const mins = row.reading_minutes || readingMinutes(words);
  const search = [row.article_title, row.excerpt, row.category, (row.tags || []).join(' '),
    (row.secondary_keywords || []).join(' ')].join(' ').toLowerCase().replace(/"/g, '');
  const href = '/article/' + row.slug + '/';
  return pad + `<a class="content-card tilt${size ? ' ' + size : ''}" data-tilt="6" data-blog-card data-slug="${esc(row.slug)}" data-category="${esc(filterKey(row.category))}" data-order="${editorialPos(row.slug)}" data-min="${esc(mins)}" data-title="${esc(row.article_title)}" data-search="${esc(search)}" href="${href}">
${pad}  <div class="card-image"><img src="${esc(thumb)}" alt="Cover graphic: ${esc(row.article_title)}" loading="lazy" decoding="async" width="640" height="360" onerror="this.onerror=null;this.src='${FALLBACK_IMG}'"><span class="card-tag">${esc(row.category)}</span></div>
${pad}  <div class="card-body"><div class="card-meta">${esc(String(row.category).toUpperCase())} · ${esc(mins)} MIN READ</div>
${pad}    <h3>${esc(row.article_title)}</h3>
${pad}    <p>${esc(row.excerpt)}</p>
${pad}    <div class="card-bottom"><span>Read Article</span><span class="arrow">↗</span></div></div></a>`;
}

/* ----------------------------- article page ------------------------------ */

function articlePage(row, mdPath, all) {
  const md = fs.readFileSync(mdPath, 'utf8');
  const parsed = parseArticle(md);
  const rendered = renderBody(parsed.bodyMd);
  const words = rendered.words || articleWordCount(md);
  const mins = row.reading_minutes || readingMinutes(words);
  const cover = asset(row.cover_image_path || ('blog/assets/' + row.slug + '-cover.svg'));
  const canonical = SITE + '/article/' + row.slug + '/';

  /* Social crawlers do not rasterise SVG, so og:image prefers the 1200x630
     PNG produced by scripts/blog-raster.js and only falls back to the SVG. */
  const coverPng = 'blog/assets/' + row.slug + '-cover.png';
  const usePng = fs.existsSync(path.join(ROOT, coverPng));
  const image = abs(usePng ? coverPng : (row.cover_image_path || ('blog/assets/' + row.slug + '-cover.svg')));

  const video = {
    '@type': 'VideoObject',
    name: row.source_title,
    description: row.meta_description,
    thumbnailUrl: ['https://i.ytimg.com/vi/' + row.video_id + '/hqdefault.jpg'],
    contentUrl: row.source_video_url,
    embedUrl: 'https://www.youtube-nocookie.com/embed/' + row.video_id
  };
  if (row.video_publish_date) video.uploadDate = row.video_publish_date;
  if (row.video_duration) video.duration = isoDuration(row.video_duration);

  const jsonld = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BlogPosting',
        headline: row.article_title,
        description: row.meta_description,
        image: [image],
        inLanguage: 'en-IN',
        author: { '@type': 'Organization', name: AUTHORS, url: SITE + '/' },
        publisher: { '@type': 'Organization', name: 'AH Solution', url: SITE + '/' },
        isPartOf: { '@type': 'Blog', name: 'AH Solution Blog', url: SITE + '/blog.html' },
        mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
        articleSection: row.category,
        keywords: (row.tags || []).join(', ')
      },
      video
    ]
  });

  // related: same filter key first, then fill from the rest
  const key = filterKey(row.category);
  const related = all.filter((r) => r.slug !== row.slug && filterKey(r.category) === key)
    .concat(all.filter((r) => r.slug !== row.slug && filterKey(r.category) !== key))
    .slice(0, 2);

  const relatedHtml = related.map((r) => {
    let w = 1200;
    try {
      const f = path.join(ARTICLES_DIR, String(r.article_number).padStart(2, '0') + '-' + r.slug + '.md');
      w = articleWordCount(fs.readFileSync(f, 'utf8')) || w;
    } catch (e) { /* keep default */ }
    return card(r, w, 8);
  }).join('\n');

  const title = row.meta_title || (row.article_title + ' | AH Solution');

  /* Publication safety: the approved workflow is draft-for-review. A record
     stays `publish_status: "draft"` until the operator approves it, so the
     generated page is protected (robots noindex) and carries NO canonical —
     the author-approved canonical is exactly what publishing adds. Setting
     publish_status to "published" (or canonical_url to a real URL) flips the
     page to fully indexable. */
  const approved = row.publish_status === 'published' &&
    row.canonical_url && row.canonical_url !== 'SET_ONLY_AFTER_PUBLISHING';
  const draftRobots = approved ? '' : 'noindex, nofollow';
  const publishedCanonical = approved ? canonical : '';

  /* the trailing "Watch the original …" section becomes a framed component */
  let bodyHtml = rendered.html;
  const VIDEO_H2 = '<h2 id="watch-the-original-ah-solution-video">';
  const vi = bodyHtml.indexOf(VIDEO_H2);
  if (vi !== -1) bodyHtml = bodyHtml.slice(0, vi) + '<section class="video-block">\n' + bodyHtml.slice(vi) + '\n</section>';

  const catKey = filterKey(row.category);

  return head({
    title: title,
    description: row.meta_description,
    canonical: publishedCanonical,
    robots: draftRobots,
    image: image,
    imageType: usePng ? 'image/png' : 'image/svg+xml',
    ogType: 'article',
    ogTitle: row.article_title,
    bodyClass: 'theme-editorial article-page',
    jsonld: jsonld
  }) + `
<main id="main">
  <div class="reading-progress" aria-hidden="true"></div>
  <section class="page-hero">
    <div class="container">
      <nav class="breadcrumbs" aria-label="Breadcrumb">\n<a href="/index.html">Home</a> <span aria-hidden="true">/</span> <a href="/blog.html">Blog</a> <span aria-hidden="true">/</span> <a href="/blog.html?category=${encodeURIComponent(catKey || 'all')}">${esc(row.category)}</a> <span aria-hidden="true">/</span> <span aria-current="page">${esc(row.article_title)}</span></nav>
      ${approved ? '' : '<p class="draft-ribbon" role="status">Draft for review — not yet published. Search: noindex pending approval.</p>'}
      <a class="back-link" href="/blog.html">← Back to all articles</a>
      <div class="article-kicker">${esc(row.category)} · ${esc(mins)} min read</div>
      <h1 class="article-title">${esc(row.article_title)}</h1>
      <p class="article-intro">${esc(row.excerpt)}</p>
      <div class="article-meta"><span>${esc(AUTHORS)}</span><span>${esc(row.language || 'Hinglish')}</span><span>Source video ${esc((row.video_publish_date || '').slice(0, 10))}</span></div>
    </div>
  </section>

  <section class="section">
    <div class="container article-wrap">
      <article class="article-main">
        <img class="article-cover" src="${esc(cover)}" alt="${esc(row.image_alt_text || row.article_title)}" width="1200" height="630" decoding="async" onerror="this.onerror=null;this.src='/assets/img/og-default.jpg'">
        <div class="article-body" data-article-content>
${videoJsonDiv(row)}
${bodyHtml}
        </div>

        <div class="share-row">
          <span class="muted" style="align-self:center;font-size:11px;text-transform:uppercase;letter-spacing:.1em">Share</span>
          <a data-share-url href="https://twitter.com/intent/tweet?url=${encodeURIComponent(canonical)}" target="_blank" rel="noopener noreferrer">X / Twitter</a>
          <a data-share-url href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(canonical)}" target="_blank" rel="noopener noreferrer">Facebook</a>
          <button type="button" data-copy-link>Copy link</button>
        </div>

        <div>
          <h2 style="margin-top:44px">More from AH Solution</h2>
          <div class="grid-2">${relatedHtml}</div>
        </div>

        <p style="margin-top:18px"><a class="filter-chip" href="/blog.html">← Back to the blog</a></p>
      </article>

      <aside class="article-aside">
        <div class="aside-card">
          <h3>Source video</h3>
          <p>${esc(row.source_title)}</p>
          <div class="aside-links"><a href="${esc(row.source_video_url)}" target="_blank" rel="noopener noreferrer">Watch original on YouTube ↗</a></div>
        </div>
        <div class="aside-card">
          <h3>What we cover</h3>
          <div class="aside-links">
            <a href="/blog.html?category=${encodeURIComponent(catKey || 'all')}">More in ${esc(row.category)}</a>
            <a href="/blog.html">All articles</a>
            <a href="/vlogs.html">Video tutorials</a>
            <a href="/tutorials.html">Tutorial explorer</a>
          </div>
        </div>
      </aside>
    </div>
  </section>
</main>
${FOOTER}
${DEVICE_TAIL}
<script src="/assets/js/device.js" defer></script>
<script src="/assets/js/main.js" defer></script>
<script src="/assets/js/cms.js" defer></script>
</body>
</html>`;
}

/* --------------------------------- main ---------------------------------- */

function main() {
  const all = loadManifest().slice().sort((a, b) => Number(a.article_number) - Number(b.article_number));
  if (all.length === 0) throw new Error('manifest is empty');

  const prepared = all.map(function (row) {
    const num = String(row.article_number).padStart(2, '0');
    const file = num + '-' + row.slug + '.md';
    const mdPath = path.join(ARTICLES_DIR, file);
    if (!fs.existsSync(mdPath)) throw new Error('missing article: ' + mdPath);
    return { row: row, words: articleWordCount(fs.readFileSync(mdPath, 'utf8')), file: file };
  });

  /* 1. public article pages */
  fs.mkdirSync(ARTICLE_DIR, { recursive: true });
  prepared.forEach(function (p) {
    const dir = path.join(ARTICLE_DIR, p.row.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), articlePage(p.row, path.join(ARTICLES_DIR, p.file), all), 'utf8');
  });

  /* 2. listing cards injected into the main blog.html, in editorial order:
        card 1 becomes the feature, cards 2-3 the compact stack, the rest a
        regular 3-up rhythm (assets/js/main.js re-applies this after sorting
        or filtering so the grid never develops holes). */
  const ordered = prepared.slice()
    .sort((a, b) => editorialPos(a.row.slug) - editorialPos(b.row.slug));
  const sizeOf = (slug) => {
    const i = ordered.findIndex((p) => p.row.slug === slug);
    return i === 0 ? 'is-feature' : (i === 1 || i === 2) ? 'is-compact' : '';
  };
  const cards = ordered.map((p) => card(p.row, p.words, 8, sizeOf(p.row.slug))).join('\n');
  const blogHtml = fs.readFileSync(BLOG_HTML, 'utf8');
  fs.writeFileSync(BLOG_HTML, replaceRegion(blogHtml, cards, 'blog.html'), 'utf8');

  /* 3. sitemap entries — ONLY approved articles. Draft-for-review records are
     never listed (indexing protection), so the public sitemap always matches
     the intended publication state. Approved entries use the markdown source
     file's modification date as a reliable <lastmod>. */
  const approvedRows = all.filter((r) => {
    const num = String(r.article_number).padStart(2, '0');
    const mdPath = path.join(ARTICLES_DIR, num + '-' + r.slug + '.md');
    return r.publish_status === 'published' && r.canonical_url && r.canonical_url !== 'SET_ONLY_AFTER_PUBLISHING' &&
      fs.existsSync(mdPath);
  });
  const entries = approvedRows.map((r) => {
    const num = String(r.article_number).padStart(2, '0');
    let lastmod = '';
    try {
      lastmod = '<lastmod>' + fs.statSync(path.join(ARTICLES_DIR, num + '-' + r.slug + '.md')).mtime.toISOString().slice(0, 10) + '</lastmod>';
    } catch (e) { /* omit lastmod when no reliable date exists */ }
    return '  <url><loc>' + SITE + '/article/' + r.slug + '/</loc>' + lastmod + '<changefreq>monthly</changefreq><priority>0.7</priority></url>';
  }).join('\n');
  const sitemap = fs.readFileSync(SITEMAP, 'utf8');
  fs.writeFileSync(SITEMAP, replaceRegion(sitemap, entries, 'sitemap.xml'), 'utf8');

  const draftCount = all.length - approvedRows.length;
  console.log('blog-build: ' + prepared.length + ' article pages (' + approvedRows.length + ' approved/indexable, ' + draftCount + ' draft-protected noindex) + ' + prepared.length + ' blog cards + sitemap (' + approvedRows.length + ' article URLs)');
  console.log('review: npm start  →  http://localhost:8000/blog.html');
}

if (require.main === module) main();
module.exports = { articlePage, card };
