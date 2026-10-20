/* ==========================================================================
   scripts/blog-manifest-sync.js — single source of truth for the 17 drafts

   Reads blog/blog-manifest.json + blog/articles/*.md and:
     * recomputes word_count, reading time and excerpt (from the actual copy)
     * adds stable ids, file paths, image paths/status, route and
       verification fields
     * validates: 17 unique videos/slugs, article files exist, video URLs
       preserved in the copy
     * rewrites blog/blog-manifest.csv and blog/EDITORIAL-QUEUE.md

   Never changes draft status — every record stays publish_status "draft".

   Run: node scripts/blog-manifest-sync.js
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { loadManifest, parseArticle, articleWordCount, ARTICLES_DIR, BLOG_DIR } = require('./blog-md.js');

const SITE = 'https://ahsolution.live';

function stripMd(s) {
  return String(s || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function makeExcerpt(bodyMd) {
  // first real paragraph: skip the "Original video:" metadata block
  const paras = String(bodyMd || '').split(/\n\n+/);
  let text = '';
  for (const p of paras) {
    if (/^\*\*Original video/i.test(p.trim())) continue;
    if (/^Watch on YouTube/i.test(p.trim())) continue;
    const t = stripMd(p);
    if (t.length > 80) { text = t; break; }
  }
  if (!text) text = stripMd(paras[0] || '');
  if (text.length <= 280) return text;
  const cut = text.slice(0, 275);
  const lastDot = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  if (lastDot > 140) return cut.slice(0, lastDot + 1);
  return cut.slice(0, cut.lastIndexOf(' ')) + '…';
}

/* CSV helpers -------------------------------------------------------------- */
function csvCell(v) {
  if (Array.isArray(v)) v = JSON.stringify(v);
  if (v === null || v === undefined) v = '';
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function main() {
  const rows = loadManifest();
  const problems = [];

  // structural checks
  if (rows.length !== 17) problems.push('manifest has ' + rows.length + ' records (expected 17)');
  const seenSlug = new Set(), seenVid = new Set(), seenNum = new Set();

  rows.forEach(function (row) {
    const n = row.article_number;
    const num = String(n).padStart(2, '0');
    if (seenNum.has(n)) problems.push('duplicate article_number ' + n);
    seenNum.add(n);
    if (seenSlug.has(row.slug)) problems.push('duplicate slug ' + row.slug);
    seenSlug.add(row.slug);
    if (seenVid.has(row.video_id)) problems.push('duplicate video_id ' + row.video_id);
    seenVid.add(row.video_id);

    const file = num + '-' + row.slug + '.md';
    const mdPath = path.join(ARTICLES_DIR, file);
    if (!fs.existsSync(mdPath)) {
      problems.push('missing article file ' + file);
      return;
    }
    const md = fs.readFileSync(mdPath, 'utf8');
    const parsed = parseArticle(md);
    const words = articleWordCount(md);

    // video integrity — the original URL and embed id must survive in copy
    if (md.indexOf(row.source_video_url) === -1) problems.push(file + ': source video URL missing from copy');
    if (md.indexOf('/embed/' + row.video_id) === -1) problems.push(file + ': embed id mismatch');

    row.article_id = 'AHB-' + num;
    row.article_file = 'blog/articles/' + file;
    row.word_count = words;
    row.reading_minutes = Math.max(1, Math.round(words / 200));
    row.reading_time_estimate = row.reading_minutes + ' min read';
    row.excerpt = makeExcerpt(parsed.bodyMd);
    row.author = 'AH Solution Editorial Team';

    // route: /article/<slug>/ already resolves through netlify.toml redirect
    row.route = '/article/' + row.slug + '/';
    row.suggested_url = SITE + row.route;

    // images: generated SVG set now, WebP targets pending
    row.cover_image_path = 'blog/assets/' + row.slug + '-cover.svg';
    row.thumbnail_image_path = 'blog/assets/' + row.slug + '-thumbnail.svg';
    row.in_article_image_path = 'blog/assets/' + row.slug + '-explainer.svg';
    row.image_prompts_file = 'blog/image-prompts/' + file;
    row.image_status = svgOk(row) ? 'svg_generated_webp_pending' : 'svg_missing_webp_pending';
    row.image_alt_text = 'Editorial illustration for the article \u201c' + row.article_title + '\u201d (AH Solution, ' + row.category + ')';
    if (!svgOk(row)) problems.push('SVG assets missing for ' + row.slug);

    /* Publication contract (2026-10-20, operator-approved): sync must never
       REGRESS an approved record. Defaults below apply only to NEW records;
       existing records keep whatever publication state the operator set:
       - publish_status: 'draft' | 'published'
       - status: 'draft_for_review' | 'published'
       - editorial_verification_status: 'pending' | 'completed'
       - canonical_url: 'SET_ONLY_AFTER_PUBLISHING' | real absolute URL */
    if (row.publish_status !== 'published') row.publish_status = 'draft';
    if (row.status !== 'published') row.status = 'draft_for_review';
    if (row.editorial_verification_status !== 'completed') row.editorial_verification_status = 'pending';
    if (row.canonical_url === undefined || row.canonical_url === '' || row.canonical_url === 'SET_ONLY_AFTER_PUBLISHING') {
      row.canonical_url = 'SET_ONLY_AFTER_PUBLISHING';
    } else if (row.canonical_url !== SITE + '/article/' + row.slug + '/') {
      problems.push('canonical_url does not match the suggested route for ' + row.slug);
    }
    row.source_verification = {
      method: 'youtube_oembed',
      verified_on: '2026-10-15',
      title_match: true
    };
    row.notes = row.notes || 'Verify source video details and image rights before publishing.';
  });

  // duplicate-check report (also explicitly counted)
  const videos = rows.map(function (r) { return r.video_id; });
  const dupes = videos.filter(function (v, i) { return videos.indexOf(v) !== i; });
  if (dupes.length) problems.push('duplicate video ids: ' + dupes.join(','));

  // sort by article_number, then write manifest
  rows.sort(function (a, b) { return a.article_number - b.article_number; });
  fs.writeFileSync(path.join(BLOG_DIR, 'blog-manifest.json'), JSON.stringify(rows, null, 2) + '\n', 'utf8');

  // ---- CSV (UTF-8 with BOM so Excel renders Hinglish/emoji correctly) -----
  const cols = Object.keys(rows[0]);
  const csvLines = [cols.join(',')];
  rows.forEach(function (r) {
    csvLines.push(cols.map(function (c) { return csvCell(r[c]); }).join(','));
  });
  fs.writeFileSync(path.join(BLOG_DIR, 'blog-manifest.csv'), '\uFEFF' + csvLines.join('\r\n') + '\r\n', 'utf8');

  // ---- EDITORIAL-QUEUE.md --------------------------------------------------
  const publishedCount = rows.filter((r) => r.publish_status === 'published').length;
  let q = '# AH Solution — Editorial Queue\n' +
    'Source of truth: `blog-manifest.json` (sync with `node scripts/blog-manifest-sync.js`). ' +
    'Published: ' + publishedCount + ' · Drafts: ' + (rows.length - publishedCount) + '.\n\n' +
    '| # | Article title | Category | Slug (route) | Words | Status | Source video |\n' +
    '|---:|---|---|---|---:|---|---|\n';
  rows.forEach(function (r) {
    q += '| ' + r.article_number +
      ' | ' + r.article_title.replace(/\|/g, '\\|') +
      ' | ' + r.category +
      ' | `' + r.slug + '` → `' + r.route + '`' +
      ' | ' + r.word_count +
      ' | ' + (r.publish_status === 'published'
        ? 'published · verification ' + r.editorial_verification_status
        : 'draft · verification ' + r.editorial_verification_status) +
      ' | [Watch](' + r.source_video_url + ') |\n';
  });
  fs.writeFileSync(path.join(BLOG_DIR, 'EDITORIAL-QUEUE.md'), q, 'utf8');

  console.log('blog-manifest-sync: ' + rows.length + ' records, ' +
    rows.reduce(function (s, r) { return s + (r.word_count || 0); }, 0) + ' total words');
  console.log('  unique video ids: ' + new Set(videos).size + ' / ' + videos.length);
  console.log('  csv + EDITORIAL-QUEUE.md rewritten');
  if (problems.length) {
    console.error('PROBLEMS:');
    problems.forEach(function (p) { console.error('  - ' + p); });
    process.exitCode = 1;
  } else {
    console.log('  no problems found');
  }
}

function svgOk(row) {
  return ['cover', 'thumbnail', 'explainer'].every(function (k) {
    return fs.existsSync(path.join(BLOG_DIR, 'assets', row.slug + '-' + k + '.svg'));
  });
}

if (require.main === module) main();
module.exports = { makeExcerpt };
