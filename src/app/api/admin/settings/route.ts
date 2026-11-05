import { z } from "zod";
import { route, ApiError } from "@/lib/api/handler";
import { getDb } from "@/lib/db/client";
import { platformSettings } from "@/lib/db/schema";
import { audit } from "@/lib/audit";

const EDITABLE: Record<string, z.ZodType> = {
  shipping: z.object({ flatRate: z.number().int().min(0).max(1000), freeAbove: z.number().int().min(0).max(100000), currency: z.literal("INR"), note: z.string().max(200).optional() }),
  checkout: z.object({ simulatedPaymentsEnabled: z.boolean() }),
  consent_policy_version: z.string().max(20),
};

export const GET = route({ auth: "admin" }, async () => {
  const db = await getDb();
  const rows = await db.select().from(platformSettings);
  return { settings: rows.filter((r) => r.key !== "reference_seed") };
});

const schema = z.object({ key: z.string().max(60), value: z.unknown() });
export const PATCH = route({ auth: "admin" }, async ({ user, body, ipHash }) => {
  const input = await body(schema);
  const validator = EDITABLE[input.key];
  if (!validator) throw new ApiError(400, "not_editable", "This setting can't be edited here");
  const value = validator.parse(input.value);
  const db = await getDb();
  await db.insert(platformSettings).values({ key: input.key, value }).onConflictDoUpdate({ target: platformSettings.key, set: { value, updatedAt: new Date() } });
  await audit({ actorUserId: user.id, action: "admin.setting_update", entityType: "setting", entityId: input.key, details: { value }, ipHash });
  return { ok: true };
});
