import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import * as s from "../db/schema";
import { ApiError, forbidden } from "../api/handler";
import type { SessionUser } from "../auth/session";

/** Partner membership and access checks (shared by partner workflows and settlements). */
export async function getMembership(user: SessionUser) {
  const db = await getDb();
  const [row] = await db.select({ org: s.organizations, role: s.organizationMembers.role }).from(s.organizationMembers).innerJoin(s.organizations, eq(s.organizations.id, s.organizationMembers.organizationId)).where(eq(s.organizationMembers.userId, user.id)).limit(1);
  return row ?? null;
}

/** The caller's APPROVED organisation of the given type (or a clear refusal). */
export async function requirePartner(user: SessionUser, type: "manufacturer" | "logistics") {
  const m = await getMembership(user);
  if (!m || m.org.type !== type) throw forbidden(`This area is for approved ${type} partners`);
  if (m.org.status === "pending") throw new ApiError(403, "partner_pending", "Your partner application is awaiting approval by ModVerse.");
  if (m.org.status !== "approved") throw new ApiError(403, "partner_inactive", `Your organisation is ${m.org.status}. Contact ModVerse.`);
  return m;
}
