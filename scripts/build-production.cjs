/* ==========================================================================
   scripts/build-production.cjs — Production build pipeline

   Runs all mandatory build steps in sequence. Exits with non-zero code
   if any step fails. Used as the Netlify build command.

   Steps:
     1. build-ai-index.mjs  (AI search index)
     2. blog-build.js       (static article pages + blog cards + sitemap)
     3. generate-rss.js     (RSS/Atom feed)

   Environment:
     BLOG_SOURCE  — 'manifest' (default) or 'db'
     ALLOW_EMPTY  — '1' to allow empty DB results (default: 0)

   Run: node scripts/build-production.cjs
   ========================================================================== */
'use strict';

const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const steps = [
  { name: 'AI index', cmd: 'node scripts/build-ai-index.mjs' },
  { name: 'Blog build', cmd: 'node scripts/blog-build.js' + (process.env.BLOG_SOURCE === 'db' ? ' --source=db' : '') + (process.env.ALLOW_EMPTY === '1' ? ' --allow-empty' : '') },
  { name: 'RSS feed', cmd: 'node scripts/generate-rss.js' + (process.env.BLOG_SOURCE === 'db' ? ' --source=db' : '') }
];

let failed = false;
for (const step of steps) {
  console.log('\n=== ' + step.name + ' ===');
  try {
    execSync(step.cmd, { cwd: ROOT, stdio: 'inherit' });
    console.log('✓ ' + step.name + ' completed');
  } catch (e) {
    console.error('✗ ' + step.name + ' FAILED');
    failed = true;
    break;
  }
}

if (failed) {
  console.error('\nBuild FAILED. Deployment will not proceed.');
  process.exit(1);
}

console.log('\nAll build steps completed successfully.');
process.exit(0);
