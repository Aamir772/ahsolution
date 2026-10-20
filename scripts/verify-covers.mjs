#!/usr/bin/env node
/* verify-covers.mjs — verify every cover/thumbnail asset referenced by the blog
   markup and manifest exists locally and resolves on the deployed site. */
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIVE = 'https://ahsolution.live';

const refs = new Set();
const addFrom = (text) => {
  const re = /\/blog\/assets\/([\w.\-]+)\.(?:svg|png|webp)\b/g;
  for (const m of text.matchAll(re)) refs.add(m[0]);
};

addFrom(await readFile(path.join(ROOT, 'blog.html'), 'utf8'));
for (const slug of await readdir(path.join(ROOT, 'article'))) {
  try { addFrom(await readFile(path.join(ROOT, 'article', slug, 'index.html'), 'utf8')); } catch {}
}
const manifest = JSON.parse(await readFile(path.join(ROOT, 'blog', 'blog-manifest.json'), 'utf8'));
addFrom(JSON.stringify(manifest));

const missingLocal = [];
for (const ref of [...refs]) {
  try { await stat(path.join(ROOT, ref.slice(1))); } catch { missingLocal.push(ref); }
}

const missingLive = [];
const check = async (ref) => {
  try {
    const r = await fetch(LIVE + ref, { method: 'HEAD' });
    if (!r.ok) missingLive.push(`${ref} -> ${r.status}`);
  } catch (e) { missingLive.push(`${ref} -> ${e.message}`); }
};
const batchSize = 8;
const all = [...refs];
for (let i = 0; i < all.length; i += batchSize) {
  await Promise.all(all.slice(i, i + batchSize).map(check));
}

console.log(`referenced blog assets: ${refs.size}`);
console.log(`missing locally: ${missingLocal.length ? missingLocal.join(', ') : 'none'}`);
console.log(`failing on live: ${missingLive.length ? missingLive.join(', ') : 'none'}`);

const cards = (await readFile(path.join(ROOT, 'blog.html'), 'utf8')).match(/data-blog-card/g) || [];
console.log(`blog cards: ${cards.length}`);

if (missingLocal.length || missingLive.length) process.exitCode = 1;
