/* ==========================================================================
   qa-lib.cjs — shared helpers for the local QA suites
   (playwright-core + the Chromium that ships with Playwright; no site deps)
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

function req(name) {
  try { return require(name); } catch (e) {}
  try { return require(path.join('C:/Users/haami/AppData/Local/Temp/ah-qa/node_modules', name)); } catch (e) {}
  throw new Error('Cannot load module: ' + name + ' (run: npm i -D playwright-core)');
}

function findChrome() {
  const bases = ['C:/Users/haami/AppData/Local/ms-playwright'];
  for (const base of bases) {
    try {
      const dirs = fs.readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort();
      if (dirs.length) {
        const p = path.join(base, dirs[dirs.length - 1], 'chrome-win64', 'chrome.exe');
        if (fs.existsSync(p)) return p;
      }
    } catch (e) {}
  }
  for (const p of ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe']) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function launcher() {
  const { chromium } = req('playwright-core');
  return (opts) => chromium.launch(Object.assign({
    headless: true,
    executablePath: findChrome() || undefined,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  }, opts || {}));
}

function counter() {
  const c = { pass: 0, fail: 0 };
  c.ok = (cond, name, extra) => {
    if (cond) { c.pass++; console.log('  \u2713 ' + name); }
    else { c.fail++; console.log('  \u2717 ' + name + (extra ? '  -> ' + extra : '')); }
  };
  c.done = (label) => {
    console.log('\n' + label + ': ' + c.pass + ' passed, ' + c.fail + ' failed');
    return c.fail;
  };
  return c;
}

const OUT = path.join('C:/Users/haami/AppData/Local/Temp/ah-qa/out');
try { fs.mkdirSync(OUT, { recursive: true }); } catch (e) {}

/* Fail loudly if the static server is not running on :8000 */
async function assertServer(base) {
  try {
    const r = await fetch(base.replace(/\/$/, '') + '/index.html');
    if (!r.ok) throw new Error('status ' + r.status);
  } catch (e) {
    throw new Error('No static server on ' + base + ' — start one first (npm start). ' + e.message);
  }
}

const waitBooted = (page, t) => page.waitForFunction(
  () => document.documentElement.classList.contains('booted'), null, { timeout: t || 12000 }
).catch(() => {});

const waitSettled = (page, t) => page.waitForFunction(
  () => document.documentElement.classList.contains('device-settled'), null, { timeout: t || 12000 }
).catch(() => {});

/* The monitor screen is the scroll root when the device frame is active */
async function scrollTo(page, fraction) {
  await page.evaluate((f) => {
    const s = document.querySelector('.device-screen');
    if (s && s.scrollHeight > s.clientHeight + 2) {
      s.scrollTop = Math.round((s.scrollHeight - s.clientHeight) * f);
    } else {
      window.scrollTo(0, Math.round((document.body.scrollHeight - window.innerHeight) * f));
    }
  }, fraction);
}

/**
 * The public CMS (assets/js/cms.js) probes /.netlify/functions/* which a plain
 * static server cannot serve. That single, expected resource-load failure is
 * not a site error; every other console error still fails QA.
 */
function isCmsProbeNoise(msg) {
  if (!msg || msg.type() !== 'error') return false;
  const text = msg.text() || '';
  const loc = (msg.location && msg.location()) || {};
  return /Failed to load resource/.test(text) && /\/\.netlify\/functions\//.test(text + ' ' + (loc.url || ''));
}

function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !isCmsProbeNoise(m)) errors.push('console: ' + m.text()); });
  return errors;
}

module.exports = { req, findChrome, launcher, counter, OUT, assertServer, waitBooted, waitSettled, scrollTo, collectErrors, isCmsProbeNoise };
