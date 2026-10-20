/* ==========================================================================
   agent/config.js — local Windows agent configuration (env only)

   The agent is a SEPARATE process. It reads everything from the environment and
   starts with nothing but the connection details; if the token or the shared
   session secret is missing it refuses to start (fail closed).

   Placeholders only — never commit real secrets. See agent/.env.example.
   ========================================================================== */
'use strict';

const path = require('path');

function parseBool(raw, def) {
  if (raw === undefined || raw === '') return def;
  return /^(1|true|yes|on)$/i.test(String(raw).trim());
}
function parseInt10(raw, name, def, min, max, errors) {
  if (raw === undefined || raw === '') return def;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || String(n) !== String(raw).trim()) { errors.push(`${name} must be an integer`); return def; }
  if (n < min || n > max) { errors.push(`${name} must be between ${min} and ${max}`); return def; }
  return n;
}
function parseList(raw) {
  return String(raw || '').split(',').map((s) => s.trim()).filter(Boolean);
}

const BUILTIN_SUITES = {
  'assistant-test': { args: ['--test', 'server/test/*.test.js'] },
  'qa-ai': { args: ['scripts/ai-qa.cjs'] },
  'qa-pages': { args: ['scripts/qa-pages.cjs'] },
  'qa-device': { args: ['scripts/qa-device.cjs'] },
  'qa-scroll': { args: ['scripts/qa-scroll.cjs'] },
  'qa-admin': { args: ['scripts/qa-admin.cjs'] }
};

function loadAgentConfig(env = process.env) {
  const errors = [];
  const roots = parseList(env.AH_AGENT_ROOTS).map((p) => path.resolve(p));
  if (!roots.length) roots.push(process.cwd());

  // QA suite map: { id: { args:[...], cwd? } }. The executable is ALWAYS this
  // node binary (see agent/tools.js) — only args/cwd are configurable.
  let suites = Object.assign({}, BUILTIN_SUITES);
  if (env.AH_AGENT_QA_MAP) {
    try {
      const parsed = JSON.parse(env.AH_AGENT_QA_MAP);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      const custom = {};
      for (const id of Object.keys(parsed)) {
        const def = parsed[id];
        const args = Array.isArray(def) ? def : (def && Array.isArray(def.args) ? def.args : null);
        if (!args || !args.every((a) => typeof a === 'string')) { errors.push(`AH_AGENT_QA_MAP["${id}"] must be an args array`); continue; }
        custom[id] = { args, cwd: def && def.cwd ? path.resolve(def.cwd) : undefined };
      }
      if (env.AH_AGENT_QA_SUITES) suites = custom; // explicit map replaces built-ins
      else suites = Object.assign(suites, custom);
    } catch (e) { errors.push('AH_AGENT_QA_MAP must be valid JSON of { id: { args:[...] } }'); }
  }
  if (env.AH_AGENT_QA_SUITES) {
    const allowed = new Set(parseList(env.AH_AGENT_QA_SUITES));
    const filtered = {};
    for (const id of Object.keys(suites)) if (allowed.has(id)) filtered[id] = suites[id];
    for (const id of allowed) if (!filtered[id]) errors.push(`AH_AGENT_QA_SUITES includes "${id}" but no suite definition was found`);
    suites = filtered;
  }

  const cfg = {
    backend: {
      host: env.AH_AGENT_BACKEND_HOST || '127.0.0.1',
      port: parseInt10(env.AH_AGENT_BACKEND_PORT, 'AH_AGENT_BACKEND_PORT', 8788, 1, 65535, errors)
    },
    id: (env.AH_AGENT_ID || 'local-agent').trim(),
    token: env.AH_AGENT_HUB_TOKEN || '',
    sessionSecret: env.AH_AGENT_SESSION_SECRET || env.AH_SESSION_SECRET || '',
    tls: {
      enabled: parseBool(env.AH_AGENT_TLS, false),
      caFile: env.AH_AGENT_TLS_CA || '',
      servername: env.AH_AGENT_TLS_SERVERNAME || '',
      insecure: parseBool(env.AH_AGENT_TLS_INSECURE, false)
    },
    heartbeatMs: parseInt10(env.AH_AGENT_HEARTBEAT_MS, 'AH_AGENT_HEARTBEAT_MS', 15000, 1000, 300000, errors),
    reconnect: {
      minMs: parseInt10(env.AH_AGENT_RECONNECT_MIN_MS, 'AH_AGENT_RECONNECT_MIN_MS', 500, 100, 60000, errors),
      maxMs: parseInt10(env.AH_AGENT_RECONNECT_MAX_MS, 'AH_AGENT_RECONNECT_MAX_MS', 15000, 1000, 300000, errors)
    },
    roots,
    maxFileBytes: parseInt10(env.AH_AGENT_MAX_FILE_BYTES, 'AH_AGENT_MAX_FILE_BYTES', 262144, 256, 8000000, errors),
    maxOutputBytes: parseInt10(env.AH_AGENT_MAX_OUTPUT_BYTES, 'AH_AGENT_MAX_OUTPUT_BYTES', 65536, 1024, 4000000, errors),
    maxConcurrent: parseInt10(env.AH_AGENT_MAX_CONCURRENT, 'AH_AGENT_MAX_CONCURRENT', 1, 1, 8, errors),
    suites,
    workspace: roots[0],
    logLevel: env.AH_AGENT_LOG_LEVEL || 'info'
  };

  if (!cfg.token) errors.push('AH_AGENT_HUB_TOKEN is required (must match the backend\'s AH_AGENT_HUB_TOKEN / AH_AGENT_HUB_TOKENS)');
  if (!cfg.sessionSecret || cfg.sessionSecret.length < 16) errors.push('AH_AGENT_SESSION_SECRET (>= 16 chars, must match the backend\'s AH_AGENT_SESSION_SECRET or AH_SESSION_SECRET) is required');
  if (cfg.tls.enabled && cfg.tls.insecure) { /* permitted but warned by caller */ }

  if (errors.length) {
    const err = new Error('Invalid agent configuration: ' + errors.join('; '));
    err.code = 'invalid_configuration';
    err.details = errors;
    throw err;
  }
  return cfg;
}

module.exports = { loadAgentConfig, BUILTIN_SUITES };
