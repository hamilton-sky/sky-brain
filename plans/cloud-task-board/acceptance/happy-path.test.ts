// spec.md "Happy path", steps 1 to 8, played by a test as the spec says.
import { expect, it } from "vitest";
import {
  GRANT,
  bearer,
  claim,
  expectError,
  expectStatus,
  getTask,
  human,
  mint,
  proof,
  readyIds,
  setup,
  world,
  type Worker,
} from "./helpers.ts";

const ctx = setup();

it("happy path: log in, plan, approve, pull, claim, renew, done, a second laptop, and a dead laptop's late done", async () => {
  const w = await world(ctx.db);
  const person = ctx.server.as(human(w.editor));

  // 1-3. Device login for two laptops.
  const laptops: Worker[] = [];
  for (const name of ["laptop 1", "laptop 2"]) {
    const code = await ctx.server.anonymous.post("/api/device/code", { client_name: "pathly" });
    expectStatus(code, 200);
    const approved = await person.post("/api/v1/devices/approve", {
      user_code: code.body.user_code,
      name,
    });
    expectStatus(approved, 200);
    const token = await ctx.server.anonymous.post("/api/device/token", {
      grant_type: GRANT,
      device_code: code.body.device_code,
    });
    expectStatus(token, 200);
    // 5. A run token with read, claim, report for 30 minutes.
    const run = await mint(ctx, token.body.device_token, {
      project_id: w.projectId,
      verbs: ["read", "claim", "report"],
      role: "editor",
      ttl_seconds: 1800,
    });
    expectStatus(run, 201);
    laptops.push({
      deviceId: token.body.device_id,
      deviceToken: token.body.device_token,
      person: w.editor,
      runToken: run.body.run_token,
      client: bearer(ctx.server, run.body.run_token),
      actor: `agent:device/${token.body.device_id}`,
    });
  }
  const [one, two] = laptops as [Worker, Worker];

  // 4. A draft goal with three tasks, 2 and 3 depending on 1; the person approves it.
  const created = await person.post("/api/v1/goals", {
    project_id: w.projectId,
    title: "Three tasks",
    body: "Ship it.",
    executor: "single",
  });
  expectStatus(created, 201);
  expect(created.body.goal.status).toBe("draft");
  const goalId = created.body.goal.id;
  const added = await person.post(`/api/v1/goals/${goalId}/tasks`, {
    tasks: [
      { title: "one", body: "first", files: ["src/one"] },
      { title: "two", body: "second", files: ["src/two"], depends_on: [0] },
      { title: "three", body: "third", files: ["src/three"], depends_on: [0] },
    ],
  });
  expectStatus(added, 201);
  const [t1, t2, t3] = added.body.tasks.map((t: { id: string }) => t.id);
  const approved = await person.post(`/api/v1/goals/${goalId}/approve`);
  expectStatus(approved, 200);
  expect(approved.body.pinned).toBe(3);

  // 5. Ready returns task 1; claim returns claim_seq 1.
  expect(await readyIds(one.client)).toEqual([t1]);
  const c1 = await claim(one, t1);
  expectStatus(c1, 200);
  expect(c1.body.lease.claim_seq).toBe(1);

  // 6. Renew after 180 s, then done with proof: tasks 2 and 3 become ready.
  ctx.advance(180);
  expectStatus(await one.client.post(`/api/v1/tasks/${t1}/renew`, { claim_seq: 1 }), 200);
  const done = await one.client.post(`/api/v1/tasks/${t1}/done`, { claim_seq: 1, proof: proof() });
  expectStatus(done, 200);
  expect([...done.body.newly_ready].sort()).toEqual([t2, t3].sort());

  // 7. The first laptop claims task 2, the second claims task 3 (files do not overlap).
  expectStatus(await claim(one, t2), 200);
  expectStatus(await claim(two, t3), 200);

  // 8. The first laptop dies with task 2; 600 s later it reads pending; the second laptop
  // claims it (reclaimed, then claimed, claim_seq 2); the first laptop's done is lease_lost.
  ctx.advance(300);
  expectStatus(await two.client.post(`/api/v1/tasks/${t3}/renew`, { claim_seq: 1 }), 200);
  ctx.advance(300);
  expect((await getTask(two.client, t2)).status).toBe("pending");
  const takeover = await claim(two, t2);
  expectStatus(takeover, 200);
  expect(takeover.body.lease.claim_seq).toBe(2);
  expectError(
    await one.client.post(`/api/v1/tasks/${t2}/done`, { claim_seq: 1, proof: proof() }),
    409,
    "lease_lost",
  );
  const t2Now = await getTask(two.client, t2);
  expect(t2Now.status).toBe("in_progress");
  expect(t2Now.holder.device_id).toBe(two.deviceId);
});
