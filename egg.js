// Easter egg: hover the "B" in the heading and it turns to sand; click it and
// the page crumbles away to reveal a stack of translucent planes you can turn.
(function () {
  "use strict";

  var b = document.querySelector(".egg-b");
  if (!b) return;

  var root = document.documentElement;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  var THREE_SRC = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
  var SVG_NS = "http://www.w3.org/2000/svg";

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function easeOut(k) { return 1 - Math.pow(1 - k, 3); }

  // ── 1. Sand texture for the B ──────────────────────────────────────────────

  var TILE = 128;

  // Opaque salt-and-pepper grain. darkShare is the fraction of dark grains.
  function grainTile(darkShare) {
    var c = document.createElement("canvas");
    c.width = c.height = TILE;
    var ctx = c.getContext("2d");
    var img = ctx.createImageData(TILE, TILE);
    var d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      var v = Math.random() < darkShare ? Math.random() * 70 : 185 + Math.random() * 70;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL();
  }

  // Mostly clear, with a scatter of bright and dark specks that jump around.
  function sparkleTile() {
    var c = document.createElement("canvas");
    c.width = c.height = TILE;
    var ctx = c.getContext("2d");
    var img = ctx.createImageData(TILE, TILE);
    var d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      if (Math.random() < 0.07) {
        var v = Math.random() < 0.5 ? 10 : 245;
        d[i] = d[i + 1] = d[i + 2] = v;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL();
  }

  (function texture() {
    root.style.setProperty("--egg-sand-light", "url(" + grainTile(0.8) + ")");
    root.style.setProperty("--egg-sand-dark", "url(" + grainTile(0.22) + ")");
    root.style.setProperty("--egg-sparkle", "url(" + sparkleTile() + ")");

    // Stop-motion keyframes: the sand slides downward a few pixels a frame while
    // the specks jump to a new place every frame, so the letter seems to pour.
    var frames = 24, css = "@keyframes egg-grain {";
    var first = null;
    for (var i = 0; i <= frames; i++) {
      var pos;
      if (i === frames) {
        pos = first;
      } else {
        var sx = Math.floor(Math.random() * TILE), sy = Math.floor(Math.random() * TILE);
        var gx = Math.round(Math.random() * 2), gy = Math.round(i * TILE / frames);
        pos = sx + "px " + sy + "px, " + gx + "px " + gy + "px";
        if (i === 0) first = pos;
      }
      css += (i / frames * 100).toFixed(3) + "% { background-position: " + pos + "; }";
    }
    css += "}";
    var style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  })();

  // ── three.js, fetched the first time someone shows interest ────────────────

  var threePromise = null;
  function loadThree() {
    if (window.THREE) return Promise.resolve();
    if (!threePromise) {
      threePromise = new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.src = THREE_SRC;
        s.onload = resolve;
        s.onerror = function () { threePromise = null; reject(); };
        document.head.appendChild(s);
      });
    }
    return threePromise;
  }
  b.addEventListener("pointerenter", function () { loadThree().catch(function () {}); });

  // ── 2. Crumbling the page ──────────────────────────────────────────────────

  var SLOPE = 8;            // sharpness of the dissolve edge
  var filterSvg = null;

  // One filter per block, so each can crumble on its own schedule. A coarse
  // fractal noise decides which parts go first; a fine noise scatters the grains.
  function makeFilter(id, seed) {
    if (!filterSvg) {
      filterSvg = document.createElementNS(SVG_NS, "svg");
      filterSvg.setAttribute("aria-hidden", "true");
      filterSvg.setAttribute("width", "0");
      filterSvg.setAttribute("height", "0");
      filterSvg.style.position = "absolute";
      document.body.appendChild(filterSvg);
    }
    function el(name, attrs, parent) {
      var n = document.createElementNS(SVG_NS, name);
      for (var k in attrs) n.setAttribute(k, attrs[k]);
      (parent || f).appendChild(n);
      return n;
    }
    var f = el("filter", {
      id: id, x: "-25%", y: "-25%", width: "150%", height: "150%",
      "color-interpolation-filters": "sRGB"
    }, filterSvg);
    el("feTurbulence", { type: "fractalNoise", baseFrequency: "0.08", numOctaves: "4", seed: seed, result: "coarse" });
    el("feTurbulence", { type: "fractalNoise", baseFrequency: "0.9", numOctaves: "1", seed: seed + 7, result: "fine" });
    el("feColorMatrix", { in: "coarse", type: "matrix", values: "0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0", result: "grain" });
    var ct = el("feComponentTransfer", { in: "grain", result: "mask" });
    var funcA = el("feFuncA", { type: "linear", slope: String(SLOPE), intercept: "1" }, ct);
    var disp = el("feDisplacementMap", { in: "SourceGraphic", in2: "fine", scale: "0", xChannelSelector: "R", yChannelSelector: "G", result: "moved" });
    el("feComposite", { in: "moved", in2: "mask", operator: "in" });
    return { funcA: funcA, disp: disp };
  }

  function visible(el) { return el && el.getClientRects().length > 0; }

  function centre(r) { return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }

  function textRects(el) {
    var range = document.createRange();
    range.selectNodeContents(el);
    var list = Array.prototype.filter.call(range.getClientRects(), function (r) {
      return r.width > 1 && r.height > 1;
    });
    return list.length ? list : [el.getBoundingClientRect()];
  }

  var items = null;
  function buildItems() {
    if (items) return items;
    var els = [b, document.querySelector(".intro h1")];
    document.querySelectorAll(".intro > p").forEach(function (p) { els.push(p); });
    els.push(document.querySelector(".photo-col"));
    els.push(document.querySelector(".recent"));
    els.push(document.querySelector(".theme-toggle"));
    items = els.filter(visible).map(function (el, i) {
      var id = "egg-dissolve-" + i;
      return { el: el, id: id, f: makeFilter(id, 3 + i * 11) };
    });
    return items;
  }

  // Measure where everything is right now: how far from the B, which way to blow.
  function measure() {
    var from = centre(b.getBoundingClientRect());
    var area = 0;
    items.forEach(function (it) {
      var c = centre(it.el.getBoundingClientRect());
      var dx = c.x - from.x, dy = c.y - from.y, dist = Math.hypot(dx, dy);
      var wx = 0.8, wy = -0.6; // a breeze up and to the right
      it.dir = dist > 1 ? { x: 0.55 * dx / dist + 0.45 * wx, y: 0.55 * dy / dist + 0.45 * wy } : { x: wx, y: wy };
      it.delay = it.el === b ? 0 : 140 + Math.min(dist * 0.9, 950);
      it.dur = it.el === b ? 900 : 1400;
      it.rects = textRects(it.el);
      it.area = it.rects.reduce(function (s, r) { return s + r.width * r.height; }, 0);
      it.color = getComputedStyle(it.el).color;
      it.grey = it.el.classList.contains("photo-col");
      it.spawned = 0;
      area += it.area;
    });
    var total = Math.min(3200, (window.innerWidth * window.innerHeight) / 300);
    items.forEach(function (it) { it.budget = area ? total * it.area / area : 0; });
  }

  function paint(it, p) {
    var s = it.el.style;
    if (p <= 0) {
      s.filter = s.translate = s.opacity = s.visibility = "";
      return;
    }
    if (p >= 1) {
      s.visibility = "hidden";
      s.filter = "";
      return;
    }
    s.visibility = "";
    s.filter = "url(#" + it.id + ")";
    var t = 0.05 + 0.95 * p;
    it.f.funcA.setAttribute("intercept", (1 - SLOPE * t).toFixed(3));
    it.f.disp.setAttribute("scale", (36 * p * p).toFixed(2));
    var drift = 28 * p * p;
    s.translate = (it.dir.x * drift).toFixed(2) + "px " + (it.dir.y * drift - 10 * p * p).toFixed(2) + "px";
    s.opacity = p > 0.75 ? (1 - (p - 0.75) / 0.25).toFixed(3) : "";
  }

  // Dust: specks lifted off each block as it goes, carried off on the breeze.
  var dust = null;
  function dustStart() {
    var c = document.createElement("canvas");
    c.className = "egg-dust";
    c.setAttribute("aria-hidden", "true");
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.round(window.innerWidth * dpr);
    c.height = Math.round(window.innerHeight * dpr);
    document.body.appendChild(c);
    var ctx = c.getContext("2d");
    ctx.scale(dpr, dpr);
    dust = { canvas: c, ctx: ctx, parts: [] };
  }

  function dustSpawn(it, p) {
    var want = it.budget * clamp(p * 1.15, 0, 1);
    var n = Math.floor(want - it.spawned);
    if (n <= 0) return;
    it.spawned += n;
    for (var i = 0; i < n; i++) {
      var pick = Math.random() * it.area, r = it.rects[0];
      for (var j = 0; j < it.rects.length; j++) {
        r = it.rects[j];
        pick -= r.width * r.height;
        if (pick <= 0) break;
      }
      var speed = 25 + Math.random() * 70;
      var g = Math.round(40 + Math.random() * 170);
      dust.parts.push({
        x: r.left + Math.random() * r.width,
        y: r.top + Math.random() * r.height,
        vx: it.dir.x * speed + (Math.random() - 0.5) * 30,
        vy: it.dir.y * speed + (Math.random() - 0.5) * 30 - 12,
        life: 0,
        max: 800 + Math.random() * 1200,
        size: Math.random() < 0.7 ? 1 : 1.8,
        alpha: 0.45 + Math.random() * 0.5,
        color: it.grey ? "rgb(" + g + "," + g + "," + g + ")" : it.color
      });
    }
  }

  function dustStep(dt) {
    var ctx = dust.ctx, s = dt / 1000;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    var alive = [];
    for (var i = 0; i < dust.parts.length; i++) {
      var q = dust.parts[i];
      q.life += dt;
      if (q.life >= q.max) continue;
      q.vx += (Math.random() - 0.5) * 140 * s;
      q.vy += (Math.random() - 0.5) * 140 * s - 18 * s;
      q.x += q.vx * s;
      q.y += q.vy * s;
      ctx.globalAlpha = q.alpha * (1 - q.life / q.max);
      ctx.fillStyle = q.color;
      ctx.fillRect(q.x, q.y, q.size, q.size);
      alive.push(q);
    }
    dust.parts = alive;
  }

  function dustStop() {
    if (!dust) return;
    dust.canvas.remove();
    dust = null;
  }

  // Run every block's crumble (forward) or reassembly (backward).
  function runBlocks(forward, done) {
    var start = performance.now(), last = start;
    var maxDelay = items.reduce(function (m, it) { return Math.max(m, it.delay); }, 0);
    function tick(now) {
      var t = now - start, dt = Math.min(now - last, 50), finished = true;
      last = now;
      items.forEach(function (it) {
        var k;
        if (forward) {
          k = clamp((t - it.delay) / it.dur, 0, 1);
          if (dust) dustSpawn(it, k);
          paint(it, k);
        } else {
          // Come back in reverse order, a little quicker: farthest first, the B last.
          k = clamp((t - (maxDelay - it.delay) * 0.5) / (it.dur * 0.65), 0, 1);
          paint(it, 1 - easeOut(k));
        }
        if (k < 1) finished = false;
      });
      if (dust) dustStep(dt);
      if (!finished || (dust && dust.parts.length)) {
        requestAnimationFrame(tick);
      } else {
        done();
      }
    }
    requestAnimationFrame(tick);
  }

  function totalForward() {
    return items.reduce(function (m, it) { return Math.max(m, it.delay + it.dur); }, 0);
  }

  // ── 3. The planes ──────────────────────────────────────────────────────────

  var stage = null, planes = null, busy = false, lastFocus = null;

  function buildStage() {
    var el = document.createElement("div");
    el.className = "egg-stage";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "Stacked planes");
    el.innerHTML =
      '<canvas class="egg-canvas" tabindex="0" aria-label="Stacked translucent sheets forming a cube. Drag, or use the arrow keys, to turn it. Press Home to reset, Escape to go back."></canvas>' +
      '<div class="egg-layer egg-vignette" aria-hidden="true"></div>' +
      '<svg class="egg-layer egg-grain" aria-hidden="true" focusable="false">' +
        '<filter id="egg-grain-noise" x="0" y="0" width="100%" height="100%">' +
          '<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" stitchTiles="stitch"></feTurbulence>' +
          '<feColorMatrix type="saturate" values="0"></feColorMatrix>' +
        '</filter>' +
        '<rect width="100%" height="100%" filter="url(#egg-grain-noise)"></rect>' +
      '</svg>' +
      '<button class="egg-close" type="button" aria-label="Back to the page">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>' +
      '</button>' +
      '<div class="egg-controls">' +
        '<p class="egg-hint">Drag to turn it</p>' +
        '<button class="egg-reset" type="button">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"></path><path d="M3 4v5h5"></path></svg>' +
          'Reset view' +
        '</button>' +
      '</div>' +
      '<p class="egg-notice" hidden>This view needs WebGL, which this browser has turned off or doesn\'t support.</p>';
    document.body.appendChild(el);
    el.querySelector(".egg-close").addEventListener("click", close);
    // Only draw the focus ring once someone is moving around with the keyboard.
    el.addEventListener("keydown", function (e) { if (e.key === "Tab") el.classList.add("kbd"); });
    return el;
  }

  function makePlanes(stageEl) {
    var canvas = stageEl.querySelector(".egg-canvas");
    var vignette = stageEl.querySelector(".egg-vignette");
    var hint = stageEl.querySelector(".egg-hint");
    var resetBtn = stageEl.querySelector(".egg-reset");
    var notice = stageEl.querySelector(".egg-notice");
    var still = reduceMotion.matches;

    function showNotice() {
      notice.hidden = false;
      hint.classList.add("gone");
      canvas.removeAttribute("tabindex");
    }

    var SHEETS = 9, DEPTH = 0.73, TILT = 40 * Math.PI / 180;
    var WHITE = 0.10, FADE_TO = 0.04, FALLOFF = 1.5;
    var F = 1027, CX = 500, CY = 495, CENTRE = [0.054, 1.927];

    // Frame the stack's outline in the middle of a 1000px square, as the flat design does.
    var d1 = [Math.cos(TILT), Math.sin(TILT)];
    var d2 = [-Math.sin(TILT), Math.cos(TILT)];
    var xs = [], ys = [];
    for (var i = 0; i < SHEETS; i++) {
      var t = DEPTH * (i / (SHEETS - 1) - 0.5);
      var c = [CENTRE[0] + t * d1[0], CENTRE[1] + t * d1[1]];
      [1, -1].forEach(function (sx) {
        [1, -1].forEach(function (sy) {
          var X = c[0] + sx * 0.5 * d2[0], Z = c[1] + sx * 0.5 * d2[1];
          xs.push(CX + F * X / Z);
          ys.push(CY - F * (sy * 0.5) / Z);
        });
      });
    }
    var frameDx = 500 - (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2;
    var frameDy = 500 - (Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2;
    var lensX = CX + frameDx - 500;
    var lensY = CY + frameDy - 500;

    if (!window.THREE) { showNotice(); return null; }
    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    } catch (err) {
      showNotice();
      return null;
    }
    renderer.setClearColor(0x000000, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);

    // Every sheet: white at its back edge easing to nearly clear at its front edge.
    var baseMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uWhite: { value: WHITE },
        uFade: { value: FADE_TO },
        uFalloff: { value: FALLOFF },
        uOpacity: { value: 1 }
      },
      vertexShader: [
        "varying vec2 vUv;",
        "void main() {",
        "  vUv = uv;",
        "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
        "}"
      ].join("\n"),
      fragmentShader: [
        "uniform float uWhite;",
        "uniform float uFade;",
        "uniform float uFalloff;",
        "uniform float uOpacity;",
        "varying vec2 vUv;",
        "void main() {",
        "  float p = clamp(vUv.x, 0.0, 1.0);",
        "  float a = uFade + (uWhite - uFade) * pow(max(1.0 - p, 0.00001), uFalloff);",
        "  gl_FragColor = vec4(1.0, 1.0, 1.0, a * uOpacity);",
        "}"
      ].join("\n"),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    // The stack turns about its own centre.
    var cube = new THREE.Group();
    cube.position.set(CENTRE[0], 0, -CENTRE[1]);
    var xAxis = new THREE.Vector3(Math.sin(TILT), 0, Math.cos(TILT));
    var yAxis = new THREE.Vector3(0, 1, 0);
    var zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis);
    var home = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
    cube.quaternion.copy(home);

    var sheetGeometry = new THREE.PlaneGeometry(1, 1);
    var sheets = [];
    for (var s = 0; s < SHEETS; s++) {
      var depthAt = DEPTH * (s / (SHEETS - 1) - 0.5);
      var mat = baseMaterial.clone();
      var sheet = new THREE.Mesh(sheetGeometry, mat);
      sheet.position.z = -depthAt;
      cube.add(sheet);
      sheets.push({ mesh: sheet, mat: mat, z: -depthAt });
    }
    scene.add(cube);

    // The entrance: sheets slide in one after another from behind the stack
    // while the whole thing swings round to the resting view.
    var intro = null;
    if (!still) {
      var tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0.35, 1, 0.15).normalize(), -1.1);
      intro = { start: performance.now(), from: home.clone().premultiply(tilt), turning: true };
      cube.quaternion.copy(intro.from);
      sheets.forEach(function (sh) { sh.mat.uniforms.uOpacity.value = 0; });
    }

    var W = 0, H = 0, S = 1;
    function resize() {
      W = window.innerWidth;
      H = window.innerHeight;
      S = Math.min(W, H) * 0.7;
      renderer.setSize(W, H, false);
      var focalPx = F * S / 1000;
      camera.fov = 2 * Math.atan((H / 2) / focalPx) * 180 / Math.PI;
      camera.aspect = W / H;
      camera.setViewOffset(W, H, -lensX * S / 1000, -lensY * S / 1000, W, H);
      camera.updateProjectionMatrix();
      var L = (W - S) / 2, T = (H - S) / 2;
      vignette.style.background = "radial-gradient(circle " + (0.6 * S).toFixed(1) + "px at " +
        (L + 0.4 * S).toFixed(1) + "px " + (T + 0.5 * S).toFixed(1) + "px, " +
        "rgba(0, 0, 0, 0) 45%, rgba(0, 0, 0, 0.55) 78%, rgba(0, 0, 0, 0.92) 100%)";
    }
    resize();
    window.addEventListener("resize", resize);

    // Free rotation: the drag direction sets the axis, the drag length sets the angle.
    var spin = new THREE.Quaternion();
    var axis = new THREE.Vector3();
    var velAxis = new THREE.Vector3(0, 1, 0);
    var velW = 0;
    var resetAnim = null;
    var active = null, lastX = 0, lastY = 0, lastT = 0, downX = 0, downY = 0, moved = false;
    var lastTap = { t: 0, x: 0, y: 0 };
    var touchedOnce = false;

    function radPerPx() { return 3.4 / S; }

    function turn(dxPx, dyPx) {
      var len = Math.hypot(dxPx, dyPx);
      if (!len) return 0;
      axis.set(dyPx, dxPx, 0).normalize();
      var angle = len * radPerPx();
      spin.setFromAxisAngle(axis, angle);
      cube.quaternion.premultiply(spin);
      return angle;
    }

    function touched() {
      if (!touchedOnce) {
        touchedOnce = true;
        hint.classList.add("gone");
      }
      resetBtn.classList.add("shown");
    }

    function stopIntroTurn() { if (intro) intro.turning = false; }

    function resetView() {
      velW = 0;
      stopIntroTurn();
      if (reduceMotion.matches) {
        cube.quaternion.copy(home);
        resetAnim = null;
      } else {
        resetAnim = { from: cube.quaternion.clone(), start: performance.now(), dur: 700 };
      }
      if (document.activeElement === resetBtn) canvas.focus({ preventScroll: true });
      resetBtn.classList.remove("shown");
    }

    canvas.addEventListener("pointerdown", function (e) {
      if (active !== null) return;
      active = e.pointerId;
      canvas.setPointerCapture(e.pointerId);
      canvas.classList.add("dragging");
      lastX = downX = e.clientX;
      lastY = downY = e.clientY;
      lastT = performance.now();
      moved = false;
      velW = 0;
      resetAnim = null;
      stopIntroTurn();
    });

    canvas.addEventListener("pointermove", function (e) {
      if (e.pointerId !== active) return;
      var now = performance.now();
      var angle = turn(e.clientX - lastX, e.clientY - lastY);
      if (angle) {
        var dt = Math.max(now - lastT, 1);
        velAxis.copy(axis);
        velW = 0.7 * (angle / dt) + 0.3 * velW;
      }
      if (!moved && Math.hypot(e.clientX - downX, e.clientY - downY) > 6) {
        moved = true;
        touched();
      }
      lastX = e.clientX;
      lastY = e.clientY;
      lastT = now;
    });

    function release(e) {
      if (e.pointerId !== active) return;
      active = null;
      canvas.classList.remove("dragging");
      var now = performance.now();
      if (now - lastT > 60 || reduceMotion.matches) velW = 0;
      velW = Math.min(velW, 0.02);
      if (!moved) {
        // Double-tap puts it back where it started.
        if (now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
          resetView();
          lastTap.t = 0;
        } else {
          lastTap = { t: now, x: e.clientX, y: e.clientY };
        }
      }
    }
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);

    canvas.addEventListener("keydown", function (e) {
      var px = (10 * Math.PI / 180) / radPerPx();
      var handled = true;
      resetAnim = null;
      velW = 0;
      if (e.key === "ArrowLeft") turn(-px, 0);
      else if (e.key === "ArrowRight") turn(px, 0);
      else if (e.key === "ArrowUp") turn(0, -px);
      else if (e.key === "ArrowDown") turn(0, px);
      else if (e.key === "Home") { resetView(); return e.preventDefault(); }
      else handled = false;
      if (handled) {
        stopIntroTurn();
        e.preventDefault();
        touched();
      }
    });

    resetBtn.addEventListener("click", resetView);

    var raf = 0;
    var prev = performance.now();
    function frame(now) {
      var dt = Math.min(now - prev, 50);
      prev = now;
      if (intro) {
        var t = now - intro.start, settled = true;
        sheets.forEach(function (sh, i) {
          var k = clamp((t - i * 90) / 1300, 0, 1);
          if (k < 1) settled = false;
          sh.mesh.position.z = sh.z - (1 - easeOut(k)) * 1.1;
          sh.mat.uniforms.uOpacity.value = Math.min(1, k * 1.6);
        });
        if (intro.turning) {
          var r = clamp(t / 2400, 0, 1);
          cube.quaternion.copy(intro.from).slerp(home, easeOut(r));
          if (r < 1) settled = false;
          else intro.turning = false;
        }
        if (settled) intro = null;
      }
      if (resetAnim) {
        var k2 = Math.min((now - resetAnim.start) / resetAnim.dur, 1);
        cube.quaternion.copy(resetAnim.from).slerp(home, easeOut(k2));
        if (k2 >= 1) resetAnim = null;
      } else if (active === null && velW > 0.00002) {
        spin.setFromAxisAngle(velAxis, velW * dt);
        cube.quaternion.premultiply(spin);
        velW *= Math.exp(-dt / 420);
      }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return {
      canvas: canvas,
      destroy: function () {
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", resize);
        sheets.forEach(function (sh) { sh.mat.dispose(); });
        baseMaterial.dispose();
        sheetGeometry.dispose();
        renderer.dispose();
      }
    };
  }

  // ── 4. Putting it together ─────────────────────────────────────────────────

  function onKey(e) {
    if (e.key === "Escape" && stage && !busy) close();
  }

  function open() {
    if (busy || stage) return;
    busy = true;
    lastFocus = document.activeElement;
    root.classList.add("egg-active");
    b.classList.add("egg-live");
    buildItems();
    measure();

    var three = loadThree().catch(function () {});
    var still = reduceMotion.matches;
    if (!still) dustStart();
    else items.forEach(function (it) { it.delay = 0; it.dur = 350; });

    var crumbled = false, staged = false;
    function finish() {
      if (crumbled && staged) {
        dustStop();
        busy = false;
      }
    }

    runBlocks(true, function () { crumbled = true; finish(); });

    // Bring the black stage up as the last of the page goes, then build the planes.
    var reveal = still ? 300 : Math.max(totalForward() - 500, 600);
    setTimeout(function () {
      stage = buildStage();
      requestAnimationFrame(function () { stage.classList.add("on"); });
      three.then(function () {
        setTimeout(function () {
          planes = makePlanes(stage);
          stage.classList.add("lit");
          (planes ? planes.canvas : stage.querySelector(".egg-close")).focus({ preventScroll: true });
          document.addEventListener("keydown", onKey);
          staged = true;
          finish();
        }, still ? 0 : 450);
      });
    }, reveal);
  }

  function close() {
    if (busy || !stage) return;
    busy = true;
    document.removeEventListener("keydown", onKey);
    var leaving = stage, leavingPlanes = planes;
    stage = planes = null;
    leaving.classList.remove("on");
    setTimeout(function () {
      if (leavingPlanes) leavingPlanes.destroy();
      leaving.remove();
    }, 700);

    setTimeout(function () {
      runBlocks(false, function () {
        items.forEach(function (it) { paint(it, 0); });
        b.classList.remove("egg-live");
        root.classList.remove("egg-active");
        if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
        busy = false;
      });
    }, reduceMotion.matches ? 0 : 250);
  }

  b.addEventListener("click", open);
})();
