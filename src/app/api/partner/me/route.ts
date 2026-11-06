import { z } from "zod";
import { route } from "@/lib/api/handler";
import { getMembership, updateMyCapabilities } from "@/lib/services/partners";
import { LIMITS } from "@/lib/security/rate-limit";

/** The caller's partner organisation (or null) — used by the portal to choose a view. */
export const GET = route({ auth: "user" }, async ({ user }) => ({ membership: await getMembership(user) }));
export const PATCH = route({ auth: "user", rate: { name: "partner-write", ...LIMITS.write, by: "user" } }, async ({ user, body }) => ({ organization: await updateMyCapabilities(user, await body(z.unknown())) }));
