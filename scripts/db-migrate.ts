/** Apply versioned SQL migrations (drizzle/) to the configured database. */
process.env.MODVERSE_AUTO_SEED = "false";
import { getDbState, closeDb } from "../src/lib/db/client";

(async () => {
  const s = await getDbState();
  console.log(`Migrations applied (${s.driver}${s.driver === "pglite" ? `, ${process.env.MODVERSE_DATA_DIR ?? ".data"}/pglite` : ""}).`);
  await closeDb();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
