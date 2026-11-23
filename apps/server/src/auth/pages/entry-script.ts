// The entry page's memory rings: pointing at a ring lights up its part of the brain, clicking
// it scrolls to that part's explanation. Part of /auth-pages/sign-in.js.
export const entryScript = `"use strict";
(function () {
  var IDS = { core: "about-me", work: "board", short: "inbox", long: "notebooks" };
  var NAMES = { core: "About me", work: "Board", short: "Inbox", long: "Notebooks" };
  var ORDER = ["core", "work", "short", "long"];
  var brains = [document.getElementById("brain")];
  var chips = document.querySelectorAll(".chip-link");
  var layers = document.querySelectorAll(".stack .layer");
  var auto = true, i = 0;
  function show(r) {
    brains.forEach(function (c) { if (c && c.skyBrain) c.skyBrain.highlight(r); });
    chips.forEach(function (c) { c.classList.toggle("on", c.getAttribute("data-layer") === r); });
    layers.forEach(function (g) { g.classList.toggle("on", g.getAttribute("data-layer") === r); });
  }
  function go(r) {
    auto = false;
    var el = document.getElementById(IDS[r]);
    if (!el) return;
    el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    el.classList.add("flash");
    setTimeout(function () { el.classList.remove("flash"); }, 1600);
  }
  brains.forEach(function (c) {
    if (!c) return;
    c.addEventListener("brain:hover", function (e) { auto = false; show(e.detail); });
  });
  chips.forEach(function (c) {
    var r = c.getAttribute("data-layer");
    c.addEventListener("mouseenter", function () { auto = false; show(r); });
    c.addEventListener("focus", function () { auto = false; show(r); });
    c.addEventListener("mouseleave", function () { show(null); });
    c.addEventListener("blur", function () { show(null); });
  });
  layers.forEach(function (g) {
    var r = g.getAttribute("data-layer");
    g.addEventListener("mouseenter", function () { auto = false; show(r); });
    g.addEventListener("focus", function () { auto = false; show(r); });
    g.addEventListener("click", function () { show(r); go(r); });
    g.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); show(r); go(r); } });
  });
  // Until someone interacts, gently point out each part in turn.
  setTimeout(function tick() {
    if (!auto) return;
    show(ORDER[i % 4]); i++;
    setTimeout(tick, 2600);
  }, 2600);
})();
`;
