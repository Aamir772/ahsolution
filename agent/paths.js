/* ==========================================================================
   agent/paths.js — filesystem containment for the local agent

   Every filesystem tool must prove that the resolved target stays inside one of
   the configured roots. Rules:
     * reject NUL bytes and device paths (\\?\, \\.\, //./)
     * resolve the requested path against the chosen root
     * follow symlinks (realpath) and re-check containment, so a symlink cannot
       escape the root
     * reject absolute paths / drive changes that leave the root

   This is the agent-side enforcement. The backend applies its own allowlist too,
   but the agent never trusts the caller.
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

function selError(msg) { const e = new Error(msg); e.code = 'path_denied'; return e; }

/** Resolve symlinks where possible; fall back to a normalised absolute path. */
function canonicalize(p) {
  const abs = path.resolve(p);
  try {
    const real = fs.realpathSync.native ? fs.realpathSync.native(abs) : fs.realpathSync(abs);
    return real;
  } catch (e) {
    return abs;
  }
}

function isInside(root, target) {
  const r = canonicalize(root);
  const t = canonicalize(target);
  if (r === t) return true;
  const rel = path.relative(r, t);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Select the root to operate within.
 * @param {string[]} roots
 * @param {string} [labelOrPath] a root label (basename) or absolute path
 */
function selectRoot(roots, labelOrPath) {
  if (!roots || !roots.length) throw selError('No approved roots are configured.');
  if (!labelOrPath) return { root: canonicalize(roots[0]), label: path.basename(roots[0]) };
  const wanted = String(labelOrPath);
  for (const r of roots) {
    const abs = canonicalize(r);
    if (abs === canonicalize(wanted)) return { root: abs, label: path.basename(abs) };
    if (path.basename(abs).toLowerCase() === wanted.toLowerCase()) return { root: abs, label: path.basename(abs) };
  }
  throw selError(`"${wanted}" is not an approved root.`);
}

/**
 * Resolve a caller-supplied relative path inside a root, proving containment.
 * @param {string[]} roots
 * @param {string|undefined} rootSel
 * @param {string} rel
 * @returns {{ abs:string, root:string, label:string, rel:string }}
 */
function resolveInRoot(roots, rootSel, rel) {
  const { root, label } = selectRoot(roots, rootSel);
  const r = rel == null ? '' : String(rel);
  if (r.includes('\u0000')) throw selError('Invalid path.');
  const normalized = r.replace(/\//g, '\\');
  if (normalized.startsWith('\\\\?\\') || normalized.startsWith('\\\\.\\')) throw selError('Device paths are not allowed.');
  // Reject a Windows drive or UNC path that is not already inside a root.
  const looksAbsolute = path.isAbsolute(r) || /^[a-zA-Z]:/.test(r) || normalized.startsWith('\\\\');
  const candidate = looksAbsolute ? path.resolve(r) : path.resolve(root, r);
  if (!isInside(root, candidate)) throw selError('Path escapes the approved root.');
  const abs = canonicalize(candidate);
  if (!isInside(root, abs)) throw selError('Path escapes the approved root.');
  return { abs, root, label, rel: path.relative(root, abs).replace(/\\/g, '/') };
}

module.exports = { resolveInRoot, selectRoot, isInside, canonicalize, selError };
