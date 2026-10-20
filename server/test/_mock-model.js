'use strict';
/* ==========================================================================
   Test helper: a tiny OpenAI-compatible model server on 127.0.0.1 that lets us
   exercise the REAL provider transport (HTTP, auth header, JSON shape, tool
   calls, timeouts) without any external credentials.
   ========================================================================== */
const http = require('http');

function startMockModel(opts = {}) {
  const state = { chatCalls: 0, modelCalls: 0, lastAuth: null, lastBody: null };
  const server = http.createServer((req, res) => {
    if (req.url.endsWith('/models')) {
      state.modelCalls++;
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: opts.model || 'mock-model' }] }));
    }
    if (req.url.includes('/chat/completions')) {
      state.chatCalls++;
      state.lastAuth = req.headers.authorization || null;
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        state.lastBody = body;
        if (opts.fail) { res.writeHead(500, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'mock failure' } })); }
        const reply = typeof opts.reply === 'function' ? opts.reply(body) : (opts.reply || 'MOCK MODEL REPLY');
        const send = () => {
          try {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ model: opts.model || 'mock-model', choices: [{ message: { role: 'assistant', content: reply } }], usage: { total_tokens: 5 } }));
          } catch (e) { /* socket may be aborted by a timeout test */ }
        };
        if (opts.delayMs) setTimeout(send, opts.delayMs); else send();
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  return { server, state };
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

module.exports = { startMockModel, listen };
