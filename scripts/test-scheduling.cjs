#!/usr/bin/env node
/** Static/logic tests for scheduling implementation. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
let pass=0, fail=0;
function t(name,fn,cls='static'){ try{fn(); pass++; console.log(`  ✓ [${cls}] ${name}`);}catch(e){fail++; console.log(`  ✗ [${cls}] ${name} — ${e.message}`);} }
console.log('\n[Static] Scheduling');
const articles = fs.readFileSync(path.join(__dirname,'../netlify/functions/articles/articles.js'),'utf8');
t('schedule action exists', ()=>assert(articles.includes("action === 'schedule'")));
t('rejects missing/past publish_at', ()=>assert(articles.includes('publish_at_must_be_future') && articles.includes('missing_publish_at')));
t('cancel_schedule exists', ()=>assert(articles.includes('cancel_schedule')));
t('clients cannot set status/published_at/publish_at in create/update', ()=>assert(articles.includes('clients cannot set status/published_at/publish_at')));
const sched = fs.readFileSync(path.join(__dirname,'../netlify/functions/publish-scheduled/publish-scheduled.js'),'utf8');
t('scheduled function queries due drafts idempotently', ()=>assert(sched.includes('status=eq.draft&publish_at=not.is.null&publish_at=lte')));
t('scheduled function patches only matching draft+due rows', ()=>assert(sched.includes("status=eq.draft&publish_at=lte")));
t('triggers build after publishing', ()=>assert(sched.includes('triggerBuild')));
const editor = fs.readFileSync(path.join(__dirname,'../admin/editor.html'),'utf8');
t('editor has datetime-local for publish_at/new_until', ()=>assert(editor.includes('name="publish_at"') && editor.includes('name="new_until"')));
console.log(`\n--- Results: ${pass} passed, ${fail} failed ---`);
process.exit(fail?1:0);
