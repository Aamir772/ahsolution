/* ==========================================================================
   fetch-videos.mjs — build assets/data/videos.json from the AH SOLUTION channel
   Zero runtime dependencies (Node 18+). No API key required.

   Default (no key):  public YouTube RSS feed  -> title, url, published, thumbnail,
                      view count, rating count, and Shorts/long-form classification.
   Optional:          set YT_API_KEY to enrich with the official YouTube Data API v3
                      (precise viewCount/likeCount + contentDetails.duration).

   Usage:
     node scripts/fetch-videos.mjs
     YT_API_KEY=xxxx node scripts/fetch-videos.mjs
   ========================================================================== */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const CHANNEL_ID = 'UC_LdZmWha8cvotco41D77fw';
const HANDLE = '@ah.solution';
const API_KEY = process.env.YT_API_KEY || '';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'data', 'videos.json');

const decode = (s = '') => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1].trim()) : null;
};

async function get(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'AH-Solution-build/1.0' } });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res.text();
}

/* ---------- primary source: public RSS feed ---------- */
async function fromRss() {
  const xml = await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`);
  const title = tag(xml, 'title') || 'AH SOLUTION';
  const blocks = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
  const videos = blocks.map((e) => {
    const id = tag(e, 'yt:videoId');
    const link = (e.match(/<link rel="alternate" href="([^"]+)"/) || [])[1] || `https://www.youtube.com/watch?v=${id}`;
    const stats = e.match(/<media:statistics views="(\d+)"/);
    const rating = e.match(/<media:starRating[^>]*count="(\d+)"/);
    const thumb = (e.match(/<media:thumbnail url="([^"]+)"/) || [])[1] || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
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

/* ---------- optional: official YouTube Data API v3 ---------- */
const isoToSeconds = (d) => {
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(d || '');
  if (!m) return null;
  return (+(m[1] || 0)) * 86400 + (+(m[2] || 0)) * 3600 + (+(m[3] || 0)) * 60 + (+(m[4] || 0));
};

async function enrichWithApi(videos) {
  const ids = videos.map(v => v.id);
  const byId = Object.fromEntries(videos.map(v => [v.id, v]));
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50).join(',');
    const url = `https://www.googleapis.com/youtube/v3/videos?part=statistics,contentDetails,snippet&id=${chunk}&key=${API_KEY}`;
    const data = JSON.parse(await get(url));
    for (const item of data.items || []) {
      const v = byId[item.id];
      if (!v) continue;
      v.views = Number(item.statistics.viewCount ?? v.views);
      v.likes = item.statistics.likeCount != null ? Number(item.statistics.likeCount) : v.likes;
      v.durationSeconds = isoToSeconds(item.contentDetails.duration);
      if (v.durationSeconds) v.isShort = v.durationSeconds <= 60;
      v.statsSource = 'api';
    }
  }
  return videos;
}

/* ---------- best-effort duration when no key is available ---------- */
async function addDurations(videos) {
  let done = 0;
  for (const v of videos) {
    if (v.durationSeconds != null) continue;
    try {
      const html = await get(`https://www.youtube.com/watch?v=${v.id}`);
      const m = html.match(/"lengthSeconds":"(\d+)"/);
      if (m) { v.durationSeconds = Number(m[1]); done++; }
    } catch { /* leave null — never invent a duration */ }
  }
  return done;
}

(async () => {
  const { title, videos } = await fromRss();
  let source = 'youtube-rss';

  if (API_KEY) {
    source = 'youtube-data-api';
    await enrichWithApi(videos);
  } else {
    const n = await addDurations(videos);
    console.log(`durations resolved for ${n}/${videos.length} videos (via watch page)`);
  }

  videos.sort((a, b) => new Date(b.published) - new Date(a.published));

  const payload = {
    generatedAt: new Date().toISOString(),
    source,
    channel: { id: CHANNEL_ID, title, handle: HANDLE, url: `https://www.youtube.com/channel/${CHANNEL_ID}` },
    counts: {
      total: videos.length,
      shorts: videos.filter(v => v.isShort).length,
      longForm: videos.filter(v => !v.isShort).length
    },
    videos
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(`wrote ${videos.length} videos -> ${OUT}  (source: ${source})`);
})();
