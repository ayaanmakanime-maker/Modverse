import { z } from "zod";
import { route } from "@/lib/api/handler";
import { applyAsPartner } from "@/lib/services/partners";

export const POST = route({ auth: "user", rate: { name: "partner-apply", limit: 5, windowMs: 60 * 60_000, by: "user" } }, async ({ user, body }) => ({ organization: await applyAsPartner(user, await body(z.unknown())) }));
