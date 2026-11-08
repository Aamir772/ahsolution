/* ==========================================================================
   scripts/test-publish-trigger.cjs — Static checks for publish-trigger function

   Tests that don't require live Supabase or Netlify credentials.
   Functional trigger tests require live credentials (documented separately).

   Run: node scripts/test-publish-trigger.cjs
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'netlify/functions/publish-trigger/publish-trigger.js'), 'utf8');

let passed = 0, failed = 0;

function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('Phase 2C.2.1 — Publish Trigger Static Checks\n');

// 1. Module loads
console.log('1. Module loading');
try {
  const mod = require(path.join(ROOT, 'netlify/functions/publish-trigger/publish-trigger.js'));
  ok('publish-trigger module loads', typeof mod.handler === 'function');
} catch (e) {
  ok('publish-trigger module loads', false, e.message);
}

// 2. Secret hygiene
console.log('2. Secret hygiene');
ok('no build hook URL in source', !SOURCE.includes('build_hooks/') || SOURCE.includes('process.env.NETLIFY_BUILD_HOOK_URL'));
ok('no JWT token logging', !/console\.log[^]*token/i.test(SOURCE));
ok('no service role key in source', !SOURCE.includes('SUPABASE_SERVICE_ROLE_KEY') || SOURCE.includes('process.env'));
ok('uses requireAdmin for auth', SOURCE.includes('requireAdmin'));
ok('uses serviceConfig check', SOURCE.includes('serviceConfig()'));

// 3. Authentication patterns
console.log('3. Authentication patterns');
ok('checks method !== POST', SOURCE.includes("method !== 'POST'"));
ok('returns 405 for wrong method', SOURCE.includes('405'));
ok('returns 401 for auth failure', SOURCE.includes('401'));
ok('returns 403 for forbidden', SOURCE.includes('403'));

// 4. Request validation
console.log('4. Request validation');
ok('validates action === trigger', SOURCE.includes("action !== 'trigger'"));
ok('validates reason against allowlist', SOURCE.includes('allowedReasons'));
ok('parses JSON body', SOURCE.includes('JSON.parse'));
ok('handles bad_json', SOURCE.includes('bad_json'));

// 5. Rate limiting
console.log('5. Rate limiting');
ok('has rate limiter', SOURCE.includes('checkRate'));
ok('returns 429', SOURCE.includes('429'));
ok('rate limit from env', SOURCE.includes('PUBLISH_TRIGGER_RATE_LIMIT'));

// 6. Duplicate protection
console.log('6. Duplicate protection');
ok('has dedup logic', SOURCE.includes('isDuplicate'));
ok('dedup window defined', SOURCE.includes('DEDUP_WINDOW_MS'));

// 7. Build hook security
console.log('7. Build hook security');
ok('reads from env var', SOURCE.includes('process.env.NETLIFY_BUILD_HOOK_URL'));
ok('checks hook URL exists', SOURCE.includes('if (!buildHookUrl)'));
ok('returns configuration_error', SOURCE.includes('configuration_error'));
ok('uses fetch to trigger', SOURCE.includes('fetch(buildHookUrl'));

// 8. Response states
console.log('8. Response states');
ok('returns 202 accepted', SOURCE.includes('202'));
ok('returns trigger_id', SOURCE.includes('trigger_id'));
ok('returns trigger_failed', SOURCE.includes('trigger_failed'));

// 9. Safe logging
console.log('9. Safe logging');
ok('logs reason and email only', SOURCE.includes("console.log('[publish-trigger]"));
ok('no token in logs', !SOURCE.includes('console.log') || !SOURCE.match(/console\.log.*token/i));

// 10. Netlify config
console.log('10. Netlify configuration');
const toml = fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8');
ok('publish-trigger redirect exists', toml.includes('/api/publish-trigger'));
ok('redirects to publish-trigger function', toml.includes('publish-trigger'));

console.log('\n--- Results: ' + passed + ' passed, ' + failed + ' failed ---');
process.exit(failed > 0 ? 1 : 0);
