'use strict';
/* ==========================================================================
   server/workflows/registry.js — versioned workflow definitions (default-deny)

   A workflow definition is declarative data plus an optional `expand()`
   resolver. Code — never the model — decides which workflows exist, which
   tools each step may call, and how a run is judged. Anything not registered
   here is rejected.

   Definition shape:
     id            stable snake/kebab id            /^[a-z][a-z0-9-]{1,63}$/
     version       semver                           /^\d+\.\d+\.\d+$/
     title/description
     permissionClass   one of permissions.RISKS
     requiresApproval  workflow-level approval gate (bound + expiring)
     inputs/outputs    bounded object schemas (additionalProperties:false)
     steps[]           ordered; deps must reference EARLIER steps (acyclic)
         { id, label, tool, argsTemplate, dependsOn[], timeoutMs, retryable,
           maxRetries, optional }
         argsTemplate values may interpolate:
             ${inputs.<path>}      run inputs (validated)
             ${steps.<stepId>.<path>}  a previous step's stored result
     expand(inputs, cfg)  optional: derive steps from validated inputs
                          (validated against the same rules + wf.tools)
     limits        { timeoutMs, maxRetries, maxActiveRuns, backoffBaseMs }
     checkpoint/resume      persistence policy flags (default on)
     successCriteria[]      final verification: [{ step, expect }]
     failureCriteria[]      explicit failure triggers: [{ step, expect }]
     resultSchema           minimal shape the consolidated report must match
     auditRequired          default true
     requirements[]         ['model', 'tool:<name>'] capability preconditions
     supported / unsupportedReason   static "cannot run" marker
   ========================================================================= */

const permissions = require('../permissions');
const { ValidationError, AppError } = require('../errors');

const MAX_STEPS = 20;
const ID_RE = /^[a-z][a-z0-9-]{1,63}$/;
const STEP_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const VERSION_RE = /^\d+\.\d+\.\d+$/;
const TOOL_RE = /^[a-z][a-z0-9_]{1,63}$/;
const INPUT_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object']);
const MAX_RESULT_BYTES = 262144;

/** @type {Map<string, object>} key `${id}@${version}` and `${id}` (latest). */
const WORKFLOWS = new Map();
const VERSIONS = new Map(); // id -> Set of versions

function fail(msg) { throw new ValidationError(`workflow_definition_invalid: ${msg}`); }

/* ------------------------------------------------------------- schema check */

function validateInputSchema(schema, where) {
  if (!schema || typeof schema !== 'object') fail(`${where}: inputs must be an object schema`);
  if (schema.type !== 'object') fail(`${where}: inputs.type must be "object"`);
  if (schema.additionalProperties !== false) fail(`${where}: inputs must set additionalProperties:false`);
  const props = schema.properties || {};
  for (const [key, p] of Object.entries(props)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key)) fail(`${where}: bad input name "${key}"`);
    if (!p || typeof p !== 'object') fail(`${where}: input "${key}" must be a schema object`);
    if (!INPUT_TYPES.has(p.type)) fail(`${where}: input "${key}" has unsupported type "${p.type}"`);
    if (p.enum && (!Array.isArray(p.enum) || !p.enum.length)) fail(`${where}: input "${key}" enum must be a non-empty array`);
    if (p.type === 'array' && p.items && p.items.type !== 'string') fail(`${where}: input "${key}" arrays must hold strings`);
    if (p.type === 'object') {
      if (p.additionalProperties === undefined || p.additionalProperties !== false) fail(`${where}: object input "${key}" must set additionalProperties:false`);
      validateInputSchema({ type: 'object', additionalProperties: false, properties: p.properties || {} }, `${where} (${key})`);
    }
    if (p.maxLength && p.maxLength > 4096) fail(`${where}: input "${key}" maxLength too large`);
  }
}

/**
 * Outputs are documentation/report shape only — never applied to run data —
 * so they get a looser structural check than inputs.
 */
function validateOutputSchema(schema, where) {
  if (!schema || typeof schema !== 'object') fail(`${where}: outputs must be an object schema`);
  if (schema.type !== 'object') fail(`${where}: outputs.type must be "object"`);
  if (schema.additionalProperties !== false) fail(`${where}: outputs must set additionalProperties:false`);
  for (const [key, p] of Object.entries(schema.properties || {})) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key)) fail(`${where}: bad output name "${key}"`);
    if (!p || typeof p !== 'object' || !INPUT_TYPES.has(p.type)) fail(`${where}: output "${key}" needs a supported type`);
  }
}

/**
 * Validate run inputs against a definition schema.
 * Applies defaults, rejects unknown/missing/wrong-typed/out-of-enum values.
 */
function applyInputs(schema, raw) {
  const props = (schema && schema.properties) || {};
  const input = raw == null ? {} : raw;
  if (typeof input !== 'object' || Array.isArray(input)) throw new ValidationError('inputs must be an object.');
  const out = {};
  for (const key of Object.keys(input)) {
    if (!Object.prototype.hasOwnProperty.call(props, key)) throw new ValidationError(`Unknown input "${key}".`);
  }
  for (const [key, p] of Object.entries(props)) {
    let v = input[key];
    if (v === undefined || v === null) {
      if (p.default !== undefined) v = p.default;
      else if (p.required) throw new ValidationError(`Input "${key}" is required.`);
      else continue;
    }
    if (p.type === 'string') {
      if (typeof v !== 'string') throw new ValidationError(`Input "${key}" must be a string.`);
      if (p.maxLength && v.length > p.maxLength) throw new ValidationError(`Input "${key}" is too long (max ${p.maxLength}).`);
    } else if (p.type === 'number' || p.type === 'integer') {
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new ValidationError(`Input "${key}" must be a number.`);
      if (p.type === 'integer' && !Number.isInteger(v)) throw new ValidationError(`Input "${key}" must be an integer.`);
      if (p.min !== undefined && v < p.min) throw new ValidationError(`Input "${key}" must be >= ${p.min}.`);
      if (p.max !== undefined && v > p.max) throw new ValidationError(`Input "${key}" must be <= ${p.max}.`);
    } else if (p.type === 'boolean') {
      if (typeof v !== 'boolean') throw new ValidationError(`Input "${key}" must be a boolean.`);
    } else if (p.type === 'array') {
      if (!Array.isArray(v)) throw new ValidationError(`Input "${key}" must be an array.`);
      const maxItems = p.maxItems || 8;
      if (v.length > maxItems) throw new ValidationError(`Input "${key}" allows at most ${maxItems} items.`);
      for (const item of v) {
        if (typeof item !== 'string') throw new ValidationError(`Input "${key}" must contain only strings.`);
        if (p.items && p.items.maxLength && item.length > p.items.maxLength) throw new ValidationError(`Input "${key}" contains an item that is too long.`);
      }
    } else if (p.type === 'object') {
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ValidationError(`Input "${key}" must be an object.`);
      if (Buffer.byteLength(JSON.stringify(v), 'utf8') > 8192) throw new ValidationError(`Input "${key}" is too large (max 8KB).`);
      /* Nested schemas are validated recursively with the same strictness. */
      v = applyInputs({ type: 'object', additionalProperties: false, properties: p.properties || {} }, v);
      for (const k of Object.keys(v)) {
        if (!Object.prototype.hasOwnProperty.call(p.properties || {}, k)) throw new ValidationError(`Unknown input "${key}.${k}".`);
      }
    }
    if (p.enum && !p.enum.includes(v)) throw new ValidationError(`Input "${key}" must be one of: ${p.enum.join(', ')}.`);
    out[key] = v;
  }
  return out;
}

/* ------------------------------------------------------------------- steps */

function validateSteps(steps, wfTools, where) {
  if (!Array.isArray(steps) || !steps.length) fail(`${where}: at least one step is required`);
  if (steps.length > MAX_STEPS) fail(`${where}: too many steps (max ${MAX_STEPS})`);
  const seen = new Set();
  const allowed = wfTools ? new Set(wfTools) : null;
  for (const s of steps) {
    if (!s || typeof s !== 'object') fail(`${where}: step must be an object`);
    if (!STEP_ID_RE.test(String(s.id || ''))) fail(`${where}: bad step id "${s.id}"`);
    if (seen.has(s.id)) fail(`${where}: duplicate step id "${s.id}"`);
    if (!TOOL_RE.test(String(s.tool || ''))) fail(`${where}: step "${s.id}" has bad tool name "${s.tool}"`);
    if (allowed && !allowed.has(s.tool)) fail(`${where}: step "${s.id}" uses tool "${s.tool}" outside the workflow's permitted tools`);
    const deps = s.dependsOn || [];
    if (!Array.isArray(deps)) fail(`${where}: step "${s.id}" dependsOn must be an array`);
    for (const d of deps) {
      if (!seen.has(d)) fail(`${where}: step "${s.id}" depends on "${d}" which is not an earlier step (order + acyclicity enforced)`);
    }
    if (Number.isFinite(s.timeoutMs) && (s.timeoutMs < 100 || s.timeoutMs > 7200000)) fail(`${where}: step "${s.id}" timeoutMs out of range`);
    seen.add(s.id);
  }
  return steps;
}

function validateCriteria(list, where) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) fail(`${where}: criteria must be an array`);
  for (const c of list) {
    if (!c || typeof c.step !== 'string' || !c.step.length) fail(`${where}: criterion needs a step id`);
    if (!c.expect || typeof c.expect !== 'object') fail(`${where}: criterion for "${c.step}" needs an expect object`);
    for (const v of Object.values(c.expect)) {
      const t = typeof v;
      if (v !== null && t !== 'string' && t !== 'number' && t !== 'boolean') fail(`${where}: criterion expect values must be scalars`);
    }
  }
  return list;
}

/* --------------------------------------------------------------- registry */

/**
 * Register a workflow definition. Throws ValidationError on any violation.
 * @param {object} def
 */
function register(def) {
  if (!def || typeof def !== 'object') fail('definition must be an object');
  if (!ID_RE.test(String(def.id || ''))) fail(`bad workflow id "${def.id}"`);
  if (!VERSION_RE.test(String(def.version || ''))) fail(`workflow ${def.id}: version must be semver (x.y.z)`);
  const where = `${def.id}@${def.version}`;
  if (!permissions.RISKS.includes(def.permissionClass || 'read')) fail(`${where}: unknown permissionClass "${def.permissionClass}"`);
  validateInputSchema(def.inputs || { type: 'object', properties: {}, additionalProperties: false }, where);
  validateOutputSchema(def.outputs || { type: 'object', properties: {}, additionalProperties: false }, `${where} (outputs)`);

  const steps = def.steps || [];
  if (!steps.length && typeof def.expand !== 'function') fail(`${where}: provide static steps and/or an expand() resolver`);
  if (steps.length) validateSteps(steps, def.tools, where);

  const limits = Object.assign({
    timeoutMs: 300000, maxRetries: 0, maxActiveRuns: 1, backoffBaseMs: 150
  }, def.limits || {});
  if (limits.timeoutMs < 1000 || limits.timeoutMs > 7200000) fail(`${where}: limits.timeoutMs out of range`);
  if (limits.maxRetries < 0 || limits.maxRetries > 5) fail(`${where}: limits.maxRetries must be 0..5`);
  if (limits.maxActiveRuns < 1 || limits.maxActiveRuns > 16) fail(`${where}: limits.maxActiveRuns must be 1..16`);

  const wf = {
    id: def.id,
    version: def.version,
    title: def.title || def.id,
    description: String(def.description || '').slice(0, 500),
    permissionClass: def.permissionClass || 'read',
    requiresApproval: !!def.requiresApproval,
    inputs: def.inputs || { type: 'object', properties: {}, additionalProperties: false },
    outputs: def.outputs || { type: 'object', properties: {}, additionalProperties: false },
    tools: (def.tools || []).slice(),
    steps,
    expand: typeof def.expand === 'function' ? def.expand : null,
    limits,
    checkpoint: def.checkpoint !== false,
    resume: def.resume !== false,
    successCriteria: validateCriteria(def.successCriteria, `${where} successCriteria`),
    failureCriteria: validateCriteria(def.failureCriteria, `${where} failureCriteria`),
    resultSchema: def.resultSchema || null,
    auditRequired: def.auditRequired !== false,
    requirements: Array.isArray(def.requirements) ? def.requirements.slice() : [],
    supported: def.supported !== false,
    unsupportedReason: def.unsupportedReason ? String(def.unsupportedReason).slice(0, 300) : null
  };
  if (wf.resultSchema && typeof wf.resultSchema === 'object' && wf.resultSchema.type !== 'object') fail(`${where}: resultSchema must be an object schema`);

  const key = `${wf.id}@${wf.version}`;
  WORKFLOWS.set(key, wf);
  WORKFLOWS.set(wf.id, wf); // latest registration wins for bare id lookups
  if (!VERSIONS.has(wf.id)) VERSIONS.set(wf.id, new Set());
  VERSIONS.get(wf.id).add(wf.version);
  return wf;
}

/** Look up by id (latest) or `id@version`. Returns null when unknown. */
function get(idOrKey) {
  if (typeof idOrKey !== 'string' || !idOrKey) return null;
  return WORKFLOWS.get(idOrKey) || null;
}

function list() {
  const out = [];
  for (const id of VERSIONS.keys()) {
    const wf = WORKFLOWS.get(id); // bare-id key always holds the latest registration
    if (!wf) continue;
    out.push({
      id: wf.id,
      version: wf.version,
      title: wf.title,
      description: wf.description,
      permissionClass: wf.permissionClass,
      requiresApproval: wf.requiresApproval,
      supported: wf.supported,
      unsupportedReason: wf.unsupportedReason,
      tools: wf.tools.slice(),
      stepCount: wf.steps.length
    });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** Resolve the concrete step list for a run (static, or via expand()). */
function resolveSteps(wf, inputs, cfg) {
  const steps = wf.expand ? wf.expand(inputs, cfg) : wf.steps;
  validateSteps(steps, wf.tools, `${wf.id}@${wf.version} (expanded)`);
  return JSON.parse(JSON.stringify(steps));
}

/**
 * Capability preconditions. Returns {ok, reason}.
 * Checked at run creation — a workflow that needs a missing capability is
 * rejected with an explicit reason instead of failing halfway through.
 */
function availability(wf, { providers, tools } = {}) {
  if (!wf.supported) return { ok: false, reason: wf.unsupportedReason || 'workflow is not supported in this build' };
  for (const req of wf.requirements) {
    if (req === 'model') {
      if (!providers || !providers.hasModel()) return { ok: false, reason: 'no model provider is configured (AH_PROVIDER=none)' };
    } else if (req.startsWith('tool:')) {
      const name = req.slice(5);
      const t = tools && tools.get(name);
      if (!t || !t.enabled) return { ok: false, reason: `required tool "${name}" is not registered` };
    } else if (req === 'agent') {
      // agent tools exist even when the hub is off; they fail honestly at run
      // time with agent_offline, which is a reportable outcome, not a blocker.
      continue;
    }
  }
  return { ok: true, reason: null };
}

/** Unsupported workflows are rejected up front with an explicit code. */
function assertAvailable(wf, ctx) {
  const a = availability(wf, ctx);
  if (!a.ok) throw new AppError('workflow_unsupported', `Workflow "${wf.id}" cannot run: ${a.reason}.`, 501, { reason: a.reason });
  return a;
}

module.exports = {
  register, get, list, resolveSteps, applyInputs, availability, assertAvailable,
  validateSteps, MAX_STEPS,
  /** test helper */
  _clear() { WORKFLOWS.clear(); VERSIONS.clear(); }
};
