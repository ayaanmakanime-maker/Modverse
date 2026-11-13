import { z } from "zod";
import { route } from "@/lib/api/handler";
import { deleteGeneration, getGeneration, setSaved } from "@/lib/services/muse";

export const GET = route<{ id: string }>({ auth: "user", rate: { name: "muse-status", limit: 900, windowMs: 3600_000, by: "user" } }, async ({ user, params }) => ({ generation: await getGeneration(user, params.id) }));
export const PATCH = route<{ id: string }>({ auth: "user" }, async ({ user, params, body }) => ({ generation: await setSaved(user, params.id, (await body(z.object({ saved: z.boolean() }))).saved) }));
export const DELETE = route<{ id: string }>({ auth: "user" }, async ({ user, params }) => deleteGeneration(user, params.id));
