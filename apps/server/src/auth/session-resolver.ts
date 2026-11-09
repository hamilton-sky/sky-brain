// How /api/v1 learns who is calling from the Better Auth session cookie (spec.md Design). Only
// the cookie is handed to Better Auth: never a bearer token, never the body (hard rule 2).
import { ActorSchema } from "@sky-brain/shared/actor";
import { fromNodeHeaders } from "better-auth/node";
import type { ActorResolver } from "../actor/middleware.ts";
import type { Auth } from "./auth.ts";

export function sessionActorResolver(auth: Auth): ActorResolver {
  return async (req) => {
    const cookie = req.headers.cookie;
    if (!cookie) return undefined;
    const found = await auth.api.getSession({
      headers: fromNodeHeaders({ cookie }),
    });
    if (!found) return undefined;
    // A user id that does not fit UserIdSchema gives no actor, so 401.
    const parsed = ActorSchema.safeParse({
      kind: "human",
      user_id: found.user.id,
    });
    return parsed.success ? parsed.data : undefined;
  };
}
