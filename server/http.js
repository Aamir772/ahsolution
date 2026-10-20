/* ==========================================================================
   server/http.js — tiny router + Node http server

   No framework. Responsibilities:
     * request id + structured access logging
     * CORS with an explicit allowlist (never "*" in production)
     * JSON body parsing with a hard size cap
     * per-request route timeout
     * central error → HTTP mapping (no stack traces / secrets leak)
     * 404 vs 405 distinction
   ========================================================================== */
'use strict';

const http = require('http');
const crypto = require('crypto');
const { toHttp, NotFoundError, PayloadTooLargeError, MethodNotAllowedError, ValidationError, RateLimitError } = require('./errors');

function matchPath(pattern, pathname) {
  const pp = pattern.split('/').filter(Boolean);
  const ap = pathname.split('/').filter(Boolean);
  if (pp.length !== ap.length) return null;
  const params = {};
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith(':')) params[pp[i].slice(1)] = decodeURIComponent(ap[i]);
    else if (pp[i] !== ap[i]) return null;
  }
  return params;
}

function createRouter() {
  /** @type {{method:string, pattern:string, handler:Function}[]} */
  const routes = [];
  const add = (method, pattern, handler) => { routes.push({ method, pattern, handler }); };

  function resolve(method, pathname) {
    let pathMatched = false;
    for (const r of routes) {
      const params = matchPath(r.pattern, pathname);
      if (!params) continue;
      pathMatched = true;
      if (r.method === method) return { route: r, params };
    }
    return { route: null, params: null, pathMatched };
  }

  return {
    get: (p, h) => add('GET', p, h),
    post: (p, h) => add('POST', p, h),
    put: (p, h) => add('PUT', p, h),
    delete: (p, h) => add('DELETE', p, h),
    routes,
    resolve
  };
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let over = false;
    const chunks = [];
    req.on('data', (c) => {
      if (over) return;
      size += c.length;
      if (size > maxBytes) { over = true; chunks.length = 0; req.resume(); return reject(new PayloadTooLargeError()); }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve(undefined);
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve(undefined);
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new ValidationError('Request body must be valid JSON.')); }
    });
    req.on('error', reject);
  });
}

function originAllowed(cfg, origin) {
  if (!origin) return null;
  if (cfg.http.allowedOrigins.includes(origin)) return origin;
  if (!cfg.isProd && cfg.http.allowedOrigins.length === 0) return origin; // dev convenience
  return null;
}

/**
 * @param {{ cfg:object, logger:object, router:object, auth:object, rateLimiter?:object, context?:object }} deps
 */
function createServer(deps) {
  const { cfg, logger, router, auth } = deps;

  const server = http.createServer(async (req, res) => {
    const requestId = crypto.randomBytes(6).toString('hex');
    const started = Date.now();
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname.replace(/\/+$/, '') || '/';

    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Content-Type-Options', 'nosniff');

    const origin = req.headers.origin;
    const allowed = originAllowed(cfg, origin);
    if (allowed) {
      res.setHeader('Access-Control-Allow-Origin', allowed);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') { res.writeHead(allowed ? 204 : 403); return res.end(); }

    const send = (status, body) => {
      const payload = Buffer.from(JSON.stringify(body === undefined ? {} : body));
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': payload.length });
      res.end(payload);
      if (logger) logger.info('http', { requestId, method: req.method, path: pathname, status, ms: Date.now() - started });
    };

    try {
      const { route, params, pathMatched } = router.resolve(req.method, pathname);
      if (!route) throw pathMatched ? new MethodNotAllowedError() : new NotFoundError('No such endpoint.');

      const principal = await auth.authenticate(req);
      let body;
      if (req.method !== 'GET' && req.method !== 'DELETE') body = await readBody(req, cfg.http.maxBodyBytes);

      const ctx = Object.assign({
        requestId, method: req.method, path: pathname, params, query: url.searchParams,
        body, principal, send,
        rateLimiter: deps.rateLimiter,
        ip: (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim()
      }, deps.context || {});

      let timer;
      const result = await Promise.race([
        route.handler(ctx),
        new Promise((_, rej) => { timer = setTimeout(() => rej(new (require('./errors').TimeoutError)('Request timed out.')), cfg.http.requestTimeoutMs); })
      ]).finally(() => clearTimeout(timer));

      if (result === undefined) return; // handler already responded (e.g. streamed)
      send(200, Object.assign({ ok: true }, result));
    } catch (e) {
      const { status, body } = toHttp(e);
      if (status >= 500 && logger) logger.error('request_failed', { requestId, path: pathname, error: e && e.code || 'error', message: e && e.message });
      send(status, body);
    }
  });

  server.headersTimeout = cfg.http.requestTimeoutMs + 5000;
  server.requestTimeout = cfg.http.requestTimeoutMs;
  return server;
}

module.exports = { createRouter, createServer, readBody };
