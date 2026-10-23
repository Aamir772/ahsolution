#!/usr/bin/node
/* ==========================================================================
   scripts/i18n-validate.cjs — AH Solution localization validator

   Canonical source: locales/en.json. Supported locales:
   en (source) + hi, es, fr, de, pt, ar, bn, ja.

   Checks:
   - JSON syntax and duplicate keys (raw scan; JSON.parse hides duplicates);
   - invalid / unsupported locale file names;
   - meta.locale, meta.sourceLocale, meta.dir, meta.langTag;
   - missing keys, unexpected keys, non-string values;
   - empty strings (null is allowed only while meta.complete=false);
   - {{placeholder}} integrity against the English source;
   - manifest status truthfulness and key/coverage counts;
   - accidental edits to canonical English strings via locales/en.lock.json.

   Usage:
     node scripts/i18n-validate.cjs                 # validate + refresh manifest
     node scripts/i18n-validate.cjs --update-lock   # accept current en.json as canonical

   Exit: 0 = valid (pending locales are reported, not fatal);
         2 = critical integrity problem.
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'locales');
const SOURCE = 'en';
const SOURCE_FILE = path.join(DIR, 'en.json');
const LOCK_FILE = path.join(DIR, 'en.lock.json');
const MANIFEST_FILE = path.join(DIR, 'manifest.json');
const UPDATE_LOCK = process.argv.includes('--update-lock');

const SUPPORTED = {
  en: { language: 'English', dir: 'ltr' },
  hi: { language: 'Hindi', dir: 'ltr' },
  es: { language: 'Spanish', dir: 'ltr' },
  fr: { language: 'French', dir: 'ltr' },
  de: { language: 'German', dir: 'ltr' },
  pt: { language: 'Portuguese', dir: 'ltr' },
  ar: { language: 'Arabic', dir: 'rtl' },
  bn: { language: 'Bengali', dir: 'ltr' },
  ja: { language: 'Japanese', dir: 'ltr' }
};

function flatten(obj, prefix, out) {
  out = out || {};
  prefix = prefix || '';
  for (const k of Object.keys(obj)) {
    if (!prefix && k === 'meta') continue;
    const v = obj[k];
    const key = prefix ? prefix + '.' + k : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}
function placeholders(text) {
  return (String(text == null ? '' : text).match(/\{\{\s*(\w+)\s*\}\}/g) || [])
    .map(s => s.replace(/[{}]/g, '').trim()).sort();
}
function hash(text) { return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex'); }
function rawDuplicateCheck(file) {
  /* Minimal JSON walker that reports duplicate keys scoped to their object.
     JSON.parse silently keeps the last duplicate, so this needs raw text. */
  const text = fs.readFileSync(file, 'utf8');
  const dups = [];
  let i = 0;
  function ws() { while (i < text.length && /\s/.test(text[i])) i++; }
  function str() {
    let out = '';
    i++; /* opening quote */
    while (i < text.length) {
      const c = text[i++];
      if (c === '\\') { out += text[i++]; continue; }
      if (c === '"') return out;
      out += c;
    }
    throw new Error('unterminated string');
  }
  function value(path) {
    ws();
    const c = text[i];
    if (c === '{') { obj(path); return; }
    if (c === '[') { arr(path); return; }
    if (c === '"') { str(); return; }
    while (i < text.length && !/[,\]}\s]/.test(text[i])) i++;
  }
  function obj(path) {
    const seen = new Set();
    i++; ws();
    if (text[i] === '}') { i++; return; }
    while (i < text.length) {
      ws();
      const key = str();
      const p = path ? path + '.' + key : key;
      if (seen.has(key)) dups.push(p);
      seen.add(key);
      ws();
      if (text[i] !== ':') throw new Error('expected :');
      i++;
      value(p);
      ws();
      if (text[i] === ',') { i++; continue; }
      if (text[i] === '}') { i++; return; }
      throw new Error('expected , or }');
    }
  }
  function arr(path) {
    i++; ws();
    if (text[i] === ']') { i++; return; }
    while (i < text.length) {
      value(path);
      ws();
      if (text[i] === ',') { i++; continue; }
      if (text[i] === ']') { i++; return; }
      throw new Error('expected , or ]');
    }
  }
  try { value(''); } catch (e) { return ['(raw scan failed: ' + e.message + ')']; }
  return dups;
}

if (!fs.existsSync(SOURCE_FILE)) { console.error('FATAL: canonical source missing: locales/en.json'); process.exit(2); }
let source;
try { source = JSON.parse(fs.readFileSync(SOURCE_FILE, 'utf8')); }
catch (e) { console.error('FATAL: locales/en.json does not parse: ' + e.message); process.exit(2); }

const sourceStrings = flatten(source);
const sourceKeys = Object.keys(sourceStrings).sort();
let fatal = 0;
const problems = [];
const report = [];

function note(locale, level, msg) {
  if (level === 'FATAL') { fatal++; problems.push(locale + ': ' + msg); }
  report.push('  ' + (level === 'FATAL' ? '✗' : level === 'WARN' ? '!' : '·') + ' ' + locale.padEnd(3) + ' ' + msg);
}

/* ---- canonical source integrity ---- */
const srcDupes = rawDuplicateCheck(SOURCE_FILE);
if (srcDupes.length) { fatal++; problems.push('en: duplicate keys: ' + srcDupes.join(', ')); report.push('  ✗ en  duplicate keys: ' + srcDupes.join(', ')); }
if (!source.meta || source.meta.locale !== 'en' || source.meta.sourceLocale !== 'en') {
  fatal++; problems.push('en: meta.locale/sourceLocale must be "en"'); report.push('  ✗ en  meta.locale/sourceLocale must be "en"');
}
if (source.meta && source.meta.dir !== 'ltr') { fatal++; problems.push('en: meta.dir must be ltr'); report.push('  ✗ en  meta.dir must be ltr'); }
for (const k of sourceKeys) {
  if (typeof sourceStrings[k] !== 'string') { fatal++; problems.push('en: non-string value at ' + k); report.push('  ✗ en  non-string value at ' + k); }
  else if (!sourceStrings[k].trim()) { fatal++; problems.push('en: empty canonical value at ' + k); report.push('  ✗ en  empty canonical value at ' + k); }
}

/* ---- canonical lock: detect accidental English edits ---- */
const currentHashes = {};
for (const k of sourceKeys) currentHashes[k] = hash(sourceStrings[k]);
if (UPDATE_LOCK) {
  fs.writeFileSync(LOCK_FILE, JSON.stringify({ sourceLocale: 'en', version: 1, keys: currentHashes }, null, 2) + '\n', 'utf8');
  console.log('Updated canonical lock: locales/en.lock.json');
} else if (fs.existsSync(LOCK_FILE)) {
  let lock;
  try { lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8')); } catch (e) { lock = null; }
  if (lock && lock.keys) {
    const changed = sourceKeys.filter(k => lock.keys[k] && lock.keys[k] !== currentHashes[k]);
    const removed = Object.keys(lock.keys).filter(k => !(k in currentHashes));
    const added = sourceKeys.filter(k => !lock.keys[k]);
    if (changed.length) { fatal++; problems.push('en: canonical strings changed: ' + changed.join(', ')); report.push('  ✗ en  canonical strings changed without --update-lock: ' + changed.slice(0, 8).join(', ') + (changed.length > 8 ? ' …' : '')); }
    if (removed.length) { fatal++; problems.push('en: canonical keys removed: ' + removed.join(', ')); report.push('  ✗ en  canonical keys removed: ' + removed.slice(0, 8).join(', ') + (removed.length > 8 ? ' …' : '')); }
    if (added.length) note('en', 'WARN', added.length + ' new canonical keys not yet in en.lock.json (run --update-lock after review)');
  }
} else {
  fs.writeFileSync(LOCK_FILE, JSON.stringify({ sourceLocale: 'en', version: 1, keys: currentHashes }, null, 2) + '\n', 'utf8');
  report.push('  · en  created canonical lock locales/en.lock.json');
}

/* ---- target locales ---- */
const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter(f => f.endsWith('.json') && f !== 'en.json' && f !== 'en.lock.json' && f !== 'manifest.json').sort() : [];
for (const f of files) {
  const code = f.replace(/\.json$/, '');
  if (!SUPPORTED[code]) {
    fatal++; problems.push(code + ': unsupported locale file');
    report.push('  ✗ ' + code + '  unsupported locale file (remove it or add it to SUPPORTED)');
    continue;
  }
  const file = path.join(DIR, f);
  const dupes = rawDuplicateCheck(file);
  if (dupes.length) { fatal++; problems.push(code + ': duplicate keys: ' + dupes.join(', ')); report.push('  ✗ ' + code + '  duplicate keys: ' + dupes.join(', ')); }

  let j;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { fatal++; problems.push(code + ': JSON parse error: ' + e.message); report.push('  ✗ ' + code + '  JSON parse error: ' + e.message); continue; }

  const meta = j.meta || {};
  const strings = flatten(j);
  const keys = Object.keys(strings);
  const missing = sourceKeys.filter(k => !(k in strings));
  const extra = keys.filter(k => !sourceKeys.includes(k));
  const pendingNulls = keys.filter(k => strings[k] === null);
  const empty = keys.filter(k => strings[k] !== null && (typeof strings[k] !== 'string' || !strings[k].trim()));
  const badType = keys.filter(k => strings[k] !== null && typeof strings[k] !== 'string');

  if (meta.locale !== code) { fatal++; problems.push(code + ': meta.locale mismatch'); report.push('  ✗ ' + code + '  meta.locale mismatch'); }
  if (meta.sourceLocale !== 'en') { fatal++; problems.push(code + ': meta.sourceLocale must be en'); report.push('  ✗ ' + code + '  meta.sourceLocale must be en'); }
  if (!meta.langTag) note(code, 'WARN', 'meta.langTag missing');
  if (meta.dir !== SUPPORTED[code].dir) { fatal++; problems.push(code + ': meta.dir must be ' + SUPPORTED[code].dir); report.push('  ✗ ' + code + '  meta.dir must be ' + SUPPORTED[code].dir); }
  if (missing.length) note(code, 'WARN', missing.length + ' missing keys (English fallback): ' + missing.slice(0, 5).join(', ') + (missing.length > 5 ? ' …' : ''));
  if (extra.length) { fatal++; problems.push(code + ': unexpected keys: ' + extra.join(', ')); report.push('  ✗ ' + code + '  unexpected keys: ' + extra.slice(0, 8).join(', ') + (extra.length > 8 ? ' …' : '')); }
  if (badType.length) { fatal++; problems.push(code + ': non-string values: ' + badType.join(', ')); report.push('  ✗ ' + code + '  non-string values: ' + badType.slice(0, 8).join(', ')); }
  if (empty.length) { fatal++; problems.push(code + ': empty strings: ' + empty.join(', ')); report.push('  ✗ ' + code + '  empty strings: ' + empty.slice(0, 8).join(', ') + (empty.length > 8 ? ' …' : '')); }

  for (const k of keys) {
    if (typeof strings[k] !== 'string') continue;
    const sp = placeholders(sourceStrings[k]).join(',');
    const tp = placeholders(strings[k]).join(',');
    if (sp !== tp) { fatal++; problems.push(code + ': placeholder mismatch in ' + k + ' (' + sp + ' vs ' + tp + ')'); report.push('  ✗ ' + code + '  placeholder mismatch in ' + k + ' (' + (sp || 'none') + ' vs ' + (tp || 'none') + ')'); }
  }

  const translated = sourceKeys.filter(k => typeof strings[k] === 'string' && strings[k].trim()).length;
  const fullyFilled = missing.length === 0 && empty.length === 0 && badType.length === 0 && translated === sourceKeys.length;
  const coverage = Math.round((translated / sourceKeys.length) * 100);
  if (meta.complete === true && !fullyFilled) { fatal++; problems.push(code + ': meta.complete=true but only ' + translated + '/' + sourceKeys.length + ' translated'); report.push('  ✗ ' + code + '  untruthful completeness claim'); }
  if (meta.complete !== true && fullyFilled) note(code, 'WARN', 'fully translated but meta.complete=false (promote it)');
  note(code, 'INFO', (meta.complete === true ? 'COMPLETE' : 'pending ') + ' ' + translated + '/' + sourceKeys.length + ' translated (' + coverage + '%)' + (pendingNulls.length ? ', ' + pendingNulls.length + ' null' : ''));
}

/* ---- supported locales that have no file yet ---- */
for (const code of Object.keys(SUPPORTED)) {
  if (code === 'en') continue;
  if (!fs.existsSync(path.join(DIR, code + '.json'))) { fatal++; problems.push(code + ': supported locale file missing'); report.push('  ✗ ' + code + '  supported locale file missing (run --scaffold)'); }
}

/* ---- manifest consistency ---- */
let manifest = null;
if (fs.existsSync(MANIFEST_FILE)) {
  try { manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8')); } catch (e) { manifest = null; }
}
const locales = { en: { language: 'English', dir: 'ltr', status: 'complete', keys: sourceKeys.length, translated: sourceKeys.length } };
for (const code of Object.keys(SUPPORTED).filter(c => c !== 'en')) {
  const file = path.join(DIR, code + '.json');
  if (!fs.existsSync(file)) continue;
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    const flat = flatten(j);
    const translated = sourceKeys.filter(k => typeof flat[k] === 'string' && flat[k].trim()).length;
    locales[code] = {
      language: SUPPORTED[code].language,
      dir: SUPPORTED[code].dir,
      status: j.meta && j.meta.complete === true && translated === sourceKeys.length ? 'complete' : 'pending',
      keys: sourceKeys.length,
      translated
    };
  } catch (e) { /* already reported */ }
}
const nextManifest = { sourceLocale: 'en', version: 1, generatedAt: new Date().toISOString(), locales, validation: { ok: fatal === 0, problems } };
if (!manifest || JSON.stringify(manifest.locales) !== JSON.stringify(locales) || JSON.stringify(manifest.validation && manifest.validation.problems) !== JSON.stringify(problems)) {
  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(nextManifest, null, 2) + '\n', 'utf8');
}

console.log('Localization validation');
console.log('  canonical: locales/en.json (' + sourceKeys.length + ' keys)');
report.forEach(line => console.log(line));
console.log(fatal ? 'FAILED: ' + fatal + ' critical problem(s)' : 'OK: dictionaries valid; pending locales fall back to English.');
process.exit(fatal ? 2 : 0);
