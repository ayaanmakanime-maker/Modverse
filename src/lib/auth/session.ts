import "server-only";
import { randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { and, eq, gt } from "drizzle-orm";
import { cache } from "react";
import { getDb } from "../db/client";
import { sessions, users } from "../db/schema";
import { clientIp, hashIp, sha256 } from "../security/request";

export const SESSION_COOKIE = "mv_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RENEW_AFTER_MS = 24 * 60 * 60 * 1000;

export type Role = "customer" | "staff" | "admin";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  emailVerified: boolean;
  sessionId: string;
}

/**
 * Secure flag: always on for HTTPS requests and for production hosts; off only
 * for plain-HTTP localhost development (some browsers drop Secure cookies there).
 */
async function cookieOptions(expires: Date) {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "";
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").toLowerCase();
  const localhost = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const secure = process.env.MODVERSE_INSECURE_COOKIES === "true" ? false : proto === "https" || (process.env.NODE_ENV === "production" && !localhost);
  return { httpOnly: true, secure, sameSite: "lax" as const, path: "/", expires };
}

export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const id = sha256(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const h = await headers();
  const db = await getDb();
  await db.insert(sessions).values({ id, userId, expiresAt, userAgent: h.get("user-agent")?.slice(0, 200) ?? null, ipHash: hashIp(clientIp(h)) });
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
  (await cookies()).set(SESSION_COOKIE, token, await cookieOptions(expiresAt));
}

export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || token.length > 200) return null;
  const id = sha256(token);
  const db = await getDb();
  const rows = await db
    .select({ s: sessions, u: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row || row.u.status !== "active") return null;
  if (Date.now() - row.s.lastSeenAt.getTime() > RENEW_AFTER_MS) {
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await db.update(sessions).set({ lastSeenAt: new Date(), expiresAt }).where(eq(sessions.id, id));
    try {
      (await cookies()).set(SESSION_COOKIE, token, await cookieOptions(expiresAt));
    } catch {
      /* cookies are read-only during server component render */
    }
  }
  return { id: row.u.id, email: row.u.email, name: row.u.name, role: row.u.role, emailVerified: !!row.u.emailVerifiedAt, sessionId: id };
});

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.delete(sessions).where(eq(sessions.id, sha256(token)));
  }
  jar.delete(SESSION_COOKIE);
}

export async function revokeOtherSessions(userId: string, keepSessionId: string | null): Promise<void> {
  const db = await getDb();
  const all = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId));
  for (const s of all) if (s.id !== keepSessionId) await db.delete(sessions).where(eq(sessions.id, s.id));
}

export function hasRole(user: SessionUser | null, ...roles: Role[]): boolean {
  return !!user && roles.includes(user.role);
}
