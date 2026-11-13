import { z } from "zod";
import { route } from "@/lib/api/handler";
import { createGeneration, listGenerations } from "@/lib/services/muse";

const list = z.object({ saved: z.enum(["1", "0"]).optional(), before: z.string().max(40).optional() });
export const GET = route({ auth: "user" }, async ({ user, query }) => {
  const q = query(list);
  return { generations: await listGenerations(user, { saved: q.saved === "1", before: q.before }) };
});
export const POST = route({ auth: "user", rate: { name: "muse-generate", limit: 30, windowMs: 3600_000, by: "user" } }, async ({ user, body }) => ({ generation: await createGeneration(user, await body(z.unknown())) }));
