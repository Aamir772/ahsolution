'use strict';
/* ==========================================================================
   server/notifications.js — notification reporting (honest by default)

   There is NO configured notification provider in this build. Every finish
   therefore reports delivered:false with the reason. A provider adapter can be
   added later behind the same interface; until then the system must never
   claim that a notification was sent.
   ========================================================================= */
'use strict';

function createNotifications({ cfg, logger, audit } = {}) {
  const provider = (cfg && cfg.notifications && cfg.notifications.provider) || 'none';

  function describe() {
    return { provider, configured: provider !== 'none' };
  }

  /**
   * @param {{type:string, workflow:string, runId:string, status:string, durationMs?:number}} event
   * @returns {Promise<{delivered:boolean, provider:string, reason:string}>}
   */
  async function notify(event) {
    if (provider === 'none') {
      return { delivered: false, provider: 'none', reason: 'no notification provider configured' };
    }
    /* Unreachable today — no provider is implemented. Kept explicit so a
       future adapter cannot silently claim delivery without confirming. */
    if (logger) logger.warn('notification_provider_unsupported', { provider });
    return { delivered: false, provider, reason: 'provider adapter not implemented' };
  }

  return { describe, notify };
}

module.exports = { createNotifications };
