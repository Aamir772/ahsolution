/* ==========================================================================
   server/audit.js — audit trail

   Every security-relevant event (auth decisions, tool authorization, task
   transitions, provider calls, approvals) is appended here with a safe,
   secret-free payload. The trail is durable when the jsonfile backend is used.
   ========================================================================== */
'use strict';

const { redact } = require('./security');

/**
 * @param {{ audit: { append: Function, list: Function } }} storage
 * @param {{ info: Function, warn: Function }} logger
 */
function createAudit(storage, logger) {
  /**
   * @param {object} event
   * @param {string} event.action   e.g. "tool.invoke", "task.transition", "auth.denied"
   * @param {string} [event.actor]  principal id
   * @param {string} [event.outcome] "allow"|"deny"|"confirm"|"success"|"error"
   * @param {object} [event.meta]
   */
  async function record(event) {
    const entry = {
      action: String(event.action || 'unknown'),
      actor: event.actor || 'anon',
      outcome: event.outcome || 'info',
      target: event.target || null,
      meta: redact(event.meta || {})
    };
    try {
      await storage.audit.append(entry);
    } catch (e) {
      if (logger) logger.warn('audit_write_failed', { message: e && e.message });
    }
    if (logger && (entry.outcome === 'deny' || entry.action.startsWith('auth'))) {
      logger.warn('audit', entry);
    }
    return entry;
  }

  return { record, list: (limit) => storage.audit.list(limit) };
}

module.exports = { createAudit };
