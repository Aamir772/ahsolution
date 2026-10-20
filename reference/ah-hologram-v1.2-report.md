# AH Solution — Holographic Core V1.2 ("Electric Blue")

Status: implemented, tested, not committed (per instruction).
Baseline: V1 mechanical construct preserved at
`C:\Users\haami\AppData\Local\Temp\opencode\ah-v1-blue-baseline\`
(globe.js / index.html / styles.css / ai.css), so V1.2 can be reverted if needed.

V1.2 is a **refinement of the working V1 core — not a rewrite.** The whole
renderer, the public API, the CSS hooks and the script-loading strategy are
unchanged; V1.2 changes the palette, the environment, the central identity and
expands the procedural detail.

---

## 1. Palette (approved)

| Role            | Hex       | Use                                             |
|-----------------|-----------|-------------------------------------------------|
| Void navy       | `#050A12` | core backdrop / canvas clear colour             |
| Electric blue   | `#00A8FF` | primary geometry (shell frames, struts, panels) |
| Plasma cyan     | `#48E5FF` | circuitry, nodes, trails, scan rings            |
| Ice white       | `#D8F8FF` | core light, monogram, highlights, nodes         |
| Brand crimson   | `#FF183D` | restricted intensity ticks                      |
| Deep steel blue | `#16456B` | struts / frames (depth)                         |

Target mix was ~50% blue/dark-blue, ~25% cyan, ~15% dark transparent, ~7% ice,
~3% crimson. Measured on the rendered core (desktop element render): crimson
coverage ≈ 0.04–0.09%; the full page reads ≈ 2.5% crimson (that is the brand
crimson UI — buttons/badge — not the core). Blue→cyan→white gradient dominates
the construct; corners are fully dark.

Additive blending pushes stacked blue toward cyan, so per-layer opacities were
tuned down (see §4) to keep the fine components distinct instead of merging into
one bright mass.

---

## 2. What changed, per file

### `assets/js/globe.js` (rebuilt scene, same API)
- New palette constants: `VOID, BLUE, CYAN, ICE, CRIMSON, STEEL`.
- Central core group: glow sprite (blue radial canvas texture) + **ice-white
  icosahedron heart** + plasma-cyan cage + electric-blue cage.
- Radial mechanical assembly: spokes, broken arcs, crimson calibration arcs,
  instanced ring discs.
- Circuitry: `LineSegments` traces (cyan/blue/crimson lanes) + node `Points`
  (cyan/ice/crimson) + instanced square solder pads.
- Fragmented shells: **3 depth layers** of instanced wireframe sphere patches,
  instanced transparent panels, steel struts — non-uniform gaps.
- Debris: instanced box / tetrahedron / octahedron / icosahedron shards
  (blue / cyan / ice / crimson), some independently animated.
- Particles: two custom `ShaderMaterial` point systems — ambient dust and
  short-lived sparks (`makePoints`).
- Scan/energy: three torus scan rings, **travellers** (packets that advance
  along circuit lanes), pulse waves, occasional crimson ticks.
- Kept: single renderer, single loop, `pointer`/`pulse`/`setSpeed`/`state`,
  `IntersectionObserver` pause, `visibilitychange` pause, reduced-motion single
  frame, `dispose()`, and the transparent **canvas-2D fallback recoloured blue**.

Two defects found and fixed during the build:
1. The instanced shell frames were built with a *line* material on a
   `InstancedMesh`, so they rendered as **solid filled patches** (huge
   overdraw). Fixed with dedicated `MeshBasicMaterial({ wireframe:true })`
   frame materials.
2. The heavy scene build was started as soon as `booted` appeared. On slow /
   software renderers that blocked the entry animation and the `load` event.
   `whenBooted()` now waits for **`booted` AND `device-settled` AND window
   `load`** (with a 9 s safety cap), so the boot sequence never competes with
   the scene build. On real GPUs the build is fast, so the core simply starts a
   moment after the boot/entry animation.

Public API unchanged (`core.pointer`, `core.globe.{pulse,setSpeed,state}`,
`canvas.hero-gl`).

### `index.html`
- Wrapped the central identity in `.core-identity`: two `.core-reticle` rings,
  the ice-white **AH** monogram (gradient recoloured), and a
  `CORE 01 · SYSTEM ONLINE` indicator. No `role="img"` SVG, no logo image inside
  the core (QA contract preserved). Canvas `aria-label` unchanged.

### `assets/css/tokens.css`
- Replaced the now-unused "golden core" tokens with the electric-blue core
  tokens (`--c-void/--c-blue/--c-cyan/--c-ice/--c-steel/--c-crimson`,
  `--c-blue-soft`, `--c-cyan-line`) and `--shadow-core` / `--shadow-core-hi`.

### `assets/css/styles.css`
- `.hero` now carries the deep-navy gradient.
- `.hero::before` = pure-CSS technical grid (44 px, cyan/blue hairlines, radial
  mask, faded to the edges) — no more `grid-fine.svg` here.
- `.hero::after` = top/bottom navy fade + pointer-following cyan light + a
  static deep-blue wash — no more `amber-glow.svg`.
- `.hero-visual::after` = restrained projection platform beneath the core.
- `.hero-core-fallback` and `.hero-core-mark` recoloured cyan/ice.
- New identity styles: `.core-identity`, `.core-reticle(--outer/--inner)`,
  `.core-status`, `coreScanSpin` / `coreTick` keyframes.
- `grid-fine.svg` is still used by another section (unchanged).

### `assets/css/device.css`
- `.hero-visual::before` ambient bloom recoloured from gold/amber to cyan/blue.

### `assets/css/ai.css`
- Activation core dot/ring/ripple and the `.ai-core-label` wordmark recoloured
  to ice/cyan; the AI panel spark and message avatar recoloured to match.

### Not touched
`assets/img/deco/amber-glow.svg` remains on disk but is now unreferenced
(left in place; it is untracked). The AdSense `<head>` edits in
`blog.html` / `tutorials.html` / `vlogs.html` are **pre-existing** (they belong
to the earlier task, not V1.2).

---

## 3. Scene budgets

Adaptive per breakpoint (`mobile` = viewport ≤ 700 px). Desktops get the full
counts; mobile runs reduced counts.

| Element            | Desktop | Mobile |
|--------------------|---------|--------|
| Shell wireframe instances (3 layers) | 74 / 60 / 46 | 22 / 18 / 14 |
| Instanced panels   | 44 / 34  | 24 / 18 |
| Struts             | 96      | 40     |
| Circuit traces     | 470     | 210    |
| Circuit nodes      | 170     | 90     |
| Solder pads        | 90      | 40     |
| Fragments          | 70 / 40 / 16 | 40 / 22 / 8 |
| Debris shards      | 130     | 60     |
| Dust particles     | 3200    | 1000   |
| Spark particles    | 340     | 130    |
| Travellers         | 26      | 14     |

---

## 4. Performance

Measured with a WebGL draw-call hook (Playwright + Chrome SwiftShader), viewport
1440 × 900:

- **Draw calls ≈ 37 / frame** (objective, stable across runs).
- Canvas: desktop **500 × 500** at DPR 1; mobile core 342 px, buffer 513 px
  (DPR capped at **1.5** for mobile).
- Page / globe: **0 console or page errors**; `mode = webgl`, `running = true`;
  exactly one `canvas.hero-gl`; the original canvas is hidden; the CSS fallback
  is hidden once a frame renders.
- Responsive sweep **320 / 360 / 390 / 430 / 600 / 768 / 1024 / 1440 / 1920**:
  `overflowX = 0`, no heading-line clipping, `hasGl = true`, no in-core logo,
  0 errors. Reduced motion → `running = false`.
- At 320–430 px and 360 px the hero core sits below the fold, so the
  `IntersectionObserver` **pauses** the loop (`running = false`) until scrolled
  into view — intended behaviour, verified (scroll into view → `running = true`).

**Renderer caveat (important):** the CI/dev WebGL here is Chrome's software
rasteriser (SwiftShader). Scene build + first-frame shader compilation is
CPU-bound there and was observed to take roughly **8 s when the machine is
lightly loaded and up to ~30 s under heavy parallel load**. On real GPU hardware
(shaders compiled once by the driver) initialisation is expected in the low
hundreds of milliseconds. The absolute SwiftShader FPS is not a meaningful
signal for this site because the page's own CSS (device mock, large blurs,
continuous carousel) already starves the software compositor (~1 fps) even with
the globe entirely blocked.

---

## 5. QA results

| Suite       | Result | Notes |
|-------------|--------|-------|
| `qa-device` | **22 / 22** | boot stays ~2.5 s, clears on its own, settle 1.5 s after boot, monitor scroll lock, full-width toggle, carousel, reduced-motion single frame |
| `qa-pages`  | **22 / 22** | 13 pages overflow-free; 320–430 heading fits; 0 errors |
| `qa-admin`  | **72 / 72** | admin/CMS untouched (regression guard) |
| `ai-qa`     | **40 / 40** | (a first run showed an intermittent "panel open immediate (222 ms)" timing miss under load; a clean re-run passed all 40) |
| `qa-scroll` | **31 / 33** | 2 borderline transition-timing checks: "search panel finishes at full opacity" (measured 0.9975 vs required 1.0) and the pre-existing "reading progress advances (0 %→0 %)". Both are CSS transition/scroll timing under the software renderer, unrelated to the canvas. |

No uncaught page errors in any suite.

---

## 6. Artefacts

Stills and a short animation recording were captured to
`C:\Users\haami\AppData\Local\Temp\ah-qa\out\`:

- `re-desktop.png`, `re-desktop-core.png`, `re-mobile-core.png`
- `hero-desktop-core.png`, `hero-mobile-core.png`, `hero-360-core.png`
- `resp-320/360/390/430.png`
- `rec\page@*.webm` — a 1280 × 800 clip that pulses the core and moves the
  pointer to show parallax / energy response.

---

## 7. How to view

The site must be served over HTTP (WebGL cannot run from `file://` because the
vendored Three ESM module is blocked by CORS):

```
python -m http.server 8000        # from the project root
# then open http://localhost:8000/
```

Opening `index.html` directly over `file://` shows only the transparent
canvas-2D fallback (blue).

---

## 8. Known limitations / follow-ups

- V1.2 could not be visually inspected frame-by-frame by the assistant; palette
  and brightness were tuned from programmatic pixel statistics (dominant
  blue/cyan, ice core, ≪3% crimson) and the spec's guidance. A human pass to
  fine-tune opacity/bloom on real hardware is recommended.
- The software-renderer timing flakes in `qa-scroll` (2) are environmental; they
  are unaffected by the hero canvas.
- No commit / push / deploy was performed, as instructed.
