# AH Solution — Hero Core Rebuild Report

**Scope:** Replace the old rotating-globe hero centerpiece with a procedurally
generated, real-time Three.js holographic **mechanical construct** (JARVIS-style),
without changing the rest of the site. No commit / push / deploy performed.

## What changed

| File | Change |
| --- | --- |
| `assets/js/globe.js` | **Full rewrite (~720 lines).** Old Earth/globe code removed entirely. New WebGL mechanical construct + rewritten transparent canvas-2D fallback. Public API preserved. |
| `index.html` | Hero canvas `aria-label` updated; added an HTML/SVG **AH** identity mark (`svg.hero-core-mark`, no `role="img"`) so no text is baked into the canvas. Script kept as classic `defer`. |
| `assets/css/styles.css` | Removed the old globe fallback artwork + `::before`/`::after` pseudo-elements and `planetBreathe`; `hero-core-fallback` is now a soft transparent glow only. Added `.hero-core-mark`. |

(The `ai.css` / `device.css` / `tokens.css` working-tree changes are pre-existing
from the prior token/CMS task, not part of this rebuild.)

## Architecture (new `globe.js`)

- **One** `THREE.WebGLRenderer`, **one** rAF loop. The 2D fallback has its own
  loop, but only one path ever runs.
- Procedural layers, each rotating independently (incl. counter-rotation):
  1. central energy source — additive glow sprite + hot icosahedron heart + gold wire cage
  2. radial mechanical assembly — spokes, broken concentric arcs, crimson calibration arcs, partial discs
  3. dense internal circuitry — great-circle traces (`LineSegments`) + glowing nodes (`Points`, incl. crimson)
  4. fragmented outer shell — discontinuous curved panels + cell wireframes
  5. instanced mechanical debris (`InstancedMesh`, box/tetra/octa)
  6. GPU-animated sparks (`ShaderMaterial`, drifting + flicker, additive)
  7. expanding scan rings
- Palette: AMBER `#FF7A00`, GOLD `#FFC04A`, HOT `#FFF0B0`, CRIMSON `#FF183D`.
- Transparent clear color, additive blending, no opaque disc.
- Shared materials, no per-frame allocations (3D loop verified clean; 2D loop
  now caches its radial gradient and precomputes colour ramps).
- Perf: device-tuned budgets (`innerWidth <= 700`), capped DPR, pauses via
  `visibilitychange` + `IntersectionObserver`, renders a single frame under
  `prefers-reduced-motion`, full `dispose()` on `pagehide`.
- API: `core.pointer(nx,ny)`, `core.globe.pulse()`, `core.globe.setSpeed(x)`,
  `core.globe.state() -> { mode, running }`.

## Verification

- `node --check assets/js/globe.js` — OK.
- WebGL active: `mode=webgl`, `running=true`, exactly one `canvas.hero-gl`,
  fallback `display:none`, `hasLogo=false`, console errors `0`.
- Continuous animation confirmed: ~40–45 % of core pixels change between frames
  1 s apart (SwiftShader).
- 2D fallback forced (WebGL blocked): `mode=canvas2d`, `running=true`, no errors,
  animating.
- Responsive sweep: **320/360/390/430/600/768/1024/1440/1920** — no horizontal
  overflow, no headline clipping, `hasGl=true`, `badLogo=false`, errors `0`;
  reduced-motion → `running:false`.
- QA suites:
  - `qa-device` **22/22**
  - `qa-pages` **22/22**
  - `qa-admin` **72/72**
  - `qa-scroll` **31–32/33** (known flake: "reading progress 0%→0%")
  - `ai-qa` **39/40** (flaky timing check: "mobile sheet anchored to bottom")

## Known issues (pre-existing, not caused by the rebuild)

- `ai-qa` "mobile sheet is anchored to the bottom" fails because the harness
  measures 400 ms after opening while the sheet's 0.34 s slide-up is still
  settling under load. Verified **identical with `globe.js` blocked**
  (`mode=none` → same failure), so the rebuild is not the cause. The sheet does
  settle flush to the bottom (`diffBottom: 0` with a longer wait).
- `ai-qa` "chat input receives focus on open" intermittently fails (focus uses a
  70 ms timer that can be delayed under load). Independent of the rebuild.
- `qa-scroll` reading-progress flake (pre-existing).

## Artifacts (temporary, not in repo)

- Stills: `C:\Users\haami\AppData\Local\Temp\ah-qa\out\re-desktop.png`,
  `re-desktop-core.png`, `re-mobile-core.png`
- Recording: `C:\Users\haami\AppData\Local\Temp\ah-qa\out\rec\page@*.webm`
- Backup of the pre-rebuild files:
  `C:\Users\haami\AppData\Local\Temp\opencode\ah-backup-20261015-183214\`

## Not done

No `git commit`, push, or deploy. The admin/CMS system was left untouched.
