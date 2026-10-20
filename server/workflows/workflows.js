'use strict';
/* ==========================================================================
   server/workflows/workflows.js — initial approved workflow definitions

   A. website-qa               — multi-step QA over registered suites (read)
   B. website-health-audit     — metadata/link/console evidence report (read)
   C. blog-draft-production    — model draft + checks + approved-dir save (write,
                                  approval-gated; only when a model is configured)
   D. approved-file-change     — registered but UNSUPPORTED this milestone
                                  (no patch/apply tool exists; marked clearly)

   No workflow here can run arbitrary commands: each step names one registered
   tool, arguments are interpolated from validated inputs/verified results only.
   ========================================================================= */
'use strict';

const { ValidationError } = require('../errors');

const SUITE_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** All initial workflows for a given server configuration. */
function buildWorkflows() {
  const defs = [];

  /* ------------------------------------------------------ A. Website QA */
  defs.push({
    id: 'website-qa',
    version: '1.0.0',
    title: 'Website QA',
    description: 'Check server and agent health, run the registered QA suites, and consolidate real exit codes. Read-only; never edits website files.',
    permissionClass: 'read',
    requiresApproval: false,
    inputs: {
      type: 'object',
      properties: {
        suites: {
          type: 'array',
          maxItems: 6,
          items: { type: 'string', maxLength: 40 },
          description: 'QA suite ids; defaults to every suite on the agent allowlist.'
        }
      },
      additionalProperties: false
    },
    outputs: { type: 'object', properties: { exitCodes: { type: 'object' } }, additionalProperties: false },
    tools: ['service_health', 'agent_status', 'qa_run'],
    limits: { timeoutMs: 1800000, maxRetries: 0, maxActiveRuns: 1 },
    checkpoint: true,
    resume: true,
    successCriteria: [{ step: 'run-qa-*', expect: { exitCode: 0 } }],
    resultSchema: { type: 'object', required: ['exitCodes'] },
    auditRequired: true,
    expand(inputs, cfg) {
      let suites = inputs.suites && inputs.suites.length
        ? inputs.suites.slice()
        : ((cfg && cfg.agent && cfg.agent.enabled && cfg.agent.qaSuites.length) ? cfg.agent.qaSuites.slice() : ['qa-pages']);
      suites = suites.map((s) => String(s).toLowerCase().trim());
      for (const s of suites) {
        if (!SUITE_RE.test(s)) throw new ValidationError(`Invalid QA suite id "${s}".`);
        const allow = cfg && cfg.agent && cfg.agent.qaSuites;
        if (Array.isArray(allow) && allow.length && !allow.includes(s)) {
          throw new ValidationError(`QA suite "${s}" is not authorized. Allowed: ${allow.join(', ')}.`);
        }
      }
      suites = Array.from(new Set(suites));
      if (suites.length > 6) throw new ValidationError('At most 6 QA suites per run.');
      return [
        { id: 'check-server', label: 'Check backend health', tool: 'service_health', argsTemplate: {}, dependsOn: [] },
        { id: 'check-agent', label: 'Check local agent', tool: 'agent_status', argsTemplate: {}, dependsOn: ['check-server'] },
        ...suites.map((suite) => ({
          id: `run-qa-${suite}`,
          label: `QA suite "${suite}"`,
          tool: 'qa_run',
          argsTemplate: { suite },
          dependsOn: ['check-agent'],
          timeoutMs: 900000,
          retryable: false
        }))
      ];
    }
  });

  /* --------------------------------------------- B. Website health audit */
  defs.push({
    id: 'website-health-audit',
    version: '1.0.0',
    title: 'Website health audit',
    description: 'Read approved routes, run structural metadata/link checks, and (when the agent is online) a browser console pass. Produces evidence: confirmed defects vs suspected issues. Never modifies anything.',
    permissionClass: 'read',
    requiresApproval: false,
    inputs: { type: 'object', properties: {}, additionalProperties: false },
    tools: ['project_read_file', 'content_check', 'qa_run'],
    limits: { timeoutMs: 600000, maxRetries: 0, maxActiveRuns: 1 },
    checkpoint: true,
    resume: true,
    successCriteria: [
      { step: 'check-index', expect: { ok: true } },
      { step: 'check-blog', expect: { ok: true } }
    ],
    resultSchema: { type: 'object', required: ['exitCodes'] },
    auditRequired: true,
    steps: [
      { id: 'inspect-index', label: 'Read index.html', tool: 'project_read_file', argsTemplate: { path: 'index.html', maxBytes: 200000 }, dependsOn: [] },
      { id: 'check-index', label: 'Check index metadata/links', tool: 'content_check', argsTemplate: { kind: 'html', text: '${steps.inspect-index.content}' }, dependsOn: ['inspect-index'] },
      { id: 'inspect-blog', label: 'Read blog.html', tool: 'project_read_file', argsTemplate: { path: 'blog.html', maxBytes: 200000 }, dependsOn: [] },
      { id: 'check-blog', label: 'Check blog metadata/links', tool: 'content_check', argsTemplate: { kind: 'html', text: '${steps.inspect-blog.content}' }, dependsOn: ['inspect-blog'] },
      { id: 'browser-check', label: 'Browser console pass (qa-pages)', tool: 'qa_run', argsTemplate: { suite: 'qa-pages' }, dependsOn: ['check-index', 'check-blog'], optional: true, timeoutMs: 900000, retryable: false }
    ]
  });

  /* ------------------------------------------- C. Blog draft production */
  defs.push({
    id: 'blog-draft-production',
    version: '1.0.0',
    title: 'Blog draft production',
    description: 'Generate a draft with the configured model, run structural/editorial checks, and save it — create-only — to the approved draft directory marked UNREVIEWED. Never publishes, never touches the sitemap. Requires explicit admin approval.',
    permissionClass: 'write',
    requiresApproval: true,
    requirements: ['model', 'tool:content_generate', 'tool:content_check', 'tool:draft_write'],
    inputs: {
      type: 'object',
      properties: {
        topic: { type: 'string', required: true, maxLength: 200 },
        constraints: { type: 'string', maxLength: 600, default: '' },
        slug: { type: 'string', maxLength: 60, default: 'article', pattern: 'filename' },
        words: { type: 'integer', min: 200, max: 3000, default: 800 }
      },
      additionalProperties: false
    },
    tools: ['content_generate', 'content_check', 'draft_write'],
    limits: { timeoutMs: 300000, maxRetries: 0, maxActiveRuns: 1 },
    checkpoint: true,
    resume: true,
    successCriteria: [{ step: 'check-draft', expect: { ok: true } }],
    resultSchema: { type: 'object', required: ['paths'] },
    auditRequired: true,
    steps: [
      { id: 'generate', label: 'Generate draft with the model', tool: 'content_generate', argsTemplate: {
        prompt: 'Write an unreviewed blog article draft for ahsolution.live about: ${inputs.topic}. Constraints: ${inputs.constraints}. Target length: about ${inputs.words} words. Use markdown with a single H1 title. Do not invent facts; mark uncertain claims.'
      }, dependsOn: [], timeoutMs: 120000 },
      { id: 'check-draft', label: 'Structural + editorial checks', tool: 'content_check', argsTemplate: { kind: 'markdown', text: '${steps.generate.text}', minWords: '${inputs.words}' }, dependsOn: ['generate'] },
      { id: 'save-draft', label: 'Save to approved draft directory (unreviewed)', tool: 'draft_write', argsTemplate: { filename: '${inputs.slug}.md', content: '${steps.generate.text}' }, dependsOn: ['check-draft'] }
    ]
  });

  /* ---------------------------------------- D. Approved file-change (blocked) */
  defs.push({
    id: 'approved-file-change',
    version: '1.0.0',
    title: 'Approved file-change workflow',
    description: 'Propose a patch in an approved workspace, show a diff, run tests, then apply only after explicit approval. NOT AVAILABLE yet: this build registers no patch/apply tool.',
    permissionClass: 'write',
    requiresApproval: true,
    supported: false,
    unsupportedReason: 'No patch generation/apply tool is registered in this milestone (the toolset is read-only plus create-only drafts).',
    inputs: {
      type: 'object',
      properties: {
        target: { type: 'string', required: true, maxLength: 200 },
        instruction: { type: 'string', required: true, maxLength: 1000 }
      },
      additionalProperties: false
    },
    tools: ['project_read_file'],
    steps: [
      { id: 'inspect-target', label: 'Read the target file', tool: 'project_read_file', argsTemplate: { path: '${inputs.target}' }, dependsOn: [] }
    ],
    limits: { timeoutMs: 300000 }
  });

  return defs;
}

/** Register every initial workflow into the registry. */
function registerBuiltins(wfRegistry) {
  const reg = wfRegistry && wfRegistry.register ? wfRegistry.register : require('./registry').register;
  for (const def of buildWorkflows()) reg(def);
}

module.exports = { registerBuiltins, buildWorkflows };
