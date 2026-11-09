// The sign-in page (spec.md Interfaces -> The pages, § UI). Served by routes.ts with
// `default-src 'self'`, so there is no inline script or style, and text is set only with
// textContent.
export const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sign in - sky-brain</title>
  </head>
  <body>
    <main>
      <h1>sky-brain</h1>
      <section id="sign-in">
        <p>Sign in to continue to Claude.</p>
        <button type="button" id="perminister">Sign in with Perminister</button>
        <p id="status" role="status"></p>
      </section>
      <section id="no-access" hidden>
        <h2>No access</h2>
        <p>
          This account has no access to sky-brain. Ask the owner for an
          invitation in Perminister.
        </p>
        <button type="button" id="try-another">Try another account</button>
      </section>
    </main>
    <script src="/auth-pages/sign-in.js" defer></script>
  </body>
</html>
`;

export const script = `"use strict";
(function () {
  var params = new URLSearchParams(location.search);
  var signIn = document.getElementById("sign-in");
  var button = document.getElementById("perminister");
  var status = document.getElementById("status");
  var noAccess = document.getElementById("no-access");
  var tryAnother = document.getElementById("try-another");

  // Any error Better Auth sends back (no_access, email_not_found, invalid_code, ...) means
  // this account got no session here.
  if (params.has("error")) {
    noAccess.hidden = false;
    signIn.hidden = true;
  }

  tryAnother.addEventListener("click", function () {
    params.delete("error");
    params.delete("error_description");
    var rest = params.toString();
    location.assign("/sign-in" + (rest ? "?" + rest : ""));
  });

  button.addEventListener("click", function () {
    button.disabled = true;
    status.textContent = "";
    var body = {
      provider: "perminister",
      callbackURL: "/",
      errorCallbackURL: "/sign-in"
    };
    var oauthQuery = location.search.slice(1);
    if (oauthQuery) body.oauth_query = oauthQuery;
    fetch("/api/auth/sign-in/social", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    })
      .then(function (res) {
        return res.json().then(function (answer) {
          if (!res.ok || !answer || typeof answer.url !== "string") {
            throw new Error("sign-in did not start");
          }
          location.assign(answer.url);
        });
      })
      .catch(function () {
        status.textContent = "Sign-in could not start. Try again.";
        button.disabled = false;
      });
  });
})();
`;
