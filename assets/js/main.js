/* ==========================================================================
   AH SOLUTION — main.js
   Zero-dependency vanilla JS. Everything degrades gracefully.
   ========================================================================== */
(() => {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  /* ------------------------------------------------------------------ *
   * 1. Mobile navigation
   * ------------------------------------------------------------------ */
  const toggle = $('.menu-toggle');
  const links  = $('.nav-links');
  if (toggle && links) {
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      links.classList.toggle('open', !open);
    });
    $$('a', links).forEach(a => a.addEventListener('click', () => {
      links.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }));
  }

  /* ------------------------------------------------------------------ *
   * 2. Current year
   * ------------------------------------------------------------------ */
  $$('[data-year]').forEach(el => { el.textContent = new Date().getFullYear(); });

  /* ------------------------------------------------------------------ *
   * 3. Sticky header state
   * ------------------------------------------------------------------ */
  const header = $('.site-header');
  if (header) {
    const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ------------------------------------------------------------------ *
   * 4. Scroll-reveal
   * ------------------------------------------------------------------ */
  const revealEls = $$('.reveal');
  if (revealEls.length) {
    if ('IntersectionObserver' in window && !reduceMotion) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach(en => {
          if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
      revealEls.forEach(el => io.observe(el));
    } else {
      revealEls.forEach(el => el.classList.add('in'));
    }
  }

  /* ------------------------------------------------------------------ *
   * 5. 3D tilt on cards
   * ------------------------------------------------------------------ */
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (fine && !reduceMotion) {
    $$('[data-tilt]').forEach(el => {
      const max = Number(el.dataset.tilt) || 7;
      let frame = null;
      const apply = (rx, ry) => {
        el.style.transform =
          `perspective(1000px) rotateX(${rx}deg) rotateY(${ry}deg) translateY(-4px)`;
      };
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width;
        const py = (e.clientY - r.top) / r.height;
        el.style.setProperty('--gx', (px * 100).toFixed(1) + '%');
        el.style.setProperty('--gy', (py * 100).toFixed(1) + '%');
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = null;
          apply((0.5 - py) * max, (px - 0.5) * max);
        });
      });
      el.addEventListener('pointerleave', () => {
        el.style.transform = '';
      });
    });
  }

  /* ------------------------------------------------------------------ *
   * 6. Hero parallax
   * ------------------------------------------------------------------ */
  const hero = $('.hero');
  if (hero && fine && !reduceMotion) {
    const core = $('[data-hero-core]');
    let idle;
    hero.addEventListener('pointermove', (e) => {
      const r = hero.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width;
      const ny = (e.clientY - r.top) / r.height;
      hero.style.setProperty('--mx', (nx * 100).toFixed(1) + '%');
      hero.style.setProperty('--my', (ny * 100).toFixed(1) + '%');
      hero.style.setProperty('--px', (nx - 0.5).toFixed(3));
      hero.style.setProperty('--py', (ny - 0.5).toFixed(3));
      if (core && core.pointer) core.pointer(nx - 0.5, ny - 0.5);
    });
    hero.addEventListener('pointerleave', () => {
      hero.style.setProperty('--px', '0');
      hero.style.setProperty('--py', '0');
      hero.style.setProperty('--mx', '78%');
      hero.style.setProperty('--my', '20%');
      if (core && core.pointer) core.pointer(0, 0);
    });
  }

  /* ------------------------------------------------------------------ *
   * 7. Hero 3D particle core (canvas 2D — no external 3D library)
   * ------------------------------------------------------------------ */
  (function heroCore() {
    const canvas = $('[data-hero-core] canvas');
    if (!canvas) return;
    const ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return; // graceful fallback: CSS orb stays

    const wrap = canvas.parentElement;
    let W = 0, H = 0, cx = 0, cy = 0, R = 0, dpr = 1;

    const N = 520;
    const points = [];
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2;
      const rr = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = i * Math.PI * (3 - Math.sqrt(5));
      points.push({ x: Math.cos(theta) * rr, y, z: Math.sin(theta) * rr, tw: Math.random() * Math.PI * 2 });
    }

    // three tilted orbit rings
    const rings = [
      { ax: 0.4, ay: 0.0, az: 0.0, spd: 0.9 },
      { ax: 1.2, ay: 0.5, az: 0.3, spd: -0.7 },
      { ax: -0.6, ay: 0.9, az: 1.1, spd: 0.5 }
    ].map(r => {
      const pts = [];
      for (let i = 0; i <= 72; i++) {
        const a = (i / 72) * Math.PI * 2;
        pts.push({ x: Math.cos(a), y: 0, z: Math.sin(a) });
      }
      return { ...r, pts, phase: Math.random() * Math.PI * 2 };
    });

    let mx = 0, my = 0, tmx = 0, tmy = 0;
    let running = false, raf = 0, start = performance.now();
    const fov = 2.35;

    function rot(p, ax, ay, az) {
      let { x, y, z } = p;
      if (az) { const c = Math.cos(az), s = Math.sin(az); const nx = x * c - y * s; y = x * s + y * c; x = nx; }
      const cyy = Math.cos(ay), syy = Math.sin(ay);
      let nx = x * cyy - z * syy; z = x * syy + z * cyy; x = nx;
      const cxx = Math.cos(ax), sxx = Math.sin(ax);
      const ny = y * cxx - z * sxx; z = y * sxx + z * cxx; y = ny;
      return { x, y, z };
    }

    function project(p, ax, ay) {
      const q = rot(p, ax, ay, 0);
      const s = fov / (fov + q.z);
      return { sx: cx + q.x * R * s, sy: cy + q.y * R * s, s, z: q.z };
    }

    function resize() {
      const rect = wrap.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = Math.max(1, rect.width);
      H = Math.max(1, rect.height);
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx = W / 2; cy = H / 2;
      R = Math.min(W, H) * 0.37;
    }

    function draw(now) {
      const t = (now - start) * 0.001;
      mx += (tmx - mx) * 0.06;
      my += (tmy - my) * 0.06;
      const ay = t * 0.35 + mx * 0.9;
      const ax = Math.sin(t * 0.22) * 0.22 + my * 0.7;

      ctx.clearRect(0, 0, W, H);

      // core glow
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.95);
      g.addColorStop(0, 'rgba(229,9,20,0.30)');
      g.addColorStop(0.35, 'rgba(139,0,0,0.16)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.95, 0, Math.PI * 2);
      ctx.fill();

      // orbit rings
      ctx.lineWidth = 1;
      rings.forEach(rg => {
        const rr = rot(rot(rg.pts[0], rg.ax, ay + rg.phase, rg.az), ax, 0, 0);
        ctx.beginPath();
        for (let i = 0; i < rg.pts.length; i++) {
          const q = rot(rg.pts[i], rg.ax, ay + rg.phase, rg.az);
          const w = rot(q, ax, 0, 0);
          const s = fov / (fov + w.z);
          const X = cx + w.x * R * s;
          const Y = cy + w.y * R * s;
          if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
        }
        ctx.strokeStyle = 'rgba(229,9,20,0.18)';
        ctx.stroke();
        // travelling spark
        const idx = Math.floor(((t * rg.spd + rg.phase) % (Math.PI * 2)) / (Math.PI * 2) * 72 + 72) % 72;
        const q = rot(rg.pts[idx], rg.ax, ay + rg.phase, rg.az);
        const w = rot(q, ax, 0, 0);
        const s = fov / (fov + w.z);
        const X = cx + w.x * R * s;
        const Y = cy + w.y * R * s;
        ctx.beginPath();
        ctx.arc(X, Y, 2.2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,120,130,0.95)';
        ctx.shadowColor = 'rgba(229,9,20,0.9)';
        ctx.shadowBlur = 12;
        ctx.fill();
        ctx.shadowBlur = 0;
      });

      // particle sphere (additive)
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < N; i++) {
        const p = points[i];
        const q = rot(p, ax, ay, 0);
        const s = fov / (fov + q.z);
        const X = cx + q.x * R * s;
        const Y = cy + q.y * R * s;
        const near = Math.min(1, Math.max(0, (s - fov / (fov + 1)) / (fov / (fov - 1) - fov / (fov + 1))));
        const tw = 0.75 + 0.25 * Math.sin(t * 2 + p.tw);
        const alpha = (0.10 + near * 0.75) * tw;
        const rad = 0.6 + near * 1.7;
        const cr = Math.round(150 + near * 105);
        const cg = Math.round(20 + near * 170);
        const cb = Math.round(30 + near * 150);
        // soft halo
        ctx.beginPath();
        ctx.arc(X, Y, rad * 3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha * 0.12})`;
        ctx.fill();
        // bright dot
        ctx.beginPath();
        ctx.arc(X, Y, rad, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha})`;
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    function loop(now) {
      draw(now);
      raf = requestAnimationFrame(loop);
    }
    function startLoop() { if (running) return; running = true; raf = requestAnimationFrame(loop); }
    function stopLoop() { running = false; cancelAnimationFrame(raf); }

    resize();
    window.addEventListener('resize', resize);
    if (window.ResizeObserver) new ResizeObserver(resize).observe(wrap);

    if (reduceMotion) {
      draw(performance.now());          // one static frame
    } else {
      startLoop();
      document.addEventListener('visibilitychange', () => document.hidden ? stopLoop() : startLoop());
      if ('IntersectionObserver' in window) {
        new IntersectionObserver((en) => en[0].isIntersecting ? startLoop() : stopLoop(), { threshold: 0.02 })
          .observe(wrap);
      }
    }

    // expose pointer influence for hero parallax
    wrap.pointer = (nx, ny) => { tmx = nx; tmy = ny; };
  })();

  /* ------------------------------------------------------------------ *
   * 8. Video facades (lazy YouTube — click to load the real embed)
   * ------------------------------------------------------------------ */
  $$('[data-video-id]').forEach(btn => {
    const play = () => {
      const id = btn.dataset.videoId;
      const title = btn.dataset.videoTitle || 'YouTube video';
      const frame = document.createElement('iframe');
      frame.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
      frame.title = title;
      frame.loading = 'lazy';
      frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      frame.allowFullscreen = true;
      btn.replaceWith(frame);
    };
    btn.addEventListener('click', play);
    btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play(); } });
  });

  /* ------------------------------------------------------------------ *
   * 9. Blog filtering + search (blog listings)
   * ------------------------------------------------------------------ */
  const blogSearch = $('[data-blog-search]');
  const cards = $$('[data-blog-card]');
  const chips = $$('[data-filter]');
  if (cards.length) {
    let activeFilter = 'all';
    const run = () => {
      const query = (blogSearch?.value || '').trim().toLowerCase();
      let shown = 0;
      cards.forEach(card => {
        const text = (card.dataset.search || card.textContent).toLowerCase();
        const cat = (card.dataset.category || '').toLowerCase();
        const show = (!query || text.includes(query)) && (activeFilter === 'all' || cat === activeFilter);
        card.classList.toggle('hidden', !show);
        if (show) shown++;
      });
      $('[data-empty-state]')?.classList.toggle('hidden', shown !== 0);
    };
    blogSearch?.addEventListener('input', run);
    chips.forEach(chip => chip.addEventListener('click', () => {
      activeFilter = chip.dataset.filter || 'all';
      chips.forEach(c => c.classList.toggle('active', c === chip));
      run();
    }));
    // pre-filter from ?q= or ?category=
    const params = new URLSearchParams(location.search);
    if (blogSearch && params.get('q')) blogSearch.value = params.get('q');
    const cat = params.get('category');
    if (cat) {
      const chip = chips.find(c => c.dataset.filter === cat);
      if (chip) chip.click();
    } else if (blogSearch?.value) {
      run();
    }
  }

  /* ------------------------------------------------------------------ *
   * 10. Reading progress (article pages)
   * ------------------------------------------------------------------ */
  const progress = $('.reading-progress');
  const article = $('[data-article-content]');
  if (progress && article) {
    const update = () => {
      const rect = article.getBoundingClientRect();
      const total = article.offsetHeight - window.innerHeight;
      const done = Math.min(1, Math.max(0, -rect.top / Math.max(1, total)));
      progress.style.width = (done * 100) + '%';
    };
    window.addEventListener('scroll', update, { passive: true });
    update();
  }

  /* ------------------------------------------------------------------ *
   * 11. Site search modal
   * ------------------------------------------------------------------ */
  (function searchModal() {
    const modal = $('[data-search-modal]');
    if (!modal) return;
    const input   = $('input', modal);
    const results = $('[data-search-results]', modal);

    const INDEX = [
      { t: 'Home', d: 'AH Solution — Technology made simple', u: 'index.html', k: 'home start technology made simple' },
      { t: 'Videos', d: 'Watch practical tech tutorials and first looks', u: 'vlogs.html', k: 'videos youtube watch tutorials' },
      { t: 'Blog', d: 'Written guides, checklists and explainers', u: 'blog.html', k: 'blog articles guides read' },
      { t: 'Tutorials', d: 'Interactive tutorial explorer', u: 'tutorials.html', k: 'tutorials how to explore' },
      { t: 'About', d: 'The AH Solution mission', u: 'about.html', k: 'about mission brand' },
      { t: 'Contact', d: 'Reach AH Solution by email or socials', u: 'contact.html', k: 'contact email collaboration' },
      { t: 'Live wallpaper on PC', d: 'Set a video as your Windows wallpaper', u: 'guides/live-wallpaper-on-pc.html', k: 'pc windows wallpaper video mlwapp customization' },
      { t: 'Choose Android apps safely', d: 'Safety checklist before installing an app', u: 'guides/choose-android-apps-safely.html', k: 'android app safety permissions install privacy' },
      { t: 'Budget smartwatch checklist', d: 'What to check before buying', u: 'guides/budget-smartwatch-checklist.html', k: 'smartwatch buying guide wearable battery' },
      { t: 'Privacy notice', d: 'How this website handles information', u: 'privacy.html', k: 'privacy policy' },
      { t: 'Terms & conditions', d: 'Terms of use for this website', u: 'terms.html', k: 'terms legal conditions' }
    ];
    const base = location.pathname.includes('/guides/') ? '../' : '';

    const render = (items) => {
      if (!items.length) {
        results.innerHTML = '<div class="search-empty">No matches. Try “android”, “pc”, “wallpaper” or “smartwatch”.</div>';
        return;
      }
      results.innerHTML = items.map(i =>
        `<a class="search-result" href="${base}${i.u}"><strong>${i.t}</strong><span>${i.d}</span></a>`
      ).join('');
    };

    const query = (q) => {
      q = q.trim().toLowerCase();
      if (!q) return INDEX.slice(0, 6);
      return INDEX.filter(i => (i.t + ' ' + i.d + ' ' + i.k).toLowerCase().includes(q)).slice(0, 8);
    };

    const open = () => {
      modal.classList.add('open');
      document.body.style.overflow = 'hidden';
      render(INDEX.slice(0, 6));
      setTimeout(() => input.focus(), 30);
    };
    const close = () => { modal.classList.remove('open'); document.body.style.overflow = ''; };

    $$('[data-search-open]').forEach(b => b.addEventListener('click', open));
    $$('[data-search-close]', modal).forEach(b => b.addEventListener('click', close));
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); open(); }
      if (e.key === '/' && !/input|textarea/i.test(document.activeElement.tagName)) { e.preventDefault(); open(); }
    });
    input.addEventListener('input', () => render(query(input.value)));
  })();

  /* ------------------------------------------------------------------ *
   * 12. Newsletter (honest, no-backend handling)
   * ------------------------------------------------------------------ */
  $$('[data-newsletter]').forEach(form => {
    const status = $('[data-newsletter-status]', form);
    form.addEventListener('submit', (e) => {
      const email = $('input[type=email]', form)?.value.trim() || '';
      const endpoint = (form.dataset.endpoint || '').trim();
      if (endpoint) return; // real provider configured — let it submit
      e.preventDefault();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        if (status) status.textContent = 'Please enter a valid email address.';
        return;
      }
      const subject = encodeURIComponent('Newsletter subscription — AH Solution');
      const body = encodeURIComponent(`Please add this address to the AH Solution updates list:\n\n${email}`);
      window.location.href = `mailto:official.ahsolution@gmail.com?subject=${subject}&body=${body}`;
      if (status) status.textContent = 'Opening your email app to confirm…';
      form.reset();
    });
  });

  /* ------------------------------------------------------------------ *
   * 13. Share / copy link
   * ------------------------------------------------------------------ */
  $$('[data-copy-link]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(location.href);
        const prev = btn.textContent;
        btn.textContent = 'Link copied ✓';
        setTimeout(() => { btn.textContent = prev; }, 1800);
      } catch {
        btn.textContent = location.href;
      }
    });
  });
})();
