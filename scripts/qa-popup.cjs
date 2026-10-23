/* ==========================================================================
   qa-popup.cjs - "About YouTube channel data" popup QA
   Layering/geometry (anchored above trigger, flips below, clamped on-screen,
   in front of every panel), scroll/resize updates, close behaviours, focus
   handling, ARIA, and sync status copy states.

   Run: npm run qa:popup     (site must be served on http://localhost:8000)
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const { launcher, counter, assertServer, waitBooted, waitSettled } = require('./qa-lib.cjs');

const BASE = 'http://localhost:8000';
const SHOTS = 'C:/Users/haami/AppData/Local/Temp/opencode/popup';
try { fs.mkdirSync(SHOTS, { recursive: true }); } catch (e) {}

const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'data', 'videos.json'), 'utf8'));
const nowIso = new Date().toISOString();
const liveOk = Object.assign({}, snapshot, {
  generatedAt: nowIso,
  syncedAt: nowIso,
  source: 'youtube-rss',
  stale: false,
  sync: { ok: true, lastAttemptAt: nowIso, lastSuccessAt: nowIso, lastError: null }
});

const c = counter();

async function openPopup(page) {
  const trigger = page.locator('[data-video-status] [data-yt-data-about]').first();
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  await page.waitForFunction(() => {
    const m = document.getElementById('yt-data-modal');
    return m && !m.hidden;
  });
  return trigger;
}

/* Put the trigger near the visual top or bottom of its scroll root. */
async function placeTrigger(page, where) {
  await page.evaluate((where) => {
    const el = document.querySelector('[data-video-status] [data-yt-data-about]');
    el.scrollIntoView({ block: where === 'top' ? 'start' : 'end', inline: 'nearest' });
    const screen = document.querySelector('.device-screen');
    const scroller = screen && screen.scrollHeight > screen.clientHeight + 2 ? screen : null;
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight;
    const delta = where === 'top' ? r.top - 110 : r.bottom - (vh - 130);
    if (Math.abs(delta) > 2) {
      if (scroller) scroller.scrollTop += delta;
      else window.scrollBy(0, delta);
    }
  }, where);
  await page.waitForTimeout(350);
}

/* Synthetic trigger at the visual top/bottom to prove the flip decision. */
async function openSynthetic(page, topPx) {
  await page.evaluate((topPx) => {
    let b = document.getElementById('qa-popup-anchor');
    if (!b) {
      b = document.createElement('button');
      b.id = 'qa-popup-anchor';
      b.type = 'button';
      b.setAttribute('data-yt-data-about', '');
      b.textContent = 'anchor';
      b.style.cssText = 'position:fixed;z-index:2000;left:30px;width:120px;height:32px;';
      document.body.appendChild(b);
    }
    b.style.top = topPx + 'px';
  }, topPx);
  await page.locator('#qa-popup-anchor').click();
  await page.waitForTimeout(150);
  return geometry(page);
}

async function nudgeScroll(page, dy) {
  await page.evaluate((dy) => {
    const s = document.querySelector('.device-screen');
    if (s && s.scrollHeight > s.clientHeight + 2) s.scrollTop += dy;
    else window.scrollBy(0, dy);
  }, dy);
  await page.waitForTimeout(350);
}

async function geometry(page) {
  return page.evaluate(() => {
    const modal = document.getElementById('yt-data-modal');
    const card = modal.querySelector('.yt-data-card');
    const trigger = document.querySelector('[data-yt-data-about][aria-expanded="true"]') ||
      document.querySelector('[data-video-status] [data-yt-data-about]');
    const m = modal.getBoundingClientRect();
    const k = card.getBoundingClientRect();
    const t = trigger.getBoundingClientRect();
    const style = getComputedStyle(modal);
    const hit = document.elementFromPoint(k.left + k.width / 2, k.top + Math.min(40, k.height / 2));
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    return {
      side: modal.dataset.side,
      pos: style.position,
      z: style.zIndex,
      card: { left: k.left, right: k.right, top: k.top, bottom: k.bottom, width: k.width, height: k.height },
      trigger: { top: t.top, bottom: t.bottom, left: t.left, right: t.right },
      vw, vh,
      inCard: !!(card && hit && card.contains(hit)),
      styleLeft: modal.style.left, styleTop: modal.style.top,
      ariaExpanded: trigger.getAttribute('aria-expanded'),
      activeIsClose: !!document.activeElement && !!document.activeElement.closest('[data-yt-data-close]'),
      role: card.getAttribute('role'),
      ariaModal: card.getAttribute('aria-modal')
    };
  });
}

function assertPlacement(g, label) {
  c.ok(g.pos === 'fixed', label + ': position fixed');
  c.ok(Number(g.z) >= 1500, label + ': z-index above page layers', g.z);
  c.ok(g.card.left >= 0 && g.card.right <= g.vw + 0.5, label + ': horizontally on-screen', JSON.stringify(g.card));
  c.ok(g.card.top >= 0 && g.card.bottom <= g.vh + 0.5, label + ': vertically on-screen', JSON.stringify(g.card));
  c.ok(g.card.width <= g.vw - 20, label + ': width fits viewport', g.card.width);
  c.ok(g.inCard, label + ': topmost element at card centre is the card');
  if (g.side === 'above') {
    const gap = g.trigger.top - g.card.bottom;
    c.ok(gap >= 8 && gap <= 16, label + ': opens directly above trigger (gap ' + Math.round(gap) + 'px)');
  } else {
    const gap = g.card.top - g.trigger.bottom;
    c.ok(gap >= 8 && gap <= 16, label + ': opens directly below trigger (gap ' + Math.round(gap) + 'px)');
  }
  c.ok(g.role === 'dialog' && g.ariaModal === 'false' && g.ariaExpanded === 'true',
    label + ': dialog ARIA + trigger expanded');
  c.ok(g.activeIsClose, label + ': focus moves into the popup');
}

(async () => {
  await assertServer(BASE);
  console.log('POPUP QA\n');
  const launch = launcher();
  const browser = await launch();

  /* ---------------- desktop: success status + placements ---------------- */
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.route('**/api/videos', (route) => route.fulfill({
    status: 200, contentType: 'application/json', headers: { 'Cache-Control': 'no-cache' }, body: JSON.stringify(liveOk)
  }));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message + ' @ ' + String(e.stack || '').slice(0, 200)));
  await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 30000 });
  await waitBooted(page);
  await waitSettled(page);
  await page.waitForFunction(() => /Last synced:/.test((document.querySelector('[data-video-status]') || {}).textContent || ''), null, { timeout: 12000 });

  const statusText = (await page.locator('[data-video-status]').first().innerText()).replace(/\s+/g, ' ');
  c.ok(/Last synced: .* IST/.test(statusText), 'success status shows an IST sync time', statusText.slice(0, 120));

  const sides = new Set();
  const topAnchor = await openSynthetic(page, 60);
  c.ok(topAnchor.side === 'below', 'edge placement: trigger near the top opens below (' + topAnchor.side + ')');
  sides.add(topAnchor.side);
  assertPlacement(topAnchor, 'desktop edge top');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);

  const bottomAnchor = await openSynthetic(page, 900 - 100);
  c.ok(bottomAnchor.side === 'above', 'edge placement: trigger near the bottom opens above (' + bottomAnchor.side + ')');
  sides.add(bottomAnchor.side);
  assertPlacement(bottomAnchor, 'desktop edge bottom');
  await page.screenshot({ path: path.join(SHOTS, 'desktop-open.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);

  await placeTrigger(page, 'bottom');
  await page.locator('[data-video-status] [data-yt-data-about]').first().click();
  await page.waitForTimeout(150);
  const real = await geometry(page);
  sides.add(real.side);
  assertPlacement(real, 'real trigger');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  c.ok(sides.has('above') && sides.has('below'), 'flips above and below depending on room (' + [...sides].join(',') + ')');

  /* scroll tracking: keep the trigger on-screen and nudge the scroller */
  await placeTrigger(page, 'bottom');
  let trigger;
  await page.locator('[data-video-status] [data-yt-data-about]').first().click();
  await page.waitForTimeout(150);
  const before = await geometry(page);
  await nudgeScroll(page, -70);
  const afterScroll = await geometry(page);
  c.ok(before.styleTop !== afterScroll.styleTop || before.styleLeft !== afterScroll.styleLeft,
    'popup repositions when the page scrolls');
  assertPlacement(afterScroll, 'after scroll');

  /* resize tracking (reopen if the anchor went off-screen during reflow) */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(350);
  if (await page.evaluate(() => document.getElementById('yt-data-modal').hidden)) {
    await openPopup(page);
  }
  const afterResize = await geometry(page);
  assertPlacement(afterResize, 'after resize');
  await page.screenshot({ path: path.join(SHOTS, 'desktop-resized-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(250);

  /* close behaviours */
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  c.ok(await page.evaluate(() => document.getElementById('yt-data-modal').hidden), 'Escape closes the popup');
  c.ok(await page.evaluate(() => document.activeElement === document.querySelector('[data-video-status] [data-yt-data-about]')),
    'focus returns to the trigger after Escape');

  trigger = await openPopup(page);
  await page.mouse.click(5, 450);
  await page.waitForTimeout(80);
  c.ok(await page.evaluate(() => document.getElementById('yt-data-modal').hidden), 'outside click closes the popup');

  trigger = await openPopup(page);
  await page.locator('#yt-data-modal [data-yt-data-close]').click();
  await page.waitForTimeout(80);
  c.ok(await page.evaluate(() => document.getElementById('yt-data-modal').hidden), 'close button closes the popup');

  trigger = await openPopup(page);
  await trigger.click();
  await page.waitForTimeout(80);
  c.ok(await page.evaluate(() => document.getElementById('yt-data-modal').hidden), 'second trigger click closes the popup');
  c.ok(errors.length === 0, 'no page errors', errors.join(' | '));

  /* mobile viewport: open + fit */
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await mctx.newPage();
  await mp.route('**/api/videos', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(liveOk)
  }));
  await mp.goto(BASE + '/vlogs.html', { waitUntil: 'load', timeout: 30000 });
  await waitBooted(mp);
  await waitSettled(mp);
  await openPopup(mp);
  const mg = await geometry(mp);
  assertPlacement(mg, 'mobile vlogs');
  await mp.screenshot({ path: path.join(SHOTS, 'mobile-open.png') });
  await mctx.close();

  /* ---------------- status states ---------------- */
  const fctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const fp = await fctx.newPage();
  const failed = Object.assign({}, liveOk, {
    sync: { ok: false, lastAttemptAt: nowIso, lastSuccessAt: nowIso, lastError: 'upstream 503' }
  });
  await fp.route('**/api/videos', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(failed)
  }));
  await fp.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 30000 });
  await waitBooted(fp);
  await waitSettled(fp);
  await fp.waitForFunction(() => /Last sync failed/.test((document.querySelector('[data-video-status]') || {}).textContent || ''), null, { timeout: 12000 });
  const failText = (await fp.locator('[data-video-status]').first().innerText()).replace(/\s+/g, ' ');
  c.ok(/previously saved data/i.test(failText), 'failed sync shows saved-data message', failText.slice(0, 120));
  c.ok(await fp.locator('[data-video-status] .data-badge').first().evaluate((el) => el.classList.contains('is-stale')),
    'failed sync badge uses the stale state');
  await fp.screenshot({ path: path.join(SHOTS, 'status-failed.png') });
  await fctx.close();

  const uctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const up = await uctx.newPage();
  /* Test shim: keep the request pending past the app's 6s UI timeout so the
     in-flight state can be observed deterministically on this slow machine. */
  await up.addInitScript(() => {
    const Orig = window.AbortController;
    window.AbortController = class extends Orig { abort() { /* held for QA */ } };
  });
  let releaseFeed;
  const feedGate = new Promise((resolve) => { releaseFeed = resolve; });
  await up.route('**/api/videos', async (route) => {
    await feedGate;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(liveOk) });
  });
  await up.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 30000 });
  await waitBooted(up);
  const sawUpdating = await up.waitForFunction(
    () => /Updating channel data/.test((document.querySelector('[data-video-status]') || {}).textContent || ''),
    null, { timeout: 6000 }
  ).then(() => true).catch(() => false);
  c.ok(sawUpdating, 'status shows "Updating channel data" while the fetch is in flight');
  releaseFeed();
  await up.waitForFunction(() => /Last synced:/.test((document.querySelector('[data-video-status]') || {}).textContent || ''), null, { timeout: 12000 });
  const updating = (await up.locator('[data-video-status]').first().innerText()).replace(/\s+/g, ' ');
  c.ok(/Last synced: .* IST/.test(updating), 'status settles on the IST sync time', updating.slice(0, 120));
  await uctx.close();

  /* delayed fallback when the endpoint is unreachable */
  const dctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const dp = await dctx.newPage();
  await dp.route('**/api/videos', (route) => route.abort());
  await dp.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 30000 });
  await waitBooted(dp);
  await dp.waitForFunction(() => /Last sync failed|Data may be delayed/.test((document.querySelector('[data-video-status]') || {}).textContent || ''), null, { timeout: 12000 });
  const delayText = (await dp.locator('[data-video-status]').first().innerText()).replace(/\s+/g, ' ');
  c.ok(/Last sync failed|Data may be delayed/.test(delayText), 'unreachable endpoint shows a delayed/saved state', delayText.slice(0, 120));

  await dctx.close();
  await browser.close();
  process.exit(c.done('POPUP QA') ? 1 : 0);
})().catch((err) => {
  console.error('POPUP QA crashed:', err);
  process.exit(2);
});
