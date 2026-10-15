/* ==========================================================================
   qa-device.cjs — device-world QA
   Boot timing (the 2.5s loading-animation requirement), boot overlay cleanup,
   monitor scroll lock, full-width escape hatch, carousel and reduced motion.
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
  c.ok(bootedAt !== null && bootedAt - bootingAt >= 2200, 'loading animation stays on screen ~2.5s (' + (bootedAt - bootingAt) + 'ms on the page clock)');
  /* upper bound is generous: the software renderer used in CI can delay the
     timer callback, but the boot screen must still clear on its own */
  c.ok(bootedAt !== null && bootedAt - bootingAt <= 12000, 'loading screen is not stuck (' + (bootedAt - bootingAt) + 'ms)');
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
