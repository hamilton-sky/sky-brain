(function () {  // the steps are tabs: one shows at a time, and a link into another step opens its tab
  var tabs = [].slice.call(document.querySelectorAll('.tabs [role=tab]'));
  if (!tabs.length) return;
  function show(tab, focus) {
    tabs.forEach(function (t) {
      var on = t === tab, panel = document.getElementById(t.getAttribute('aria-controls'));
      t.setAttribute('aria-selected', String(on));
      if (on) t.removeAttribute('tabindex'); else t.setAttribute('tabindex', '-1');
      if (panel) panel.hidden = !on;
    });
    if (focus) tab.focus();
  }
  tabs.forEach(function (tab, i) {
    tab.addEventListener('click', function () { show(tab); });
    tab.addEventListener('keydown', function (ev) {
      var to = ev.key === 'ArrowRight' ? i + 1 : ev.key === 'ArrowLeft' ? i - 1 : ev.key === 'Home' ? 0 : ev.key === 'End' ? tabs.length - 1 : null;
      if (to === null) return;
      ev.preventDefault();
      show(tabs[(to + tabs.length) % tabs.length], true);
    });
  });
  function open(hash) {
    var target = hash && document.getElementById(hash.slice(1));
    var panel = target && target.closest && target.closest('[role=tabpanel]');
    if (!panel || !panel.hidden) return;
    var tab = document.getElementById(panel.getAttribute('aria-labelledby'));
    if (tab) { show(tab); target.scrollIntoView(); }
  }
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest && ev.target.closest('a[href^="#"]');
    if (a) setTimeout(function () { open(a.getAttribute('href')); }, 0);
  });
  window.forkboardShowStep = function (name) {  // the live layer opens the next step's tab after an approve
    var panel = document.querySelector('[role=tabpanel][data-step="' + (window.CSS && CSS.escape ? CSS.escape(name) : name) + '"]');
    var tab = panel && document.getElementById(panel.getAttribute('aria-labelledby'));
    if (tab) show(tab);
  };
  open(location.hash);
})();
