// The sign-in page (spec.md Interfaces -> The pages, § UI), which is also sky-brain's entry
// page: the 3D star brain, the sign-in button, and the four memory layers as rings with an
// explanation of each (D27). Served by routes.ts with `default-src 'self'`, so there is no
// inline script or style (the stylesheet is /auth-pages/sign-in.css), and text is set only
// with textContent.
import { brainScript } from "./brain-script.ts";
import { themeScript } from "./theme-script.ts";
import { entryScript } from "./entry-script.ts";
import { style } from "./sign-in-style.ts";
export const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sign in - sky-brain</title>
    <link rel="stylesheet" href="/auth-pages/sign-in.css" />
  </head>
  <body>
<div class="wrap">
  <nav class="nav" aria-label="Main">
    <a class="wordmark" href="#top">sky<span class="dash">-</span>brain</a>
    <a class="btn btn-ghost btn-sm" href="#top">Sign in</a>
  </nav>

  <header class="hero" id="top">
    <canvas id="brain" data-brain data-regions="on" role="img" aria-label="A turning brain made of stars, coloured by memory layer: About me at the centre, Board at the front, Inbox deep inside, Notebooks across the rest"></canvas>
    <div class="legend" role="group" aria-label="Parts of the brain">
      <span class="chip-link core" data-layer="core" tabindex="0"><span class="sw core"></span>About me</span>
      <span class="chip-link work" data-layer="work" tabindex="0"><span class="sw work"></span>Board</span>
      <span class="chip-link short" data-layer="short" tabindex="0"><span class="sw short"></span>Inbox</span>
      <span class="chip-link long" data-layer="long" tabindex="0"><span class="sw long"></span>Notebooks</span>
    </div>
    <h1>One brain for you and every AI you work with</h1>
    <p class="lede">sky-brain keeps what matters to you in four parts of memory, like your own brain. Claude, Codex and your other agents read from it and propose what to remember. You decide what stays.</p>
    <section id="sign-in" class="signin">
      <div class="ctas">
        <button type="button" id="perminister" class="btn btn-primary btn-star">Sign in with Perminister</button>
        <a class="btn btn-ghost" href="#layers">See how it works</a>
      </div>
      <p id="status" role="status"></p>
      <p class="fine">Invite-only. Access is managed in Perminister.</p>
    </section>
    <section id="no-access" class="signin noaccess" hidden>
      <h2>No access</h2>
      <p class="muted">This account has no access to sky-brain. Ask the owner for an invitation in Perminister.</p>
      <button type="button" id="try-another" class="btn btn-ghost">Try another account</button>
    </section>
  </header>

  <section class="block" id="layers" aria-labelledby="layers-h">
    <div class="block-head">
      <p class="eyebrow">Four parts, like your own brain</p>
      <h2 id="layers-h">Memory that works like yours</h2>
      <p class="muted">Like a person, sky-brain keeps a small core that never changes, a desk for today's work, an inbox of fresh notes, and notebooks of things worth keeping. Point at a ring to light up its part of the brain above, and click it to read about it.</p>
    </div>
    <div class="layers-grid">
      <svg class="stack rings" viewBox="0 0 400 224" role="group" aria-label="The four memory layers as rings: About me in the centre, then Board, Inbox and Notebooks">
        <defs><radialGradient id="core-glow"><stop offset="0" class="cg-in"/><stop offset="1" class="cg-out"/></radialGradient></defs>
        <g class="layer long" data-layer="long" tabindex="0" role="button" aria-label="Notebooks, long-term memory"><g class="g">
        <path class="plane" fill-rule="evenodd" d="M8,112 a192,96.0 0 1,0 384,0 a192,96.0 0 1,0 -384,0 Z M64,112 a136,68.0 0 1,0 272,0 a136,68.0 0 1,0 -272,0 Z"/>
        <text class="lbl" x="200" y="198.5" text-anchor="middle">Notebooks</text>
        <text class="lbl-sub" x="200" y="34.0" text-anchor="middle">long-term</text>
        </g></g>
        <g class="layer short" data-layer="short" tabindex="0" role="button" aria-label="Inbox, short-term memory"><g class="g">
        <path class="plane" fill-rule="evenodd" d="M64,112 a136,68.0 0 1,0 272,0 a136,68.0 0 1,0 -272,0 Z M112,112 a88,44.0 0 1,0 176,0 a88,44.0 0 1,0 -176,0 Z"/>
        <text class="lbl" x="200" y="172.5" text-anchor="middle">Inbox</text>
        <text class="lbl-sub" x="200" y="60.0" text-anchor="middle">short-term</text>
        </g></g>
        <g class="layer work" data-layer="work" tabindex="0" role="button" aria-label="Board, working memory"><g class="g">
        <path class="plane" fill-rule="evenodd" d="M112,112 a88,44.0 0 1,0 176,0 a88,44.0 0 1,0 -176,0 Z M158,112 a42,21.0 0 1,0 84,0 a42,21.0 0 1,0 -84,0 Z"/>
        <text class="lbl" x="200" y="149.0" text-anchor="middle">Board</text>
        <text class="lbl-sub" x="200" y="83.5" text-anchor="middle">working</text>
        </g></g>
        <g class="layer core" data-layer="core" tabindex="0" role="button" aria-label="About me, core memory"><g class="g">
        <ellipse class="glow" cx="200" cy="112" rx="60" ry="30" fill="url(#core-glow)"/>
        <path class="plane" d="M158,112 a42,21.0 0 1,0 84,0 a42,21.0 0 1,0 -84,0 Z"/>
        <text class="lbl" x="200" y="113" text-anchor="middle">About me</text>
        <text class="lbl-sub" x="200" y="125" text-anchor="middle">core</text>
        </g></g>
        <g class="orbits" aria-hidden="true">
        <circle class="mem" r="2.2"><animateMotion dur="14s" begin="0s" repeatCount="indefinite" path="M265,112 a65,32.5 0 1,1 -130,0 a65,32.5 0 1,1 130,0"/></circle>
        <circle class="mem" r="2.2"><animateMotion dur="14s" begin="-7s" repeatCount="indefinite" path="M265,112 a65,32.5 0 1,1 -130,0 a65,32.5 0 1,1 130,0"/></circle>
        <circle class="mem" r="2.2"><animateMotion dur="22s" begin="-3s" repeatCount="indefinite" path="M312,112 a112,56.0 0 1,1 -224,0 a112,56.0 0 1,1 224,0"/></circle>
        <circle class="mem" r="2.2"><animateMotion dur="22s" begin="-14s" repeatCount="indefinite" path="M312,112 a112,56.0 0 1,1 -224,0 a112,56.0 0 1,1 224,0"/></circle>
        <circle class="mem" r="2.2"><animateMotion dur="34s" begin="-5s" repeatCount="indefinite" path="M364,112 a164,82.0 0 1,1 -328,0 a164,82.0 0 1,1 328,0"/></circle>
        <circle class="mem" r="2.2"><animateMotion dur="34s" begin="-17s" repeatCount="indefinite" path="M364,112 a164,82.0 0 1,1 -328,0 a164,82.0 0 1,1 328,0"/></circle>
        <circle class="mem" r="2.2"><animateMotion dur="34s" begin="-28s" repeatCount="indefinite" path="M364,112 a164,82.0 0 1,1 -328,0 a164,82.0 0 1,1 328,0"/></circle>
        </g></svg>
      <p class="rings-note muted">The closer to the centre, the more active the memory is right now. New notes land in the Inbox, what you keep moves out to your Notebooks, and the Board pulls in what a task needs. About me sits in the middle and shapes all of it.</p>
    </div>
    <div class="parts">
    <article class="part core" id="about-me" aria-labelledby="about-me-h">
      <div class="part-main">
        <p class="eyebrow"><span class="sw core"></span> Core memory · the centre</p>
        <h3 id="about-me-h">About me</h3>
        <p class="say">Who you are, how you like to work, and the rules your agents must follow. Small, and loaded into every task.</p>
        <dl class="facts">
          <dt>How many</dt><dd>Exactly one per person</dd>
          <dt>Who writes</dt><dd>Only you</dd>
          <dt>Fades?</dt><dd>Never</dd>
        </dl>
        <p class="example"><b>Example:</b> &ldquo;Prefers short answers. Writes in Hebrew and English. Never push to main without asking.&rdquo;</p>
      </div>
      <aside class="inhead">
        <p class="eyebrow">In your head</p>
        <p class="inhead-t">Your sense of self</p>
        <p class="muted">Deep along the middle of the brain, a network keeps track of who you are. It is part of everything you think about, so here it sits at the centre and lights up every task.</p>
        <a class="back" href="#layers">Back to the layers</a>
      </aside>
    </article>
    <article class="part work" id="board" aria-labelledby="board-h">
      <div class="part-main">
        <p class="eyebrow"><span class="sw work"></span> Working memory · the front</p>
        <h3 id="board-h">Board</h3>
        <p class="say">The goals and tasks you are working on now, plus the notes agents share while they do them. Like a blackboard in the room.</p>
        <dl class="facts">
          <dt>How many</dt><dd>One per project</dd>
          <dt>Who writes</dt><dd>Agents and people, per goal and task</dd>
          <dt>Fades?</dt><dd>Cleared when the goal closes</dd>
        </dl>
        <p class="example"><b>Example:</b> Goal &ldquo;Launch the sign-in page&rdquo; with its tasks, who holds each one, and their notes.</p>
      </div>
      <aside class="inhead">
        <p class="eyebrow">In your head</p>
        <p class="inhead-t">The prefrontal cortex</p>
        <p class="muted">Behind your forehead, the front of the brain holds what you are doing right now and keeps you on task. When the task is done, it lets go.</p>
        <a class="back" href="#layers">Back to the layers</a>
      </aside>
    </article>
    <article class="part short" id="inbox" aria-labelledby="inbox-h">
      <div class="part-main">
        <p class="eyebrow"><span class="sw short"></span> Short-term memory · deep inside</p>
        <h3 id="inbox-h">Inbox</h3>
        <p class="say">Fresh notes from today and this week. Anyone can drop things here; agent notes arrive as proposed.</p>
        <dl class="facts">
          <dt>How many</dt><dd>Many, one by default</dd>
          <dt>Who writes</dt><dd>Anyone; agents land as proposed</dd>
          <dt>Fades?</dt><dd>Yes, unless used or kept</dd>
        </dl>
        <p class="example"><b>Example:</b> &ldquo;Zakai said Nanogres now has pgvector 0.8.1.&rdquo;</p>
      </div>
      <aside class="inhead">
        <p class="eyebrow">In your head</p>
        <p class="inhead-t">The hippocampus</p>
        <p class="muted">Two small curled shapes deep in each side of the brain take in new experiences and hold them for a while. Later, mostly during sleep, the brain decides what to keep.</p>
        <a class="back" href="#layers">Back to the layers</a>
      </aside>
    </article>
    <article class="part long" id="notebooks" aria-labelledby="notebooks-h">
      <div class="part-main">
        <p class="eyebrow"><span class="sw long"></span> Long-term memory · the outer brain</p>
        <h3 id="notebooks-h">Notebooks</h3>
        <p class="say">What is worth keeping: decisions, facts and lessons, organised by topic. Search finds them by words, and later also by meaning.</p>
        <dl class="facts">
          <dt>How many</dt><dd>Many, one by default</dd>
          <dt>Who writes</dt><dd>Agents propose, you approve</dd>
          <dt>Fades?</dt><dd>Never</dd>
        </dl>
        <p class="example"><b>Example:</b> Decision: &ldquo;Host everything on Vercel, keep Express.&rdquo; With why, and who decided.</p>
      </div>
      <aside class="inhead">
        <p class="eyebrow">In your head</p>
        <p class="inhead-t">The cortex</p>
        <p class="muted">Lasting memories are spread across the brain's folded outer layer, linked to each other. That is why one memory can bring back another.</p>
        <a class="back" href="#layers">Back to the layers</a>
      </aside>
    </article>
    </div>
  </section>

  <section class="block" aria-labelledby="journey-h">
    <div class="block-head">
      <p class="eyebrow">A day with sky-brain</p>
      <h2 id="journey-h">How a memory moves up</h2>
      <p class="muted">Nothing climbs a layer by itself. Agents propose, and you keep or drop.</p>
    </div>
    <ol class="steps">
      <li class="step"><span class="num">STEP 1</span><span class="chip short">Inbox</span><h3>An agent captures</h3><p>While working with you, Claude saves a note with a one-line summary. It lands in your Inbox as proposed.</p></li>
      <li class="step"><span class="num">STEP 2</span><span class="chip work">Board</span><h3>A task is claimed</h3><p>When an agent picks up a task from your board, it gets a fenced context packet: About me, your rules and the relevant entries.</p></li>
      <li class="step"><span class="num">STEP 3</span><span class="chip short">Inbox</span><h3>Lessons are proposed</h3><p>When the task is done, the agent reports back and proposes up to three lessons it learned.</p></li>
      <li class="step"><span class="num">STEP 4</span><span class="chip long">Notebooks</span><h3>You keep what matters</h3><p>Keep a note and it becomes a Notebook entry that points back to where it came from. Drop it and it fades.</p></li>
    </ol>
  </section>

  <section class="block" aria-labelledby="trust-h">
    <div class="block-head">
      <p class="eyebrow">You are in charge</p>
      <h2 id="trust-h">Your brain, your rules</h2>
    </div>
    <div class="trust">
      <div><h3>Agents propose, you approve</h3><p>Every entry has a trust level. Agents write at proposed. Only you raise it.</p>
        <div class="levels"><span class="lv">quarantined</span><span class="lv">proposed</span><span class="lv ok">approved</span></div></div>
      <div><h3>Knowledge has a type</h3><p>A decision is not a guess. Each entry is a fact, decision, hypothesis, observation or outside source, and every change is kept.</p></div>
      <div><h3>Share one memory at a time</h3><p>Invite someone to a single memory, like "Family" or "Kitchen remodel". About me is never shared.</p></div>
    </div>
    <div class="tools" aria-label="Works with">
      <span class="tool">Claude</span><span class="tool">claude.ai</span><span class="tool">Codex</span><span class="tool">Pathly</span><span class="tool">any MCP client</span>
    </div>
  </section>

  <section class="final" aria-labelledby="final-h">
    <h2 id="final-h">Ready to connect your brain?</h2>
    <p class="muted">sky-brain is invite-only. Access is managed in Perminister.</p>
    <a class="btn btn-primary btn-star" href="#top">Sign in with Perminister</a>
  </section>
  <p class="foot">Every memory a star. Every link a line.</p>
</div>
    <script src="/auth-pages/sign-in.js" defer></script>
  </body>
</html>
`;

const signInScript = `"use strict";
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
    var oauthQuery = location.search.slice(1);
    // A refusal comes back to this page with the client's request kept, so "Try another
    // account" can still finish the connection.
    var body = {
      provider: "perminister",
      callbackURL: "/",
      errorCallbackURL: oauthQuery ? "/sign-in?" + oauthQuery : "/sign-in"
    };
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

export { style };
export const script = [
  themeScript,
  brainScript,
  entryScript,
  signInScript,
].join("\n");
