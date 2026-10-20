/* ==========================================================================
   server/index.js — AH Solution JARVIS assistant — bootstrap

   Local-first development server. Zero runtime dependencies. It does NOT touch
   the existing website or netlify/functions; it is an isolated backend service.

     node server/index.js            # start with env configuration
     node --test server/test         # run the test suite

   Exports createApp() so tests can build the full app without binding a port.
   ========================================================================== */
'use strict';

const path = require('path');
const { loadConfig } = require('./config');
const { createLogger } = require('./logger');
const { createStorage } = require('./storage');
const { createAudit } = require('./audit');
const { createAuth } = require('./security');
const { createProviders } = require('./providers');
const { createToolRegistry } = require('./tools/registry');
const { registerBuiltinTools } = require('./tools/builtin');
const { createTaskManager } = require('./tasks');
const { createAgentProtocol, createLoopbackAgentLink } = require('./agent');
const { createAgentHub } = require('./agent-hub');
const { registerAgentTools } = require('./agent-tools');
const workflows = require('./workflows');
const { registerContentTools } = require('./tools/content');
const { createScheduler } = require('./scheduler');
const { createNotifications } = require('./notifications');
const { createVoiceSession, createVoiceService } = require('./voice');
const { createRateLimiter } = require('./limits');
const { createRoutes } = require('./routes');
const { createServer } = require('./http');
const { ConfigError } = require('./errors');

const PROJECT_ROOT = path.resolve(__dirname, '..');
let VERSION = '0.0.0';
try { VERSION = require(path.join(PROJECT_ROOT, 'package.json')).version || VERSION; } catch (e) { /* ignore */ }

/**
 * Build the fully-wired application (no port binding).
 * @param {object} [cfg]
 * @param {{ now?: number, rateLimiter?: object }} [opts]
 */
function createApp(cfg, opts = {}) {
  cfg = cfg || loadConfig();
  const logger = createLogger({ level: cfg.log.level, service: 'ah-assistant' });
  const storage = createStorage(cfg);
  const audit = createAudit(storage, logger);
  const auth = createAuth(cfg, logger);
  const providers = createProviders(cfg, logger);

  // Safety: a cloud model must not run without a durable limit unless the
  // operator explicitly opts into the best-effort in-process limiter.
  if (cfg.features.requireDurableLimit && providers.hasModel()) {
    throw new ConfigError('AH_REQUIRE_DURABLE_LIMIT=1 but no durable rate limiter is configured. Unset it to allow the in-process limiter.');
  }

  const tools = createToolRegistry({ cfg, logger, audit });
  registerBuiltinTools(tools, { projectRoot: PROJECT_ROOT });
  registerContentTools(tools, { cfg, providers, logger });

  /* Local-agent hub (Milestone 4). Created only when the feature is enabled AND
     a shared session secret exists; otherwise agent tools report "offline" and
     no transport is opened. The hub is NOT started here — tests and main()
     call hub.start() explicitly. */
  const hub = (cfg.agent && cfg.agent.enabled && cfg.agent.sessionSecret)
    ? createAgentHub({ cfg, logger, audit })
    : null;
  registerAgentTools(tools, { cfg, hub, logger });

  const tasks = createTaskManager(storage, audit, logger);
  const rateLimiter = opts.rateLimiter || createRateLimiter({ limit: cfg.limits.rateLimit, windowMs: cfg.limits.rateWindowMs, dailyLimit: cfg.limits.dailyLimit });

  /* Bounded workflows (Milestone 5): versioned definitions + execution engine.
     Definitions are registered once per process (module-level registry); the
     static definitions are cfg-independent and expand() receives cfg per run. */
  workflows.registerBuiltins();
  const notifications = createNotifications({ cfg, logger, audit });
  const engine = workflows.createWorkflowEngine({ cfg, wfRegistry: workflows, tools, tasks, storage, audit, logger, providers, notifications, now: opts.now });
  /* Restart recovery: runs interrupted mid-execution are paused (resumable),
     never auto-resumed. Await via app.recovered where ordering matters. */
  const recovered = engine.recover().catch((e) => { logger.warn('workflow_recovery_failed', { message: e && e.message }); return 0; });

  /* Scheduler: CRUD always available; the background loop only runs when the
     operator enables it (AH_SCHEDULER_ENABLED=1) — see main(). */
  const scheduler = createScheduler({ cfg, storage, audit, logger, engine, now: opts.now });

  // Local-agent link: loopback reference implementation (real transport later).
  const agent = cfg.auth.sessionSecret
    ? createLoopbackAgentLink({
        secret: cfg.auth.sessionSecret,
        registry: tools,
        actor: { type: 'agent', id: 'local-agent' },
        allowedTools: tools.list().filter((t) => t.risk === 'read').map((t) => t.name)
      })
    : null;

  const voice = createVoiceService({ cfg, logger });
  const voiceSession = cfg.features.voice ? createVoiceSession({ cfg, logger }) : null;

  const startedAt = opts.now || Date.now();
  const { router } = createRoutes({ cfg, logger, providers, tools, storage, audit, tasks, auth, rateLimiter, voice, hub, workflows, engine, scheduler, notifications, version: VERSION, startedAt });
  const server = createServer({ cfg, logger, router, auth, rateLimiter, context: {} });

  return { config: cfg, logger, storage, audit, auth, providers, tools, tasks, agent, voice, voiceSession, hub, engine, scheduler, notifications, recovered, rateLimiter, router, server, version: VERSION, PROJECT_ROOT };
}

function main() {
  let app;
  try {
    app = createApp();
  } catch (e) {
    // Config errors are actionable and safe to print (no secrets included).
    console.error(`[ah-assistant] startup failed: ${e.message}`);
    process.exit(1);
  }
  const { config, server, logger, hub, scheduler } = app;
  server.listen(config.http.port, config.http.host, () => {
    logger.info('listening', { host: config.http.host, port: config.http.port, health: `http://${config.http.host}:${config.http.port}/health` });
    app.recovered.then(() => {
      if (hub) {
        hub.start().catch((e) => logger.error('agent_hub_start_failed', { message: e && e.message }));
      }
      /* Scheduled jobs only run when explicitly enabled in configuration. */
      if (config.scheduler.enabled) scheduler.start();
      else logger.info('scheduler_disabled', { hint: 'set AH_SCHEDULER_ENABLED=1 to run schedules' });
    });
  });
  const shutdown = (sig) => {
    logger.info('shutting_down', { signal: sig });
    scheduler.stop();
    const done = () => server.close(() => app.storage.flush().finally(() => process.exit(0)));
    if (hub) hub.stop().then(done, done); else done();
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

if (require.main === module) main();

module.exports = { createApp, main, VERSION, PROJECT_ROOT };
