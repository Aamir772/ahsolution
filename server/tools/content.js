'use strict';
/* ==========================================================================
   server/tools/content.js — content tools for approved writing workflows

   content_generate  risk: external  — calls the configured model (third-party
                                       API). Confirmation-gated like every
                                       non-read tool; workflows satisfy it with
                                       an explicit admin approval.
   content_check     risk: read      — structural/editorial evidence gathering.
                                       Returns findings; never throws for a
                                       finding (a defect is data, not an error).
   draft_write       risk: write     — CREATE-ONLY save inside the approved
                                       draft directory (cfg.workflows.draftDir).
                                       Refuses to overwrite anything, refuses
                                       path escapes, marks content unreviewed.
                                       This is the only tool on the approved
                                       automatic-write policy, and only because
                                       it can never destroy existing work.
   ========================================================================= */
'use strict';

const fsp = require('fs/promises');
const path = require('path');
const { ValidationError, PayloadTooLargeError, ProviderError, ConflictError } = require('../errors');

const FILENAME_RE = /^[a-z0-9][a-z0-9-]{0,59}\.md$/;
const UNREVIEWED_MARKER = '<!-- ah-draft: unreviewed — do not publish without human review -->\n';

function check(name, pass, detail) {
  return { name, pass: !!pass, detail: String(detail || '').slice(0, 300) };
}

/** Bounded, evidence-style HTML checks: metadata, links, alt text. */
function checkHtml(text) {
  const checks = [];
  const lower = text.toLowerCase();
  const title = (text.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1];
  checks.push(check('has_title', !!(title && title.trim()), title ? `<title> is "${title.trim().slice(0, 80)}"` : 'missing or empty <title>'));
  const desc = (text.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) || [])[1];
  checks.push(check('meta_description', !!(desc && desc.trim().length >= 20), desc ? `description present (${desc.trim().length} chars)` : 'missing/short meta description'));
  checks.push(check('viewport', /<meta[^>]+name=["']viewport["']/i.test(text), 'viewport meta'));
  checks.push(check('html_lang', /<html[^>]+lang=/i.test(text), 'html lang attribute'));
  const imgs = (text.match(/<img\b[^>]*>/gi) || []);
  const noAlt = imgs.filter((i) => !/alt\s*=/i.test(i));
  checks.push(check('image_alt', noAlt.length === 0, `${noAlt.length} of ${imgs.length} <img> tags lack alt text`));
  const hrefs = (text.match(/href\s*=\s*["']([^"']*)["']/gi) || []).map((h) => h.replace(/^href\s*=\s*["']|["']$/gi, ''));
  const empty = hrefs.filter((h) => !h.trim() || h.trim() === '#');
  checks.push(check('no_empty_links', empty.length === 0, `${empty.length} empty/anchor-only href(s) of ${hrefs.length} total`));
  const h1 = (text.match(/<h1\b/gi) || []).length;
  checks.push(check('single_h1', h1 >= 1, `${h1} <h1> tag(s)`));
  return checks;
}

/** Bounded, evidence-style markdown checks: structure, links, placeholders. */
function checkMarkdown(text, minWords) {
  const checks = [];
  const words = (text.trim().match(/\S+/g) || []).length;
  checks.push(check('min_words', words >= minWords, `${words} words (minimum ${minWords})`));
  checks.push(check('has_h1', /^#\s+\S/m.test(text), 'markdown H1 title'));
  const links = (text.match(/\[[^\]]*\]\(([^)\s]+)\)/g) || []).length;
  checks.push(check('has_links', links >= 1, `${links} markdown link(s)`));
  const placeholders = ['lorem ipsum', 'todo:', 'tbd:', 'fixme', 'placeholder text'].filter((p) => text.toLowerCase().includes(p));
  checks.push(check('no_placeholders', placeholders.length === 0, placeholders.length ? `found: ${placeholders.join(', ')}` : 'no placeholder markers'));
  checks.push(check('no_review_hint', !/^\s*<!--\s*ah-draft/m.test(text), 'content is not already marked as a draft'));
  return checks;
}

/**
 * @param {ReturnType<import('./registry').createToolRegistry>} registry
 * @param {{ cfg:object, providers:object, logger:object }} deps
 */
function registerContentTools(registry, { cfg, providers, logger }) {
  const wcfg = cfg.workflows || {};

  registry.register({
    name: 'content_generate',
    description: 'Generate text with the configured model provider (external API call; confirmation-gated).',
    risk: 'external',
    timeoutMs: (cfg.provider.timeoutMs || 20000) + 15000,
    schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', required: true, maxLength: 4000 },
        system: { type: 'string', maxLength: 1200 },
        maxTokens: { type: 'integer', min: 64, max: 4000 }
      },
      additionalProperties: false
    },
    handler: async (args) => {
      if (!providers || !providers.hasModel()) throw new ProviderError('No model provider is configured, so drafts cannot be generated.');
      const out = await providers.chat({
        messages: [
          { role: 'system', content: args.system || 'You are a careful technical writer. Produce markdown only. Never invent facts; mark uncertain claims clearly.' },
          { role: 'user', content: args.prompt }
        ],
        maxTokens: args.maxTokens || cfg.provider.maxOutputTokens
      });
      if (!out || !out.text) throw new ProviderError('The model returned no text.');
      return { text: out.text.slice(0, 200000), provider: out.provider || null, model: out.model || null };
    }
  });

  registry.register({
    name: 'content_check',
    description: 'Run structural/editorial checks on HTML or markdown content and return concrete findings (read-only evidence).',
    risk: 'read',
    timeoutMs: 10000,
    schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['html', 'markdown'], default: 'markdown' },
        text: { type: 'string', required: true, maxLength: 400000 },
        minWords: { type: 'integer', min: 0, max: 20000, default: 300 }
      },
      additionalProperties: false
    },
    handler: async (args) => {
      const kind = args.kind || 'markdown';
      const checks = kind === 'html' ? checkHtml(args.text) : checkMarkdown(args.text, args.minWords);
      const failed = checks.filter((c) => !c.pass).length;
      return {
        ok: failed === 0,
        kind,
        checks,
        passed: checks.length - failed,
        failed,
        summary: failed === 0 ? `all ${checks.length} checks passed` : `${failed} of ${checks.length} checks failed`
      };
    }
  });

  registry.register({
    name: 'draft_write',
    description: 'Save content as a NEW markdown file inside the approved draft directory (create-only; refuses overwrite; marks unreviewed).',
    risk: 'write',
    timeoutMs: 15000,
    schema: {
      type: 'object',
      properties: {
        filename: { type: 'string', required: true, maxLength: 80 },
        content: { type: 'string', required: true, maxLength: 400000 },
        autoSuffix: { type: 'boolean', default: true }
      },
      additionalProperties: false
    },
    handler: async (args) => {
      if (!FILENAME_RE.test(args.filename)) {
        throw new ValidationError('filename must look like "my-slug.md" (lowercase letters, digits and hyphens).');
      }
      const dir = path.resolve(wcfg.draftDir || path.join(cfg.storage.dataDir, 'drafts'));
      await fsp.mkdir(dir, { recursive: true });
      const body = args.content.startsWith(UNREVIEWED_MARKER) ? args.content : UNREVIEWED_MARKER + args.content;

      /* Create-only: never overwrites. With autoSuffix it picks a fresh name,
         otherwise it fails with a conflict — existing work is untouchable. */
      let target = path.join(dir, args.filename);
      if (path.dirname(target) !== dir) throw new ValidationError('filename must not contain directories.');
      let fh = null;
      if (args.autoSuffix !== false) {
        const base = args.filename.replace(/\.md$/, '');
        for (let i = 0; i < 50 && !fh; i++) {
          const candidate = path.join(dir, i === 0 ? args.filename : `${base}-${i}.md`);
          try { fh = await fsp.open(candidate, 'wx'); target = candidate; }
          catch (e) { if (e.code !== 'EEXIST') throw e; }
        }
        if (!fh) throw new ConflictError('Could not find a free filename in the draft directory.');
      } else {
        try { fh = await fsp.open(target, 'wx'); }
        catch (e) { if (e.code === 'EEXIST') throw new ConflictError('A draft with that filename already exists; refusing to overwrite.'); throw e; }
      }
      try { await fh.writeFile(body, 'utf8'); } finally { await fh.close(); }

      const stat = await fsp.stat(target);
      let display = target;
      try { display = path.relative(process.cwd(), target) || target; } catch (e) { /* keep absolute */ }
      if (logger) logger.info('draft_written', { path: display, bytes: stat.size });
      return { path: display.replace(/\\/g, '/'), bytes: stat.size, unreviewed: true, created: true };
    }
  });

  return registry;
}

module.exports = { registerContentTools, UNREVIEWED_MARKER };
