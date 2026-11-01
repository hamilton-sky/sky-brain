
(function () {  // a link into a folded step opens it, so the section it names can be read
  function open(hash) {
    var target = hash && document.getElementById(hash.slice(1));
    var fold = target && target.closest && target.closest('details.step-body');
    if (fold && !fold.open) { fold.open = true; target.scrollIntoView(); }
  }
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest && ev.target.closest('a[href^="#"]');
    if (a) setTimeout(function () { open(a.getAttribute('href')); }, 0);
  });
  open(location.hash);
})();
