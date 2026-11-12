import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { auditLogs, platformSettings } from "@/lib/db/schema";
import { DEFAULT_PUTER_CONFIG, puterConfigSchema, type PuterConfig } from "./puter-config";

export async function getPuterConfig(): Promise<PuterConfig> {
  const db = await getDb();
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, "muse_puter"));
  const parsed = puterConfigSchema.safeParse(row?.value);
  return parsed.success ? parsed.data : DEFAULT_PUTER_CONFIG;
}

/** Application-level usage of the Puter option over the last 30 days (counts and recent errors; never prompts). */
export async function puterUsage() {
  const db = await getDb();
  const since = new Date(Date.now() - 30 * 864e5);
  const rows = await db.select().from(auditLogs).where(and(inArray(auditLogs.action, ["muse.puter_use", "muse.puter_error"]), gte(auditLogs.createdAt, since))).orderBy(desc(auditLogs.createdAt)).limit(2000);
  const byJob: Record<string, { ok: number; failed: number }> = {};
  for (const r of rows) {
    const j = (byJob[r.entityId ?? "?"] ??= { ok: 0, failed: 0 });
    if (r.action === "muse.puter_use") j.ok++; else j.failed++;
  }
  const errors = rows.filter((r) => r.action === "muse.puter_error").slice(0, 25).map((r) => ({ at: r.createdAt, job: r.entityId, ...(r.details as { model?: string; error?: string }) }));
  return { total: rows.length, byJob, errors };
}
