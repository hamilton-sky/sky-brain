// `/api/v1/agents` (D25 part 1): a person lists, creates and deletes their agent profiles and
// binds each connected app to one; and under `/hats` (D42), the hats of the brain they own and
// which hat each app works under. People only (hard rule 3): an agent never picks its own role
// or hat.
import {
  AgentBindRequestSchema,
  AgentProfileCreateRequestSchema,
} from "@sky-brain/shared/agents";
import {
  HatBindRequestSchema,
  HatCreateRequestSchema,
} from "@sky-brain/shared/hats";
import { IdSchema } from "@sky-brain/shared/scope";
import express, { type Router } from "express";
import { personOf } from "@sky-brain/kernel/actor/keys";
import { actorOf } from "@sky-brain/kernel/actor/middleware";
import { requireHuman } from "@sky-brain/kernel/actor/require-human";
import type { Db } from "@sky-brain/db/client";
import { HttpError } from "@sky-brain/kernel/http/http-error";
import { validate } from "@sky-brain/kernel/http/validate";
import { ownWorkspace } from "@sky-brain/memory/memories";
import { bindHat, createHat, deleteHat, listHats } from "./hats.ts";
import {
  bindApp,
  createProfile,
  deleteProfile,
  listConnectedApps,
  listProfiles,
} from "./profiles.ts";

export function agentsRouter(options: { db: Db }): Router {
  const { db } = options;
  const router = express.Router();
  router.use(requireHuman);

  router.get("/", async (req, res) => {
    const person = personOf(actorOf(req));
    res.status(200).json({
      profiles: await listProfiles(db, person),
      apps: await listConnectedApps(db, person),
    });
  });

  router.post("/profiles", async (req, res) => {
    const body = validate(AgentProfileCreateRequestSchema, req.body);
    const profile = await createProfile(db, personOf(actorOf(req)), body);
    if (!profile) {
      throw new HttpError(
        409,
        "slug_taken",
        "You already have a profile with that name.",
      );
    }
    res.status(201).json({ profile });
  });

  router.delete("/profiles/:id", async (req, res) => {
    const id = validate(IdSchema, req.params.id);
    if (!(await deleteProfile(db, personOf(actorOf(req)), id))) {
      throw new HttpError(404, "not_found", "No such profile.");
    }
    res.status(204).end();
  });

  router.post("/bind", async (req, res) => {
    const body = validate(AgentBindRequestSchema, req.body);
    const result = await bindApp(
      db,
      personOf(actorOf(req)),
      body.client_id,
      body.profile_id,
    );
    if (result === "no_app") {
      throw new HttpError(404, "not_found", "You have not connected that app.");
    }
    if (result === "no_profile") {
      throw new HttpError(404, "not_found", "No such profile.");
    }
    res
      .status(200)
      .json({ client_id: body.client_id, profile_id: body.profile_id });
  });

  router.get("/hats", async (req, res) => {
    const ws = await ownWorkspace(db, actorOf(req));
    res.status(200).json({ hats: await listHats(db, ws) });
  });

  router.post("/hats", async (req, res) => {
    const body = validate(HatCreateRequestSchema, req.body);
    const ws = await ownWorkspace(db, actorOf(req));
    const hat = await createHat(db, ws, body);
    if (!hat) {
      throw new HttpError(
        409,
        "slug_taken",
        "You already have a hat with that name.",
      );
    }
    res.status(201).json({ hat });
  });

  router.delete("/hats/:id", async (req, res) => {
    const id = validate(IdSchema, req.params.id);
    const ws = await ownWorkspace(db, actorOf(req));
    const result = await deleteHat(db, ws, id);
    if (result === "not_found")
      throw new HttpError(404, "not_found", "No such hat.");
    if (result === "in_use") {
      throw new HttpError(
        409,
        "hat_in_use",
        "Some memories still belong to this hat. Move them back to shared first.",
      );
    }
    res.status(204).end();
  });

  router.post("/hats/bind", async (req, res) => {
    const body = validate(HatBindRequestSchema, req.body);
    const actor = actorOf(req);
    const ws = await ownWorkspace(db, actor);
    const result = await bindHat(
      db,
      personOf(actor),
      ws,
      body.client_id,
      body.hat_id,
    );
    if (result === "no_app") {
      throw new HttpError(404, "not_found", "You have not connected that app.");
    }
    if (result === "no_hat")
      throw new HttpError(404, "not_found", "No such hat.");
    res.status(200).json({ client_id: body.client_id, hat_id: body.hat_id });
  });

  return router;
}
