'use strict';
/* ==========================================================================
   Test helper: a tiny stand-in for the realtime provider's /realtime/calls
   endpoint. It lets us exercise the REAL server-side session relay (HTTP,
   multipart body, bearer auth header, SDP answer handling) with no external
   credentials and no live model.
   ========================================================================== */
const http = require('http');

const DEFAULT_ANSWER = [
  'v=0',
  'o=- 0 0 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'a=recvonly',
  ''
].join('\r\n');

function startMockVoice(opts = {}) {
  const state = { calls: 0, lastAuth: null, lastBody: null, lastContentType: null, lastUrl: null };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (!/\/realtime\/calls$/.test(req.url || '')) { res.writeHead(404); return res.end(); }
      state.calls++;
      state.lastUrl = req.url;
      state.lastAuth = req.headers.authorization || null;
      state.lastContentType = req.headers['content-type'] || null;
      state.lastBody = body;
      if (opts.fail) {
        res.writeHead(opts.failStatus || 500, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'mock voice failure' } }));
      }
      const answer = opts.answer || DEFAULT_ANSWER;
      const send = () => { try { res.writeHead(200, { 'content-type': 'application/sdp' }); res.end(answer); } catch (e) { /* socket may be aborted by a timeout test */ } };
      if (opts.delayMs) setTimeout(send, opts.delayMs); else send();
    });
  });
  return { server, state };
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

module.exports = { startMockVoice, listen, DEFAULT_ANSWER };
