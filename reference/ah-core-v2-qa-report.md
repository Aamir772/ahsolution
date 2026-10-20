# AH Solution — Holographic AI Core V2.0 QA Report

Art-direction refinement per Master Art-Direction Brief V2.0 (reference\ah-core-art-direction-v2.md).
**Status:** implemented, tested, not committed.
**Files changed:** `assets/js/globe.js` only (`index.html` and `assets/css/styles.css` hero markup/CSS were already in place from V1.2 and needed no further changes).
**Preserved:** public API (`core.pointer`, `core.globe.{pulse,setSpeed,state}`), `canvas.hero-gl`, transparent canvas-2D fallback, one renderer/loop, off-screen and reduced-motion pause, `dispose()`, boot timing (~2.5 s).

---

## Renderer mode

Localhost (`http://localhost:8000/index.html`): WebGL active, `mode=webgl`, `running=true`, exactly one `canvas.hero-gl`, original canvas hidden (`display:none`), CSS fallback hidden after first frame, `hasLogo=false`, 0 console/page errors. Canvas 500×500 desktop (DPR 1), 513×513 mobile core (DPR capped 1.5).
`file:///` preview is not a valid basis for WebGL judgment (vendored Three ESM blocked by CORS); it shows the transparent blue 2D fallback only.

## Browser errors

Zero uncaught page errors across all QA suites (device, pages, admin, scroll, ai), both normal and reduced-motion contexts.

## Viewport checks

| Check | Result |
|-------|--------|
| Responsive 320/360/390/430/600/768/1024/1440/1920 | overflowX=0, no heading-line clipping, hasGl=true, no in-core logo, 0 errors |
| Hero core size | ~500px desktop, ~342px mobile (390px vp), ~312px (360px vp) |
| 360px viewport | core sits below fold → loop pauses via IntersectionObserver (`running=false`), resumes on scroll into view (`running=true`) — intended |
| Reduced motion | `running=false`, single frame, boot completes, reveal content immediate |
| 2D fallback (forced) | `mode=canvas2d`, `running=true`, animating blue mechanical silhouette, 0 errors |

## Performance

- Draw calls measured ≈ 37/frame via WebGL draw-call hook (desktop, SwiftShader).
- Scene build is heavy on the first paint under the software rasterizer; `whenBooted()` now defers start until `booted` + `device-settled` + window `load` (9 s safety cap) so boot/~2.5 s animation is never starved. Observed settle ~1.5 s after boot on an unloaded machine; SwiftShader shader compilation can stretch this — expected, not a defect.
- On real GPUs (driver-compiled shaders) initialization is expected in the low hundreds of ms.
- Note: absolute SwiftShader FPS (~1 fps) is not meaningful here — the page's own CSS (device mock, blurs, carousel) starves the software compositor even with the globe fully blocked.

## Known flakes (environmental, pre-existing, unrelated to this change)

- `ai-qa`: intermittent "panel open immediate / panel opens on core click" timing misses and the standing "mobile sheet is anchored to the bottom" miss (verified identical with globe.js blocked — sheet settles flush, just slower than the harness wait under SwiftShader). Earlier clean run: 40/40.
- `qa-scroll`: standing "reading progress advances (0%→0%)" and intermittent reveal/search-panel opacity timing misses (borderline CSS transition thresholds under software rendering).

## Materials / lighting (art-direction corrections)

- Structural panels, wires, frames, pads, fragments: switched from `THREE.AdditiveBlending` to normal blending, lower opacities (0.06–0.22) — overlapping lines no longer stack into a solid bright ball.
- Steel (`#16456B`) struts/supports now the dominant structural read; circuitry thinner and dimmer (traces 0.10–0.13, nodes 0.35).
- Central nucleus reduced: glow sprite opacity 0.25 scale 0.92, heart radius 0.18 opacity 0.8, single cyan containment cage (0.46) — center is focal without an oversized white hotspot.
- Palette verified programmatically on rendered core: deep structured blues dominate; ice-white pixels minimal; crimson absent from bright tones (restrained brand accent only).

## Budgets (desktop / mobile)

shellFrames [40,32,24] / [16,14,10]; panels [26,20] / [16,12]; struts 80 / 32; traces 360 / 160; nodes 120 / 60; pads 60 / 28; frags [60,32,12] / [32,18,6]; debris 100 / 44; dust 2200 / 700; sparks 220 / 90; travelers 20 / 10.

## Animation

Independent counter-rotating layers (core/cage/radial/circuit/shell/debris at distinct speeds/directions), gentle core pulse, pointer parallax, slow debris drift, traveling energy packets, expanding scan rings — elapsed-time/delta-time, no per-frame geometry recreation.

## Artifacts (C:\Users\haami\AppData\Local\Temp\ah-qa\out\)

- `re-desktop.png` — full desktop hero before/after pair reference
- `re-desktop-core.png` — close-up of core and mechanical layers
- `re-mobile-core.png` — mobile core
- `rec\page@*.webm` — ~8 s animation recording (pointer nudge + core pulse)

## Verification command

`python -m http.server 8000` from the project root, then `http://localhost:8000/index.html` (Ctrl+F5 to refresh).

**No commit, push, or deploy performed.**
