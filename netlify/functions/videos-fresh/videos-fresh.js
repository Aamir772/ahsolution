/* ==========================================================================
   netlify/functions/videos-fresh/videos-fresh.js
   Live public YouTube dataset for the AH Solution channel, fetched at
   request time (server-side only — the API key never leaves this-island).

   GET /.netlify/functions/videos-fresh  (also mounted at /api/videos)

   Behaviour:
     - Builds the same dataset schema as scripts/fetch-videos.mjs so the
       frontend can swap them transparently: publish data from the public
       channel RSS, view/like counts + durations from the YouTube Data API
       when YT_API_KEY is configured.
     - In-process cache with TTL (VIDEOS_CACHE_TTL_SECONDS, default 900s)
       protects the YouTube quota against duplicate refreshes.
     - On refresh failure the last successful payload is served (X-Fresh-Cache:
       STALE); with no cache at all the caller gets 503 JSON.
   ========================================================================== */
'use strict';

const CHANNEL_ID = 'UC_LdZmWha8cvotco41D77fw';
const HANDLE = '@ah.solution';
const API_KEY = process.env.YT_API_KEY || '';
const TTL_SECONDS = (() => {
  const n = parseInt(process.env.VIDEOS_CACHE_TTL_SECONDS || '900', 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), 86400) : 900;
})();

/* Same publish data the RSS feed carries inside <media:group>; medium carries
   the view/rating stats, link can prove a Short via the /shorts/ URL. */
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
  const res = await fetch(url, { headers: { 'user-agent': 'AH-Solution-runtime/1.0' } });
  if (!res.ok) throw new Error('upstream ' + res.status);
  return res.text();
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

/* Keep the API key out of any error path: failures look like "upstream 403". */
async function enrichWithApi(videos) {
  const ids = videos.map(v => v.id);
  const byId = Object.fromEntries(videos.map(v => [v.id, v]));
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50).join(',');
    const url = 'https://www.googleapis.com/youtube/v3/videos?part=statistics,contentDetails,snippet&id=' + chunk + '&key=' + API_KEY;
    const data = JSON.parse(await get(url));
    for (const item of data.items || []) {
      const v = byId[item.id];
      if (!v) continue;
      v.views = Number(item.statistics.viewCount ?? v.views);
      v.likes = item.statistics.likeCount != null ? Number(item.statistics.likeCount) : v.likes;
      v.durationSeconds = isoToSeconds(item.contentDetails.duration);
      /* Short classification prefers concrete evidence: the /shorts/ URL from
         RSS. Duration is a fallback only where the title itself claims #short.  */
      if (v.durationSeconds <= 60 && !v.isShort && /#short/i.test(v.title || '')) v.isShort = true;
      v.statsSource = 'api';
    }
  }
  return videos;
}

async function buildDataset() {
  const { title, videos } = await fromRss();
  let source = 'youtube-rss';
  if (API_KEY) {
    source = 'youtube-data-api';
    await enrichWithApi(videos);
  }
  videos.sort((a, b) => new Date(b.published) - new Date(a.published));
  const generatedAt = new Date().toISOString();
  return {
    generatedAt,
    source,
    channel: { id: CHANNEL_ID, title, handle: HANDLE, url: 'https://www.youtube.com/channel/' + CHANNEL_ID },
    counts: {
      total: videos.length,
      shorts: videos.filter(v => v.isShort).length,
      longForm: videos.filter(v => !v.isShort).length
    },
    videos
  };
}

/* Module-scoped cache: survives repeated invocations inside one warm function
   instance, resets on cold start (acceptable — quota is protected per-lane). */
let cache = null; // { payload, atMs }

const json = (payload, extraHeaders = {}, status = 200) => ({
  statusCode: status,
  headers: Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=300, must-revalidate',
    'X-Feed-Source': payload.source || 'unknown'
  }, extraHeaders),
  body: JSON.stringify(payload)
});

exports.handler = async () => {
  const now = Date.now();
  if (cache && now - cache.atMs < TTL_SECONDS * 1000) {
    return json(cache.payload, { 'X-Fresh-Cache': 'HIT' });
  }
  try {
    const payload = await buildDataset();
    cache = { payload, atMs: now };
    return json(payload, { 'X-Fresh-Cache': 'MISS' });
  } catch (err) {
    if (cache) return json(cache.payload, { 'X-Fresh-Cache': 'STALE' });
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ error: 'YouTube feed unavailable', detail: String(err && err.message || err).slice(0, 120) })
    };
  }
};
