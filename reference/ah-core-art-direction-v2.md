# AH Solution — Cinematic Holographic AI Core

Art-direction analysis and design decisions (Master Art-Direction Brief V2.0).

**Project root:** `F:\AI Project\AH Solution`
**Local preview:** `http://localhost:8000/index.html`
**Primary files:** `index.html`, `assets/js/globe.js`, `assets/css/styles.css`
**Status:** analysis only — no committed changes.

---

## Reference inventory

`F:\AI Project\AH Solution\reference` contains:

| File | Type | Notes |
|------|------|-------|
| `AH-Solution-OpenCode-Redesign-Brief.md` | written brief | Site redesign brief (design system, hero layout, token roles). |
| `ah-hologram-rebuild-report.md` | report | QA report for the prior mechanical-core (V1) rebuild. |
| `ah-hologram-v1.2-report.md` | report | QA report for the V1.2 electric-blue refinement. |
| `ah-solution-cinematic-concept.png` | PNG | Cinematic concept render (could not be opened visually). |
| `reference1.gif` … `reference7.webp` | gif / avif / webp | Seven reference media files (could not be opened visually). |

**Limitation recorded:** the assistant cannot open image/media files, so reference images (PNG, GIF, AVIF, WebP) could not be studied directly. Filenames only were inspected. Where references are unavailable, decisions below are grounded in:

1. the Master Art-Direction Brief V2.0 targets (silhouette, seven systems, material hierarchy, lighting gates),
2. direct inspection of the current implementation (`globe.js`, `index.html`, `styles.css`),
3. programmatic pixel statistics from prior QA captures (core is cyan/white-dominant; crimson ≈ 0.04–0.09% of the core element; corners dark).

---

## Current implementation state (inspection findings)

### What exists (V1.2 electric-blue build)

- **Central energy source:** glow sprite (opacity 0.42, scale 1.18×gp), ICE icosahedron heart (radius 0.22, opacity 0.9), CYAN wireframe icosahedron cage (0.42), BLUE wireframe octahedron cage2 (0.6) — all clustered at the center.
- **Radial assembly:** spokes (72 blue wire lines), broken concentric arcs across 7 radii (cyan), crimson calibration arcs (4), 4 partial filled discs (RingGeometry, blue).
- **Circuit network:** ~470 traces routed on random sphere shells, ~170 nodes (cyan/ice/crimson), ~90 square pads (cyan).
- **Broken outer shell:** 3 instanced depth layers (radii 1.52/1.86/2.2) of SphereGeometry patches, CircleGeometry panels at r≈1.75–2.35, steel struts.
- **Debris:** instanced box/tetra/octa/icosa fragments (blue/cyan/ice/crimson) at r≈1.7–3.0.
- **Particles:** dust (ShaderMaterial, 3200) + sparks (340), energy travelers (26), 3 scan rings (blue/cyan/crimson torus).
- **Animation:** single loop, per-layer independent rotation (core/cage/cage2/radial/circuit/shell/debris at distinct speeds), pointer parallax, core pulse on heartbeat + pointer, off-screen/reduced-motion pause, `dispose()`.
- **Branding (DOM overlay):** `.core-identity` with two reticles, ice/cyan `AH` monogram SVG, `CORE 01 · SYSTEM ONLINE` status, `SOLUTION AI` label, `ai-core` button — none baked into WebGL.
- **Environment (CSS):** navy radial-gradient hero, faint CSS technical grid, cyan pointer light, projection platform — all low contrast, transparent canvas.

### Identified problems (per Brief §13)

1. **Excessive central brightness:** heart opacity 0.9 ICE + glow sprite opacity 0.42 scaled to ~1.7 under pulse → oversized white-cyan hotspot; surrounding geometry unreadable at center.
2. **Additive blending everywhere:** panels, wires, frames, traces, nodes, pads, fragments all use `THREE.AdditiveBlending`; overlapping transparent lines stack into a solid bright ball, destroying crisp edges and layer separation.
3. **Uniform visual texture:** almost every material is luminous; insufficient dark steel surfaces and negative space inside the construct.
4. **Shell/inner overlap:** panels at r≈1.75–2.35 sit at the same band as struts and arcs, so silhouette reads as uniform scatter rather than broken open armor.
5. **Circuit density vs. weight:** traces at opacity 0.22 additive, nodes at 0.6 additive → fine circuitry competes with the core instead of reading as detail.

---

## Design decisions (implementation plan)

Guided by Brief §§03–09 and the correction sequence in §13.

### PASS A — Form (silhouette + mechanical layers)

- **Preserve seven systems** but re-tune radii so layers read as separated: nucleus ≈ 0.2–0.45, inner containment ≈ 0.5–1.0, broken shell ≈ 1.2–2.0, outer fragments/arcs ≈ 1.9–3.0.
- **Outer shell as broken armor:** keep instanced sphere-patch segments and polygonal panels, but reduce per-layer counts toward the low end of Brief targets (desktop: ~22–40 patches per layer, ~24–44 panels) so gaps and negative space dominate; panels distributed in incomplete arcs rather than full scatter.
- **Radial supports dominant:** increase visibility of dark steel-blue struts; they define the engineered silhouette.
- **Core shrink:** glow sprite scale base ~0.9 (was 1.18), opacity ~0.25 (was 0.42); heart radius 0.18–0.22, opacity capped ~0.8; keep only one cage ring around the heart to reduce central clustering.

### PASS B — Materials and lighting

- **Material hierarchy (non-additive default):**
  - Dark structural steel (`#16456B`, low opacity, normal blending) for struts, supports, most shell frames.
  - Holographic lines (`#00A8FF` / `#48E5FF`, thin, opacity ~0.08–0.14, normal blending) for shell patches and secondary traces.
  - Energy-bearing (`#48E5FF`, opacity ~0.18–0.25) for a minority of traces/nodes.
  - Ice white (`#D8F8FF`) limited to nucleus heart + a few critical nodes.
  - Crimson (`#FF183D`) rare — only calibration arcs + rare warning ticks; never dominant.
  - Translucent panels: subtle tint, edges more visible than surfaces.
- **Blend mode:** switch structural panels/wires/frames/pads/fragments from `AdditiveBlending` to normal blending with lower opacity; keep additive only on the glow sprite, heart, traveler points, and scan rings.
- **Lighting order:** nucleus brightest → inner energy elements → circuitry dimmer → supports mostly dark → debris intermittent.

### PASS C — Animation and branding

- **Independent layers retained** (already implemented): core pulse slow; containment layers counter-rotate at distinct speeds; shell slow precession; debris slow independent drift; circuitry mostly static with rare travelers.
- **Timing:** elapsed-time/delta-time animation already in place; no per-frame geometry recreation.
- **Branding:** keep DOM overlay (`.core-identity` reticles + `AH` monogram + `CORE 01 · SYSTEM ONLINE` + `SOLUTION AI` label). Do not bake AH into WebGL. Keep contrast so monogram reads over dark center (dark backing via CSS drop-shadow / text shadow already present).

### PASS D — Website integration

- Preserve public API: `core.pointer`, `core.globe.{pulse,setSpeed,state}`, `canvas.hero-gl`, fallback canvas.
- Preserve reduced-motion (`running === false`), off-screen pause, resize handling, `dispose()`.
- Keep 2D canvas-2D fallback recolored to the same blue palette.
- No changes to AI chat, voice, navigation, search, or links.

---

## Success criteria (art-director acceptance, Brief §17)

Three seconds on the homepage, the viewer should notice:

1. The AH Solution headline and CTA buttons (left side, untouched).
2. A complex, premium, fragmented mechanical mechanism on the right.
3. A concentrated energy source surrounded by visible mechanical construction — not a white-blue glowing ball.
4. Restrained blue/cyan illumination against a dark environment.
5. Legible `AH / SOLUTION AI` identity at center.

Gates (Brief §14): silhouette readable when paused; six subsystems distinguishable; center focal without hotspot; 3D depth perceptible; coherent independent motion; branding legible; responsive at 320/360/390/768/1024/1440/1920; no new console errors; fallback working; reduced-motion supported.

---

## Deliverables (planned)

1. Updated `assets/js/globe.js` (refined, same API), `index.html` (unchanged hero markup), `assets/css/styles.css` (hero environment tuning if needed).
2. This document (`reference/ah-core-art-direction-v2.md`).
3. Before/after desktop screenshots, core close-up, mobile screenshot, 5–10 s recording → `C:\Users\haami\AppData\Local\Temp\ah-qa\out\`.
4. QA report (renderer mode, errors, viewport checks, performance, files changed).

**Constraint:** no commit / push / deploy.
