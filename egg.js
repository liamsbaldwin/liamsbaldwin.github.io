// Easter egg: hover the "B" in the heading and it turns to sand; click it and
// the page is pulled into it and its sand floods out to reveal a stack of translucent planes you can turn.
(function () {
  "use strict";

  var b = document.querySelector(".egg-b");
  if (!b) return;

  var root = document.documentElement;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  var THREE_SRC = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function easeOut(k) { return 1 - Math.pow(1 - k, 3); }

  // ── 1. Sand texture for the B ──────────────────────────────────────────────

  // The tile is TILE css pixels square but drawn at the screen's own pixel
  // density, so every grain is a single device pixel: as fine as the screen allows.
  var TILE = 256;
  var DENSITY = clamp(Math.round(window.devicePixelRatio || 1), 1, 3);

  function tile(paint) {
    var size = TILE * DENSITY;
    var c = document.createElement("canvas");
    c.width = c.height = size;
    var ctx = c.getContext("2d");
    var img = ctx.createImageData(size, size);
    var d = img.data;
    for (var i = 0; i < d.length; i += 4) paint(d, i);
    ctx.putImageData(img, 0, 0);
    return "url(" + c.toDataURL() + ")";
  }

  // Opaque salt-and-pepper grain. darkShare is the fraction of dark grains.
  function grainTile(darkShare) {
    return tile(function (d, i) {
      var v = Math.random() < darkShare ? Math.random() * 60 : 195 + Math.random() * 60;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    });
  }

  // Mostly clear, with a light scatter of specks that jump around.
  function sparkleTile() {
    return tile(function (d, i) {
      if (Math.random() < 0.03) {
        d[i] = d[i + 1] = d[i + 2] = Math.random() < 0.5 ? 10 : 245;
        d[i + 3] = 255;
      }
    });
  }

  (function texture() {
    root.style.setProperty("--egg-sand-light", grainTile(0.8));
    root.style.setProperty("--egg-sand-dark", grainTile(0.22));
    root.style.setProperty("--egg-sparkle", sparkleTile());

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
        var gx = Math.floor(Math.random() * TILE), gy = Math.round(i * TILE / frames);
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

  // ── 2. Pulling the page into the B ─────────────────────────────────────────

  function visible(el) { return el && el.getClientRects().length > 0; }

  function centre(r) { return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }

  var IN_EASE = "cubic-bezier(0.55, 0, 0.8, 0.2)";
  var OUT_EASE = "cubic-bezier(0.2, 0.8, 0.45, 1)";

  // Everything except the B itself.
  function blocks() {
    var els = Array.prototype.slice.call(document.querySelectorAll(".egg-part"));
    document.querySelectorAll(".intro > p").forEach(function (p) { els.push(p); });
    els.push(document.querySelector(".photo-col"));
    els.push(document.querySelector(".recent"));
    els.push(document.querySelector(".theme-toggle"));
    return els.filter(visible);
  }

  // Each block shrinks and slides into the B, nearest first.
  function measure(items) {
    var from = centre(b.getBoundingClientRect());
    items.forEach(function (it) {
      var c = centre(it.el.getBoundingClientRect());
      it.dx = (from.x - c.x) * 0.9;
      it.dy = (from.y - c.y) * 0.9;
      it.delay = Math.min(Math.hypot(from.x - c.x, from.y - c.y) * 0.12, 160);
    });
    return items;
  }

  function pull(items, inward, dur) {
    var still = reduceMotion.matches;
    var maxDelay = items.reduce(function (m, it) { return Math.max(m, it.delay); }, 0);
    return Promise.all(items.map(function (it) {
      var rest = { translate: "0px 0px", scale: "1", opacity: 1, filter: "blur(0px)" };
      var gone = still
        ? { translate: "0px 0px", scale: "1", opacity: 0, filter: "blur(0px)" }
        : { translate: it.dx.toFixed(1) + "px " + it.dy.toFixed(1) + "px", scale: "0.1", opacity: 0, filter: "blur(6px)" };
      var old = it.anim;
      it.anim = it.el.animate(inward ? [rest, gone] : [gone, rest], {
        duration: still ? 200 : dur,
        // Out: nearest first. Back: farthest first, so the B is the last thing to let go.
        delay: still ? 0 : (inward ? it.delay : maxDelay - it.delay),
        easing: inward ? IN_EASE : OUT_EASE,
        fill: "both"
      });
      if (old) old.cancel();
      return it.anim.finished.catch(function () {});
    }));
  }

  // The B's sand pours out of the letter until it fills the screen.
  function makeFlood() {
    var el = document.createElement("div");
    el.className = "egg-flood";
    el.setAttribute("aria-hidden", "true");
    document.body.appendChild(el);
    return el;
  }

  function floodShapes() {
    var r = b.getBoundingClientRect(), c = centre(r);
    var W = window.innerWidth, H = window.innerHeight;
    var far = Math.max(Math.hypot(c.x, c.y), Math.hypot(W - c.x, c.y), Math.hypot(c.x, H - c.y), Math.hypot(W - c.x, H - c.y));
    var at = " at " + c.x.toFixed(1) + "px " + c.y.toFixed(1) + "px)";
    return { small: "circle(0px" + at, big: "circle(" + Math.ceil(far + 2) + "px" + at };
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
        resetAnim = { from: cube.quaternion.clone(), start: performance.now(), dur: 500 };
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
          var k = clamp((t - i * 50) / 800, 0, 1);
          if (k < 1) settled = false;
          sh.mesh.position.z = sh.z - (1 - easeOut(k)) * 1.1;
          sh.mat.uniforms.uOpacity.value = Math.min(1, k * 1.6);
        });
        if (intro.turning) {
          var r = clamp(t / 1400, 0, 1);
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

  var items = null, flood = null;

  function onKey(e) {
    if (e.key === "Escape" && stage && !busy) close();
  }

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function open() {
    if (busy || stage) return;
    busy = true;
    lastFocus = document.activeElement;
    root.classList.add("egg-active");
    b.classList.add("egg-live");
    var still = reduceMotion.matches;
    var three = loadThree().catch(function () {});

    items = measure(blocks().map(function (el) { return { el: el }; }));
    pull(items, true, 420);

    var shapes = floodShapes();
    flood = makeFlood();
    var poured = still
      ? flood.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, fill: "both" })
      : flood.animate([{ clipPath: shapes.small }, { clipPath: shapes.big }], { duration: 480, delay: 260, easing: "cubic-bezier(0.7, 0, 0.84, 0)", fill: "both" });

    poured.finished.then(function () {
      stage = buildStage();
      return three;
    }).then(function () {
      planes = makePlanes(stage);
      var shown = stage;
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { shown.classList.add("on", "lit"); });
      });
      // Hidden under the stage now; no need to keep pouring.
      setTimeout(function () { if (flood) flood.style.animationPlayState = "paused"; }, 500);
      (planes ? planes.canvas : stage.querySelector(".egg-close")).focus({ preventScroll: true });
      document.addEventListener("keydown", onKey);
      busy = false;
    });
  }

  function close() {
    if (busy || !stage) return;
    busy = true;
    var still = reduceMotion.matches;
    document.removeEventListener("keydown", onKey);
    var leaving = stage, leavingPlanes = planes;
    stage = planes = null;
    leaving.classList.remove("on");
    flood.style.animationPlayState = "";

    var shapes = floodShapes();
    wait(still ? 0 : 280).then(function () {
      if (leavingPlanes) leavingPlanes.destroy();
      leaving.remove();
      var drained = still
        ? flood.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: "both" })
        : flood.animate([{ clipPath: shapes.big }, { clipPath: shapes.small }], { duration: 380, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "both" });
      return Promise.all([drained.finished, wait(still ? 0 : 120).then(function () { return pull(items, false, 460); })]);
    }).then(function () {
      flood.remove();
      flood = null;
      items.forEach(function (it) { it.anim.cancel(); });
      b.classList.remove("egg-live");
      root.classList.remove("egg-active");
      if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
      busy = false;
    });
  }

  b.addEventListener("click", open);
})();
