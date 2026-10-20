/* ==========================================================================
   agent/tools.js — the local agent's read-only tool set

   These run INSIDE the agent process on the operator's PC. They are the real
   execution boundary, so they re-validate everything the backend already
   checked:
     * files stay within an approved root (agent/paths.js)
     * only known extensions, regular files, size caps
     * qa.run maps a suite ID to a FIXED executable (this node binary) plus a
       validated argument array — never a shell string, never model text

   Process spawning uses spawn() with shell:false and a hard timeout; children
   are tracked so they can be cancelled and are killed on shutdown.
   ========================================================================== */
'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const { resolveInRoot, selectRoot } = require('./paths');

const READ_EXT = new Set(['.js', '.cjs', '.mjs', '.json', '.css', '.html', '.htm', '.md', '.txt', '.toml', '.yml', '.yaml', '.svg']);
const SKIP_DIRS = new Set(['node_modules', '.git', '.data', 'dist', 'build', '.next', 'vendor']);
const SUITE_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

function toolError(msg, code) { const e = new Error(msg); e.code = code || 'tool_error'; return e; }

/**
 * @param {{ cfg:object, logger:object }} deps
 */
function createAgentTools({ cfg, logger }) {
  /** @type {Map<string, import('child_process').ChildProcess>} */
  const children = new Map();

  function rootArg(args) { return (args && (args.root || args.dir)) || undefined; }

  /* ------------------------------------------------------------- files.list */
  async function filesList(args = {}) {
    const { abs, root, label, rel } = resolveInRoot(cfg.roots, rootArg(args), args.path || '');
    let stat;
    try { stat = await fsp.stat(abs); } catch (e) { throw toolError('Path not found.', 'not_found'); }
    if (!stat.isDirectory()) throw toolError('Not a directory.', 'not_a_directory');
    const limit = Number.isInteger(args.limit) ? Math.min(Math.max(args.limit, 1), 2000) : 200;
    const maxDepth = Number.isInteger(args.depth) ? Math.min(Math.max(args.depth, 0), 4) : 1;
    const entries = [];
    let truncated = false;

    async function walk(dir, depth) {
      if (entries.length >= limit) { truncated = true; return; }
      let list;
      try { list = await fsp.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
      for (const dirent of list) {
        if (entries.length >= limit) { truncated = true; return; }
        const full = path.join(dir, dirent.name);
        const isDir = dirent.isDirectory();
        if (isDir && SKIP_DIRS.has(dirent.name)) continue;
        let size = null;
        if (!isDir) { try { size = (await fsp.stat(full)).size; } catch (e) { size = null; } }
        entries.push({ name: dirent.name, path: path.relative(root, full).replace(/\\/g, '/'), type: isDir ? 'dir' : 'file', size });
        if (isDir && depth < maxDepth) await walk(full, depth + 1);
      }
    }
    await walk(abs, 0);
    return { root: label, path: rel, count: entries.length, truncated, entries };
  }

  /* ------------------------------------------------------------- files.read */
  async function filesRead(args = {}) {
    if (!args.path || typeof args.path !== 'string') throw toolError('A path is required.', 'invalid_args');
    const { abs, root, label, rel } = resolveInRoot(cfg.roots, rootArg(args), args.path);
    const ext = path.extname(abs).toLowerCase();
    if (!READ_EXT.has(ext)) throw toolError(`File type "${ext || '(none)'}" is not readable.`, 'unsupported_type');
    let stat;
    try { stat = await fsp.stat(abs); } catch (e) { throw toolError('File not found.', 'not_found'); }
    if (!stat.isFile()) throw toolError('Not a regular file.', 'not_a_file');
    const maxBytes = Math.min(Number.isInteger(args.maxBytes) ? args.maxBytes : cfg.maxFileBytes, cfg.maxFileBytes);
    if (stat.size > maxBytes) throw toolError(`File exceeds maxBytes (${stat.size} > ${maxBytes}).`, 'too_large');
    const content = await fsp.readFile(abs, 'utf8');
    return { root: label, path: rel, bytes: stat.size, content };
  }

  /* -------------------------------------------------------- project.inspect */
  async function projectInspect(args = {}) {
    const { root, label } = selectRoot(cfg.roots, rootArg(args));
    const maxDepth = Number.isInteger(args.depth) ? Math.min(Math.max(args.depth, 1), 4) : 2;
    const MAX_FILES = 20000;
    const byExt = {};
    const topLevel = [];
    let files = 0, dirs = 0, bytes = 0, truncated = false;

    async function walk(dir, depth) {
      if (files + dirs >= MAX_FILES) { truncated = true; return; }
      let list;
      try { list = await fsp.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
      for (const dirent of list) {
        if (files + dirs >= MAX_FILES) { truncated = true; return; }
        const full = path.join(dir, dirent.name);
        if (dirent.isDirectory()) {
          if (SKIP_DIRS.has(dirent.name)) continue;
          dirs++;
          if (depth === 0) topLevel.push({ name: dirent.name, type: 'dir' });
          if (depth < maxDepth) await walk(full, depth + 1);
        } else {
          files++;
          const ext = path.extname(dirent.name).toLowerCase() || '(none)';
          byExt[ext] = (byExt[ext] || 0) + 1;
          try { bytes += (await fsp.stat(full)).size; } catch (e) { /* ignore */ }
          if (depth === 0) topLevel.push({ name: dirent.name, type: 'file' });
        }
      }
    }
    await walk(root, 0);

    let pkg = null;
    try {
      const p = JSON.parse(await fsp.readFile(path.join(root, 'package.json'), 'utf8'));
      pkg = { name: p.name || null, version: p.version || null, scripts: p.scripts ? Object.keys(p.scripts).length : 0 };
    } catch (e) { /* no package.json */ }

    const topExts = Object.entries(byExt).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([ext, count]) => ({ ext, count }));
    return { root: label, files, dirs, bytes, truncated, topLevel, topExtensions: topExts, package: pkg };
  }

  /* ---------------------------------------------------------------- qa.run */
  function runQa(args = {}, ctx = {}) {
    const suite = String(args.suite || '');
    if (!SUITE_RE.test(suite)) throw toolError('Invalid QA suite id.', 'invalid_args');
    const def = cfg.suites[suite];
    if (!def) throw toolError(`QA suite "${suite}" is not defined on this agent.`, 'suite_not_allowed');

    const exe = process.execPath; // fixed executable
    const argv = def.args.slice(); // validated, operator-defined argument array
    const cwd = def.cwd || cfg.workspace;
    const taskId = ctx.taskId || ('qa_' + Date.now());
    const timeoutMs = Math.min(Number.isInteger(args.timeoutMs) ? args.timeoutMs : 120000, 1800000);

    return new Promise((resolve, reject) => {
      let child;
      try {
        child = spawn(exe, argv, {
          cwd,
          shell: false,
          windowsHide: true,
          env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: process.env.NODE_ENV || 'production' }
        });
      } catch (e) { return reject(toolError('Could not start the QA suite.', 'spawn_failed')); }

      children.set(taskId, child);
      const started = Date.now();
      let outLen = 0, errLen = 0, truncated = false, timedOut = false;
      const out = [], err = [];

      function cap(chunks, chunk) {
        const remaining = cfg.maxOutputBytes - (chunks === out ? outLen : errLen);
        if (remaining <= 0) { truncated = true; return; }
        if (chunk.length > remaining) { truncated = true; chunks.push(chunk.slice(0, remaining)); }
        else chunks.push(chunk);
        if (chunks === out) outLen += Math.min(chunk.length, remaining); else errLen += Math.min(chunk.length, remaining);
      }

      const timer = setTimeout(() => {
        timedOut = true;
        try { child.kill('SIGKILL'); } catch (e) { /* ignore */ }
      }, timeoutMs);

      child.stdout && child.stdout.on('data', (c) => cap(out, c));
      child.stderr && child.stderr.on('data', (c) => cap(err, c));
      child.on('error', (e) => {
        clearTimeout(timer); children.delete(taskId);
        reject(toolError('QA suite failed to run: ' + (e && e.message), 'spawn_failed'));
      });
      child.on('close', (code, signal) => {
        clearTimeout(timer); children.delete(taskId);
        if (ctx.onProgress) { try { ctx.onProgress({ phase: 'done' }); } catch (e) { /* ignore */ } }
        resolve({
          suite,
          exitCode: code,
          signal: signal || null,
          ok: code === 0 && !timedOut,
          timedOut,
          truncated,
          durationMs: Date.now() - started,
          stdout: Buffer.concat(out).toString('utf8'),
          stderr: Buffer.concat(err).toString('utf8')
        });
      });
      if (ctx.onProgress) { try { ctx.onProgress({ phase: 'running', suite }); } catch (e) { /* ignore */ } }
    });
  }

  /** Cancel a running child process by task id. */
  function cancel(taskId) {
    const child = children.get(taskId);
    if (!child) return false;
    try { child.kill('SIGKILL'); } catch (e) { /* ignore */ }
    return true;
  }

  function killAll() {
    for (const child of children.values()) { try { child.kill('SIGKILL'); } catch (e) { /* ignore */ } }
    children.clear();
  }

  /** Dispatch a tool call by name. Unknown tools are rejected. */
  async function invoke(tool, args, ctx = {}) {
    switch (tool) {
      case 'agent_status':
        return { agentId: cfg.id, platform: process.platform, node: process.version, roots: cfg.roots.map((r) => path.basename(r)), suites: Object.keys(cfg.suites), busy: children.size };
      case 'files_list': return filesList(args);
      case 'files_read': return filesRead(args);
      case 'project_inspect': return projectInspect(args);
      case 'qa_run': return runQa(args, ctx);
      default: throw toolError(`Unknown tool "${tool}".`, 'unknown_tool');
    }
  }

  return { invoke, cancel, killAll, running: () => children.size };
}

module.exports = { createAgentTools, READ_EXT, SUITE_RE };
