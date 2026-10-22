/* ==========================================================================
   scripts/blog-build-images.js — AH Solution editorial SVG image package

   Generates three original editorial graphics per article into blog/assets/:
     <slug>-cover.svg       1200x630  (1.91:1 — featured / social preview)
     <slug>-thumbnail.svg    640x360  (16:9 — listing cards)
     <slug>-explainer.svg   1200x800  (3:2 — in-article visual)

   Visual identity: near-black #08080B base, crimson #E11D48 accent,
   clean editorial technology aesthetic. These are ORIGINAL vector
   illustrations — never presented as product photographs, screenshots or
   the original YouTube thumbnail.

   Run: node scripts/blog-build-images.js
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { loadManifest, ARTICLES_DIR, ASSETS_DIR } = require('./blog-md.js');

const INK = '#08080B';
const PANEL = '#101014';
const LINE = '#1D1D24';
const CRIMSON = '#E11D48';
const CRIMSON_SOFT = '#F0445E';
const TEXT = '#F4F4F6';
const MUTED = '#9C9CA8';
const FONT = "Manrope, 'Segoe UI', system-ui, sans-serif";

/* ------------------------------ per-article ------------------------------ */

const ART = {
  1:  { glyph: 'phone',    bullets: ['First-look context (2021 short)', 'Used-phone buying checklist', 'How to verify the specs'] },
  2:  { glyph: 'laptop',   bullets: ['GPU/CPU evaluation framework', 'Thermals and upgrade paths', 'Used-market checklist for 2026'] },
  3:  { glyph: 'laptop',   bullets: ['An ageing platform — an honest take', 'Typical 2021 configurations', 'Battery, thermal and warranty checks'] },
  4:  { glyph: 'box',      bullets: ['Unboxing-day checklist', 'Invoice and SKU verification', 'First-boot and warranty steps'] },
  5:  { glyph: 'camera',   bullets: ['Stability, focus, exposure', 'Night mode vs long exposure', 'Realistic phone-camera limits'] },
  6:  { glyph: 'watch',    bullets: ['Budget smartwatch framework', 'Display, comfort and battery', 'How to verify feature claims'] },
  7:  { glyph: 'apps',     bullets: ['App evaluation framework', 'Permission hygiene checks', 'Exact video list: verification pending'] },
  8:  { glyph: 'apps',     bullets: ['Free vs freemium traps', 'FOSS and open alternatives', 'Play Store verification steps'] },
  9:  { glyph: 'browser',  bullets: ['Defaults vs privacy controls', 'Extensions, sync, compatibility', 'No universal speed winner'] },
  10: { glyph: 'keyboard', bullets: ['10 everyday Windows shortcuts', 'Clipboard, screenshots, snap', 'Shortcut → use-case table'] },
  11: { glyph: 'monitor',  bullets: ['Live-wallpaper setup workflow', 'Performance and GPU impact', 'Current alternatives included'] },
  12: { glyph: 'wave',     bullets: ['Startup audio automation', 'A safe PowerShell greeting', 'Realistic expectations'] },
  13: { glyph: 'chat',     bullets: ['How the notification access works', 'The real limits of recovery', 'Privacy risks of granting access'] },
  14: { glyph: 'shield',   bullets: ['Legal and malware risks', 'Privacy concerns', 'Safer legal alternatives'] },
  15: { glyph: 'ah',       bullets: ['The mission of the channel', 'Content map: videos + blog', 'Where to start'] },
  16: { glyph: 'remote',   bullets: ['Official setup steps', 'PIN and account security', 'Offline-host troubleshooting'] },
  17: { glyph: 'cast',     bullets: ['Cast vs Miracast vs PC', 'Method comparison table', 'Network and lag troubleshooting'] }
};

/* ------------------------------- helpers -------------------------------- */

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function wrap(text, maxChars) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  words.forEach(function (w) {
    if (!cur) { cur = w; return; }
    if ((cur + ' ' + w).length <= maxChars) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  });
  if (cur) lines.push(cur);
  return lines;
}

/* short display title: strip emoji + length caps for cards */
function shortTitle(title, max) {
  const clean = String(title)
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u200D#]|Shorts/gu, '')
    .replace(/\s+/g, ' ')
    .replace(/[:|–—]+/g, ' ')
    .trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1).replace(/\s\S*$/, '') + '…';
}

function baseSvg(w, h, title, desc) {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(title) + '">' +
    '<title>' + esc(title) + '</title><desc>' + esc(desc) + '</desc>' +
    '<defs>' +
    '<radialGradient id="glow" cx="50%" cy="50%" r="50%">' +
    '<stop offset="0%" stop-color="' + CRIMSON + '" stop-opacity="0.32"/>' +
    '<stop offset="60%" stop-color="' + CRIMSON + '" stop-opacity="0.08"/>' +
    '<stop offset="100%" stop-color="' + CRIMSON + '" stop-opacity="0"/>' +
    '</radialGradient>' +
    '<linearGradient id="bar" x1="0" y1="0" x2="1" y2="0">' +
    '<stop offset="0%" stop-color="' + CRIMSON + '"/><stop offset="100%" stop-color="#3B82F6"/>' +
    '</linearGradient>' +
    '<pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">' +
    '<path d="M40 0H0V40" fill="none" stroke="#FFFFFF" stroke-opacity="0.035" stroke-width="1"/>' +
    '</pattern>' +
    '</defs>' +
    '<rect width="' + w + '" height="' + h + '" fill="' + INK + '"/>' +
    '<rect width="' + w + '" height="' + h + '" fill="url(#grid)"/>';
}

function endSvg() { return '</svg>\n'; }

/* -------------------------------- glyphs -------------------------------- */
/* All strokes/fills are abstract editorial shapes — no brand logos, no fake
   product photos, no invented UI text. s = overall size, drawn around (x,y). */

function glyph(type, x, y, s) {
  const st = 'fill="none" stroke="' + CRIMSON + '" stroke-width="' + Math.max(2, s / 55) + '" stroke-linecap="round" stroke-linejoin="round"';
  const stDim = 'fill="none" stroke="' + CRIMSON + '" stroke-opacity="0.45" stroke-width="' + Math.max(2, s / 70) + '" stroke-linecap="round"';
  const dk = 'fill="' + PANEL + '" stroke="' + LINE + '" stroke-width="1.5"';
  const u = s / 100; // unit
  const g = [];

  switch (type) {
    case 'phone': {
      g.push('<rect x="' + (x - 22 * u) + '" y="' + (y - 44 * u) + '" width="' + 44 * u + '" height="' + 88 * u + '" rx="' + 8 * u + '" ' + dk + '/>');
      g.push('<rect x="' + (x - 17 * u) + '" y="' + (y - 37 * u) + '" width="' + 34 * u + '" height="' + 66 * u + '" rx="' + 4 * u + '" ' + st + '/>');
      g.push('<circle cx="' + x + '" cy="' + (y + 36 * u) + '" r="' + 3.2 * u + '" fill="' + CRIMSON + '"/>');
      g.push('<path d="M' + (x - 10 * u) + ' ' + (y - 20 * u) + ' h' + 20 * u + '" ' + stDim + '/>');
      g.push('<path d="M' + (x - 10 * u) + ' ' + (y - 10 * u) + ' h' + 14 * u + '" ' + stDim + '/>');
      g.push('<circle cx="' + (x + 4 * u) + '" cy="' + (y + 10 * u) + '" r="' + 9 * u + '" ' + st + '/>');
      break;
    }
    case 'laptop': {
      g.push('<rect x="' + (x - 42 * u) + '" y="' + (y - 30 * u) + '" width="' + 84 * u + '" height="' + 52 * u + '" rx="' + 5 * u + '" ' + dk + '/>');
      g.push('<rect x="' + (x - 35 * u) + '" y="' + (y - 24 * u) + '" width="' + 70 * u + '" height="' + 38 * u + '" rx="' + 2.5 * u + '" ' + st + '/>');
      g.push('<path d="M' + (x - 50 * u) + ' ' + (y + 26 * u) + ' h' + 100 * u + '" ' + st + '/>');
      g.push('<path d="M' + (x - 14 * u) + ' ' + (y + 32 * u) + ' h' + 28 * u + '" ' + stDim + '/>');
      g.push('<path d="M' + (x - 22 * u) + ' ' + (y + 4 * u) + ' l' + 10 * u + ' ' + (-10 * u) + ' l' + 10 * u + ' ' + 6 * u + ' l' + 14 * u + ' ' + (-16 * u) + '" ' + st + '/>');
      break;
    }
    case 'box': {
      g.push('<path d="M' + (x - 40 * u) + ' ' + (y - 12 * u) + ' l' + 40 * u + ' ' + (-20 * u) + ' l' + 40 * u + ' ' + 20 * u + ' l' + (-40 * u) + ' ' + 20 * u + ' Z" ' + st + '/>');
      g.push('<path d="M' + (x - 40 * u) + ' ' + (y - 12 * u) + ' v' + 34 * u + ' l' + 40 * u + ' ' + 20 * u + ' v' + (-34 * u) + ' Z" ' + stDim + '/>');
      g.push('<path d="M' + (x + 40 * u) + ' ' + (y - 12 * u) + ' v' + 34 * u + ' l' + (-40 * u) + ' ' + 20 * u + '" ' + stDim + '/>');
      g.push('<path d="M' + x + ' ' + (y - 22 * u) + ' v' + 40 * u + '" ' + st + '/>');
      break;
    }
    case 'camera': {
      g.push('<rect x="' + (x - 44 * u) + '" y="' + (y - 24 * u) + '" width="' + 88 * u + '" height="' + 56 * u + '" rx="' + 8 * u + '" ' + dk + '/>');
      g.push('<path d="M' + (x - 24 * u) + ' ' + (y - 24 * u) + ' l' + 6 * u + ' ' + (-12 * u) + ' h' + 24 * u + ' l' + 6 * u + ' ' + 12 * u + '" ' + st + '/>');
      g.push('<circle cx="' + x + '" cy="' + (y + 4 * u) + '" r="' + 16 * u + '" ' + st + '/>');
      g.push('<circle cx="' + x + '" cy="' + (y + 4 * u) + '" r="' + 8 * u + '" ' + stDim + '/>');
      g.push('<path d="M' + (x + 30 * u) + ' ' + (y - 12 * u) + ' a' + 14 * u + ' ' + 14 * u + ' 0 0 1 ' + 4 * u + ' ' + 12 * u + '" fill="none" stroke="#FFFFFF" stroke-opacity="0.5" stroke-width="' + Math.max(1.5, s / 90) + '"/>');
      break;
    }
    case 'watch': {
      g.push('<rect x="' + (x - 26 * u) + '" y="' + (y - 26 * u) + '" width="' + 52 * u + '" height="' + 52 * u + '" rx="' + 13 * u + '" ' + dk + '/>');
      g.push('<rect x="' + (x - 19 * u) + '" y="' + (y - 19 * u) + '" width="' + 38 * u + '" height="' + 38 * u + '" rx="' + 9 * u + '" ' + st + '/>');
      g.push('<path d="M' + (x - 12 * u) + ' ' + (y - 26 * u) + ' v' + (-16 * u) + ' h' + 24 * u + ' v' + 16 * u + '" ' + stDim + '/>');
      g.push('<path d="M' + (x - 12 * u) + ' ' + (y + 26 * u) + ' v' + 16 * u + ' h' + 24 * u + ' v' + (-16 * u) + '" ' + stDim + '/>');
      g.push('<path d="M' + x + ' ' + (y - 10 * u) + ' v' + 10 * u + ' h' + 8 * u + '" ' + st + '/>');
      g.push('<circle cx="' + (x + 28 * u) + '" cy="' + (y - 6 * u) + '" r="' + 3 * u + '" fill="' + CRIMSON + '"/>');
      break;
    }
    case 'apps': {
      const pts = [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
      pts.forEach(function (p, idx) {
        const rx = x + p[0] * 26 * u - 11 * u;
        const ry = y + p[1] * 26 * u - 11 * u;
        const hot = idx === 4 || idx === 2;
        g.push('<rect x="' + rx + '" y="' + ry + '" width="' + 22 * u + '" height="' + 22 * u + '" rx="' + 5 * u + '" fill="' + (hot ? CRIMSON : PANEL) + '" fill-opacity="' + (hot ? '0.9' : '1') + '" stroke="' + (hot ? CRIMSON : LINE) + '" stroke-width="1.5"/>');
      });
      break;
    }
    case 'browser': {
      g.push('<rect x="' + (x - 46 * u) + '" y="' + (y - 30 * u) + '" width="' + 92 * u + '" height="' + 62 * u + '" rx="' + 7 * u + '" ' + dk + '/>');
      g.push('<path d="M' + (x - 46 * u) + ' ' + (y - 16 * u) + ' h' + 92 * u + '" ' + stDim + '/>');
      [-34, -26, -18].forEach(function (cx) {
        g.push('<circle cx="' + (x + cx * u) + '" cy="' + (y - 23 * u) + '" r="' + 2.4 * u + '" fill="' + CRIMSON + '" fill-opacity="0.75"/>');
      });
      g.push('<path d="M' + (x - 34 * u) + ' ' + (y - 2 * u) + ' h' + 36 * u + '" ' + st + '/>');
      g.push('<path d="M' + (x - 34 * u) + ' ' + (y + 10 * u) + ' h' + 24 * u + '" ' + stDim + '/>');
      g.push('<circle cx="' + (x + 24 * u) + '" cy="' + (y + 8 * u) + '" r="' + 12 * u + '" ' + st + '/>');
      g.push('<path d="M' + (x + 30 * u) + ' ' + (y + 14 * u) + ' l' + 10 * u + ' ' + 10 * u + '" ' + st + '/>');
      break;
    }
    case 'keyboard': {
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 5; c++) {
          const hot = (r === 0 && c === 2) || (r === 1 && c === 4);
          g.push('<rect x="' + (x - 44 * u + c * 18 * u) + '" y="' + (y - 22 * u + r * 16 * u) + '" width="' + 14 * u + '" height="' + 12 * u + '" rx="' + 2.5 * u + '" fill="' + (hot ? CRIMSON : PANEL) + '" stroke="' + (hot ? CRIMSON : LINE) + '" stroke-width="1.4"/>');
        }
      }
      g.push('<rect x="' + (x - 44 * u) + '" y="' + (y + 26 * u) + '" width="' + 82 * u + '" height="' + 10 * u + '" rx="' + 3 * u + '" ' + stDim + '/>');
      break;
    }
    case 'monitor': {
      g.push('<rect x="' + (x - 46 * u) + '" y="' + (y - 32 * u) + '" width="' + 92 * u + '" height="' + 58 * u + '" rx="' + 6 * u + '" ' + dk + '/>');
      g.push('<rect x="' + (x - 38 * u) + '" y="' + (y - 24 * u) + '" width="' + 76 * u + '" height="' + 42 * u + '" rx="' + 3 * u + '" ' + st + '/>');
      g.push('<path d="M' + (x - 30 * u) + ' ' + (y + 34 * u) + ' h' + 60 * u + '" ' + st + '/>');
      g.push('<path d="M' + (x - 20 * u) + ' ' + (y - 8 * u) + ' q' + 10 * u + ' ' + (-14 * u) + ' ' + 20 * u + ' 0 q' + 10 * u + ' ' + 14 * u + ' ' + 20 * u + ' 0" ' + stDim + '/>');
      g.push('<path d="M' + (x - 20 * u) + ' ' + (y + 6 * u) + ' q' + 10 * u + ' ' + (-14 * u) + ' ' + 20 * u + ' 0 q' + 10 * u + ' ' + 14 * u + ' ' + 20 * u + ' 0" ' + st + '/>');
      break;
    }
    case 'wave': {
      const hs = [10, 22, 14, 30, 18, 26, 12, 20, 8];
      hs.forEach(function (h, idx) {
        g.push('<path d="M' + (x - 44 * u + idx * 11 * u) + ' ' + (y - (h / 2) * u) + ' v' + (h * u) + '" stroke="' + (idx % 2 ? CRIMSON : CRIMSON_SOFT) + '" stroke-opacity="' + (0.45 + idx * 0.06) + '" stroke-width="' + Math.max(2.5, s / 40) + '" stroke-linecap="round"/>');
      });
      g.push('<rect x="' + (x - 30 * u) + '" y="' + (y + 26 * u) + '" width="' + 60 * u + '" height="' + 26 * u + '" rx="' + 5 * u + '" ' + dk + '/>');
      g.push('<circle cx="' + x + '" cy="' + (y + 39 * u) + '" r="' + 6 * u + '" ' + st + '/>');
      break;
    }
    case 'chat': {
      g.push('<path d="M' + (x - 42 * u) + ' ' + (y - 30 * u) + ' h' + 62 * u + ' a' + 8 * u + ' ' + 8 * u + ' 0 0 1 ' + 8 * u + ' ' + 8 * u + ' v' + 30 * u + ' a' + 8 * u + ' ' + 8 * u + ' 0 0 1 ' + (-8 * u) + ' ' + 8 * u + ' h' + (-38 * u) + ' l' + (-16 * u) + ' ' + 14 * u + ' v' + (-14 * u) + ' a' + 8 * u + ' ' + 8 * u + ' 0 0 1 ' + (-8 * u) + ' ' + (-8 * u) + ' v' + (-30 * u) + ' a' + 8 * u + ' ' + 8 * u + ' 0 0 1 ' + 8 * u + ' ' + (-8 * u) + ' Z" ' + st + '/>');
      g.push('<path d="M' + (x - 30 * u) + ' ' + (y - 12 * u) + ' h' + 46 * u + '" ' + stDim + '/>');
      g.push('<path d="M' + (x - 30 * u) + ' ' + (y) + ' h' + 30 * u + '" ' + stDim + '/>');
      g.push('<circle cx="' + (x + 28 * u) + '" cy="' + (y + 26 * u) + '" r="' + 9 * u + '" fill="' + INK + '" stroke="' + CRIMSON + '" stroke-width="' + Math.max(2, s / 55) + '"/>');
      g.push('<path d="M' + (x + 24 * u) + ' ' + (y + 26 * u) + ' h' + 8 * u + '" stroke="#FFFFFF" stroke-width="' + Math.max(2, s / 55) + '"/>');
      break;
    }
    case 'shield': {
      g.push('<path d="M' + x + ' ' + (y - 38 * u) + ' l' + 34 * u + ' ' + 12 * u + ' v' + 22 * u + ' c0 ' + 18 * u + ' ' + (-14 * u) + ' ' + 28 * u + ' ' + (-34 * u) + ' ' + 34 * u + ' c' + (-20 * u) + ' ' + (-6 * u) + ' ' + (-34 * u) + ' ' + (-16 * u) + ' ' + (-34 * u) + ' ' + (-34 * u) + ' v' + (-22 * u) + ' Z" ' + st + '/>');
      g.push('<circle cx="' + x + '" cy="' + (y + 2 * u) + '" r="' + 11 * u + '" ' + stDim + '/>');
      g.push('<path d="M' + (x - 4 * u) + ' ' + (y + 2 * u) + ' l' + 3.5 * u + ' ' + 3.5 * u + ' l' + 6.5 * u + ' ' + (-7 * u) + '" stroke="#FFFFFF" stroke-opacity="0.85" stroke-width="' + Math.max(2, s / 50) + '" fill="none" stroke-linecap="round" stroke-linejoin="round"/>');
      break;
    }
    case 'ah': {
      g.push('<path d="M' + (x - 36 * u) + ' ' + (y + 26 * u) + ' L' + x + ' ' + (y - 34 * u) + ' L' + (x + 36 * u) + ' ' + (y + 26 * u) + '" ' + st + '/>');
      g.push('<path d="M' + (x - 20 * u) + ' ' + (y + 6 * u) + ' h' + 40 * u + '" ' + st + '/>');
      g.push('<path d="M' + (x + 24 * u) + ' ' + (y - 34 * u) + ' v' + 60 * u + '" ' + stDim + '/>');
      break;
    }
    case 'remote': {
      g.push('<rect x="' + (x - 50 * u) + '" y="' + (y - 26 * u) + '" width="' + 74 * u + '" height="' + 48 * u + '" rx="' + 5 * u + '" ' + dk + '/>');
      g.push('<rect x="' + (x - 44 * u) + '" y="' + (y - 20 * u) + '" width="' + 62 * u + '" height="' + 36 * u + '" rx="' + 2.5 * u + '" ' + stDim + '/>');
      g.push('<rect x="' + (x + 30 * u) + '" y="' + (y - 10 * u) + '" width="' + 26 * u + '" height="' + 46 * u + '" rx="' + 6 * u + '" ' + dk + '/>');
      g.push('<rect x="' + (x + 34 * u) + '" y="' + (y - 5 * u) + '" width="' + 18 * u + '" height="' + 32 * u + '" rx="' + 2 * u + '" ' + st + '/>');
      g.push('<path d="M' + (x + 6 * u) + ' ' + (y - 6 * u) + ' q' + 10 * u + ' ' + (-10 * u) + ' ' + 20 * u + ' 0" ' + st + '/>');
      g.push('<path d="M' + (x + 10 * u) + ' ' + (y + 1 * u) + ' q' + 6 * u + ' ' + (-6 * u) + ' ' + 12 * u + ' 0" ' + stDim + '/>');
      break;
    }
    case 'cast':
    default: {
      g.push('<rect x="' + (x - 52 * u) + '" y="' + (y - 30 * u) + '" width="' + 62 * u + '" height="' + 56 * u + '" rx="' + 8 * u + '" ' + dk + '/>');
      g.push('<rect x="' + (x - 46 * u) + '" y="' + (y - 23 * u) + '" width="' + 50 * u + '" height="' + 42 * u + '" rx="' + 3 * u + '" ' + st + '/>');
      g.push('<rect x="' + (x + 22 * u) + '" y="' + (y - 16 * u) + '" width="' + 30 * u + '" height="' + 52 * u + '" rx="' + 7 * u + '" ' + dk + '/>');
      g.push('<rect x="' + (x + 27 * u) + '" y="' + (y - 10 * u) + '" width="' + 20 * u + '" height="' + 36 * u + '" rx="' + 2.5 * u + '" ' + stDim + '/>');
      g.push('<path d="M' + (x + 8 * u) + ' ' + (y + 4 * u) + ' h' + 10 * u + '" stroke="' + CRIMSON + '" stroke-width="' + Math.max(2, s / 55) + '" stroke-linecap="round"/>');
      g.push('<path d="M' + (x + 14 * u) + ' ' + (y - 2 * u) + ' l' + 6 * u + ' ' + 6 * u + ' l' + (-6 * u) + ' ' + 6 * u + '" fill="none" stroke="' + CRIMSON + '" stroke-width="' + Math.max(2, s / 55) + '" stroke-linecap="round" stroke-linejoin="round"/>');
      break;
    }
  }
  return g.join('');
}

/* ------------------------------- covers --------------------------------- */

function cover(row, art) {
  const w = 1200, h = 630;
  const title = shortTitle(row.article_title, 64);
  const lines = wrap(title, 26).slice(0, 3);
  const tSize = lines.length > 2 ? 44 : 52;
  const startY = 250 - (lines.length - 1) * 26;
  let s = baseSvg(w, h,
    'AH Solution editorial cover — ' + row.article_title,
    'Original editorial vector illustration for the article “' + row.article_title + '”. Not a product photograph, screenshot or YouTube thumbnail.');
  s += '<circle cx="920" cy="315" r="300" fill="url(#glow)"/>';
  s += '<rect x="0" y="0" width="' + w + '" height="6" fill="url(#bar)"/>';
  s += '<text x="80" y="120" font-family="' + FONT + '" font-size="20" font-weight="700" letter-spacing="4" fill="' + CRIMSON + '">AH SOLUTION \u00B7 BLOG ' + String(row.article_number).padStart(2, '0') + '/17</text>';
  lines.forEach(function (ln, i) {
    s += '<text x="80" y="' + (startY + i * (tSize + 14)) + '" font-family="' + FONT + '" font-size="' + tSize + '" font-weight="800" fill="' + TEXT + '">' + esc(ln) + '</text>';
  });
  const catY = startY + lines.length * (tSize + 14) + 18;
  const pillW = row.category.length * 11 + 34;
  s += '<rect x="80" y="' + catY + '" width="' + pillW + '" height="38" rx="19" fill="none" stroke="' + CRIMSON + '" stroke-opacity="0.7" stroke-width="1.5"/>';
  s += '<text x="' + (80 + 17) + '" y="' + (catY + 25) + '" font-family="' + FONT + '" font-size="16" font-weight="600" fill="' + MUTED + '">' + esc(row.category) + '</text>';
  s += glyph(art.glyph, 920, 315, 300);
  s += '<text x="80" y="580" font-family="' + FONT + '" font-size="15" font-weight="500" letter-spacing="1.5" fill="' + MUTED + '">ahsolution.live \u00B7 Tips, tricks and techniques</text>';
  s += endSvg();
  return s;
}

/* ------------------------------ thumbnails ------------------------------- */

function thumb(row, art) {
  const w = 640, h = 360;
  const title = shortTitle(row.article_title, 42);
  const lines = wrap(title, 20).slice(0, 3);
  const tSize = lines.length > 2 ? 22 : 26;
  let s = baseSvg(w, h,
    'AH Solution card thumbnail — ' + row.article_title,
    'Original editorial vector thumbnail for the article “' + row.article_title + '”.');
  s += '<circle cx="500" cy="180" r="170" fill="url(#glow)"/>';
  s += '<rect x="0" y="0" width="' + w + '" height="4" fill="url(#bar)"/>';
  s += '<text x="36" y="64" font-family="' + FONT + '" font-size="13" font-weight="700" letter-spacing="3" fill="' + CRIMSON + '">AH SOLUTION \u00B7 ' + String(row.article_number).padStart(2, '0') + '/17</text>';
  const startY = 160 - (lines.length - 1) * 14;
  lines.forEach(function (ln, i) {
    s += '<text x="36" y="' + (startY + i * (tSize + 8)) + '" font-family="' + FONT + '" font-size="' + tSize + '" font-weight="800" fill="' + TEXT + '">' + esc(ln) + '</text>';
  });
  s += '<text x="36" y="318" font-family="' + FONT + '" font-size="12.5" font-weight="600" fill="' + MUTED + '">' + esc(row.category) + '</text>';
  s += glyph(art.glyph, 510, 180, 150);
  s += endSvg();
  return s;
}

/* ------------------------------- explainer ------------------------------- */

function explainer(row, art) {
  const w = 1200, h = 800;
  const title = shortTitle(row.article_title, 70);
  const lines = wrap(title, 46).slice(0, 2);
  let s = baseSvg(w, h,
    'AH Solution explainer visual — ' + row.article_title,
    'Original editorial explainer illustration for the article “' + row.article_title + '”. Diagram-style visual; not a screenshot or benchmark.');
  s += '<circle cx="330" cy="470" r="250" fill="url(#glow)"/>';
  s += '<rect x="0" y="0" width="' + w + '" height="6" fill="url(#bar)"/>';
  s += '<text x="70" y="110" font-family="' + FONT + '" font-size="18" font-weight="700" letter-spacing="4" fill="' + CRIMSON + '">AH SOLUTION \u00B7 EXPLAINER \u00B7 ARTICLE ' + String(row.article_number).padStart(2, '0') + '/17</text>';
  lines.forEach(function (ln, i) {
    s += '<text x="70" y="' + (190 + i * 56) + '" font-family="' + FONT + '" font-size="46" font-weight="800" fill="' + TEXT + '">' + esc(ln) + '</text>';
  });
  s += '<text x="70" y="' + (190 + lines.length * 56 + 6) + '" font-family="' + FONT + '" font-size="19" font-weight="600" fill="' + MUTED + '">' + esc(row.category) + ' \u00B7 English article</text>';
  // left glyph panel
  s += '<rect x="120" y="360" width="420" height="340" rx="18" fill="' + PANEL + '" stroke="' + LINE + '" stroke-width="1.5"/>';
  s += glyph(art.glyph, 330, 530, 230);
  // right: "what you will learn" chips
  s += '<text x="620" y="400" font-family="' + FONT + '" font-size="20" font-weight="700" letter-spacing="2" fill="' + CRIMSON + '">WHAT YOU WILL LEARN</text>';
  art.bullets.slice(0, 3).forEach(function (b, i) {
    const y = 440 + i * 78;
    s += '<rect x="620" y="' + y + '" width="500" height="58" rx="12" fill="' + PANEL + '" stroke="' + LINE + '" stroke-width="1.5"/>';
    s += '<circle cx="650" cy="' + (y + 29) + '" r="6" fill="' + CRIMSON + '"/>';
    const bl = wrap(b, 52);
    s += '<text x="670" y="' + (y + (bl.length > 1 ? 24 : 35)) + '" font-family="' + FONT + '" font-size="17" font-weight="600" fill="' + TEXT + '">' + esc(bl[0]) + '</text>';
    if (bl[1]) s += '<text x="670" y="' + (y + 44) + '" font-family="' + FONT + '" font-size="17" font-weight="600" fill="' + TEXT + '">' + esc(bl[1]) + '</text>';
  });
  s += '<text x="70" y="760" font-family="' + FONT + '" font-size="14" font-weight="500" letter-spacing="1.2" fill="' + MUTED + '">Editorial illustration \u2014 not a product photograph, screenshot or benchmark result.</text>';
  s += endSvg();
  return s;
}

/* --------------------------------- main ---------------------------------- */

function main() {
  const manifest = loadManifest();
  if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });
  let count = 0;
  const missing = [];
  manifest.forEach(function (row) {
    const art = ART[row.article_number];
    if (!art) { missing.push(row.article_number); return; }
    const files = [
      [row.slug + '-cover.svg', cover(row, art)],
      [row.slug + '-thumbnail.svg', thumb(row, art)],
      [row.slug + '-explainer.svg', explainer(row, art)]
    ];
    files.forEach(function (f) {
      fs.writeFileSync(path.join(ASSETS_DIR, f[0]), f[1], 'utf8');
      count++;
    });
    // sanity: source article exists
    const md = path.join(ARTICLES_DIR, String(row.article_number).padStart(2, '0') + '-' + row.slug + '.md');
    if (!fs.existsSync(md)) missing.push('article file missing: ' + md);
  });
  console.log('blog-build-images: wrote ' + count + ' SVG files to blog/assets/');
  if (missing.length) {
    console.error('missing config/article for:', missing.join(', '));
    process.exitCode = 1;
  }
}

if (require.main === module) main();
module.exports = { ART };
