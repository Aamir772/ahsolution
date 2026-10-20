/* ==========================================================================
   agent/index.js — AH Solution JARVIS local Windows agent (entrypoint)

   A separate process that connects OUTBOUND to the JARVIS backend and executes
   approved, non-destructive local tools (read files within approved roots, list
   project structure, run predefined QA suites). It never opens an inbound
   control port and never runs arbitrary shell commands.

   Run:   node agent/index.js
   Stop:  Ctrl+C (SIGINT) — closes the socket and kills any child processes.

   Configure with environment variables (see agent/.env.example). It refuses to
   start without an agent token and the shared session secret.

   Exports createAgent() so tests can run an agent in-process against a hub.
   ========================================================================== */
'use strict';

const { loadAgentConfig } = require('./config');
const { createAgentTools } = require('./tools');
const { createTransport } = require('./transport');
const { createLogger } = require('../server/logger');

/**
 * Build (but do not start) the agent.
 * @param {object} cfg from loadAgentConfig()
 * @param {{ logger?:object, onStatus?:Function }} [opts]
 */
function createAgent(cfg, opts = {}) {
  const logger = opts.logger || createLogger({ level: cfg.logLevel, service: 'jarvis-agent' });
  const tools = createAgentTools({ cfg, logger });
  /** @type {Set<string>} */
  const running = new Set();

  function onMessage(msg) {
    if (msg.type === 'task_invoke') return onInvoke(msg.payload || {});
    if (msg.type === 'task_cancel') {
      const taskId = msg.payload && msg.payload.taskId;
      const killed = taskId ? tools.cancel(taskId) : false;
      transport.send('task_cancelled', { taskId, killed });
      return undefined;
    }
    return undefined;
  }

  async function onInvoke(payload) {
    const taskId = payload.taskId;
    const tool = payload.tool;
    const args = payload.args || {};
    if (!taskId || !tool) return transport.send('task_result', { taskId, tool, ok: false, error: 'bad_request' });

    if (running.size >= cfg.maxConcurrent) {
      return transport.send('task_result', { taskId, tool, ok: false, error: 'busy', message: 'The agent is already running a task.' });
    }
    running.add(taskId);
    if (logger) logger.info('agent_task_start', { taskId, tool });
    try {
      const result = await tools.invoke(tool, args, {
        taskId,
        onProgress: (p) => transport.send('task_progress', Object.assign({ taskId, tool }, p))
      });
      transport.send('task_result', { taskId, tool, ok: true, result });
      if (logger) logger.info('agent_task_done', { taskId, tool });
    } catch (e) {
      transport.send('task_result', { taskId, tool, ok: false, error: (e && e.code) || 'error', message: String(e && e.message || e).slice(0, 300) });
      if (logger) logger.warn('agent_task_failed', { taskId, tool, message: e && e.message });
    } finally {
      running.delete(taskId);
    }
  }

  const transport = createTransport({ cfg, logger, onMessage, onStatus: opts.onStatus });

  function start() { transport.connect(); return transport; }
  function stop() {
    try { tools.killAll(); } catch (e) { /* ignore */ }
    transport.stop();
  }

  return { cfg, logger, tools, transport, start, stop, status: () => Object.assign(transport.status(), { running: running.size }) };
}

function main() {
  let cfg;
  try {
    cfg = loadAgentConfig();
  } catch (e) {
    console.error('[jarvis-agent] startup failed: ' + e.message);
    process.exit(1);
  }
  const agent = createAgent(cfg);
  if (cfg.tls.enabled && cfg.tls.insecure) agent.logger.warn('agent_tls_insecure', { note: 'TLS certificate verification is disabled' });
  agent.logger.info('agent_starting', {
    agentId: cfg.id,
    backend: cfg.backend.host + ':' + cfg.backend.port,
    tls: cfg.tls.enabled,
    roots: cfg.roots.map((r) => require('path').basename(r)),
    suites: Object.keys(cfg.suites),
    platform: process.platform
  });
  agent.start();

  const shutdown = (sig) => {
    agent.logger.info('agent_shutdown', { signal: sig });
    agent.stop();
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGHUP', () => shutdown('SIGHUP'));
}

if (require.main === module) main();

module.exports = { createAgent, main };
