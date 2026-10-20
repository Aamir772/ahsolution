/* ==========================================================================
   qa-blog.cjs — AH Solution blog package QA (no network required)

   Verifies:
     source pack   17 unique videos, unique slugs/meta, all records = draft
     articles      files exist, 1000–1650 words, required sections, exact
                   video URL + embed id preserved, TOC marker, one H1
     metadata      titles/descriptions/categories/tags/keywords/excerpts
     images        SVG trio + image-prompts file per article; webp status
     links         every relative internal link resolves to a real file;
                   article cross-links point at real slugs
     public pages  builds article/<slug>/ + injects the 17 cards into
                   blog.html + the sitemap from the manifest; checks
                   indexable (no noindex), canonical set, one H1, valid
                   JSON-LD (BlogPosting + VideoObject, real uploadDate only),
                   TOC anchors resolve, og:image exists, back-links to blog
     site safety   sitemap lists all 17 article URLs, robots.txt intact,
                   no blog-preview/ folder, Blog lists 17 manifest cards
                   once each, cms.js dedupes by slug, covers every category,
                   import dry-run OK
     browser       spawns a local static server + headless Chromium
                   (playwright-core from the shared cache, external
                   embeds/fonts blocked): console errors, horizontal
                   overflow, broken images and oversized H1 on the
                   public regression pages + blog.html + all 17 published
                   articles at desktop and mobile widths

   Run: npm run qa:blog     (auto rebuilds images/manifest/public pages first)
   ========================================================================== */
'use strict';

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const md = require('../scripts/blog-md.js');

const ROOT = path.join(__dirname, '..');
const results = { pass: 0, fail: 0, lines: [] };

function ok(name, cond, detail) {
  if (cond) { results.pass++; results.lines.push('  \u2713 ' + name); }
  else { results.fail++; results.lines.push('  \u2717 ' + name + (detail ? ' — ' + detail : '')); }
}

function fileExists(rel) { return fs.existsSync(path.join(ROOT, rel)); }

/* ------------------------------------------------------------------ build */
console.log('BLOG QA\n');
console.log('rebuilding images + manifest + public pages ...');
try {
  execSync('node scripts/blog-build-images.js', { cwd: ROOT, stdio: 'pipe' });
  execSync('node scripts/blog-manifest-sync.js', { cwd: ROOT, stdio: 'pipe' });
  execSync('node scripts/blog-raster.js', { cwd: ROOT, stdio: 'pipe' });
  execSync('node scripts/blog-build.js', { cwd: ROOT, stdio: 'pipe' });
  results.pass++; results.lines.push('  \u2713 build pipeline (images + manifest-sync + raster + blog-build)');
} catch (e) {
  results.fail++;
  results.lines.push('  \u2717 build pipeline — ' + String(e.stdout || e.message).slice(0, 400));
}

/* ------------------------------------------------------- source + manifest */
const rows = md.loadManifest();
ok('manifest has exactly 17 records', rows.length === 17, 'got ' + rows.length);

const uniq = (arr) => new Set(arr).size === arr.length;
ok('unique article numbers', uniq(rows.map((r) => r.article_number)));
ok('unique slugs', uniq(rows.map((r) => r.slug)));
ok('unique video ids (17 source videos, no duplicates)', uniq(rows.map((r) => r.video_id)));
ok('unique suggested URLs', uniq(rows.map((r) => r.suggested_url)));
ok('unique meta titles', uniq(rows.map((r) => r.meta_title)));
ok('unique meta descriptions', uniq(rows.map((r) => r.meta_description)));
ok('unique H1/article titles', uniq(rows.map((r) => r.article_title)));

/* Publication contract (2026-10-20, operator-approved): all 17 records are
   published with real canonicals and completed editorial verification. The
   DRAFT protections remain checked below via the isDraft branch — if any
   record is ever reverted to draft, QA re-asserts its noindex guards. */
ok('every record is publish_status=published',
  rows.every((r) => r.publish_status === 'published'), rows.filter((r) => r.publish_status !== 'published').map((r) => r.slug).join(','));
ok('every record status=published',
  rows.every((r) => r.status === 'published'));
ok('editorial verification completed on all',
  rows.every((r) => r.editorial_verification_status === 'completed'));
ok('canonical_url set to the real route on all (no SET_ONLY_AFTER_PUBLISHING)',
  rows.every((r) => r.canonical_url === r.suggested_url));
ok('schema_type BlogPosting on all',
  rows.every((r) => r.schema_type === 'BlogPosting'));

/* ------------------------------------------------------------- article md */
const requiredSections = [
  '## Troubleshooting aur limitations',
  '## Safety aur privacy',
  '## Frequently asked questions',
  '## Final recommendations',
  '## Watch the original AH Solution video',
  '## Image package'
];

rows.forEach((r) => {
  const tag = String(r.article_number).padStart(2, '0') + ' ' + r.slug;
  const file = 'blog/articles/' + tag.split(' ')[0] + '-' + r.slug + '.md';
  if (!fileExists(file)) { ok(tag + ' file exists', false, file); return; }
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const body = text.split(/\n## Image package\b/)[0];
  const words = md.articleWordCount(text);

  ok(tag + ' words 1000–1650 (got ' + words + ')', words >= 1000 && words <= 1650);
  ok(tag + ' TOC marker present', text.includes('<!--TOC-->'));
  ok(tag + ' single H1 = manifest title', (text.match(/^# /gm) || []).length === 1 && text.startsWith('# ' + r.article_title));
  ok(tag + ' draft banner', /Draft for review/.test(text));
  ok(tag + ' original video URL preserved', text.includes(r.source_video_url));
  ok(tag + ' embed id correct', text.includes('youtube-nocookie.com/embed/' + r.video_id) &&
    !new RegExp('youtube-nocookie\\.com/embed/(?!' + r.video_id.replace(/[^A-Za-z0-9_-]/g, '') + ')').test(text));
  ok(tag + ' required sections', requiredSections.every((s) => text.includes(s)),
    requiredSections.filter((s) => !text.includes(s)).join('; '));
  ok(tag + ' FAQ has 4+ questions', ((text.match(/^### /gm) || []).length) >= 4);
  ok(tag + ' editorial note', text.includes('**Editorial note:**'));
  ok(tag + ' thumbnail ref present', text.includes('i.ytimg.com/vi/' + r.video_id + '/'));

  // metadata completeness
  ok(tag + ' meta fields', !!(r.meta_title && r.meta_description && r.category &&
    (r.tags || []).length && r.primary_keyword && (r.secondary_keywords || []).length));
  ok(tag + ' meta_description <= 300 chars (got ' + (r.meta_description || '').length + ')',
    (r.meta_description || '').length > 60 && (r.meta_description || '').length <= 300);
  ok(tag + ' excerpt not truncated mid-sentence', /[.!?:)”…]$/.test((r.excerpt || '').trim()) && r.excerpt.length > 80);
  ok(tag + ' images on disk', ['cover', 'thumbnail', 'explainer'].every((k) => fileExists('blog/assets/' + r.slug + '-' + k + '.svg')));
  ok(tag + ' image-prompts file', fileExists(r.image_prompts_file));
  ok(tag + ' image_status recorded', r.image_status === 'svg_generated_webp_pending', r.image_status);
});

/* ------------------------------------------------------- internal links ---- */
const knownRoots = ['index.html', 'blog.html', 'article.html', 'vlogs.html', 'tutorials.html',
  'about.html', 'contact.html', 'privacy.html', 'terms.html', '404.html',
  'guides/live-wallpaper-on-pc.html', 'guides/choose-android-apps-safely.html', 'guides/budget-smartwatch-checklist.html'];
const slugSet = new Set(rows.map((r) => r.slug));
const brokenLinks = [];
rows.forEach((r) => {
  const file = path.join(ROOT, 'blog/articles', r.article_file.replace('blog/articles/', ''));
  const text = fs.readFileSync(file, 'utf8');
  const body = text.split(/\n## Image package\b/)[0];
  const links = body.match(/\]\(([^)\s]+)\)/g) || [];
  links.forEach((l) => {
    const href = l.slice(2, -1);
    if (/^https?:\/\//.test(href) || href.startsWith('mailto:')) return;
    if (href.startsWith('#')) return;
    const clean = href.split('#')[0].split('?')[0];
    if (href.startsWith('article.html?slug=')) {
      const s = href.split('slug=')[1];
      if (!slugSet.has(s)) brokenLinks.push(r.slug + ' -> ' + href + ' (unknown slug)');
      return;
    }
    if (href.startsWith('/')) {
      if (!fileExists(href.slice(1))) brokenLinks.push(r.slug + ' -> ' + href);
      return;
    }
    if (!fileExists(clean)) brokenLinks.push(r.slug + ' -> ' + href);
    else if (!knownRoots.includes(clean)) brokenLinks.push(r.slug + ' -> ' + href + ' (not a known page)');
  });
});
ok('all internal links in articles resolve', brokenLinks.length === 0, brokenLinks.slice(0, 6).join(' | '));

/* ------------------------------------------------ public article pages --- */
const unesc = (s) => String(s == null ? '' : s)
  .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const articleFile = (h) => (h.endsWith('/') ? h + 'index.html' : h);
const jsonldIssues = [], anchorIssues = [], linkIssues = [], metaIssues = [], designIssues = [], seenTitles = new Map();
rows.forEach((r) => {
  const p = path.join(ROOT, 'article', r.slug, 'index.html');
  const tag = 'article ' + String(r.article_number).padStart(2, '0');
  if (!fs.existsSync(p)) { ok(tag + ' page exists', false, p); return; }
  const html = fs.readFileSync(p, 'utf8');
  const canonical = 'https://ahsolution.live/article/' + r.slug + '/';

  /* Draft-for-review contract: publish_status flows through the build.
     Draft records are PROTECTED (noindex + no canonical/og:url); approved
     records are indexable with the manifest canonical. */
  const isDraft = r.publish_status === 'draft' || !r.canonical_url || r.canonical_url === 'SET_ONLY_AFTER_PUBLISHING';
  if (isDraft) {
    if (!/name="robots" content="noindex, nofollow"/.test(html)) metaIssues.push(r.slug + ': draft page missing robots noindex');
    if (/rel="canonical"/.test(html)) metaIssues.push(r.slug + ': draft page must not carry a canonical');
    if (/og:url/.test(html)) metaIssues.push(r.slug + ': draft page must not carry og:url');
    if (!/draft-ribbon/.test(html)) metaIssues.push(r.slug + ': draft banner missing');
  } else {
    if (/name="robots"[^>]*noindex/.test(html)) metaIssues.push(r.slug + ': noindex on a published page');
    if (!html.includes('<link rel="canonical" href="' + canonical + '">')) metaIssues.push(r.slug + ': canonical wrong/missing');
    if (!html.includes('<meta property="og:url" content="' + canonical + '">')) metaIssues.push(r.slug + ': og:url wrong');
    if (/draft-ribbon/.test(html)) metaIssues.push(r.slug + ': draft ribbon on a published page');
  }
  if ((html.match(/<h1/g) || []).length !== 1) metaIssues.push(r.slug + ': h1 count != 1');
  if (/DRAFT/.test(html)) metaIssues.push(r.slug + ': DRAFT badge on a published page');
  const mdesc = unesc((html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '');
  if (mdesc !== r.meta_description) metaIssues.push(r.slug + ': meta description mismatch');
  if (!html.includes('href="/blog.html"')) metaIssues.push(r.slug + ': no back-link to /blog.html');

  const t = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
  if (seenTitles.has(t)) metaIssues.push('duplicate title: ' + t);
  seenTitles.set(t, r.slug);

  const og = (html.match(/<meta property="og:image" content="([^"]+)"/) || [])[1] || '';
  const ogPath = og.replace('https://ahsolution.live', '');
  if (!ogPath || !fileExists(ogPath.slice(1))) metaIssues.push(r.slug + ': og:image missing ' + og);
  if (!/\.png$/.test(og)) designIssues.push(r.slug + ': og:image is not a raster PNG (' + og + ')');

  /* editorial reading experience (assets/css/editorial.css) */
  if (!html.includes('<html lang="en-IN">')) designIssues.push(r.slug + ': html lang != en-IN');
  if (!html.includes('<body class="theme-editorial article-page">')) designIssues.push(r.slug + ': editorial body class missing');
  if (!html.includes('/assets/css/editorial.css')) designIssues.push(r.slug + ': editorial.css not linked');
  if (!html.includes('class="reading-progress"')) designIssues.push(r.slug + ': reading progress bar missing');
  if (!html.includes('data-article-content')) designIssues.push(r.slug + ': article content marker missing');
  if (!html.includes('class="video-block"')) designIssues.push(r.slug + ': framed original-video component missing');
  if (!html.includes('<h1 class="article-title">')) designIssues.push(r.slug + ': article title class missing');
  if (!/href="\/blog\.html\?category=[a-z]+"/.test(html)) designIssues.push(r.slug + ': no category breadcrumb link');
  if (!html.includes('class="article-aside"')) designIssues.push(r.slug + ': article sidebar missing');

  /* relative links written in the draft are prefixed with ../../ at build time
     (article pages live at /article/<slug>/) — they must land on real files */
  const rels = (html.match(/href="(\.\.\/[^"]*)"/g) || []).map((x) => x.slice(6, -1));
  rels.forEach((h) => {
    const clean = h.split('#')[0].split('?')[0];
    if (!clean) return;
    if (!fs.existsSync(path.join(ROOT, 'article', r.slug, clean))) linkIssues.push(r.slug + ' -> ' + h + ' (relative link misses)');
  });

  const ldMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!ldMatch) jsonldIssues.push(r.slug + ': no JSON-LD');
  else {
    try {
      const ld = JSON.parse(ldMatch[1]);
      const graph = ld['@graph'] || [ld];
      const post = graph.find((x) => x['@type'] === 'BlogPosting');
      const vid = graph.find((x) => x['@type'] === 'VideoObject');
      if (!post) jsonldIssues.push(r.slug + ': no BlogPosting');
      else {
        if (post.headline !== r.article_title) jsonldIssues.push(r.slug + ': headline mismatch');
        if (post.datePublished) jsonldIssues.push(r.slug + ': invented BlogPosting publish date');
      }
      if (!vid) jsonldIssues.push(r.slug + ': no VideoObject');
      else {
        if (!String(vid.embedUrl).includes(r.video_id)) jsonldIssues.push(r.slug + ': VideoObject id mismatch');
        if (vid.uploadDate && vid.uploadDate !== r.video_publish_date) jsonldIssues.push(r.slug + ': uploadDate not the real video date');
      }
    } catch (e) { jsonldIssues.push(r.slug + ': invalid JSON — ' + e.message); }
  }

  const embeds = html.match(/<iframe[^>]+youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]+/g) || [];
  if (embeds.length !== 1 || !embeds[0].includes(r.video_id)) metaIssues.push(r.slug + ': embed count/id wrong');

  const tocHrefs = (html.match(/href="#([^"]+)"/g) || []).map((x) => x.slice(7, -1));
  tocHrefs.forEach((a) => {
    if (a && html.indexOf('id="' + a + '"') === -1) anchorIssues.push(r.slug + ' -> #' + a);
  });

  const hrefs = (html.match(/href="(\/[^"]*)"/g) || []).map((x) => x.slice(6, -1));
  hrefs.forEach((h) => {
    const clean = h.split('#')[0].split('?')[0];
    if (!clean) return;
    if (/\.netlify\//.test(clean)) return;
    if (!fileExists(articleFile(clean.slice(1)))) linkIssues.push(r.slug + ' -> ' + h);
  });
});
ok('articles: draft-for-review protection (noindex, no canonical on drafts) + one H1 + no DRAFT word + real meta + unique titles + og:image + blog back-link',
  metaIssues.length === 0, metaIssues.slice(0, 6).join(' | '));
ok('articles: JSON-LD valid (BlogPosting + VideoObject, only real video dates)',
  jsonldIssues.length === 0, jsonldIssues.slice(0, 6).join(' | '));
ok('articles: TOC anchors resolve', anchorIssues.length === 0, anchorIssues.slice(0, 6).join(' | '));
ok('articles: internal links resolve', linkIssues.length === 0, linkIssues.slice(0, 6).join(' | '));
ok('articles: editorial theme + raster og:image + framed video + reading progress',
  designIssues.length === 0, designIssues.slice(0, 8).join(' | '));

/* --------------- Blog listing: the single public Blog section -------------- */
/* blog.html is now the only Blog listing: 17 manifest cards (generated by
   scripts/blog-build.js) followed by the 3 original hand-written guides. */
const blogHtml = fs.readFileSync(path.join(ROOT, 'blog.html'), 'utf8');
const blogSlugs = [...blogHtml.matchAll(/data-slug="([^"]+)"/g)].map((x) => x[1]);
const manifestSlugs = rows.map((r) => r.slug);
ok('blog.html is indexable (no noindex) with canonical /blog.html',
  !/name="robots"[^>]*noindex/.test(blogHtml) &&
  blogHtml.includes('<link rel="canonical" href="https://ahsolution.live/blog.html">'));
ok('blog.html lists every manifest article exactly once',
  blogSlugs.length === 17 && manifestSlugs.every((s) => blogSlugs.filter((x) => x === s).length === 1),
  'total ' + blogSlugs.length + ', unique ' + new Set(blogSlugs).size);
ok('every blog card links to its /article/<slug>/ page',
  rows.every((r) => blogHtml.includes('href="/article/' + r.slug + '/"')));
ok('blog.html has search + category chips + sort + result counter + empty state',
  /data-blog-search/.test(blogHtml) && (blogHtml.match(/data-filter="/g) || []).length >= 4 &&
  /data-blog-sort/.test(blogHtml) && /data-blog-count/.test(blogHtml) && /data-empty-state/.test(blogHtml));
ok('blog.html: no draft badges, no .webp, no blog-preview links',
  !/card-draft|>Draft</.test(blogHtml) && !/\.webp/.test(blogHtml) && !/blog-preview/.test(blogHtml));
ok('blog.html Blog nav is active + points at blog.html',
  /href="(?:\.\/|\/)?blog\.html" class="active" aria-current="page">Blog/.test(blogHtml));
ok('blog cards carry title/order/time attrs, Read Article + real SVG thumbnail',
  /data-title="/.test(blogHtml) && /data-order="/.test(blogHtml) && /data-min="/.test(blogHtml) &&
  />Read Article</.test(blogHtml) && /blog\/assets\/[^"]+-thumbnail\.svg/.test(blogHtml));
ok('blog.html uses the editorial design (dark theme + editorial.css + hero search + 8 chips + editorial grid + feature/compact cards)',
  blogHtml.includes('<body class="theme-editorial">') &&
  blogHtml.includes('<html lang="en-IN">') &&
  blogHtml.includes('assets/css/editorial.css') &&
  /class="ed-hero"/.test(blogHtml) && /class="ed-listing"/.test(blogHtml) &&
  /data-blog-search/.test(blogHtml) &&
  (blogHtml.match(/data-filter="/g) || []).length === 8 &&
  blogHtml.includes('class="editorial-grid"') &&
  blogHtml.includes('is-feature') && blogHtml.includes('is-compact'),
  'chips: ' + (blogHtml.match(/data-filter="/g) || []).length);
const staticCards = blogHtml.match(/<a[^>]*data-static="1"[^>]*>/g) || [];
ok('blog.html: 3 static how-to cards use the new chip keys and the grid has a feature card',
  staticCards.length === 3 &&
  staticCards.some((t) => t.indexOf('data-category="windows"') !== -1) &&
  staticCards.some((t) => t.indexOf('data-category="android"') !== -1) &&
  staticCards.some((t) => t.indexOf('data-category="gadgets"') !== -1) &&
  /class="content-card tilt is-feature"/.test(blogHtml) &&
  /class="content-card tilt is-compact"/.test(blogHtml),
  'static cards: ' + staticCards.length);

/* ------------------------------------------------------------ site safety */
const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
const sitemapArticleLocs = sitemap.match(/\/article\/[^<]+\/<\/loc>/g) || [];
const approvedRows = rows.filter((r) => r.publish_status === 'published' && r.canonical_url && r.canonical_url !== 'SET_ONLY_AFTER_PUBLISHING');
const draftRows = rows.filter((r) => !approvedRows.includes(r));
ok('sitemap.xml lists every APPROVED article and NO draft article URL',
  approvedRows.every((r) => sitemap.includes('<loc>https://ahsolution.live/article/' + r.slug + '/</loc>')) &&
  draftRows.every((r) => !sitemap.includes('<loc>https://ahsolution.live/article/' + r.slug + '/</loc>')) &&
  sitemapArticleLocs.length === approvedRows.length,
  'approved: ' + approvedRows.length + ', drafts (must be 0 in sitemap): ' + (sitemapArticleLocs.length - approvedRows.length));
const robots = fs.readFileSync(path.join(ROOT, 'robots.txt'), 'utf8');
ok('robots.txt allows crawling + lists sitemap', /Allow: \//.test(robots) && /Sitemap:/.test(robots));
ok('no blog-preview/ folder (preview experience removed)', !fs.existsSync(path.join(ROOT, 'blog-preview')));
try {
  const tracked = execSync('git check-ignore -q blog-preview && echo IGNORED || echo TRACKED',
    { cwd: ROOT, shell: 'cmd.exe' }).toString().trim();
  ok('blog-preview/ no longer gitignored (must deploy public pages)', tracked === 'TRACKED', tracked);
} catch (e) { ok('blog-preview/ no longer gitignored', false, 'git check failed'); }

// the CMS route template + homepage must not embed draft slugs (blog.html does, by design)
const articleTpl = fs.readFileSync(path.join(ROOT, 'article.html'), 'utf8');
const idxHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const leaked = rows.filter((r) => articleTpl.includes(r.slug) || idxHtml.includes(r.slug)).map((r) => r.slug);
ok('no manifest slugs embedded in the CMS template or homepage', leaked.length === 0, leaked.slice(0, 5).join(', '));

// cms.js health
try {
  execSync('node --check assets/js/cms.js', { cwd: ROOT, stdio: 'pipe' });
  ok('assets/js/cms.js parses', true);
} catch (e) { ok('assets/js/cms.js parses', false, e.message.slice(0, 120)); }
const cms = fs.readFileSync(path.join(ROOT, 'assets/js/cms.js'), 'utf8');
ok('cms.js filterKey mirrors the blog chip keys (android/windows/gadgets/photography/privacy/remote/about)',
  ['photography', 'privacy', 'remote', 'android', 'windows', 'gadgets', 'about']
    .every((k) => cms.indexOf("'" + k + "'") !== -1) &&
  /smartphone\|phone/.test(cms) && /streaming/.test(cms));
ok('cms.js emits BlogPosting + VideoObject',
  /BlogPosting/.test(cms) && /VideoObject/.test(cms));
ok('cms.js dedupes injected cards by data-slug (no duplicate articles)',
  /data-slug/.test(cms) && /\[data-slug\]/.test(cms) && /have\[/.test(cms));

// category coverage: every category maps to a real filter chip key
const CHIP_KEYS = ['android', 'windows', 'gadgets', 'photography', 'privacy', 'remote', 'about'];
const cats = [...new Set(rows.map((r) => md.filterKey(r.category)))].sort();
ok('all categories map to filter chips (keys: ' + cats.filter(Boolean).join(', ') + ')',
  rows.every((r) => CHIP_KEYS.includes(md.filterKey(r.category))) &&
  cats.filter(Boolean).length === CHIP_KEYS.length,
  JSON.stringify(cats));

// import dry-run
try {
  const out = execSync('node scripts/blog-import-drafts.cjs', { cwd: ROOT, stdio: 'pipe' }).toString();
  ok('import dry-run runs + forces drafts', /DRY RUN/.test(out) && /status="draft"/.test(out));
} catch (e) { ok('import dry-run runs', false, String(e.stdout || e.message).slice(0, 200)); }

// manifest sync idempotent (no drift after last build)
try {
  const before = fs.readFileSync(path.join(ROOT, 'blog/blog-manifest.json'), 'utf8');
  execSync('node scripts/blog-manifest-sync.js', { cwd: ROOT, stdio: 'pipe' });
  const after = fs.readFileSync(path.join(ROOT, 'blog/blog-manifest.json'), 'utf8');
  ok('manifest stable after sync (no drift)', before === after);
} catch (e) { ok('manifest stable after sync', false); }

/* ------------------------------------------------------------ browser pass */
/* Headless Chromium over a throwaway local server. External requests
   (YouTube embed, Google Fonts, ytimg) are blocked so the pass is
   deterministic and offline; only local JS/CSS/asset errors count. */
const qaLib = require('./qa-lib.cjs');

function collectPageErrors(page, base) {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (qaLib.isCmsProbeNoise(m)) return;
    const text = m.text() || '';
    const loc = (m.location && m.location()) || {};
    const url = loc.url || '';
    // this pass deliberately blocks every external request (YouTube, fonts,
    // Unsplash …), so only failures of our own assets are real errors
    if (/Failed to load resource/.test(text) && (!url || url.indexOf(base) !== 0)) return;
    errors.push('console: ' + text);
  });
  return errors;
}

async function waitForServer(base, child, tries) {
  for (let i = 0; i < (tries || 50); i++) {
    if (child && child.exitCode !== null) return false;
    try {
      const r = await fetch(base + '/index.html');
      if (r.ok) return true;
    } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

(async function browserQA() {
  let server = null;
  let browser = null;
  try {
    console.log('\nrunning browser pass (Chromium + local server) ...');
    const port = 8123;
    const base = 'http://127.0.0.1:' + port;
    server = spawn(process.execPath, ['scripts/serve.cjs', '--port', String(port)],
      { cwd: ROOT, stdio: 'ignore' });
    const up = await waitForServer(base, server);
    ok('local static server starts on :' + port, up);
    if (!up) throw new Error('server did not start');

    const launch = qaLib.launcher();
    browser = await launch();

    const targets = [
      { url: '/index.html', name: 'index.html', article: false, mobile: false },
      { url: '/blog.html', name: 'blog.html', article: false, mobile: true },
      { url: '/article.html?slug=' + rows[0].slug, name: 'article.html (CMS route)', article: false, mobile: false }
    ].concat(rows.map((r) => ({
      url: '/article/' + r.slug + '/',
      name: 'article ' + r.slug,
      article: true,
      mobile: true
    })));

    const browserIssues = [];
    for (const t of targets) {
      const viewports = t.mobile
        ? [{ w: 1440, h: 900, tag: 'desktop' }, { w: 390, h: 844, tag: 'mobile' }]
        : [{ w: 1440, h: 900, tag: 'desktop' }];

      for (const vp of viewports) {
        const context = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
        const page = await context.newPage();
        const errors = collectPageErrors(page, base);
        await page.route('**/*', (route) => {
          const u = route.request().url();
          if (!u.startsWith(base) &&
              !u.startsWith('data:') && !u.startsWith('blob:')) return route.abort();
          return route.continue();
        });
        try {
          await page.goto(base + t.url, { waitUntil: 'load', timeout: 15000 });
          await qaLib.waitBooted(page);
          await qaLib.waitSettled(page);
          await page.waitForTimeout(250);

          const tag = t.name + ' [' + vp.tag + ']';
          if (errors.length) browserIssues.push(tag + ': ' + errors.slice(0, 2).join(' | '));

          const audit = await page.evaluate(() => {
            const de = document.documentElement;
            const overflowX = de.scrollWidth - de.clientWidth;
            const broken = Array.from(document.images)
              .filter((img) => {
                const s = img.getAttribute('src') || '';
                return img.complete && img.naturalWidth === 0 && s && !/^(https?:)?\/\//.test(s);
              })
              .map((img) => img.getAttribute('src'));
            const h1 = document.querySelector('h1');
            let h1Fits = true;
            if (h1) {
              const r = h1.getBoundingClientRect();
              h1Fits = r.left >= -1 && r.right <= window.innerWidth + 1;
            }
            return { overflowX, broken, h1Fits, h1Count: document.querySelectorAll('h1').length };
          });

          if (audit.overflowX > 1) browserIssues.push(tag + ': horizontal overflow ' + audit.overflowX + 'px');
          if (audit.broken.length) browserIssues.push(tag + ': broken images ' + audit.broken.slice(0, 3).join(', '));
          if (!audit.h1Fits) browserIssues.push(tag + ': h1 wider than viewport');
          if (t.article && audit.h1Count !== 1) browserIssues.push(tag + ': h1 count ' + audit.h1Count);
        } catch (e) {
          browserIssues.push(t.name + ' [' + vp.tag + ']: load failed — ' + e.message);
        }
        await context.close();
      }
    }

    ok('browser: ' + targets.length + ' pages (desktop + mobile) — no console errors, no horizontal overflow, no broken images, H1 fits',
      browserIssues.length === 0, browserIssues.slice(0, 6).join(' | '));

    /* Blog-listing interaction pass — proves the acceptance criteria at the UI
       layer on the real public page: search, category filter, sort, result
       counter, empty state + reset, card → article navigation, ?category deep
       link. Plus review screenshots. Expected counts are derived from the
       actual blog.html so the test tracks edits to the listing. */
    const LIST = '/blog.html';
    const countCards = (html, query, cat) => {
      const tags = html.match(/<a[^>]*data-blog-card[^>]*>/g) || [];
      const q = (query || '').toLowerCase();
      return tags.filter((tag) => {
        const search = ((tag.match(/data-search="([^"]*)"/) || [])[1] || '').toLowerCase();
        const c = ((tag.match(/data-category="([^"]*)"/) || [])[1] || '').toLowerCase();
        return (!q || search.includes(q)) && (cat === 'all' || c === cat);
      }).length;
    };
    const TOTAL = (blogHtml.match(/data-blog-card/g) || []).length;
    const EXP = {
      total: TOTAL,
      smartwatch: countCards(blogHtml, 'smartwatch', 'all'),
      windows: countCards(blogHtml, '', 'windows')
    };
    const shots = path.join(qaLib.OUT, 'blog-listing');
    fs.mkdirSync(shots, { recursive: true });
    const li = { search: false, chip: false, sort: false, reset: false, nav: false, deep: false, design: false, shotDesktop: false, shotMobile: false, issues: [] };
    const blockExternal = (route) => {
      const u = route.request().url();
      if (!u.startsWith(base) && !u.startsWith('data:') && !u.startsWith('blob:')) return route.abort();
      return route.continue();
    };
    {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      const errors = collectPageErrors(page, base);
      await page.route('**/*', blockExternal);
      try {
        await page.goto(base + LIST, { waitUntil: 'load', timeout: 15000 });
        await qaLib.waitBooted(page);
        await qaLib.waitSettled(page);

        const initial = (await page.textContent('[data-blog-count]')).trim();
        if (initial !== 'Showing ' + EXP.total + ' of ' + EXP.total + ' articles') li.issues.push('initial counter: ' + initial);
        li.shotDesktop = await page.screenshot({ path: path.join(shots, 'blog-listing-desktop.png'), fullPage: true })
          .then(() => true).catch((e) => { li.issues.push('desktop shot: ' + e.message); return false; });

        /* editorial layout: light reading surface + a feature card that is
           visibly larger than the regular cards next to it */
        const look = await page.evaluate(() => {
          const rgb = (getComputedStyle(document.body).backgroundColor.match(/\d+/g) || []).map(Number);
          const lum = rgb.length === 3 ? rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114 : 0;
          const w = (sel) => { const e = document.querySelector(sel); return e ? e.getBoundingClientRect().width : 0; };
          return {
            lum: lum,
            feature: w('.editorial-grid > .is-feature:not(.hidden)'),
            compact: w('.editorial-grid > .is-compact:not(.hidden)'),
            regular: w('.editorial-grid > [data-blog-card]:not(.hidden):not([class*="is-"])'),
            chips: document.querySelectorAll('.ed-cats [data-filter]').length
          };
        });
        li.design = look.lum > 200 && look.feature > look.regular * 1.4 &&
          look.compact > 0 && look.regular > 0 && look.chips === 8;
        if (!li.design) li.issues.push('design: ' + JSON.stringify(look));

        const countIs = (n) => page.waitForFunction(
          (p) => document.querySelector('[data-blog-count]').textContent.indexOf('Showing ' + p + ' of ') === 0,
          n, { timeout: 3000 }).catch(() => {});

        // search
        await page.fill('[data-blog-search]', 'smartwatch');
        await countIs(EXP.smartwatch);
        const afterSearch = (await page.textContent('[data-blog-count]')).trim();
        li.search = afterSearch.indexOf('Showing ' + EXP.smartwatch + ' of ' + EXP.total) === 0;
        if (!li.search) li.issues.push('search "smartwatch": ' + afterSearch);
        await page.fill('[data-blog-search]', '');
        await countIs(EXP.total);

        // category chip
        await page.click('[data-filter="windows"]');
        await countIs(EXP.windows);
        const afterChip = (await page.textContent('[data-blog-count]')).trim();
        li.chip = afterChip.indexOf('Showing ' + EXP.windows + ' of ' + EXP.total) === 0;
        if (!li.chip) li.issues.push('windows chip: ' + afterChip);

        // sort (with all cards visible, so the order is meaningful)
        await page.click('[data-filter="all"]');
        await page.selectOption('[data-blog-sort]', 'title');
        await page.waitForTimeout(150);
        const titles = await page.$$eval('[data-blog-card] h3', (els) => els.map((e) => e.textContent.trim()));
        li.sort = titles.length === EXP.total && titles.every((t, i) => i === 0 || titles[i - 1].localeCompare(t) <= 0);
        if (!li.sort) li.issues.push('sort order not A–Z: ' + titles.slice(0, 3).join(' / '));
        await page.selectOption('[data-blog-sort]', 'editorial');

        // empty state + reset
        await page.fill('[data-blog-search]', 'zzzznotarealquery');
        await countIs(0);
        const emptyShown = await page.$eval('[data-empty-state]', (e) => !e.classList.contains('hidden'));
        await page.click('[data-filter-reset]');
        await countIs(EXP.total);
        const resetText = (await page.textContent('[data-blog-count]')).trim();
        li.reset = emptyShown && resetText.indexOf('Showing ' + EXP.total + ' of ' + EXP.total) === 0;
        if (!li.reset) li.issues.push('empty/reset: empty=' + emptyShown + ' after=' + resetText);

        // card click → article page (waitForURL avoids the old-document race)
        try {
          await Promise.all([
            page.waitForURL(/\/article\//, { timeout: 15000 }),
            page.$eval('[data-blog-card]', (a) => a.click())
          ]);
          await qaLib.waitBooted(page);
          li.nav = (await page.$$eval('h1', (e) => e.length)) === 1;
        } catch (e) { li.issues.push('card click → ' + page.url() + ' (' + e.message.split('\n')[0] + ')'); }

        // deep link ?category=windows
        await page.goto(base + LIST + '?category=windows', { waitUntil: 'load', timeout: 15000 });
        await qaLib.waitBooted(page);
        await countIs(EXP.windows);
        const deepText = (await page.textContent('[data-blog-count]')).trim();
        const deepActive = await page.$eval('[data-filter="windows"]', (c) => c.classList.contains('active'));
        li.deep = deepText.indexOf('Showing ' + EXP.windows + ' of ' + EXP.total) === 0 && deepActive;
        if (!li.deep) li.issues.push('deep link: ' + deepText + ' active=' + deepActive);

        if (errors.length) li.issues.push('console: ' + errors.slice(0, 2).join(' | '));
      } catch (e) {
        li.issues.push('listing pass: ' + e.message);
      }
      await context.close();

      const mctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const mpage = await mctx.newPage();
      await mpage.route('**/*', blockExternal);
      try {
        await mpage.goto(base + LIST, { waitUntil: 'load', timeout: 15000 });
        await qaLib.waitBooted(mpage);
        await qaLib.waitSettled(mpage);
        li.shotMobile = await mpage.screenshot({ path: path.join(shots, 'blog-listing-mobile.png'), fullPage: true })
          .then(() => true).catch((e) => { li.issues.push('mobile shot: ' + e.message); return false; });
      } catch (e) { li.issues.push('mobile shot: ' + e.message); }
      await mctx.close();
    }

    const liWhy = li.issues.join(' | ');
    ok('listing: search narrows to the matching articles and clears', li.search, liWhy);
    ok('listing: category chip filters the listing (' + EXP.pc + ' of ' + EXP.total + ')', li.chip, liWhy);
    ok('listing: sort reorders cards (title A–Z)', li.sort, liWhy);
    ok('listing: empty state shows then resets to all ' + EXP.total, li.reset, liWhy);
    ok('listing: clicking a card opens its article page', li.nav, liWhy);
    ok('listing: ?category=pc deep link filters + activates the chip', li.deep, liWhy);
    ok('listing: desktop + mobile screenshots written (' + shots + ')', li.shotDesktop && li.shotMobile, liWhy);
  } catch (e) {
    ok('browser pass ran', false, e.message.slice(0, 200));
  } finally {
    try { if (browser) await browser.close(); } catch (e) {}
    try { if (server) server.kill(); } catch (e) {}
  }
  report();
})();

/* ---------------------------------------------------------------- report */
function report() {
  console.log('');
  results.lines.forEach((l) => console.log(l));
  console.log('\nBLOG QA: ' + results.pass + ' passed, ' + results.fail + ' failed');
  process.exit(results.fail ? 1 : 0);
}
