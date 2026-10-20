/* ==========================================================================
   scripts/blog-raster.js — rasterise editorial cover SVGs to 1200x630 PNG

   Social crawlers (WhatsApp, X, Facebook, LinkedIn, Slack…) do not render
   SVG, so every article's og:image has to be a raster file. This script renders
   blog/assets/<slug>-cover.svg through headless Chromium into
   blog/assets/<slug>-cover.png, with the same Manrope typeface the site uses.

   Incremental: a PNG is only re-rendered when its SVG is newer.
   Failure is non-fatal — scripts/blog-build.js falls back to the SVG og:image.
   Run: node scripts/blog-raster.js
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { loadManifest } = require('./blog-md.js');
const { launcher } = require('./qa-lib.cjs');

const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(ROOT, 'blog', 'assets');
const W = 1200, H = 630;

function newer(a, b) {
  try { return fs.statSync(a).mtimeMs > fs.statSync(b).mtimeMs; } catch (e) { return true; }
}

(async function raster() {
  const rows = loadManifest();
  const todo = rows.map((r) => ({
    slug: r.slug,
    svg: path.join(ASSETS, r.slug + '-cover.svg'),
    png: path.join(ASSETS, r.slug + '-cover.png')
  })).filter((t) => {
    if (!fs.existsSync(t.svg)) return false;
    return !fs.existsSync(t.png) || newer(t.svg, t.png);
  });

  if (!todo.length) { console.log('blog-raster: all covers already rasterised'); return; }

  const browser = await launcher()();
  let written = 0;
  try {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    /* fonts may be unavailable offline — the PNG still renders with system-ui */
    await page.route('**/*', (route) => {
      const u = route.request().url();
      if (u.startsWith('file:') || u.startsWith('data:')) return route.continue();
      if (/fonts\.(googleapis|gstatic)\.com/.test(u)) return route.continue();
      return route.abort();
    });

    for (const t of todo) {
      const svg = fs.readFileSync(t.svg, 'utf8');
      const html = '<!doctype html><html lang="en-IN"><head><meta charset="utf-8">' +
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;800&display=swap">' +
        '<style>html,body{margin:0;padding:0;background:#0B0B10;overflow:hidden}svg{display:block}</style>' +
        '</head><body>' + svg + '</body></html>';
      await page.setContent(html, { waitUntil: 'load', timeout: 15000 });
      await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve())).catch(() => {});
      await page.screenshot({ path: t.png, clip: { x: 0, y: 0, width: W, height: H } });
      written++;
      console.log('  \u2713 ' + t.slug + '-cover.png');
    }
    await ctx.close();
  } finally {
    await browser.close().catch(() => {});
  }
  console.log('blog-raster: wrote ' + written + ' PNG covers (' + W + '\u00d7' + H + ')');
})().catch((e) => {
  console.warn('blog-raster: skipped — ' + e.message.split('\n')[0]);
  console.warn('blog-raster: og:image falls back to the SVG cover until this runs.');
  process.exit(0);
});
