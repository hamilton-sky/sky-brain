// The 3D star brain on the sign-in (entry) page: plain canvas 2D, no libraries. It is part of
// /auth-pages/sign-in.js, so the page keeps a single same-origin script. The web app loads it
// on its own as /auth-pages/brain.js for the small brain in its header.
export const brainScript = `"use strict";
// sky-brain 3D constellation brain. Plain canvas 2D, no libraries, served same-origin
// so it fits default-src 'self'. Colors come from the page's CSS custom properties.
(function () {
 function init(canvas) {
  if (!canvas || !canvas.getContext || canvas.skyBrainOn) return;
  canvas.skyBrainOn = true;
  var ctx = canvas.getContext("2d");
  // data-brain="mini" is the small logo in the app's header: finer stars, no inner pathways.
  var MINI = canvas.getAttribute("data-brain") === "mini";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  // data-regions="on" colours the brain by memory layer and makes the regions clickable.
  var REG = canvas.getAttribute("data-regions") === "on";
  var NAMES = { core: "About me", work: "Board", short: "Inbox", long: "Notebooks" };
  var hl = null, hover = null;

  // Seeded random so the brain is the same on every visit.
  var seed = 7;
  function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }

  // ---- build the point cloud -------------------------------------------------------
  var pts = [];
  function add(x, y, z, kind) { pts.push({ x: x, y: y, z: z, kind: kind, sx: (rnd() - 0.5) * 4, sy: (rnd() - 0.5) * 3, sz: (rnd() - 0.5) * 3, d: rnd() * 0.5 }); }

  // Cerebrum: two hemispheres, folded surface (gyri), flattened base, gap down the middle.
  for (var i = 0; i < 380; i++) {
    var u = rnd() * 2 - 1, th = rnd() * Math.PI * 2;
    var s = Math.sqrt(1 - u * u);
    var dx = s * Math.cos(th), dy = u, dz = s * Math.sin(th);
    var fold = 1 + 0.07 * Math.sin(9 * th + 4 * u) * Math.sin(7 * u + 2 * th) + 0.03 * Math.sin(17 * th);
    var x = dx * 0.66 * fold, y = dy * 0.66 * fold, z = dz * 1.0 * fold;
    if (y < -0.3) y = -0.3 + (y + 0.3) * 0.45;            // flatter underside
    if (z > 0.55 && y < -0.1) y += 0.08;                   // frontal lobe tuck
    x += (x >= 0 ? 1 : -1) * 0.055;                        // longitudinal fissure
    if (Math.abs(dx) < 0.18 && y > 0) y -= 0.05;           // dip along the top fissure
    add(x, y, z, 0);
  }
  // Cerebellum, low at the back.
  for (i = 0; i < 70; i++) {
    u = rnd() * 2 - 1; th = rnd() * Math.PI * 2; s = Math.sqrt(1 - u * u);
    var r = 1 + 0.06 * Math.sin(14 * u);
    add(s * Math.cos(th) * 0.48 * r, -0.42 + u * 0.2 * r, -0.66 + s * Math.sin(th) * 0.26 * r, 1);
  }
  // Brain stem.
  for (i = 0; i < 9; i++) add((rnd() - 0.5) * 0.05, -0.38 - i * 0.075, -0.32 - i * 0.012, 2);

  // Inside the brain: a looser cloud of deep memories, so links also run through the middle.
  var INNER0 = pts.length;
  for (i = 0; i < 150; i++) {
    var ix, iy, iz, ok = false;
    while (!ok) {
      ix = (rnd() * 2 - 1) * 0.66; iy = (rnd() * 2 - 1) * 0.6; iz = (rnd() * 2 - 1) * 0.95;
      var q2 = (ix * ix) / 0.36 + (iy * iy) / 0.3 + (iz * iz) / 0.75;
      ok = q2 < 1 && iy > -0.28;
    }
    add(ix, iy, iz, 3);
  }

  // Core ("About me"): a small bright nucleus at the centre of the brain.
  for (i = 0; i < 34; i++) {
    u = rnd() * 2 - 1; th = rnd() * Math.PI * 2; s = Math.sqrt(1 - u * u);
    var rr = 0.06 + rnd() * 0.13;
    add(s * Math.cos(th) * rr, 0.02 + u * rr * 0.9, -0.02 + s * Math.sin(th) * rr, 3);
    pts[pts.length - 1].reg = "core";
  }
  // Inbox: a curled, seahorse-like hippocampus deep in each side.
  for (var side = -1; side <= 1; side += 2) {
    for (i = 0; i < 22; i++) {
      var tt = i / 21;
      var hz = 0.22 - tt * 0.6, hy = -0.2 + Math.sin(tt * Math.PI) * 0.1 + (tt > 0.8 ? (tt - 0.8) * 0.9 : 0);
      var hx = side * (0.3 - tt * 0.06 + (tt > 0.8 ? (tt - 0.8) * -0.5 : 0));
      add(hx + (rnd() - 0.5) * 0.05, hy + (rnd() - 0.5) * 0.05, hz + (rnd() - 0.5) * 0.05, 3);
      pts[pts.length - 1].reg = "short";
    }
  }
  // Every other point: Board at the front (prefrontal), Notebooks across the rest of the cortex.
  for (i = 0; i < pts.length; i++) {
    var pp = pts[i];
    if (pp.reg) continue;
    if (pp.z > 0.42 && pp.kind !== 1) pp.reg = "work";
    else if (pp.kind === 3 && Math.abs(pp.x) > 0.18 && Math.abs(pp.x) < 0.42 && pp.y < -0.05 && pp.z < 0.25 && pp.z > -0.45) pp.reg = "short";
    else if (pp.kind === 3 && pp.x * pp.x + (pp.y - 0.02) * (pp.y - 0.02) + pp.z * pp.z < 0.06) pp.reg = "core";
    else pp.reg = "long";
  }

  // Split view (the web app's brain view): each layer moves out from About me, in the middle.
  for (i = 0; i < pts.length; i++) {
    var q0 = pts[i], back = q0.kind === 1 || q0.kind === 2;
    q0.ox = q0.reg === "work" ? q0.x * 0.2 : q0.reg === "short" ? (q0.x > 0 ? 0.12 : -0.12) : q0.reg === "long" && !back ? q0.x * 0.3 : 0;
    q0.oy = q0.reg === "work" ? 0.08 : q0.reg === "short" ? -0.78 : q0.reg === "long" ? (back ? -0.25 : 0.2 + q0.y * 0.12) : 0.02;
    q0.oz = q0.reg === "work" ? 0.42 : q0.reg === "short" ? 0.05 : q0.reg === "long" ? (back ? -0.8 : -0.75) : 0;
  }
  var ex = 0, exAim = 0, yawCur = -0.9, lastNow = 0, agentCol = {};
  var N = pts.length;
  // ---- links: surface stars to their 2 nearest, inner stars to their 3 nearest --------
  var edges = [], adj = [];
  for (i = 0; i < N; i++) adj.push([]);
  function link(a, b, flag) {
    if (adj[a].indexOf(b) !== -1) return;
    adj[a].push(b); adj[b].push(a); edges.push([a, b, flag]);
  }
  for (i = 0; i < N; i++) {
    var inner = pts[i].kind === 3, K = inner ? 3 : 2, lim = inner ? 0.09 : 0.06;
    var best = [];
    for (var j = 0; j < N; j++) {
      if (j === i) continue;
      var pj = pts[j];
      if (!inner && pj.kind === 3) continue;                       // surface links stay on the surface
      if ((pts[i].x > 0) !== (pj.x > 0) && pts[i].kind === 0 && pj.kind === 0) continue; // keep hemispheres apart
      var ex = pts[i].x - pj.x, ey = pts[i].y - pj.y, ez = pts[i].z - pj.z;
      var dd = ex * ex + ey * ey + ez * ez;
      if (best.length < K || dd < best[best.length - 1][0]) {
        best.push([dd, j]); best.sort(function (m, n) { return m[0] - n[0]; });
        if (best.length > K) best.pop();
      }
    }
    for (var k = 0; k < best.length; k++) {
      if (best[k][0] > lim) continue;
      link(i, best[k][1], inner ? 2 : 0);
    }
  }
  // Deep pathways: chains through the middle that join the two hemispheres.
  for (i = 0; i < 10; i++) {
    var sA = Math.floor(rnd() * 380), sB = Math.floor(rnd() * 380), mid = INNER0 + Math.floor(rnd() * 150);
    if ((pts[sA].x > 0) === (pts[sB].x > 0)) continue;
    link(sA, mid, 2); link(mid, sB, 2);
  }
  // A few long "memory links" across the brain.
  for (i = 0; i < 14; i++) {
    var a1 = Math.floor(rnd() * 380), a2 = Math.floor(rnd() * 380);
    if (a1 !== a2) edges.push([a1, a2, 1]);
  }
  // Key memories: brighter stars with a glow.
  var keys = [];
  for (i = 0; i < 9; i++) keys.push(Math.floor(rnd() * 380));
  for (i = 0; i < 5; i++) keys.push(INNER0 + Math.floor(rnd() * 150));

  // ---- signals that hop along links -------------------------------------------------
  var signals = [];
  function spawn() {
    var start = rnd() < 0.5 ? INNER0 + Math.floor(rnd() * 150) : Math.floor(rnd() * N);
    while (!adj[start].length) start = Math.floor(rnd() * N);
    return { from: start, to: adj[start][Math.floor(rnd() * adj[start].length)], t: 0, hops: 5 + Math.floor(rnd() * 6), speed: 0.0028 + rnd() * 0.002 };
  }
  for (i = 0; i < 22; i++) { var sg = spawn(); sg.t = rnd(); signals.push(sg); }

  // ---- colours from CSS ---------------------------------------------------------------
  var col = {};
  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    col.node = cs.getPropertyValue("--node").trim() || "#dfe6ff";
    col.core = cs.getPropertyValue("--node-core").trim() || "#ffffff";
    col.line = cs.getPropertyValue("--line").trim() || "rgba(170,188,255,.28)";
    col.signal = cs.getPropertyValue("--signal").trim() || "#eef2ff";
    col.halo = cs.getPropertyValue("--node-halo").trim() || "rgba(150,175,255,.22)";
    col.text = cs.getPropertyValue("--text").trim() || cs.getPropertyValue("--pf-muted").trim() || "#eef1ff";
    col.reg = {
      core: cs.getPropertyValue("--l-core").trim() || col.node,
      work: cs.getPropertyValue("--l-work").trim() || col.node,
      short: cs.getPropertyValue("--l-short").trim() || col.node,
      long: cs.getPropertyValue("--l-long").trim() || col.node
    };
    col.dark = cs.colorScheme ? cs.colorScheme.indexOf("dark") !== -1 : false;
  }
  readColors();
  if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", readColors);
  new MutationObserver(readColors).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  // ---- sizing -----------------------------------------------------------------------
  var W = 0, H = 0, dpr = 1;
  function resize() {
    var r = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    if (!running) draw(performance.now());
  }
  if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas); else window.addEventListener("resize", resize);

  // ---- pointer parallax -------------------------------------------------------------
  var tiltX = 0, tiltY = 0, aimX = 0, aimY = 0;
  window.addEventListener("pointermove", function (e) {
    aimY = (e.clientX / window.innerWidth - 0.5) * 0.6;
    aimX = (e.clientY / window.innerHeight - 0.5) * 0.3;
  }, { passive: true });

  // ---- render -----------------------------------------------------------------------
  var proj = new Array(N), t0 = performance.now(), running = false;
  function cl(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function ease(x) { return x >= 1 ? 1 : 1 - Math.pow(1 - x, 3); }

  function draw(now) {
    var still = reduce.matches;
    var el = still ? 99999 : now - t0;
    var dt = lastNow ? Math.min(64, now - lastNow) : 16; lastNow = now;
    ex = Math.abs(exAim - ex) < 0.001 ? exAim : ex + (exAim - ex) * (still ? 1 : Math.min(1, dt * 0.004));
    if (!still) yawCur += dt * 0.00016 * (1 - ex);
    if (ex > 0) { var dyw = Math.atan2(Math.sin(1.15 - yawCur), Math.cos(1.15 - yawCur)); yawCur += dyw * (still ? 1 : Math.min(1, dt * 0.004)) * ex; }
    var yaw = still && !ex ? -0.9 : yawCur + (still ? 0 : Math.sin(el * 0.0004) * 0.12 * ex);
    tiltX += (aimX - tiltX) * 0.04; tiltY += (aimY - tiltY) * 0.04;
    var pitch = 0.22 + (still ? 0 : tiltX), ya = yaw + (still ? 0 : tiltY);
    var cy = Math.cos(ya), sy = Math.sin(ya), cp = Math.cos(pitch), sp = Math.sin(pitch);
    var R = (MINI ? Math.min(W * 0.44, H * 0.6) : Math.min(W * 0.36, H * 0.5)) * (1 - 0.3 * ex), cx0 = W / 2, cy0 = H * (0.5 - 0.02 * ex), f = 3.4;

    for (var i = 0; i < N; i++) {
      var p = pts[i], a = ease(Math.max(0, (el / 1800) - p.d));
      var x = p.sx + (p.x + p.ox * ex - p.sx) * a, y = p.sy + (p.y + p.oy * ex - p.sy) * a, z = p.sz + (p.z + p.oz * ex - p.sz) * a;
      var x1 = x * cy + z * sy, z1 = -x * sy + z * cy;            // yaw
      var y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;           // pitch
      var sc = f / Math.max(1.2, f - z2);
      proj[i] = { x: cx0 + x1 * sc * R, y: cy0 - y2 * sc * R, z: z2, s: sc, a: Math.min(1, a * 1.4) };
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // soft aura
    var g = ctx.createRadialGradient(cx0, cy0, 0, cx0, cy0, Math.min(W, H) * 0.5);
    g.addColorStop(0, col.halo); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    ctx.globalCompositeOperation = col.dark ? "lighter" : "source-over";

    // links: surface (0), long memory links (1, dotted), inner pathways (2, tinted)
    ctx.lineCap = "round";
    for (i = 0; i < edges.length; i++) {
      var e = edges[i], A = proj[e[0]], B = proj[e[1]], fl = e[2] || 0;
      if (MINI && (fl || i % 3)) continue;
      var depth = cl(((A.z + B.z) / 2 + 1.1) / 2.2);                  // 0 back .. 1 front
      var vis = Math.min(A.a, B.a);
      var em = ex > 0 && pts[e[0]].reg !== pts[e[1]].reg ? 1 - ex : 1;
      if (em <= 0.02) continue;
      if (REG && hl) em *= (pts[e[0]].reg === hl && pts[e[1]].reg === hl) ? 1.8 : 0.35;
      if (REG && pts[e[0]].reg === pts[e[1]].reg && pts[e[0]].reg !== "long") {
        ctx.strokeStyle = col.reg[pts[e[0]].reg];
        ctx.globalAlpha = Math.min(1, (0.25 + 0.4 * depth) * vis * em);
        ctx.lineWidth = 0.7;
        ctx.setLineDash([]);
      } else if (fl === 2) {
        ctx.strokeStyle = col.signal;
        ctx.globalAlpha = Math.min(1, (0.10 + 0.22 * depth) * vis * em);
        ctx.lineWidth = 0.6;
        ctx.setLineDash([]);
      } else {
        ctx.strokeStyle = col.line;
        ctx.globalAlpha = Math.min(1, (fl === 1 ? 0.35 : 0.25 + 0.75 * depth) * vis * em);
        ctx.lineWidth = fl === 1 ? 0.5 : 0.5 + 0.5 * depth;
        if (fl === 1) ctx.setLineDash([1.5, 3]); else ctx.setLineDash([]);
      }
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
    }
    ctx.setLineDash([]);

    // stars, back to front
    var order = proj.map(function (q, k) { return k; }).sort(function (m, n) { return proj[m].z - proj[n].z; });
    ctx.fillStyle = col.node;
    for (i = 0; i < N; i++) {
      var pi = pts[order[i]], q = proj[order[i]], dep = cl((q.z + 1.1) / 2.2), deep = pi.kind === 3;
      var sm = 1, am = 1;
      if (REG) {
        ctx.fillStyle = col.reg[pi.reg];
        if (pi.reg !== "long") { deep = false; sm = 1.25; }
        if (hl) { am = pi.reg === hl ? 1.6 : 0.35; sm *= pi.reg === hl ? 1.3 : 1; }
      }
      ctx.globalAlpha = Math.min(1, (deep ? 0.25 + 0.45 * dep : 0.3 + 0.7 * dep) * q.a * am);
      if (MINI && (deep || order[i] % 2)) continue;
      ctx.beginPath(); ctx.arc(q.x, q.y, (deep ? 0.5 + 0.6 * dep : 0.55 + 0.9 * dep) * q.s * sm * (MINI ? 0.4 : 1), 0, 6.2832); ctx.fill();
    }

    // key memories glow
    for (i = 0; i < keys.length; i++) {
      var kq = proj[keys[i]], kd = cl((kq.z + 1.1) / 2.2);
      var pulse = still ? 0.7 : 0.55 + 0.45 * Math.sin(el * 0.0016 + i * 1.7);
      ctx.globalAlpha = (0.25 + 0.75 * kd) * kq.a * (REG && hl && pts[keys[i]].reg !== hl ? 0.3 : 1);
      ctx.fillStyle = col.halo;
      var km = MINI ? 0.4 : 1;
      ctx.beginPath(); ctx.arc(kq.x, kq.y, (4 + 4 * pulse) * kq.s * km, 0, 6.2832); ctx.fill();
      ctx.fillStyle = col.core;
      ctx.beginPath(); ctx.arc(kq.x, kq.y, (1.4 + 0.8 * kd) * kq.s * km, 0, 6.2832); ctx.fill();
    }

    // The page draws names, rings and links over the parts (the web app's brain view).
    if (REG && canvas.skyBrainOverlay && ex > 0) {
      var centers = {};
      for (i = 0; i < N; i++) {
        var cr = pts[i].reg, cq = proj[i], cc = centers[cr] || (centers[cr] = { x: 0, y: 0, n: 0, top: 1e9, bottom: -1e9 });
        cc.x += cq.x; cc.y += cq.y; cc.n++; cc.top = Math.min(cc.top, cq.y); cc.bottom = Math.max(cc.bottom, cq.y);
      }
      for (var ck in centers) { centers[ck].x /= centers[ck].n; centers[ck].y /= centers[ck].n; }
      ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
      canvas.skyBrainOverlay(ctx, { centers: centers, split: ex, time: el, colors: col.reg, text: col.text, signal: col.signal, highlight: hl });
      ctx.globalCompositeOperation = col.dark ? "lighter" : "source-over";
    }

    // signals
    if (!still && el > 1800) {
      for (i = 0; i < signals.length; i++) {
        var sgn = signals[i];
        sgn.t += sgn.speed * 16;
        if (sgn.t >= 1) {
          sgn.t = 0; sgn.hops--;
          var nb = adj[sgn.to], nxt = nb[Math.floor(rnd() * nb.length)];
          if (sgn.hops <= 0 || nxt === undefined) { signals[i] = spawn(); continue; }
          sgn.from = sgn.to; sgn.to = nxt;
        }
        var P = proj[sgn.from], Q = proj[sgn.to];
        var px = P.x + (Q.x - P.x) * sgn.t, py = P.y + (Q.y - P.y) * sgn.t;
        var sd = cl(((P.z + Q.z) / 2 + 1.1) / 2.2);
        ctx.globalAlpha = 0.35 + 0.65 * sd;
        // An agent working in a part right now colours the signals there.
        var scol = (!MINI && agentCol[pts[sgn.from].reg]) || col.signal, sr = MINI ? 2 : scol === col.signal ? 5 : 7;
        var sgGrad = ctx.createRadialGradient(px, py, 0, px, py, sr);
        sgGrad.addColorStop(0, scol); sgGrad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = sgGrad;
        ctx.beginPath(); ctx.arc(px, py, sr, 0, 6.2832); ctx.fill();
        ctx.fillStyle = scol;
        ctx.beginPath(); ctx.arc(px, py, MINI ? 0.6 : 1.3, 0, 6.2832); ctx.fill();
      }
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }

  if (REG) {
    var pickAt = function (e) {
      var r = canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      var best = null, bd = 18 * 18;
      for (var i = 0; i < N; i++) {
        var q = proj[i]; if (!q) continue;
        var dx = q.x - px, dy = q.y - py, d2 = dx * dx + dy * dy - q.z * 40;
        if (d2 < bd) { bd = d2; best = pts[i].reg; }
      }
      return best;
    };
    canvas.addEventListener("pointermove", function (e) {
      var r = pickAt(e);
      if (r !== hover) {
        hover = r; if (canvas.hasAttribute("data-pick")) canvas.style.cursor = r ? "pointer" : "default";
        canvas.dispatchEvent(new CustomEvent("brain:hover", { detail: r }));
      }
    });
    canvas.addEventListener("pointerleave", function () { hover = null; canvas.dispatchEvent(new CustomEvent("brain:hover", { detail: null })); });
    canvas.addEventListener("click", function (e) {
      var r = pickAt(e);
      if (r) canvas.dispatchEvent(new CustomEvent("brain:pick", { detail: r }));
    });
    canvas.skyBrain = {
      highlight: function (r) { hl = r || null; if (!running) draw(performance.now()); },
      /** Splits the brain into its layers (true) or puts it back together. */
      split: function (on) { exAim = on ? 1 : 0; if (!running) draw(performance.now()); },
      /** Colours for the parts an agent is working in now: { short: "#ff9f6b" }. */
      agents: function (m) { agentCol = m || {}; }
    };
  }

  // A canvas React removed stops drawing, so a remounted header does not leave a loop behind.
  function loop(now) { if (!canvas.isConnected) { running = false; return; } draw(now); if (running) requestAnimationFrame(loop); }
  function start() {
    if (reduce.matches) { running = false; draw(performance.now()); return; }
    if (!running) { running = true; requestAnimationFrame(loop); }
  }
  reduce.addEventListener("change", function () { running = false; start(); });
  resize();
  start();
 }
  // The web app draws its header brain after React renders, so it calls this itself.
  window.skyBrainInit = init;
  var all = document.querySelectorAll("canvas[data-brain]");
  for (var n = 0; n < all.length; n++) init(all[n]);
})();
`;
