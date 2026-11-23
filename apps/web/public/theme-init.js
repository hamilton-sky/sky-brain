// Applies the theme the person picked (light, dark or system) before the app paints. It is a
// file, not an inline script, so a strict Content-Security-Policy can allow it. The key is the
// one the app's ThemeProvider and the sign-in and consent pages read: "sky-brain-theme".
(function () {
  try {
    var t = localStorage.getItem("sky-brain-theme");
    if (t === "light" || t === "dark" || t === "system")
      document.documentElement.dataset.theme = t;
  } catch (e) {
    // Private windows may refuse storage; the device setting decides.
  }
})();
