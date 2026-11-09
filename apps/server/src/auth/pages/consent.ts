// The consent page (spec.md Interfaces -> The pages, § UI). Served by routes.ts with
// `default-src 'self'`, so there is no inline script or style, and text is set only with
// textContent: the client name comes from a stranger's metadata document.
export const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Allow access - sky-brain</title>
  </head>
  <body>
    <main>
      <h1>sky-brain</h1>
      <p>
        <span id="client-name">An app</span> wants to use sky-brain as
        <span id="email">you</span>.
      </p>
      <p>It will return you to: <strong id="redirect-host"></strong></p>
      <p>Access: <span id="scopes"></span></p>
      <button type="button" id="allow">Allow</button>
      <button type="button" id="deny">Deny</button>
      <p id="status" role="status"></p>
    </main>
    <script src="/auth-pages/consent.js" defer></script>
  </body>
</html>
`;

export const script = `"use strict";
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
