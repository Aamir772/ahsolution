/* ==========================================================================
   AH SOLUTION — globe.js  (V1.2 "Electric Blue" holographic core)

   A procedurally generated, continuously animated holographic MACHINE — not a
   globe: fragmented shells, interlocking radial machinery, connected circuit
   traces, transparent panels, animated debris and a brilliant central energy
   assembly, set inside a cinematic dark environment (environment is CSS; this
   canvas stays transparent).

   Palette (V1.2):
     void navy #050A12 · electric blue #00A8FF · plasma cyan #48E5FF
     ice white #D8F8FF · brand crimson #FF183D · deep steel blue #16456B

   One renderer, one animation loop. Pauses off-screen and under reduced motion.
   If WebGL or the Three module is unavailable, a transparent canvas-2D
   mechanical fallback takes over on the original <canvas>.

   Public API on [data-hero-core]:
     core.pointer(nx, ny)   -> parallax offset (-0.5 .. 0.5)
     core.globe.pulse()     -> energy surge
     core.globe.setSpeed(x) -> base rotation multiplier
     core.globe.setState(s) -> holographic state: idle|connecting|listening|
                               processing|speaking|error (also mirrors to
                               data-holo-state for CSS accents)
     core.globe.energy(v)   -> live audio amplitude 0..1 (speaking only)
     core.globe.state()     -> { mode, running, state }
   ========================================================================== */
(() => {
  'use strict';

  const core = document.querySelector('[data-hero-core]');
  if (!core) return;
  const canvas = core.querySelector('canvas');
  if (!canvas) return;

  let reduce = false;
  try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  const pointer = { x: 0, y: 0 };
  core.pointer = core.pointer || ((x, y) => { pointer.x = x; pointer.y = y; });

  /* ---- Holographic state (set by ai.js, only on state change) ------------
     state : idle | connecting | listening | processing | speaking | error
     energy: 0..1 live audio amplitude while speaking (optional).
     The render loop reads these values, so nothing touches the DOM per frame;
     ai.js calls setState()/energy() only when the state actually changes. */
  const holo = { state: 'idle', energy: 0 };
  const STATE_SPEED = { idle: 1, connecting: 1.9, listening: 1.45, processing: 3, speaking: 1.15, error: 0.6 };
  function setHoloState(s) {
    if (!s || holo.state === s) return;
    holo.state = s;
    try { core.dataset.holoState = s; } catch (e) { /* ignore */ }
  }
  function setHoloEnergy(v) {
    const n = Number(v);
    holo.energy = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
  }

  /* Start only once BOTH the boot sequence has cleared AND the window has
     finished loading. Waiting for `load` is deliberate: the WebGL scene build
     is heavy on the first paint, and starting it during the load phase would
     starve the `load` event (and the boot timers) on slow/software renderers. */
  function whenBooted(cb) {
    const html = document.documentElement;
    const startDelay = reduce ? 0 : 200;
    const usesDevice = !!document.querySelector('.device-shell');
    let booted = html.classList.contains('booted');
    let loaded = document.readyState === 'complete';
    let settled = !usesDevice || html.classList.contains('device-settled');
    let done = false;
    let obs = null, iv = null, cap = null;
    function onLoad() { loaded = true; maybe(); }
    function cleanup() {
      if (obs) obs.disconnect();
      if (iv) clearInterval(iv);
      if (cap) clearTimeout(cap);
      window.removeEventListener('load', onLoad);
    }
    function maybe() {
      if (done || !booted || !loaded || !settled) return;
      done = true;
      cleanup();
      setTimeout(cb, startDelay);
    }
    if (!loaded) window.addEventListener('load', onLoad, { once: true });
    if (!booted || !settled) {
      obs = new MutationObserver(() => {
        if (!booted && html.classList.contains('booted')) booted = true;
        if (!settled && html.classList.contains('device-settled')) settled = true;
        maybe();
      });
      obs.observe(html, { attributes: true, attributeFilter: ['class'] });
    }
    iv = setInterval(() => {
      if (!booted && html.classList.contains('booted')) booted = true;
      if (!loaded && document.readyState === 'complete') loaded = true;
      if (!settled && html.classList.contains('device-settled')) settled = true;
      maybe();
    }, 200);
    cap = setTimeout(() => { booted = true; loaded = true; settled = true; maybe(); }, 9000);
    maybe();
  }

  /* the CSS placeholder is only a placeholder — hide it once a canvas renders */
  function hideFallback() {
    const fb = core.querySelector('.hero-core-fallback');
    if (fb) fb.style.display = 'none';
  }

  /* ---- V1.2 palette ---- */
  const BLUE = 0x00A8FF;      /* electric blue   */
  const CYAN = 0x48E5FF;      /* plasma cyan     */
  const ICE = 0xD8F8FF;       /* ice white       */
  const CRIMSON = 0xFF183D;   /* brand crimson   */
  const STEEL = 0x16456B;     /* deep steel blue */
  const PLATE = 0x1C5C88;     /* armor-plate steel surface */
  const PI2 = Math.PI * 2;

  /* Soft additive glow sprite (the energy source halo). */
  function makeGlowTexture(THREE) {
    const s = 256;
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0.00, 'rgba(216,248,255,1)');
    g.addColorStop(0.14, 'rgba(72,229,255,.85)');
    g.addColorStop(0.40, 'rgba(0,168,255,.32)');
    g.addColorStop(0.72, 'rgba(0,120,210,.08)');
    g.addColorStop(1.00, 'rgba(0,168,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, s, s);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  async function tryThree() {
    const probe = document.createElement('canvas');
    if (!(probe.getContext && (probe.getContext('webgl2') || probe.getContext('webgl')))) return false;
    let THREE;
    try { THREE = await import('../vendor/three.module.min.js'); }
    catch (e) { return false; }
    try { return init3D(THREE) !== false; }
    catch (e) { return false; }
  }

  function start() {
    tryThree().then((ok) => { if (!ok) init2D(); }).catch(() => init2D());
  }

  /* ====================================================================== *
   * WEBGL — THE HOLOGRAPHIC MECHANISM
   * ====================================================================== */
  function init3D(THREE) {
    const parent = canvas.parentElement;
    const glCanvas = document.createElement('canvas');
    glCanvas.setAttribute('role', 'img');
    glCanvas.setAttribute('aria-label', 'Interactive three-dimensional holographic mechanical construct');
    glCanvas.className = 'hero-gl';
    parent.appendChild(glCanvas);

    const mobile = window.innerWidth <= 700;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: glCanvas, alpha: true,
        antialias: !mobile,
        powerPreference: 'high-performance'
      });
    } catch (e) { glCanvas.remove(); return false; }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 120);
    camera.position.set(0, 0.05, 6.4);

    const root = new THREE.Group();
    root.rotation.x = 0.12;
    scene.add(root);

    /* --- shared materials (reused everywhere; no per-frame allocation).
       Structural elements use normal blending over dark steel so they read as
       physical geometry; only energy-bearing elements stay additive. --- */
    const mPanelBlue = new THREE.MeshBasicMaterial({ color: BLUE, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide });
    const mPanelCyan = new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide });
    const mWireBlue = new THREE.LineBasicMaterial({ color: BLUE, transparent: true, opacity: 0.07, depthWrite: false });
    const mWireCyan = new THREE.LineBasicMaterial({ color: CYAN, transparent: true, opacity: 0.05, depthWrite: false });
    const mSteel = new THREE.LineBasicMaterial({ color: STEEL, transparent: true, opacity: 0.48, depthWrite: false });
    const mTrace = new THREE.LineBasicMaterial({ color: CYAN, transparent: true, opacity: 0.12, depthWrite: false });
    const mTraceBlue = new THREE.LineBasicMaterial({ color: BLUE, transparent: true, opacity: 0.09, depthWrite: false });
    const mTraceCrim = new THREE.LineBasicMaterial({ color: CRIMSON, transparent: true, opacity: 0.15, depthWrite: false });
    const mNode = new THREE.PointsMaterial({ color: CYAN, size: 0.02, transparent: true, opacity: 0.32, depthWrite: false, sizeAttenuation: true });
    const mNodeIce = new THREE.PointsMaterial({ color: ICE, size: 0.024, transparent: true, opacity: 0.32, depthWrite: false, sizeAttenuation: true });
    const mNodeCrim = new THREE.PointsMaterial({ color: CRIMSON, size: 0.024, transparent: true, opacity: 0.28, depthWrite: false, sizeAttenuation: true });
    const mPad = new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.20, depthWrite: false, side: THREE.DoubleSide });
    /* armor plates are OPAQUE dark-steel surfaces: overlapping pieces occlude
       each other (depth-sorted) instead of blending into a translucent cloud.
       Two tones give the shell foreground/background depth. */
    const mPlate = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    /* per-plate steel tones (applied via instanceColor) so adjacent armor
       pieces do NOT merge into one silhouette */
    const PLATE_TONES = [0x0A2233, 0x0F3046, 0x14415C, PLATE, 0x1E5478, 0x256283];
    /* crisp panel-edge outlines — this is what makes the shell read as machined */
    const mEdge = new THREE.LineBasicMaterial({ color: 0xAEEFFF, transparent: true, opacity: 0.72, depthWrite: false });
    const mRim = new THREE.LineBasicMaterial({ color: CYAN, transparent: true, opacity: 0.26, depthWrite: false });
    const mJoint = new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.5, depthWrite: false });
    const mFragBlue = new THREE.MeshBasicMaterial({ color: BLUE, transparent: true, opacity: 0.16, depthWrite: false });
    const mFragCyan = new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.18, depthWrite: false });
    const mFragIce = new THREE.MeshBasicMaterial({ color: ICE, transparent: true, opacity: 0.18, depthWrite: false });
    const mFragCrim = new THREE.MeshBasicMaterial({ color: CRIMSON, transparent: true, opacity: 0.28, depthWrite: false });

    /* ---- device-tuned budgets (spec ranges, adapted for the device) ---- */
    const B = mobile
      ? { shellFrames: [7, 11, 8], panels: [10, 7], struts: 18, traces: 60, nodes: 36, pads: 22, frags: [16, 10, 4], debris: 26, dust: 600, sparks: 70, travelers: 8 }
      : { shellFrames: [11, 20, 13], panels: [18, 12], struts: 36, traces: 120, nodes: 70, pads: 40, frags: [30, 18, 7], debris: 60, dust: 900, sparks: 100, travelers: 14 };

    function rndUnit() {
      const u = Math.random() * 2 - 1, a = Math.random() * PI2, s = Math.sqrt(Math.max(0, 1 - u * u));
      return [Math.cos(a) * s, u, Math.sin(a) * s];
    }
    const dummy = new THREE.Object3D();

    /* ---- 1. Central energy source (single controlled nucleus) ---- */
    const coreGroup = new THREE.Group();
    const glowTex = makeGlowTexture(THREE);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.30 }));
    glow.scale.set(0.72, 0.72, 1);
    coreGroup.add(glow);
    const heart = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.16, 1),
      new THREE.MeshBasicMaterial({ color: ICE, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    coreGroup.add(heart);
    /* containment cage kept coarse (low detail = far fewer edges, not a tangle) */
    const cage = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.46, 0),
      new THREE.MeshBasicMaterial({ color: CYAN, wireframe: true, transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    coreGroup.add(cage);
    /* inner containment rings — clear, mechanically distinct layers */
    const cageRingA = new THREE.Mesh(
      new THREE.TorusGeometry(0.33, 0.006, 6, 96),
      new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.34, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    cageRingA.rotation.x = Math.PI / 2;
    coreGroup.add(cageRingA);
    const cageRingB = new THREE.Mesh(
      new THREE.TorusGeometry(0.39, 0.005, 6, 96),
      new THREE.MeshBasicMaterial({ color: BLUE, transparent: true, opacity: 0.30, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    cageRingB.rotation.y = Math.PI / 2;
    coreGroup.add(cageRingB);
    root.add(coreGroup);

    /* ---- 2. Radial mechanical assembly (spokes, arcs, discs, reticles) ---- */
    const radialGroup = new THREE.Group();
    (() => {
      /* spokes — start well outside the containment cage (dark gap preserved) */
      const spokes = [];
      const spokeN = mobile ? 12 : 24;
      for (let i = 0; i < spokeN; i++) {
        const a = (i / spokeN) * PI2;
        const r0 = 0.80 + Math.random() * 0.08;
        const r1 = 1.02 + Math.random() * 0.20;
        spokes.push(Math.cos(a) * r0, Math.sin(a) * r0, 0, Math.cos(a) * r1, Math.sin(a) * r1, 0);
      }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.Float32BufferAttribute(spokes, 3));
      radialGroup.add(new THREE.LineSegments(sg, mWireBlue));

      /* broken concentric arcs — fewer rings, kept out of the central core */
      const arcs = [];
      const rads = [1.34, 1.16, 0.98, 0.82];
      rads.forEach((r, ri) => {
        const segs = 4 + ri;
        const off = Math.random() * PI2;
        for (let i = 0; i < segs; i++) {
          const a0 = off + (i / segs) * PI2;
          const a1 = a0 + (PI2 / segs) * (0.34 + Math.random() * 0.32);
          const steps = Math.max(3, Math.round((a1 - a0) * 14));
          for (let k = 0; k < steps; k++) {
            const t0 = a0 + (a1 - a0) * (k / steps);
            const t1 = a0 + (a1 - a0) * ((k + 1) / steps);
            arcs.push(Math.cos(t0) * r, Math.sin(t0) * r, 0, Math.cos(t1) * r, Math.sin(t1) * r, 0);
          }
        }
      });
      const ag = new THREE.BufferGeometry();
      ag.setAttribute('position', new THREE.Float32BufferAttribute(arcs, 3));
      radialGroup.add(new THREE.LineSegments(ag, mWireCyan));

      /* restrained crimson calibration arcs */
      const crim = [];
      for (let i = 0; i < 2; i++) {
        const r = 1.02 + i * 0.12;
        const a0 = (i * 1.7) + 0.3;
        for (let k = 0; k < 8; k++) {
          const t0 = a0 + k * 0.06, t1 = t0 + 0.05;
          crim.push(Math.cos(t0) * r, Math.sin(t0) * r, 0, Math.cos(t1) * r, Math.sin(t1) * r, 0);
        }
      }
      const cg = new THREE.BufferGeometry();
      cg.setAttribute('position', new THREE.Float32BufferAttribute(crim, 3));
      radialGroup.add(new THREE.LineSegments(cg, mTraceCrim));

      /* partial filled discs (instanced) */
      const discGeo = new THREE.RingGeometry(0.5, 0.548, 36, 1, 0, 1.25);
      const disc = new THREE.InstancedMesh(discGeo, mPanelBlue, 3);
      for (let i = 0; i < 3; i++) {
        dummy.position.set(0, 0, 0);
        dummy.rotation.set(0, 0, Math.random() * PI2);
        const s = 1 + i * 0.44;
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        disc.setMatrixAt(i, dummy.matrix);
      }
      disc.instanceMatrix.needsUpdate = true;
      radialGroup.add(disc);
    })();
    radialGroup.rotation.x = 0.42;
    root.add(radialGroup);

    /* ---- 3. Connected circuit-trace network (traces + nodes + pads) ---- */
    const circuitGroup = new THREE.Group();
    const padPts = [];
    (() => {
      const seg = [], nodes = [], iceNodes = [], crimNodes = [];
      for (let t = 0; t < B.traces; t++) {
        const n = rndUnit();
        const h = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        let u = [n[1] * h[2] - n[2] * h[1], n[2] * h[0] - n[0] * h[2], n[0] * h[1] - n[1] * h[0]];
        const ul = Math.hypot(u[0], u[1], u[2]) || 1; u = [u[0] / ul, u[1] / ul, u[2] / ul];
        const v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
        const r = 1.15 + Math.random() * 0.45;
        const start = Math.random() * PI2;
        const M = 3 + (Math.random() * 5 | 0);
        const span = 0.6 + Math.random() * 1.6;
        let prev = null;
        for (let k = 0; k <= M; k++) {
          const th = start + span * (k / M);
          const jr = r + (Math.random() - 0.5) * 0.05;
          const ct = Math.cos(th), st = Math.sin(th);
          const p = [(ct * u[0] + st * v[0]) * jr, (ct * u[1] + st * v[1]) * jr, (ct * u[2] + st * v[2]) * jr];
          if (prev) seg.push(prev[0], prev[1], prev[2], p[0], p[1], p[2]);
          prev = p;
          if (Math.random() < 0.5) {
            const roll = Math.random();
            if (roll < 0.12) crimNodes.push(p[0], p[1], p[2]);
            else if (roll < 0.4) iceNodes.push(p[0], p[1], p[2]);
            else nodes.push(p[0], p[1], p[2]);
            if (Math.random() < 0.3) padPts.push(p[0], p[1], p[2]);
          }
        }
      }
      const tg = new THREE.BufferGeometry();
      tg.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
      circuitGroup.add(new THREE.LineSegments(tg, mTrace));

      const ng = new THREE.BufferGeometry();
      ng.setAttribute('position', new THREE.Float32BufferAttribute(nodes, 3));
      circuitGroup.add(new THREE.Points(ng, mNode));

      if (iceNodes.length) {
        const ig = new THREE.BufferGeometry();
        ig.setAttribute('position', new THREE.Float32BufferAttribute(iceNodes, 3));
        circuitGroup.add(new THREE.Points(ig, mNodeIce));
      }
      if (crimNodes.length) {
        const cgn = new THREE.BufferGeometry();
        cgn.setAttribute('position', new THREE.Float32BufferAttribute(crimNodes, 3));
        circuitGroup.add(new THREE.Points(cgn, mNodeCrim));
      }
      /* small square pads (instanced) */
      const pn = Math.min(B.pads, padPts.length / 3 | 0);
      if (pn > 0) {
        const padGeo = new THREE.PlaneGeometry(0.045, 0.045);
        const pads = new THREE.InstancedMesh(padGeo, mPad, pn);
        for (let i = 0; i < pn; i++) {
          dummy.position.set(padPts[i * 3], padPts[i * 3 + 1], padPts[i * 3 + 2]);
          dummy.lookAt(0, 0, 0);
          dummy.rotateZ(Math.random() * PI2);
          const s = 0.6 + Math.random() * 0.9;
          dummy.scale.set(s, s, s);
          dummy.updateMatrix();
          pads.setMatrixAt(i, dummy.matrix);
        }
        pads.instanceMatrix.needsUpdate = true;
        circuitGroup.add(pads);
      }
    })();
    root.add(circuitGroup);

    /* ---- 4. Fragmented outer shell — separated curved armor plates,
       radial struts + joints, and incomplete structural rings.
       Mostly dark steel-blue surfaces; only a few plates/rings catch cyan. ---- */
    const shellGroup = new THREE.Group();
    (() => {
      /* curved armor plates: varied curvature, size, orientation, depth.
         OPAQUE steel surfaces; every plate also emits a crisp edge outline
         (merged into a single line mesh) so each piece reads as machined. */
      const plateGeos = [
        new THREE.SphereGeometry(1, 8, 5, 0.05, 0.95, 0.30, 0.72),
        new THREE.SphereGeometry(1, 6, 4, 1.05, 1.45, 0.70, 0.95),
        new THREE.SphereGeometry(1, 10, 6, 0.30, 1.60, 0.45, 0.90)
      ];
      const plateEdgeGeos = plateGeos.map((g) => new THREE.EdgesGeometry(g, 24));
      const edgePos = [];
      const _v = new THREE.Vector3();
      const captureEdges = (eg, matrix) => {
        const p = eg.attributes.position;
        for (let i = 0; i < p.count; i++) {
          _v.fromBufferAttribute(p, i).applyMatrix4(matrix);
          edgePos.push(_v.x, _v.y, _v.z);
        }
      };
      const _plateCol = new THREE.Color();
      const layerR = [1.55, 1.90, 2.18];
      layerR.forEach((rr, li) => {
        const geo = plateGeos[li];
        const eg = plateEdgeGeos[li];
        const count = B.shellFrames[li];
        const mesh = new THREE.InstancedMesh(geo, mPlate, count);
        for (let i = 0; i < count; i++) {
          const d = rndUnit();
          const r = rr + (Math.random() - 0.5) * 0.34;
          dummy.position.set(d[0] * r, d[1] * r, d[2] * r);
          dummy.lookAt(0, 0, 0);
          dummy.rotateZ(Math.random() * PI2);
          const s = 0.50 + Math.random() * 0.72;
          dummy.scale.set(s * (0.90 + Math.random() * 0.55), s * (0.62 + Math.random() * 0.5), s);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
          mesh.setColorAt(i, _plateCol.setHex(PLATE_TONES[(Math.random() * PLATE_TONES.length) | 0]));
          if (i % 5 !== 4) captureEdges(eg, dummy.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        shellGroup.add(mesh);
      });

      /* one merged line mesh holds every plate outline */
      const egGeo = new THREE.BufferGeometry();
      egGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgePos, 3));
      shellGroup.add(new THREE.LineSegments(egGeo, mEdge));

      /* a few translucent hologram panels remain (accent only, not structure) */
      const tri = new THREE.CircleGeometry(1, 5);
      const hex = new THREE.CircleGeometry(1, 6);
      B.panels.forEach((count, i) => {
        const panels = new THREE.InstancedMesh(i ? hex : tri, i ? mPanelCyan : mPanelBlue, count);
        for (let k = 0; k < count; k++) {
          const d = rndUnit();
          const r = 1.92 + Math.random() * 0.5;
          dummy.position.set(d[0] * r, d[1] * r, d[2] * r);
          dummy.lookAt(0, 0, 0);
          dummy.rotateZ(Math.random() * PI2);
          const s = 0.16 + Math.random() * 0.30;
          dummy.scale.set(s, s * (0.7 + Math.random() * 0.6), s);
          dummy.updateMatrix();
          panels.setMatrixAt(k, dummy.matrix);
        }
        panels.instanceMatrix.needsUpdate = true;
        shellGroup.add(panels);
      });

      /* radial struts / supports (steel), with joints at their outer ends */
      const struts = [];
      for (let i = 0; i < B.struts; i++) {
        const d = rndUnit();
        const r0 = 1.34 + Math.random() * 0.18;
        const r1 = 2.12 + Math.random() * 0.34;
        const jitter = () => (Math.random() - 0.5) * 0.12;
        struts.push(d[0] * r0 + jitter(), d[1] * r0 + jitter(), d[2] * r0 + jitter(),
                    d[0] * r1 + jitter(), d[1] * r1 + jitter(), d[2] * r1 + jitter());
      }
      const stg = new THREE.BufferGeometry();
      stg.setAttribute('position', new THREE.Float32BufferAttribute(struts, 3));
      shellGroup.add(new THREE.LineSegments(stg, mSteel));

      const joints = new THREE.InstancedMesh(new THREE.SphereGeometry(0.035, 6, 5), mJoint, B.struts);
      for (let i = 0; i < B.struts; i++) {
        dummy.position.set(struts[i * 6 + 3], struts[i * 6 + 4], struts[i * 6 + 5]);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(0.7 + Math.random() * 1.1);
        dummy.updateMatrix();
        joints.setMatrixAt(i, dummy.matrix);
      }
      joints.instanceMatrix.needsUpdate = true;
      shellGroup.add(joints);

      /* incomplete structural rings (thin, cyan) */
      const ringDefs = [
        { r: 1.62, tube: 0.006, arc: 1.25, rot: [0.5, 0.2, 0.1] },
        { r: 1.86, tube: 0.005, arc: 0.9, rot: [-0.6, 0.9, 0.3] },
        { r: 2.05, tube: 0.006, arc: 1.05, rot: [1.1, 0.4, -0.5] }
      ];
      ringDefs.forEach((d) => {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(d.r, d.tube, 6, 120, d.arc * Math.PI), mRim);
        ring.rotation.set(d.rot[0], d.rot[1], d.rot[2]);
        shellGroup.add(ring);
      });
    })();
    shellGroup.rotation.x = 0.1;
    root.add(shellGroup);

    /* ---- 5. Mechanical debris / floating fragments (instanced) ---- */
    const debrisGroup = new THREE.Group();
    (() => {
      const scatter = (geo, mat, count, rMin, rMax, sMin, sMax) => {
        const mesh = new THREE.InstancedMesh(geo, mat, count);
        for (let i = 0; i < count; i++) {
          const d = rndUnit();
          const r = rMin + Math.random() * (rMax - rMin);
          dummy.position.set(d[0] * r, d[1] * r, d[2] * r);
          dummy.rotation.set(Math.random() * PI2, Math.random() * PI2, Math.random() * PI2);
          const s = sMin + Math.random() * (sMax - sMin);
          dummy.scale.set(s, s * (0.35 + Math.random() * 0.9), s);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
        debrisGroup.add(mesh);
      };
      scatter(new THREE.BoxGeometry(1, 1, 1), mFragBlue, B.frags[0], 1.9, 2.7, 0.05, 0.13);
      scatter(new THREE.TetrahedronGeometry(1, 0), mFragCyan, B.frags[1], 1.7, 2.5, 0.07, 0.16);
      scatter(new THREE.OctahedronGeometry(1, 0), mFragIce, B.frags[2], 2.1, 2.9, 0.05, 0.1);
      scatter(new THREE.BoxGeometry(1, 1, 1), mFragCrim, Math.max(4, B.frags[0] / 9 | 0), 2.0, 2.8, 0.045, 0.1);
      scatter(new THREE.IcosahedronGeometry(1, 0), mFragBlue, B.debris, 2.0, 3.0, 0.03, 0.09);
    })();
    root.add(debrisGroup);

    /* ---- 6. Particles: drifting dust + bright sparks (GPU points) ---- */
    function makePoints(count, size, speed, amp, sizeMul) {
      const base = new Float32Array(count * 3);
      const dir = new Float32Array(count * 3);
      const seed = new Float32Array(count * 3);
      const col = new Float32Array(count * 3);
      const cIce = new THREE.Color(ICE), cCyan = new THREE.Color(CYAN), cBlue = new THREE.Color(BLUE), cCrim = new THREE.Color(CRIMSON);
      for (let i = 0; i < count; i++) {
        const d = rndUnit();
        const r = 0.5 + Math.random() * 2.6;
        base[i * 3] = d[0] * r; base[i * 3 + 1] = d[1] * r; base[i * 3 + 2] = d[2] * r;
        const dd = rndUnit();
        dir[i * 3] = dd[0]; dir[i * 3 + 1] = dd[1]; dir[i * 3 + 2] = dd[2];
        seed[i * 3] = speed * (0.4 + Math.random() * 1.6);
        seed[i * 3 + 1] = Math.random() * PI2;
        seed[i * 3 + 2] = amp * (0.3 + Math.random() * 1.4);
        const roll = Math.random();
        const c = roll < 0.05 ? cCrim : (roll < 0.4 ? cIce : (roll < 0.72 ? cCyan : cBlue));
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(base, 3));
      geo.setAttribute('aDir', new THREE.BufferAttribute(dir, 3));
      geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
      geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uPulse: { value: 0 }, uSize: { value: size * renderer.getPixelRatio() }, uMul: { value: sizeMul } },
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
        vertexShader: [
          'attribute vec3 aDir; attribute vec3 aSeed; attribute vec3 aColor;',
          'uniform float uTime; uniform float uSize; uniform float uPulse; uniform float uMul;',
          'varying vec3 vColor; varying float vTw;',
          'void main(){',
          '  vec3 p = position + aDir * (sin(uTime * aSeed.x + aSeed.y) * aSeed.z);',
          '  vTw = 0.55 + 0.45 * sin(uTime * aSeed.x * 1.7 + aSeed.y * 1.3);',
          '  vColor = aColor;',
          '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
          '  gl_PointSize = (uSize * (0.5 + aSeed.z * uMul)) * (1.0 + uPulse * 0.7) / max(0.001, -mv.z);',
          '  gl_Position = projectionMatrix * mv;',
          '}'
        ].join('\n'),
        fragmentShader: [
          'uniform float uPulse; varying vec3 vColor; varying float vTw;',
          'void main(){',
          '  vec2 d = gl_PointCoord - 0.5; float r = length(d);',
          '  if (r > 0.5) discard;',
          '  float a = smoothstep(0.5, 0.0, r) * vTw * (0.6 + uPulse * 0.9);',
          '  gl_FragColor = vec4(vColor * (1.0 + uPulse * 0.8), a);',
          '}'
        ].join('\n')
      });
      const pts = new THREE.Points(geo, mat);
      root.add(pts);
      return { mat, uniforms: mat.uniforms };
    }
    const     dust = makePoints(B.dust, mobile ? 3.2 : 4.2, 0.5, 0.5, 0.32);
    const sparks = makePoints(B.sparks, mobile ? 16 : 22, 1.4, 0.5, 3.0);

    /* ---- 7. Traveling circuit highlights (energy packets) ---- */
    const travelers = (() => {
      const N = B.travelers;
      const pos = new Float32Array(N * 3);
      const lanes = [];
      for (let i = 0; i < N; i++) {
        const n = rndUnit();
        const h = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        let u = [n[1] * h[2] - n[2] * h[1], n[2] * h[0] - n[0] * h[2], n[0] * h[1] - n[1] * h[0]];
        const ul = Math.hypot(u[0], u[1], u[2]) || 1; u = [u[0] / ul, u[1] / ul, u[2] / ul];
        const v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
        const r = 0.95 + Math.random() * 0.5;
        lanes.push({ u, v, r, a0: Math.random() * PI2, span: 1.4 + Math.random() * 2.4, spd: 0.25 + Math.random() * 0.5, ph: Math.random() });
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({ color: ICE, size: 0.05, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true });
      const pts = new THREE.Points(geo, mat);
      root.add(pts);
      return { pts, pos, geo, lanes, N };
    })();

    /* ---- 8. Expanding scan pulses ---- */
    const scanGroup = new THREE.Group();
    const scanRings = [];
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(
        new THREE.TorusGeometry(1, 0.0055, 6, 160),
        new THREE.MeshBasicMaterial({ color: i === 2 ? CRIMSON : (i ? CYAN : BLUE), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      m.rotation.x = Math.PI / 2;
      scanGroup.add(m);
      scanRings.push({ mesh: m, phase: i * 0.33 });
    }
    scanGroup.rotation.x = 0.4;
    root.add(scanGroup);

    /* ---- Sizing ---- */
    function resize() {
      const r = parent.getBoundingClientRect();
      const w = Math.max(1, r.width), h = Math.max(1, r.height);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    resize();
    window.addEventListener('resize', resize);
    let ro = null;
    if (window.ResizeObserver) { ro = new ResizeObserver(resize); ro.observe(parent); }
    hideFallback();

    /* ---- Animation (single loop) ---- */
    let baseSpeed = 1, speedMul = 1, pulse = 0, t = 0;
    let running = false, raf = 0;
    const clock = new THREE.Clock();

    function frame() {
      const dt = Math.min(0.05, clock.getDelta());
      t += dt;
      speedMul += (1 - speedMul) * Math.min(1, dt * 2.4);
      pulse *= Math.max(0, 1 - dt * 2.1);
      if (holo.state === 'speaking') pulse = Math.max(pulse, holo.energy * 0.9);
      const spin = baseSpeed * (STATE_SPEED[holo.state] || 1) * (0.7 + 0.3 * speedMul);

      /* parallax + gentle wobble */
      root.rotation.y += (pointer.x * 0.45 - root.rotation.y) * Math.min(1, dt * 1.8);
      root.rotation.x = 0.12 - pointer.y * 0.24 + Math.sin(t * 0.25) * 0.03;
      if (!reduce) root.position.y = Math.sin(t * 0.5) * 0.04;

      /* independent, counter-rotating layers */
      coreGroup.rotation.y += dt * 0.16 * spin;
      coreGroup.rotation.z += dt * 0.05 * spin;
      heart.rotation.x += dt * 0.5 * spin;
      cage.rotation.y -= dt * 0.22 * spin;
      cage.rotation.x += dt * 0.14 * spin;
      radialGroup.rotation.z += dt * 0.09 * spin;
      radialGroup.rotation.y = Math.sin(t * 0.14) * 0.12;
      circuitGroup.rotation.y += dt * 0.07 * spin;
      circuitGroup.rotation.x -= dt * 0.02 * spin;
      shellGroup.rotation.y -= dt * 0.028 * spin;
      shellGroup.rotation.x = 0.1 + Math.sin(t * 0.13) * 0.05;
      debrisGroup.rotation.y += dt * 0.1 * spin;
      debrisGroup.rotation.z -= dt * 0.035 * spin;

      /* energy response */
      const gp = 1 + pulse * 0.45;
      glow.material.opacity = Math.min(1, 0.26 + pulse * 0.22 + Math.sin(t * 2.2) * 0.05);
      glow.scale.set(0.72 * gp, 0.72 * gp, 1);
      heart.scale.setScalar(1 + pulse * 0.4);
      cage.rotation.z += dt * 0.1;
      cageRingA.rotation.z += dt * 0.30 * spin;
      cageRingB.rotation.x += dt * 0.24 * spin;

      dust.uniforms.uTime.value = t; dust.uniforms.uPulse.value = pulse;
      sparks.uniforms.uTime.value = t; sparks.uniforms.uPulse.value = pulse;

      /* traveling highlights along circuit lanes */
      const tpos = travelers.pos, lns = travelers.lanes;
      for (let i = 0; i < travelers.N; i++) {
        const L = lns[i];
        const k = (L.ph + t * L.spd * (0.7 + 0.3 * speedMul)) % 1;
        const th = L.a0 + L.span * k;
        const ct = Math.cos(th), st = Math.sin(th);
        tpos[i * 3] = (ct * L.u[0] + st * L.v[0]) * L.r;
        tpos[i * 3 + 1] = (ct * L.u[1] + st * L.v[1]) * L.r;
        tpos[i * 3 + 2] = (ct * L.u[2] + st * L.v[2]) * L.r;
      }
      travelers.geo.attributes.position.needsUpdate = true;

      for (let i = 0; i < scanRings.length; i++) {
        const s = scanRings[i];
        const p = ((t * 0.28 + s.phase) % 1);
        const sc = 0.55 + p * 1.3;
        s.mesh.scale.set(sc, sc, sc);
        s.mesh.material.opacity = (1 - p) * (0.5 + pulse * 0.4);
      }

      renderer.render(scene, camera);
    }
    function loop() { frame(); raf = requestAnimationFrame(loop); }
    function startLoop() { if (running) return; running = true; clock.getDelta(); raf = requestAnimationFrame(loop); }
    function stopLoop() { running = false; cancelAnimationFrame(raf); }

    renderer.render(scene, camera);
    if (reduce) {
      frame();
    } else {
      startLoop();
      document.addEventListener('visibilitychange', () => { document.hidden ? stopLoop() : startLoop(); });
      if ('IntersectionObserver' in window) {
        new IntersectionObserver((en) => en[0].isIntersecting ? startLoop() : stopLoop(), { threshold: 0.02 }).observe(parent);
      }
    }

    canvas.style.display = 'none';

    core.globe = {
      pulse() { pulse = 1; speedMul = 6; },
      setSpeed(x) { baseSpeed = (typeof x === 'number' && x > 0) ? x : 1; },
      setState(s) { setHoloState(s); },
      energy(v) { setHoloEnergy(v); },
      state() { return { mode: 'webgl', running: running, state: holo.state }; }
    };

    if (!reduce) {
      const heartbeat = setInterval(() => { if (running) core.globe.pulse(); }, 12000);
      core.addEventListener('pointerenter', () => { if (running) core.globe.pulse(); });
      core.addEventListener('pointerdown', () => core.globe.pulse());
      window.addEventListener('pagehide', () => clearInterval(heartbeat), { once: true });
    }

    /* ---- Resource cleanup ---- */
    let disposed = false;
    function dispose() {
      if (disposed) return;
      disposed = true;
      stopLoop();
      if (ro) ro.disconnect();
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        const m = o.material;
        if (m) {
          const arr = Array.isArray(m) ? m : [m];
          arr.forEach((mm) => { if (mm.map) mm.map.dispose(); mm.dispose(); });
        }
      });
      glowTex.dispose();
      renderer.dispose();
    }
    window.addEventListener('pagehide', dispose, { once: true });

    return true;
  }

  /* ====================================================================== *
   * CANVAS-2D FALLBACK — transparent, mechanical, same blue palette
   * ====================================================================== */
  function init2D() {
    const ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return;
    const wrap = canvas.parentElement;
    let W = 0, H = 0, cx = 0, cy = 0, R = 0, dpr = 1;

    /* fragment network (3D shell + links) */
    const PN = 88;
    const fx = new Float32Array(PN), fy = new Float32Array(PN), fz = new Float32Array(PN);
    for (let i = 0; i < PN; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * PI2, s = Math.sqrt(Math.max(0, 1 - u * u)), r = 1.0 + Math.random() * 0.5;
      fx[i] = Math.cos(a) * s * r; fy[i] = u * r; fz[i] = Math.sin(a) * s * r;
    }
    const links = [];
    for (let i = 0; i < PN; i++) {
      links.push([i, (i + 1) % PN]);
      if (Math.random() < 0.32) links.push([i, (i + 5) % PN]);
      if (Math.random() < 0.10) links.push([i, (i + 11) % PN]);
    }

    /* broken concentric arcs (drawn as tilted ellipses) */
    const arcs = [
      { r: 1.30, segs: 5, w: 3, o: 0.06, col: '0,168,255', spd: 0.10 },
      { r: 1.14, segs: 7, w: 3, o: 0.09, col: '72,229,255', spd: -0.14 },
      { r: 0.98, segs: 4, w: 2, o: 0.06, col: '0,168,255', spd: 0.18 },
      { r: 0.84, segs: 5, w: 2, o: 0.09, col: '72,229,255', spd: -0.22 },
      { r: 1.10, segs: 2, w: 2, o: 0.16, col: '255,24,61', spd: -0.09 }
    ];
    arcs.forEach((a, i) => { a.off = i * 0.9; a.css = 'rgba(' + a.col + ',' + a.o + ')'; a.segsS = []; for (let s = 0; s < a.segs; s++) a.segsS.push(Math.random() * PI2); });

    /* precomputed colour ramps (avoid building strings every frame) */
    const LCOL = [], NCOL = [];
    for (let k = 0; k <= 32; k++) {
      LCOL.push('rgba(72,229,255,' + (0.08 + (k / 32) * 0.38).toFixed(3) + ')');
      NCOL.push('rgba(216,248,255,' + (0.12 + (k / 32) * 0.62).toFixed(3) + ')');
    }
    let glowGrad = null;

    /* sparks */
    const SPN = 100;
    const sA = new Float32Array(SPN), sR = new Float32Array(SPN), sS = new Float32Array(SPN), sH = new Float32Array(SPN), sC = new Uint8Array(SPN);
    for (let i = 0; i < SPN; i++) {
      sA[i] = Math.random() * PI2; sR[i] = 0.5 + Math.random() * 1.9;
      sS[i] = 0.2 + Math.random() * 0.8; sH[i] = (Math.random() - 0.5) * 0.7;
      sC[i] = Math.random() < 0.07 ? 1 : 0;
    }

    const S = { x: 0, y: 0, z: 0 };
    const px = new Float32Array(PN), py = new Float32Array(PN), pz = new Float32Array(PN);
    function rot(vx, vy, vz, ax, ay) {
      const cyw = Math.cos(ay), syw = Math.sin(ay);
      const x1 = vx * cyw - vz * syw, z1 = vx * syw + vz * cyw;
      const cxw = Math.cos(ax), sxw = Math.sin(ax);
      S.x = x1; S.y = vy * cxw - z1 * sxw; S.z = vy * sxw + z1 * cxw;
    }

    let mx = 0, my = 0, tmx = 0, tmy = 0;
    let running = false, raf = 0, speedMul = 1, pulse = 0;
    const startT = performance.now();
    const fov = 2.6;

    function resize() {
      const rect = wrap.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = Math.max(1, rect.width); H = Math.max(1, rect.height);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx = W / 2; cy = H / 2; R = Math.min(W, H) * 0.42;
      glowGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.85);
      glowGrad.addColorStop(0, 'rgba(216,248,255,0.55)');
      glowGrad.addColorStop(0.14, 'rgba(72,229,255,0.30)');
      glowGrad.addColorStop(0.4, 'rgba(0,168,255,0.20)');
      glowGrad.addColorStop(1, 'rgba(0,168,255,0)');
    }

    function draw(now) {
      const t = (now - startT) * 0.001;
      speedMul += (1 - speedMul) * 0.03;
      pulse *= 0.94;
      if (holo.state === 'speaking') pulse = Math.max(pulse, holo.energy * 0.9);
      const sMul = speedMul * (STATE_SPEED[holo.state] || 1);
      mx += (tmx - mx) * 0.055; my += (tmy - my) * 0.055;
      const spinY = t * 0.28 * sMul + mx * 0.8;
      const tiltX = 0.32 + Math.sin(t * 0.16) * 0.08 + my * 0.5;

      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';

      const squash = 0.42 + Math.sin(tiltX) * 0.16;

      for (let ai = 0; ai < arcs.length; ai++) {
        const a = arcs[ai];
        const rot0 = t * a.spd * sMul + a.off;
        ctx.strokeStyle = a.css;
        ctx.lineWidth = a.w;
        for (let s = 0; s < a.segs; s++) {
          const a0 = rot0 + a.segsS[s];
          const aLen = (PI2 / a.segs) * 0.62;
          const rr = R * a.r;
          ctx.beginPath();
          ctx.ellipse(cx, cy, rr, rr * squash, 0, a0, a0 + aLen);
          ctx.stroke();
        }
      }

      ctx.strokeStyle = 'rgba(0,168,255,0.20)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 24; i++) {
        const ang = (i / 24) * PI2 + spinY * 0.5;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const r0 = R * 0.5, r1 = R * (0.98 + 0.1 * Math.sin(i * 1.7));
        ctx.beginPath();
        ctx.moveTo(cx + ca * r0, cy + sa * r0 * squash);
        ctx.lineTo(cx + ca * r1, cy + sa * r1 * squash);
        ctx.stroke();
      }

      for (let i = 0; i < PN; i++) {
        rot(fx[i], fy[i], fz[i], tiltX, spinY);
        const sc = fov / (fov + S.z);
        px[i] = cx + S.x * R * sc; py[i] = cy + S.y * R * sc; pz[i] = S.z;
      }
      for (let l = 0; l < links.length; l++) {
        const i = links[l][0], j = links[l][1];
        const near = 1 - ((pz[i] + pz[j]) * 0.5 + 1.5) / 3;
        const nq = Math.max(0, Math.min(1, near));
        ctx.strokeStyle = LCOL[(nq * 32) | 0];
        ctx.lineWidth = 0.8 + nq * 1.1;
        ctx.beginPath(); ctx.moveTo(px[i], py[i]); ctx.lineTo(px[j], py[j]); ctx.stroke();
      }
      for (let i = 0; i < PN; i++) {
        const near = Math.max(0, Math.min(1, 1 - (pz[i] + 1.4) / 2.8));
        ctx.fillStyle = NCOL[(near * 32) | 0];
        ctx.beginPath(); ctx.arc(px[i], py[i], 0.7 + near * 1.3, 0, PI2); ctx.fill();
      }

      ctx.globalAlpha = 0.5 + pulse * 0.1;
      ctx.fillStyle = glowGrad;
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.7, 0, PI2); ctx.fill();
      ctx.globalAlpha = 1;

      for (let i = 0; i < SPN; i++) {
        const a = sA[i] + t * sS[i] * sMul;
        const rr = R * sR[i];
        const X = cx + Math.cos(a) * rr;
        const Y = cy + Math.sin(a) * rr * squash * (1 + sH[i] * 0.4);
        ctx.globalAlpha = 0.12 + 0.22 * (0.5 + 0.5 * Math.sin(t * 2 + i));
        ctx.fillStyle = sC[i] ? 'rgba(255,24,61,0.45)' : (i % 2 ? 'rgba(216,248,255,0.45)' : 'rgba(72,229,255,0.45)');
        ctx.beginPath(); ctx.arc(X, Y, 0.8, 0, PI2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    function loop(now) { draw(now); raf = requestAnimationFrame(loop); }
    function startLoop() { if (running) return; running = true; raf = requestAnimationFrame(loop); }
    function stopLoop() { running = false; cancelAnimationFrame(raf); }

    resize();
    window.addEventListener('resize', resize);
    let ro = null;
    if (window.ResizeObserver) { ro = new ResizeObserver(resize); ro.observe(wrap); }
    hideFallback();
    if (reduce) {
      draw(performance.now());
    } else {
      startLoop();
      document.addEventListener('visibilitychange', () => document.hidden ? stopLoop() : startLoop());
      if ('IntersectionObserver' in window) {
        new IntersectionObserver((en) => en[0].isIntersecting ? startLoop() : stopLoop(), { threshold: 0.02 }).observe(wrap);
      }
    }
    core.pointer = (nx, ny) => { tmx = nx; tmy = ny; };
    core.globe = {
      pulse() { pulse = 1; speedMul = 5; },
      setSpeed(x) { speedMul = (typeof x === 'number' && x > 0) ? Math.max(1, x) : 1; },
      setState(s) { setHoloState(s); },
      energy(v) { setHoloEnergy(v); },
      state() { return { mode: 'canvas2d', running: running, state: holo.state }; }
    };
    if (!reduce) {
      const heartbeat = setInterval(() => { if (running) core.globe.pulse(); }, 12000);
      core.addEventListener('pointerenter', () => { if (running) core.globe.pulse(); });
      core.addEventListener('pointerdown', () => core.globe.pulse());
      window.addEventListener('pagehide', () => clearInterval(heartbeat), { once: true });
    }
    window.addEventListener('pagehide', () => { stopLoop(); if (ro) ro.disconnect(); }, { once: true });
  }

  whenBooted(start);
})();
