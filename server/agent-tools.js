/* ==========================================================================
   server/agent-tools.js — JARVIS tools that execute on the local agent

   These register into the shared tool registry, so every call still passes
   through schema validation, the permission/confirmation gate, a hard timeout
   and auditing (tools/registry.js). The handler then forwards the work to the
   connected local agent via the hub and returns the agent's VERIFIED result.

   Tool semantics: `read` risk (auto-allowed). They are non-destructive and can
   only act within the agent's configured roots / QA allowlist — enforced again
   inside the agent process (the real execution boundary). Nothing here runs on
   the server itself.
   ========================================================================== */
'use strict';

const { ValidationError, NotFoundError, PayloadTooLargeError, AgentOfflineError, ToolError, ToolDeniedError, AgentBusyError } = require('./errors');

const SUITE_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Map an agent-reported error code back to a truthful typed error. */
function mapAgentError(res) {
  const message = res && res.message ? String(res.message).slice(0, 300) : 'The local agent reported a failure.';
  switch (res && res.error) {
    case 'not_found': return new NotFoundError(message);
    case 'path_denied': return new ToolDeniedError(message, { agentError: res && res.error });
    case 'unsupported_type':
    case 'not_a_file':
    case 'not_a_directory':
    case 'invalid_args':
    case 'suite_not_allowed':
    case 'unknown_tool': return new ValidationError(message);
    case 'too_large': return new PayloadTooLargeError(message);
    case 'busy': return new AgentBusyError(message);
    default: return new ToolError(message, { agentError: res && res.error });
  }
}

/**
 * @param {ReturnType<import('./tools/registry').createToolRegistry>} registry
 * @param {{ cfg:object, hub:object, logger:object }} deps
 */
function registerAgentTools(registry, { cfg, hub, logger }) {
  const acfg = cfg.agent || {};

  function requireHub() {
    if (!acfg.enabled || !hub) throw new AgentOfflineError('The local agent feature is not enabled on this server.');
    return hub;
  }

  /** Forward an agent tool call and unwrap the structured result. */
  async function forward(tool, args, ctx) {
    const h = requireHub();
    const res = await h.dispatch(tool, args, {
      actor: ctx && ctx.actor,
      signal: ctx && ctx.signal,
      timeoutMs: acfg.taskTimeoutMs
    });
    if (!res || res.ok === false) throw mapAgentError(res);
    return res.result;
  }

  registry.register({
    name: 'agent_status',
    description: 'Report whether the local Windows agent is connected, its identity and last heartbeat.',
    risk: 'read',
    schema: { type: 'object', properties: { agentId: { type: 'string', maxLength: 100 } } },
    handler: async (args) => {
      if (!acfg.enabled || !hub) return { available: false, online: false, reason: 'agent feature disabled' };
      return Object.assign({ available: true }, hub.status(args && args.agentId));
    }
  });

  /* Agent-forwarded tools run real QA suites on the PC: the registry-level
     hard timeout must exceed the hub's per-task timeout (taskTimeoutMs), or
     long suites would be cut off here before the agent's own limit applies. */
  const forwardTimeoutMs = (acfg.taskTimeoutMs || 120000) + 15000;

  registry.register({
    name: 'files_list',
    description: 'List files and folders inside an approved project directory on the local PC.',
    risk: 'read',
    timeoutMs: forwardTimeoutMs,
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', maxLength: 400, default: '' },
        root: { type: 'string', maxLength: 200 },
        limit: { type: 'integer', min: 1, max: 2000, default: 200 },
        depth: { type: 'integer', min: 0, max: 4, default: 1 }
      },
      additionalProperties: false
    },
    handler: (args, ctx) => forward('files_list', args || {}, ctx)
  });

  registry.register({
    name: 'files_read',
    description: 'Read a UTF-8 text file inside an approved project directory on the local PC (size-limited).',
    risk: 'read',
    timeoutMs: forwardTimeoutMs,
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', required: true, maxLength: 400 },
        root: { type: 'string', maxLength: 200 },
        maxBytes: { type: 'integer', min: 256, max: 262144, default: 65536 }
      },
      additionalProperties: false
    },
    handler: (args, ctx) => forward('files_read', args || {}, ctx)
  });

  registry.register({
    name: 'project_inspect',
    description: 'Summarise the structure of an approved project directory on the local PC (file counts, entries).',
    risk: 'read',
    timeoutMs: forwardTimeoutMs,
    schema: {
      type: 'object',
      properties: {
        root: { type: 'string', maxLength: 200 },
        depth: { type: 'integer', min: 1, max: 4, default: 2 }
      },
      additionalProperties: false
    },
    handler: (args, ctx) => forward('project_inspect', args || {}, ctx)
  });

  registry.register({
    name: 'qa_run',
    description: 'Run a predefined, non-destructive QA suite on the local PC (allowlisted suites only).',
    risk: 'read',
    timeoutMs: forwardTimeoutMs,
    schema: {
      type: 'object',
      properties: {
        suite: { type: 'string', required: true, maxLength: 40 },
        timeoutMs: { type: 'integer', min: 1000, max: 1800000 }
      },
      additionalProperties: false
    },
    handler: async (args, ctx) => {
      const suite = String(args.suite || '');
      if (!SUITE_RE.test(suite)) throw new ValidationError('Invalid QA suite id.');
      if (Array.isArray(acfg.qaSuites) && acfg.qaSuites.length && !acfg.qaSuites.includes(suite)) {
        throw new ValidationError(`QA suite "${suite}" is not on the allowlist. Allowed: ${acfg.qaSuites.join(', ')}.`);
      }
      return forward('qa_run', { suite, timeoutMs: args.timeoutMs }, ctx);
    }
  });

  return registry;
}

module.exports = { registerAgentTools, SUITE_RE };
