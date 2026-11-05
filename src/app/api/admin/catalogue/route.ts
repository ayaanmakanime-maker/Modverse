import { z } from "zod";
import { eq } from "drizzle-orm";
import { route, notFound } from "@/lib/api/handler";
import { getDb } from "@/lib/db/client";
import { categories, fabrics, garmentModels, products } from "@/lib/db/schema";
import { audit } from "@/lib/audit";

export const GET = route({ auth: "staff" }, async () => {
  const db = await getDb();
  const [c, m, f, p] = await Promise.all([db.select().from(categories), db.select({ id: garmentModels.id, name: garmentModels.name, garmentType: garmentModels.garmentType, active: garmentModels.active, geometryCompleteness: garmentModels.geometryCompleteness }).from(garmentModels), db.select({ id: fabrics.id, name: fabrics.name, category: fabrics.category, active: fabrics.active, priceDelta: fabrics.priceDelta }).from(fabrics), db.select().from(products)]);
  return { categories: c, models: m, fabrics: f, products: p };
});

const schema = z.object({
  entity: z.enum(["model", "fabric", "product", "category"]),
  id: z.string().max(100),
  active: z.boolean().optional(),
  featured: z.boolean().optional(),
  basePrice: z.number().int().min(99).max(50000).optional(),
});
export const PATCH = route({ auth: "admin" }, async ({ user, body, ipHash }) => {
  const input = await body(schema);
  const db = await getDb();
  let r: unknown[] = [];
  if (input.entity === "model") r = await db.update(garmentModels).set({ active: input.active }).where(eq(garmentModels.id, input.id)).returning();
  else if (input.entity === "fabric") r = await db.update(fabrics).set({ active: input.active }).where(eq(fabrics.id, input.id)).returning();
  else if (input.entity === "category") r = await db.update(categories).set({ active: input.active }).where(eq(categories.id, input.id)).returning();
  else r = await db.update(products).set({ ...(input.active !== undefined ? { active: input.active } : {}), ...(input.featured !== undefined ? { featured: input.featured } : {}), ...(input.basePrice ? { basePrice: input.basePrice } : {}) }).where(eq(products.id, input.id)).returning();
  if (!r.length) throw notFound(input.entity);
  await audit({ actorUserId: user.id, action: `admin.catalogue_${input.entity}_update`, entityType: input.entity, entityId: input.id, details: input, ipHash });
  return { ok: true };
});
