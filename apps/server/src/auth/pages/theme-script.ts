// Applies the theme the person picked in the web app (light, dark or system), saved in this
// origin's localStorage as "sky-brain-theme", so the sign-in and consent pages match it. It is
// the first part of each page's single same-origin script.
export const themeScript = `"use strict";
(function () {
  try {
    var t = localStorage.getItem("sky-brain-theme");
    if (t === "light" || t === "dark" || t === "system") document.documentElement.setAttribute("data-theme", t);
  } catch (e) {
    // Storage may be refused; the device setting decides.
  }
})();
`;
