/* ==========================================================================
   AH SOLUTION — ai-qa.cjs
   End-to-end QA for SOLUTION AI against the local static server, with the
   Netlify function mocked via request interception. Also re-checks that core
   website features still work.
   Run: node scripts/ai-qa.cjs   (requires the site on http://localhost:8000)
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

function req(name) {
  try { return require(name); } catch (e) {}
  try { return require(path.join('C:/Users/haami/AppData/Local/Temp/ah-qa/node_modules', name)); } catch (e) {}
  throw new Error('Cannot load module: ' + name);
}
function findChrome() {
  const base = 'C:/Users/haami/AppData/Local/ms-playwright';
  try {
    const dirs = fs.readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort();
    if (dirs.length) {
      const p = path.join(base, dirs[dirs.length - 1], 'chrome-win64', 'chrome.exe');
      if (fs.existsSync(p)) return p;
    }
  } catch (e) {}
  return null;
}

const { chromium } = req('playwright-core');
const BASE = 'http://localhost:8000/index.html';
const FN_GLOB = '**/.netlify/functions/solution-ai-chat**';
const OUT = path.join('C:/Users/haami/AppData/Local/Temp/ah-qa/out');
try { fs.mkdirSync(OUT, { recursive: true }); } catch (e) {}

let pass = 0, fail = 0;
const ok = (c, name, extra) => {
  if (c) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name + (extra ? '  -> ' + extra : '')); }
};

(async () => {
  const exe = findChrome();
  const browser = await chromium.launch({
    headless: true,
    executablePath: exe || undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox']
  });

  /* ---------------- Desktop ---------------- */
  console.log('SOLUTION AI QA — desktop\n');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  let postCount = 0, getCount = 0;
  await page.route(FN_GLOB, async (route) => {
    const r = route.request();
    if (r.method() === 'POST') { postCount++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, reply: 'Mocked AI reply for QA.', sources: [{ title: 'Mocked source', url: 'https://ahsolution.live/vlogs.html', type: 'page', label: 'Page' }], mode: 'ai' }) }); }
    getCount++;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, aiConfigured: true, durableRateLimit: true }) });
  });

  await page.goto(BASE, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => document.documentElement.classList.contains('booted'), null, { timeout: 20000, polling: 100 });
  await page.waitForFunction(() => document.documentElement.classList.contains('device-settled'), null, { timeout: 20000, polling: 100 });
  await page.waitForTimeout(600);

  // Globe
  const hasCore = await page.$('[data-hero-core]');
  ok(!!hasCore, 'hero core present');
  await page.waitForTimeout(2500);
  const globe = await page.evaluate(() => {
    const core = document.querySelector('[data-hero-core]');
    const gl = core && core.querySelector('canvas.hero-gl');
    const api = core && core.globe ? core.globe.state() : null;
    return { hasGl: !!gl, mode: api ? api.mode : 'none', hasLogo: !!core.querySelector('img[src*="logo"], svg[role="img"]') };
  });
  ok(globe.mode === 'webgl' || globe.mode === 'canvas2d', 'globe renderer active', 'mode=' + globe.mode);
  ok(globe.mode === 'webgl', 'globe upgraded to WebGL (Three.js)', 'mode=' + globe.mode);
  ok(!globe.hasLogo, 'no AH logo inside the globe center');

  // Activation core
  const coreInfo = await page.evaluate(() => {
    const b = document.querySelector('[data-ai-open]');
    return b ? { label: b.getAttribute('aria-label'), expanded: b.getAttribute('aria-expanded') } : null;
  });
  ok(coreInfo && coreInfo.label === 'Open SOLUTION AI', 'activation core has accessible name');
  ok(coreInfo && coreInfo.expanded === 'false', 'core starts collapsed');

  // UI-layer open latency (isolated from browser actionability overhead; panel is closed here)
  const jsOpenMs = await page.evaluate(() => {
    const api = window.__SOLUTION_AI__;
    if (!api) return -1;
    const t = performance.now();
    api.open();
    const ms = performance.now() - t;
    return Math.round(ms);
  });
  ok(jsOpenMs >= 0 && jsOpenMs < 200, 'panel open is immediate at the UI layer (' + jsOpenMs + 'ms)');
  await page.evaluate(() => window.__SOLUTION_AI__ && window.__SOLUTION_AI__.close());
  await page.waitForTimeout(450);

  // Open by clicking the exact centre
  const t0 = Date.now();
  await page.click('[data-ai-open]');
  await page.waitForSelector('[data-ai-panel].open', { timeout: 3000 });
  const openMs = Date.now() - t0;
  ok(openMs < 2500, 'panel opens on core click (' + openMs + 'ms)');
  const focused = await page.evaluate(() => document.activeElement === document.querySelector('[data-ai-input]'));
  ok(focused, 'chat input receives focus on open');
  const stillAnimating = await page.evaluate(() => {
    const core = document.querySelector('[data-hero-core]');
    return !!(core && core.globe && core.globe.state().running);
  });
  ok(stillAnimating, 'globe keeps animating while panel is open');
  await page.screenshot({ path: path.join(OUT, 'ai-desktop-open.png') });

  // Quick prompt -> local knowledge answer (no POST)
  const postsBefore = postCount;
  await page.click('[data-ai-quick-btn]');
  await page.waitForFunction(() => {
    const msgs = document.querySelectorAll('[data-ai-messages] .ai-msg--ai');
    const last = msgs[msgs.length - 1];
    return last && /found|मिला/i.test(last.textContent);
  }, null, { timeout: 5000 });
  const localHasCard = await page.evaluate(() => {
    const msgs = document.querySelectorAll('[data-ai-messages] .ai-msg--ai');
    const last = msgs[msgs.length - 1];
    return !!(last.querySelector('.ai-source, .ai-card'));
  });
  ok(localHasCard, 'quick prompt answered from site content with a real source/card');
  ok(postCount === postsBefore, 'local answer made no server call (cost-free)');

  // General question -> mocked AI
  await page.fill('[data-ai-input]', 'Tell me something random about clouds and weather');
  await page.click('[data-ai-send]');
  await page.waitForFunction(() => /Mocked AI reply/.test(document.querySelector('[data-ai-messages]').textContent), null, { timeout: 5000 });
  ok(postCount === postsBefore + 1, 'general question called the AI endpoint');
  const statusText = await page.textContent('[data-ai-status]');
  ok(/AI/i.test(statusText), 'status badge reflects AI mode', statusText);

  // Copy button present
  const copyBtn = await page.$('[data-ai-messages] .ai-msg--ai:last-child [data-ai-copy]');
  ok(!!copyBtn, 'assistant message has a copy button');

  // Esc closes + focus returns
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('[data-ai-panel]').classList.contains('open'), null, { timeout: 3000 });
  await page.waitForTimeout(350);
  const closed = await page.evaluate(() => ({
    hidden: document.querySelector('[data-ai-panel]').hidden,
    expanded: document.querySelector('[data-ai-open]').getAttribute('aria-expanded'),
    focusOnCore: document.activeElement === document.querySelector('[data-ai-open]')
  }));
  ok(closed.hidden && closed.expanded === 'false', 'Esc closes the panel and resets aria-expanded');
  ok(closed.focusOnCore, 'focus returns to the activation core');

  // Regression: existing features
  const reg = await page.evaluate(() => ({
    carousels: document.querySelectorAll('[data-carousel]').length,
    searchBtn: !!document.querySelector('[data-search-open]'),
    videos: document.querySelectorAll('[data-video-highlights] video, [data-latest-videos] .video-card, [data-latest-videos] .ah-card, [data-latest-videos] a').length,
    logo: !!document.querySelector('.brand img, .brand svg'),
    footer: !!document.querySelector('.site-footer')
  }));
  ok(reg.carousels >= 1, 'carousels still present (' + reg.carousels + ')');
  ok(reg.searchBtn && reg.logo && reg.footer, 'search, logo and footer intact');
  ok(reg.videos >= 1, 'video cards still render (' + reg.videos + ')');

  // Search modal still works
  await page.click('[data-search-open]');
  await page.waitForTimeout(150);
  const searchOpen = await page.evaluate(() => document.querySelector('[data-search-modal]').classList.contains('open'));
  ok(searchOpen, 'site search modal still opens');
  await page.keyboard.press('Escape');

  // Voice: mic hidden gracefully if unsupported
  const mic = await page.evaluate(() => {
    const b = document.querySelector('[data-ai-mic]');
    const sr = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    return { hidden: b.hidden, sr };
  });
  ok(mic.sr ? !mic.hidden : mic.hidden, 'mic button state matches browser support (sr=' + mic.sr + ')');

  await page.screenshot({ path: path.join(OUT, 'ai-desktop-closed.png') });
  await ctx.close();

  /* ---------------- Mobile ---------------- */
  console.log('\nSOLUTION AI QA — mobile 390px\n');
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const mpage = await mctx.newPage();
  const merrors = [];
  mpage.on('pageerror', (e) => merrors.push('pageerror: ' + e.message));
  mpage.on('console', (m) => { if (m.type() === 'error') merrors.push('console: ' + m.text()); });
  await mpage.route(FN_GLOB, (route) => {
    const r = route.request();
    if (r.method() === 'POST') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, reply: 'Mocked AI reply for QA.', sources: [], mode: 'ai' }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, aiConfigured: true, durableRateLimit: true }) });
  });
  await mpage.goto(BASE, { waitUntil: 'load', timeout: 30000 });
  await mpage.waitForFunction(() => document.documentElement.classList.contains('booted'), null, { timeout: 20000, polling: 100 });
  await mpage.waitForFunction(() => document.documentElement.classList.contains('device-settled'), null, { timeout: 20000, polling: 100 }).catch(() => {});
  await mpage.waitForTimeout(600);

  await mpage.click('[data-ai-open]');
  await mpage.waitForSelector('[data-ai-panel].open', { timeout: 3000 });
  await mpage.waitForTimeout(400);
  const sheet = await mpage.evaluate(() => {
    const p = document.querySelector('[data-ai-panel]');
    const r = p.getBoundingClientRect();
    return {
      width: Math.round(r.width),
      left: Math.round(r.left),
      nearBottom: Math.abs(window.innerHeight - r.bottom) < 3,
      overflowX: document.documentElement.scrollWidth - window.innerWidth
    };
  });
  ok(sheet.width >= 386, 'mobile panel is a full-width sheet (' + sheet.width + 'px)');
  ok(sheet.left === 0, 'mobile sheet is flush left');
  ok(sheet.nearBottom, 'mobile sheet is anchored to the bottom');
  ok(sheet.overflowX <= 1, 'no horizontal overflow with the sheet open (' + sheet.overflowX + 'px)');
  await mpage.screenshot({ path: path.join(OUT, 'ai-mobile-sheet.png') });
  await mctx.close();

  /* ---------------- Voice (stubbed SpeechRecognition + speechSynthesis) ---------------- */
  console.log('\nSOLUTION AI QA — voice (stubbed)\n');
  const vctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await vctx.addInitScript(() => {
    function FakeSR() { this.started = false; this.onstart = null; this.onend = null; this.onerror = null; this.onresult = null; }
    FakeSR.prototype.start = function () { this.started = true; window.__fakeSR = this; setTimeout(() => { this.onstart && this.onstart(); }, 0); };
    FakeSR.prototype.stop = function () { this.started = false; setTimeout(() => { this.onend && this.onend(); }, 0); };
    window.SpeechRecognition = FakeSR;
    window.webkitSpeechRecognition = FakeSR;
    window.__spoke = [];
    window.__synthCancel = 0;
    window.SpeechSynthesisUtterance = function (text) { this.text = text; };
    const synth = { getVoices: () => [], speak: (u) => { window.__spoke.push(u.text); }, cancel: () => { window.__synthCancel++; }, onvoiceschanged: null };
    try { Object.defineProperty(window, 'speechSynthesis', { configurable: true, get: () => synth }); } catch (e) { window.speechSynthesis = synth; }
  });
  const vpage = await vctx.newPage();
  const verrors = [];
  vpage.on('pageerror', (e) => verrors.push('pageerror: ' + e.message));
  vpage.on('console', (m) => { if (m.type() === 'error') verrors.push('console: ' + m.text()); });
  await vpage.route(FN_GLOB, (route) => {
    if (route.request().method() === 'POST') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, reply: 'Voice QA reply about the channel.', sources: [], mode: 'ai' }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, aiConfigured: true, durableRateLimit: true }) });
  });
  await vpage.goto(BASE, { waitUntil: 'load', timeout: 30000 });
  await vpage.waitForFunction(() => document.documentElement.classList.contains('booted'), null, { timeout: 20000, polling: 100 });
  await vpage.waitForFunction(() => document.documentElement.classList.contains('device-settled'), null, { timeout: 20000, polling: 100 }).catch(() => {});
  await vpage.waitForTimeout(600);
  await vpage.click('[data-ai-open]');
  await vpage.waitForSelector('[data-ai-panel].open', { timeout: 3000 });

  const micShown = await vpage.evaluate(() => !document.querySelector('[data-ai-mic]').hidden);
  ok(micShown, 'mic button shown when SpeechRecognition is available');
  await vpage.click('[data-ai-mic]');
  await vpage.waitForFunction(() => document.querySelector('[data-ai-mic]').getAttribute('aria-pressed') === 'true', null, { timeout: 2000 });
  ok(true, 'mic enters listening state on click');
  await vpage.evaluate(() => {
    const inst = window.__fakeSR;
    inst.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'latest videos' }], { isFinal: true })] });
  });
  const inputVal = await vpage.inputValue('[data-ai-input]');
  ok(/latest videos/i.test(inputVal), 'speech result fills the chat input', 'value=' + inputVal);
  await vpage.click('[data-ai-mic]');
  await vpage.waitForFunction(() => document.querySelector('[data-ai-mic]').getAttribute('aria-pressed') === 'false', null, { timeout: 2000 });
  ok(true, 'mic stops listening on second click');

  await vpage.click('[data-ai-speak]');
  const pressed = await vpage.getAttribute('[data-ai-speak]', 'aria-pressed');
  ok(pressed === 'true', 'speak toggle turns on (aria-pressed=true)');
  await vpage.click('[data-ai-clear]');
  await vpage.fill('[data-ai-input]', 'What videos are on the channel?');
  await vpage.click('[data-ai-send]');
  await vpage.waitForFunction(() => window.__spoke && window.__spoke.length > 0, null, { timeout: 5000 });
  ok(true, 'assistant reply is spoken via speechSynthesis when speak is on');
  const cancelBefore = await vpage.evaluate(() => window.__synthCancel);
  await vpage.keyboard.press('Escape');
  await vpage.waitForTimeout(250);
  const cancelAfter = await vpage.evaluate(() => window.__synthCancel);
  ok(cancelAfter > cancelBefore, 'closing the panel stops speech synthesis');
  ok(verrors.filter((e) => /pageerror/.test(e)).length === 0, 'no uncaught page errors (voice)');
  await vctx.close();

  /* ---------------- Knowledge-only (AI endpoint unavailable, no key) ---------------- */
  console.log('\nSOLUTION AI QA — knowledge-only mode\n');
  const kctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const kpage = await kctx.newPage();
  const kerrors = [];
  kpage.on('pageerror', (e) => kerrors.push('pageerror: ' + e.message));
  kpage.on('console', (m) => { if (m.type() === 'error') kerrors.push('console: ' + m.text()); });
  let kpost = 0;
  await kpage.route(FN_GLOB, (route) => {
    if (route.request().method() === 'POST') { kpost++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, reply: 'SHOULD NOT HAPPEN', sources: [], mode: 'ai' }) }); }
    return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false }) });
  });
  await kpage.goto(BASE, { waitUntil: 'load', timeout: 30000 });
  await kpage.waitForFunction(() => document.documentElement.classList.contains('booted'), null, { timeout: 20000, polling: 100 });
  await kpage.waitForFunction(() => document.documentElement.classList.contains('device-settled'), null, { timeout: 20000, polling: 100 }).catch(() => {});
  await kpage.waitForTimeout(600);
  await kpage.click('[data-ai-open]');
  await kpage.waitForSelector('[data-ai-panel].open', { timeout: 3000 });
  await kpage.waitForFunction(() => document.querySelector('[data-ai-status]').getAttribute('data-mode') === 'knowledge', null, { timeout: 3000 });
  ok(true, 'status shows knowledge mode when the AI endpoint is unavailable');
  await kpage.fill('[data-ai-input]', 'Tell me something random about clouds and weather');
  await kpage.click('[data-ai-send]');
  await kpage.waitForFunction(() => document.querySelectorAll('[data-ai-messages] .ai-msg--ai').length > 0, null, { timeout: 5000 });
  const ktext = await kpage.textContent('[data-ai-messages] .ai-msg--ai:last-child');
  ok(ktext && ktext.trim().length > 0 && !/SHOULD NOT HAPPEN/.test(ktext), 'knowledge-only reply rendered without the AI endpoint');
  ok(kpost === 0, 'knowledge-only mode made no POST to the AI endpoint');
  ok(kerrors.filter((e) => /pageerror/.test(e)).length === 0, 'no uncaught page errors (knowledge-only)');
  await kctx.close();

  await browser.close();

  console.log('\nConsole/page errors (desktop): ' + errors.length);
  errors.slice(0, 12).forEach((e) => console.log('   ' + e));
  console.log('Console/page errors (mobile): ' + merrors.length);
  merrors.slice(0, 12).forEach((e) => console.log('   ' + e));
  ok(errors.filter((e) => /pageerror/.test(e)).length === 0, 'no uncaught page errors (desktop)');
  ok(merrors.filter((e) => /pageerror/.test(e)).length === 0, 'no uncaught page errors (mobile)');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('screenshots -> ' + OUT);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
