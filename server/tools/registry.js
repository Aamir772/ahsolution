/* ==========================================================================
   server/tools/registry.js — tool registration, validation, authorization

   Flow for every invocation:
     1. look up the tool (unknown → deny)
     2. validate arguments against the tool schema (untrusted input)
     3. ask permissions.authorize() (risk class + confirmation gate)
     4. execute the handler under a hard timeout
     5. audit the outcome (never the secrets)

   Handlers receive (args, ctx) where ctx = { actor, cfg, logger, signal }.
   ========================================================================== */
'use strict';

const { ToolError, TimeoutError, NotFoundError } = require('../errors');
const { validateArgs } = require('./schema');
const permissions = require('../permissions');

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new TimeoutError(`${label} timed out after ${ms}ms.`)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function createToolRegistry({ cfg, logger, audit }) {
  /** @type {Map<string, object>} */
  const tools = new Map();

  /**
   * @param {object} def
   * @param {string} def.name   unique, snake_case
   * @param {string} def.description
   * @param {string} def.risk   one of permissions.RISKS
   * @param {object} def.schema JSON-schema-ish argument schema
   * @param {(args:object, ctx:object)=>Promise<any>} def.handler
   * @param {number} [def.timeoutMs]
   * @param {boolean} [def.enabled] default true
   */
  function register(def) {
    if (!def || !def.name || typeof def.handler !== 'function') throw new ToolError('Invalid tool definition.');
    if (!permissions.RISKS.includes(def.risk)) throw new ToolError(`Tool "${def.name}" has unknown risk "${def.risk}".`);
    tools.set(def.name, {
      name: def.name,
      description: def.description || '',
      risk: def.risk,
      schema: def.schema || { type: 'object', properties: {} },
      timeoutMs: def.timeoutMs || 15000,
      enabled: def.enabled !== false,
      handler: def.handler,
      source: def.source || 'builtin'
    });
    return def.name;
  }

  const list = () => Array.from(tools.values()).filter((t) => t.enabled)
    .map((t) => ({ name: t.name, description: t.description, risk: t.risk, schema: t.schema, enabled: t.enabled }));
  const get = (name) => tools.get(name) || null;

  /** Tool descriptors in the shape providers expect for function-calling. */
  const forModel = () => list().map((t) => ({ name: t.name, description: t.description, schema: t.schema }));

  /**
   * @param {string} name
   * @param {object} args
   * @param {{actor:object|null, confirmed?:boolean}} opts
   */
  async function invoke(name, args, opts = {}) {
    const tool = get(name);
    if (!tool || !tool.enabled) {
      if (audit) await audit.record({ action: 'tool.invoke', actor: opts.actor && opts.actor.id, target: name, outcome: 'deny', meta: { reason: 'unknown tool' } });
      throw new NotFoundError(`Unknown tool "${name}".`);
    }

    const checked = validateArgs(args, tool.schema);
    if (!checked.ok) {
      if (audit) await audit.record({ action: 'tool.invoke', actor: opts.actor && opts.actor.id, target: name, outcome: 'deny', meta: { reason: 'invalid args', errors: checked.errors } });
      const err = new (require('../errors').ValidationError)(`Invalid arguments for "${name}".`, { errors: checked.errors });
      throw err;
    }

    const decision = permissions.authorize(opts.actor, tool, cfg, { confirmed: opts.confirmed });
    if (!decision.allowed) {
      if (audit) await audit.record({ action: 'tool.invoke', actor: opts.actor && opts.actor.id, target: name, outcome: decision.decision, meta: { risk: tool.risk, reason: decision.reason } });
      permissions.assertAuthorized(opts.actor, tool, cfg, { confirmed: opts.confirmed });
    }

    const started = Date.now();
    try {
      const result = await withTimeout(
        Promise.resolve().then(() => tool.handler(checked.value, { actor: opts.actor, cfg, logger, signal: opts.signal })),
        tool.timeoutMs, `tool "${name}"`
      );
      if (audit) await audit.record({ action: 'tool.invoke', actor: opts.actor && opts.actor.id, target: name, outcome: 'success', meta: { risk: tool.risk, ms: Date.now() - started } });
      return result;
    } catch (e) {
      if (audit) await audit.record({ action: 'tool.invoke', actor: opts.actor && opts.actor.id, target: name, outcome: 'error', meta: { risk: tool.risk, ms: Date.now() - started, error: e && e.code || 'error' } });
      if (e && e.code) throw e;
      throw new ToolError(`Tool "${name}" failed.`, { detail: String(e && e.message || e).slice(0, 200) });
    }
  }

  return { register, list, get, forModel, invoke };
}

module.exports = { createToolRegistry };
