/* ==========================================================================
   server/agent.js — local-agent link abstraction (Milestone 1 reference)

   The real transport lives in server/agent-hub.js (backend) and agent/
   (the separate Windows process). This module keeps the protocol re-export
   plus the in-process LoopbackAgentLink that proves the handshake and
   tool-authorization path without a socket.

   The message envelope itself is defined once in server/agent-protocol.js and
   shared by both sides.
   ========================================================================== */
'use strict';

const { createAgentProtocol, PROTOCOL_VERSION, TYPES } = require('./agent-protocol');

/**
 * In-process link that behaves like a connected local agent. It can only run
 * tools on `allowedTools` and only through the shared registry (so permission
 * rules still apply).
 * @param {{secret:string, registry:object, actor:object, allowedTools:string[]}} opts
 */
function createLoopbackAgentLink({ secret, registry, actor, allowedTools }) {
  const protocol = createAgentProtocol({ secret });
  const allow = new Set(allowedTools || []);
  let connected = false;
  /** @type {Set<Function>} */
  const handlers = new Set();

  function emit(msg) { for (const h of handlers) { try { h(msg); } catch (e) { /* isolate handler */ } } }

  async function send(message) {
    const msg = protocol.encode(message);
    if (msg.type === 'hello') {
      connected = true;
      return protocol.encode({ type: 'hello_ack', payload: { agent: 'loopback', tools: Array.from(allow), version: protocol.PROTOCOL_VERSION } });
    }
    if (msg.type === 'heartbeat') return protocol.encode({ type: 'heartbeat_ack', payload: { ts: Date.now() } });
    if (msg.type === 'task_invoke' || msg.type === 'tool_invoke') {
      if (!connected) return protocol.encode({ type: 'error', payload: { error: 'not_connected' } });
      const name = msg.payload && msg.payload.name;
      if (!allow.has(name)) {
        return protocol.encode({ type: 'error', payload: { error: 'tool_not_allowed', name } });
      }
      try {
        const result = await registry.invoke(name, msg.payload.args || {}, { actor, confirmed: !!(msg.payload && msg.payload.confirmed) });
        return protocol.encode({ type: 'task_result', payload: { name, ok: true, result } });
      } catch (e) {
        return protocol.encode({ type: 'task_result', payload: { name, ok: false, error: e && e.code || 'error', message: e && e.message } });
      }
    }
    if (msg.type === 'bye') { connected = false; return null; }
    return protocol.encode({ type: 'error', payload: { error: 'unsupported' } });
  }

  return {
    kind: 'loopback',
    protocol,
    status: () => (connected ? 'connected' : 'disconnected'),
    connect: () => send({ type: 'hello', payload: { client: 'assistant', version: PROTOCOL_VERSION } }),
    /** @param {(msg:object)=>void} handler */
    onMessage: (handler) => { handlers.add(handler); return () => handlers.delete(handler); },
    send,
    close: () => { connected = false; }
  };
}

module.exports = { createAgentProtocol, createLoopbackAgentLink, PROTOCOL_VERSION, TYPES };
