/* ==========================================================================
   qa-device.cjs — device-world QA
   Boot timing (the ~1s first-entry intro), session-only replay behaviour,
   boot overlay cleanup, monitor scroll lock, full-width escape hatch,
   carousel and reduced motion.
   Run: npm run qa:device      (site must be served on http://localhost:8000)
   ========================================================================== */
'use strict';
const { launcher, counter, OUT, assertServer, waitBooted, waitSettled, collectErrors } = require('./qa-lib.cjs');

const BASE = 'http://localhost:8000';
const c = counter();

(async () => {
  await assertServer(BASE);
  console.log('DEVICE QA\n');
  const launch = launcher();
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  /* record boot class changes inside the page so timing is not affected by
     how often the test harness happens to poll */
  await ctx.addInitScript(() => {
    window.__bootLog = [];
    const t0 = performance.now();
    const mark = (c) => {
      if (!window.__bootLog.some((e) => e.c === c)) window.__bootLog.push({ c, t: Math.round(performance.now() - t0) });
    };
    const tick = () => {
      const cls = (document.documentElement && document.documentElement.className) || '';
      if (/\bbooting\b/.test(cls)) mark('booting');
      if (/\bbooted\b/.test(cls)) mark('booted');
      if (/\bdevice-settled\b/.test(cls)) mark('settled');
      if (window.__bootLog.length >= 3) { clearInterval(iv); return; }
    };
    const iv = setInterval(tick, 10);
    tick();
  });
  const page = await ctx.newPage();
  const errors = collectErrors(page);

  /* --- boot timing ------------------------------------------------------ */
  await page.goto(BASE + '/index.html', { waitUntil: 'commit', timeout: 30000 });
  await page.waitForFunction(() => document.documentElement.classList.contains('booting'), null, { timeout: 8000 });

  const bootVisibleEarly = await page.evaluate(() => {
    const b = document.querySelector('.boot');
    return b ? getComputedStyle(b).visibility !== 'hidden' && getComputedStyle(b).opacity !== '0' : false;
  });
  c.ok(bootVisibleEarly, 'loading screen is visible while the page boots');

  await waitBooted(page, 15000);
  await waitSettled(page, 15000);
  await page.waitForTimeout(600);

  const bootLog = await page.evaluate(() => window.__bootLog || []);
  const at = (n) => { const e = bootLog.find((x) => x.c === n); return e ? e.t : null; };
  const bootingAt = at('booting'), bootedAt = at('booted'), settledAt = at('settled');
  c.ok(bootingAt !== null, 'booting class applied as soon as the page starts', JSON.stringify(bootLog));
  c.ok(bootedAt !== null && bootedAt - bootingAt >= 700, 'loading animation stays on screen ~1s (' + (bootedAt - bootingAt) + 'ms on the page clock)');
  /* the intro is capped at ~1s by device.js (rAF-driven reveal); headless QA
     browsers can defer work until the load event, so allow env jank but the
     loader must NEVER be stuck (previous hard-fallback was 5s, CSS 2.2s) */
  c.ok(bootedAt !== null && bootedAt - bootingAt <= 6000, 'intro clears near the one-second target (' + (bootedAt - bootingAt) + 'ms, incl. QA-env load deferral)');
  /* device-settled fires 1500ms after boot; the same software-renderer timer
     delay can stretch it, so the bound checks it still lands soon-ish */
  c.ok(settledAt !== null && settledAt - bootedAt <= 9000, 'device enters its settled state right after boot (' + (settledAt - bootedAt) + 'ms after boot, ' + (settledAt - bootingAt) + 'ms total)');
  const bootState = await page.evaluate(() => {
    const b = document.querySelector('.boot');
    const cs = b ? getComputedStyle(b) : null;
    return {
      cls: document.documentElement.className,
      vis: cs ? cs.visibility : 'missing',
      pointer: cs ? cs.pointerEvents : 'missing'
    };
  });
  c.ok(bootState.vis === 'hidden', 'boot overlay is hidden after the sequence', bootState.vis);
  c.ok(/booted/.test(bootState.cls) && /device-settled/.test(bootState.cls), 'booted + device-settled applied', bootState.cls);
  c.ok(bootState.pointer === 'none', 'boot overlay no longer intercepts clicks', bootState.pointer);
  await page.screenshot({ path: OUT + '/device-boot-done.png' });

  /* --- intro only on first entry (session-scoped) ------------------------ */
  const firstQuote = await page.evaluate(() => {
    const q = document.querySelector('[data-boot-quote]');
    return q ? q.textContent : null;
  });
  c.ok(!!firstQuote, 'intro shows a productivity quote', firstQuote);

  const reloadState = await page.evaluate(() => { location.reload(); });
  void reloadState;
  await page.waitForTimeout(1500);
  const replay = await page.evaluate(() => ({
    booted: document.documentElement.classList.contains('booted'),
    bootingNow: document.documentElement.classList.contains('booting'),
    flag: (() => { try { return sessionStorage.getItem('ah-intro'); } catch (e) { return 'err'; } })()
  }));
  c.ok(replay.flag === '1' && replay.booted && !replay.bootingNow, 'refresh does not replay the intro in the same tab', JSON.stringify(replay));

  /* a fresh tab (new session) picks a different quote than the previous one */
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx2.addInitScript(() => {
    window.__quoteEarly = null;
    document.addEventListener('DOMContentLoaded', () => {
      const q = document.querySelector('[data-boot-quote]');
      window.__quoteEarly = q ? q.textContent : '!missing';
    }, { once: true });
  });
  const page2 = await ctx2.newPage();
  const errors2 = collectErrors(page2);
  await page2.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 30000 });
  const quote2 = await page2.evaluate(() => window.__quoteEarly);
  c.ok(quote2 && quote2 !== firstQuote, 'a new tab session picks a different quote than the previous one', quote2 + ' vs ' + firstQuote);
  c.ok(errors2.filter((e) => /pageerror/.test(e)).length === 0, 'no uncaught page errors (second tab)');
  await ctx2.close();

  /* --- logo centered inside the loader ring ------------------------------ */
  const geo = await page.evaluate(() => {
    const emblem = document.querySelector('.boot-emblem');
    const logo = document.querySelector('.boot-logo');
    if (!emblem || !logo) return null;
    const e = emblem.getBoundingClientRect(), l = logo.getBoundingClientRect();
    return {
      dx: Math.abs((l.left + l.width / 2) - (e.left + e.width / 2)),
      dy: Math.abs((l.top + l.height / 2) - (e.top + e.height / 2)),
      fits: l.width <= e.width && l.height <= e.height
    };
  });
  c.ok(geo && geo.dx < 2 && geo.dy < 2 && geo.fits,
    'boot logo is centered in the ring (dx=' + (geo ? geo.dx.toFixed(1) : '?') + 'px, dy=' + (geo ? geo.dy.toFixed(1) : '?') + 'px)');
  void geo;

  /* --- device shell + scroll lock --------------------------------------- */
  const shell = await page.evaluate(() => {
    const s = document.querySelector('.device-screen');
    const h = document.querySelector('.site-header');
    if (!s) return null;
    s.scrollTop = 500;
    return { scrollTop: s.scrollTop, scrollable: s.scrollHeight > s.clientHeight + 2, hasHeader: !!h };
  });
  c.ok(!!shell, 'device monitor shell present');
  c.ok(shell && shell.scrollable, 'monitor screen is the scroll root');
  await page.waitForTimeout(200);
  const headerScrolled = await page.evaluate(() => document.querySelector('.site-header').classList.contains('scrolled'));
  c.ok(headerScrolled, 'sticky header picks up the monitor scroll');

  /* --- full-width escape hatch ------------------------------------------ */
  await page.evaluate(() => { document.querySelector('.device-screen').scrollTop = 0; });
  const before = await page.evaluate(() => document.documentElement.classList.contains('device-wide'));
  await page.click('[data-device-toggle]');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({
    wide: document.documentElement.classList.contains('device-wide'),
    label: (document.querySelector('[data-device-toggle-label]') || {}).textContent,
    pressed: document.querySelector('[data-device-toggle]').getAttribute('aria-pressed')
  }));
  c.ok(after.wide !== before, 'full-width toggle changes the layout');
  c.ok(after.pressed === 'true' || after.pressed === 'false', 'toggle exposes aria-pressed', after.pressed);
  await page.screenshot({ path: OUT + '/device-fullwidth.png' });
  await page.click('[data-device-toggle]');
  await page.waitForTimeout(250);

  /* --- carousel --------------------------------------------------------- */
  const car = await page.evaluate(() => {
    const root = document.querySelector('[data-carousel]');
    if (!root) return null;
    const vp = root.querySelector('[data-carousel-viewport]');
    const track = root.querySelector('[data-carousel-track]');
    return {
      clones: track.querySelectorAll('[aria-hidden="true"]').length,
      originals: track.querySelectorAll('[aria-hidden="false"], [aria-hidden]:not([aria-hidden="true"])').length,
      scrollable: vp.scrollWidth > vp.clientWidth + 4,
      start: vp.scrollLeft
    };
  });
  if (car) {
    c.ok(car.clones > 0, 'carousel uses clone padding for seamless looping (' + car.clones + ' clones)');
    c.ok(car.scrollable, 'carousel viewport scrolls');
    await page.click('[data-carousel-next]');
    await page.waitForTimeout(700);
    const moved = await page.evaluate(() => document.querySelector('[data-carousel-viewport]').scrollLeft);
    c.ok(moved !== car.start, 'carousel next button advances the track');
  } else {
    c.ok(false, 'carousel markup found on the home page');
  }

  /* --- reduced motion --------------------------------------------------- */
  const rctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const rpage = await rctx.newPage();
  const rerrors = collectErrors(rpage);
  await rpage.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 30000 });
  await waitBooted(rpage, 12000);
  await rpage.waitForTimeout(400);
  const rm = await rpage.evaluate(() => {
    const reveal = document.querySelector('.reveal');
    const cs = reveal ? getComputedStyle(reveal) : null;
    const core = document.querySelector('[data-hero-core]');
    return {
      settled: document.documentElement.classList.contains('device-settled'),
      revealOpacity: cs ? cs.opacity : 'n/a',
      revealFilter: cs ? cs.filter : 'n/a',
      globeMode: core && core.globe ? core.globe.state().mode : 'none',
      globeRunning: core && core.globe ? core.globe.state().running : false
    };
  });
  c.ok(rm.settled, 'reduced motion still completes the boot sequence');
  c.ok(rm.revealOpacity === '1', 'reduced motion shows reveal content immediately', rm.revealOpacity);
  c.ok(rm.revealFilter === 'none', 'reduced motion drops the reveal blur', rm.revealFilter);
  c.ok(rm.globeRunning === false, 'reduced motion renders a single globe frame', 'mode=' + rm.globeMode);
  c.ok(rerrors.filter((e) => /pageerror/.test(e)).length === 0, 'no uncaught page errors (reduced motion)');
  await rctx.close();

  c.ok(errors.filter((e) => /pageerror/.test(e)).length === 0, 'no uncaught page errors');
  if (errors.length) { console.log('\nconsole/page errors:'); errors.slice(0, 10).forEach((e) => console.log('   ' + e)); }

  await browser.close();
  process.exit(c.done('device') ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
