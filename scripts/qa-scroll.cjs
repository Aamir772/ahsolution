/* ==========================================================================
   qa-scroll.cjs — interaction QA
   Scroll reveals, sticky header, reading progress, search modal
   (staged motion + focus trap + focus return), blog filtering, mobile nav,
   video facades, copy-link and newsletter validation.
   Run: npm run qa:scroll    (site must be served on http://localhost:8000)
   ========================================================================== */
'use strict';
const { launcher, counter, OUT, assertServer, waitBooted, waitSettled, scrollTo, collectErrors } = require('./qa-lib.cjs');

const BASE = 'http://localhost:8000';
const c = counter();

(async () => {
  await assertServer(BASE);
  console.log('SCROLL / INTERACTION QA\n');
  const launch = launcher();
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = collectErrors(page);

  await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 30000 });
  await waitBooted(page, 12000);
  await waitSettled(page, 12000);
  await page.waitForTimeout(600);

  /* --- reveal + sticky header ------------------------------------------- */
  const before = await page.evaluate(() => ({
    reveals: document.querySelectorAll('.reveal').length,
    revealed: document.querySelectorAll('.reveal.in').length,
    scrolled: document.querySelector('.site-header').classList.contains('scrolled')
  }));
  c.ok(before.reveals > 0, 'home page declares reveal targets (' + before.reveals + ')');
  c.ok(before.revealed < before.reveals, 'reveals start hidden below the fold');
  c.ok(!before.scrolled, 'header is not in the scrolled state at the top');

  for (let i = 1; i <= 5; i++) { await scrollTo(page, i / 5); await page.waitForTimeout(450); }
  const after = await page.evaluate(() => ({
    revealed: document.querySelectorAll('.reveal.in').length,
    total: document.querySelectorAll('.reveal').length,
    scrolled: document.querySelector('.site-header').classList.contains('scrolled'),
    stuck: getComputedStyle(document.querySelector('.site-header')).position
  }));
  c.ok(after.revealed === after.total, 'every reveal target activates once scrolled (' + after.revealed + '/' + after.total + ')');
  c.ok(after.scrolled, 'sticky header enters the scrolled state');
  c.ok(after.stuck === 'sticky', 'header uses position:sticky', after.stuck);

  /* reveal elements must end fully opaque */
  const opacity = await page.evaluate(() => {
    const el = document.querySelector('.reveal.in');
    return el ? getComputedStyle(el).opacity : 'n/a';
  });
  c.ok(opacity === '1', 'revealed content settles at full opacity', opacity);
  await page.screenshot({ path: OUT + '/scroll-revealed.png' });

  /* --- search modal ------------------------------------------------------ */
  await page.evaluate(() => { const s = document.querySelector('.device-screen'); if (s) s.scrollTop = 0; });
  await page.waitForTimeout(300);
  await page.click('[data-search-open]');
  await page.waitForTimeout(700);
  const open = await page.evaluate(() => {
    const m = document.querySelector('[data-search-modal]');
    const p = m.querySelector('.search-panel');
    return {
      open: m.classList.contains('open'),
      shown: m.classList.contains('is-shown'),
      opacity: getComputedStyle(p).opacity,
      focused: document.activeElement === m.querySelector('input'),
      locked: document.body.style.overflow === 'hidden'
    };
  });
  c.ok(open.open && open.shown, 'search modal opens with the staged motion classes');
  c.ok(open.opacity === '1', 'search panel finishes at full opacity', open.opacity);
  c.ok(open.focused, 'search input receives focus on open');
  c.ok(open.locked, 'page scroll is locked behind the modal');

  /* type + results */
  await page.fill('[data-search-modal] input', 'wallpaper');
  await page.waitForTimeout(250);
  const results = await page.evaluate(() => document.querySelectorAll('[data-search-results] .search-result').length);
  c.ok(results > 0, 'search returns matching results (' + results + ')');

  /* focus trap: Tab from the last focusable wraps to the first */
  const trap = await page.evaluate(() => {
    const m = document.querySelector('[data-search-modal]');
    const items = [...m.querySelectorAll('a[href],button:not([disabled]),input')].filter((el) => el.offsetParent !== null);
    if (!items.length) return { items: 0 };
    items[items.length - 1].focus();
    return { items: items.length, lastIsFocused: document.activeElement === items[items.length - 1] };
  });
  c.ok(trap.items >= 2, 'modal exposes focusable controls (' + trap.items + ')');
  await page.keyboard.press('Tab');
  const wrapped = await page.evaluate(() => {
    const m = document.querySelector('[data-search-modal]');
    const first = [...m.querySelectorAll('a[href],button:not([disabled]),input')].filter((el) => el.offsetParent !== null)[0];
    return document.activeElement === first;
  });
  c.ok(wrapped, 'Tab wraps from the last control back to the first');

  /* Esc closes and returns focus to the opener */
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const closed = await page.evaluate(() => {
    const m = document.querySelector('[data-search-modal]');
    return {
      open: m.classList.contains('open'),
      shown: m.classList.contains('is-shown'),
      locked: document.body.style.overflow === 'hidden',
      focusOnOpener: document.activeElement === document.querySelector('[data-search-open]')
    };
  });
  c.ok(!closed.open && !closed.shown, 'Escape closes the search modal');
  c.ok(!closed.locked, 'page scroll is released when the modal closes');
  c.ok(closed.focusOnOpener, 'focus returns to the button that opened the modal');

  /* --- video facade ------------------------------------------------------ */
  const facade = await page.evaluate(() => {
    const b = document.querySelector('[data-latest-videos] [data-video-id]');
    return b ? { id: b.dataset.videoId, iframe: !!b.querySelector('iframe') } : null;
  });
  if (facade) {
    await page.evaluate(() => document.querySelector('[data-latest-videos] [data-video-id]').scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(300);
    await page.click('[data-latest-videos] [data-video-id]');
    await page.waitForTimeout(400);
    const loaded = await page.evaluate(() => {
      const f = document.querySelector('[data-latest-videos] iframe[src*="youtube-nocookie"]');
      return f ? f.src : null;
    });
    c.ok(!!loaded && loaded.indexOf(facade.id) !== -1, 'clicking a facade loads the real YouTube embed');
  } else {
    c.ok(false, 'video facade present on the home page');
  }

  /* ---------------- blog filter ---------------- */
  await page.goto(BASE + '/blog.html', { waitUntil: 'load', timeout: 30000 });
  await waitBooted(page, 12000);
  await page.waitForTimeout(500);
  const blogAll = await page.evaluate(() => ({
    total: document.querySelectorAll('[data-blog-card]').length,
    visible: [...document.querySelectorAll('[data-blog-card]')].filter((el) => !el.classList.contains('hidden')).length
  }));
  c.ok(blogAll.total > 0 && blogAll.visible === blogAll.total, 'all blog cards start visible (' + blogAll.total + ')');

  await page.click('[data-filter="apps"]');
  await page.waitForTimeout(300);
  const filtered = await page.evaluate(() => ({
    visible: [...document.querySelectorAll('[data-blog-card]')].filter((el) => !el.classList.contains('hidden')).length,
    active: document.querySelector('[data-filter].active') ? document.querySelector('[data-filter].active').dataset.filter : null,
    emptyHidden: document.querySelector('[data-empty-state]').classList.contains('hidden')
  }));
  c.ok(filtered.visible > 0 && filtered.visible < blogAll.total, 'category filter narrows the list (' + filtered.visible + ')');
  c.ok(filtered.active === 'apps', 'active chip reflects the chosen category', filtered.active);
  c.ok(filtered.emptyHidden, 'empty state stays hidden while results exist');

  await page.fill('[data-blog-search]', 'zzzz-no-such-guide');
  await page.waitForTimeout(300);
  const empty = await page.evaluate(() => ({
    visible: [...document.querySelectorAll('[data-blog-card]')].filter((el) => !el.classList.contains('hidden')).length,
    emptyShown: !document.querySelector('[data-empty-state]').classList.contains('hidden')
  }));
  c.ok(empty.visible === 0 && empty.emptyShown, 'no-match search shows the empty state');

  await page.fill('[data-blog-search]', '');
  await page.click('[data-filter="gadgets"]');
  await page.waitForTimeout(250);
  await page.screenshot({ path: OUT + '/scroll-blog-filtered.png' });

  /* ---------------- article reading progress ---------------- */
  await page.goto(BASE + '/guides/live-wallpaper-on-pc.html', { waitUntil: 'load', timeout: 30000 });
  await waitBooted(page, 12000);
  await page.waitForTimeout(500);
  const startW = await page.evaluate(() => document.querySelector('.reading-progress').style.width);
  await scrollTo(page, 0.55);
  await page.waitForTimeout(400);
  const midW = await page.evaluate(() => document.querySelector('.reading-progress').style.width);
  c.ok(parseFloat(midW || '0') > parseFloat(startW || '0'), 'reading progress advances while scrolling (' + startW + ' -> ' + midW + ')');

  const copy = await page.evaluate(() => {
    const b = document.querySelector('[data-copy-link]');
    return !!b;
  });
  c.ok(copy, 'article exposes a copy-link control');

  /* ---------------- mobile nav ---------------- */
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const mpage = await mctx.newPage();
  const merrors = collectErrors(mpage);
  await mpage.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 30000 });
  await waitBooted(mpage, 12000);
  await waitSettled(mpage, 12000);
  await mpage.waitForTimeout(500);
  const navClosed = await mpage.evaluate(() => ({
    expanded: document.querySelector('.menu-toggle').getAttribute('aria-expanded'),
    open: document.querySelector('.nav-links').classList.contains('open'),
    display: getComputedStyle(document.querySelector('.nav-links')).display
  }));
  c.ok(navClosed.expanded === 'false' && navClosed.display === 'none', 'mobile nav starts closed');

  await mpage.click('.menu-toggle');
  await mpage.waitForTimeout(350);
  const navOpen = await mpage.evaluate(() => {
    const links = [...document.querySelectorAll('.nav-links a')];
    return {
      open: document.querySelector('.nav-links').classList.contains('open'),
      expanded: document.querySelector('.menu-toggle').getAttribute('aria-expanded'),
      indices: links.map((a) => a.style.getPropertyValue('--i')),
      delays: links.map((a) => getComputedStyle(a).animationDelay),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  });
  c.ok(navOpen.open && navOpen.expanded === 'true', 'menu toggle opens the mobile nav');
  c.ok(navOpen.indices.length > 0 && navOpen.indices.every((v, i) => v === String(i)), 'each nav link carries a stagger index');
  c.ok(navOpen.delays.length > 1 && navOpen.delays[1] !== navOpen.delays[0], 'nav links animate on staggered delays');
  c.ok(navOpen.overflowX <= 0, 'no horizontal overflow with the mobile nav open', navOpen.overflowX + 'px');
  await mpage.screenshot({ path: OUT + '/scroll-mobile-nav.png' });

  await mpage.keyboard.press('Escape');
  await mpage.waitForTimeout(250);
  const navEsc = await mpage.evaluate(() => document.querySelector('.nav-links').classList.contains('open'));
  c.ok(!navEsc, 'Escape closes the mobile nav');
  c.ok(merrors.filter((e) => /pageerror/.test(e)).length === 0, 'no uncaught page errors (mobile)');
  await mctx.close();

  c.ok(errors.filter((e) => /pageerror/.test(e)).length === 0, 'no uncaught page errors');
  if (errors.length) { console.log('\nconsole/page errors:'); errors.slice(0, 10).forEach((e) => console.log('   ' + e)); }

  await browser.close();
  process.exit(c.done('scroll') ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
