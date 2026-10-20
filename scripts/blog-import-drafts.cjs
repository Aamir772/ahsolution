/* ==========================================================================
   scripts/blog-import-drafts.cjs — import the 17 drafts into the AH Solution
   CMS (Supabase `articles` table) as DRAFT records only.

   Nothing is ever published by this script: status is hard-locked to "draft"
   and there is no --publish flag. Credentials come from the environment —
   they are never written to disk or printed.

   Usage:
     node scripts/blog-import-drafts.cjs
         dry run (default): validates + prints payload summary, canonical
         routes and the sitemap lines to add AFTER a human publishes.

     node scripts/blog-import-drafts.cjs --live --direct
         inserts/updates drafts directly via Supabase REST (service role).
         env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY [, ADMIN_EMAIL]

     node scripts/blog-import-drafts.cjs --live --endpoint https://SITE/.netlify/functions/articles --token <user-jwt>
         inserts/updates through the existing Netlify Function admin API.

   Idempotent: rows are matched by slug — existing drafts are updated in
   place, never duplicated, never flipped to published.
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  loadManifest, parseArticle, renderBody, videoJsonDiv,
  ARTICLES_DIR, readingMinutes
} = require('./blog-md.js');

const SITE = process.env.SITE_URL || 'https://ahsolution.live';

function buildPayload(row) {
  const num = String(row.article_number).padStart(2, '0');
  const mdPath = path.join(ARTICLES_DIR, num + '-' + row.slug + '.md');
  if (!fs.existsSync(mdPath)) throw new Error('missing article file: ' + mdPath);
  const md = fs.readFileSync(mdPath, 'utf8');
  const parsed = parseArticle(md);
  const rendered = renderBody(parsed.bodyMd, { rootPrefix: '' }); // CMS route renders at the site root
  const words = rendered.words;

  const body =
    videoJsonDiv(row) + '\n' +
    rendered.html + '\n' +
    '<div class="notice"><strong>Editorial verification pending:</strong> ' +
    String(parsed.editorialNote || '').replace(/</g, '&lt;') + '</div>';

  return {
    slug: row.slug,
    title: row.article_title,
    excerpt: row.excerpt,
    body: body,
    cover_image_url: SITE + '/' + row.cover_image_path,
    category: row.category,
    tags: (row.tags || []).join(', '),
    status: 'draft',                       // hard-locked — never published
    seo_description: row.meta_description,
    reading_minutes: readingMinutes(words),
    words: words
  };
}

/* ------------------------------- dry run --------------------------------- */

function dryRun(rows, payloads) {
  console.log('\nBLOG DRAFT IMPORT — DRY RUN (no network, nothing written)\n');
  console.log('records: ' + payloads.length + '  |  all forced to status="draft"');
  let totalWords = 0;
  payloads.forEach(function (p) { totalWords += p.words; });
  console.log('total article words: ' + totalWords);
  console.log('\nslugs / routes:');
  payloads.forEach(function (p) {
    console.log('  ' + p.slug.padEnd(46) + ' -> ' + SITE + '/article/' + p.slug + '/   [' + p.words + 'w, ' + p.reading_minutes + ' min]');
  });

  console.log('\nSitemap lines to add ONLY after an article is published by a human:');
  rows.forEach(function (r) {
    console.log('  <url><loc>' + SITE + '/article/' + r.slug + '/</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>');
  });

  console.log('\nPayload shape per article (keys):');
  console.log('  ' + Object.keys(payloads[0]).join(', '));
  console.log('\nNext step: review locally (npm run blog:preview), then run with');
  console.log('  --live --direct   or   --live --endpoint <url> --token <jwt>');
}

/* ------------------------------- direct ---------------------------------- */

function env(name) {
  const v = process.env[name];
  if (!v || v === 'YOUR_' + name || /YOUR-PROJECT|YOUR_PUBLISHABLE|YOUR_SERVICE/.test(v)) return '';
  return v;
}

async function directImport(payloads, only) {
  const url = env('SUPABASE_URL').replace(/\/$/, '');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    console.error('missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in environment');
    process.exit(2);
  }
  const headers = {
    apikey: key,
    Authorization: 'Bearer ' + key,
    'Content-Type': 'application/json',
    Prefer: 'return=representation'
  };
  let created = 0, updated = 0, skipped = 0;

  for (const p of payloads) {
    if (only && only !== p.slug) continue;
    const row = Object.assign({}, p); delete row.words;
    row.updated_at = new Date().toISOString();
    if (process.env.ADMIN_EMAIL) row.author_email = process.env.ADMIN_EMAIL;

    const get = await fetch(url + '/rest/v1/articles?slug=eq.' + encodeURIComponent(p.slug) + '&select=id', { headers });
    const existing = get.ok ? await get.json() : [];
    if (existing && existing[0]) {
      const res = await fetch(url + '/rest/v1/articles?id=eq.' + encodeURIComponent(existing[0].id), {
        method: 'PATCH', headers, body: JSON.stringify(row)
      });
      if (!res.ok) throw new Error('patch ' + p.slug + ' -> ' + res.status + ' ' + (await res.text()).slice(0, 200));
      updated++;
      console.log('  updated draft: ' + p.slug);
    } else {
      const res = await fetch(url + '/rest/v1/articles', { method: 'POST', headers, body: JSON.stringify(row) });
      if (!res.ok) throw new Error('insert ' + p.slug + ' -> ' + res.status + ' ' + (await res.text()).slice(0, 200));
      created++;
      console.log('  created draft: ' + p.slug);
    }
  }
  console.log('\ndone. created=' + created + ' updated=' + updated + ' skipped=' + skipped + ' (all status=draft)');
}

/* ------------------------------ via function ------------------------------------------ */

async function endpointImport(endpoint, token, payloads, only) {
  if (!endpoint || !token) {
    console.error('usage: --live --endpoint <articles-function-url> --token <supabase-user-jwt>');
    process.exit(2);
  }
  let created = 0, updated = 0;
  for (const p of payloads) {
    if (only && only !== p.slug) continue;
    const body = Object.assign({ action: 'create' }, p); delete body.words;

    // discover if slug already exists (authenticated list)
    const listRes = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list', status: 'draft', limit: 100 })
    });
    let dup = false;
    if (listRes.ok) {
      const data = await listRes.json();
      dup = (data.articles || []).some((a) => a.slug === p.slug);
    }
    const payload = dup ? Object.assign({ action: 'update', id: undefined }, body) : body;
    if (dup) {
      // fetch id for update
      const list2 = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list', status: 'draft', limit: 100 })
      });
      const d2 = list2.ok ? await list2.json() : { articles: [] };
      const row = (d2.articles || []).find((a) => a.slug === p.slug);
      payload.id = row && row.id;
      delete payload.action; payload.action = 'update';
    }
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const out = await res.json().catch(function () { return {}; });
    if (!res.ok || out.ok === false) {
      throw new Error(p.slug + ' -> ' + res.status + ' ' + JSON.stringify(out).slice(0, 200));
    }
    if (dup) { updated++; console.log('  updated draft: ' + p.slug); }
    else { created++; console.log('  created draft: ' + p.slug); }
  }
  console.log('\ndone. created=' + created + ' updated=' + updated + ' (all status=draft)');
}

/* --------------------------------- main ----------------------------------- */

async function main() {
  const args = process.argv.slice(2);
  const rows = loadManifest();
  const payloads = rows.map(buildPayload);

  // sanity: never allow a publish state anywhere
  payloads.forEach(function (p) {
    if (p.status !== 'draft') throw new Error('refusing non-draft status');
  });

  const only = (args.find(function (a) { return a.startsWith('--slug='); }) || '').replace('--slug=', '') || null;
  const live = args.includes('--live');

  if (!live) { dryRun(rows, payloads); return; }

  if (args.includes('--direct')) { await directImport(payloads, only); return; }

  const endpoint = (args.find(function (a) { return a.startsWith('--endpoint='); }) || '').replace('--endpoint=', '') ||
    (args[args.indexOf('--endpoint') + 1] && args[args.indexOf('--endpoint') + 1].startsWith('--') ? '' : args[args.indexOf('--endpoint') + 1]) || '';
  const token = (args.find(function (a) { return a.startsWith('--token='); }) || '').replace('--token=', '') ||
    (args[args.indexOf('--token') + 1] && args[args.indexOf('--token') + 1].startsWith('--') ? '' : args[args.indexOf('--token') + 1]) || '';
  await endpointImport(endpoint, token, payloads, only);
}

main().catch(function (e) {
  console.error('import failed:', e.message || e);
  process.exit(1);
});
