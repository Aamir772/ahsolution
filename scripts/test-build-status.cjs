#!/usr/bin/env node
/** Static tests for build trigger/status behavior. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
let pass=0, fail=0;
function t(name,fn){ try{fn(); pass++; console.log('  ✓ [static] '+name);}catch(e){fail++; console.log('  ✗ [static] '+name+' — '+e.message);} }
const src = fs.readFileSync(path.join(__dirname,'../netlify/functions/publish-trigger/publish-trigger.js'),'utf8');
console.log('\n[Static] Build trigger');
t('returns 202 accepted (not deployed)', ()=>assert(src.includes('statusCode, 202') || src.includes("json(event, 202")));
t('message states asynchronous completion', ()=>assert(src.includes('asynchronously')));
t('requires admin auth', ()=>assert(src.includes('requireAdmin')));
t('uses server-side NETLIFY_BUILD_HOOK_URL', ()=>assert(src.includes('process.env.NETLIFY_BUILD_HOOK_URL')));
t('has dedup protection', ()=>assert(src.includes('isDuplicate') || src.includes('DEDUP')));
t('does not expose hook URL in response', ()=>assert(!src.includes('buildHookUrl') || !src.includes('return json(event, 202, { ok:true, hook:')));
console.log(`\n--- Results: ${pass} passed, ${fail} failed ---`);
process.exit(fail?1:0);
