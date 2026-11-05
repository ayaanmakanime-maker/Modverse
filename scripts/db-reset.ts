/** Delete the local PGlite database (only when DATABASE_URL is not set). */
import { rmSync, existsSync } from "node:fs";
import path from "node:path";

if (process.env.DATABASE_URL) {
  console.error("Refusing to reset: DATABASE_URL is set. Reset external databases manually.");
  process.exit(1);
}
const dir = path.resolve(process.cwd(), process.env.MODVERSE_DATA_DIR ?? ".data", "pglite");
if (existsSync(dir)) {
  rmSync(dir, { recursive: true, force: true });
  console.log(`Removed ${dir}. Run npm run db:migrate && npm run db:seed (or just start the app).`);
} else console.log("No local database found.");
