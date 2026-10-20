/* ==========================================================================
   server/tools/builtin.js — first-party tools (all read-only here)

   Milestone 1 ships only read-only tools. Write / external / privileged tools
   are added in later milestones and inherit the confirmation gate automatically
   from server/permissions.js.
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { ValidationError } = require('../errors');

const READ_EXT = new Set(['.js', '.cjs', '.mjs', '.json', '.css', '.html', '.htm', '.md', '.txt', '.toml', '.yml', '.yaml', '.svg']);

/** Load the bundled AI knowledge index (public, non-secret). */
function loadIndex(projectRoot) {
  const candidates = [
    path.join(projectRoot, 'netlify', 'functions', '_shared', 'ai-index.json'),
    path.join(projectRoot, 'assets', 'data', 'ai-index.json')
  ];
  for (const p of candidates) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { /* try next */ }
  }
  return null;
}

/** Flatten the various index shapes into { title, url, text } docs. */
function extractDocs(index) {
  let items = [];
  if (Array.isArray(index)) items = index;
  else if (index && Array.isArray(index.documents)) items = index.documents;
  else if (index && Array.isArray(index.docs)) items = index.docs;
  else if (index && Array.isArray(index.entries)) items = index.entries;
  else if (index && Array.isArray(index.items)) items = index.items;
  else if (index && typeof index === 'object') {
    for (const k of Object.keys(index)) if (Array.isArray(index[k])) { items = index[k]; break; }
  }
  return items.map((it) => {
    if (typeof it === 'string') return { title: it.slice(0, 80), url: '', text: it };
    const title = it.title || it.name || it.heading || it.slug || '';
    const url = it.url || it.href || it.path || it.link || '';
    const text = it.text || it.content || it.body || it.summary || it.description || JSON.stringify(it);
    return { title: String(title), url: String(url), text: String(text) };
  });
}

function score(doc, terms) {
  const hay = (doc.title + ' ' + doc.text).toLowerCase();
  let s = 0;
  for (const t of terms) if (t && hay.includes(t)) s += t.length > 3 ? 2 : 1;
  if (doc.title.toLowerCase().includes(terms[0] || '\u0000')) s += 1;
  return s;
}

/**
 * @param {ReturnType<import('./registry').createToolRegistry>} registry
 * @param {{ projectRoot: string }} opts
 */
function registerBuiltinTools(registry, opts = {}) {
  const projectRoot = opts.projectRoot || process.cwd();

  registry.register({
    name: 'time_now',
    description: 'Return the current server date/time in ISO 8601 (UTC) and local time.',
    risk: 'read',
    schema: { type: 'object', properties: {} },
    handler: async () => ({ utc: new Date().toISOString(), local: new Date().toString() })
  });

  registry.register({
    name: 'echo',
    description: 'Echo back the provided text. Used for connectivity and tests.',
    risk: 'read',
    schema: { type: 'object', properties: { text: { type: 'string', required: true, maxLength: 500 } }, additionalProperties: false },
    handler: async (args) => ({ text: args.text })
  });

  registry.register({
    name: 'site_search',
    description: 'Search the site knowledge index and return the most relevant pages/snippets.',
    risk: 'read',
    schema: {
      type: 'object',
      properties: { query: { type: 'string', required: true, maxLength: 200 }, limit: { type: 'integer', min: 1, max: 10, default: 4 } },
      additionalProperties: false
    },
    handler: async (args) => {
      const index = loadIndex(projectRoot);
      if (!index) return { results: [], note: 'knowledge index unavailable' };
      const terms = String(args.query).toLowerCase().split(/\s+/).filter(Boolean);
      const docs = extractDocs(index);
      const results = docs
        .map((d) => ({ ...d, score: score(d, terms) }))
        .filter((d) => d.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, args.limit)
        .map((d) => ({ title: d.title, url: d.url, snippet: d.text.slice(0, 280), score: d.score }));
      return { results };
    }
  });

  registry.register({
    name: 'service_health',
    description: 'Report backend service health (storage, provider, feature flags). No secrets.',
    risk: 'read',
    schema: { type: 'object', properties: {} },
    handler: async (args, ctx) => {
      const c = (ctx && ctx.cfg) || {};
      return {
        status: 'ok',
        storage: c.storage && c.storage.driver,
        provider: c.provider && c.provider.name,
        agentEnabled: !!(c.agent && c.agent.enabled),
        voiceEnabled: !!(c.features && c.features.voice),
        workflowsEnabled: !!(c.workflows && c.workflows.enabled)
      };
    }
  });

  registry.register({
    name: 'project_read_file',
    description: 'Read a UTF-8 text file from within the project root (read-only, size-limited).',
    risk: 'read',
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', required: true, maxLength: 300 },
        maxBytes: { type: 'integer', min: 256, max: 200000, default: 65536 }
      },
      additionalProperties: false
    },
    handler: async (args) => {
      const root = path.resolve(projectRoot);
      const target = path.resolve(root, args.path);
      if (target !== root && !target.startsWith(root + path.sep)) throw new ValidationError('Path escapes the project root.');
      const ext = path.extname(target).toLowerCase();
      if (!READ_EXT.has(ext)) throw new ValidationError(`File type "${ext || '(none)'}" is not readable.`);
      let stat;
      try { stat = fs.statSync(target); } catch (e) { throw new ValidationError('File not found.'); }
      if (!stat.isFile()) throw new ValidationError('Not a regular file.');
      if (stat.size > args.maxBytes) throw new ValidationError(`File exceeds maxBytes (${stat.size} > ${args.maxBytes}).`);
      return { path: path.relative(root, target).replace(/\\/g, '/'), bytes: stat.size, content: fs.readFileSync(target, 'utf8') };
    }
  });

  return registry;
}

module.exports = { registerBuiltinTools, loadIndex, extractDocs };
