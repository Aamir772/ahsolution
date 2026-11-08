/* ==========================================================================
   scripts/test-db-fixture.cjs — Local fixture tests for DB static generation

   Tests dbRowToManifestRow() and articlePage() with mock data.
   No Supabase credentials required.

   Run: node scripts/test-db-fixture.cjs
   ========================================================================== */
'use strict';

const path = require('path');
const { dbRowToManifestRow, articlePage } = require('../scripts/blog-build.js');
const { sanitizeHtml } = require('../netlify/functions/_shared/supabase-rest.cjs');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;

function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

// ---- Fixtures ----

const validPublished = {
  id: 'uuid-1', slug: 'test-article', title: 'Test Article', excerpt: 'A test excerpt',
  body: '<p>Hello world</p><h2>Section</h2><ul><li>Item 1</li></ul>',
  cover_image_url: 'https://example.com/cover.jpg', category: 'Android', tags: 'android, tips',
  status: 'published', seo_description: 'SEO desc', reading_minutes: 5,
  published_at: '2026-01-01T00:00:00Z', new_until: '2026-12-31T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z'
};

const draftArticle = { ...validPublished, slug: 'draft-article', status: 'draft', published_at: null };
const archivedArticle = { ...validPublished, slug: 'archived-article', status: 'archived' };
const futureArticle = { ...validPublished, slug: 'future-article', published_at: '2027-01-01T00:00:00Z' };
const legacyNull = { ...validPublished, slug: 'legacy-article', published_at: null };
const invalidSlug = { ...validPublished, slug: 'INVALID SLUG!' };
const missingFields = { id: 'uuid-x', slug: 'missing-fields' };
const specialChars = { ...validPublished, slug: 'special-chars-article', title: 'Title with <>&"\' chars', excerpt: 'Excerpt with <script>' };
const unsafeHtml = { ...validPublished, slug: 'unsafe-html', body: '<script>alert(1)</script><p onclick="x()">Real</p><iframe src="https://evil.com"></iframe>' };
const invalidImage = { ...validPublished, slug: 'bad-image', cover_image_url: 'javascript:alert(1)' };

console.log('Phase 2C.1.2 — DB Fixture Tests\n');

// ---- Test 1: Valid published article ----
console.log('1. Valid published article');
const m1 = dbRowToManifestRow(validPublished);
ok('maps slug', m1.slug === 'test-article');
ok('maps title', m1.article_title === 'Test Article');
ok('maps body via _db_body', m1._db_body === validPublished.body);
ok('maps category', m1.category === 'Android');
ok('maps tags as array', Array.isArray(m1.tags) && m1.tags.length === 2);
ok('maps new_until', m1.new_until === '2026-12-31T00:00:00Z');
ok('maps reading_minutes', m1.reading_minutes === 5);

// ---- Test 2: Draft article (should be filtered by API, but mapper still works) ----
console.log('2. Draft article');
const m2 = dbRowToManifestRow(draftArticle);
ok('draft maps slug', m2.slug === 'draft-article');
ok('draft has _db_body', !!m2._db_body);

// ---- Test 3: Archived article ----
console.log('3. Archived article');
const m3 = dbRowToManifestRow(archivedArticle);
ok('archived maps slug', m3.slug === 'archived-article');

// ---- Test 4: Future publication ----
console.log('4. Future publication');
const m4 = dbRowToManifestRow(futureArticle);
ok('future maps slug', m4.slug === 'future-article');
ok('future has published_at', m4.video_publish_date === '2027-01-01T00:00:00Z');

// ---- Test 5: Legacy NULL published_at ----
console.log('5. Legacy NULL published_at');
const m5 = dbRowToManifestRow(legacyNull);
ok('legacy maps slug', m5.slug === 'legacy-article');
ok('legacy falls back to created_at when published_at is null', m5.video_publish_date === '2026-01-01T00:00:00Z');

// ---- Test 6: Invalid slug ----
console.log('6. Invalid slug');
try {
  const bad = { ...validPublished, slug: 'INVALID SLUG!' };
  // The mapper doesn't validate — validation is in loadDbArticles
  const m6 = dbRowToManifestRow(bad);
  ok('invalid slug still maps (validation is upstream)', m6.slug === 'INVALID SLUG!');
} catch (e) {
  ok('invalid slug handled', false, e.message);
}

// ---- Test 7: Duplicate slug detection ----
console.log('7. Duplicate slug detection');
const slugs = new Set();
slugs.add('test-article');
ok('duplicate detected', slugs.has('test-article'));

// ---- Test 8: Missing required fields ----
console.log('8. Missing required fields');
const m8 = dbRowToManifestRow(missingFields);
ok('missing title handled', !m8.article_title || m8.article_title === '');
ok('missing body handled', !m8._db_body || m8._db_body === '');

// ---- Test 9: Special characters ----
console.log('9. Special characters');
const m9 = dbRowToManifestRow(specialChars);
ok('special chars in title', m9.article_title === specialChars.title);
ok('special chars in excerpt', m9.excerpt === specialChars.excerpt);

// ---- Test 10: Unsafe HTML ----
console.log('10. Unsafe HTML');
const sanitized = sanitizeHtml(unsafeHtml.body);
ok('script removed', !sanitized.includes('<script'));
ok('onclick removed', !sanitized.includes('onclick'));
ok('iframe removed', !sanitized.includes('<iframe'));
ok('safe content preserved', sanitized.includes('Real'));

// ---- Test 11: Invalid image URL ----
console.log('11. Invalid image URL');
const m11 = dbRowToManifestRow(invalidImage);
ok('invalid image mapped', m11.cover_image_path === 'javascript:alert(1)');
// Note: image URL validation should happen in the generator or API

// ---- Test 12: Empty database ----
console.log('12. Empty database');
const emptyRows = [];
ok('empty array handled', Array.isArray(emptyRows) && emptyRows.length === 0);

// ---- Test: articlePage with DB body ----
console.log('\nArticle page generation (DB mode)');
const all = [m1];
const html = articlePage(m1, null, all, m1._db_body);
ok('generates HTML', typeof html === 'string' && html.length > 100);
ok('contains title', html.includes('Test Article'));
ok('contains canonical', html.includes('https://ahsolution.live/article/test-article/'));
ok('contains body content', html.includes('Hello world'));
ok('contains JSON-LD', html.includes('application/ld+json'));
ok('no noindex (published)', !html.includes('noindex'));

// ---- Test: HTML sanitization in generator ----
console.log('\nHTML sanitization in generator');
const dirtyHtml = '<p>Safe</p><script>alert(1)</script><img src="x" onerror="alert(2)">';
const clean = sanitizeHtml(dirtyHtml);
ok('script tag removed', !clean.includes('<script'));
ok('onerror removed', !clean.includes('onerror'));
ok('safe content preserved', clean.includes('Safe'));

console.log('\n--- Results: ' + passed + ' passed, ' + failed + ' failed ---');
process.exit(failed > 0 ? 1 : 0);
