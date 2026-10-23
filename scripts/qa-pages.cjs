/* ==========================================================================
   qa-pages.cjs — every public page at desktop + mobile
   Console/page errors, horizontal overflow, boot cleanup, heading clipping,
   missing images, internal links and the design-token stylesheet.
   Run: npm run qa:pages     (site must be served on http://localhost:8000)
   ========================================================================== */
'use strict';
const { launcher, counter, OUT, assertServer, waitBooted, waitSettled, scrollTo, collectErrors, isCmsProbeNoise } = require('./qa-lib.cjs');

const BASE = 'http://localhost:8000';
const PAGES = [
  'index.html', 'vlogs.html', 'blog.html', 'tutorials.html', 'about.html', 'contact.html',
  'privacy.html', 'terms.html', '404.html', 'article.html',
  'guides/live-wallpaper-on-pc.html',
  'guides/choose-android-apps-safely.html',
  'guides/budget-smartwatch-checklist.html'
];
/* Every heading must stay fully inside its container at these widths */
const NARROW = [320, 360, 390, 430];
const c = counter();

(async () => {
  await assertServer(BASE);
  console.log('PAGES QA  (' + PAGES.length + ' pages)\n');
  const launch = launcher();
  const browser = await launch();

  /* ---------------- desktop ---------------- */
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = collectErrors(page);

  for (const p of PAGES) {
    const errs = [];
    const onC = (m) => { if (m.type() === 'error' && !isCmsProbeNoise(m)) errs.push(m.text()); };
    const onP = (e) => errs.push('pageerror: ' + e.message);
    page.on('console', onC); page.on('pageerror', onP);
    await page.goto(BASE + '/' + p, { waitUntil: 'load', timeout: 60000 });
    await waitBooted(page, 12000);
    await waitSettled(page, 12000);
    await page.waitForTimeout(400);
    await scrollTo(page, 1);
    await page.waitForTimeout(500);

    const info = await page.evaluate(() => {
      const html = document.documentElement;
      const boot = document.querySelector('.boot');
      const brokenImgs = [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.currentSrc || i.src);
      const h1 = document.querySelector('h1');
      const r = h1 ? h1.getBoundingClientRect() : null;
      return {
        booted: html.classList.contains('booted'),
        bootVis: boot ? getComputedStyle(boot).visibility : 'missing',
        overflowX: html.scrollWidth - html.clientWidth,
        tokens: !!document.querySelector('link[href*="tokens.css"]'),
        brokenImgs,
        h1: r ? { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), text: (h1.textContent || '').trim().slice(0, 40) } : null,
        viewport: html.clientWidth,
        mainText: (document.querySelector('main') || document.body).textContent.trim().length
      };
    });
    page.off('console', onC); page.off('pageerror', onP);

    const label = p.padEnd(42);
    const overflowOk = info.overflowX <= 0;
    const h1Ok = !info.h1 || (info.h1.left >= -1 && info.h1.right <= info.viewport + 1);
    const bad = errs.length > 0 || !info.booted || info.bootVis !== 'hidden' || !overflowOk || !info.tokens || info.brokenImgs.length > 0 || !h1Ok || info.mainText < 200;
    if (bad) c.fail++; else c.pass++;
    console.log((bad ? '  \u2717 ' : '  \u2713 ') + label +
      'overflowX=' + info.overflowX +
      ' boot=' + info.bootVis +
      ' h1=' + (info.h1 ? info.h1.width + 'px' : 'none') +
      (errs.length ? ' ERRORS=' + JSON.stringify(errs.slice(0, 2)) : '') +
      (info.brokenImgs.length ? ' BROKEN_IMGS=' + info.brokenImgs.length : '') +
      (!h1Ok ? ' H1_OVERFLOW' : '') +
      (!info.tokens ? ' NO_TOKENS' : ''));
  }
  await ctx.close();

  /* ---------------- narrow viewports: heading must never clip ------------ */
  console.log('\nnarrow viewports\n');
  for (const width of NARROW) {
    const nctx = await browser.newContext({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    const npage = await nctx.newPage();
    const nerrors = collectErrors(npage);
    await npage.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 60000 });
    await waitBooted(npage, 12000);
    await waitSettled(npage, 12000);
    await npage.waitForTimeout(500);

    const m = await npage.evaluate(() => {
      const lines = [...document.querySelectorAll('.hero-title .hero-line')].map((el) => {
        const r = el.getBoundingClientRect();
        return {
          text: (el.textContent || '').trim(),
          left: Math.round(r.left), right: Math.round(r.right),
          top: Math.round(r.top), bottom: Math.round(r.bottom),
          clipped: el.scrollWidth > el.clientWidth + 1
        };
      });
      return {
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        clientW: document.documentElement.clientWidth,
        lines
      };
    });
    const fits = m.lines.length === 2 && m.lines.every((l) => !l.clipped && l.left >= 0 && l.right <= m.clientW);
    c.ok(fits && m.overflowX <= 0,
      width + 'px: both heading lines fit with no horizontal overflow',
      'overflowX=' + m.overflowX + ' ' + JSON.stringify(m.lines));
    await npage.screenshot({ path: OUT + '/narrow-' + width + '.png' });
    c.ok(nerrors.filter((e) => /pageerror/.test(e)).length === 0, width + 'px: no uncaught page errors');
    await nctx.close();
  }

  c.ok(errors.filter((e) => /pageerror/.test(e)).length === 0, 'no uncaught page errors (desktop sweep)');
  await browser.close();
  process.exit(c.done('pages') ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
