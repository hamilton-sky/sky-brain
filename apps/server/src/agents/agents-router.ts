// `/api/v1/agents` (D25 part 1): a person lists, creates and deletes their agent profiles and
// binds each connected app to one. People only (hard rule 3): an agent never picks its own role.
import {
  AgentBindRequestSchema,
  AgentProfileCreateRequestSchema,
} from "@sky-brain/shared/agents";
import { IdSchema } from "@sky-brain/shared/scope";
import express, { type Router } from "express";
import { personOf } from "../actor/keys.ts";
import { actorOf } from "../actor/middleware.ts";
import { requireHuman } from "../actor/require-human.ts";
import type { Db } from "@sky-brain/db/client";
import { HttpError } from "../http/http-error.ts";
import { validate } from "../http/validate.ts";
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

  return router;
}
