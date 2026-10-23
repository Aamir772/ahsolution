/* ==========================================================================
   scripts/test-videos-sync.cjs
   Tests for the hourly YouTube sync pipeline (no network, no real Upstash).

   Run: npm run test:videos
   ========================================================================== */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const data = new Map();
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    let commands = [];
    try { commands = JSON.parse(raw || '[]'); } catch (e) { /* ignore */ }
    const out = (Array.isArray(commands) ? commands : []).map((entry) => {
      const [cmd, ...args] = entry;
      const c = String(cmd).toUpperCase();
      if (c === 'GET') return { result: data.has(args[0]) ? data.get(args[0]) : null };
      if (c === 'SET') {
        const [key, value, ...flags] = args;
        if (flags.map((f) => String(f).toUpperCase()).includes('NX') && data.has(key)) return { result: null };
        data.set(key, String(value));
        return { result: 'OK' };
      }
      if (c === 'DEL') return { result: data.delete(args[0]) ? 1 : 0 };
      if (c === 'EVAL') {
        const key = args[2];
        const token = args[3];
        if (data.get(key) === token) { data.delete(key); return { result: 1 }; }
        return { result: 0 };
      }
      return { result: null };
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(out));
  });
});

let base = '';
let feed;
let store;
let refresh;
let fresh;

function rss(ids) {
  const entries = ids.map((id, i) => (
    '<entry>' +
    '<yt:videoId>' + id + '</yt:videoId>' +
    '<title>Video ' + id + '</title>' +
    '<link rel="alternate" href="https://www.youtube.com/watch?v=' + id + '"/>' +
    '<published>2026-09-' + String((i % 28) + 1).padStart(2, '0') + 'T10:00:00+00:00</published>' +
    '<updated>2026-09-' + String((i % 28) + 1).padStart(2, '0') + 'T10:00:00+00:00</updated>' +
    '<media:group><media:statistics views="' + (100 + i) + '"/>' +
    '<media:starRating count="' + (5 + i) + '"/>' +
    '<media:thumbnail url="https://i.ytimg.com/vi/' + id + '/hqdefault.jpg"/></media:group>' +
    '</entry>'
  )).join('');
  return '<?xml version="1.0" encoding="UTF-8"?><feed><title>AH SOLUTION</title>' + entries + '</feed>';
}

function ok(text) {
  return { ok: true, text: async () => text };
}

function mockFeed(ids, apiItems) {
  feed.__setFetch(async (url) => {
    if (url.includes('youtube.com/feeds/videos.xml')) return ok(rss(ids));
    if (url.includes('googleapis.com/youtube/v3/videos')) {
      return ok(JSON.stringify({ items: apiItems || [] }));
    }
    throw new Error('unexpected_url');
  });
}

function failingFeed() {
  feed.__setFetch(async () => { throw new Error('network down key=SECRET123'); });
}

function makeVideos(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: 'vid' + String(i).padStart(5, '0'),
    title: 'Saved video ' + i,
    url: 'https://www.youtube.com/watch?v=vid' + String(i).padStart(5, '0'),
    isShort: false,
    published: '2026-08-01T10:00:00+00:00',
    thumbnail: 'https://i.ytimg.com/vi/vid' + String(i).padStart(5, '0') + '/hqdefault.jpg',
    views: 10 + i,
    likes: 1,
    durationSeconds: 120
  }));
}

function envelopeFor(videos, syncedAt) {
  return {
    version: 1,
    syncedAt: syncedAt || '2026-10-22T06:00:00.000Z',
    source: 'youtube-rss',
    dataset: {
      generatedAt: syncedAt || '2026-10-22T06:00:00.000Z',
      source: 'youtube-rss',
      channel: { id: feed.CHANNEL_ID, title: 'AH SOLUTION', handle: '@ah.solution' },
      counts: { total: videos.length, shorts: 0, longForm: videos.length },
      videos
    }
  };
}

function body(res) {
  return JSON.parse(res.body);
}

test.before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
  process.env.UPSTASH_REDIS_REST_URL = base;
  process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
  process.env.VIDEOS_REFRESH_TOKEN = 'manual-token';
  delete process.env.YT_API_KEY;
  delete process.env.VIDEOS_ALLOW_FEED_SHRINK;
  feed = require('../netlify/functions/_shared/youtube-feed.cjs');
  store = require('../netlify/functions/_shared/videos-store.cjs');
  refresh = require('../netlify/functions/videos-refresh/videos-refresh.js');
  fresh = require('../netlify/functions/videos-fresh/videos-fresh.js');
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test.afterEach(() => {
  data.clear();
  feed.__setFetch(null);
  process.env.UPSTASH_REDIS_REST_URL = base;
  process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
  process.env.VIDEOS_REFRESH_TOKEN = 'manual-token';
  delete process.env.YT_API_KEY;
  delete process.env.VIDEOS_ALLOW_FEED_SHRINK;
  delete process.env.VIDEOS_CACHE_TTL_SECONDS;
});

test('validateDataset rejects malformed payloads', () => {
  assert.equal(feed.validateDataset(null).ok, false);
  assert.equal(feed.validateDataset({ videos: [] }).ok, false);
  const dup = envelopeFor(makeVideos(2)).dataset;
  dup.videos[1].id = dup.videos[0].id;
  assert.equal(feed.validateDataset(dup).ok, false);
  const badUrl = envelopeFor(makeVideos(1)).dataset;
  badUrl.videos[0].url = 'javascript:alert(1)';
  assert.equal(feed.validateDataset(badUrl).ok, false);
  assert.equal(feed.validateDataset(envelopeFor(makeVideos(3)).dataset).ok, true);
});

test('scheduled refresh publishes a dataset and videos-fresh serves it', async () => {
  mockFeed(['vidAAAAAA', 'vidBBBBBB', 'vidCCCCCC']);
  const res = await refresh.handler({ next_run: '2026-10-22T13:00:00Z', httpMethod: 'POST' });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(body(res).ok, true);
  assert.equal(body(res).videos, 3);

  const stored = await store.readAll();
  assert.equal(stored.envelope.dataset.videos.length, 3);
  assert.ok(stored.envelope.syncedAt);
  assert.equal(stored.status.ok, true);

  const out = await fresh.handler({ httpMethod: 'GET' });
  assert.equal(out.statusCode, 200);
  assert.equal(out.headers['X-Fresh-Cache'], 'DURABLE');
  assert.match(out.headers['Cache-Control'], /max-age=60/);
  const payload = body(out);
  assert.equal(payload.videos.length, 3);
  assert.equal(payload.syncedAt, stored.envelope.syncedAt);
  assert.equal(payload.sync.ok, true);
  assert.equal(payload.stale, false);
});

test('manual trigger requires the refresh token', async () => {
  mockFeed(['vidAAAAAA']);
  delete process.env.VIDEOS_REFRESH_TOKEN;
  const denied = await refresh.handler({ httpMethod: 'POST', headers: {} });
  assert.equal(denied.statusCode, 401);

  process.env.VIDEOS_REFRESH_TOKEN = 'manual-token';
  const allowed = await refresh.handler({
    httpMethod: 'POST',
    headers: { authorization: 'Bearer manual-token' }
  });
  assert.equal(allowed.statusCode, 200, allowed.body);

  const wrong = await refresh.handler({
    httpMethod: 'POST',
    headers: { 'x-ah-refresh-token': 'nope' }
  });
  assert.equal(wrong.statusCode, 401);
});

test('a failed refresh keeps the last good dataset and records failure', async () => {
  const saved = envelopeFor(makeVideos(5));
  await store.writeDataset(saved);
  await store.writeStatus({ ok: true, lastAttemptAt: saved.syncedAt, lastSuccessAt: saved.syncedAt, lastError: null });

  failingFeed();
  const res = await refresh.handler({ next_run: '2026-10-22T14:00:00Z' });
  assert.equal(res.statusCode, 502);
  assert.equal(body(res).error, 'refresh_failed');

  const after = await store.readAll();
  assert.equal(after.envelope.dataset.videos.length, 5);
  assert.equal(after.envelope.syncedAt, saved.syncedAt);
  assert.equal(after.status.ok, false);
  assert.equal(after.status.lastSuccessAt, saved.syncedAt);
  assert.ok(!JSON.stringify(after.status).includes('SECRET123'));

  const out = await fresh.handler({ httpMethod: 'GET' });
  const payload = body(out);
  assert.equal(payload.sync.ok, false);
  assert.equal(payload.videos.length, 5);
});

test('an empty feed never replaces good data', async () => {
  await store.writeDataset(envelopeFor(makeVideos(4)));
  mockFeed([]);
  const res = await refresh.handler({ next_run: 'x' });
  assert.equal(res.statusCode, 502);
  const after = await store.readAll();
  assert.equal(after.envelope.dataset.videos.length, 4);
});

test('implausible shrinkage is rejected unless explicitly allowed', async () => {
  await store.writeDataset(envelopeFor(makeVideos(10)));
  mockFeed(['vidAAAAAA', 'vidBBBBBB']);
  const res = await refresh.handler({ next_run: 'x' });
  assert.equal(res.statusCode, 502);
  assert.equal(body(res).error, 'refresh_rejected');
  const after = await store.readAll();
  assert.equal(after.envelope.dataset.videos.length, 10);

  process.env.VIDEOS_ALLOW_FEED_SHRINK = '1';
  const allowed = await refresh.handler({ next_run: 'x' });
  assert.equal(allowed.statusCode, 200, allowed.body);
  const updated = await store.readAll();
  assert.equal(updated.envelope.dataset.videos.length, 2);
});

test('concurrent workers cannot publish at the same time', async () => {
  mockFeed(['vidAAAAAA']);
  const held = await store.acquireLock('someone-else', 60000);
  assert.equal(held, true);
  const res = await refresh.handler({ next_run: 'x' });
  assert.equal(res.statusCode, 409);
  await store.releaseLock('someone-else');
});

test('YT_API_KEY enriches counts and duration', async () => {
  process.env.YT_API_KEY = 'unit-test-key';
  mockFeed(['vidAAAAAA'], [{
    id: 'vidAAAAAA',
    statistics: { viewCount: '999', likeCount: '42' },
    contentDetails: { duration: 'PT3M20S' },
    snippet: { title: 'Video vidAAAAAA' }
  }]);
  const res = await refresh.handler({ next_run: 'x' });
  assert.equal(res.statusCode, 200, res.body);
  const stored = await store.readAll();
  assert.equal(stored.envelope.dataset.source, 'youtube-data-api');
  assert.equal(stored.envelope.dataset.videos[0].views, 999);
  assert.equal(stored.envelope.dataset.videos[0].likes, 42);
  assert.equal(stored.envelope.dataset.videos[0].durationSeconds, 200);
});

test('a failing YouTube API falls back to RSS instead of blocking the sync', async () => {
  process.env.YT_API_KEY = 'bad-key';
  feed.__setFetch(async (url) => {
    if (url.includes('youtube.com/feeds/videos.xml')) return ok(rss(['vidAAAAAA']));
    throw new Error('api_quota_exceeded');
  });
  const res = await refresh.handler({ next_run: 'x' });
  assert.equal(res.statusCode, 200, res.body);
  const stored = await store.readAll();
  assert.equal(stored.envelope.dataset.source, 'youtube-rss');
  assert.equal(stored.envelope.dataset.videos.length, 1);
});

test('missing store configuration is reported honestly', async () => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  const res = await refresh.handler({ next_run: 'x' });
  assert.equal(res.statusCode, 503);
  assert.equal(body(res).error, 'store_not_configured');

  mockFeed(['vidAAAAAA']);
  const out = await fresh.handler({ httpMethod: 'GET' });
  assert.equal(out.statusCode, 200);
  assert.ok(['LIVE', 'HIT'].includes(out.headers['X-Fresh-Cache']), out.headers['X-Fresh-Cache']);
});
