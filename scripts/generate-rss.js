/* ==========================================================================
   scripts/generate-rss.js â€” RSS/Atom feed generator for AH Solution blog

   Generates /rss.xml from published articles.
   Can run in manifest mode (default) or database mode (--source=db).

   Run: node scripts/generate-rss.js
        node scripts/generate-rss.js --source=db
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const SITE = 'https://ahsolution.live';
const ROOT = path.join(__dirname, '..');
const RSS_FILE = path.join(ROOT, 'rss.xml');

const args = process.argv.slice(2);
const sourceFlag = args.find((a) => a.startsWith('--source='));
const SOURCE = sourceFlag ? sourceFlag.split('=')[1] : 'manifest';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function formatDate(iso) {
  if (!iso) return new Date().toUTCString();
  try { return new Date(iso).toUTCString(); } catch (e) { return new Date().toUTCString(); }
}

function loadManifestArticles() {
  const manifest = require('../blog/blog-manifest.json');
  return manifest.filter((r) => {
    return r.publish_status === 'published' && r.canonical_url && r.canonical_url !== 'SET_ONLY_AFTER_PUBLISHING';
  });
}

async function loadDbArticles() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('BLOG_SOURCE=db but Supabase is not configured. Refusing to fall back to manifest.');

  const endpoint = url.replace(/\/$/, '') + '/rest/v1/articles';
  const params = [
    'select=slug,title,excerpt,seo_description,category,tags,published_at,created_at,author_email',
    'status=eq.published',
    'or=(published_at.is.null,published_at.lte.' + encodeURIComponent(new Date().toISOString()) + ')',
    'order=published_at.desc.nullslast,created_at.desc',
    'limit=50'
  ];

  const response = await fetch(endpoint + '?' + params.join('&'), {
    headers: {
      'apikey': key,
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error('Database request failed: HTTP ' + response.status + ' ' + body.slice(0, 200));
  }

  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error('Invalid database response');
  return rows;
}

function generateRss(articles) {
  const items = articles.map((a) => {
    const title = SOURCE === 'db' ? a.title : a.article_title;
    const slug = a.slug;
    const description = SOURCE === 'db' ? (a.seo_description || a.excerpt || '') : (a.meta_description || a.excerpt || '');
    const link = SITE + '/article/' + slug + '/';
    const pubDate = formatDate(SOURCE === 'db' ? (a.published_at || a.created_at) : a.video_publish_date);
    const category = SOURCE === 'db' ? (a.category || '') : (a.category || '');
    const author = SOURCE === 'db' ? (a.author_email || 'AH Solution Editorial Team') : 'AH Solution Editorial Team';

    return `  <item>
    <title>${esc(title)}</title>
    <link>${esc(link)}</link>
    <guid isPermaLink="true">${esc(link)}</guid>
    <description>${esc(description)}</description>
    <pubDate>${pubDate}</pubDate>
    <category>${esc(category)}</category>
    <author>${esc(author)}</author>
  </item>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>AH Solution Blog</title>
  <link>${SITE}/blog.html</link>
  <description>Practical tech guides, checklists and explainers from AH Solution.</description>
  <language>en-IN</language>
  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
  <atom:link href="${SITE}/rss.xml" rel="self" type="application/rss+xml" />
${items}
</channel>
</rss>`;
}

async function main() {
  let articles;
  if (SOURCE === 'db') {
    console.log('Source: database');
    articles = await loadDbArticles();
  } else {
    console.log('Source: manifest');
    articles = loadManifestArticles();
  }

  if (articles.length === 0) {
    console.warn('No articles found. RSS feed will be empty.');
  }

  const rss = generateRss(articles);
  fs.writeFileSync(RSS_FILE, rss, 'utf8');
  console.log('Generated rss.xml with ' + articles.length + ' articles');
}

if (require.main === module) {
  main().catch((e) => {
    console.error('generate-rss failed:', e.message || e);
    process.exit(1);
  });
}
module.exports = { generateRss, loadManifestArticles, loadDbArticles };

