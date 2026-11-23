// Applies the theme the person picked (light, dark or system) before the app paints. It is a
// file, not an inline script, so a strict Content-Security-Policy can allow it. The key is the
// one the app's ThemeProvider and the sign-in and consent pages read: "sky-brain-theme".
/* global document, matchMedia */
(function () {
  try {
    var t = localStorage.getItem("sky-brain-theme");
    if (t !== "light" && t !== "dark") {
      t = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    document.documentElement.dataset.theme = t;
  } catch {
    document.documentElement.dataset.theme = matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches
      ? "dark"
      : "light";
  }
})();
