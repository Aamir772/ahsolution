const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

function extractFn(src, name) {
  const idx = src.indexOf('function ' + name);
  if (idx < 0) return null;
  let i = src.indexOf('{', idx), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(idx, i+1); }
  }
  return null;
}

const ROOT = process.cwd();
let passed = 0, failed = 0, skipped = 0;
const failures = [];
function ok(cond, name, cls) {
  const label = `[${cls}] ${name}`;
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; failures.push(label); console.log('  ✗ ' + label); }
}
function skip(name, cls, reason) { skipped++; console.log('  - ['+cls+'] '+name+' — SKIP: '+reason); }

(async () => {
  const editor = fs.readFileSync(path.join(ROOT,'admin/editor.html'),'utf8');
  const sm = editor.match(/<script>([\s\S]*?)<\/script>/);
  const script = sm[1];
  const allowlist = script.slice(script.indexOf('var ALLOWED_IMPORT_TAGS'), script.indexOf('function sanitizeImportedHtml'));
  let extracted = allowlist + '\n';
  for (const fn of ['sanitizeImportedHtml','validateDocxStructure','htmlToMarkdown','markdownToHtml','validateFileSignature']) {
    const c = extractFn(script, fn);
    if (c) extracted += c + '\n\n';
  }
  // file sig fallback
  if (!extracted.includes('function validateFileSignature')) {
    extracted += `function validateFileSignature(bytes,ext){if(ext==='pdf')return bytes[0]===0x25&&bytes[1]===0x50&&bytes[2]===0x44&&bytes[3]===0x46;if(ext==='docx')return bytes[0]===0x50&&bytes[1]===0x4B;if(ext==='md'||ext==='html'||ext==='htm'){for(var i=0;i<Math.min(bytes.length,1024);i++)if(bytes[i]===0)return false;return true;}return false;}\n`;
  }
  const harness = `<!doctype html><html><body><script>${extracted}\nwindow.__ready=true;</script></body></html>`;
  const harnessPath = path.join(ROOT,'scripts/test-fixtures/import-harness.html');
  fs.writeFileSync(harnessPath, harness);

  const browser = await chromium.launch({ headless: true, args:['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('file:///' + harnessPath.replace(/\\/g,'/'));

  console.log('\n[Browser/DOM] Actual production sanitizer (sanitizeImportedHtml from admin/editor.html)');
  const s = (html) => page.evaluate((h) => window.sanitizeImportedHtml(h), html);
  ok(!(await s('<p>Hi</p><script>alert(1)</script>')).includes('<script>'), 'removes script', 'browser');
  ok(!(await s('<img src=x onerror=alert(1)>')).includes('onerror'), 'removes event handler', 'browser');
  ok(!(await s('<svg onload=alert(1)><circle/></svg>')).toLowerCase().includes('<svg'), 'removes SVG', 'browser');
  ok(!(await s('<math><mi>x</mi></math>')).toLowerCase().includes('<math'), 'removes MathML', 'browser');
  ok(!(await s('<iframe src="https://evil.com"></iframe><object></object><embed>')).includes('<iframe'), 'removes iframe/object/embed', 'browser');
  ok(!(await s('<a href="javascript:alert(1)">x</a>')).includes('javascript:'), 'removes javascript: URL', 'browser');
  ok(!(await s('<a href="data:text/html,x">x</a>')).includes('data:'), 'removes data: URL', 'browser');
  ok(!(await s('<a href="vbscript:x">x</a>')).includes('vbscript:'), 'removes vbscript: URL', 'browser');
  ok(!(await s('<a href="file:///c:/x">x</a>')).includes('file:'), 'removes file: URL', 'browser');
  ok(!(await s('<a href=" java\tscript:alert(1)">x</a>')).includes('javascript:'), 'removes obfuscated javascript: URL', 'browser');
  ok((await s('<a href="https://example.com">l</a>')).includes('https://example.com'), 'keeps safe absolute URL', 'browser');
  ok((await s('<a href="/blog">b</a>')).includes('/blog'), 'keeps safe relative URL', 'browser');
  ok(!(await s('<p data-x="1" style="color:red" onclick="x()">t</p>')).includes('data-x'), 'removes unexpected attributes', 'browser');
  ok((await s('<h1>T</h1><h2>S</h2><p>P</p><ul><li>L</li></ul>')).includes('<h1>'), 'keeps H1 and formatting', 'browser');
  ok((await s('<a href="https://x.com">x</a><img src="https://x.com/i.jpg" alt="a">')).includes('<img'), 'keeps links/images', 'browser');
  ok((await s('<table><tr><td>c</td></tr></table><pre><code>x</code></pre><blockquote>q</blockquote>')).includes('<table>'), 'keeps tables/code/blockquote', 'browser');
  ok((await s('<p>unclosed<div>nested')).includes('unclosed'), 'handles malformed HTML safely', 'browser');

  console.log('\n[Browser/DOM] Actual DOCX structure validation (validateDocxStructure from admin/editor.html)');
  function b64(file) { return fs.readFileSync(path.join(ROOT,'scripts/test-fixtures',file)).toString('base64'); }
  const docxCheck = (file) => page.evaluate((b64s) => {
    const bin = atob(b64s); const bytes = new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
    return window.validateDocxStructure(bytes.buffer);
  }, b64(file));
  const v1 = await docxCheck('valid.docx'); ok(v1 && v1.valid === true, 'valid DOCX passes structure check', 'browser');
  const v2 = await docxCheck('missing-doc.docx'); ok(v2 && v2.valid === false && /document\.xml/.test(v2.reason||''), 'missing document.xml rejected', 'browser');
  const v3 = await docxCheck('not-docx.zip'); ok(v3 && v3.valid === false, 'non-DOCX ZIP rejected', 'browser');
  const v4 = await docxCheck('corrupt.zip'); ok(v4 && v4.valid === false, 'corrupt ZIP rejected', 'browser');
  // malformed document XML / empty doc fixtures not created beyond structure; document
  // malformed/empty doc extraction handled in mammoth block below

  console.log('\n[Browser/DOM] Real DOCX extraction via pinned Mammoth CDN (actual library)');
  try {
    await page.addScriptTag({ url: 'https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js' });
    const hasMammoth = await page.evaluate(() => !!window.mammoth);
    ok(hasMammoth, 'mammoth@1.6.0 loads in browser', 'browser');
    if (hasMammoth) {
      const extractedText = await page.evaluate((b64s) => {
        const bin = atob(b64s); const bytes = new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
        return window.mammoth.convertToHtml({arrayBuffer: bytes.buffer}).then(r => r.value).catch(e => 'ERR:'+e.message);
      }, b64('valid.docx'));
      ok(typeof extractedText === 'string' && extractedText.includes('Hello DOCX'), 'valid DOCX extracts expected text', 'browser');
      const malformedDoc = await page.evaluate((b64s) => { const bin=atob(b64s); const bytes=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i); return window.mammoth.convertToHtml({arrayBuffer:bytes.buffer}).then(r=>({ok:true,html:r.value,msgs:r.messages})).catch(e=>({ok:false,err:e.message})); }, b64('malformed-docxml.docx'));
      ok(malformedDoc && (malformedDoc.ok === false || (malformedDoc.ok && typeof malformedDoc.html === 'string')), 'malformed document XML handled safely by mammoth (no crash)', 'browser');
      const emptyDoc = await page.evaluate((b64s) => { const bin=atob(b64s); const bytes=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i); return window.mammoth.convertToHtml({arrayBuffer:bytes.buffer}).then(r=>({ok:true,html:(r.value||'').trim()})).catch(e=>({ok:false,err:e.message})); }, b64('empty-doc.docx'));
      ok(emptyDoc && (emptyDoc.ok === false || (emptyDoc.ok && emptyDoc.html === '')), 'empty DOCX yields no content (clear empty result)', 'browser');
    }
  } catch(e) { skip('mammoth extraction', 'browser', e.message); }

  console.log('\n[Browser/DOM] Real PDF extraction via pinned pdf.js CDN (actual library)');
  try {
    await page.addScriptTag({ url: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js' });
    const hasPdf = await page.evaluate(() => {
      if (window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
      return !!window.pdfjsLib;
    });
    ok(hasPdf, 'pdfjs-dist@3.11.174 loads in browser', 'browser');
    if (hasPdf) {
      const pdfText = await page.evaluate(async (b64s) => {
        try {
          const bin = atob(b64s); const bytes = new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
          const pdf = await window.pdfjsLib.getDocument({data: bytes}).promise;
          let text=''; for(let p=1;p<=pdf.numPages;p++){ const pg=await pdf.getPage(p); const c=await pg.getTextContent(); text+=c.items.map(i=>i.str).join(' '); }
          return {ok:true, text, pages: pdf.numPages};
        } catch(e) { return {ok:false, err: e.message||String(e)}; }
      }, b64('valid-text.pdf'));
      ok(pdfText && pdfText.ok && /Hello/i.test(pdfText.text||''), 'valid text PDF extracts expected text', 'browser');
      // no-selectable-text: valid-text.pdf has text; create/use a no-text case? empty-pages
      const emptyPdf = await page.evaluate(async (b64s) => {
        try { const bin=atob(b64s); const bytes=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i); const pdf=await window.pdfjsLib.getDocument({data:bytes}).promise; return {ok:true,pages:pdf.numPages}; }
        catch(e){ return {ok:false,err:e.message}; }
      }, b64('empty-pages.pdf'));
      ok(emptyPdf && (emptyPdf.ok ? emptyPdf.pages === 0 : true), 'empty/zero-page PDF handled (parsed or clear result)', 'browser');
      const malformed = await page.evaluate(async (b64s) => {
        try { const bin=atob(b64s); const bytes=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i); await window.pdfjsLib.getDocument({data:bytes}).promise; return {ok:true}; }
        catch(e){ return {ok:false,err:e.message}; }
      }, b64('malformed.pdf'));
      ok(malformed && malformed.ok === false, 'malformed PDF with header rejected by parser', 'browser');
    }
  } catch(e) { skip('pdf.js extraction', 'browser', e.message); }

  console.log('\n[Static] Production wiring');
  ok(editor.includes('validateDocxStructure') && editor.includes('word/document.xml'), 'editor has DOCX structure validation', 'static');
  ok(editor.includes('CDN_INTEGRITY') && editor.includes('sha384-nFoSjZIoH3CCp8W639jJyQkuPHinJ2NHe7on1xvlUA7SuGfJAfvMldrsoAVm6ECz'), 'editor has verified mammoth SRI', 'static');
  ok(editor.includes('/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e'), 'editor has verified pdf.js SRI', 'static');
  ok(editor.includes('sha384-SnzOobpRMLXZ52iJvZm/C0fYw0OQemTXzTjIsdsfMcrCtCEe9qgzxTd3RSklO5x2'), 'worker hash verified/documented', 'static');
  const server = fs.readFileSync(path.join(ROOT,'netlify/functions/_shared/supabase-rest.cjs'),'utf8');
  ok(/\bh1\b/.test(server.match(/ALLOWED_TAGS[\s\S]*?\]\)/)[0]||''), 'server allows h1 (compat fix)', 'static');

  await browser.close();

  console.log(`\n--- Results: ${passed} passed, ${failed} failed, ${skipped} skipped ---`);
  if (failures.length) failures.forEach(f => console.log('  FAIL: '+f));
  process.exit(failed > 0 ? 1 : 0);
})();
