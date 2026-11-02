# Follow-ups: cloud-task-board

What the run left for later: minor findings of passing reviews, the findings a level 2 ticket passed with after 2 review rounds, and Done when checks this host could not pass. Each is a candidate for a cleanup ticket.

## 01-device-login (left for later)

- 1. minor apps/server/src/server.ts: `publicBaseUrl` exists, but `start()` never passes it, so in production `verification_uri` is still built from the caller's `Host` or `X-Forwarded-Host`. This carries over from round 2's finding 4. - Read a `PUBLIC_BASE_URL` setting in config.ts and pass it to `createApp`, at the latest before R2-01 depends on it. (pair review)
- 2. minor apps/server/src/app.ts: outside dev, `trustProxyHops` is always 1. Nothing sets it from the environment, and Render's real hop count is still unchecked. Any server that runs without NODE_ENV=development and without a proxy in front lets a caller choose their rate-limit bucket through `X-Forwarded-For`. - Make the hop count a setting, and record the checked Render value in a decision, as round 2's finding 2 asked. (pair review)
- 3. minor apps/server/src/app.test.ts ("trusts as many proxy hops as it is told"): the test would also pass with 0 or 1 trusted hops. Every request has the same rightmost and second-from-right addresses, so all 61 requests share one bucket anyway. It cannot catch a wrong hop count. - Vary the second-from-right entry and keep the last one fixed, then check that each varied address gets its own bucket. (pair review)
