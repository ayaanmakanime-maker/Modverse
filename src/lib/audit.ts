import "server-only";
import { getDb } from "./db/client";
import { auditLogs } from "./db/schema";

/** Append-only audit trail for security-relevant and administrative actions. Never log secrets. */
export async function audit(entry: { actorUserId: string | null; action: string; entityType: string; entityId?: string | null; details?: Record<string, unknown>; ipHash?: string | null }) {
  try {
    const db = await getDb();
    await db.insert(auditLogs).values({ actorUserId: entry.actorUserId, action: entry.action, entityType: entry.entityType, entityId: entry.entityId ?? null, details: entry.details ?? {}, ipHash: entry.ipHash ?? null });
  } catch (e) {
    console.error("[audit] failed to write audit log", e);
  }
}
