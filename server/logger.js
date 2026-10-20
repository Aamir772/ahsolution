/* ==========================================================================
   server/logger.js — structured JSON logger

   One JSON object per line. Values whose keys look like secrets are redacted
   before serialisation, so a careless `logger.info({ cfg })` cannot leak keys.
   ========================================================================== */
'use strict';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const SECRET_KEY = /(api[_-]?key|token|secret|password|authorization|service[_-]?role|bearer|cookie)/i;

/** Recursively copy an object, masking values under secret-looking keys. */
function redactValue(value, depth = 0) {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  const out = {};
  for (const k of Object.keys(value)) {
    out[k] = SECRET_KEY.test(k) ? '[redacted]' : redactValue(value[k], depth + 1);
  }
  return out;
}

function emit(level, service, message, fields) {
  const line = { ts: new Date().toISOString(), level, service, msg: message };
  if (fields !== undefined) line.data = redactValue(fields);
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(JSON.stringify(line));
}

/**
 * @param {{ level?: string, service?: string }} [opts]
 */
function createLogger(opts = {}) {
  const min = LEVELS[opts.level] || LEVELS.info;
  const service = opts.service || 'ah-assistant';
  const logger = {
    service,
    level: opts.level || 'info',
    debug: (m, f) => { if (min <= LEVELS.debug) emit('debug', service, m, f); },
    info: (m, f) => { if (min <= LEVELS.info) emit('info', service, m, f); },
    warn: (m, f) => { if (min <= LEVELS.warn) emit('warn', service, m, f); },
    error: (m, f) => { if (min <= LEVELS.error) emit('error', service, m, f); },
    /** @param {string} name */
    child: (name) => createLogger({ level: opts.level, service: service + ':' + name })
  };
  return logger;
}

module.exports = { createLogger, redactValue, LEVELS };
