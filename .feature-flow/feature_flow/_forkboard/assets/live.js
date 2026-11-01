
(function () {
  var wrap = document.querySelector('.wrap');
  if (!wrap || !wrap.dataset.live || !window.claude || !window.claude.use) return;
  var STASH = 'brainstorm-live:' + wrap.dataset.page;
  var main = document.querySelector('main'), panel = document.createElement('section');
  panel.className = 'live-panel'; panel.id = 'talk'; panel.hidden = true;
  main.insertBefore(panel, main.children[1] || null);
  function toast(text) {
    var t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = text;
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2400);
  }
  function make(tag, attrs, text) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) e.setAttribute(k, attrs[k]);
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function hash(text) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (b) {
      return Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    });
  }
  var use = function (name) { return window.claude.use(name).catch(function () { return null; }); };
  Promise.all([fetch('state.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.text() : null; }).catch(function () { return null; }),
               use('artifact'), use('user'), use('sample')]).then(function (got) {
    if (!got[0] || !got[1]) return;
    var text = got[0], artifact = got[1], user = got[2], sample = got[3], st;
    try { st = JSON.parse(text); } catch (e) { return; }
    st.figures = st.figures || {}; st.asks = st.asks || [];
    hash(text).then(function (sha) { (user ? user.id() : Promise.resolve(null)).then(function (me) { start(st, sha, artifact, user, sample, me); }); });
  });

  function start(st, sha, artifact, user, sample, me) {
    var writable = !!me, figs = [];
    function names(ids) {
      return user ? user.profiles(ids).then(function (ps) { var o = {}; ids.forEach(function (id) { o[id] = id === me ? 'You' : (ps[id] && ps[id].name) || 'Someone'; }); return o; })
                  : Promise.resolve(ids.reduce(function (o, id) { o[id] = id === me ? 'You' : 'Someone'; return o; }, {}));
    }
    function save(change, done) {  // change the state and publish it; a clash with someone else's save reloads and tries once more
      try {  // kept across the reload a clash causes; a private window may refuse it, and then a clash loses the change
        var pending = JSON.parse(sessionStorage.getItem(STASH) || '[]'); pending.push(change);
        sessionStorage.setItem(STASH, JSON.stringify(pending));
      } catch (e) {}
      var next = JSON.parse(JSON.stringify(st));  // the page's state changes only once the save lands
      merge(next, change);
      var body = JSON.stringify(next, null, 1) + '\n';
      artifact.publish({ 'state.json': { content: body, contentType: 'application/json', ifMatch: sha } }).then(function (res) {
        try { sessionStorage.removeItem(STASH); } catch (e) {}
        merge(st, change);
        sha = res && res.shas && res.shas['state.json'];
        if (!sha) hash(body).then(function (h) { sha = h; });
        render().then(function () { if (done) done(); });
      }, function (e) {
        var code = e && e.code;
        if (code === 'conflict') {  // this view still holds the old state.json: load the new one, then the stash saves the change again
          toast('Someone saved at the same moment. Reloading, then your change is saved again.');
          setTimeout(function () { location.reload(); }, 1200);
          return;
        }
        try { sessionStorage.removeItem(STASH); } catch (x) {}
        if (code === 'not_writer' || code === 'not_granted' || code === 'capability_disabled' || code === 'consent_required') { writable = false; toast('This view is read only: ask the owner for edit access to save.'); render(); }
        else toast('Could not save (' + (code || 'error') + '). Try again in a moment.');
      });
    }
    function merge(s, change) {
      if (change.version) {
        var f = s.figures[change.version.figure]; if (!f) return;
        f.versions = f.versions || {}; f.versions[change.version.by] = change.version.entry;
      }
      if (change.ask) s.asks.push(change.ask);
      if (change.pick) { s.picks = s.picks || {}; s.picks[change.pick.key] = change.pick.entry; }
    }
    // a change saved just before a reload (a clash) is saved again now
    try {
      var left = JSON.parse(sessionStorage.getItem(STASH) || '[]');
      sessionStorage.removeItem(STASH);
      if (left.length && writable) left.forEach(function (c, i) { if (i === left.length - 1) save(c); else merge(st, c); });
    } catch (e) {}

    document.querySelectorAll('figure.graph').forEach(function (fig) {
      var key = fig.dataset.fig, f = st.figures[key], ed = fig.editor;
      if (!f || !ed) return;
      var bar = make('div', { class: 'live-bar' }), pick = make('select', { 'aria-label': 'Version' });
      var cmp = make('input', { type: 'checkbox' }), saveBtn = make('button', { type: 'button', class: 'go' }, 'Save as my version');
      var askBtn = make('button', { type: 'button' }, 'Ask Claude to change it'), sum = make('span', { class: 'diff-sum' }), said = make('span', { class: 'said' });
      var cmpLabel = make('label'); cmpLabel.appendChild(cmp); cmpLabel.appendChild(document.createTextNode('Compare with original'));
      bar.appendChild(make('span', {}, 'Version')); bar.appendChild(pick); bar.appendChild(cmpLabel); bar.appendChild(saveBtn);
      if (sample) bar.appendChild(askBtn);
      bar.appendChild(sum); bar.appendChild(said); said.hidden = true;
      fig.insertBefore(bar, fig.querySelector('.scroll'));
      var hint = fig.querySelector('.hint');
      if (hint) hint.dataset.help = hint.textContent = 'Drag to move. Double-click to rename, Delete to remove, Connect to add an arrow, Ctrl+Z to undo. Save as my version shares your diagram with everyone on this page.';
      var via = [];  // how the diagram on screen came about since it was loaded: by hand, by Claude, or both
      ed.onChange = function (how) { if (via.indexOf(how) < 0) via.push(how); diff(); };
      function diff() {
        if (!cmp.checked) { ed.compare(null); sum.textContent = ''; return; }
        var d = ed.compare(f.original);
        sum.textContent = d.added + ' added, ' + d.removed + ' removed, ' + d.renamed + ' renamed';
      }
      cmp.addEventListener('change', diff);
      pick.addEventListener('change', function () {
        var v = pick.value === 'original' ? { graph: f.original, pos: null } : f.versions[pick.value];
        if (v) { ed.load(v.graph, v.pos); via = []; diff(); }
      });
      saveBtn.addEventListener('click', function () {
        if (!writable) return;
        var now = ed.get();
        save({ version: { figure: key, by: me, entry: { graph: now.graph, pos: now.pos, at: new Date().toISOString(), via: via.length ? via.slice() : ['hand'] } } },
             function () { toast('Saved as your version'); pick.value = me; });
      });
      askBtn.addEventListener('click', function () {
        var box = bar.querySelector('input[type=text]');
        if (box) { box.focus(); return; }
        box = make('input', { type: 'text', placeholder: 'What should change? For example: add a cache before the database', 'aria-label': 'Ask Claude to change this diagram' });
        var go = make('button', { type: 'button', class: 'go' }, 'Ask');
        bar.insertBefore(box, said); bar.insertBefore(go, said);
        box.focus();
        function ask() {
          var want = box.value.trim(); if (!want) return;
          go.disabled = true; go.textContent = 'Thinking...';
          var now = ed.get().graph;
          sample.json('You edit one flowchart in a design review. The flowchart as JSON:\n' + JSON.stringify(now) +
            '\n\nThe change the reviewer wants: ' + want +
            '\n\nReply with only JSON: {"graph": the whole changed flowchart in the same shape, "reply": one or two sentences on what you changed and why}. ' +
            'Keep the ids of boxes you keep; new ids are short letters and digits. shape is one of rect, round, stadium, diamond, hexagon, circle, cylinder. ' +
            'colour is "" or one of ' + Object.keys(PALETTE).join(', ') + '. style is one of arrow, open, dotted, thick. dir stays "' + now.dir + '".',
            { modelTier: 'default' }).then(function (out) {
            var g = out && out.graph;
            if (!g || !Array.isArray(g.nodes) || !Array.isArray(g.edges)) throw { code: 'invalid_json' };
            var ident = function (x) { return String(x).replace(/[^\w-]/g, ''); }, ids = {};
            var boxes = g.nodes.filter(function (n) { return n && ident(n.id) && !ids[ident(n.id)] && (ids[ident(n.id)] = true); }).map(function (n) { return { id: ident(n.id), label: String(n.label || n.id), shape: n.shape in { rect: 1, round: 1, stadium: 1, diamond: 1, hexagon: 1, circle: 1, cylinder: 1 } ? n.shape : 'rect', colour: PALETTE[n.colour] ? n.colour : '' }; });
            var arrows = g.edges.filter(function (e) { return e && ids[ident(e.from)] && ids[ident(e.to)]; }).map(function (e) { return { from: ident(e.from), to: ident(e.to), label: String(e.label || ''), style: { arrow: 1, open: 1, dotted: 1, thick: 1 }[e.style] ? e.style : 'arrow' }; });
            if (!boxes.length) throw { code: 'invalid_json' };
            ed.load({ dir: now.dir, nodes: boxes, edges: arrows }, null, 'claude');
            said.hidden = false; said.textContent = 'Claude: ' + String(out.reply || 'Done.') + ' Undo takes it back; Save as my version keeps it.';
            box.value = '';
          }).catch(function (e) {
            said.hidden = false;
            said.textContent = e && e.code === 'rate_limited' ? 'Claude is busy: try again in a minute.' : e && e.code === 'not_granted' ? 'Asking Claude is not allowed in this view.' : 'Claude could not change it this time. Try saying it another way.';
          }).then(function () { go.disabled = false; go.textContent = 'Ask'; });
        }
        go.addEventListener('click', ask);
        box.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ask(); ev.preventDefault(); } ev.stopPropagation(); });
      });
      figs.push({ key: key, f: f, pick: pick, save: saveBtn });
    });

    var sets = [];  // the document's choices: what people pick is saved into the page's state for the session
    document.querySelectorAll('fieldset.choice').forEach(function (set) {
      var key = set.dataset.key, kind = set.dataset.kind, top = set.dataset.max ? Number(set.dataset.max) : null;
      var buttons = [].slice.call(set.querySelectorAll('button[data-value]')), boxes = [].slice.call(set.querySelectorAll('input[type=checkbox]'));
      function show(v) {
        if (kind === 'some') boxes.forEach(function (b) { b.checked = Array.isArray(v) && v.indexOf(b.value) >= 0; });
        else buttons.forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.value === v)); });
      }
      function limit() {
        var n = boxes.filter(function (b) { return b.checked; }).length;
        boxes.forEach(function (b) { b.disabled = !writable || (top !== null && !b.checked && n >= top); });
        buttons.forEach(function (b) { b.disabled = !writable; });
      }
      function pick(value, label) {
        save({ pick: { key: key, entry: { by: me, at: new Date().toISOString(), value: value } } },
             function () { toast('Saved: ' + label + '. Claude reads it when its session picks it up.'); });
      }
      buttons.forEach(function (b) {
        b.addEventListener('click', function () { if (writable) { show(b.dataset.value); pick(b.dataset.value, b.textContent); } });
      });
      boxes.forEach(function (b) {
        b.addEventListener('change', function () {
          if (!writable) return;
          limit();
          pick(boxes.filter(function (x) { return x.checked; }).map(function (x) { return x.value; }), (set.querySelector('legend') || {}).textContent || key);
        });
      });
      sets.push({ key: key, show: show, limit: limit });
    });
    var changes = [].slice.call(document.querySelectorAll('button.change[data-change]'));
    changes.forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!writable) return;
        btn.disabled = true;
        save({ ask: { by: me, at: new Date().toISOString(), figure: null, version: null, step: btn.dataset.change, text: 'Change the step ' + btn.dataset.change } },
             function () { toast('Sent. Claude reopens ' + btn.dataset.change + ' when its session picks it up.'); btn.disabled = false; });
      });
    });

    function render() {
      sets.forEach(function (x) { var p = st.picks && st.picks[x.key]; if (p) x.show(p.value); x.limit(); });
      changes.forEach(function (btn) { btn.hidden = !writable; });
      document.querySelectorAll('.choice-hint').forEach(function (h) {
        h.textContent = writable ? 'What you pick here is saved to this page, and Claude reads it. You can also answer in the chat.' : 'Reply ok in the chat to take these, or say what to change.';
      });
      var ids = [];
      figs.forEach(function (x) { Object.keys(x.f.versions || {}).forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); }); });
      st.asks.forEach(function (a) { if (a.by && ids.indexOf(a.by) < 0) ids.push(a.by); });
      if (me && ids.indexOf(me) < 0) ids.push(me);
      return names(ids).then(function (who) {
        figs.forEach(function (x) {
          var was = x.pick.value;
          while (x.pick.firstChild) x.pick.removeChild(x.pick.firstChild);
          x.pick.appendChild(make('option', { value: 'original' }, 'Original'));
          Object.keys(x.f.versions || {}).forEach(function (id) {
            var v = x.f.versions[id];
            x.pick.appendChild(make('option', { value: id }, (who[id] || 'Someone') + (id === me ? 'r version' : "'s version") + ((v.via || []).indexOf('claude') >= 0 ? ' (with Claude)' : '')));
          });
          x.pick.value = was && (was === 'original' || x.f.versions[was]) ? was : 'original';
          x.save.disabled = !writable;
          x.save.title = writable ? '' : 'Ask the owner for edit access to save';
        });
        while (panel.firstChild) panel.removeChild(panel.firstChild);
        panel.hidden = false;
        panel.appendChild(make('h2', {}, 'Talk to Claude'));
        panel.appendChild(make('p', { class: 'who' }, 'Questions and change requests for the Claude session that made this page. It answers here and may update the diagrams; your saved versions stay.'));
        var list = make('ol');
        st.asks.forEach(function (a) {
          var li = make('li', { class: a.answer ? 'answered' : '' });
          var fig = a.figure && st.figures[a.figure];
          li.appendChild(make('span', { class: 'who' }, (who[a.by] || 'Someone') + (fig ? ' on "' + (fig.title || 'figure ' + a.figure) + '"' : '') + (a.version ? ', with ' + (a.version === me ? 'your' : 'their') + ' version' : '')));
          li.appendChild(make('span', {}, a.text));
          li.appendChild(a.answer ? make('span', { class: 'reply' }, 'Claude: ' + a.answer) : make('span', { class: 'who' }, 'Waiting for Claude'));
          list.appendChild(li);
        });
        if (st.asks.length) panel.appendChild(list);
        if (!writable) { panel.appendChild(make('p', { class: 'live-note' }, 'You can read this page. To save versions or ask Claude, the owner needs to give you edit access.')); return; }
        var form = make('form'), area = make('textarea', { 'aria-label': 'Your question or request', placeholder: 'For example: B looks too big for a first version. What would you cut?' });
        var row = make('div', { class: 'row' }), about = make('select', { 'aria-label': 'About' }), send = make('button', { type: 'submit', class: 'go' }, 'Send to Claude');
        about.appendChild(make('option', { value: '' }, 'About the whole page'));
        figs.forEach(function (x) { about.appendChild(make('option', { value: x.key }, 'About: ' + (x.f.title || 'figure ' + x.key) + (x.f.versions[me] ? ' (with my version)' : ''))); });
        row.appendChild(about); row.appendChild(send);
        form.appendChild(area); form.appendChild(row); panel.appendChild(form);
        form.addEventListener('submit', function (ev) {
          ev.preventDefault();
          var text = area.value.trim(); if (!text) { area.focus(); return; }
          var key = about.value, fig = key && st.figures[key];
          send.disabled = true;
          save({ ask: { by: me, at: new Date().toISOString(), figure: key || null, version: fig && fig.versions[me] ? me : null, text: text } },
               function () { toast('Sent. Claude answers here when its session picks it up.'); });
        });
      });
    }
    render();
  }
})();
