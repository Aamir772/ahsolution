/* ==========================================================================
   AH SOLUTION — globe.js
   Cinematic 3D globe (Three.js) with a graceful canvas-2D fallback.

   - Vendored Three.js is imported *after* the startup screen clears, so the
     boot animation is never blocked.
   - If WebGL or the module fails for any reason, the previous canvas-2D
     orbital planet (moved here from main.js) takes over on the original
     canvas element.
   - Exposes on [data-hero-core]:
       core.pointer(nx, ny)  -> parallax offset (-0.5 .. 0.5)
       core.globe.pulse()    -> activation ripple (speed surge + glow)
       core.globe.setSpeed(x)-> base rotation multiplier
       core.globe.state()    -> { mode, running }
   ========================================================================== */
(() => {
  'use strict';

  const core = document.querySelector('[data-hero-core]');
  if (!core) return;
  const canvas = core.querySelector('canvas');
  if (!canvas) return;

  let reduce = false;
  try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  let pointer = { x: 0, y: 0 };
  core.pointer = core.pointer || ((x, y) => { pointer.x = x; pointer.y = y; });

  function whenBooted(cb) {
    const html = document.documentElement;
    if (html.classList.contains('booted')) { cb(); return; }
    let done = false;
    const startDelay = reduce ? 0 : 220;
    const fin = () => {
      if (done) return;
      done = true;
      obs.disconnect();
      clearTimeout(timer);
      // a short pause so the boot -> hero entrance stays smooth before the
      // (synchronous) procedural texture build starts
      setTimeout(cb, startDelay);
    };
    const obs = new MutationObserver(() => { if (html.classList.contains('booted')) fin(); });
    obs.observe(html, { attributes: true, attributeFilter: ['class'] });
    const timer = setTimeout(fin, 6000);
    window.addEventListener('load', () => { if (html.classList.contains('booted')) fin(); }, { once: true });
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
   * THREE.JS GLOBE
   * ====================================================================== */
  function init3D(THREE) {
    const parent = canvas.parentElement;
    const glCanvas = document.createElement('canvas');
    glCanvas.setAttribute('role', 'img');
    glCanvas.setAttribute('aria-label', 'Rotating three-dimensional globe of planet Earth');
    glCanvas.className = 'hero-gl';
    parent.appendChild(glCanvas);

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch (e) { glCanvas.remove(); return false; }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
    camera.position.set(0, 0, 4.2);

    const root = new THREE.Group();
    root.rotation.x = 0.32;
    root.rotation.z = 23.4 * Math.PI / 180; // Earth axial tilt
    scene.add(root);

    /* ---- Procedural Earth maps: black / white / silver / crimson AI identity ---- */
    const maps = makeEarthTextures(THREE);

    /* ---- Cinematic lighting: white key light one side, crimson highlights the other ---- */
    scene.add(new THREE.AmbientLight(0x272c37, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 2.5); key.position.set(-3.6, 1.8, 2.4); scene.add(key);
    const crimson = new THREE.DirectionalLight(0xff2d4d, 1.15); crimson.position.set(3.5, -1.0, -1.8); scene.add(crimson);
    const silver = new THREE.DirectionalLight(0xc3d2e8, 0.5); silver.position.set(0.7, 2.6, 1.7); scene.add(silver);

    /* ---- Planet body (metallic silver continents, dark oceans, crimson energy emissive) ---- */
    const planetMat = new THREE.MeshStandardMaterial({
      map: maps.color, bumpMap: maps.bump, bumpScale: 0.022,
      roughnessMap: maps.rough, metalness: 0.22, roughness: 0.82,
      emissive: new THREE.Color(0xffffff), emissiveMap: maps.energy, emissiveIntensity: 0.85
    });
    const planet = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 64), planetMat);
    root.add(planet);

    /* ---- Thin silver haze shell (drifts slightly faster) ---- */
    const cloudMat = new THREE.MeshStandardMaterial({
      map: maps.cloud, transparent: true, opacity: 0.42, depthWrite: false,
      roughness: 1.0, metalness: 0.0, color: 0xdfe7f4
    });
    const clouds = new THREE.Mesh(new THREE.SphereGeometry(1.012, 64, 64), cloudMat);
    root.add(clouds);

    /* ---- Two-tone fresnel atmosphere: white on the lit side, crimson on the shadow side ---- */
    const atmosUniforms = {
      uWhite: { value: new THREE.Color(0xdbe6ff) },
      uRed: { value: new THREE.Color(0xff2a48) },
      uIntensity: { value: 1.0 }
    };
    const atmos = new THREE.Mesh(
      new THREE.SphereGeometry(1.06, 64, 64),
      new THREE.ShaderMaterial({
        uniforms: atmosUniforms,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.BackSide,
        vertexShader:
          'varying vec3 vNormal; varying vec3 vView;\n' +
          'void main(){ vNormal = normalize(normalMatrix * normal);\n' +
          ' vec4 mv = modelViewMatrix * vec4(position,1.0); vView = normalize(-mv.xyz);\n' +
          ' gl_Position = projectionMatrix * mv; }',
        fragmentShader:
          'uniform vec3 uWhite; uniform vec3 uRed; uniform float uIntensity;\n' +
          'varying vec3 vNormal; varying vec3 vView;\n' +
          'void main(){ vec3 n = normalize(vNormal);\n' +
          ' float fres = pow(1.0 - abs(dot(n, normalize(vView))), 3.0);\n' +
          ' float side = clamp(n.x * 1.4 + 0.5, 0.0, 1.0);\n' +
          ' vec3 col = mix(uRed, uWhite, side);\n' +
          ' gl_FragColor = vec4(col * fres * 1.7 * uIntensity, 1.0); }'
      })
    );
    root.add(atmos);

    /* ---- Independent orbital rings (silver + crimson, subtle drift) ---- */
    const rings = [];
    function addRing(radius, tube, color, opacity, tiltX, tiltZ) {
      const m = new THREE.Mesh(
        new THREE.TorusGeometry(radius, tube, 2, 128),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false })
      );
      m.rotation.x = Math.PI / 2 + tiltX;
      m.rotation.z = tiltZ;
      root.add(m);
      rings.push(m);
      return m;
    }
    addRing(1.1, 0.0035, 0xcdd7e6, 0.5, 0.0, 0.0);
    addRing(1.22, 0.003, 0xff2d4d, 0.42, 0.34, 0.22);
    addRing(1.34, 0.002, 0x94a1b5, 0.3, -0.5, -0.32);

    /* ---- Data particle halo around the sphere ---- */
    const HN = 150;
    const hpos = new Float32Array(HN * 3);
    for (let i = 0; i < HN; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, rr = 1.1 + Math.random() * 0.28;
      const s = Math.sqrt(1 - u * u);
      hpos[i * 3] = Math.cos(a) * s * rr;
      hpos[i * 3 + 1] = u * rr;
      hpos[i * 3 + 2] = Math.sin(a) * s * rr;
    }
    const hGeo = new THREE.BufferGeometry();
    hGeo.setAttribute('position', new THREE.BufferAttribute(hpos, 3));
    scene.add(new THREE.Points(hGeo, new THREE.PointsMaterial({
      size: 0.02, color: 0xe8eefc, transparent: true, opacity: 0.55, depthWrite: false, sizeAttenuation: true
    })));

    /* ---- Global network: great-circle links + travelling AI packets ----
       Links sit on the planet body so they rotate with the surface and are
       occluded by it. White links read as data, crimson ones as "AI" routes. */
    const LINKS = 34, ARC_SEG = 40;
    const arcData = [];
    const linkPositions = [];
    const linkColors = [];
    const packets = [];
    const randDir = () => {
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const s = Math.sqrt(Math.max(0, 1 - u * u));
      return new THREE.Vector3(Math.cos(a) * s, u, Math.sin(a) * s);
    };
    const arcDir = new THREE.Vector3();
    for (let i = 0; i < LINKS; i++) {
      const a = randDir(), b = randDir();
      if (a.distanceTo(b) < 0.75) { i--; continue; }
      const red = i % 3 === 0;
      const pts = new Float32Array((ARC_SEG + 1) * 3);
      for (let s = 0; s <= ARC_SEG; s++) {
        arcDir.copy(a).lerp(b, s / ARC_SEG).normalize();
        const lift = 1.006 + Math.sin((s / ARC_SEG) * Math.PI) * 0.07;
        pts[s * 3] = arcDir.x * lift;
        pts[s * 3 + 1] = arcDir.y * lift;
        pts[s * 3 + 2] = arcDir.z * lift;
      }
      const idx = arcData.length;
      arcData.push({ pts, red });
      for (let s = 0; s < ARC_SEG; s++) {
        linkPositions.push(
          pts[s * 3], pts[s * 3 + 1], pts[s * 3 + 2],
          pts[(s + 1) * 3], pts[(s + 1) * 3 + 1], pts[(s + 1) * 3 + 2]
        );
        const c = red ? [1, 0.18, 0.30] : [0.80, 0.87, 1];
        linkColors.push(c[0], c[1], c[2], c[0], c[1], c[2]);
      }
      packets.push({ arc: idx, t: Math.random(), speed: 0.10 + Math.random() * 0.22 });
    }
    const netGeo = new THREE.BufferGeometry();
    netGeo.setAttribute('position', new THREE.Float32BufferAttribute(linkPositions, 3));
    netGeo.setAttribute('color', new THREE.Float32BufferAttribute(linkColors, 3));
    const network = new THREE.LineSegments(netGeo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending
    }));
    planet.add(network);

    const PKT = packets.length;
    const pktPos = new Float32Array(PKT * 3);
    const pktCol = new Float32Array(PKT * 3);
    packets.forEach((p, i) => {
      const c = arcData[p.arc].red ? [1, 0.34, 0.44] : [0.92, 0.96, 1];
      pktCol[i * 3] = c[0]; pktCol[i * 3 + 1] = c[1]; pktCol[i * 3 + 2] = c[2];
    });
    const pktGeo = new THREE.BufferGeometry();
    pktGeo.setAttribute('position', new THREE.BufferAttribute(pktPos, 3));
    pktGeo.setAttribute('color', new THREE.BufferAttribute(pktCol, 3));
    const pktPts = new THREE.Points(pktGeo, new THREE.PointsMaterial({
      size: 0.03, vertexColors: true, transparent: true, opacity: 0.95,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true
    }));
    planet.add(pktPts);
    const pktScratch = [0, 0, 0];
    function sampleArc(arc, t) {
      const pts = arc.pts;
      const f = Math.min(0.9999, Math.max(0, t)) * ARC_SEG;
      const i0 = f | 0;
      const k = f - i0;
      const j = i0 * 3, l = (i0 + 1) * 3;
      pktScratch[0] = pts[j] + (pts[l] - pts[j]) * k;
      pktScratch[1] = pts[j + 1] + (pts[l + 1] - pts[j + 1]) * k;
      pktScratch[2] = pts[j + 2] + (pts[l + 2] - pts[j + 2]) * k;
      return pktScratch;
    }

    /* ---- Starfield (fixed, far behind the planet) ---- */
    const SN = 700;
    const spos = new Float32Array(SN * 3);
    for (let i = 0; i < SN; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, rr = 9 + Math.random() * 7;
      const s = Math.sqrt(1 - u * u);
      spos[i * 3] = Math.cos(a) * s * rr;
      spos[i * 3 + 1] = u * rr;
      spos[i * 3 + 2] = Math.sin(a) * s * rr;
    }
    const sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute('position', new THREE.BufferAttribute(spos, 3));
    scene.add(new THREE.Points(sGeo, new THREE.PointsMaterial({
      size: 0.045, color: 0xcfd8e6, transparent: true, opacity: 0.7, depthWrite: false, sizeAttenuation: true
    })));

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
    if (window.ResizeObserver) new ResizeObserver(resize).observe(parent);

    /* ---- Animation state ---- */
    let baseSpeed = 0.22, speedMul = 1, pulse = 0, pRot = 0;
    let running = false, raf = 0;
    const clock = new THREE.Clock();

    function frame() {
      const dt = Math.min(0.05, clock.getDelta());
      pRot += (baseSpeed * speedMul) * dt;
      speedMul += (1 - speedMul) * Math.min(1, dt * 2.4);
      pulse *= Math.max(0, 1 - dt * 2.2);

      root.rotation.y += (pointer.x * 0.45 - root.rotation.y) * Math.min(1, dt * 1.8);
      root.rotation.x = 0.32 - pointer.y * 0.22;

      planet.rotation.y = pRot;
      clouds.rotation.y = pRot * 1.08;

      atmosUniforms.uIntensity.value = 1.0 + pulse * 1.4;
      planetMat.emissiveIntensity = 0.85 + pulse * 1.6;
      network.material.opacity = 0.24 + pulse * 0.55;

      const pRate = (0.4 + speedMul * 0.6) * (1 + pulse * 2.2);
      for (let i = 0; i < PKT; i++) {
        const p = packets[i];
        p.t += p.speed * pRate * dt;
        if (p.t > 1) p.t -= 1;
        const s = sampleArc(arcData[p.arc], p.t);
        pktPos[i * 3] = s[0]; pktPos[i * 3 + 1] = s[1]; pktPos[i * 3 + 2] = s[2];
      }
      pktGeo.attributes.position.needsUpdate = true;

      rings.forEach((r, i) => { r.rotation.z += dt * (0.05 - i * 0.025) * (i % 2 ? -1 : 1); });

      renderer.render(scene, camera);
    }
    function loop() { frame(); raf = requestAnimationFrame(loop); }
    function startLoop() { if (running) return; running = true; raf = requestAnimationFrame(loop); }
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
      state() { return { mode: 'webgl', running: running }; }
    };

    /* core activation: a slow heartbeat while visible, and a stronger surge
       when the visitor touches or hovers the core */
    if (!reduce) {
      const heartbeat = setInterval(() => { if (running) core.globe.pulse(); }, 12000);
      core.addEventListener('pointerenter', () => { if (running) core.globe.pulse(); });
      core.addEventListener('pointerdown', () => core.globe.pulse());
      window.addEventListener('pagehide', () => clearInterval(heartbeat), { once: true });
    }
    return true;
  }

  /* ====================================================================== *
   * PROCEDURAL TEXTURES
   * ====================================================================== */
  function makeNoise3D(seed) {
    function hash(i, j, k) {
      let n = (i * 374761393 + j * 668265263 + k * 1274126177 + seed) | 0;
      n = (n ^ (n >>> 13)) | 0;
      n = (n * 1274126177) | 0;
      n = (n ^ (n >>> 16)) | 0;
      return (n >>> 0) / 4294967295;
    }
    const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
    function noise(x, y, z) {
      const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
      const xf = x - xi, yf = y - yi, zf = z - zi;
      const u = fade(xf), v = fade(yf), w = fade(zf);
      const c000 = hash(xi, yi, zi), c100 = hash(xi + 1, yi, zi), c010 = hash(xi, yi + 1, zi), c110 = hash(xi + 1, yi + 1, zi);
      const c001 = hash(xi, yi, zi + 1), c101 = hash(xi + 1, yi, zi + 1), c011 = hash(xi, yi + 1, zi + 1), c111 = hash(xi + 1, yi + 1, zi + 1);
      const x00 = c000 + (c100 - c000) * u, x10 = c010 + (c110 - c010) * u;
      const x01 = c001 + (c101 - c001) * u, x11 = c011 + (c111 - c011) * u;
      const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
      return y0 + (y1 - y0) * w;
    }
    function fbm(x, y, z, oct) {
      let a = 0.5, f = 1, s = 0, norm = 0;
      for (let i = 0; i < oct; i++) { s += a * noise(x * f, y * f, z * f); norm += a; a *= 0.5; f *= 2.0; }
      return s / norm;
    }
    return { noise, fbm };
  }

  function makeEarthTextures(THREE) {
    const W = 512, H = 256;
    const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
    const colCv = cv(W, H), clouCv = cv(W, H), rouCv = cv(W, H), bumpCv = cv(W, H), enCv = cv(W, H);
    const col = colCv.getContext('2d'), clou = clouCv.getContext('2d');
    const rou = rouCv.getContext('2d'), bum = bumpCv.getContext('2d'), en = enCv.getContext('2d');
    const colI = col.createImageData(W, H), clouI = clou.createImageData(W, H);
    const rouI = rou.createImageData(W, H), bumpI = bum.createImageData(W, H), enI = en.createImageData(W, H);
    const cont = makeNoise3D(20240607);
    const detail = makeNoise3D(31415);
    const cloudN = makeNoise3D(2718);
    const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const lerp = (a, b, t) => a + (b - a) * t;
    const c255 = (v) => v < 0 ? 0 : v > 255 ? 255 : v;
    const THRESH = 0.5275; // land / ocean boundary in the base field

    for (let y = 0; y < H; y++) {
      const lat = (y / (H - 1) - 0.5) * Math.PI;
      const clat = Math.cos(lat), slat = Math.sin(lat);
      const absLat = Math.abs(lat);
      const frost = smooth(0.80, 0.97, Math.abs(slat));
      for (let x = 0; x < W; x++) {
        const lon = (x / W) * Math.PI * 2;
        const dx = clat * Math.cos(lon), dy = slat, dz = clat * Math.sin(lon);

        const warp = detail.fbm(dx * 0.9 + 3.1, dy * 0.9, dz * 0.9, 2) - 0.5;
        const base = cont.fbm(dx * 1.5 + warp * 1.1 + 7.2, dy * 1.5 + warp * 0.6 + 2.1, dz * 1.5 + warp * 1.1, 3);
        const land = smooth(0.50, 0.555, base);
        const ridge = detail.fbm(dx * 4.3 + 1.4, dy * 4.3, dz * 4.3, 3);
        const elev = land * (0.3 + 0.7 * ridge);
        const mountains = smooth(0.62, 0.86, elev);
        const coast = Math.exp(-Math.pow((base - THRESH) / 0.02, 2));
        const energyMask = smooth(0.46, 0.78, detail.fbm(dx * 1.1 + 21.0, dy * 1.1 + 4.0, dz * 1.1, 2));

        // Oceans: near-black steel depths, slightly lighter shelf
        const deep = smooth(0.30, 0.50, base);
        let r = lerp(6, 15, deep), g = lerp(8, 19, deep), b = lerp(13, 30, deep);
        const shelf = smooth(0.485, 0.55, base) * (1 - land);
        r = lerp(r, 34, shelf * 0.6); g = lerp(g, 42, shelf * 0.6); b = lerp(b, 58, shelf * 0.6);

        // Continents: silver -> white, brighter on high ground (metallic relief)
        let lr = lerp(120, 196, ridge), lg = lerp(128, 203, ridge), lb = lerp(140, 214, ridge);
        lr = lerp(lr, 236, mountains); lg = lerp(lg, 240, mountains); lb = lerp(lb, 246, mountains);
        const boreal = smooth(0.62, 0.95, absLat / (Math.PI / 2));
        lr = lerp(lr, 150, boreal * 0.35); lg = lerp(lg, 158, boreal * 0.35); lb = lerp(lb, 170, boreal * 0.35);
        r = lerp(r, lr, land); g = lerp(g, lg, land); b = lerp(b, lb, land);

        // White illuminated continental edges
        const edgeGlow = coast * (0.55 + 0.45 * land);
        r = lerp(r, 244, edgeGlow); g = lerp(g, 248, edgeGlow); b = lerp(b, 255, edgeGlow);

        // Crimson AI energy flowing across selected regions
        const energy = Math.max(mountains * 0.8, edgeGlow * 0.5) * (0.35 + 0.65 * energyMask);
        r = lerp(r, 255, energy * 0.55); g = lerp(g, 34, energy * 0.55); b = lerp(b, 74, energy * 0.55);

        // Polar ice caps (clean white)
        r = lerp(r, 244, frost); g = lerp(g, 248, frost); b = lerp(b, 254, frost);

        const i4 = (y * W + x) * 4;
        colI.data[i4] = c255(r); colI.data[i4 + 1] = c255(g); colI.data[i4 + 2] = c255(b); colI.data[i4 + 3] = 255;

        // Crimson emissive energy map (red channel drives the AI glow)
        enI.data[i4] = c255(energy * 255); enI.data[i4 + 1] = c255(energy * 34); enI.data[i4 + 2] = c255(energy * 64); enI.data[i4 + 3] = 255;

        // Thin silver clouds, latitude-banded
        const band = 0.62 + 0.30 * Math.cos(lat * 6.0) * Math.cos(lat * 2.0);
        const cov = smooth(0.50, 0.76, cloudN.fbm(dx * 2.9 + 5.0, dy * 2.9, dz * 2.9, 3) + (band - 0.62) * 0.4);
        clouI.data[i4] = 236; clouI.data[i4 + 1] = 241; clouI.data[i4 + 2] = 250; clouI.data[i4 + 3] = (cov * 200) | 0;

        // Roughness: oceans glossier (sheen), land matte
        const rv = Math.round(lerp(lerp(46, 224, land), 150, frost));
        rouI.data[i4] = rv; rouI.data[i4 + 1] = rv; rouI.data[i4 + 2] = rv; rouI.data[i4 + 3] = 255;

        const bv = Math.round(Math.min(255, 18 + elev * 210 + mountains * 30));
        bumpI.data[i4] = bv; bumpI.data[i4 + 1] = bv; bumpI.data[i4 + 2] = bv; bumpI.data[i4 + 3] = 255;
      }
    }
    col.putImageData(colI, 0, 0);
    clou.putImageData(clouI, 0, 0);
    rou.putImageData(rouI, 0, 0);
    bum.putImageData(bumpI, 0, 0);
    en.putImageData(enI, 0, 0);

    const wrapTex = (c, srgb) => {
      const t = new THREE.CanvasTexture(c);
      t.wrapS = THREE.RepeatWrapping;
      t.anisotropy = 4;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    return {
      color: wrapTex(colCv, true),
      cloud: wrapTex(clouCv, true),
      energy: wrapTex(enCv, true),
      rough: wrapTex(rouCv, false),
      bump: wrapTex(bumpCv, false)
    };
  }

  /* ====================================================================== *
   * CANVAS-2D FALLBACK (white + crimson, same identity as the WebGL globe)
   * ====================================================================== */
  function init2D() {
    const ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return;
    const wrap = canvas.parentElement;
    let W = 0, H = 0, cx = 0, cy = 0, R = 0, dpr = 1;

    const N = 420;
    const pX = new Float32Array(N), pY = new Float32Array(N), pZ = new Float32Array(N);
    const pT = new Float32Array(N), pL = new Uint8Array(N);
    const seeds = [
      [.42, .62, .35], [-.55, .25, .55], [.1, -.72, .4], [.7, -.15, .5],
      [-.3, -.5, .62], [.2, .4, -.78], [-.8, .1, .35], [.55, .75, -.1],
      [-.2, .85, .3], [.85, .2, -.3], [-.6, -.4, -.4], [.05, .15, .92]
    ];
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2;
      const rr = Math.sqrt(Math.max(0, 1 - y * y));
      const th = i * Math.PI * (3 - Math.sqrt(5));
      const x = Math.cos(th) * rr, z = Math.sin(th) * rr;
      pX[i] = x; pY[i] = y; pZ[i] = z; pT[i] = Math.random() * Math.PI * 2;
      for (let s = 0; s < seeds.length; s++) {
        const sd = seeds[s];
        if (x * sd[0] + y * sd[1] + z * sd[2] > 0.90) { pL[i] = 1; break; }
      }
    }

    const RN = 72;
    const rX = new Float32Array(RN), rZ = new Float32Array(RN);
    for (let i = 0; i < RN; i++) { const a = (i / RN) * Math.PI * 2; rX[i] = Math.cos(a); rZ[i] = Math.sin(a); }
    const orbits = [
      { ax: 0.46, ay: 0, az: 0.05, spd: 0.055, col: 'rgba(219,230,248,', trail: 'rgba(255,255,255,' },
      { ax: 1.15, ay: 0.4, az: 0.35, spd: -0.04, col: 'rgba(245,34,69,', trail: 'rgba(255,150,160,' }
    ];

    const DN = 44;
    const dA = new Float32Array(DN), dR = new Float32Array(DN), dS = new Float32Array(DN), dH = new Float32Array(DN);
    for (let i = 0; i < DN; i++) {
      dA[i] = Math.random() * Math.PI * 2; dR[i] = 1.22 + Math.random() * 0.42;
      dS[i] = 0.06 + Math.random() * 0.16; dH[i] = (Math.random() - 0.5) * 0.5;
    }

    let mx = 0, my = 0, tmx = 0, tmy = 0;
    let running = false, raf = 0, speedMul = 1, pulse = 0;
    const start = performance.now();
    const fov = 2.4;
    const S = { x: 0, y: 0, z: 0 };

    function rot(px, py, pz, ax, ay) {
      const cyw = Math.cos(ay), syw = Math.sin(ay);
      let x = px * cyw - pz * syw, z = px * syw + pz * cyw;
      const cxw = Math.cos(ax), sxw = Math.sin(ax);
      const y = py * cxw - z * sxw; z = py * sxw + z * cxw;
      S.x = x; S.y = y; S.z = z;
    }
    const oX = new Float32Array(RN), oY = new Float32Array(RN), oZ = new Float32Array(RN);
    function orbitPoints(ax, ay, az) {
      const ca = Math.cos(ax), sa = Math.sin(ax);
      const cw = Math.cos(ay), sw = Math.sin(ay);
      const cz = Math.cos(az), sz = Math.sin(az);
      for (let i = 0; i < RN; i++) {
        let x = rX[i], y = 0, z = rZ[i];
        const x1 = x * cz - y * sz, y1 = x * sz + y * cz;
        const y2 = y1 * ca - z * sa, z2 = y1 * sa + z * ca;
        oX[i] = x1 * cw - z2 * sw; oY[i] = y2; oZ[i] = x1 * sw + z2 * cw;
      }
    }
    function ringPath(front) {
      ctx.beginPath();
      let pen = false;
      for (let i = 0; i < RN; i++) {
        const j = (i + 1) % RN;
        if (((oZ[i] + oZ[j]) * 0.5 >= 0) !== front) { pen = false; continue; }
        const s1 = fov / (fov + oZ[i]), s2 = fov / (fov + oZ[j]);
        const X1 = cx + oX[i] * R * s1, Y1 = cy + oY[i] * R * s1;
        if (!pen) { ctx.moveTo(X1, Y1); pen = true; }
        ctx.lineTo(cx + oX[j] * R * s2, cy + oY[j] * R * s2);
      }
    }
    function resize() {
      const rect = wrap.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = Math.max(1, rect.width); H = Math.max(1, rect.height);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx = W / 2; cy = H / 2; R = Math.min(W, H) * 0.365;
    }

    function draw(now) {
      const t = (now - start) * 0.001;
      speedMul += (1 - speedMul) * 0.03;
      pulse *= 0.94;
      mx += (tmx - mx) * 0.055; my += (tmy - my) * 0.055;
      const spinY = t * 0.30 * speedMul + mx * 0.85;
      const tiltX = 0.34 + Math.sin(t * 0.18) * 0.10 + my * 0.55;
      ctx.clearRect(0, 0, W, H);

      ctx.globalCompositeOperation = 'lighter';
      let g = ctx.createRadialGradient(cx - R * 0.5, cy - R * 0.18, R * 0.08, cx - R * 0.5, cy - R * 0.18, R * 1.2);
      g.addColorStop(0, 'rgba(219,230,248,0.20)'); g.addColorStop(1, 'rgba(219,230,248,0)');
      ctx.fillStyle = g; ctx.fillRect(cx - R * 1.8, cy - R * 1.6, R * 3.6, R * 3.2);
      g = ctx.createRadialGradient(cx + R * 0.5, cy + R * 0.22, R * 0.08, cx + R * 0.5, cy + R * 0.22, R * 1.2);
      g.addColorStop(0, 'rgba(245,34,69,0.24)'); g.addColorStop(1, 'rgba(245,34,69,0)');
      ctx.fillStyle = g; ctx.fillRect(cx - R * 1.8, cy - R * 1.6, R * 3.6, R * 3.2);

      for (let i = 0; i < N; i++) {
        rot(pX[i], pY[i], pZ[i], tiltX, spinY);
        if (S.z >= 0) continue;
        const s = fov / (fov + S.z);
        const X = cx + S.x * R * s, Y = cy + S.y * R * s;
        const mix = Math.min(1, Math.max(0, (S.x + 1) / 2));
        const r = Math.round(206 + 49 * mix), gg = Math.round(220 - 186 * mix), b = Math.round(246 - 170 * mix);
        const twk = 0.8 + 0.2 * Math.sin(t * 1.6 + pT[i]);
        ctx.globalAlpha = 0.22 * twk * (pL[i] ? 1.35 : 1);
        ctx.fillStyle = pL[i] ? `rgb(${Math.min(255, r + 26)},${gg},${b})` : `rgb(${r},${gg},${b})`;
        ctx.beginPath(); ctx.arc(X, Y, 0.9 + (pL[i] ? 0.3 : 0), 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;

      orbits.forEach((o) => {
        orbitPoints(o.ax, o.ay + spinY * o.spd * 6, o.az);
        ringPath(false);
        ctx.strokeStyle = o.col + '0.15)'; ctx.lineWidth = 1; ctx.stroke();
      });

      ctx.globalCompositeOperation = 'source-over';
      g = ctx.createRadialGradient(cx - R * 0.32, cy - R * 0.36, R * 0.06, cx, cy, R * 1.02);
      g.addColorStop(0, '#1c2434'); g.addColorStop(0.5, '#0f131b'); g.addColorStop(1, '#05060a');
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = g; ctx.fill();
      const rim = ctx.createLinearGradient(cx - R, cy, cx + R, cy);
      rim.addColorStop(0, 'rgba(219,230,248,0.92)'); rim.addColorStop(0.42, 'rgba(219,230,248,0.14)');
      rim.addColorStop(0.58, 'rgba(245,34,69,0.14)'); rim.addColorStop(1, 'rgba(245,34,69,0.92)');
      ctx.strokeStyle = rim; ctx.lineWidth = 2.2; ctx.stroke();
      ctx.strokeStyle = 'rgba(226,236,250,0.12)'; ctx.lineWidth = 7; ctx.stroke();
      ctx.save(); ctx.clip();
      g = ctx.createRadialGradient(cx + R * 0.55, cy + R * 0.55, R * 0.15, cx + R * 0.3, cy + R * 0.25, R * 1.25);
      g.addColorStop(0, 'rgba(0,0,0,0.62)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
      g = ctx.createRadialGradient(cx - R * 0.34, cy - R * 0.42, 0, cx - R * 0.34, cy - R * 0.42, R * 0.55);
      g.addColorStop(0, 'rgba(226,236,250,0.18)'); g.addColorStop(1, 'rgba(226,236,250,0)');
      ctx.fillStyle = g; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
      ctx.restore();

      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < N; i++) {
        rot(pX[i], pY[i], pZ[i], tiltX, spinY);
        if (S.z < 0) continue;
        const s = fov / (fov + S.z);
        const X = cx + S.x * R * s, Y = cy + S.y * R * s;
        const near = Math.min(1, Math.max(0, (s - fov / (fov + 1)) / (fov / (fov - 1) - fov / (fov + 1))));
        const mix = Math.min(1, Math.max(0, (S.x + 1) / 2));
        let r = Math.round(206 + 49 * mix), gg = Math.round(220 - 186 * mix), b = Math.round(246 - 170 * mix);
        if (pL[i]) { r = Math.min(255, r + 34); gg = Math.round(gg * 0.82); }
        const twk = 0.78 + 0.22 * Math.sin(t * 2.1 + pT[i]);
        const alpha = (0.16 + near * 0.7) * twk * (pL[i] ? 1.3 : 1);
        const rad = 0.7 + near * 1.5 + (pL[i] ? 0.45 : 0);
        ctx.beginPath(); ctx.arc(X, Y, rad * 2.8, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${gg},${b},${alpha * 0.1})`; ctx.fill();
        ctx.beginPath(); ctx.arc(X, Y, rad, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${gg},${b},${alpha})`; ctx.fill();
      }

      orbits.forEach((o, oi) => {
        orbitPoints(o.ax, o.ay + spinY * o.spd * 6, o.az);
        ringPath(true);
        ctx.strokeStyle = o.col + '0.32)'; ctx.lineWidth = 1.2; ctx.stroke();
        const dir = o.spd > 0 ? 1 : -1;
        const head = Math.floor((((t * (22 + oi * 8) * dir) % RN) + RN) % RN);
        for (let k = 0; k < 11; k++) {
          const i = (head - k + RN) % RN, j = (i + 1) % RN;
          if ((oZ[i] + oZ[j]) * 0.5 < 0) continue;
          const s1 = fov / (fov + oZ[i]), s2 = fov / (fov + oZ[j]);
          ctx.strokeStyle = o.trail + (0.5 * (1 - k / 11)).toFixed(3) + ')';
          ctx.lineWidth = 1.9 - k * 0.1;
          ctx.beginPath();
          ctx.moveTo(cx + oX[i] * R * s1, cy + oY[i] * R * s1);
          ctx.lineTo(cx + oX[j] * R * s2, cy + oY[j] * R * s2);
          ctx.stroke();
        }
      });

      for (let i = 0; i < DN; i++) {
        const a = dA[i] + t * dS[i];
        const X = cx + Math.cos(a) * R * dR[i];
        const Y = cy + Math.sin(a) * R * dR[i] * (0.6 + dH[i] * 0.3);
        ctx.globalAlpha = 0.10 + 0.16 * (0.5 + 0.5 * Math.sin(t * 1.4 + i));
        ctx.fillStyle = i % 2 ? 'rgba(226,236,250,1)' : 'rgba(255,120,130,1)';
        ctx.beginPath(); ctx.arc(X, Y, 0.9, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    function loop(now) { draw(now); raf = requestAnimationFrame(loop); }
    function startLoop() { if (running) return; running = true; raf = requestAnimationFrame(loop); }
    function stopLoop() { running = false; cancelAnimationFrame(raf); }

    resize();
    window.addEventListener('resize', resize);
    if (window.ResizeObserver) new ResizeObserver(resize).observe(wrap);
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
      setSpeed() {},
      state() { return { mode: 'canvas2d', running: running }; }
    };
    if (!reduce) {
      const heartbeat = setInterval(() => { if (running) core.globe.pulse(); }, 12000);
      core.addEventListener('pointerenter', () => { if (running) core.globe.pulse(); });
      core.addEventListener('pointerdown', () => core.globe.pulse());
      window.addEventListener('pagehide', () => clearInterval(heartbeat), { once: true });
    }
  }

  whenBooted(start);
})();
