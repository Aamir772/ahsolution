/* ==========================================================================
   agent/transport.js — outbound connection to the JARVIS backend hub

   The agent dials OUT to the backend and keeps a persistent socket open. It
   never listens. Transport is newline-delimited, HMAC-signed JSON
   (server/agent-protocol.js + server/agent-framing.js).

   Features: authenticated handshake, heartbeat with stale detection, bounded
   exponential backoff with jitter on reconnect, and clean shutdown.
   ========================================================================== */
'use strict';

const net = require('net');
const tls = require('tls');
const fs = require('fs');
const { createAgentProtocol, createGuard } = require('../server/agent-protocol');
const { createLineDecoder, encodeLine } = require('../server/agent-framing');

const INBOUND_MAX_BYTES = 2 * 1024 * 1024;

/**
 * @param {{ cfg:object, logger:object, onMessage:Function, onStatus:Function }} deps
 */
function createTransport({ cfg, logger, onMessage, onStatus }) {
  const protocol = createAgentProtocol({ secret: cfg.sessionSecret });
  const guard = createGuard({ ttlMs: 300000, max: 20000 });

  let socket = null;
  let decoder = null;
  let connected = false;
  let stopped = false;
  let seqOut = 0;
  let attempt = 0;
  let reconnectTimer = null;
  let heartbeatTimer = null;
  let lastAckAt = 0;
  let handshakeDone = false;

  function status() {
    return {
      connected,
      agentId: cfg.id,
      backend: { host: cfg.backend.host, port: cfg.backend.port, tls: cfg.tls.enabled },
      lastHeartbeatAckAt: lastAckAt || null,
      since: connected ? connectedSince : null
    };
  }
  let connectedSince = null;

  function setStatus(s, extra) { if (onStatus) { try { onStatus(s, Object.assign(status(), extra || {})); } catch (e) { /* ignore */ } } }

  function send(type, payload) {
    if (!socket || !socket.writable) return false;
    try {
      seqOut += 1;
      const msg = protocol.encode({ type, agentId: cfg.id, seq: seqOut, payload: payload === undefined ? null : payload });
      socket.write(encodeLine(msg));
      return true;
    } catch (e) {
      if (logger) logger.warn('agent_send_failed', { message: e && e.message });
      return false;
    }
  }

  function handleLine(line) {
    let msg;
    try {
      msg = protocol.decode(line, { agentId: handshakeDone ? cfg.id : undefined, now: Date.now(), skewMs: 60000, guard });
    } catch (e) {
      if (logger) logger.warn('agent_recv_rejected', { reason: e && e.code || 'invalid' });
      return;
    }
    switch (msg.type) {
      case 'hello_ack':
        handshakeDone = true;
        connected = true;
        attempt = 0;
        connectedSince = Date.now();
        lastAckAt = Date.now();
        startHeartbeat();
        if (logger) logger.info('agent_connected', { backend: cfg.backend.host + ':' + cfg.backend.port, heartbeatMs: (msg.payload && msg.payload.heartbeatMs) || cfg.heartbeatMs });
        setStatus('online', { heartbeatMs: (msg.payload && msg.payload.heartbeatMs) || cfg.heartbeatMs });
        break;
      case 'heartbeat_ack':
        lastAckAt = Date.now();
        break;
      case 'bye':
        if (logger) logger.info('agent_backend_bye', {});
        stopSocket('bye');
        break;
      case 'task_invoke':
      case 'task_cancel':
      case 'task_progress':
        if (onMessage) { try { onMessage(msg); } catch (e) { if (logger) logger.warn('agent_task_handler_error', { message: e && e.message }); } }
        break;
      case 'error':
        if (logger) logger.warn('agent_backend_error', { error: msg.payload && msg.payload.error });
        break;
      default:
        break;
    }
  }

  function startHeartbeat() {
    stopHeartbeat();
    const ms = Math.max(1000, cfg.heartbeatMs);
    heartbeatTimer = setInterval(() => {
      if (lastAckAt && (Date.now() - lastAckAt) > ms * 3) {
        if (logger) logger.warn('agent_heartbeat_stale', { ms: Date.now() - lastAckAt });
        return stopSocket('stale');
      }
      send('heartbeat', { status: 'online', ts: Date.now() });
    }, ms);
    if (heartbeatTimer.unref) heartbeatTimer.unref();
  }
  function stopHeartbeat() { if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; } }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    const min = cfg.reconnect.minMs;
    const max = cfg.reconnect.maxMs;
    const base = Math.min(max, min * Math.pow(2, attempt));
    const jitter = Math.floor(base * 0.2 * Math.random());
    const delay = Math.min(max, base + jitter);
    attempt += 1;
    if (logger) logger.info('agent_reconnect_scheduled', { attempt, delayMs: delay });
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, delay);
    if (reconnectTimer.unref) reconnectTimer.unref();
  }

  function stopSocket(reason) {
    stopHeartbeat();
    connected = false;
    handshakeDone = false;
    if (socket) {
      try { socket.destroy(); } catch (e) { /* ignore */ }
      socket = null;
    }
    setStatus('offline', { reason });
    if (!stopped) scheduleReconnect();
  }

  function connect() {
    if (stopped || socket) return;
    setStatus('connecting');
    const opts = { host: cfg.backend.host, port: cfg.backend.port };
    let s;
    if (cfg.tls.enabled) {
      const tlsOpts = Object.assign({}, opts, { servername: cfg.tls.servername || cfg.backend.host, rejectUnauthorized: !cfg.tls.insecure });
      if (cfg.tls.caFile) { try { tlsOpts.ca = fs.readFileSync(cfg.tls.caFile); } catch (e) { if (logger) logger.warn('agent_tls_ca_read_failed', { message: e && e.message }); } }
      s = tls.connect(tlsOpts, () => sendHello());
    } else {
      s = net.connect(opts, () => sendHello());
    }
    socket = s;
    s.setNoDelay(true);
    decoder = createLineDecoder({ maxBytes: INBOUND_MAX_BYTES, onLine: handleLine, onError: () => stopSocket('oversized') });
    s.on('data', (chunk) => { try { decoder(chunk); } catch (e) { /* isolate */ } });
    s.on('error', (e) => { if (logger) logger.warn('agent_socket_error', { message: e && e.message }); });
    s.on('close', () => { if (socket === s) stopSocket('closed'); });
  }

  function sendHello() {
    if (logger) logger.info('agent_handshake', { backend: cfg.backend.host + ':' + cfg.backend.port });
    const ok = send('hello', {
      agentId: cfg.id,
      token: cfg.token,
      client: 'jarvis-agent',
      version: 1,
      platform: process.platform + '/' + process.arch,
      node: process.version,
      tools: ['agent_status', 'files_list', 'files_read', 'project_inspect', 'qa_run']
    });
    if (!ok) stopSocket('hello_failed');
  }

  function stop() {
    stopped = true;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    stopHeartbeat();
    if (socket) { send('bye', {}); try { socket.end(); } catch (e) { /* ignore */ } }
    connected = false;
  }

  return { connect, stop, send, status, isConnected: () => connected };
}

module.exports = { createTransport };
