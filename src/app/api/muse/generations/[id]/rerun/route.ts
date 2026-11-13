import { z } from "zod";
import { route } from "@/lib/api/handler";
import { createGeneration } from "@/lib/services/muse";

/** Regenerate (same settings and seed) or make a variation (same settings, new seed). */
export const POST = route<{ id: string }>({ auth: "user", rate: { name: "muse-generate", limit: 30, windowMs: 3600_000, by: "user" } }, async ({ user, params, body }) => {
  const { variation } = await body(z.object({ variation: z.boolean().default(false) }));
  return { generation: await createGeneration(user, null, { id: params.id, variation }) };
});
