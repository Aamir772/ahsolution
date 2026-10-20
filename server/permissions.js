/* ==========================================================================
   server/permissions.js — tool permission model

   Risk classes (a tool declares exactly one):
     read         — inspect data; never mutates anything              → allow
     write        — bounded, reversible change (e.g. draft file)      → confirm
     destructive  — deletes / overwrites existing work                → confirm
     external     — emails, posts, publishes, third-party calls      → confirm
     privileged   — deploy, DNS, credentials, shell                   → confirm
     financial    — purchases, payments                               → confirm

   "allow"    → may run automatically
   "confirm"  → must carry an explicit, per-invocation confirmation
   "deny"     → never runs (hard-blocked regardless of actor)

   Read-only is the default: only `read` runs without confirmation. This module
   is the single place that decides; route handlers and the task runner both
   consult it so the rule cannot drift.
   ========================================================================== */
'use strict';

const { ForbiddenError, ToolDeniedError } = require('./errors');

const RISKS = ['read', 'write', 'destructive', 'external', 'privileged', 'financial'];

/** Default outcome per risk class (before actor/override adjustments). */
const DEFAULT_POLICY = {
  read: 'allow',
  write: 'confirm',
  destructive: 'confirm',
  external: 'confirm',
  privileged: 'confirm',
  financial: 'confirm'
};

/**
 * Names/prefixes that are denied outright unless a human explicitly enables
 * them out-of-band. These are the "never-auto, never-model-driven" actions.
 */
const HARD_DENY = [
  /(^|[_-])shell($|[_-])/i, /(^|[_-])exec($|[_-])/i, /(^|[_-])credential/i,
  /(^|[_-])dns($|[_-])/i, /purchase/i, /payment/i, /wallet/i, /private[_-]?key/i
];

/** Extra guard: content that must never be treated as an instruction. */
const INJECTION_MARKERS = [
  'ignore previous instructions', 'ignore all previous', 'disregard the system',
  'you are now', 'new instructions:', 'system prompt'
];

/**
 * @param {object} cfg
 * @returns {Record<string, 'allow'|'confirm'|'deny'>}
 */
function policyFor(cfg) {
  const p = Object.assign({}, DEFAULT_POLICY);
  // A production server is stricter: local file writes also need confirmation.
  if (cfg && cfg.isProd) p.write = 'confirm';
  return p;
}

/**
 * @param {string} name tool name
 * @returns {boolean}
 */
function isHardDenied(name) {
  return HARD_DENY.some((re) => re.test(String(name || '')));
}

/**
 * Decide whether `actor` may run `tool`.
 * @param {{type:string,id:string}|null} actor
 * @param {{name:string, risk:string}} tool
 * @param {object} cfg
 * @param {{confirmed?:boolean}} [opts]
 * @returns {{decision:'allow'|'confirm'|'deny', allowed:boolean, requiresConfirmation:boolean, reason:string}}
 */
function authorize(actor, tool, cfg, opts = {}) {
  const confirmed = !!(opts && opts.confirmed);

  if (!tool) return { decision: 'deny', allowed: false, requiresConfirmation: false, reason: 'unknown tool' };
  if (isHardDenied(tool.name)) {
    return { decision: 'deny', allowed: false, requiresConfirmation: false, reason: `tool "${tool.name}" is blocked by policy` };
  }
  if (!RISKS.includes(tool.risk)) {
    return { decision: 'deny', allowed: false, requiresConfirmation: false, reason: `unknown risk class "${tool.risk}"` };
  }
  // Anonymous callers may only touch read-only tools.
  if (!actor) {
    if (tool.risk === 'read') return { decision: 'allow', allowed: true, requiresConfirmation: false, reason: 'public read-only tool' };
    throw new ForbiddenError('Authentication required for non-read tools.');
  }

  // The local agent is a high-trust executor but still cannot exceed its grant.
  if (actor.type === 'agent' && (tool.risk === 'privileged' || tool.risk === 'financial')) {
    if (!confirmed) return { decision: 'confirm', allowed: false, requiresConfirmation: true, reason: 'agent requires explicit confirmation for privileged actions' };
  }

  const policy = policyFor(cfg);
  const decision = policy[tool.risk] || 'deny';

  if (decision === 'allow') return { decision, allowed: true, requiresConfirmation: false, reason: 'auto-allowed' };
  if (decision === 'confirm') {
    return {
      decision,
      allowed: confirmed,
      requiresConfirmation: !confirmed,
      reason: confirmed ? 'confirmed' : `${tool.risk} actions require explicit confirmation`
    };
  }
  return { decision: 'deny', allowed: false, requiresConfirmation: false, reason: 'blocked by policy' };
}

/** Throw-friendly wrapper for callers that expect an exception. */
function assertAuthorized(actor, tool, cfg, opts) {
  const r = authorize(actor, tool, cfg, opts);
  if (r.allowed) return r;
  const details = { tool: tool && tool.name, risk: tool && tool.risk, decision: r.decision };
  if (r.decision === 'deny') throw new ToolDeniedError(r.reason, details);
  throw new (require('./errors').ApprovalRequiredError)(r.reason, Object.assign({ requiresConfirmation: true }, details));
}

/** Detect text that tries to override system policy (untrusted content). */
function containsInjection(text) {
  const t = String(text || '').toLowerCase();
  return INJECTION_MARKERS.some((m) => t.includes(m));
}

module.exports = { RISKS, DEFAULT_POLICY, policyFor, isHardDenied, authorize, assertAuthorized, containsInjection, INJECTION_MARKERS };
