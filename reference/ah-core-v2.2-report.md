# AH Solution — Hero Core V2.2 Report
## "Cinematic Mechanical Core Refinement"

Scope: refine the hero holographic AI-reactor construct so it reads as a
**layered mechanical object** rather than a soft translucent blue cloud.
Homepage structure, copy and functionality were left intact. No commit/push/deploy.

---

## 1. Diagnosis — why V2.1 still looked like a cloud

The V2.1 shell built its silhouette from curved armor plates that used:

```js
new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.60, depthWrite: false, side: DoubleSide })
```

`transparent + depthWrite:false` means every plate is a **semi-transparent
sheet that never occludes another plate**. Dozens of them piled up, each
letting ~40 % of what was behind it through, so overlapping plates summed into
one soft luminous mass — the "blobby cloud". The pale translucent hologram
panels (opacity 0.08/0.06) and the additive glow/traces compounded it, and no
plate had a defined edge, so nothing communicated "machined hardware".

Root cause: **lack of occlusion + lack of defined panel edges**, i.e. a
rendering/material problem, not a layout or geometry-count problem.

---

## 2. Changes (single file: `assets/js/globe.js`)

### 2.1 Opaque, depth-sorted armor plates (fixes the cloud)
- Plates are now **opaque** `MeshBasicMaterial` (no transparency, real depth
  write). Overlapping armor pieces now **occlude** each other instead of
  blending → the shell reads as solid metal with true foreground/background.
- Removed the pale translucent "highlight plates" and the old `mPlate`/`mPlateHi`.

### 2.2 Per-plate steel tones (breaks the mass into pieces)
- Each instance gets its own steel tone via `InstancedMesh.setColorAt()`
  drawn from `PLATE_TONES = [0x0A2233, 0x0F3046, 0x14415C, 0x1C5C88, 0x1E5478, 0x256283]`.
  Adjacent plates no longer merge into one silhouette — the shell reads as many
  discrete machined panels.

### 2.3 Crisp panel-edge outlines (the mechanical "read")
- `THREE.EdgesGeometry(plateGeo, 24)` is baked for each plate geometry
  (threshold 24° drops the ~7–8° interior sphere-grid edges and keeps only the
  clean panel border).
- Every plate's outline is transformed by its instance matrix and merged into a
  **single** `LineSegments` mesh (`mEdge`, cyan `#AEEFFF`, opacity 0.72) → one
  draw call, every panel gets a defined rim.

### 2.4 Supporting mechanics kept and made readable
- Steel radial struts (`mSteel` opacity raised 0.36 → 0.48) with instanced
  spherical joints at their outer ends.
- Three incomplete structural rings (`mRim` opacity 0.20 → 0.26).
- Fewer, larger inner-layer plates (`shellFrames` 14/20/12 → 11/20/13 desktop,
  8/11/7 → 7/11/8 mobile) so the nucleus sits in an open dark gap.
- Translucent hologram panels retained only as a small accent layer.

### 2.5 Unchanged layers
- Nucleus (ICE heart + cyan cage + two containment rings + additive glow),
  radial assembly, circuit traces, drift dust/sparks, travelers, scan rings,
  fragments and the transparent **2D canvas fallback** were kept.
- Public API (`pointer`, `globe.pulse/setSpeed/state`, `canvas.hero-gl`,
  `[data-hero-core]`) and the reduced-motion / off-screen-pause / dispose /
  resize behaviour are untouched.

---

## 3. Verification

### 3.1 Programmatic frame analysis (isolated construct, black background)
Tool: `core-density.cjs` (radial edge/lit/luminance profiling + silhouette bbox).

| metric | V2.1 (before) | V2.2 (after) |
|---|---|---|
| edge density | 11.64 % | **12.87 %** |
| lit > 26 | 61.02 % | 55.80 % |
| lit > 140 | — | 1.02 % |
| crimson | 0 % | 0.001 % |
| radial edge density (core→outer) | — | [22.9, 14.5, 18.9, 17.6, 10.5] |
| radial mean luminance | — | [68.4, 61.5, 73.0, 51.5, 25.2] |

The **lower global lit fraction with a higher edge fraction** is the signature
of the intended change: fewer additive/translucent washes, more structural
edge contrast. Per-plate tonal variation is visible in the ASCII luminance map
(distinct `:`/`-`/`=` plate bands instead of one uniform tone), with the
nucleus the brightest local feature and dark gaps between armor sections.

### 3.2 Automated QA (all green)

| suite | result |
|---|---|
| `qa:device` | 22 / 22 |
| `qa:pages` (13 pages + 320/360/390/430px) | 22 / 22 |
| `ai-qa` (desktop + mobile + voice + knowledge-only) | 40 / 40 |
| `qa:scroll` | 33 / 33 |
| `qa:admin` | 80 / 80 |
| 2D fallback (`force2d`) | `mode=canvas2d, running=true, errors=0` |
| console / page errors | 0 |

`qa:device` continues to assert **webgl + running**, the reduced-motion
single-frame path, and no logo SVG inside `[data-hero-core]`.

### 3.3 Renderer
WebGL (three r169, vendored ESM build) under ANGLE/SwiftShader for CI. Absolute
FPS is not meaningful under software rendering; the construct still initialises
and animates, and the 2D fallback path is verified.

---

## 4. Deliverables
- Desktop before/after: `iso-core2.png` (V2.1, translucent sheets) →
  `v22c-iso.png` (V2.2, isolated).
- Core close-up: `v22-desktop-core.png` (as seen, hero region).
- Mobile: `v22-mobile-core.png` (390px).
- Full desktop: `v22-desktop.png`.
- Motion recording: `rec/*.webm` (1280×800, ~10 s with pointer parallax + two
  pulses).
- All under `C:\Users\haami\AppData\Local\Temp\ah-qa\out`.

## 5. Files changed this round
- `assets/js/globe.js` (only). Other entries in `git status` are pre-existing
  V1/V2 and blog/CMS changes, not part of V2.2.

## 6. Known limits / follow-ups
- The construct is **randomly generated each load**, so frame metrics vary
  slightly run-to-run; comparisons here are single representative frames.
- Per-panel "shift/tilt" animation is not implemented per-instance (layer-level
  motion + shell precession + tilt oscillation are).
- Visual judgement was made from programmatic pixel/edge analysis (the assistant
  cannot view images) plus automated suite evidence; a human visual pass on the
  reference concept images is still recommended.
- No commit, push or deploy performed.
