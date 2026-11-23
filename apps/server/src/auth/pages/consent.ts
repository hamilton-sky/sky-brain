// The consent page (spec.md Interfaces -> The pages, § UI). Served by routes.ts with
// `default-src 'self'`, so there is no inline script or style, and text is set only with
// textContent: the client name comes from a stranger's metadata document. It wears the entry
// page's look (D27): its stylesheet is /auth-pages/consent.css and a small star brain sits
// above the card.
import { brainScript } from "./brain-script.ts";
import { themeScript } from "./theme-script.ts";
import { style } from "./consent-style.ts";

export const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Allow access - sky-brain</title>
    <link rel="stylesheet" href="/auth-pages/consent.css" />
  </head>
  <body>
    <main class="wrap consent">
      <span class="wordmark">sky<span class="dash">-</span>brain</span>
      <canvas data-brain aria-hidden="true"></canvas>
      <section class="card" aria-labelledby="ask">
        <h1 id="ask">
          <span id="client-name" class="app">An app</span> wants to use your sky-brain
        </h1>
        <dl class="facts">
          <div><dt>Signed in as</dt><dd id="email">you</dd></div>
          <div><dt>Returns you to</dt><dd id="redirect-host"></dd></div>
          <div><dt>Access</dt><dd id="scopes"></dd></div>
        </dl>
        <div class="actions">
          <button type="button" id="deny" class="btn btn-ghost">Deny</button>
          <button type="button" id="allow" class="btn btn-primary">Allow</button>
        </div>
        <p id="status" role="status"></p>
        <p class="fine">Allow only apps you trust. They will use sky-brain as you, with the access above.</p>
      </section>
    </main>
    <script src="/auth-pages/consent.js" defer></script>
  </body>
</html>
`;

const consentScript = `"use strict";
(function () {
  var params = new URLSearchParams(location.search);
  var clientId = params.get("client_id") || "";
  var allow = document.getElementById("allow");
  var deny = document.getElementById("deny");
  var status = document.getElementById("status");

  // The host comes from this page's own signed query, never from the client's metadata.
  var host = "";
  try {
    host = new URL(params.get("redirect_uri") || "").host;
  } catch (e) {
    host = "";
  }
  if (host) {
    document.getElementById("redirect-host").textContent = host;
  } else {
    document.getElementById("redirect-host").textContent = "an unknown address";
    allow.disabled = true;
  }

  var scopes = (params.get("scope") || "").split(" ").filter(function (s) {
    return s.indexOf("brain:") === 0;
  }).map(function (s) {
    return s.slice("brain:".length);
  });
  document.getElementById("scopes").textContent =
    scopes.length ? scopes.join(", ") : "your sign-in only";

  function getJson(path) {
    return fetch(path, { credentials: "same-origin" }).then(function (res) {
      if (!res.ok) throw new Error("request failed");
      return res.json();
    });
  }

  getJson("/api/auth/oauth2/public-client?client_id=" + encodeURIComponent(clientId))
    .then(function (client) {
      if (client && typeof client.client_name === "string" && client.client_name) {
        document.getElementById("client-name").textContent = client.client_name;
      }
    })
    .catch(function () {
      document.getElementById("client-name").textContent = "An app";
    });

  getJson("/api/auth/get-session")
    .then(function (session) {
      if (session && session.user && typeof session.user.email === "string") {
        document.getElementById("email").textContent = session.user.email;
      }
    })
    .catch(function () {
      status.textContent = "You may not be signed in. Start again from your app.";
    });

  function answer(accept) {
    allow.disabled = true;
    deny.disabled = true;
    status.textContent = "";
    fetch("/api/auth/oauth2/consent", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accept: accept, oauth_query: location.search.slice(1) })
    })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok || !body || typeof body.url !== "string") {
            throw new Error("consent failed");
          }
          location.assign(body.url);
        });
      })
      .catch(function () {
        status.textContent = "That did not work. Start again from your app.";
        allow.disabled = !host;
        deny.disabled = false;
      });
  }

  allow.addEventListener("click", function () {
    answer(true);
  });
  deny.addEventListener("click", function () {
    answer(false);
  });
})();
`;

export { style };
// The small star brain above the card comes first, so the page keeps a single script.
export const script = [themeScript, brainScript, consentScript].join("\n");
