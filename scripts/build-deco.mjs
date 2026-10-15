/* ==========================================================================
   build-deco.mjs — generates the local decorative SVG assets
   (Haikei-inspired: layered waves, crimson gradients, fine grids,
    particle/network patterns, section dividers, admin backdrops)

   Zero dependencies, deterministic output — run:  npm run build:deco
   Output: assets/img/deco/*.svg  (all decorative: no text, no raster data)
   ========================================================================== */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'assets/img/deco');
mkdirSync(OUT, { recursive: true });

const round = (n) => Math.round(n * 100) / 100;

/* deterministic PRNG (mulberry32) so rebuilds are byte-stable */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Smooth path through sampled points (quadratic midpoint smoothing). */
function smoothPath(pts) {
  if (!pts.length) return '';
  let d = `M${round(pts[0][0])},${round(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    d += `Q${round(x0)},${round(y0)} ${round((x0 + x1) / 2)},${round((y0 + y1) / 2)}`;
  }
  const last = pts[pts.length - 1];
  d += `L${round(last[0])},${round(last[1])}`;
  return d;
}

function wavePts(width, baseY, amp, phase, steps) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * width;
    const t = (i / steps) * Math.PI * 2;
    const y = baseY
      + Math.sin(t * 1.6 + phase) * amp
      + Math.sin(t * 3.1 + phase * 1.7) * amp * 0.32;
    pts.push([x, round(y)]);
  }
  return pts;
}

function write(name, svg) {
  const compact = svg.replace(/>\s+</g, '><').trim() + '\n';
  writeFileSync(resolve(OUT, name), compact, 'utf8');
  console.log(`deco: ${name}  ${(compact.length / 1024).toFixed(1)} kB`);
}

/* ------------------------------------------------------------------ *
 * 1. Layered dark waves — page/section backdrop (layered-waves style)
 * ------------------------------------------------------------------ */
function layeredWaves() {
  const W = 1600, H = 420, steps = 34;
  const layers = [
    { base: 210, amp: 46, phase: 0.0, fill: 'url(#wv1)', op: 1 },
    { base: 258, amp: 54, phase: 1.6, fill: 'url(#wv2)', op: 1 },
    { base: 312, amp: 44, phase: 3.1, fill: 'url(#wv3)', op: 1 },
    { base: 366, amp: 34, phase: 4.6, fill: '#0B0B10', op: 1 }
  ];
  const paths = layers.map((l) => {
    const pts = wavePts(W, l.base, l.amp, l.phase, steps);
    pts.push([W, H], [0, H]);
    return `<path d="${smoothPath(pts)}Z" fill="${l.fill}" fill-opacity="${l.op}"/>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="presentation" aria-hidden="true" preserveAspectRatio="none">
<defs>
<linearGradient id="wv1" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#1A0A10"/><stop offset=".55" stop-color="#25101A"/><stop offset="1" stop-color="#120A14"/></linearGradient>
<linearGradient id="wv2" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#140810"/><stop offset=".5" stop-color="#1D0C14"/><stop offset="1" stop-color="#0E0912"/></linearGradient>
<linearGradient id="wv3" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0D080D"/><stop offset="1" stop-color="#0A080C"/></linearGradient>
</defs>
${paths}
</svg>`;
}

/* ------------------------------------------------------------------ *
 * 2. Crimson atmospheric gradient — soft radial glow blob
 * ------------------------------------------------------------------ */
function crimsonGlow() {
  const S = 1200;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" role="presentation" aria-hidden="true">
<defs>
<radialGradient id="cgA" cx="34%" cy="30%" r="62%"><stop offset="0" stop-color="#FF526B" stop-opacity=".34"/><stop offset=".45" stop-color="#E62946" stop-opacity=".16"/><stop offset="1" stop-color="#E62946" stop-opacity="0"/></radialGradient>
<radialGradient id="cgB" cx="74%" cy="72%" r="58%"><stop offset="0" stop-color="#A5142B" stop-opacity=".24"/><stop offset="1" stop-color="#A5142B" stop-opacity="0"/></radialGradient>
<radialGradient id="cgC" cx="52%" cy="52%" r="40%"><stop offset="0" stop-color="#FFFFFF" stop-opacity=".07"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient>
</defs>
<rect width="${S}" height="${S}" fill="url(#cgA)"/>
<rect width="${S}" height="${S}" fill="url(#cgB)"/>
<rect width="${S}" height="${S}" fill="url(#cgC)"/>
</svg>`;
}

/* ------------------------------------------------------------------ *
 * 3. Fine geometric grid — tiling pattern (tech texture)
 * ------------------------------------------------------------------ */
function fineGrid() {
  const S = 48, G = 8;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" role="presentation" aria-hidden="true">
<defs><pattern id="fg" width="${G}" height="${G}" patternUnits="userSpaceOnUse">
<path d="M${G},0H0V${G}" fill="none" stroke="#FFFFFF" stroke-opacity=".055" stroke-width="1"/>
</pattern><pattern id="fgMajor" width="${S}" height="${S}" patternUnits="userSpaceOnUse">
<path d="M${S},0H0V${S}" fill="none" stroke="#FF526B" stroke-opacity=".10" stroke-width="1"/>
</pattern></defs>
<rect width="${S}" height="${S}" fill="url(#fg)"/>
<rect width="${S}" height="${S}" fill="url(#fgMajor)"/>
</svg>`;
}

/* ------------------------------------------------------------------ *
 * 4. Particle / network pattern — nodes + connectors (AI energy motif)
 * ------------------------------------------------------------------ */
function network() {
  const W = 1440, H = 720;
  const r = rng(90210);
  const nodes = [];
  const cols = 11, rows = 6;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const px = ((x + 0.5) / cols) * W + (r() - 0.5) * (W / cols) * 0.85;
      const py = ((y + 0.5) / rows) * H + (r() - 0.5) * (H / rows) * 0.85;
      nodes.push([round(px), round(py), r() > 0.84 ? 2.6 : 1.7, r()]);
    }
  }
  const maxD = 230;
  // every connector in ONE path element keeps the file small
  let d = '';
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[i][0] - nodes[j][0];
      const dy = nodes[i][1] - nodes[j][1];
      if (Math.hypot(dx, dy) < maxD) {
        d += `M${nodes[i][0]},${nodes[i][1]}L${nodes[j][0]},${nodes[j][1]}`;
      }
    }
  }
  const dots = nodes.map(([x, y, rad, seed]) =>
    `<circle cx="${x}" cy="${y}" r="${rad}" fill="${seed > 0.5 ? '#FF526B' : '#F5F5F7'}" fill-opacity="${seed > 0.5 ? '.75' : '.42'}"/>`
  ).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="presentation" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
<path d="${d}" fill="none" stroke="#FF526B" stroke-opacity=".26" stroke-width="1"/>${dots}
</svg>`;
}

/* ------------------------------------------------------------------ *
 * 5. Section divider — thin double wave rule
 * ------------------------------------------------------------------ */
function dividerWave() {
  const W = 1600, H = 64;
  const a = [];
  const b = [];
  const steps = 40;
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * W;
    const t = (i / steps) * Math.PI * 2;
    a.push([round(x), round(32 + Math.sin(t * 2) * 12)]);
    b.push([round(x), round(32 + Math.sin(t * 2 + Math.PI) * 12)]);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="presentation" aria-hidden="true" preserveAspectRatio="none">
<path d="${smoothPath(a)}" fill="none" stroke="#E62946" stroke-opacity=".55" stroke-width="1.5"/>
<path d="${smoothPath(b)}" fill="none" stroke="#FFFFFF" stroke-opacity=".14" stroke-width="1"/>
</svg>`;
}

/* ------------------------------------------------------------------ *
 * 6. Admin backdrop — grid + crimson bloom (dashboard / login)
 * ------------------------------------------------------------------ */
function adminBackdrop() {
  const W = 1600, H = 900;
  const r = rng(1337);
  const nodes = [];
  for (let i = 0; i < 46; i++) nodes.push([round(r() * W), round(r() * H), round(1.4 + r() * 1.6, 2)]);
  const dots = nodes.map(([x, y, rad]) => `<circle cx="${x}" cy="${y}" r="${rad}" fill="#FF526B" fill-opacity=".30"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="presentation" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
<defs>
<pattern id="abGrid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40,0H0V40" fill="none" stroke="#FFFFFF" stroke-opacity=".045" stroke-width="1"/></pattern>
<radialGradient id="abGlowA" cx="18%" cy="8%" r="55%"><stop offset="0" stop-color="#E62946" stop-opacity=".30"/><stop offset="1" stop-color="#E62946" stop-opacity="0"/></radialGradient>
<radialGradient id="abGlowB" cx="88%" cy="92%" r="52%"><stop offset="0" stop-color="#A5142B" stop-opacity=".26"/><stop offset="1" stop-color="#A5142B" stop-opacity="0"/></radialGradient>
</defs>
<rect width="${W}" height="${H}" fill="#08080B"/>
<rect width="${W}" height="${H}" fill="url(#abGrid)"/>
<rect width="${W}" height="${H}" fill="url(#abGlowA)"/>
<rect width="${W}" height="${H}" fill="url(#abGlowB)"/>
${dots}
</svg>`;
}

write('waves-dark.svg', layeredWaves());
write('crimson-glow.svg', crimsonGlow());
write('grid-fine.svg', fineGrid());
write('network.svg', network());
write('divider-wave.svg', dividerWave());
write('admin-backdrop.svg', adminBackdrop());
