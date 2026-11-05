/** Seed reference data (catalogue, fabrics, Creative Library, integrations) and bootstrap accounts. */
process.env.MODVERSE_AUTO_SEED = "false";
import { count } from "drizzle-orm";
import { getDbState, closeDb } from "../src/lib/db/client";
import { seedReferenceData } from "../src/lib/db/seed";
import * as s from "../src/lib/db/schema";

(async () => {
  const { db, driver } = await getDbState();
  const t0 = Date.now();
  const r = await seedReferenceData(db);
  const counts: Record<string, number> = {};
  for (const [name, tbl] of [["creative_assets", s.creativeAssets], ["garment_models", s.garmentModels], ["products", s.products], ["fabrics", s.fabrics], ["users", s.users], ["integration_configs", s.integrationConfigs]] as const) {
    const [row] = await db.select({ c: count() }).from(tbl);
    counts[name] = row.c;
  }
  console.log(`Seed ${r.seeded ? "applied" : "already up to date"} on ${driver} in ${Date.now() - t0} ms`, counts);
  await closeDb();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
