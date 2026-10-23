/* ==========================================================================
   AH SOLUTION — ai-qa.cjs
   End-to-end QA for SOLUTION AI against the local static server, with the
   assistant backend (/health + /api/chat) mocked via request interception.
   Also re-checks that core website features still work.

   The client talks to the backend at window.__AH_ASSISTANT_BASE__ + '/api/chat'
   and '/health'. We force that base to '' (same origin) so Playwright can mock
   both endpoints here. Also covers offline and degraded (model failed) states.

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
const HEALTH_GLOB = '**/health';
const CHAT_GLOB = '**/api/chat';
const OUT = path.join('C:/Users/haami/AppData/Local/Temp/ah-qa/out');
try { fs.mkdirSync(OUT, { recursive: true }); } catch (e) {}

let pass = 0, fail = 0;
const ok = (c, name, extra) => {
  if (c) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name + (extra ? '  -> ' + extra : '')); }
};

// Force same-origin so /health and /api/chat are interceptable in QA.
const setBase = () => { try { window.__AH_ASSISTANT_BASE__ = ''; } catch (e) {} };

function healthBody(providers) {
  return JSON.stringify({ ok: true, status: 'ok', version: '3.1.0', uptimeMs: 10, providers, tools: 4, storage: 'memory', config: {} });
}
const CLOUD_PROVIDERS = [{ id: 'openai', kind: 'cloud', model: 'gpt-mock', available: true }];
const NONE_PROVIDERS = [{ id: 'none', kind: 'none', model: 'none', available: true }];

function chatBody(extra) {
  return JSON.stringify(Object.assign({
    ok: true, reply: 'Mocked AI reply for QA.', mode: 'model', provider: 'openai', model: 'gpt-mock',
    sessionId: 'sess-1', sources: [{ title: 'Mocked source', url: 'https://ahsolution.live/vlogs.html', snippet: 's', score: 3 }],
    attached: true, flagged: false, degraded: false, modelConfigured: true
  }, extra || {}));
}

async function routeBackend(page, { providers = CLOUD_PROVIDERS, chat = chatBody(), healthStatus = 200, abort = false } = {}, counters = { post: 0 }) {
  await page.route(HEALTH_GLOB, (route) => {
    if (abort) return route.abort('failed');
    return route.fulfill({ status: healthStatus, contentType: 'application/json', body: healthBody(providers) });
  });
  await page.route(CHAT_GLOB, (route) => {
    if (abort) return route.abort('failed');
    const r = route.request();
    if (r.method() === 'POST') { counters.post++; return route.fulfill({ status: 200, contentType: 'application/json', body: chat }); }
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false }) });
  });
  return counters;
}

async function boot(page) {
  await page.goto(BASE, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => document.documentElement.classList.contains('booted'), null, { timeout: 20000, polling: 100 });
  await page.waitForFunction(() => document.documentElement.classList.contains('device-settled'), null, { timeout: 20000, polling: 100 }).catch(() => {});
  await page.waitForTimeout(600);
}

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
  await ctx.addInitScript(setBase);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  const counters = { post: 0 };
  await routeBackend(page, {}, counters);

  await boot(page);

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

  // UI-layer open latency
  const jsOpenMs = await page.evaluate(() => {
    const api = window.__SOLUTION_AI__;
    if (!api) return -1;
    const t = performance.now();
    api.open();
    return Math.round(performance.now() - t);
  });
  ok(jsOpenMs >= 0 && jsOpenMs < 200, 'panel open is immediate at the UI layer (' + jsOpenMs + 'ms)');
  await page.evaluate(() => window.__SOLUTION_AI__ && window.__SOLUTION_AI__.close());
  await page.waitForTimeout(450);

  // Open by clicking the core
  const t0 = Date.now();
  await page.click('[data-ai-open]');
  await page.waitForSelector('[data-ai-panel].open', { timeout: 8000 });
  const openMs = Date.now() - t0;
  ok(openMs < 2500, 'panel opens on core click (' + openMs + 'ms)');
  await page.waitForFunction(
    () => document.activeElement === document.querySelector('[data-ai-input]'),
    null, { timeout: 2000 }
  ).catch(() => {});
  const focused = await page.evaluate(() => document.activeElement === document.querySelector('[data-ai-input]'));
  ok(focused, 'chat input receives focus on open');
  const stillAnimating = await page.evaluate(() => {
    const core = document.querySelector('[data-hero-core]');
    return !!(core && core.globe && core.globe.state().running);
  });
  ok(stillAnimating, 'globe keeps animating while panel is open');

  // Health → truthful cloud status
  await page.waitForFunction(() => document.querySelector('[data-ai-status]').getAttribute('data-mode') === 'cloud', null, { timeout: 4000 });
  const cloudText = await page.textContent('[data-ai-status]');
  ok(/cloud/i.test(cloudText), 'status reflects a live cloud model', cloudText);
  const base = await page.evaluate(() => window.__SOLUTION_AI__ && window.__SOLUTION_AI__.state().base);
  ok(base === '', 'client honours the configured assistant base', String(base));
  await page.screenshot({ path: path.join(OUT, 'ai-desktop-open.png') });

  // Quick prompt -> local knowledge answer (no POST)
  const postsBefore = counters.post;
  await page.click('[data-ai-quick-btn]');
  await page.waitForFunction(() => {
    const msgs = document.querySelectorAll('[data-ai-messages] .ai-msg--ai');
    const last = msgs[msgs.length - 1];
    return last && /found|\u092e\u093f\u0932\u093e/i.test(last.textContent);
  }, null, { timeout: 5000 });
  const localHasCard = await page.evaluate(() => {
    const msgs = document.querySelectorAll('[data-ai-messages] .ai-msg--ai');
    const last = msgs[msgs.length - 1];
    return !!(last.querySelector('.ai-source, .ai-card'));
  });
  ok(localHasCard, 'quick prompt answered from site content with a real source/card');
  ok(counters.post === postsBefore, 'local answer made no server call (cost-free)');

  // General question -> mocked model
  await page.fill('[data-ai-input]', 'Tell me something random about clouds and weather');
  await page.click('[data-ai-send]');
  await page.waitForFunction(() => /Mocked AI reply/.test(document.querySelector('[data-ai-messages]').textContent), null, { timeout: 5000 });
  ok(counters.post === postsBefore + 1, 'general question called the chat endpoint');
  const statusMode = await page.getAttribute('[data-ai-status]', 'data-mode');
  ok(statusMode === 'cloud', 'status stays cloud after a live-model reply', statusMode);

  // Multi-turn: the session id is reused on the next turn
  const sess = await page.evaluate(() => window.__SOLUTION_AI__.state().sessionId);
  ok(sess === 'sess-1', 'client stores the server session id', String(sess));

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

  const voiceHidden = await page.evaluate(() => document.querySelector('[data-ai-voice]').hidden);
  ok(voiceHidden, 'voice button stays hidden when the server reports voice unavailable');
  const noVoiceState = await page.evaluate(() => document.querySelector('[data-ai-voice-state]').hidden);
  ok(noVoiceState, 'no voice state is shown when no session is active');

  await page.screenshot({ path: path.join(OUT, 'ai-desktop-closed.png') });
  await ctx.close();

  /* ---------------- Mobile ---------------- */
  console.log('\nSOLUTION AI QA — mobile 390px\n');
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await mctx.addInitScript(setBase);
  const mpage = await mctx.newPage();
  const merrors = [];
  mpage.on('pageerror', (e) => merrors.push('pageerror: ' + e.message));
  mpage.on('console', (m) => { if (m.type() === 'error') merrors.push('console: ' + m.text()); });
  await routeBackend(mpage, { chat: chatBody({ sources: [] }) }, { post: 0 });
  await boot(mpage);

  await mpage.click('[data-ai-open]');
  await mpage.waitForSelector('[data-ai-panel].open', { timeout: 8000 });
  await mpage.waitForFunction(() => {
    const p = document.querySelector('[data-ai-panel]');
    if (!p) return false;
    const t = getComputedStyle(p).transform;
    return t === 'none' || /,\s*0(?:\.0+)?\)$/.test(t);
  }, null, { timeout: 4000 }).catch(() => {});
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
  await vctx.addInitScript(setBase);
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
  await routeBackend(vpage, { chat: chatBody({ reply: 'Voice QA reply about the channel.', sources: [] }) }, { post: 0 });
  await boot(vpage);
  await vpage.click('[data-ai-open]');
  await vpage.waitForSelector('[data-ai-panel].open', { timeout: 8000 });

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

  /* ---------------- Real voice (backend available, WebRTC stubbed) ----------------
     Exercises the client voice pipeline end-to-end: capability check, mic,
     SDP offer -> backend session relay, truthful states, mute, graceful stop,
     mic release and holographic-state sync. No real provider is contacted. */
  console.log('\nSOLUTION AI QA — real voice (WebRTC stubbed)\n');
  const rmctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await rmctx.addInitScript(setBase);
  await rmctx.addInitScript(() => {
    window.__voiceQA = { dc: null, pc: null, tracks: [], sent: [], remoteSet: false, added: 0 };
    function FakeTrack() { this.enabled = true; this.stopped = false; }
    FakeTrack.prototype.stop = function () { this.stopped = true; };
    function FakeStream(tracks) { this._t = tracks || []; }
    FakeStream.prototype.getTracks = function () { return this._t.slice(); };
    FakeStream.prototype.getAudioTracks = function () { return this._t.slice(); };
    window.MediaStream = FakeStream;
    const md = navigator.mediaDevices || (navigator.mediaDevices = {});
    Object.defineProperty(md, 'getUserMedia', {
      configurable: true,
      value: async () => { const tr = new FakeTrack(); window.__voiceQA.tracks.push(tr); return new FakeStream([tr]); }
    });
    function FakeDC() { this.readyState = 'open'; this._l = {}; }
    FakeDC.prototype.addEventListener = function (t, fn) { (this._l[t] = this._l[t] || []).push(fn); };
    FakeDC.prototype.send = function (msg) { window.__voiceQA.sent.push(msg); };
    FakeDC.prototype.close = function () { if (this.readyState === 'closed') return; this.readyState = 'closed'; (this._l.close || []).forEach((fn) => fn({})); };
    FakeDC.prototype.emit = function (obj) { (this._l.message || []).forEach((fn) => fn({ data: JSON.stringify(obj) })); };
    function FakePC() { this.iceGatheringState = 'complete'; this.connectionState = 'new'; this._l = {}; window.__voiceQA.pc = this; }
    FakePC.prototype.addEventListener = function (t, fn) { (this._l[t] = this._l[t] || []).push(fn); };
    FakePC.prototype.createDataChannel = function () { this.dc = new FakeDC(); window.__voiceQA.dc = this.dc; return this.dc; };
    FakePC.prototype.addTrack = function () { window.__voiceQA.added++; };
    FakePC.prototype.createOffer = async function () { return { type: 'offer', sdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' }; };
    FakePC.prototype.setLocalDescription = async function (d) { this.localDescription = d; };
    FakePC.prototype.setRemoteDescription = async function () {
      this.connectionState = 'connected';
      window.__voiceQA.remoteSet = true;
    };
    FakePC.prototype.close = function () { this.connectionState = 'closed'; };
    window.RTCPeerConnection = FakePC;
  });
  const rpage = await rmctx.newPage();
  const rerrors = [];
  rpage.on('pageerror', (e) => rerrors.push('pageerror: ' + e.message));
  rpage.on('console', (m) => { if (m.type() === 'error') rerrors.push('console: ' + m.text()); });
  await routeBackend(rpage, {}, { post: 0 });
  await rpage.route('**/api/voice/session', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, session: { sdp: 'v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\ns=-\r\nm=audio 9\r\n', transport: 'webrtc', voice: 'marin', model: 'gpt-realtime', maxSessionSeconds: 300 } })
  }));
  await rpage.route('**/api/voice', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, voice: { enabled: true, available: true, transport: 'webrtc', model: 'gpt-realtime', voice: 'marin', voices: ['marin'], maxSessionSeconds: 300, requireAuth: false, configured: true } })
  }));
  await boot(rpage);
  await rpage.click('[data-ai-open]');
  await rpage.waitForSelector('[data-ai-panel].open', { timeout: 8000 });

  await rpage.waitForFunction(() => !document.querySelector('[data-ai-voice]').hidden, null, { timeout: 3000 });
  ok(true, 'voice button appears when the server reports voice available');
  const avail = await rpage.evaluate(() => window.__SOLUTION_AI__.voiceAvailable());
  ok(avail === true, 'client reports voice available from the capability endpoint');
  const hiddenBefore = await rpage.evaluate(() => document.querySelector('[data-ai-voice-state]').hidden);
  ok(hiddenBefore, 'voice state stays hidden until a session is active');

  await rpage.click('[data-ai-voice]');
  await rpage.waitForFunction(() => window.__voiceQA && window.__voiceQA.remoteSet === true, null, { timeout: 5000 });
  await rpage.waitForFunction(() => window.__SOLUTION_AI__.voiceState().state === 'connecting', null, { timeout: 3000 });
  ok(true, 'starting voice enters the connecting state');

  await rpage.evaluate(() => window.__voiceQA.dc.emit({ type: 'session.started' }));
  await rpage.waitForFunction(() => window.__SOLUTION_AI__.voiceState().state === 'listening', null, { timeout: 3000 });
  const listUi = await rpage.evaluate(() => ({
    text: document.querySelector('[data-ai-voice-state]').textContent,
    holo: document.querySelector('[data-hero-core]').getAttribute('data-holo-state'),
    hidden: document.querySelector('[data-ai-voice-state]').hidden
  }));
  ok(/listening/i.test(listUi.text) && !listUi.hidden, 'UI shows Listening while the session is live', listUi.text);
  ok(listUi.holo === 'listening', 'holographic core reflects the listening state', String(listUi.holo));

  await rpage.evaluate(() => window.__voiceQA.dc.emit({ type: 'response.output_audio.started' }));
  await rpage.waitForFunction(() => window.__SOLUTION_AI__.voiceState().state === 'speaking', null, { timeout: 3000 });
  const speakHolo = await rpage.evaluate(() => document.querySelector('[data-hero-core]').getAttribute('data-holo-state'));
  ok(speakHolo === 'speaking', 'holographic core reflects the speaking state', String(speakHolo));
  await rpage.evaluate(() => window.__voiceQA.dc.emit({ type: 'response.output_audio.done' }));
  await rpage.waitForFunction(() => window.__SOLUTION_AI__.voiceState().state === 'listening', null, { timeout: 3000 });
  ok(true, 'state returns to Listening after the reply finishes');

  await rpage.click('[data-ai-voice-mute]');
  const muted = await rpage.evaluate(() => ({ pressed: document.querySelector('[data-ai-voice-mute]').getAttribute('aria-pressed'), disabled: window.__voiceQA.tracks.every((t) => !t.enabled) }));
  ok(muted.pressed === 'true' && muted.disabled, 'mute disables the outgoing microphone track');
  await rpage.click('[data-ai-voice-mute]');
  const unmuted = await rpage.evaluate(() => window.__voiceQA.tracks.every((t) => t.enabled));
  ok(unmuted, 'unmute re-enables the microphone track');

  await rpage.click('[data-ai-voice]');
  const closedSent = await rpage.evaluate(() => window.__voiceQA.sent.some((s) => /session\.close/.test(s)));
  ok(closedSent, 'stopping sends a graceful session.close request');
  await rpage.evaluate(() => window.__voiceQA.dc.emit({ type: 'session.closed' }));
  await rpage.waitForFunction(() => window.__SOLUTION_AI__.voiceState().state === 'idle', null, { timeout: 3000 });
  const cleaned = await rpage.evaluate(() => ({
    tracksStopped: window.__voiceQA.tracks.every((t) => t.stopped),
    pcClosed: window.__voiceQA.pc && window.__voiceQA.pc.connectionState === 'closed',
    hidden: document.querySelector('[data-ai-voice-state]').hidden,
    holo: document.querySelector('[data-hero-core]').getAttribute('data-holo-state')
  }));
  ok(cleaned.tracksStopped, 'stopping releases the microphone tracks');
  ok(cleaned.pcClosed, 'stopping closes the peer connection');
  ok(cleaned.hidden && cleaned.holo === 'idle', 'voice UI and holographic core return to idle');

  /* Regression: stopping must ALWAYS release the mic and the hologram, even
     when the remote never sends session.closed and even mid-connect. */
  const startSession = async () => {
    await rpage.evaluate(() => window.__SOLUTION_AI__.startVoice());
    await rpage.waitForFunction(() => window.__voiceQA && window.__voiceQA.dc && window.__voiceQA.dc.readyState === 'open', null, { timeout: 5000 });
  };
  const stoppedFor = async () => rpage.evaluate(() => ({
    state: window.__SOLUTION_AI__.voiceState().state,
    active: window.__SOLUTION_AI__.voiceState().active,
    tracksStopped: window.__voiceQA.tracks.every((t) => t.stopped),
    holo: document.querySelector('[data-hero-core]').getAttribute('data-holo-state')
  }));

  // (a) the remote close we asked for completes the cleanup on its own
  await startSession();
  await rpage.evaluate(() => window.__voiceQA.dc.emit({ type: 'session.started' }));
  await rpage.waitForFunction(() => window.__SOLUTION_AI__.voiceState().state === 'listening', null, { timeout: 3000 });
  await rpage.evaluate(() => window.__SOLUTION_AI__.stopVoice());
  await rpage.evaluate(() => window.__voiceQA.dc.close()); // remote never sends session.closed
  await rpage.waitForFunction(() => window.__SOLUTION_AI__.voiceState().state === 'idle', null, { timeout: 3000 });
  const afterRemoteClose = await stoppedFor();
  ok(afterRemoteClose.tracksStopped, 'a remote close after stop releases the microphone');
  ok(afterRemoteClose.holo === 'idle' && !afterRemoteClose.active, 'the hologram returns to idle after stop');

  // (b) a hung connect must still be cancellable
  await startSession();
  await rpage.waitForFunction(() => window.__SOLUTION_AI__.voiceState().state === 'connecting', null, { timeout: 3000 });
  await rpage.click('[data-ai-voice]');
  await rpage.waitForFunction(() => window.__SOLUTION_AI__.voiceState().state === 'idle', null, { timeout: 6000 });
  const afterCancel = await stoppedFor();
  ok(afterCancel.tracksStopped, 'cancelling during connect releases the microphone');
  ok(afterCancel.holo === 'idle', 'the hologram returns to idle after cancelling');
  const micBtnEnabled = await rpage.evaluate(() => !document.querySelector('[data-ai-voice]').disabled);
  ok(micBtnEnabled, 'the mic button stays usable so a hung session can be stopped');

  // (c) a failing session must not keep the microphone live
  await startSession();
  await rpage.evaluate(() => window.__voiceQA.dc.emit({ type: 'session.started' }));
  await rpage.waitForFunction(() => window.__SOLUTION_AI__.voiceState().state === 'listening', null, { timeout: 3000 });
  await rpage.evaluate(() => window.__voiceQA.dc.emit({ type: 'error', error: { message: 'model exploded' } }));
  await rpage.waitForFunction(() => window.__SOLUTION_AI__.voiceState().state === 'idle', null, { timeout: 3000 });
  const afterError = await stoppedFor();
  ok(afterError.tracksStopped, 'a failing session releases the microphone');
  ok(afterError.holo === 'idle', 'the hologram returns to idle after a failure');
  ok(/failed|unable/i.test(await rpage.evaluate(() => document.querySelector('[data-ai-note]').textContent)), 'the failure is reported to the user');

  // Text chat still works after a voice session (voice is additive).
  await rpage.fill('[data-ai-input]', 'Tell me something random about mountain trails');
  await rpage.click('[data-ai-send]');
  await rpage.waitForFunction(() => /Mocked AI reply/.test(document.querySelector('[data-ai-messages]').textContent), null, { timeout: 5000 });
  ok(true, 'text chat still works after using voice');
  ok(rerrors.filter((e) => /pageerror/.test(e)).length === 0, 'no uncaught page errors (real voice)');
  await rpage.screenshot({ path: path.join(OUT, 'ai-voice-states.png') });
  await rmctx.close();

  /* ---------------- Knowledge-only (backend up, no model configured) ---------------- */
  console.log('\nSOLUTION AI QA — knowledge-only mode\n');
  const kctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await kctx.addInitScript(setBase);
  const kpage = await kctx.newPage();
  const kerrors = [];
  kpage.on('pageerror', (e) => kerrors.push('pageerror: ' + e.message));
  kpage.on('console', (m) => { if (m.type() === 'error') kerrors.push('console: ' + m.text()); });
  const kc = await routeBackend(kpage, {
    providers: NONE_PROVIDERS,
    chat: chatBody({ mode: 'knowledge', reply: 'Knowledge reply from site content.', modelConfigured: false, provider: 'none', sources: [] })
  }, { post: 0 });
  await boot(kpage);
  await kpage.click('[data-ai-open]');
  await kpage.waitForSelector('[data-ai-panel].open', { timeout: 8000 });
  await kpage.waitForFunction(() => document.querySelector('[data-ai-status]').getAttribute('data-mode') === 'knowledge', null, { timeout: 4000 });
  ok(true, 'status shows knowledge mode when no model is configured');
  const kNote = await kpage.textContent('[data-ai-note]');
  ok(/server|AH_PROVIDER|model/i.test(kNote), 'knowledge mode shows an actionable setup hint', (kNote || '').slice(0, 60));
  await kpage.fill('[data-ai-input]', 'Tell me something random about clouds and weather');
  await kpage.click('[data-ai-send]');
  await kpage.waitForFunction(() => document.querySelectorAll('[data-ai-messages] .ai-msg--ai').length > 0, null, { timeout: 5000 });
  const ktext = await kpage.textContent('[data-ai-messages] .ai-msg--ai:last-child');
  ok(ktext && ktext.trim().length > 0, 'knowledge-only reply rendered');
  ok(kc.post === 0, 'knowledge-only mode made no chat request (no fabricated AI reply)');
  ok(kerrors.filter((e) => /pageerror/.test(e)).length === 0, 'no uncaught page errors (knowledge-only)');
  await kctx.close();

  /* ---------------- Backend unreachable (offline/error) ---------------- */
  console.log('\nSOLUTION AI QA — backend unreachable\n');
  const uctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await uctx.addInitScript(setBase);
  const upage = await uctx.newPage();
  const uerrors = [];
  upage.on('pageerror', (e) => uerrors.push('pageerror: ' + e.message));
  upage.on('console', (m) => { if (m.type() === 'error') uerrors.push('console: ' + m.text()); });
  await routeBackend(upage, { abort: true }, { post: 0 });
  await boot(upage);
  await upage.click('[data-ai-open]');
  await upage.waitForSelector('[data-ai-panel].open', { timeout: 8000 });
  await upage.waitForFunction(() => {
    const m = document.querySelector('[data-ai-status]').getAttribute('data-mode');
    return m === 'error' || m === 'offline';
  }, null, { timeout: 4000 });
  ok(true, 'status shows an honest unavailable state when the backend is down');
  await upage.fill('[data-ai-input]', 'Tell me something random about penguins in space');
  await upage.click('[data-ai-send]');
  await upage.waitForFunction(() => {
    const area = document.querySelector('[data-ai-messages]');
    return !!area.querySelector('.ai-msg--ai[data-ai-retry], .ai-msg--ai:last-child');
  }, null, { timeout: 6000 });
  ok(uerrors.filter((e) => /pageerror/.test(e)).length === 0, 'no uncaught page errors (unreachable)');
  await uctx.close();

  /* ---------------- Degraded (model configured but failing) ---------------- */
  console.log('\nSOLUTION AI QA — degraded model\n');
  const dctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await dctx.addInitScript(setBase);
  const dpage = await dctx.newPage();
  const derrors = [];
  dpage.on('pageerror', (e) => derrors.push('pageerror: ' + e.message));
  dpage.on('console', (m) => { if (m.type() === 'error') derrors.push('console: ' + m.text()); });
  await routeBackend(dpage, {
    providers: CLOUD_PROVIDERS,
    chat: chatBody({ mode: 'knowledge', degraded: true, reply: 'Site content answer while the model is down.', sources: [] })
  }, { post: 0 });
  await boot(dpage);
  await dpage.click('[data-ai-open]');
  await dpage.waitForSelector('[data-ai-panel].open', { timeout: 8000 });
  await dpage.waitForFunction(() => document.querySelector('[data-ai-status]').getAttribute('data-mode') === 'cloud', null, { timeout: 4000 });
  await dpage.fill('[data-ai-input]', 'Tell me something random about the deep ocean');
  await dpage.click('[data-ai-send]');
  await dpage.waitForFunction(() => /Site content answer/.test(document.querySelector('[data-ai-messages]').textContent), null, { timeout: 5000 });
  const dmode = await dpage.getAttribute('[data-ai-status]', 'data-mode');
  ok(dmode === 'error', 'a failing model downgrades the status to an honest error state', dmode);
  ok(derrors.filter((e) => /pageerror/.test(e)).length === 0, 'no uncaught page errors (degraded)');
  await dctx.close();

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
