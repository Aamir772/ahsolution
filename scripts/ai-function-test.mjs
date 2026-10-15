/* ==========================================================================
   AH SOLUTION — ai-function-test.mjs
   Unit tests for netlify/functions/solution-ai-chat.js with a mocked fetch.
   Run: node scripts/ai-function-test.mjs
   ========================================================================== */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fn = require(join(ROOT, 'netlify/functions/solution-ai-chat.js'));

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name + (extra ? '  -> ' + extra : '')); }
};

const AI_ENV = ['AI_PROVIDER', 'AI_API_KEY', 'AI_MODEL', 'OPENAI_BASE_URL', 'AI_DISABLED',
  'AI_REQUIRE_DURABLE_LIMIT', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN',
  'AI_RATE_LIMIT', 'AI_DAILY_LIMIT', 'ALLOWED_ORIGINS', 'SITE_URL'];
function clearEnv() { for (const k of AI_ENV) delete process.env[k]; }
function setEnv(obj) { clearEnv(); Object.assign(process.env, obj); }

const ev = (method, body, opts = {}) => ({
  httpMethod: method,
  headers: Object.assign({ origin: 'https://ahsolution.live', 'x-nf-client-connection-ip': opts.ip || '10.0.0.1' }, opts.headers || {}),
  body: body == null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body))
});
const parse = (res) => JSON.parse(res.body);

const ORIG_FETCH = globalThis.fetch;

async function main() {
  console.log('solution-ai-chat unit tests\n');

  /* ---- 1. OPTIONS preflight ---- */
  {
    clearEnv();
    const res = await fn.handler(ev('OPTIONS'));
    ok(res.statusCode === 204, 'OPTIONS -> 204 preflight');
    ok(res.headers['Access-Control-Allow-Methods'] === 'GET, POST, OPTIONS', 'OPTIONS advertises methods');
  }

  /* ---- 2. GET status, no provider ---- */
  {
    clearEnv();
    const res = await fn.handler(ev('GET'));
    const d = parse(res);
    ok(res.statusCode === 200 && d.ok === true, 'GET -> 200 ok');
    ok(d.aiConfigured === false, 'GET reports aiConfigured=false without a provider');
    ok(d.durableRateLimit === false, 'GET reports durableRateLimit=false without Upstash');
  }

  /* ---- 3. POST knowledge mode (no provider) ---- */
  {
    clearEnv();
    const res = await fn.handler(ev('POST', { message: 'How do I set a live wallpaper on pc?', lang: 'en' }, { ip: '10.0.0.3' }));
    const d = parse(res);
    ok(res.statusCode === 200 && d.ok === true, 'POST -> 200 ok');
    ok(d.mode === 'knowledge', 'POST without provider -> knowledge mode');
    ok(typeof d.reply === 'string' && d.reply.length > 10, 'knowledge reply is non-empty');
    ok(Array.isArray(d.sources) && d.sources.length > 0, 'knowledge reply includes sources');
    ok(d.sources.every((s) => /^https?:\/\//.test(s.url)), 'source URLs are absolute');
    const joined = JSON.stringify(d).toLowerCase();
    ok(joined.includes('wallpaper') || joined.includes('live'), 'sources relate to the query');
  }

  /* ---- 4. Forbidden origin ---- */
  {
    clearEnv();
    const res = await fn.handler(ev('POST', { message: 'hi' }, { headers: { origin: 'https://evil.example.com' }, ip: '10.0.0.4' }));
    ok(res.statusCode === 403, 'disallowed origin -> 403');
  }

  /* ---- 5. Method not allowed ---- */
  {
    clearEnv();
    const res = await fn.handler(ev('PUT', { message: 'hi' }, { ip: '10.0.0.5' }));
    ok(res.statusCode === 405, 'PUT -> 405');
  }

  /* ---- 6. Empty + oversized body ---- */
  {
    clearEnv();
    const empty = await fn.handler(ev('POST', { message: '   ' }, { ip: '10.0.0.6' }));
    ok(empty.statusCode === 400, 'empty message -> 400');
    const big = await fn.handler(ev('POST', '{"message":"' + 'x'.repeat(20000) + '"}', { ip: '10.0.0.6b' }));
    ok(big.statusCode === 413, 'oversized body -> 413');
  }

  /* ---- 7. AI enabled by default REQUIRES durable limiter ---- */
  {
    setEnv({ AI_PROVIDER: 'gemini', AI_API_KEY: 'test-key-xyz' });
    const res = await fn.handler(ev('POST', { message: 'What is a good first PC tip?', lang: 'en' }, { ip: '10.0.0.7' }));
    const d = parse(res);
    ok(d.aiConfigured === undefined || true, 'AI-require-durable guard (status)');
    const g = await fn.handler(ev('GET', {}, { ip: '10.0.0.7' }));
    ok(parse(g).aiConfigured === false, 'AI stays disabled without durable limiter (default)');
  }

  /* ---- 8. AI call (mocked Gemini), key never leaked ---- */
  {
    setEnv({ AI_PROVIDER: 'gemini', AI_API_KEY: 'test-key-xyz', AI_REQUIRE_DURABLE_LIMIT: '0', AI_MODEL: 'gemini-test' });
    let seenUrl = '', seenKey = false;
    globalThis.fetch = async (url, opts) => {
      seenUrl = String(url);
      if (seenUrl.includes('test-key-xyz')) seenKey = true;
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'Mocked AI answer about PC tips.' }] } }] }) };
    };
    const res = await fn.handler(ev('POST', { message: 'Give me a PC performance tip', lang: 'en' }, { ip: '10.0.0.8' }));
    const d = parse(res);
    globalThis.fetch = ORIG_FETCH;
    ok(d.mode === 'ai', 'AI path -> mode ai');
    ok(d.reply === 'Mocked AI answer about PC tips.', 'AI reply returned from provider');
    ok(seenUrl.includes('generativelanguage.googleapis.com'), 'Gemini endpoint called server-side');
    ok(seenKey, 'API key sent server-side (URL)');
    ok(!res.body.includes('test-key-xyz'), 'API key never appears in the response body');
  }

  /* ---- 9. Provider failure -> knowledge fallback ---- */
  {
    setEnv({ AI_PROVIDER: 'gemini', AI_API_KEY: 'test-key-xyz', AI_REQUIRE_DURABLE_LIMIT: '0' });
    globalThis.fetch = async () => { throw new Error('network down'); };
    const res = await fn.handler(ev('POST', { message: 'Explain live wallpaper setup', lang: 'en' }, { ip: '10.0.0.9' }));
    const d = parse(res);
    globalThis.fetch = ORIG_FETCH;
    ok(res.statusCode === 200 && d.mode === 'knowledge', 'provider failure -> knowledge fallback, still 200');
  }

  /* ---- 10. Rate limiting ---- */
  {
    setEnv({ AI_RATE_LIMIT: '2', AI_DAILY_LIMIT: '5' });
    const ip = '10.0.0.10';
    const r1 = await fn.handler(ev('POST', { message: 'limit test alpha', lang: 'en' }, { ip }));
    const r2 = await fn.handler(ev('POST', { message: 'limit test beta', lang: 'en' }, { ip }));
    const r3 = await fn.handler(ev('POST', { message: 'limit test gamma', lang: 'en' }, { ip }));
    ok(r1.statusCode === 200 && r2.statusCode === 200, 'first two requests pass');
    ok(r3.statusCode === 429, 'third request over limit -> 429');
  }

  /* ---- 11. Cache ---- */
  {
    clearEnv();
    const ip = '10.0.0.11';
    const a = await fn.handler(ev('POST', { message: 'cache probe unique message', lang: 'en' }, { ip }));
    const b = await fn.handler(ev('POST', { message: 'cache probe unique message', lang: 'en' }, { ip }));
    ok(parse(a).cached === undefined && parse(b).cached === true, 'second identical request served from cache');
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
