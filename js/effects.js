/* ==========================================================================
   CINAMATE — js/effects.js
   window.CinamateFX — starfield, reveal, typewriter, ticker
   Classic script, ES2020, zero dependencies. Every entry point is
   defensive: missing element or missing browser API -> silent no-op.
   ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Shared helpers                                                      */
  /* ------------------------------------------------------------------ */

  var REDUCED_MOTION = false;
  try {
    if (typeof window.matchMedia === 'function') {
      var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      REDUCED_MOTION = !!(mq && mq.matches);
      var onMqChange = function (e) { REDUCED_MOTION = !!e.matches; };
      if (mq && typeof mq.addEventListener === 'function') {
        mq.addEventListener('change', onMqChange);
      } else if (mq && typeof mq.addListener === 'function') {
        mq.addListener(onMqChange);
      }
    }
  } catch (err) { /* no-op */ }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function rand(lo, hi) { return lo + Math.random() * (hi - lo); }
  function isEl(el) { return !!el && typeof el === 'object' && el.nodeType === 1; }

  /* ------------------------------------------------------------------ */
  /* 1. starfield(canvasEl, opts)                                        */
  /*    Layered drifting particle field + occasional shooting streak     */
  /*    + faint nebula glow tints. Returns { stop() } or null.           */
  /* ------------------------------------------------------------------ */

  function starfield(canvasEl, opts) {
    if (!canvasEl || typeof canvasEl.getContext !== 'function') return null;
    var ctx;
    try { ctx = canvasEl.getContext('2d'); } catch (err) { ctx = null; }
    if (!ctx) return null;

    opts = opts || {};
    var BASE_COUNT = typeof opts.count === 'number' ? opts.count : 140;
    var SPEED = typeof opts.speed === 'number' ? opts.speed : 1;      // multiplier
    var COLORS = Array.isArray(opts.colors) && opts.colors.length
      ? opts.colors
      : ['#F4F6FB', '#22D3EE', '#8B7CF6', '#E879F9'];
    var STREAKS = opts.streaks !== false;   // shooting stars on by default
    var NEBULA = opts.nebula !== false;     // faint glow tint on by default

    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var width = 0, height = 0;
    var stars = [];
    var nebulae = [];
    var streak = null;               // at most one live streak at a time
    var nextStreakAt = 0;
    var rafId = 0;
    var running = true;
    var hidden = false;
    var lastT = 0;

    /* Three parallax layers: depth 0 (far, slow, dim) .. 2 (near). */
    var LAYERS = [
      { drift: 0.14, size: [0.5, 1.0], alpha: [0.25, 0.55] },
      { drift: 0.32, size: [0.7, 1.4], alpha: [0.35, 0.75] },
      { drift: 0.60, size: [1.0, 2.0], alpha: [0.5, 1.0] }
    ];
    /* Drift speeds above are px/sec at SPEED=1 — glacial, per motion spec. */

    function makeStar() {
      var layer = Math.floor(Math.random() * LAYERS.length);
      var L = LAYERS[layer];
      var accent = Math.random() < 0.14; // occasional cyan/violet/magenta star
      return {
        x: Math.random() * width,
        y: Math.random() * height,
        layer: layer,
        r: rand(L.size[0], L.size[1]),
        baseA: rand(L.alpha[0], L.alpha[1]),
        twPhase: Math.random() * Math.PI * 2,
        twSpeed: rand(0.3, 1.1),
        color: accent ? COLORS[1 + Math.floor(Math.random() * (COLORS.length - 1))] : COLORS[0]
      };
    }

    function makeNebulae() {
      nebulae = [];
      if (!NEBULA) return;
      var n = 3;
      var tints = [
        'rgba(34,211,238,',   // cyan
        'rgba(139,124,246,',  // violet
        'rgba(232,121,249,'   // magenta
      ];
      for (var i = 0; i < n; i++) {
        nebulae.push({
          x: rand(0.1, 0.9),                 // relative coords, survive resize
          y: rand(0.1, 0.9),
          r: rand(0.25, 0.5),                // relative to max dimension
          tint: tints[i % tints.length],
          phase: Math.random() * Math.PI * 2,
          drift: rand(0.008, 0.02)           // very slow positional wobble
        });
      }
    }

    function populate() {
      var density = BASE_COUNT * ((width * height) / (1280 * 720));
      var n = Math.round(clamp(density, 40, 420));
      stars = [];
      for (var i = 0; i < n; i++) stars.push(makeStar());
    }

    function resize() {
      var parent = canvasEl.parentElement;
      var w = parent ? parent.clientWidth : canvasEl.clientWidth;
      var h = parent ? parent.clientHeight : canvasEl.clientHeight;
      if (!w || !h) { w = window.innerWidth || 800; h = window.innerHeight || 600; }
      width = w; height = h;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvasEl.width = Math.round(w * dpr);
      canvasEl.height = Math.round(h * dpr);
      canvasEl.style.width = w + 'px';
      canvasEl.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      populate();
      if (REDUCED_MOTION) drawFrame(0, 0); // keep the static frame current
    }

    function spawnStreak(now) {
      var fromLeft = Math.random() < 0.5;
      streak = {
        x: fromLeft ? -20 : rand(width * 0.3, width + 20),
        y: rand(0, height * 0.45),
        vx: (fromLeft ? 1 : -1) * rand(380, 620),
        vy: rand(90, 180),
        len: rand(60, 130),
        life: 0,
        ttl: rand(0.5, 0.9)
      };
      nextStreakAt = now + rand(7000, 16000);
    }

    function drawNebulae(t) {
      if (!NEBULA) return;
      var m = Math.max(width, height);
      for (var i = 0; i < nebulae.length; i++) {
        var nb = nebulae[i];
        var wob = Math.sin(t * 0.00005 + nb.phase);
        var cx = (nb.x + wob * nb.drift) * width;
        var cy = (nb.y + Math.cos(t * 0.00004 + nb.phase) * nb.drift) * height;
        var r = nb.r * m;
        var a = 0.035 + 0.015 * Math.sin(t * 0.0001 + nb.phase);
        var g;
        try { g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r); } catch (err) { continue; }
        g.addColorStop(0, nb.tint + a.toFixed(3) + ')');
        g.addColorStop(1, nb.tint + '0)');
        ctx.fillStyle = g;
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
    }

    function drawStars(t, dt) {
      for (var i = 0; i < stars.length; i++) {
        var s = stars[i];
        var L = LAYERS[s.layer];
        if (dt > 0) {
          s.x -= L.drift * SPEED * dt;
          if (s.x < -2) { s.x = width + 2; s.y = Math.random() * height; }
        }
        var tw = REDUCED_MOTION ? 1 : (0.75 + 0.25 * Math.sin(t * 0.001 * s.twSpeed + s.twPhase));
        ctx.globalAlpha = clamp(s.baseA * tw, 0, 1);
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    function drawStreak(dt) {
      if (!streak) return;
      streak.life += dt;
      if (streak.life >= streak.ttl) { streak = null; return; }
      streak.x += streak.vx * dt;
      streak.y += streak.vy * dt;
      var p = streak.life / streak.ttl;
      var fade = p < 0.2 ? p / 0.2 : (1 - p) / 0.8; // ease in, long fade out
      var mag = Math.sqrt(streak.vx * streak.vx + streak.vy * streak.vy) || 1;
      var tx = streak.x - (streak.vx / mag) * streak.len;
      var ty = streak.y - (streak.vy / mag) * streak.len;
      var g;
      try { g = ctx.createLinearGradient(tx, ty, streak.x, streak.y); } catch (err) { return; }
      g.addColorStop(0, 'rgba(34,211,238,0)');
      g.addColorStop(1, 'rgba(244,246,251,' + (0.75 * clamp(fade, 0, 1)).toFixed(3) + ')');
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(streak.x, streak.y);
      ctx.stroke();
    }

    function drawFrame(t, dt) {
      ctx.clearRect(0, 0, width, height);
      drawNebulae(t);
      drawStars(t, dt);
      if (!REDUCED_MOTION) drawStreak(dt);
    }

    function loop(t) {
      if (!running) return;
      rafId = window.requestAnimationFrame(loop);
      if (hidden) return;
      var dt = lastT ? Math.min((t - lastT) / 1000, 0.1) : 0;
      lastT = t;
      if (STREAKS && !REDUCED_MOTION) {
        if (!nextStreakAt) nextStreakAt = t + rand(4000, 10000);
        if (!streak && t >= nextStreakAt) spawnStreak(t);
      }
      drawFrame(t, dt);
    }

    function onVisibility() {
      hidden = !!document.hidden;
      if (!hidden) lastT = 0; // avoid a giant dt jump on resume
    }

    /* --- wiring --------------------------------------------------- */
    var ro = null;
    var resizeHandler = null;
    if (typeof window.ResizeObserver === 'function' && canvasEl.parentElement) {
      try {
        ro = new ResizeObserver(function () { resize(); });
        ro.observe(canvasEl.parentElement);
      } catch (err) { ro = null; }
    }
    if (!ro) {
      resizeHandler = function () { resize(); };
      window.addEventListener('resize', resizeHandler);
    }
    document.addEventListener('visibilitychange', onVisibility);

    makeNebulae();
    resize();

    if (REDUCED_MOTION) {
      drawFrame(0, 0); // single static frame, no loop
    } else if (typeof window.requestAnimationFrame === 'function') {
      rafId = window.requestAnimationFrame(loop);
    } else {
      drawFrame(0, 0);
    }

    return {
      stop: function () {
        running = false;
        if (rafId && typeof window.cancelAnimationFrame === 'function') {
          window.cancelAnimationFrame(rafId);
        }
        if (ro) { try { ro.disconnect(); } catch (err) { /* no-op */ } }
        if (resizeHandler) window.removeEventListener('resize', resizeHandler);
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
  }

  /* ------------------------------------------------------------------ */
  /* 2. reveal()                                                         */
  /*    Adds .is-visible to [data-reveal] on viewport entry.             */
  /*    Stagger via data-reveal-delay -> --reveal-delay custom prop.     */
  /* ------------------------------------------------------------------ */

  function reveal() {
    var els;
    try { els = document.querySelectorAll('[data-reveal]'); } catch (err) { return; }
    if (!els || !els.length) return;

    var i, el;
    for (i = 0; i < els.length; i++) {
      el = els[i];
      var d = el.getAttribute('data-reveal-delay');
      if (d) {
        var ms = parseInt(d, 10);
        if (!isNaN(ms)) el.style.setProperty('--reveal-delay', ms + 'ms');
      }
    }

    /* Content must never stay hidden. */
    if (typeof window.IntersectionObserver !== 'function' || REDUCED_MOTION) {
      for (i = 0; i < els.length; i++) els[i].classList.add('is-visible');
      return;
    }

    var io = new IntersectionObserver(function (entries) {
      for (var j = 0; j < entries.length; j++) {
        if (entries[j].isIntersecting) {
          entries[j].target.classList.add('is-visible');
          io.unobserve(entries[j].target);
        }
      }
    }, { threshold: 0.15, rootMargin: '0px 0px -5% 0px' });

    for (i = 0; i < els.length; i++) io.observe(els[i]);
  }

  /* ------------------------------------------------------------------ */
  /* 3. typewriter(el, strings, opts)                                    */
  /*    Types/erases each string into el.textContent, cycling forever.   */
  /*    Caret is CSS (.typewriter::after). Returns { stop() } or null.   */
  /* ------------------------------------------------------------------ */

  function typewriter(el, strings, opts) {
    if (!isEl(el) || !Array.isArray(strings) || strings.length === 0) return null;
    var list = [];
    for (var i = 0; i < strings.length; i++) {
      var s = String(strings[i] == null ? '' : strings[i]);
      if (s) list.push(s);
    }
    if (!list.length) return null;

    opts = opts || {};
    var TYPE_MS = typeof opts.typeSpeed === 'number' ? opts.typeSpeed : 46;
    var ERASE_MS = typeof opts.eraseSpeed === 'number' ? opts.eraseSpeed : 24;
    var HOLD_MS = typeof opts.hold === 'number' ? opts.hold : 2600;
    var GAP_MS = typeof opts.gap === 'number' ? opts.gap : 500;
    var LOOP = opts.loop !== false;

    if (REDUCED_MOTION) {
      el.textContent = list[0];
      return { stop: function () {} };
    }

    var idx = 0, pos = 0, timer = 0, stopped = false;

    function later(fn, ms) {
      if (stopped) return;
      timer = window.setTimeout(fn, ms);
    }

    function typeStep() {
      if (stopped) return;
      var str = list[idx];
      pos++;
      el.textContent = str.slice(0, pos);
      if (pos < str.length) {
        later(typeStep, TYPE_MS + rand(-12, 18));
      } else if (LOOP || idx < list.length - 1) {
        later(eraseStep, HOLD_MS);
      }
    }

    function eraseStep() {
      if (stopped) return;
      pos--;
      el.textContent = list[idx].slice(0, Math.max(pos, 0));
      if (pos > 0) {
        later(eraseStep, ERASE_MS);
      } else {
        idx = (idx + 1) % list.length;
        later(typeStep, GAP_MS);
      }
    }

    el.textContent = '';
    later(typeStep, GAP_MS);

    return {
      stop: function () {
        stopped = true;
        if (timer) window.clearTimeout(timer);
      }
    };
  }

  /* ------------------------------------------------------------------ */
  /* 4. ticker(el, items)                                                */
  /*    Seamless marquee-style status ticker. Builds a track inside el   */
  /*    with the item list duplicated, then translates it with rAF so    */
  /*    the loop is perfectly continuous. Returns { stop() } or null.    */
  /* ------------------------------------------------------------------ */

  function ticker(el, items, opts) {
    if (!isEl(el) || !Array.isArray(items) || items.length === 0) return null;
    var list = [];
    for (var i = 0; i < items.length; i++) {
      var s = String(items[i] == null ? '' : items[i]);
      if (s) list.push(s);
    }
    if (!list.length) return null;

    opts = opts || {};
    var PX_PER_SEC = typeof opts.speed === 'number' ? opts.speed : 30;
    var SEPARATOR = typeof opts.separator === 'string' ? opts.separator : '·';

    /* Build DOM: el > .ticker__track > 2× (span.ticker__item + sep) */
    el.textContent = '';
    el.style.overflow = 'hidden';
    var track = document.createElement('div');
    track.className = 'ticker__track';
    track.style.display = 'inline-flex';
    track.style.whiteSpace = 'nowrap';
    track.style.willChange = 'transform';

    function appendSet(ariaHidden) {
      var set = document.createElement('span');
      set.className = 'ticker__set';
      set.style.display = 'inline-flex';
      if (ariaHidden) set.setAttribute('aria-hidden', 'true');
      for (var j = 0; j < list.length; j++) {
        var item = document.createElement('span');
        item.className = 'ticker__item';
        item.textContent = list[j];
        item.style.padding = '0 1.25em';
        set.appendChild(item);
        var sep = document.createElement('span');
        sep.className = 'ticker__sep';
        sep.textContent = SEPARATOR;
        sep.setAttribute('aria-hidden', 'true');
        set.appendChild(sep);
      }
      track.appendChild(set);
      return set;
    }

    var firstSet = appendSet(false);
    appendSet(true); // duplicate for seamless wrap
    el.appendChild(track);

    if (REDUCED_MOTION) {
      return { stop: function () {} }; // static list, still readable
    }
    if (typeof window.requestAnimationFrame !== 'function') {
      return { stop: function () {} };
    }

    var offset = 0, setWidth = 0, rafId = 0, lastT = 0, running = true, hidden = false;

    function measure() { setWidth = firstSet.getBoundingClientRect().width; }

    function loop(t) {
      if (!running) return;
      rafId = window.requestAnimationFrame(loop);
      if (hidden) return;
      var dt = lastT ? Math.min((t - lastT) / 1000, 0.1) : 0;
      lastT = t;
      if (!setWidth) measure();
      if (!setWidth) return;
      offset -= PX_PER_SEC * dt;
      if (-offset >= setWidth) offset += setWidth; // seamless wrap
      track.style.transform = 'translateX(' + offset.toFixed(2) + 'px)';
    }

    function onVisibility() {
      hidden = !!document.hidden;
      if (!hidden) lastT = 0;
    }

    var ro = null;
    var resizeHandler = null;
    if (typeof window.ResizeObserver === 'function') {
      try {
        ro = new ResizeObserver(function () { measure(); });
        ro.observe(firstSet);
      } catch (err) { ro = null; }
    }
    if (!ro) {
      resizeHandler = function () { measure(); };
      window.addEventListener('resize', resizeHandler);
    }
    document.addEventListener('visibilitychange', onVisibility);

    measure();
    rafId = window.requestAnimationFrame(loop);

    return {
      stop: function () {
        running = false;
        if (rafId && typeof window.cancelAnimationFrame === 'function') {
          window.cancelAnimationFrame(rafId);
        }
        if (ro) { try { ro.disconnect(); } catch (err) { /* no-op */ } }
        if (resizeHandler) window.removeEventListener('resize', resizeHandler);
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
  }

  /* ------------------------------------------------------------------ */
  /* Export                                                              */
  /* ------------------------------------------------------------------ */

  window.CinamateFX = {
    starfield: starfield,
    reveal: reveal,
    typewriter: typewriter,
    ticker: ticker
  };
})();
