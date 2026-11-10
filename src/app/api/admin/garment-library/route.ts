import { z } from "zod";
import { route, ApiError } from "@/lib/api/handler";
import { getDb } from "@/lib/db/client";
import { platformSettings } from "@/lib/db/schema";
import { audit } from "@/lib/audit";
import { disabledGarments, libraryIndex } from "@/lib/garment-library";

export const GET = route({ auth: "staff" }, async () => {
  const off = await disabledGarments();
  return { garments: libraryIndex().map((g) => ({ ...g, enabled: !off.has(g.id) })) };
});

const schema = z.object({ id: z.string().regex(/^[a-z0-9-]{1,120}$/), enabled: z.boolean() });
export const PATCH = route({ auth: "admin" }, async ({ user, body, ipHash }) => {
  const input = await body(schema);
  if (!libraryIndex().some((g) => g.id === input.id)) throw new ApiError(404, "not_found", "No such garment in the library");
  const off = await disabledGarments();
  if (input.enabled) off.delete(input.id); else off.add(input.id);
  const value = { disabled: [...off].sort() };
  const db = await getDb();
  await db.insert(platformSettings).values({ key: "garment_library", value }).onConflictDoUpdate({ target: platformSettings.key, set: { value, updatedAt: new Date() } });
  await audit({ actorUserId: user.id, action: "admin.garment_library_update", entityType: "library_garment", entityId: input.id, details: { enabled: input.enabled }, ipHash });
  return { ok: true };
});
