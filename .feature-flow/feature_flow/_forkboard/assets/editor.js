
(function () {
  var root = document.documentElement, page = (document.querySelector('.wrap') || {}).dataset || {};
  var key = 'brainstorm:' + (page.page || 'page') + ':';
  function load(k) { try { return localStorage.getItem(key + k); } catch (e) { return null; } }
  function save(k, v) { try { if (v === null) localStorage.removeItem(key + k); else localStorage.setItem(key + k, v); } catch (e) {} }
  function toast(text) {
    var t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = text;
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 1800);
  }

  // theme: system, light or dark
  function theme(value) {
    if (value === 'light' || value === 'dark') root.setAttribute('data-theme', value); else root.removeAttribute('data-theme');
    document.querySelectorAll('[data-theme-set]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.themeSet === (value || 'system'))); });
  }
  theme(load('theme') || 'system');
  document.querySelectorAll('[data-theme-set]').forEach(function (b) {
    b.addEventListener('click', function () { theme(b.dataset.themeSet); save('theme', b.dataset.themeSet); });
  });

  // motion: off until the reader turns it on
  var motion = document.getElementById('motion');
  if (motion) {
    motion.checked = load('motion') === 'on';
    root.classList.toggle('motion-on', motion.checked);
    motion.addEventListener('change', function () { root.classList.toggle('motion-on', motion.checked); save('motion', motion.checked ? 'on' : null); });
  }

  // the route: which section is in view, and how far the reader got
  var links = Array.prototype.slice.call(document.querySelectorAll('nav.route > ol > li > a'));
  var sections = links.map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); });
  var seen = {}, bar = document.querySelector('.route .bar i'), count = document.querySelector('.route .count');
  function mark() {
    var current = 0;
    sections.forEach(function (s, i) { if (s && s.getBoundingClientRect().top < window.innerHeight * 0.35) { current = i; seen[i] = true; } });
    links.forEach(function (a, i) { a.classList.toggle('here', i === current); });
    var n = Object.keys(seen).length;
    if (bar) bar.style.width = (sections.length ? 100 * n / sections.length : 0) + '%';
    if (count) count.textContent = n + ' of ' + sections.length + ' sections read';
  }
  window.addEventListener('scroll', mark, { passive: true });
  mark();

  // diagrams: lay out, draw, drag
  var NS = 'http://www.w3.org/2000/svg';
  function el(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function wrap(text) {
    var words = text.split(/\s+/), lines = [], line = '';
    words.forEach(function (w) { if ((line + ' ' + w).trim().length > 22 && line) { lines.push(line); line = w; } else line = (line + ' ' + w).trim(); });
    if (line) lines.push(line);
    return lines.slice(0, 4);
  }
  function measure(n) {
    n.lines = wrap(n.label);
    var longest = Math.max.apply(null, n.lines.map(function (l) { return l.length; }).concat(1));
    n.w = Math.max(96, Math.min(230, longest * 7.4 + 32));
    n.h = Math.max(44, n.lines.length * 17 + 24);
    if (n.shape === 'diamond') { n.w += 40; n.h += 24; }
    if (n.shape === 'circle') { n.w = n.h = Math.max(n.w, n.h); }
  }
  function loops(g) {  // depth first, in the order the source names them: an edge back to an open node is a loop
    var ids = g.nodes.map(function (n) { return n.id; }), state = {}, forward = [], out = {};
    g.edges.forEach(function (e) { (out[e.from] = out[e.from] || []).push(e); });
    function visit(id) {
      state[id] = 1;
      (out[id] || []).forEach(function (e) {
        if (state[e.to] === 1 || e.to === e.from) return;
        forward.push(e);
        if (!state[e.to]) visit(e.to);
      });
      state[id] = 2;
    }
    ids.forEach(function (id) { if (!state[id]) visit(id); });
    g.edges.forEach(function (e) { e.back = forward.indexOf(e) < 0; });
    return forward;
  }
  function layout(g) {
    var lr0 = g.dir === 'LR', rank = {}, ids = g.nodes.map(function (n) { return n.id; }), forward = loops(g);
    ids.forEach(function (id) { rank[id] = 0; });
    for (var pass = 0; pass < ids.length; pass++) {
      var moved = false;
      forward.forEach(function (e) { if (rank[e.to] < rank[e.from] + 1) { rank[e.to] = rank[e.from] + 1; moved = true; } });
      if (!moved) break;
    }
    var rows = {}, pos = {};
    g.nodes.forEach(function (n) {
      measure(n);
      (rows[rank[n.id]] = rows[rank[n.id]] || []).push(n);
    });
    var longest = g.edges.reduce(function (m, e) { return Math.max(m, e.label.length); }, 0);
    var step = Math.max(lr0 ? 72 : 64, longest * 6.6 + 36);
    var along = 0, lr = lr0, gap = lr ? 28 : 36, spans = {}, widest = 0;
    Object.keys(rows).forEach(function (r) {
      spans[r] = rows[r].reduce(function (s, n) { return s + (lr ? n.h : n.w) + gap; }, -gap);
      widest = Math.max(widest, spans[r]);
    });
    Object.keys(rows).sort(function (a, b) { return a - b; }).forEach(function (r) {
      var row = rows[r], depth = Math.max.apply(null, row.map(function (n) { return lr ? n.w : n.h; }));
      var across = (widest - spans[r]) / 2;
      row.forEach(function (n) {
        var size = lr ? n.h : n.w;
        pos[n.id] = lr ? { x: along + depth / 2, y: across + size / 2 } : { x: across + size / 2, y: along + depth / 2 };
        across += size + gap;
      });
      along += depth + step;
    });
    return pos;
  }
  function radial(g) {  // the most joined box in the middle, the rest in rings by how many arrows away they are
    var pos = {}, near = {}, ids = g.nodes.map(function (n) { return n.id; }), byId = {};
    g.nodes.forEach(function (n) { measure(n); byId[n.id] = n; near[n.id] = []; });
    g.edges.forEach(function (e) { if (e.from !== e.to && near[e.from] && near[e.to]) { near[e.from].push(e.to); near[e.to].push(e.from); } });
    if (!ids.length) return pos;
    var hub = ids.reduce(function (a, b) { return near[b].length > near[a].length ? b : a; }), ring = {}, rings = [[hub]];
    ring[hub] = 0;
    for (var k = 0; rings[k].length; k++) {
      rings.push([]);
      rings[k].forEach(function (id) { near[id].forEach(function (to) { if (ring[to] === undefined) { ring[to] = k + 1; rings[k + 1].push(to); } }); });
    }
    rings.pop();
    var loose = ids.filter(function (id) { return ring[id] === undefined; });  // boxes with no path to the middle go outside
    if (loose.length) rings.push(loose);
    var widest = g.nodes.reduce(function (m, n) { return Math.max(m, n.w, n.h); }, 0), radius = 0;
    pos[hub] = { x: 0, y: 0 };
    var angle = {};
    rings.slice(1).forEach(function (row, i) {
      var around = row.reduce(function (s, id) { return s + byId[id].w + 36; }, 0), n = row.length;
      radius = Math.max(radius + widest * 0.55 + 60, around / (2 * Math.PI), i ? 0 : 150);
      var want = {};  // beside the boxes it joins in the ring inside, so arrows cross less
      row.forEach(function (id, j) {
        var x = 0, y = 0;
        near[id].forEach(function (to) { if (angle[to] !== undefined) { x += Math.cos(angle[to]); y += Math.sin(angle[to]); } });
        want[id] = x || y ? Math.atan2(y, x) : -Math.PI / 2 + (2 * Math.PI * j) / n;
      });
      row = row.slice().sort(function (a, b) { return want[a] - want[b]; });
      var turn = Math.atan2(row.reduce(function (s, id, j) { return s + Math.sin(want[id] - (2 * Math.PI * j) / n); }, 0),
        row.reduce(function (s, id, j) { return s + Math.cos(want[id] - (2 * Math.PI * j) / n); }, 0));
      row.forEach(function (id, j) {
        var a = angle[id] = turn + (2 * Math.PI * j) / n;
        pos[id] = { x: Math.round(radius * Math.cos(a) * 1.25), y: Math.round(radius * Math.sin(a)) };
      });
    });
    return pos;
  }
  function grid(g) {  // rows of equal cells, in the order the arrows run
    var flow = layout(g), pos = {}, order = g.nodes.slice().sort(function (a, b) {
      var pa = flow[a.id], pb = flow[b.id];
      return g.dir === 'LR' ? pa.x - pb.x || pa.y - pb.y : pa.y - pb.y || pa.x - pb.x;
    });
    var cols = Math.max(1, Math.ceil(Math.sqrt(order.length * 1.6)));
    var w = order.reduce(function (m, n) { return Math.max(m, n.w); }, 0) + 44, h = order.reduce(function (m, n) { return Math.max(m, n.h); }, 0) + 48;
    order.forEach(function (n, i) { pos[n.id] = { x: (i % cols) * w, y: Math.floor(i / cols) * h }; });
    return pos;
  }
  var ARRANGE = {
    LR: function (g) { g.dir = 'LR'; return layout(g); },
    TD: function (g) { g.dir = 'TD'; return layout(g); },
    radial: radial, grid: grid
  };
  function border(n, p, toward) {
    var dx = toward.x - p.x, dy = toward.y - p.y;
    if (!dx && !dy) return { x: p.x, y: p.y };
    var sx = (n.w / 2) / Math.abs(dx || 1e-9), sy = (n.h / 2) / Math.abs(dy || 1e-9);
    var s = Math.min(sx, sy);
    if (n.shape === 'diamond' || n.shape === 'circle') s = Math.min(s, 1 / (Math.abs(dx) / (n.w / 2) + Math.abs(dy) / (n.h / 2)) * (n.shape === 'circle' ? 1.2 : 1));
    return { x: p.x + dx * s, y: p.y + dy * s };
  }
  function shape(n, g) {
    var w = n.w, h = n.h, x = -w / 2, y = -h / 2;
    if (n.shape === 'diamond') return el('polygon', { points: [0, y, w / 2, 0, 0, h / 2, x, 0].join(' '), class: 'shape' }, g);
    if (n.shape === 'hexagon') return el('polygon', { points: [x + 14, y, w / 2 - 14, y, w / 2, 0, w / 2 - 14, h / 2, x + 14, h / 2, x, 0].join(' '), class: 'shape' }, g);
    if (n.shape === 'circle') return el('ellipse', { cx: 0, cy: 0, rx: w / 2, ry: h / 2, class: 'shape' }, g);
    if (n.shape === 'cylinder') {
      el('rect', { x: x, y: y + 6, width: w, height: h - 6, class: 'shape' }, g);
      return el('ellipse', { cx: 0, cy: y + 6, rx: w / 2, ry: 6, class: 'shape' }, g);
    }
    return el('rect', { x: x, y: y, width: w, height: h, rx: n.shape === 'stadium' ? h / 2 : n.shape === 'round' ? 14 : 8, class: n.shape === 'stadium' || n.shape === 'round' ? 'shape' : 'shape plain' }, g);
  }
  var BRACKETS = { rect: ['[', ']'], round: ['(', ')'], stadium: ['([', '])'], diamond: ['{', '}'], hexagon: ['{{', '}}'], circle: ['((', '))'], cylinder: ['[(', ')]'] };
  var OPS = { arrow: '-->', open: '---', dotted: '-.->', thick: '==>' };
  function clean(g) {  // the graph without what drawing adds, for saving, undo and comparing
    return { dir: g.dir, nodes: g.nodes.map(function (n) { return { id: n.id, label: n.label, shape: n.shape, colour: n.colour || '' }; }),
      edges: g.edges.map(function (e) { return { from: e.from, to: e.to, label: e.label, style: e.style }; }) };
  }
  function mermaid(g) {
    var text = function (s) { return '"' + s.replace(/"/g, '#quot;') + '"'; };
    return ['flowchart ' + g.dir].concat(
      g.nodes.map(function (n) { var b = BRACKETS[n.shape] || BRACKETS.rect; return '  ' + n.id + b[0] + text(n.label) + b[1]; }),
      g.edges.map(function (e) { return '  ' + e.from + ' ' + (OPS[e.style] || OPS.arrow) + (e.label ? '|' + text(e.label) + '|' : '') + ' ' + e.to; }),
      Object.keys(PALETTE).map(function (c) {
        var ids = g.nodes.filter(function (n) { return n.colour === c; }).map(function (n) { return n.id; });
        return ids.length ? '  classDef ' + c + ' fill:' + PALETTE[c][1] + ',stroke:' + PALETTE[c][0] + '\n  class ' + ids.join(',') + ' ' + c : '';
      }).filter(Boolean)
    ).join('\n');
  }
  document.querySelectorAll('figure.graph').forEach(function (fig) {
    var g = JSON.parse(fig.querySelector('.graph-data').textContent), svg = fig.querySelector('.scroll svg');
    var src = fig.querySelector('.graph-src').textContent, store = 'fig' + fig.dataset.fig;
    var start = layout(g), first = JSON.stringify(clean(g)), pos = JSON.parse(JSON.stringify(start));
    try {
      var kept = JSON.parse(load(store) || 'null');
      if (kept && kept.graph) { g = kept.graph; pos = kept.pos || {}; }
      else if (kept) Object.keys(kept).forEach(function (id) { if (pos[id]) pos[id] = kept[id]; });  // a page from before editing kept only places
    } catch (e) {}
    var tool = function (act) { return fig.querySelector('[data-act="' + act + '"]'); };
    var next = '';
    var hint = fig.querySelector('.hint'), help = hint.textContent, edited = fig.querySelector('.edited'), input = fig.querySelector('input.rename');
    var mid = 'arrow-' + fig.dataset.fig, byId = {}, nodes = {}, edges = [];
    var sel = null, linking = null, renaming = null, press = null, last = { at: 0 }, undo = [], redo = [];
    var against = null, ghostLayer = null, ghosts = [], counts = { added: 0, removed: 0, renamed: 0 };  // the compare view
    svg.setAttribute('tabindex', '-1');

    function snap() { return JSON.stringify({ g: clean(g), pos: pos }); }
    function persist() {
      var same = JSON.stringify(clean(g)) === first && JSON.stringify(pos) === JSON.stringify(start);
      save(store, same ? null : JSON.stringify({ graph: clean(g), pos: pos }));
    }
    function told(how) { if (fig.editor && fig.editor.onChange) fig.editor.onChange(how || 'hand'); }
    function change(fn, how) {  // every edit goes through here, so it can be undone
      var before = snap();
      fn();
      undo.push(before); if (undo.length > 100) undo.shift(); redo = [];
      build(); persist(); told(how);
    }
    function restore(from, to) {
      if (!from.length) return;
      to.push(snap());
      var s = JSON.parse(from.pop()); g = s.g; pos = s.pos;
      build(); persist(); told();
    }
    function exists(s) { return s && (s.node ? byId[s.node] : g.edges[s.edge]); }
    function select(s) {
      sel = exists(s) ? s : null;
      Object.keys(nodes).forEach(function (id) { nodes[id].classList.toggle('sel', !!sel && sel.node === id); nodes[id].classList.toggle('from', linking === id); });
      edges.forEach(function (d, i) { d.grp.classList.toggle('sel', !!sel && sel.edge === i); });
      tool('rename').disabled = tool('delete').disabled = !sel;
      tool('connect').disabled = tool('colour').disabled = !(sel && sel.node);
      tool('connect').setAttribute('aria-pressed', String(!!linking));
      tool('undo').disabled = !undo.length; tool('redo').disabled = !redo.length;
      edited.hidden = JSON.stringify(clean(g)) === first;
      hint.textContent = linking ? 'Click the box the new arrow goes to. Esc cancels.' : hint.dataset.help || help;
    }
    function build() {
      var had = fig.contains(document.activeElement);  // undo can remove the focused box: keep the keys in this figure
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      byId = {}; nodes = {}; edges = [];
      g.nodes.forEach(function (n) { measure(n); byId[n.id] = n; if (!pos[n.id]) pos[n.id] = spot(); });
      g.edges = g.edges.filter(function (e) { return byId[e.from] && byId[e.to]; });
      loops(g);
      var defs = el('defs', {}, svg);
      el('path', { d: 'M0 0L10 5L0 10z', fill: 'var(--line-strong)' }, el('marker', { id: mid, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs));
      var edgeLayer = el('g', {}, svg);
      ghostLayer = el('g', { 'aria-hidden': 'true' }, svg);
      var nodeLayer = el('g', {}, svg);
      var base = {}, baseEdges = {};
      if (against) { against.nodes.forEach(function (n) { base[n.id] = n; }); against.edges.forEach(function (e) { baseEdges[e.from + '>' + e.to] = true; }); }
      counts = { added: 0, removed: 0, renamed: 0 }; ghosts = [];
      g.edges.forEach(function (e, i) {
        var grp = el('g', { class: 'edge ' + e.style, 'data-i': i }, edgeLayer), hit = el('path', { class: 'hit' }, grp), path = el('path', {}, grp);
        if (e.style !== 'open') path.setAttribute('marker-end', 'url(#' + mid + ')');
        var box = null, text = null;
        if (e.label) { box = el('rect', { rx: 4 }, grp); text = el('text', { 'text-anchor': 'middle' }, grp); text.textContent = e.label; }
        edges.push({ e: e, grp: grp, hit: hit, path: path, box: box, text: text,
          twin: g.edges.some(function (o) { return o.from === e.to && o.to === e.from && o !== e; }) });
      });
      g.nodes.forEach(function (n) {
        var grp = el('g', { class: 'node' + (PALETTE[n.colour] ? ' c-' + n.colour : ''), tabindex: 0, role: 'button', 'data-id': n.id, 'aria-label': n.label + ' (drag to move, Enter to rename)' }, nodeLayer);
        shape(n, grp);
        n.lines.forEach(function (line, i) {
          var t = el('text', { 'text-anchor': 'middle', y: (i - (n.lines.length - 1) / 2) * 17 + 4.5 }, grp);
          t.textContent = line;
        });
        if (against && !base[n.id]) { grp.classList.add('diff-add'); counts.added++; }
        else if (against && base[n.id].label !== n.label) {
          grp.classList.add('diff-ren'); counts.renamed++;
          el('text', { 'text-anchor': 'middle', class: 'was', y: n.h / 2 + 15 }, grp).textContent = base[n.id].label;
        }
        nodes[n.id] = grp;
      });
      if (against) {
        edges.forEach(function (d) { if (!baseEdges[d.e.from + '>' + d.e.to]) { d.grp.classList.add('diff-add'); counts.added++; } });
        var here = {}; g.edges.forEach(function (e) { here[e.from + '>' + e.to] = true; });
        against.nodes.forEach(function (n) {
          if (byId[n.id]) return;
          counts.removed++;
          var m = { id: n.id, label: n.label, shape: n.shape }; measure(m);
          if (start[n.id]) ghosts.push({ node: m, at: start[n.id] });
        });
        against.edges.forEach(function (e) {
          if (here[e.from + '>' + e.to]) return;
          counts.removed++;
          var a = pos[e.from] && byId[e.from] ? pos[e.from] : start[e.from], b = pos[e.to] && byId[e.to] ? pos[e.to] : start[e.to];
          if (a && b) ghosts.push({ from: e.from, to: e.to });
        });
      }
      place();
      select(sel);
      if (sel && sel.node && had) nodes[sel.node].focus({ preventScroll: true });
      else if (had && !fig.contains(document.activeElement)) svg.focus({ preventScroll: true });
    }
    function spot() {  // a free place for a new box: beside the one selected, else below the rest
      var near = sel && sel.node && pos[sel.node], lr = g.dir === 'LR', p;
      if (near) p = lr ? { x: near.x + 200, y: near.y } : { x: near.x, y: near.y + 110 };
      else {
        var ys = Object.keys(pos).map(function (id) { return pos[id]; });
        p = ys.length ? { x: ys.reduce(function (s, q) { return s + q.x; }, 0) / ys.length, y: Math.max.apply(null, ys.map(function (q) { return q.y; })) + 110 } : { x: 0, y: 0 };
      }
      var taken = function (q) { return Object.keys(pos).some(function (id) { return Math.abs(pos[id].x - q.x) < 110 && Math.abs(pos[id].y - q.y) < 56; }); };
      for (var k = 0; k < 20 && taken(p); k++) p = lr ? { x: p.x, y: p.y + 70 } : { x: p.x + 140, y: p.y };
      return p;
    }
    function place(keepBox) {
      var extra = [];
      g.nodes.forEach(function (n) { nodes[n.id].setAttribute('transform', 'translate(' + pos[n.id].x + ' ' + pos[n.id].y + ')'); });
      edges.forEach(function (d) {
        var a = byId[d.e.from], b = byId[d.e.to], pa = pos[a.id], pb = pos[b.id], line;
        if (a === b) line = 'M' + (pa.x + a.w / 2) + ' ' + pa.y + 'c40 -40 40 40 0 12';
        else {
          var s = border(a, pa, pb), t = border(b, pb, pa), mx = (s.x + t.x) / 2, my = (s.y + t.y) / 2;
          var len = Math.hypot(t.x - s.x, t.y - s.y) || 1;
          var bend = d.twin ? 22 : d.e.back && len > 260 ? Math.min(140, 40 + len * 0.12) : 0;
          if (bend) {  // arrows both ways bend to their own sides; a long arrow back goes round, not through, the boxes
            var nx = -(t.y - s.y) / len * bend, ny = (t.x - s.x) / len * bend;
            line = 'M' + s.x + ' ' + s.y + 'Q' + (mx + 2 * nx) + ' ' + (my + 2 * ny) + ' ' + t.x + ' ' + t.y;
            mx += nx; my += ny; extra.push({ x: mx, y: my });
          } else line = 'M' + s.x + ' ' + s.y + 'L' + t.x + ' ' + t.y;
          if (d.text) {
            d.text.setAttribute('x', mx); d.text.setAttribute('y', my + 4);
            var w = d.e.label.length * 6.6 + 10;
            d.box.setAttribute('x', mx - w / 2); d.box.setAttribute('y', my - 9); d.box.setAttribute('width', w); d.box.setAttribute('height', 18);
          }
        }
        d.path.setAttribute('d', line); d.hit.setAttribute('d', line);
      });
      while (ghostLayer.firstChild) ghostLayer.removeChild(ghostLayer.firstChild);
      var at = function (id) { return byId[id] ? pos[id] : start[id]; };
      ghosts.forEach(function (gh) {
        if (gh.node) {
          var grp = el('g', { class: 'ghost', transform: 'translate(' + gh.at.x + ' ' + gh.at.y + ')' }, ghostLayer);
          shape(gh.node, grp);
          gh.node.lines.forEach(function (line, i) { el('text', { 'text-anchor': 'middle', y: (i - (gh.node.lines.length - 1) / 2) * 17 + 4.5 }, grp).textContent = line; });
        } else {
          var a = at(gh.from), b = at(gh.to);
          el('path', { d: 'M' + a.x + ' ' + a.y + 'L' + b.x + ' ' + b.y }, el('g', { class: 'edge ghost' }, ghostLayer));
        }
      });
      if (keepBox) return;
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      ghosts.forEach(function (gh) { if (gh.node) { var p = gh.at, n = gh.node; minX = Math.min(minX, p.x - n.w / 2); minY = Math.min(minY, p.y - n.h / 2); maxX = Math.max(maxX, p.x + n.w / 2); maxY = Math.max(maxY, p.y + n.h / 2); } });
      extra.forEach(function (p) { minX = Math.min(minX, p.x - 40); minY = Math.min(minY, p.y - 14); maxX = Math.max(maxX, p.x + 40); maxY = Math.max(maxY, p.y + 14); });
      g.nodes.forEach(function (n) { var p = pos[n.id]; minX = Math.min(minX, p.x - n.w / 2); minY = Math.min(minY, p.y - n.h / 2); maxX = Math.max(maxX, p.x + n.w / 2); maxY = Math.max(maxY, p.y + n.h / 2); });
      if (minX === Infinity) { minX = minY = 0; maxX = 200; maxY = 80; }
      svg.setAttribute('viewBox', [minX - 24, minY - 24, maxX - minX + 48, maxY - minY + 48].join(' '));
    }

    // editing: add, rename, connect, delete, undo, redo
    function add(shape, name, colour) {
      var k = g.nodes.length + 1;
      while (g.nodes.some(function (n) { return n.id === 'N' + k; })) k++;
      var id = 'N' + k;
      change(function () { pos[id] = spot(); g.nodes.push({ id: id, label: 'New ' + (name || 'box'), shape: shape || 'rect', colour: colour || '' }); sel = { node: id }; });
      rename();
    }
    function rename() {
      if (!exists(sel)) return;
      renaming = sel;
      input.hidden = false;
      input.value = sel.node ? byId[sel.node].label : g.edges[sel.edge].label;
      input.setAttribute('aria-label', sel.node ? 'Box name' : 'Arrow label');
      input.focus(); input.select();
    }
    function named(keep) {
      var target = renaming, value = input.value.replace(/\s+/g, ' ').trim();
      renaming = null; input.hidden = true;
      if (!keep || !exists(target)) return;
      if (target.node && value && value !== byId[target.node].label) change(function () { g.nodes.forEach(function (n) { if (n.id === target.node) n.label = value; }); });
      if (!target.node && value !== g.edges[target.edge].label) change(function () { g.edges[target.edge].label = value; });
      if (target.node && nodes[target.node]) nodes[target.node].focus({ preventScroll: true });
    }
    function remove() {
      if (!exists(sel)) return;
      var s = sel; sel = null;
      change(function () {
        if (s.node) { g.nodes = g.nodes.filter(function (n) { return n.id !== s.node; }); g.edges = g.edges.filter(function (e) { return e.from !== s.node && e.to !== s.node; }); delete pos[s.node]; }
        else g.edges.splice(s.edge, 1);
      });
      svg.focus({ preventScroll: true });
    }
    function connect(to) {
      var from = linking; linking = null;
      if (from === to) { select(sel); return; }
      if (g.edges.some(function (e) { return e.from === from && e.to === to; })) { toast('Those boxes are already joined'); select(sel); return; }
      change(function () { g.edges.push({ from: from, to: to, label: '', style: 'arrow' }); sel = { node: to }; });
    }
    function clicked(s) {
      var name = s.node ? 'n' + s.node : 'e' + s.edge, now = Date.now(), twice = last.name === name && now - last.at < 450;
      last = twice ? { at: 0 } : { name: name, at: now };
      if (linking && s.node) { connect(s.node); return; }
      linking = null; select(s);
      if (twice) rename();
    }

    var point = function (ev) { var m = svg.getScreenCTM(); return m ? new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse()) : { x: 0, y: 0 }; };
    svg.addEventListener('pointerdown', function (ev) {
      if (renaming) named(true);
      var hit = ev.target.closest && ev.target.closest('g.node, g.edge');
      ev.preventDefault();
      if (!hit) { linking = null; select(null); svg.focus({ preventScroll: true }); return; }
      if (hit.classList.contains('edge')) { clicked({ edge: +hit.dataset.i }); svg.focus({ preventScroll: true }); return; }
      var id = hit.dataset.id, p = point(ev);
      press = { id: id, dx: p.x - pos[id].x, dy: p.y - pos[id].y, x: ev.clientX, y: ev.clientY, moved: false, before: snap() };
      svg.setPointerCapture(ev.pointerId); hit.focus({ preventScroll: true });
    });
    svg.addEventListener('pointermove', function (ev) {
      if (!press || (!press.moved && Math.hypot(ev.clientX - press.x, ev.clientY - press.y) < 4)) return;
      press.moved = true; nodes[press.id].classList.add('dragging');
      var p = point(ev); pos[press.id] = { x: p.x - press.dx, y: p.y - press.dy }; place(true);
    });
    function drop() {
      if (!press) return;
      var done = press; press = null;
      if (!done.moved) { clicked({ node: done.id }); return; }
      nodes[done.id].classList.remove('dragging');
      undo.push(done.before); if (undo.length > 100) undo.shift(); redo = [];
      place(); persist(); select(sel); told();
    }
    svg.addEventListener('pointerup', drop);
    svg.addEventListener('pointercancel', drop);
    svg.addEventListener('focusin', function (ev) { var id = ev.target.dataset && ev.target.dataset.id; if (id && !press && !(sel && sel.node === id)) select({ node: id }); });
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { named(true); ev.preventDefault(); }
      else if (ev.key === 'Escape') { named(false); ev.preventDefault(); }
      ev.stopPropagation();
    });
    input.addEventListener('blur', function () { if (renaming) named(true); });
    fig.addEventListener('keydown', function (ev) {
      var mod = ev.ctrlKey || ev.metaKey, key = ev.key.toLowerCase();
      if (mod && key === 'z') { restore(ev.shiftKey ? redo : undo, ev.shiftKey ? undo : redo); ev.preventDefault(); return; }
      if (mod && key === 'y') { restore(redo, undo); ev.preventDefault(); return; }
      if (ev.target.tagName === 'BUTTON' && (ev.key === 'Enter' || ev.key === ' ')) return;
      if (ev.key === 'Escape') { linking = null; select(null); return; }
      if (ev.key === 'Delete' || ev.key === 'Backspace') { remove(); ev.preventDefault(); return; }
      if (ev.key === 'Enter' || ev.key === 'F2') { rename(); ev.preventDefault(); return; }
      var step = ev.shiftKey ? 32 : 8, d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[ev.key];
      if (!d || !(sel && sel.node)) return;
      var id = sel.node;
      change(function () { pos[id] = { x: pos[id].x + d[0], y: pos[id].y + d[1] }; });
      ev.preventDefault();
    });
    tool('add').addEventListener('click', function () { add(); });
    function dropdown(button, pick) {  // a menu under a toolbar button: arrow keys move, Esc closes
      var menu = button.parentNode.querySelector('.menu'), items = Array.prototype.slice.call(menu.querySelectorAll('button'));
      function open(on) {
        menu.hidden = !on; button.setAttribute('aria-expanded', String(on));
        if (on) (menu.querySelector('[data-colour][aria-checked="true"]') || items[0]).focus();
      }
      button.addEventListener('click', function () { if (menu.hidden) pick(null); open(menu.hidden); });
      items.forEach(function (item, i) {
        item.addEventListener('click', function () { if (pick(item) !== 'stay') { open(false); } });
        item.addEventListener('keydown', function (ev) {
          var to = { ArrowDown: i + 1, ArrowUp: i - 1, ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: items.length - 1 }[ev.key];
          if (to !== undefined) { items[(to + items.length) % items.length].focus(); ev.preventDefault(); }
          if (ev.key === 'Escape') { open(false); button.focus(); }
          if (ev.key !== 'Enter' && ev.key !== ' ') ev.stopPropagation();
        });
      });
      document.addEventListener('pointerdown', function (ev) { if (!menu.hidden && !button.parentNode.contains(ev.target)) open(false); });
      return items;
    }
    var nexts = dropdown(tool('shapes'), function (item) {
      if (!item) return;
      if (item.dataset.next === undefined) { add(item.dataset.shape, item.dataset.name, next); return; }
      next = item.dataset.next;
      nexts.forEach(function (b) { if (b.dataset.next !== undefined) b.setAttribute('aria-checked', String(b.dataset.next === next)); });
      return 'stay';
    });
    var paints = dropdown(tool('colour'), function (item) {
      var id = sel && sel.node, now = id && byId[id] ? byId[id].colour || '' : '';
      if (!item) { paints.forEach(function (b) { b.setAttribute('aria-checked', String(b.dataset.colour === now)); }); return; }
      if (id && item.dataset.colour !== now) change(function () { g.nodes.forEach(function (n) { if (n.id === id) n.colour = item.dataset.colour; }); });
      if (id && nodes[id]) nodes[id].focus({ preventScroll: true });
    });
    dropdown(tool('arrange'), function (item) {
      if (!item || !ARRANGE[item.dataset.arrange]) return;
      change(function () { pos = ARRANGE[item.dataset.arrange](g); });
      toast(item.querySelector('b').textContent + '. Undo puts the boxes back.');
      svg.focus({ preventScroll: true });
    });
    tool('rename').addEventListener('click', rename);
    tool('delete').addEventListener('click', remove);
    tool('connect').addEventListener('click', function () { linking = linking ? null : sel && sel.node; select(sel); });
    tool('undo').addEventListener('click', function () { restore(undo, redo); });
    tool('redo').addEventListener('click', function () { restore(redo, undo); });
    tool('reset').addEventListener('click', function () {
      change(function () { g = JSON.parse(first); pos = JSON.parse(JSON.stringify(start)); sel = null; linking = null; });
      toast('Back to the original. Undo brings your edits back.');
    });
    tool('copy').addEventListener('click', function () {
      var changed = JSON.stringify(clean(g)) !== first;
      var text = (changed ? mermaid(g) : src.replace(/\s+$/, '')) + '\n%% layout (feature-flow brainstorm page): ' +
        g.nodes.map(function (n) { return n.id + ' ' + Math.round(pos[n.id].x) + ',' + Math.round(pos[n.id].y); }).join('; ') + '\n';
      var done = function () { toast(changed ? 'Copied the edited diagram as mermaid' : 'Copied as mermaid'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { fallback(text); });
      else fallback(text);
    });
    function fallback(text) {
      var area = document.createElement('textarea'); area.value = text; area.setAttribute('aria-label', 'Mermaid source');
      area.style.position = 'fixed'; area.style.opacity = '0'; document.body.appendChild(area); area.select();
      try { document.execCommand('copy'); toast('Copied as mermaid'); } catch (e) { toast('Select the source below to copy it'); }
      area.remove();
    }
    fig.editor = {  // what the live page (brainstorm_live.py) works through
      get: function () { return { graph: clean(g), pos: JSON.parse(JSON.stringify(pos)) }; },
      load: function (graph, at, how) {
        change(function () {
          var keep = {};
          g = JSON.parse(JSON.stringify(graph)); g.nodes.forEach(function (n) { if (at && at[n.id]) keep[n.id] = at[n.id]; else if (pos[n.id]) keep[n.id] = pos[n.id]; else if (start[n.id]) keep[n.id] = start[n.id]; });
          pos = keep; sel = null; linking = null;
        }, how);
      },
      compare: function (base) { against = base ? clean(base) : null; build(); return counts; },
      onChange: null
    };
    build();
  });
  if (window.mermaid) { try { window.mermaid.initialize({ startOnLoad: true, theme: 'neutral' }); } catch (e) {} }
})();
