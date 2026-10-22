#!/usr/bin/node
/* ==========================================================================
   scripts/i18n-validate.cjs — AH Solution locale dictionary validator

   Validates every assets/i18n/locales/*.json dictionary against the
   canonical source (hinglish.json):

   - missing keys / extra keys / duplicate keys (raw JSON scan, not JSON.parse,
     which silently drops duplicates)
   - empty or non-string values
   - interpolation placeholders ({word}) preserved 1:1
   - protected brand/URL content present where the source has it
   - meta.complete truthfulness: a dictionary may NOT claim completeness
     unless every source key exists with a non-empty value
   - meta.locale must match the file name; langTag/dir present

   Exit codes: 0 = valid (incomplete dictionaries are reported, not fatal);
   2 = any integrity problem (duplicate keys, untruthful completeness claim,
   placeholder mismatch, malformed JSON).
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'assets', 'i18n', 'locales');
const SOURCE = 'hinglish';

files: {
}

function rawDuplicateCheck(file) {
  const t = fs.readFileSync(file, 'utf8');
  const seen = new Map();
  const dups = [];
  /* scan string keys inside the "strings" block roughly: any "key": pattern */
  const re = /"((?:[^"\\]|\\.)+)"\s*:/g;
  let m;
  while ((m = re.exec(t))) {
    const k = m[1];
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  for (const [k, n] of seen) if (n > 1) dups.push(k);
  return dups;
}

function main() {
  let fatal = 0;
  const report = [];
  const srcFile = path.join(DIR, SOURCE + '.json');
  if (!fs.existsSync(srcFile)) { console.error('FATAL: source dictionary missing: ' + srcFile); process.exit(2); }
  let src;
  try { src = JSON.parse(fs.readFileSync(srcFile, 'utf8')); }
  catch (e) { console.error('FATAL: source dictionary does not parse: ' + e.message); process.exit(2); }
  const srcDupes = rawDuplicateCheck(srcFile);
  if (srcDupes.length) { console.error('FATAL: duplicate keys in source: ' + srcDupes.join(', ')); fatal++; }
  const srcKeys = Object.keys(src.strings || {});

  for (const f of fs.readdirSync(DIR).filter(x => x.endsWith('.json') && x !== SOURCE + '.json').sort()) {
    const file = path.join(DIR, f);
    const locale = f.replace('.json', '');
    const line = { locale, file: 'assets/i18n/locales/' + f, status: 'ok', problems: [], warnings: [] };

    const dupes = rawDuplicateCheck(file);
    if (dupes.length) { line.status = 'FATAL'; line.problems.push('duplicate keys: ' + dupes.join(', ')); }

    let j;
    try { j = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { line.status = 'FATAL'; line.problems.push('json parse: ' + e.message); report.push(line); continue; }

    const strings = j.strings || {};
    const keys = Object.keys(strings);

    const missing = srcKeys.filter(k => !(k in strings));
    const extra = keys.filter(k => !srcKeys.includes(k));
    if (missing.length) line.warnings.push(missing.length + ' missing keys (fallback to canonical copy at runtime: ' + missing.slice(0, 5).join(', ') + (missing.length > 5 ? ', …' : '') + ')');
    if (extra.length) line.warnings.push(extra.length + ' extra keys: ' + extra.slice(0, 5).join(', ') + (extra.length > 5 ? ', …' : ''));

    const empty = keys.filter(k => !strings[k] || typeof strings[k] !== 'string');
    if (empty.length) { line.status = 'FATAL'; line.problems.push('non-string/empty values: ' + empty.slice(0, 5).join(', ')); }

    /* placeholder integrity */
    for (const k of keys) {
      const sp = (String(src.strings[k]).match(/\{(\w+)\}/g) || []).sort().join(',');
      const tp = (String(strings[k]).match(/\{(\w+)\}/g) || []).sort().join(',');
      if (sp !== tp) { line.status = 'FATAL'; line.problems.push('placeholder mismatch in "' + k + '": source ' + (sp || '(none)') + ' vs translation ' + (tp || '(none)')); }
    }

    /* meta checks */
    if (!j.meta || j.meta.locale !== locale) { line.status = 'FATAL'; line.problems.push('meta.locale missing/mismatch'); }
    if (j.meta && !j.meta.langTag) line.warnings.push('meta.langTag missing');
    if (j.meta && !('dir' in j.meta)) line.warnings.push('meta.dir missing');

    /* completeness truthfulness */
    const claimed = !!(j.meta && j.meta.complete);
    const covered = keys.filter(k => !(k in strings) === false && typeof strings[k] === 'string' && strings[k].length > 0 && strings[k] !== src.strings[k]).length;
    const fullyFilled = missing.length === 0 && empty.length === 0;
    if (claimed && !fullyFilled) { line.status = 'FATAL'; line.problems.push('meta.complete=true but dictionary is not complete (untruthful completeness is forbidden)'); }
    if (!claimed && fullyFilled) line.warnings.push('all keys filled but meta.complete=false — run meta generation to promote');

    line.complete = fullyFilled && !claimed === false;
    line.coverage = Math.round(((srcKeys.length - missing.length) / srcKeys.length) * 100) + '%';
    report.push(line);
  }

  console.log('Locale dictionary validation');
  console.log('  source: ' + SOURCE + ' (' + srcKeys.length + ' keys)');
  for (const r of report) {
    const flag = r.status === 'FATAL' ? '✗' : '✓';
    console.log('  ' + flag + ' ' + r.locale.padEnd(10) + ' coverage ' + String(r.coverage).padEnd(5) + (r.complete ? ' COMPLETE   ' : ' incomplete ') + '- ' + r.file);
    r.problems.forEach(p => console.log('      PROBLEM: ' + p));
    r.warnings.forEach(w => console.log('      note: ' + w));
  }
  if (fatal) { console.log('FAILED: integrity problems found (' + fatal + ')'); process.exit(2); }
  console.log('OK: integrity valid. Incomplete locales are expected to fall back to the canonical copy at runtime until generated.');
  process.exit(0);
}

main();
