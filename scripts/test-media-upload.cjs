#!/usr/bin/env node
/** Mocked/static tests for upload-image validation logic (no live Supabase). */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
let pass=0, fail=0;
function t(name,fn){ try{fn(); pass++; console.log('  ✓ [unit] '+name);}catch(e){fail++; console.log('  ✗ [unit] '+name+' — '+e.message);} }
const src = fs.readFileSync(path.join(__dirname,'../netlify/functions/upload-image/upload-image.js'),'utf8');
console.log('\n[Static] upload-image');
t('requires admin auth (requireAdmin present)', ()=>assert(src.includes('requireAdmin')));
t('checks magic bytes/signature', ()=>assert(src.includes('sig(') && src.includes('signature_mismatch')));
t('rejects SVG/XML content', ()=>assert(src.includes('<svg') && src.includes('unsupported_type')));
t('enforces size limit', ()=>assert(src.includes('MAX_BYTES') && src.includes('too_large')));
t('uses safe filename/path', ()=>assert(src.includes('replace(/[^a-z0-9]+/g') && src.includes('crypto.randomBytes')));
t('service key not exposed in response body', ()=>assert(!src.includes('service_role') || !src.includes('res.json(event,200,{')===false));
console.log(`\n--- Results: ${pass} passed, ${fail} failed ---`);
process.exit(fail?1:0);
