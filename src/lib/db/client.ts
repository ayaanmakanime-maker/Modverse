import path from "node:path";
import { mkdirSync } from "node:fs";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

/**
 * Database access.
 *  - DATABASE_URL set  → PostgreSQL via node-postgres (production / Docker / local Postgres).
 *  - otherwise         → embedded PGlite (real PostgreSQL compiled to WASM) persisted
 *                        under MODVERSE_DATA_DIR (default .data/) — zero-setup local dev.
 * Versioned SQL migrations in /drizzle are applied on first connection unless
 * MODVERSE_AUTO_MIGRATE=false.
 */
export type Db = NodePgDatabase<typeof schema>;

interface DbState {
  db: Db;
  driver: "pglite" | "postgres";
  close: () => Promise<void>;
}

const g = globalThis as unknown as { __modverseDb?: Promise<DbState> };

export function dataDir(): string {
  return path.resolve(process.cwd(), process.env.MODVERSE_DATA_DIR ?? ".data");
}

async function connect(): Promise<DbState> {
  const migrationsFolder = path.resolve(process.cwd(), "drizzle");
  const autoMigrate = process.env.MODVERSE_AUTO_MIGRATE !== "false";
  if (process.env.DATABASE_URL) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.DATABASE_POOL_MAX ?? 10) });
    const db = drizzle(pool, { schema });
    if (autoMigrate) {
      const { migrate } = await import("drizzle-orm/node-postgres/migrator");
      await migrate(db, { migrationsFolder });
    }
    return { db, driver: "postgres", close: () => pool.end() };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const memory = process.env.MODVERSE_DB === "memory";
  let client: InstanceType<typeof PGlite>;
  if (memory) client = new PGlite();
  else {
    const dir = path.join(dataDir(), "pglite");
    mkdirSync(dir, { recursive: true });
    client = new PGlite(dir);
  }
  await client.waitReady;
  const db = drizzle(client, { schema }) as unknown as Db;
  if (autoMigrate) {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(db as never, { migrationsFolder });
  }
  return { db, driver: "pglite", close: () => client.close() };
}

export async function getDbState(): Promise<DbState> {
  if (!g.__modverseDb) {
    g.__modverseDb = connect().catch((e) => {
      g.__modverseDb = undefined;
      throw e;
    });
  }
  return g.__modverseDb;
}

export async function getDb(): Promise<Db> {
  const state = await getDbState();
  await ensureSeeded(state.db);
  return state.db;
}

export async function closeDb(): Promise<void> {
  if (!g.__modverseDb) return;
  const s = await g.__modverseDb;
  g.__modverseDb = undefined;
  await s.close();
}

const seeded = globalThis as unknown as { __modverseSeeded?: Promise<void> };
async function ensureSeeded(db: Db): Promise<void> {
  if (process.env.MODVERSE_AUTO_SEED === "false") return;
  if (!seeded.__modverseSeeded) {
    seeded.__modverseSeeded = (async () => {
      const { seedReferenceData } = await import("./seed");
      await seedReferenceData(db);
    })().catch((e) => {
      seeded.__modverseSeeded = undefined;
      throw e;
    });
  }
  return seeded.__modverseSeeded;
}

export { schema };
