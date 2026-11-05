import { eq } from "drizzle-orm";
import { route } from "@/lib/api/handler";
import { getDb } from "@/lib/db/client";
import { categories, fabrics, garmentModels, products } from "@/lib/db/schema";

export const GET = route({}, async () => {
  const db = await getDb();
  const [cats, models, fabs, prods] = await Promise.all([
    db.select().from(categories).where(eq(categories.active, true)).orderBy(categories.sort),
    db.select({ id: garmentModels.id, active: garmentModels.active }).from(garmentModels),
    db.select({ id: fabrics.id, active: fabrics.active }).from(fabrics),
    db.select().from(products).where(eq(products.active, true)),
  ]);
  return { categories: cats, activeModels: models.filter((m) => m.active).map((m) => m.id), activeFabrics: fabs.filter((f) => f.active).map((f) => f.id), products: prods };
});
