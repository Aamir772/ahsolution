#!/usr/bin/env node
/**
 * scripts/migrate-legacy-articles.cjs
 * Idempotent legacy Markdown+manifest -> Supabase articles migration.
 *
 * Usage:
 *   node scripts/migrate-legacy-articles.cjs --dry-run
 *   node scripts/migrate-legacy-articles.cjs --execute --confirm "MIGRATE LEGACY ARTICLES"
 *
 * Safety:
 * - Never runs without explicit --confirm on --execute.
 * - Never deletes source Markdown/manifest.
 * - Upserts by slug (checks existing; inserts missing, updates only when safe).
 * - Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY for --execute/DB compare.
 * - Dry-run makes ZERO database writes.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseArticle, renderBody, readingMinutes, articleWordCount } = require('./blog-md.js');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const EXEC = args.includes('--execute');
const confirmIdx = args.indexOf('--confirm');
const CONFIRM = confirmIdx >= 0 ? args[confirmIdx+1] : '';
if (!DRY && !EXEC) { console.error('Use --dry-run or --execute --confirm "MIGRATE LEGACY ARTICLES"'); process.exit(2); }
if (EXEC && CONFIRM !== 'MIGRATE LEGACY ARTICLES') { console.error('Refusing: --execute requires --confirm "MIGRATE LEGACY ARTICLES"'); process.exit(2); }

function sha(s){ return crypto.createHash('sha256').update(s).digest('hex'); }
function loadManifest(){ const m=JSON.parse(fs.readFileSync(path.join(ROOT,'blog/blog-manifest.json'),'utf8')); return Array.isArray(m)?m:m.articles||[]; }
function readMd(file){
  const rel = String(file||'').replace(/^blog[\\\/]articles[\\\/]/,'');
  return fs.readFileSync(path.join(ROOT,'blog/articles',rel),'utf8');
}
function mdExists(file){
  const rel = String(file||'').replace(/^blog[\\\/]articles[\\\/]/,'');
  return fs.existsSync(path.join(ROOT,'blog/articles',rel));
}

const cfg = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
async function sb(pathname, opts={}){
  if(!cfg.url||!cfg.key) throw new Error('missing_supabase_credentials');
  const res = await fetch(cfg.url.replace(/\/$/,'') + pathname, { ...opts, headers: { apikey: cfg.key, Authorization: 'Bearer '+cfg.key, 'Content-Type':'application/json', ...(opts.headers||{}) } });
  const text = await res.text(); let data; try{data=text?JSON.parse(text):null;}catch{data=text;}
  return { ok: res.ok, status: res.status, data };
}

async function main(){
  const manifest = loadManifest();
  const backupDir = path.join(ROOT,'scripts','migration-backups', new Date().toISOString().replace(/[:.]/g,'-'));
  fs.mkdirSync(backupDir,{recursive:true});
  fs.copyFileSync(path.join(ROOT,'blog/blog-manifest.json'), path.join(backupDir,'blog-manifest.json'));
  const files = fs.readdirSync(path.join(ROOT,'blog/articles')).filter(f=>f.endsWith('.md'));
  const report = { mode: DRY?'dry-run':'execute', timestamp:new Date().toISOString(), source_count: manifest.length, md_files: files.length, backup: path.relative(ROOT,backupDir), items:[], summary:{create:0,update:0,skip:0,invalid:0,duplicate:0}, checksums:{} };

  const seen = new Set();
  for (const row of manifest) {
    const slug = String(row.slug||'').trim();
    const file = row.article_file || (slug ? slug+'.md' : '');
    const item = { slug, file, action:'skip', reasons:[] };
    if (!slug) { item.action='invalid'; item.reasons.push('missing_slug'); report.summary.invalid++; report.items.push(item); continue; }
    if (seen.has(slug)) { item.action='duplicate'; item.reasons.push('duplicate_slug'); report.summary.duplicate++; report.items.push(item); continue; }
    seen.add(slug);
    if (!file || !mdExists(file)) { item.action='invalid'; item.reasons.push('missing_markdown_file'); report.summary.invalid++; report.items.push(item); continue; }
    const md = readMd(file);
    report.checksums[file] = sha(md);
    const parsed = parseArticle(md);
    const rendered = renderBody(parsed.bodyMd || md, { rootPrefix: '../../' });
    const bodyHtml = rendered && rendered.html ? rendered.html : '';
    const candidate = {
      slug,
      title: String(row.article_title||parsed.title||'').slice(0,200),
      excerpt: String(row.excerpt||'').slice(0,400),
      body: bodyHtml,
      cover_image_url: row.cover_image_path ? String(row.cover_image_path).replace(/^\.\.\//,'/').replace(/^([^/])/,'/$1') : '',
      category: String(row.category||'').slice(0,50),
      tags: Array.isArray(row.tags)?row.tags.join(', '):String(row.tags||''),
      status: row.publish_status === 'published' ? 'published' : 'draft',
      seo_description: String(row.meta_description||row.excerpt||'').slice(0,300),
      reading_minutes: row.reading_minutes || readingMinutes(articleWordCount(md)) || 1,
      published_at: row.video_publish_date ? new Date(row.video_publish_date).toISOString() : null
    };
    if (!candidate.title) item.reasons.push('missing_title');
    if (!candidate.body) item.reasons.push('empty_body_after_parse');
    if (row.canonical_url && row.canonical_url !== 'SET_ONLY_AFTER_PUBLISHING') item.canonical = row.canonical_url;

    let existing = null;
    if (cfg.url && cfg.key) {
      try {
        const res = await sb('/rest/v1/articles?select=id,slug,title,status&slug=eq.'+encodeURIComponent(slug)+'&limit=1');
        if (res.ok && Array.isArray(res.data)) existing = res.data[0] || null;
      } catch (e) { item.reasons.push('db_lookup_failed:'+e.message); }
    } else if (!DRY) {
      item.action='invalid'; item.reasons.push('missing_supabase_credentials'); report.summary.invalid++; report.items.push(item); continue;
    }

    if (existing) { item.action='update'; item.existing_id=existing.id; item.reasons.push('slug_exists'); }
    else { item.action='create'; }
    report.summary[item.action] = (report.summary[item.action]||0)+1;

    if (EXEC && item.action !== 'invalid' && item.action !== 'duplicate') {
      try {
        if (existing) {
          // Preserve existing published content by default: only safe metadata/body refresh if draft or explicitly allowed? default: skip destructive overwrite of published
          if (existing.status === 'published') { item.action='skip'; item.reasons.push('preserve_published_existing'); report.summary.skip++; report.summary.update--; }
          else {
            const res = await sb('/rest/v1/articles?id=eq.'+encodeURIComponent(existing.id), { method:'PATCH', headers:{Prefer:'return=minimal'}, body: JSON.stringify(Object.assign({}, candidate, { updated_at: new Date().toISOString() })) });
            if (!res.ok) throw new Error('patch_failed:'+res.status);
            item.written=true;
          }
        } else {
          const res = await sb('/rest/v1/articles', { method:'POST', headers:{Prefer:'return=representation'}, body: JSON.stringify(Object.assign({}, candidate, { created_at: new Date().toISOString(), updated_at: new Date().toISOString() })) });
          if (!res.ok) throw new Error('insert_failed:'+res.status+':'+JSON.stringify(res.data));
          item.written=true; item.inserted_id = Array.isArray(res.data)&&res.data[0]?res.data[0].id:null;
        }
      } catch (e) { item.error = e.message; item.action='invalid'; report.summary.invalid++; }
    }
    report.items.push(item);
  }

  const out = path.join(backupDir,'migration-report.json');
  fs.writeFileSync(out, JSON.stringify(report,null,2));
  console.log(JSON.stringify({ mode:report.mode, source:report.source_count, create:report.summary.create, update:report.summary.update, skip:report.summary.skip, invalid:report.summary.invalid, duplicate:report.summary.duplicate, report:path.relative(ROOT,out), backup:report.backup }, null, 2));
  if (DRY) console.log('DRY RUN: zero database writes performed.');
}

main().catch(e=>{ console.error(e); process.exit(1); });
