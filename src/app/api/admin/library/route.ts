import { z } from "zod";
import { eq } from "drizzle-orm";
import { route, notFound } from "@/lib/api/handler";
import { getDb } from "@/lib/db/client";
import { creativeAssets } from "@/lib/db/schema";
import { audit } from "@/lib/audit";

const schema = z.object({ id: z.string().regex(/^MV[GPTCE]_\d{3}$/), active: z.boolean().optional(), featured: z.boolean().optional() });
export const PATCH = route({ auth: "admin" }, async ({ user, body, ipHash }) => {
  const input = await body(schema);
  const db = await getDb();
  const r = await db.update(creativeAssets).set({ ...(input.active !== undefined ? { active: input.active } : {}), ...(input.featured !== undefined ? { featured: input.featured } : {}) }).where(eq(creativeAssets.id, input.id)).returning({ id: creativeAssets.id });
  if (!r.length) throw notFound("Asset");
  await audit({ actorUserId: user.id, action: "admin.library_asset_update", entityType: "creative_asset", entityId: input.id, details: input, ipHash });
  return { ok: true };
});
