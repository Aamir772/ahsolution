#!/usr/bin/env node
/* ==========================================================================
   AH SOLUTION — build-ai-index.mjs
   Generates the SOLUTION AI knowledge index from existing site content:
     - pages      : the site-search INDEX inside assets/js/main.js
     - articles   : full text of guides/*.html
     - videos     : assets/data/videos.json (real YouTube data)
     - keywords   : data-search attributes on blog/tutorials cards
   Outputs (identical):
     - assets/data/ai-index.json
     - netlify/functions/_shared/ai-index.json
   Zero dependencies. Run: node scripts/build-ai-index.mjs
   ========================================================================== */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const writeOut = (rel, data) => {
  const abs = join(ROOT, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, data, 'utf8');
  return abs;
};

const MAX_TEXT = 1400;

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '\u2014',
  ndash: '\u2013', hellip: '\u2026', rsquo: '\u2019', lsquo: '\u2018',
  rdquo: '\u201D', ldquo: '\u201C', times: '\u00D7', copy: '\u00A9',
  deg: '\u00B0', middot: '\u00B7', laquo: '\u00AB', raquo: '\u00BB'
};
function decodeEntities(s) {
  return String(s).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, g) => {
    if (g[0] === '#') {
      const hex = g[1].toLowerCase() === 'x';
      const n = parseInt(g.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    const k = g.toLowerCase();
    return k in ENTITIES ? ENTITIES[k] : m;
  });
}
function textOf(html) {
  return decodeEntities(String(html).replace(/<[^>]*>/g, ' '))
    .replace(/[\u0000-\u001F\u007F\uFFFD]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function truncate(s, n = MAX_TEXT) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + '\u2026' : s;
}
function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/* ---- 1. Pages: reuse the canonical site-search INDEX in main.js ---- */
const pages = [];
{
  const js = read('assets/js/main.js');
  const re = /\{\s*t:\s*'([^']*)'\s*,\s*d:\s*'([^']*)'\s*,\s*u:\s*'([^']*)'\s*,\s*k:\s*'([^']*)'\s*\}/g;
  let m;
  while ((m = re.exec(js))) {
    const [, t, d, u, k] = m;
    pages.push({
      id: 'page:' + slug(u || t),
      type: 'page',
      title: textOf(t),
      url: u,
      description: textOf(d),
      keywords: textOf(k),
      text: textOf(`${t}. ${d}. ${k}`)
    });
  }
}

/* ---- 2. Articles: full text from guides/*.html ---- */
const articles = [];
{
  const dir = join(ROOT, 'guides');
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.html')) : [];
  for (const file of files) {
    const html = readFileSync(join(dir, file), 'utf8');
    const title = textOf((html.match(/<h1[^>]*class="article-title"[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || file.replace(/-/g, ' '));
    const intro = textOf((html.match(/<p[^>]*class="article-intro"[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || '');
    const bodyMatch = html.match(/data-article-content[^>]*>([\s\S]*?)<div class="share-row"/i);
    const bodyHtml = bodyMatch ? bodyMatch[1] : '';
    const headings = [];
    const hRe = /<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi;
    let hm;
    while ((hm = hRe.exec(bodyHtml))) {
      const h = textOf(hm[1]);
      if (h && !/^related articles$/i.test(h)) headings.push(h);
    }
    const body = textOf(bodyHtml);
    articles.push({
      id: 'article:' + slug(file.replace(/\.html$/, '')),
      type: 'article',
      title,
      url: 'guides/' + file,
      description: intro,
      headings,
      keywords: '',
      text: truncate(`${intro} ${body}`)
    });
  }
}

/* ---- 3. Videos: real data from assets/data/videos.json ---- */
const videos = [];
{
  const data = JSON.parse(read('assets/data/videos.json'));
  for (const v of data.videos || []) {
    const title = textOf(v.title);
    videos.push({
      id: 'video:' + v.id,
      type: 'video',
      title,
      url: v.url,
      isShort: !!v.isShort,
      thumbnail: v.thumbnail || '',
      published: v.published || '',
      keywords: '',
      text: textOf(`${title} ${v.isShort ? 'youtube short clip' : 'youtube video tutorial walkthrough'}`)
    });
  }
  videos.sort((a, b) => String(b.published).localeCompare(String(a.published)));
}

/* ---- 4. Keywords: harvest data-search from blog + tutorial cards ---- */
const keywordsByUrl = {};
for (const page of ['blog.html', 'tutorials.html']) {
  let html = '';
  try { html = read(page); } catch { continue; }
  const cardRe = /<a[^>]*class="[^"]*(?:content-card|tutorial-card)[^"]*"[^>]*>[\s\S]*?<\/a>/gi;
  let cm;
  while ((cm = cardRe.exec(html))) {
    const block = cm[0];
    const href = (block.match(/href="([^"]+)"/) || [])[1];
    const search = (block.match(/data-search="([^"]*)"/) || [])[1] || '';
    if (!href) continue;
    keywordsByUrl[href] = [keywordsByUrl[href], textOf(search)].filter(Boolean).join(' ').trim();
  }
}

function dedupeWords(s) {
  const seen = new Set();
  return String(s || '').split(/\s+/).filter((w) => {
    const k = w.toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  }).join(' ');
}

function applyKeywords(entries) {
  for (const e of entries) {
    const k = keywordsByUrl[e.url];
    if (k) {
      e.keywords = dedupeWords([e.keywords, k].filter(Boolean).join(' '));
      e.text = truncate([e.text, e.keywords].filter(Boolean).join(' '));
    }
  }
}
applyKeywords(pages);
applyKeywords(articles);
applyKeywords(videos);

/* ---- 5. Assemble + write ---- */
const entries = [...pages, ...articles, ...videos];
const out = {
  generatedAt: new Date().toISOString(),
  site: 'AH Solution',
  source: 'build-ai-index',
  counts: { pages: pages.length, articles: articles.length, videos: videos.length, total: entries.length },
  entries
};
const json = JSON.stringify(out, null, 2);
const a = writeOut('assets/data/ai-index.json', json);
const b = writeOut('netlify/functions/_shared/ai-index.json', json);
const kb = (n) => (Buffer.byteLength(n, 'utf8') / 1024).toFixed(1) + ' KB';
console.log(`SOLUTION AI index: ${entries.length} entries ` +
  `(${pages.length} pages, ${articles.length} articles, ${videos.length} videos) \u2014 ${kb(json)}`);
console.log('  wrote ' + a);
console.log('  wrote ' + b);
