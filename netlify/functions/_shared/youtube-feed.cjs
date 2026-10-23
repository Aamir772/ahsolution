/* ==========================================================================
   netlify/functions/_shared/youtube-feed.cjs
   Shared YouTube channel feed builder for the AH Solution functions.

   Used by both videos-fresh (public read path) and videos-refresh (hourly
   scheduled sync). Zero dependencies; the YT_API_KEY never leaves the
   server and never appears in an error message.

   The dataset schema is identical to scripts/fetch-videos.mjs so the static
   snapshot and the live payload are interchangeable in the frontend.
   ========================================================================== */
'use strict';

const CHANNEL_ID = 'UC_LdZmWha8cvotco41D77fw';
const HANDLE = '@ah.solution';
const TIMEOUT_MS = 9000;

let fetchImpl = null;
function getFetch() {
  return fetchImpl || ((...args) => fetch(...args));
}
/* Test-only injection; pass null to restore the global fetch. */
function setFetch(fn) { fetchImpl = typeof fn === 'function' ? fn : null; }

function decode(s = '') {
  return String(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}

function tag(xml, name) {
  const m = xml.match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)</' + name + '>'));
  return m ? decode(m[1].trim()) : null;
}

async function get(url) {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
  try {
    const res = await getFetch()(url, {
      headers: { 'user-agent': 'AH-Solution-runtime/1.0' },
      signal: ctrl ? ctrl.signal : undefined
    });
    if (!res.ok) throw new Error('upstream ' + res.status);
    return res.text();
  } catch (err) {
    if (err && err.name === 'AbortError') throw new Error('upstream_timeout');
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fromRss() {
  const xml = await get('https://www.youtube.com/feeds/videos.xml?channel_id=' + CHANNEL_ID);
  const title = tag(xml, 'title') || 'AH SOLUTION';
  const blocks = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
  const videos = blocks.map((e) => {
    const id = tag(e, 'yt:videoId');
    const link = (e.match(/<link rel="alternate" href="([^"]+)"/) || [])[1] || 'https://www.youtube.com/watch?v=' + id;
    const stats = e.match(/<media:statistics views="(\d+)"/);
    const rating = e.match(/<media:starRating[^>]*count="(\d+)"/);
    const thumb = (e.match(/<media:thumbnail url="([^"]+)"/) || [])[1] || 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg';
    return {
      id,
      title: tag(e, 'title'),
      url: link,
      isShort: /\/shorts\//.test(link),
      published: tag(e, 'published'),
      updated: tag(e, 'updated'),
      thumbnail: thumb,
      views: stats ? Number(stats[1]) : null,
      likes: rating ? Number(rating[1]) : null,
      durationSeconds: null,
      statsSource: 'rss'
    };
  }).filter(v => v.id);
  return { title, videos };
}

const isoToSeconds = (d) => {
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(d || '');
  if (!m) return null;
  return (+(m[1] || 0)) * 86400 + (+(m[2] || 0)) * 3600 + (+(m[3] || 0)) * 60 + (+(m[4] || 0));
};

async function enrichWithApi(videos, apiKey) {
  const ids = videos.map(v => v.id);
  const byId = Object.fromEntries(videos.map(v => [v.id, v]));
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50).join(',');
    const url = 'https://www.googleapis.com/youtube/v3/videos?part=statistics,contentDetails,snippet&id=' + chunk + '&key=' + apiKey;
    const data = JSON.parse(await get(url));
    for (const item of data.items || []) {
      const v = byId[item.id];
      if (!v) continue;
      v.views = Number(item.statistics.viewCount ?? v.views);
      v.likes = item.statistics.likeCount != null ? Number(item.statistics.likeCount) : v.likes;
      v.durationSeconds = isoToSeconds(item.contentDetails.duration);
      if (v.durationSeconds <= 60 && !v.isShort && /#short/i.test(v.title || '')) v.isShort = true;
      v.statsSource = 'api';
    }
  }
  return videos;
}

/* Reject malformed payloads before they can replace a known-good dataset. */
function validateDataset(dataset) {
  const errors = [];
  if (!dataset || typeof dataset !== 'object' || Array.isArray(dataset)) {
    return { ok: false, errors: ['not_an_object'] };
  }
  const videos = dataset.videos;
  if (!Array.isArray(videos) || videos.length < 1) errors.push('no_videos');
  if (Array.isArray(videos) && videos.length > 500) errors.push('too_many_videos');
  if (dataset.generatedAt && Number.isNaN(Date.parse(dataset.generatedAt))) errors.push('bad_generatedAt');
  if (dataset.counts && typeof dataset.counts === 'object' && Array.isArray(videos)) {
    if (Number(dataset.counts.total) !== videos.length) errors.push('count_mismatch');
  }
  const seen = new Set();
  for (const v of Array.isArray(videos) ? videos : []) {
    if (!v || typeof v !== 'object') { errors.push('bad_video'); break; }
    if (typeof v.id !== 'string' || !/^[A-Za-z0-9_-]{6,32}$/.test(v.id)) { errors.push('bad_id'); break; }
    if (seen.has(v.id)) { errors.push('duplicate_id'); break; }
    seen.add(v.id);
    if (typeof v.title !== 'string' || !v.title.trim() || v.title.length > 300) { errors.push('bad_title'); break; }
    if (typeof v.url !== 'string' || !/^https:\/\/(www\.)?youtube\.com\/[A-Za-z0-9_/?=&.-]+$/.test(v.url)) { errors.push('bad_url'); break; }
    if (!v.published || Number.isNaN(Date.parse(v.published))) { errors.push('bad_published'); break; }
    for (const key of ['views', 'likes', 'durationSeconds']) {
      if (v[key] != null && !(Number.isFinite(v[key]) && v[key] >= 0)) { errors.push('bad_' + key); break; }
    }
    if (errors.length) break;
  }
  return { ok: errors.length === 0, errors };
}

async function buildDataset(apiKey) {
  const key = apiKey !== undefined ? apiKey : (process.env.YT_API_KEY || '');
  const { title, videos } = await fromRss();
  let source = 'youtube-rss';
  if (key) {
    try {
      await enrichWithApi(videos, key);
      source = 'youtube-data-api';
    } catch (e) {
      /* Optional metrics must not block a valid RSS feed (bad key/quota). */
      source = 'youtube-rss';
    }
  }
  videos.sort((a, b) => new Date(b.published) - new Date(a.published));
  const dataset = {
    generatedAt: new Date().toISOString(),
    source,
    channel: { id: CHANNEL_ID, title, handle: HANDLE, url: 'https://www.youtube.com/channel/' + CHANNEL_ID },
    counts: {
      total: videos.length,
      shorts: videos.filter(v => v.isShort).length,
      longForm: videos.filter(v => !v.isShort).length
    },
    videos
  };
  const check = validateDataset(dataset);
  if (!check.ok) throw new Error('invalid_feed:' + check.errors.join(','));
  return dataset;
}

module.exports = {
  CHANNEL_ID,
  HANDLE,
  buildDataset,
  validateDataset,
  __setFetch: setFetch
};
