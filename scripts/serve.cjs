/* ==========================================================================
   scripts/serve.cjs — dependency-free local static server for AH Solution

   Serves the site root with correct MIME types, clean 404s and the same
   relative routing the site uses in production. Used by `npm start` and by
   qa-blog.cjs for its browser pass (no third-party packages anywhere).

   Usage: node scripts/serve.cjs [--port 8000] [--root <dir>]
   ========================================================================== */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : dflt;
};

const PORT = parseInt(arg('--port', process.env.PORT || '8000'), 10);
const ROOT = path.resolve(arg('--root', path.join(__dirname, '..')));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip'
};

const server = http.createServer(function (req, res) {
  try {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    // Mirrors the production /api/videos rewrite (netlify.toml): the local
    // dev server stands in for the videos-fresh function with the current
    // snapshot, so QA never logs spurious 404s for the live-data fetch.
    if (url === '/api/videos') {
      const feed = path.join(ROOT, 'assets', 'data', 'videos.json');
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      res.end(fs.existsSync(feed) ? fs.readFileSync(feed) : JSON.stringify({ error: 'feed unavailable' }));
      return;
    }
    // Mirrors the production /api/localize rewrite (netlify.toml): the local
    // dev server runs the real localize function in-process, so the language
    // selector behaves exactly like production during QA. With no key set the
    // function answers 503 not_configured, which keeps tests deterministic.
    if (url === '/api/localize') {
      const chunks = [];
      req.on('data', function (c) { chunks.push(c); });
      req.on('end', function () {
        let fn;
        try { fn = require(path.join(ROOT, 'netlify', 'functions', 'localize', 'localize.js')); }
        catch (e) {
          res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: 'fn_load', message: 'localize function failed to load' }));
          return;
        }
        const body = Buffer.concat(chunks).toString('utf8');
        Promise.resolve(fn.handler({
          httpMethod: req.method,
          headers: Object.assign({ origin: 'http://localhost:' + PORT }, req.headers),
          body: req.method === 'POST' ? body : undefined
        })).then(function (r) {
          res.writeHead(r.statusCode || 200, r.headers || {});
          res.end(r.body == null ? '' : r.body);
        }).catch(function () {
          res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: 'fn_error' }));
        });
      });
      return;
    }
    let file = path.normalize(path.join(ROOT, url));
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }

    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) {
      const notFound = path.join(ROOT, '404.html');
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.existsSync(notFound) ? fs.readFileSync(notFound) : '404');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(fs.readFileSync(file));
  } catch (e) {
    res.writeHead(500); res.end('server error');
  }
});

server.listen(PORT, '127.0.0.1', function () {
  console.log('AH Solution local server: http://localhost:' + PORT + '/  (root: ' + ROOT + ')');
});

server.on('error', function (e) {
  console.error('serve failed:', e.message);
  process.exit(1);
});
