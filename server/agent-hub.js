/* ==========================================================================
   server/agent-hub.js — backend side of the local-agent transport

   The agent connects OUTBOUND to this hub; the hub never opens a port on the
   PC. Transport is a persistent socket carrying newline-delimited, HMAC-signed
   JSON (see agent-protocol.js / agent-framing.js). TCP is used for loopback
   development, TLS for remote connections.

   Responsibilities
     * authenticate each agent session with a unique, revocable token
     * verify signatures, version, identity binding, clock window, replays
     * track heartbeat / staleness and connection status
     * dispatch tasks and correlate results (idempotent, bounded, cancellable)
     * reject waiting tasks when an agent disconnects
     * audit every security-relevant event without logging secrets

   It does NOT execute anything itself; the agent is the execution boundary.
   ========================================================================== */
'use strict';

const net = require('net');
const tls = require('tls');
const fs = require('fs');
const { createAgentProtocol, createGuard } = require('./agent-protocol');
const { createLineDecoder, encodeLine } = require('./agent-framing');
const { timingSafeEqualStr } = require('./security');
const { newId } = require('./storage');
const { AgentOfflineError, AgentBusyError, TimeoutError, ValidationError, AppError } = require('./errors');

const STATUS = ['connected', 'busy', 'disconnected'];

/**
 * @param {{ cfg:object, logger:object, audit:object, protocol?:object }} deps
 */
function createAgentHub({ cfg, logger, audit, protocol }) {
  const acfg = cfg.agent;
  if (!acfg) throw new ValidationError('Agent configuration is missing.');
  const proto = protocol || createAgentProtocol({ secret: acfg.sessionSecret });

  /** @type {Map<string, object>} agentId -> connection */
  const connections = new Map();

  let server = null;
  let sweeper = null;

  /* --------------------------------------------------------------- connection */
  function connectionInfo(conn, nowMs) {
    return {
      agentId: conn.agentId,
      online: !conn.closed,
      status: conn.pending.size ? 'busy' : 'connected',
      connectedAt: conn.connectedAt,
      lastHeartbeat: conn.lastHeartbeat,
      lastHeartbeatAgeMs: conn.lastHeartbeat ? (nowMs - conn.lastHeartbeat) : null,
      currentTask: conn.currentTask || null,
      lastProgress: conn.lastProgress || null,
      client: conn.client || null,
      remote: conn.remote,
      pending: conn.pending.size
    };
  }

  function authedAgents() { return Array.from(connections.keys()); }

  function pickConnection(agentId) {
    if (agentId) {
      const c = connections.get(agentId);
      return c && !c.closed ? c : null;
    }
    for (const c of connections.values()) if (!c.closed) return c;
    return null;
  }

  function send(conn, type, payload) {
    if (conn.closed || !conn.socket.writable) return false;
    try {
      conn.seqOut += 1;
      const msg = proto.encode({ type, agentId: conn.agentId, seq: conn.seqOut, payload: payload === undefined ? null : payload });
      conn.socket.write(encodeLine(msg));
      return true;
    } catch (e) {
      if (logger) logger.warn('agent_send_failed', { agentId: conn.agentId, message: e && e.message });
      return false;
    }
  }

  function closeConnection(conn, reason) {
    if (conn.closed) return;
    conn.closed = true;
    try { conn.socket.destroy(); } catch (e) { /* ignore */ }
    if (connections.get(conn.agentId) === conn) connections.delete(conn.agentId);
    rejectPending(conn, new AgentOfflineError('The local agent disconnected.'));
    if (audit) audit.record({ action: 'agent.disconnect', actor: conn.agentId || 'unknown', outcome: 'info', meta: { reason: reason || 'closed' } });
  }

  function rejectPending(conn, err) {
    for (const [taskId, p] of conn.pending) {
      clearTimeout(p.timer);
      conn.pending.delete(taskId);
      try { p.reject(err); } catch (e) { /* ignore */ }
    }
  }

  /* ------------------------------------------------------------ line handling */

  function handleLine(conn, line) {
    let msg;
    try {
      msg = proto.decode(line, {
        agentId: conn.agentId,           // null until authenticated
        now: Date.now(),
        skewMs: acfg.clockSkewMs,
        guard: conn.guard
      });
    } catch (e) {
      if (audit) audit.record({ action: 'agent.message_rejected', actor: conn.agentId || 'unknown', outcome: 'deny', meta: { reason: e && e.code || 'invalid' } });
      // Authentication / identity failures are fatal: drop the connection.
      if (e && (e.code === 'auth_required' || e.code === 'forbidden')) return closeConnection(conn, 'auth');
      // Malformed / expired / replay get an error plus a small budget.
      conn.bad = (conn.bad || 0) + 1;
      send(conn, 'error', { error: 'invalid_message', message: String(e && e.message || 'invalid').slice(0, 200) });
      if (conn.bad >= 5) closeConnection(conn, 'too_many_invalid');
      return;
    }

    if (!conn.agentId) return handleHello(conn, msg);
    if (msg.agentId !== conn.agentId) return closeConnection(conn, 'identity');

    switch (msg.type) {
      case 'heartbeat':
        conn.lastHeartbeat = Date.now();
        send(conn, 'heartbeat_ack', { ts: Date.now(), status: conn.pending.size ? 'busy' : 'online', currentTask: conn.currentTask || null });
        break;
      case 'task_result': return onTaskResult(conn, msg.payload || {});
      case 'task_progress':
        conn.lastProgress = { taskId: msg.payload && msg.payload.taskId, phase: msg.payload && msg.payload.phase, note: msg.payload && msg.payload.note, at: Date.now() };
        if (audit) audit.record({ action: 'agent.task_progress', actor: conn.agentId, outcome: 'info', target: msg.payload && msg.payload.taskId, meta: { phase: msg.payload && msg.payload.phase } });
        break;
      case 'task_cancelled': return onTaskCancelled(conn, msg.payload || {});
      case 'error':
        if (msg.payload && msg.payload.taskId) return onTaskResult(conn, { taskId: msg.payload.taskId, ok: false, error: msg.payload.error || 'agent_error' });
        if (logger) logger.warn('agent_error', { agentId: conn.agentId, error: msg.payload && msg.payload.error });
        break;
      case 'hello':
        // A second hello on an authenticated connection re-authenticates (reconnect).
        return handleHello(conn, msg);
      case 'bye':
        send(conn, 'bye', {});
        return closeConnection(conn, 'bye');
      case 'heartbeat_ack':
      case 'task_invoke':
      case 'hello_ack':
        break; // not expected inbound; ignore
      default:
        send(conn, 'error', { error: 'unsupported_type', type: msg.type });
    }
  }

  function handleHello(conn, msg) {
    const payload = msg.payload || {};
    const token = typeof payload.token === 'string' ? payload.token : '';
    const agentId = typeof payload.agentId === 'string' && payload.agentId ? payload.agentId : acfg.id;
    const expected = Object.prototype.hasOwnProperty.call(acfg.tokens, agentId) ? acfg.tokens[agentId] : '';

    if (!token || !expected || !timingSafeEqualStr(token, expected)) {
      if (audit) audit.record({ action: 'agent.auth', actor: agentId || 'unknown', outcome: 'deny', meta: { reason: 'bad token' } });
      send(conn, 'error', { error: 'unauthorized', message: 'Agent authentication failed.' });
      return closeConnection(conn, 'unauthorized');
    }

    // Newest connection for an agent wins; the older one is dropped cleanly.
    const existing = connections.get(agentId);
    if (existing && existing !== conn) closeConnection(existing, 'replaced');
    if (conn.agentId && conn.agentId !== agentId) connections.delete(conn.agentId);

    conn.agentId = agentId;
    conn.authenticated = true;
    conn.lastHeartbeat = Date.now();
    conn.client = { name: payload.client || 'agent', version: payload.version || null, platform: payload.platform || null, tools: Array.isArray(payload.tools) ? payload.tools : [] };
    connections.set(agentId, conn);

    send(conn, 'hello_ack', {
      serverTime: Date.now(),
      session: conn.sessionId,
      heartbeatMs: acfg.heartbeatMs,
      staleMs: acfg.staleMs,
      maxMessageBytes: acfg.maxMessageBytes,
      tools: acfg.tools
    });
    if (audit) audit.record({ action: 'agent.auth', actor: agentId, outcome: 'allow', meta: { client: conn.client.name, platform: conn.client.platform, version: conn.client.version } });
  }

  function onTaskResult(conn, payload) {
    const taskId = payload.taskId;
    if (!taskId || !conn.pending.has(taskId)) {
      // Duplicate or unknown result — acknowledge idempotently, do not re-run.
      if (logger) logger.warn('agent_result_unmatched', { agentId: conn.agentId, taskId });
      return;
    }
    const p = conn.pending.get(taskId);
    conn.pending.delete(taskId);
    clearTimeout(p.timer);
    conn.currentTask = null;
    p.resolve(payload);
  }

  function onTaskCancelled(conn, payload) {
    const taskId = payload.taskId;
    if (!taskId || !conn.pending.has(taskId)) return;
    const p = conn.pending.get(taskId);
    conn.pending.delete(taskId);
    clearTimeout(p.timer);
    conn.currentTask = null;
    p.resolve({ taskId, ok: false, error: 'cancelled', cancelled: true });
  }

  function onConnection(socket) {
    socket.setNoDelay(true);
    const conn = {
      agentId: null,
      authenticated: false,
      closed: false,
      socket,
      remote: socket.remoteAddress || 'local',
      connectedAt: Date.now(),
      lastHeartbeat: 0,
      sessionId: newId('agent_sess'),
      guard: createGuard({ ttlMs: Math.max(120000, acfg.clockSkewMs * 3), max: 20000 }),
      seqIn: 0,
      seqOut: 0,
      bad: 0,
      pending: new Map(),
      currentTask: null,
      lastProgress: null
    };

    const decoder = createLineDecoder({
      maxBytes: acfg.maxMessageBytes,
      onLine: (line) => handleLine(conn, line),
      onError: (err) => {
        if (audit) audit.record({ action: 'agent.message_rejected', actor: conn.agentId || 'unknown', outcome: 'deny', meta: { reason: err && err.code } });
        send(conn, 'error', { error: 'message_too_large' });
        closeConnection(conn, 'oversized');
      }
    });

    socket.on('data', (chunk) => { try { decoder(chunk); } catch (e) { /* decoder isolates */ } });
    socket.on('error', (e) => { if (logger) logger.warn('agent_socket_error', { message: e && e.message }); closeConnection(conn, 'socket_error'); });
    socket.on('close', () => closeConnection(conn, 'socket_closed'));
    socket.on('timeout', () => closeConnection(conn, 'socket_timeout'));
    socket.setTimeout(acfg.staleMs);
  }

  /* ------------------------------------------------------------------ lifecycle */

  function buildServer() {
    if (acfg.tls && acfg.tls.enabled) {
      const opts = {};
      try {
        if (acfg.tls.keyFile) opts.key = fs.readFileSync(acfg.tls.keyFile);
        if (acfg.tls.certFile) opts.cert = fs.readFileSync(acfg.tls.certFile);
        if (acfg.tls.caFile) opts.ca = fs.readFileSync(acfg.tls.caFile);
      } catch (e) { throw new ValidationError('Could not read agent TLS key/cert files.'); }
      return tls.createServer(opts, onConnection);
    }
    return net.createServer(onConnection);
  }

  function start() {
    if (server) return Promise.resolve(server.address());
    server = buildServer();
    server.on('error', (e) => { if (logger) logger.error('agent_hub_error', { message: e && e.message }); });
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(acfg.port, acfg.host, () => {
        server.removeListener('error', reject);
        if (logger) logger.info('agent_hub_listening', { host: acfg.host, port: server.address().port, tls: !!(acfg.tls && acfg.tls.enabled) });
        resolve(server.address());
      });
    });
  }

  function stop() {
    return new Promise((resolve) => {
      if (sweeper) { clearInterval(sweeper); sweeper = null; }
      for (const conn of connections.values()) { send(conn, 'bye', {}); closeConnection(conn, 'shutdown'); }
      connections.clear();
      if (!server) return resolve();
      const s = server; server = null;
      s.close(() => resolve());
      setTimeout(resolve, 1000).unref();
    });
  }

  function sweep() {
    const t = Date.now();
    for (const conn of connections.values()) {
      if (conn.lastHeartbeat && (t - conn.lastHeartbeat) > acfg.staleMs) {
        if (audit) audit.record({ action: 'agent.stale', actor: conn.agentId, outcome: 'deny', meta: { ageMs: t - conn.lastHeartbeat } });
        closeConnection(conn, 'stale');
      }
    }
  }

  /* --------------------------------------------------------------------- tasks */

  /**
   * Dispatch a tool task to a connected agent and await its verified result.
   * @param {string} tool
   * @param {object} args
   * @param {{ actor?:object, agentId?:string, timeoutMs?:number, signal?:AbortSignal }} [opts]
   */
  function dispatch(tool, args, opts = {}) {
    const conn = pickConnection(opts.agentId);
    if (!conn) return Promise.reject(new AgentOfflineError('No local agent is connected.'));
    if (conn.pending.size >= acfg.maxConcurrent) return Promise.reject(new AgentBusyError('The local agent is busy with another task.'));
    if (!acfg.tools.includes(tool)) return Promise.reject(new ValidationError(`Tool "${tool}" is not on the agent allowlist.`));

    const taskId = newId('atask');
    const timeoutMs = Math.min(opts.timeoutMs || acfg.taskTimeoutMs, acfg.taskTimeoutMs);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!conn.pending.has(taskId)) return;
        conn.pending.delete(taskId);
        conn.currentTask = null;
        send(conn, 'task_cancel', { taskId, reason: 'timeout' });
        if (audit) audit.record({ action: 'agent.task', actor: conn.agentId, outcome: 'timeout', target: taskId, meta: { tool } });
        reject(new TimeoutError(`Local agent task "${tool}" timed out.`, { taskId }));
      }, timeoutMs);

      if (opts.signal && typeof opts.signal.addEventListener === 'function') {
        if (opts.signal.aborted) { clearTimeout(timer); return reject(new AppError('cancelled', 'Task cancelled.', 499)); }
        opts.signal.addEventListener('abort', () => {
          if (!conn.pending.has(taskId)) return;
          conn.pending.delete(taskId);
          conn.currentTask = null;
          clearTimeout(timer);
          send(conn, 'task_cancel', { taskId, reason: 'cancelled' });
          reject(new AppError('cancelled', 'Task cancelled.', 499));
        }, { once: true });
      }

      conn.pending.set(taskId, { resolve, reject, timer, tool, startedAt: Date.now() });
      conn.currentTask = { taskId, tool, startedAt: Date.now() };
      const sent = send(conn, 'task_invoke', { taskId, tool, args: args || {}, timeoutMs });
      if (sent && audit) audit.record({ action: 'agent.task', actor: conn.agentId, outcome: 'info', target: taskId, meta: { tool } });
      if (!sent) {
        conn.pending.delete(taskId); conn.currentTask = null; clearTimeout(timer);
        reject(new AgentOfflineError('The local agent disconnected before the task was sent.'));
      }
    });
  }

  /** Request cancellation of an in-flight task by id. */
  function cancel(taskId, reason) {
    for (const conn of connections.values()) {
      if (conn.pending.has(taskId)) { send(conn, 'task_cancel', { taskId, reason: reason || 'cancelled' }); return true; }
    }
    return false;
  }

  /* -------------------------------------------------------------------- status */

  function status(agentId) {
    const nowMs = Date.now();
    const agents = Array.from(connections.values()).map((c) => connectionInfo(c, nowMs));
    const online = agents.length > 0;
    if (agentId) {
      const c = connections.get(agentId);
      return { online: !!c && !c.closed, agent: c ? connectionInfo(c, nowMs) : null };
    }
    return {
      online,
      count: agents.length,
      agents,
      config: {
        heartbeatMs: acfg.heartbeatMs,
        staleMs: acfg.staleMs,
        maxConcurrent: acfg.maxConcurrent,
        taskTimeoutMs: acfg.taskTimeoutMs,
        tools: acfg.tools.slice(),
        qaSuites: acfg.qaSuites.slice()
      }
    };
  }

  function startSweeper() {
    sweeper = setInterval(sweep, Math.max(1000, Math.floor(acfg.staleMs / 3)));
    if (sweeper.unref) sweeper.unref();
  }

  return {
    start: async () => { const addr = await start(); startSweeper(); return addr; },
    stop,
    dispatch,
    cancel,
    status,
    agents: authedAgents,
    connectionInfo: (id) => { const c = connections.get(id); return c ? connectionInfo(c, Date.now()) : null; },
    STATUS
  };
}

module.exports = { createAgentHub, STATUS };
