/* ============================================================
   AH SOLUTION — Device World Experience (vanilla, no deps)
   Boot sequence, full-width escape hatch, scroll-lock mirror,
   pointer parallax and the looping tutorial carousel.
   Content stays static HTML.
   ============================================================ */
(function () {
  "use strict";

  var html = document.documentElement;
  var nowFn = (window.performance && window.performance.now) ? function () { return window.performance.now(); } : function () { return Date.now(); };

  var reduce = false;
  try {
    reduce = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  } catch (e) {}

  /* 1. Startup intro -------------------------------------------------------
     Session-scoped: an inline <head> script sets the "ah-intro" sessionStorage
     flag BEFORE first paint and tags the document with either
       html.booted      → returning page in this tab (intro skipped, no flash)
       html.boot-intro  → first entry in this tab (intro plays below)
     so the ~1s intro only ever plays once per tab session. Storage failures
     fall back to showing the intro, and the page stays usable regardless.   */
  var QUOTES = [
    "Work smarter, not just harder.",
    "Big progress starts with small fixes.",
    "Curiosity first, confusion second.",
    "Learn it. Try it. Make it yours.",
    "Every click teaches you something.",
    "Solve once, reuse forever.",
    "Consistency beats intensity.",
    "Turn questions into skills.",
    "Small daily wins stack up.",
    "Understand the why, not just the how.",
    "Practical beats perfect.",
    "One good tweak at a time.",
    "Tools serve you — stay in charge.",
    "Knowledge grows when it is shared.",
    "Keep it simple, keep it sharp."
  ];

  var introMode = html.classList.contains("boot-intro") && !html.classList.contains("booted");

  var MIN_BOOT = 1000;  // ~1s intended visual intro (max), not a fake-complete claim
  var FALLBACK = 2000;  // hard reveal even if a timer is delayed; CSS auto-hides at 2.2s too

  function pickBootQuote() {
    var slot = document.querySelector("[data-boot-quote]");
    if (!slot || !QUOTES.length) return;
    var last = -1;
    try { last = parseInt(sessionStorage.getItem("ah-quote"), 10); } catch (e) {}
    var next = Math.floor(Math.random() * QUOTES.length);
    if (QUOTES.length > 1 && last === next) next = (next + 1 + Math.floor(Math.random() * (QUOTES.length - 1))) % QUOTES.length;
    slot.textContent = QUOTES[next];
    try { sessionStorage.setItem("ah-quote", String(next)); } catch (e) {}
  }

  if (introMode) {
    html.classList.add("booting");
    var logo = document.querySelector(".boot-logo");
    if (logo) {
      logo.addEventListener("error", function () {
        var inner = logo.closest(".boot-inner");
        if (inner) inner.classList.add("boot--nologo");
      });
    }
    pickBootQuote();

    var bootStart = nowFn();
    var bootDone = false;

    function revealBoot() {
      if (bootDone) return;
      bootDone = true;
      html.classList.remove("booting");
      html.classList.add("booted");
      if (reduce) {
        html.classList.add("device-settled");
      } else {
        html.classList.add("device-enter");
        window.setTimeout(function () { html.classList.add("device-settled"); }, 1500);
      }
    }

    html.addEventListener("animationend", function (e) {
      if (e.animationName === "deviceEnter") html.classList.add("device-settled");
    });

    var elapsed = nowFn() - bootStart;
    /* Reveal via rAF: setTimeout callbacks scheduled during document load can be
       deferred by the renderer until the load settles, which would stretch the
       intro well past the one-second target on slow networks. rAF is frame
       driven and fires reliably; the timeouts remain as backstops. */
    var rafTick = function () {
      if (bootDone) return;
      if (nowFn() - bootStart >= MIN_BOOT) revealBoot();
      else window.requestAnimationFrame(rafTick);
    };
    window.requestAnimationFrame(rafTick);
    window.setTimeout(revealBoot, Math.max(0, MIN_BOOT - elapsed));
    window.setTimeout(revealBoot, FALLBACK);
  } else {
    /* Returning page in this tab: no intro, no replay on refresh/Back/Forward,
       and skip the device-frame entrance animation so content appears fast. */
    html.classList.add("booted", "device-settled");
  }

  /* 2. Full-width toggle --------------------------------------------------- */
  var toggle = document.querySelector("[data-device-toggle]");
  if (toggle) {
    var label = toggle.querySelector("[data-device-toggle-label]");
    var wide = false;
    try { wide = window.localStorage.getItem("ah-wide") === "1"; } catch (e) {}

    var apply = function () {
      html.classList.toggle("device-wide", wide);
      toggle.setAttribute("aria-pressed", wide ? "true" : "false");
      if (label) label.textContent = wide ? "Device view" : "Full width";
    };
    apply();

    toggle.addEventListener("click", function () {
      wide = !wide;
      try { window.localStorage.setItem("ah-wide", wide ? "1" : "0"); } catch (e) {}
      apply();
    });
  }

  /* 3. Mirror search-modal scroll lock onto the monitor scroller ----------- */
  var modal = document.querySelector("[data-search-modal]");
  if (modal && window.MutationObserver) {
    var sync = function () { html.classList.toggle("is-locked", modal.classList.contains("open")); };
    new MutationObserver(sync).observe(modal, { attributes: true, attributeFilter: ["class"] });
    sync();
  }

  /* 4. Subtle pointer parallax on the device gloss (desktop, motion allowed) */
  if (!reduce && window.matchMedia && window.matchMedia("(min-width:768px)").matches) {
    var raf = 0, mx = 0, my = 0;
    var flush = function () { raf = 0; html.style.setProperty("--dw-mx", mx + "px"); html.style.setProperty("--dw-my", my + "px"); };
    window.addEventListener("pointermove", function (e) {
      mx = (e.clientX / window.innerWidth - 0.5) * 26;
      my = (e.clientY / window.innerHeight - 0.5) * 16;
      if (!raf) raf = window.requestAnimationFrame(flush);
    }, { passive: true });
  }

  /* 5. Continuous looping tutorial carousel -------------------------------- */
  function initCarousel(root) {
    var vp = root.querySelector("[data-carousel-viewport]");
    var track = root.querySelector("[data-carousel-track]");
    if (!vp || !track) return;

    var originals = Array.prototype.slice.call(track.children);
    var count = originals.length;
    if (!count) return;

    var gap = 16;
    try { gap = parseFloat(getComputedStyle(track).columnGap || getComputedStyle(track).gap) || 16; } catch (e) {}

    function clone(node) {
      var c = node.cloneNode(true);
      c.setAttribute("aria-hidden", "true");
      Array.prototype.forEach.call(c.querySelectorAll("a,button,input,select,textarea"), function (el) {
        el.setAttribute("tabindex", "-1");
      });
      return c;
    }

    // Two extra copies (one before, one after) enable seamless wrapping in
    // both directions. Content itself is not duplicated anywhere else.
    for (var i = 0; i < count; i++) track.appendChild(clone(originals[i]));
    for (var j = count - 1; j >= 0; j--) track.insertBefore(clone(originals[j]), track.firstChild);

    var setW = 0, measured = false;
    function measure() {
      try { gap = parseFloat(getComputedStyle(track).columnGap || getComputedStyle(track).gap) || gap; } catch (e) {}
      setW = (track.scrollWidth + gap) / 3;
      if (!measured && setW > 0) { vp.scrollLeft = setW; measured = true; }
    }
    measure();
    window.addEventListener("resize", measure, { passive: true });
    window.addEventListener("load", measure);

    function normalize() {
      if (setW <= 0) return;
      var x = vp.scrollLeft;
      var maxX = vp.scrollWidth - vp.clientWidth;
      var hi = Math.min(2 * setW, maxX - 4);
      // Only wrap near the outer edges so ordinary prev/next steps never
      // jump; one full set of clones exists on each side to hide the seam.
      if (hi > 0 && x >= hi) vp.scrollLeft = x - setW;
      else if (x <= setW * 0.5) vp.scrollLeft = x + setW;
    }
    vp.addEventListener("scroll", normalize, { passive: true });

    function step() {
      var first = track.children[0];
      var w = first ? first.getBoundingClientRect().width : 260;
      return w + gap;
    }

    var paused = false;
    var pause = function () { paused = true; };
    var resume = function () { paused = false; };
    root.addEventListener("pointerenter", pause);
    root.addEventListener("pointerleave", resume);
    root.addEventListener("focusin", pause);
    root.addEventListener("focusout", resume);
    root.addEventListener("pointerdown", pause);
    window.addEventListener("pointerup", resume);

    var manualUntil = 0;
    function nudge(amount) {
      manualUntil = Date.now() + 700;
      vp.scrollBy({ left: amount * step(), behavior: reduce ? "auto" : "smooth" });
    }
    var prev = root.querySelector("[data-carousel-prev]");
    var next = root.querySelector("[data-carousel-next]");
    if (prev) prev.addEventListener("click", function () { nudge(-1); });
    if (next) next.addEventListener("click", function () { nudge(1); });

    // Touch/trackpad scrolling is native; auto-movement pauses on interaction
    // and entirely respects reduced-motion.
    if (reduce) return;

    var visible = true;
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) { visible = entries[0].isIntersecting; }, { threshold: 0.05 }).observe(root);
    }
    var SPEED = 32; // px / second
    var last = 0;
    function tick(t) {
      var dt = last ? (t - last) / 1000 : 0;
      last = t;
      if (visible && !paused && !document.hidden && Date.now() > manualUntil && dt > 0) vp.scrollLeft += SPEED * dt;
      window.requestAnimationFrame(tick);
    }
    window.requestAnimationFrame(tick);
  }

  Array.prototype.forEach.call(document.querySelectorAll("[data-carousel]"), initCarousel);
})();
