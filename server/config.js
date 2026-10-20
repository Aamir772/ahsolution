/* ==========================================================================
   server/config.js — environment configuration with validation

   * Every setting has a safe development default.
   * Invalid values fail fast at startup (ConfigError) — never at request time.
   * Secrets live only in this object on the server and are redacted by
     safeSummary()/describe() before they are logged or returned.
   * Nothing here reads a key from client-visible code.
   ========================================================================== */
'use strict';

const path = require('path');
const { ConfigError } = require('./errors');

const ENUMS = {
  env: ['development', 'test', 'production'],
  provider: ['none', 'openai', 'gemini', 'local', 'openai-compatible'],
  routing: ['cloud-first', 'local-first', 'local-only', 'cloud-only'],
  logLevel: ['debug', 'info', 'warn', 'error'],
  storage: ['memory', 'jsonfile'],
  voiceProvider: ['none', 'openai']
};

/* Voices accepted by the realtime speech-to-speech model. Kept here so the
   server (not the browser) decides what a client may request. */
const VOICE_NAMES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar'];

const DEFAULT_VOICE_INSTRUCTIONS = [
  'You are the SOLUTION AI voice assistant for ahsolution.live, a technology tutorials and projects site.',
  'Speak naturally, concisely and helpfully. If you are unsure or lack information, say so plainly and do not invent facts.',
  'Never reveal, repeat or ask for secrets, API keys, tokens or credentials.'
].join(' ');

function parseEnum(raw, name, allowed, def, errors) {
  const v = (raw === undefined || raw === '') ? def : String(raw).toLowerCase().trim();
  if (!allowed.includes(v)) { errors.push(`${name} must be one of: ${allowed.join(', ')}`); return def; }
  return v;
}
function parseInt10(raw, name, def, min, max, errors) {
  if (raw === undefined || raw === '') return def;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || String(n) !== String(raw).trim()) { errors.push(`${name} must be an integer`); return def; }
  if (n < min || n > max) { errors.push(`${name} must be between ${min} and ${max}`); return def; }
  return n;
}
function parseBool(raw, def) {
  if (raw === undefined || raw === '') return def;
  return /^(1|true|yes|on)$/i.test(String(raw).trim());
}
function parseList(raw) {
  return String(raw || '').split(',').map((s) => s.trim()).filter(Boolean);
}
function isLocalHost(urlish) {
  try { const u = new URL(urlish); return ['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(u.hostname); }
  catch (e) { return false; }
}
function isLocalHostname(host) {
  return ['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(String(host || '').toLowerCase());
}

/**
 * @param {Record<string,string|undefined>} [env]
 */
function loadConfig(env = process.env) {
  const errors = [];

  const mode = parseEnum(env.AH_ASSISTANT_ENV || env.NODE_ENV, 'AH_ASSISTANT_ENV', ENUMS.env, 'development', errors);
  const isProd = mode === 'production';
  const isTest = mode === 'test';

  const http = {
    host: env.AH_ASSISTANT_HOST || '127.0.0.1',
    port: parseInt10(env.AH_ASSISTANT_PORT, 'AH_ASSISTANT_PORT', 8787, 1, 65535, errors),
    maxBodyBytes: parseInt10(env.AH_MAX_BODY_BYTES, 'AH_MAX_BODY_BYTES', 32768, 1024, 1_000_000, errors),
    requestTimeoutMs: parseInt10(env.AH_REQUEST_TIMEOUT_MS, 'AH_REQUEST_TIMEOUT_MS', 30000, 1000, 300000, errors),
    allowedOrigins: parseList(env.AH_ASSISTANT_ALLOWED_ORIGINS)
  };

  const log = {
    level: parseEnum(env.AH_ASSISTANT_LOG_LEVEL, 'AH_ASSISTANT_LOG_LEVEL', ENUMS.logLevel, isTest ? 'error' : 'info', errors)
  };

  const providerName = parseEnum(env.AH_PROVIDER, 'AH_PROVIDER', ENUMS.provider, 'none', errors);
  const routing = parseEnum(env.AH_ROUTING, 'AH_ROUTING', ENUMS.routing, 'cloud-first', errors);
  const baseUrl = (env.AH_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const localBaseUrl = (env.AH_LOCAL_BASE_URL || 'http://127.0.0.1:11434/v1').replace(/\/$/, '');
  const isLocalPrimary = providerName === 'local' || (providerName === 'openai-compatible' && isLocalHost(baseUrl));

  const provider = {
    name: providerName,
    routing,
    model: env.AH_MODEL || '',
    apiKey: env.AH_API_KEY || '',
    baseUrl,
    localEnabled: parseBool(env.AH_LOCAL_ENABLED, false) || providerName === 'local',
    localBaseUrl,
    localModel: env.AH_LOCAL_MODEL || 'llama3.1',
    maxOutputTokens: parseInt10(env.AH_MAX_OUTPUT_TOKENS, 'AH_MAX_OUTPUT_TOKENS', 700, 16, 8192, errors),
    timeoutMs: parseInt10(env.AH_PROVIDER_TIMEOUT_MS, 'AH_PROVIDER_TIMEOUT_MS', 20000, 1000, 120000, errors)
  };

  // A cloud provider requires a key; a local target must not silently claim to be cloud.
  const cloudKeyRequired = (providerName === 'openai' || providerName === 'gemini' ||
    (providerName === 'openai-compatible' && !isLocalPrimary));
  if (cloudKeyRequired && !provider.apiKey) {
    errors.push(`AH_API_KEY is required when AH_PROVIDER=${providerName}`);
  }

  const limits = {
    rateLimit: parseInt10(env.AH_RATE_LIMIT, 'AH_RATE_LIMIT', 20, 1, 100000, errors),
    rateWindowMs: parseInt10(env.AH_RATE_WINDOW_MS, 'AH_RATE_WINDOW_MS', 60000, 1000, 86400000, errors),
    dailyLimit: parseInt10(env.AH_DAILY_LIMIT, 'AH_DAILY_LIMIT', 200, 1, 1000000, errors)
  };

  const auth = {
    adminToken: env.AH_ADMIN_TOKEN || '',
    agentToken: env.AH_AGENT_TOKEN || '',
    sessionSecret: env.AH_SESSION_SECRET || '',
    adminEmails: parseList(env.ADMIN_EMAILS).map((s) => s.toLowerCase()),
    supabaseUrl: (env.SUPABASE_URL || '').replace(/\/$/, ''),
    supabaseAnonKey: env.SUPABASE_ANON_KEY || '',
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY || ''
  };
  const supabaseAdminReady = !!(auth.supabaseUrl && (auth.supabaseAnonKey || auth.supabaseServiceRoleKey) && auth.adminEmails.length);

  const storageDriver = parseEnum(env.AH_STORAGE_DRIVER, 'AH_STORAGE_DRIVER', ENUMS.storage, isTest ? 'memory' : 'jsonfile', errors);
  const storage = {
    driver: storageDriver,
    dataDir: env.AH_DATA_DIR || path.join(__dirname, '.data')
  };

  const features = {
    tools: parseBool(env.AH_ENABLE_TOOLS, true),
    voice: parseBool(env.AH_ENABLE_VOICE, false),
    requireDurableLimit: parseBool(env.AH_REQUIRE_DURABLE_LIMIT, false)
  };

  /* Real speech-to-speech voice. The permanent provider key lives only here,
     never in client-visible code. The server relays the WebRTC SDP offer to the
     provider and returns only the SDP answer (see server/voice.js). */
  const voiceProviderName = parseEnum(env.AH_VOICE_PROVIDER, 'AH_VOICE_PROVIDER', ENUMS.voiceProvider, 'openai', errors);
  const voiceName = (env.AH_VOICE_NAME || 'marin').trim();
  const voice = {
    provider: voiceProviderName,
    apiKey: env.AH_VOICE_API_KEY || env.AH_API_KEY || '',
    baseUrl: (env.AH_VOICE_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
    model: env.AH_VOICE_MODEL || 'gpt-realtime',
    voice: voiceName,
    /* clients may only request a voice from this set (configured voice included) */
    voices: VOICE_NAMES.includes(voiceName) ? VOICE_NAMES.slice() : VOICE_NAMES.concat([voiceName]),
    ttlSeconds: parseInt10(env.AH_VOICE_TTL_SECONDS, 'AH_VOICE_TTL_SECONDS', 600, 10, 7200, errors),
    maxSessionSeconds: parseInt10(env.AH_VOICE_MAX_SECONDS, 'AH_VOICE_MAX_SECONDS', 300, 30, 7200, errors),
    requireAuth: parseBool(env.AH_VOICE_REQUIRE_AUTH, isProd),
    instructions: env.AH_VOICE_INSTRUCTIONS || DEFAULT_VOICE_INSTRUCTIONS,
    safetyIdentifier: env.AH_VOICE_SAFETY_ID || '',
    timeoutMs: parseInt10(env.AH_VOICE_TIMEOUT_MS, 'AH_VOICE_TIMEOUT_MS', 15000, 1000, 120000, errors)
  };
  voice.available = features.voice && voice.provider === 'openai' && !!voice.apiKey;

  /* Local Windows agent (Milestone 4). The agent runs as a SEPARATE process and
     connects OUTBOUND to this backend; there is no inbound PC-control port on
     the agent. It authenticates with a unique, revocable HUB token (AH_AGENT_HUB_TOKEN,
     or a JSON map AH_AGENT_HUB_TOKENS for multiple agents) and every message is
     HMAC-signed with AH_SESSION_SECRET.

     Deliberately separate from AH_AGENT_TOKEN: that value is the pre-existing
     HTTP "agent" API principal (security.js), whereas the hub token only ever
     authorises an outbound agent session. One leaked value must not unlock both
     the HTTP API and the agent channel. */
  const agentTokens = {};
  if (env.AH_AGENT_HUB_TOKENS) {
    try {
      const parsed = JSON.parse(env.AH_AGENT_HUB_TOKENS);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const k of Object.keys(parsed)) if (parsed[k]) agentTokens[String(k)] = String(parsed[k]);
      } else { errors.push('AH_AGENT_HUB_TOKENS must be a JSON object of { agentId: token }'); }
    } catch (e) { errors.push('AH_AGENT_HUB_TOKENS must be valid JSON'); }
  }
  const singleAgentId = (env.AH_AGENT_ID || 'local-agent').trim();
  if (env.AH_AGENT_HUB_TOKEN) agentTokens[singleAgentId] = env.AH_AGENT_HUB_TOKEN;

  const agent = {
    enabled: parseBool(env.AH_ENABLE_AGENT, false),
    host: env.AH_AGENT_HOST || '127.0.0.1',
    port: parseInt10(env.AH_AGENT_PORT, 'AH_AGENT_PORT', 8788, 1, 65535, errors),
    id: singleAgentId,
    tokens: agentTokens,
    /* Shared HMAC secret for agent-message signing. Defaults to the HTTP session
       secret so it works out of the box; set AH_AGENT_SESSION_SECRET on BOTH
       sides for a dedicated secret so the agent process never has to hold the
       HTTP session-signing secret. */
    sessionSecret: env.AH_AGENT_SESSION_SECRET || auth.sessionSecret,
    heartbeatMs: parseInt10(env.AH_AGENT_HEARTBEAT_MS, 'AH_AGENT_HEARTBEAT_MS', 15000, 1000, 300000, errors),
    staleMs: parseInt10(env.AH_AGENT_STALE_MS, 'AH_AGENT_STALE_MS', 45000, 2000, 600000, errors),
    clockSkewMs: parseInt10(env.AH_AGENT_CLOCK_SKEW_MS, 'AH_AGENT_CLOCK_SKEW_MS', 60000, 5000, 600000, errors),
    maxMessageBytes: parseInt10(env.AH_AGENT_MAX_MESSAGE_BYTES, 'AH_AGENT_MAX_MESSAGE_BYTES', 262144, 4096, 8000000, errors),
    maxConcurrent: parseInt10(env.AH_AGENT_MAX_CONCURRENT, 'AH_AGENT_MAX_CONCURRENT', 2, 1, 32, errors),
    taskTimeoutMs: parseInt10(env.AH_AGENT_TASK_TIMEOUT_MS, 'AH_AGENT_TASK_TIMEOUT_MS', 120000, 1000, 1800000, errors),
    /* Backend-side allowlists (defence in depth; the agent enforces its own). */
    tools: parseList(env.AH_AGENT_TOOLS).length ? parseList(env.AH_AGENT_TOOLS) : ['agent_status', 'files_list', 'files_read', 'project_inspect', 'qa_run'],
    qaSuites: parseList(env.AH_AGENT_QA_SUITES).length ? parseList(env.AH_AGENT_QA_SUITES) : ['assistant-test', 'qa-ai', 'qa-pages', 'qa-device', 'qa-scroll', 'qa-admin'],
    tls: {
      enabled: parseBool(env.AH_AGENT_TLS, false),
      keyFile: env.AH_AGENT_TLS_KEY || '',
      certFile: env.AH_AGENT_TLS_CERT || '',
      caFile: env.AH_AGENT_TLS_CA || ''
    }
  };
  agent.available = agent.enabled && Object.keys(agent.tokens).length > 0 && !!agent.sessionSecret;
  if (isProd && agent.enabled && !agent.tls.enabled && !isLocalHostname(agent.host)) {
    errors.push('AH_AGENT_TLS must be enabled when the agent hub binds to a non-local address in production');
  }

  /* Bounded workflows (Milestone 5). Default-deny: only registered workflows
     can run, and only their declared tools. autoWriteTools is the ONE
     "approved automatic-write policy" — tools in this list may run inside a
     workflow without a per-step confirmation, and only because each such tool
     is itself create-only within an approved directory (never destructive). */
  const workflows = {
    enabled: parseBool(env.AH_ENABLE_WORKFLOWS, true),
    maxConcurrentRuns: parseInt10(env.AH_WORKFLOW_MAX_CONCURRENT, 'AH_WORKFLOW_MAX_CONCURRENT', 3, 1, 32, errors),
    defaultTimeoutMs: parseInt10(env.AH_WORKFLOW_TIMEOUT_MS, 'AH_WORKFLOW_TIMEOUT_MS', 900000, 1000, 7200000, errors),
    approvalTtlMs: parseInt10(env.AH_WORKFLOW_APPROVAL_TTL_MS, 'AH_WORKFLOW_APPROVAL_TTL_MS', 900000, 5000, 86400000, errors),
    autoWriteTools: parseList(env.AH_WORKFLOW_AUTO_WRITE_TOOLS).length
      ? parseList(env.AH_WORKFLOW_AUTO_WRITE_TOOLS)
      : ['draft_write'],
    draftDir: env.AH_DRAFT_DIR || path.join(storage.dataDir, 'drafts'),
    maxResultBytes: parseInt10(env.AH_WORKFLOW_MAX_RESULT_BYTES, 'AH_WORKFLOW_MAX_RESULT_BYTES', 16384, 512, 262144, errors)
  };

  /* Scheduler (Milestone 5). OFF by default: no recurring job ever runs
     without explicit operator configuration (AH_SCHEDULER_ENABLED=1 AND an
     explicitly enabled schedule). Single-instance by design — see
     reference/jarvis-workflows.md for the limitation. */
  let schedulerTz = env.AH_SCHEDULER_TZ || 'UTC';
  try { new Intl.DateTimeFormat('en-US', { timeZone: schedulerTz }); }
  catch (e) { errors.push(`AH_SCHEDULER_TZ "${schedulerTz}" is not a valid IANA timezone`); schedulerTz = 'UTC'; }
  const scheduler = {
    enabled: parseBool(env.AH_SCHEDULER_ENABLED, false),
    tickMs: parseInt10(env.AH_SCHEDULER_TICK_MS, 'AH_SCHEDULER_TICK_MS', 30000, 1000, 3600000, errors),
    timezone: schedulerTz,
    maxConcurrentJobs: parseInt10(env.AH_SCHEDULER_MAX_CONCURRENT, 'AH_SCHEDULER_MAX_CONCURRENT', 3, 1, 32, errors),
    misfireGraceMs: parseInt10(env.AH_SCHEDULER_MISFIRE_GRACE_MS, 'AH_SCHEDULER_MISFIRE_GRACE_MS', 300000, 1000, 86400000, errors),
    misfirePolicy: parseEnum(env.AH_SCHEDULER_MISFIRE_POLICY, 'AH_SCHEDULER_MISFIRE_POLICY', ['skip', 'run-once'], 'skip', errors),
    maxHistory: parseInt10(env.AH_SCHEDULER_MAX_HISTORY, 'AH_SCHEDULER_MAX_HISTORY', 50, 5, 500, errors)
  };

  // Production hardening.
  if (isProd) {
    if (!http.allowedOrigins.length) errors.push('AH_ASSISTANT_ALLOWED_ORIGINS is required in production');
    if (http.allowedOrigins.includes('*')) errors.push('AH_ASSISTANT_ALLOWED_ORIGINS must not be "*" in production');
    if (!auth.sessionSecret || auth.sessionSecret.length < 24) {
      errors.push('AH_SESSION_SECRET (>= 24 chars) is required in production');
    }
    if (auth.adminToken) errors.push('AH_ADMIN_TOKEN must not be set in production (use Supabase admin auth)');
  }
  const adminAuthConfigured = supabaseAdminReady || !!auth.adminToken;
  // Note: a missing admin auth config is NOT fatal — the server starts and only
  // admin-only routes stay locked. It is surfaced in /health and the logs.

  if (errors.length) {
    throw new ConfigError('Invalid configuration: ' + errors.join('; '), { errors });
  }

  return {
    env: mode, isProd, isTest,
    http, log, provider, limits, auth, storage, features, voice, agent, workflows, scheduler,
    meta: { supabaseAdminReady, adminAuthConfigured, cloudKeyRequired, localPrimary: isLocalPrimary, voiceAvailable: voice.available }
  };
}

/**
 * Safe, non-secret summary for /health and logs.
 * @param {ReturnType<typeof loadConfig>} cfg
 */
function safeSummary(cfg) {
  return {
    env: cfg.env,
    provider: {
      name: cfg.provider.name,
      routing: cfg.provider.routing,
      model: cfg.provider.model || null,
      cloudKeyPresent: !!cfg.provider.apiKey,
      localEnabled: cfg.provider.localEnabled,
      localBaseUrl: cfg.provider.localBaseUrl
    },
    storage: cfg.storage.driver,
    auth: {
      adminTokenPresent: !!cfg.auth.adminToken,
      agentTokenPresent: !!cfg.auth.agentToken,
      sessionSecretPresent: !!cfg.auth.sessionSecret,
      supabaseConfigured: cfg.meta.supabaseAdminReady,
      adminEmailCount: cfg.auth.adminEmails.length
    },
    features: cfg.features,
    voice: {
      enabled: cfg.features.voice,
      provider: cfg.voice.provider,
      model: cfg.voice.model,
      voice: cfg.voice.voice,
      keyPresent: !!cfg.voice.apiKey,
      available: cfg.meta.voiceAvailable,
      requireAuth: cfg.voice.requireAuth,
      maxSessionSeconds: cfg.voice.maxSessionSeconds
    },
    agent: {
      enabled: cfg.agent.enabled,
      available: cfg.agent.available,
      host: cfg.agent.host,
      port: cfg.agent.port,
      tls: cfg.agent.tls.enabled,
      tokenPresent: Object.keys(cfg.agent.tokens).length > 0,
      agentIds: Object.keys(cfg.agent.tokens),
      tools: cfg.agent.tools,
      heartbeatMs: cfg.agent.heartbeatMs,
      staleMs: cfg.agent.staleMs,
      taskTimeoutMs: cfg.agent.taskTimeoutMs
    },
    workflows: {
      enabled: cfg.workflows.enabled,
      maxConcurrentRuns: cfg.workflows.maxConcurrentRuns,
      approvalTtlMs: cfg.workflows.approvalTtlMs,
      autoWriteTools: cfg.workflows.autoWriteTools
    },
    scheduler: {
      enabled: cfg.scheduler.enabled,
      timezone: cfg.scheduler.timezone,
      tickMs: cfg.scheduler.tickMs,
      maxConcurrentJobs: cfg.scheduler.maxConcurrentJobs,
      misfirePolicy: cfg.scheduler.misfirePolicy
    }
  };
}

module.exports = { loadConfig, safeSummary, ENUMS };
