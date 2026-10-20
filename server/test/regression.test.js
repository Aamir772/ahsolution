'use strict';
/* ==========================================================================
   Regression guard: the assistant backend must not disturb the existing site.

   This is a fast, static safety net (files present + key markers intact). The
   full browser suites (qa:device / qa:pages / qa:admin / qa:scroll / qa:ai)
   remain the authoritative visual/behavioural checks and are run separately.
   ========================================================================== */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

test('existing site entry points still exist', () => {
  for (const f of ['index.html', 'blog.html', 'tutorials.html', 'vlogs.html', 'sitemap.xml', 'robots.txt', 'netlify.toml', '.env.example']) {
    assert.ok(exists(f), `${f} missing`);
  }
});

test('the V2.2 holographic core and AI client are intact', () => {
  for (const f of ['assets/js/globe.js', 'assets/js/ai.js', 'assets/js/main.js', 'assets/js/cms.js', 'assets/vendor/three.module.min.js']) {
    assert.ok(exists(f), `${f} missing`);
  }
  const globe = read('assets/js/globe.js');
  assert.match(globe, /data-hero-core|hero-core/, 'hero core selector');
  assert.match(globe, /getContext\(['"]2d['"]\)/, '2D fallback preserved');
  assert.match(globe, /three\.module\.min\.js/, 'vendored three import preserved');
  const html = read('index.html');
  assert.match(html, /data-hero-core/);
  assert.match(html, /data-ai-panel/);
  assert.match(html, /assets\/js\/globe\.js/);
});

test('existing netlify functions are untouched', () => {
  for (const f of [
    'netlify/functions/solution-ai-chat.js',
    'netlify/functions/admin-auth/admin-auth.js',
    'netlify/functions/_shared/supabase-rest.cjs'
  ]) assert.ok(exists(f), `${f} missing`);
});

test('package.json keeps its existing scripts and identity', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.name, 'ah-solution');
  for (const s of ['start', 'test:ai', 'qa:ai', 'qa:device', 'qa:pages', 'qa:admin']) {
    assert.ok(pkg.scripts[s], `script "${s}" was removed`);
  }
});

test('the assistant backend is isolated under server/', () => {
  assert.ok(exists('server/index.js'));
  const netlifyToml = read('netlify.toml');
  // The assistant must not hijack the site build/publish.
  assert.match(netlifyToml, /publish\s*=\s*"\."/);
});
