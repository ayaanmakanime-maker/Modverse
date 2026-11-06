import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, lt, notExists, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import * as s from "../db/schema";
import { ApiError } from "../api/handler";
import { hashPassword, passwordStrength } from "../auth/password";
import type { SessionUser } from "../auth/session";
import { audit } from "../audit";
import { emailSchema, nameSchema, sendVerificationEmail } from "./account";

/**
 * Guest mode: one click creates a REAL customer account with a throw-away address and an unknown
 * random password, so every signed-in feature works (designs, cart, checkout, orders, measurements,
 * mailbox). The visitor can later "save" it with an email + password; guests can never sign in
 * with a password, become partners, or be staff/admin.
 * Switch off with MODVERSE_GUEST_MODE=false (recommended for any public deployment).
 */
export const GUEST_DOMAIN = "guest.modverse.local";
export const guestModeEnabled = () => process.env.MODVERSE_GUEST_MODE !== "false";
export const isGuestAddress = (email: string) => email.toLowerCase().endsWith(`@${GUEST_DOMAIN}`);
const STALE_DAYS = 30;

export async function createGuestUser() {
  if (!guestModeEnabled()) throw new ApiError(404, "guest_disabled", "Guest mode is switched off. Please create an account.");
  const db = await getDb();
  // Housekeeping: drop abandoned guests that never ordered (cascades their designs/carts).
  await db.delete(s.users).where(and(eq(s.users.isGuest, true), lt(s.users.lastLoginAt, new Date(Date.now() - STALE_DAYS * 86_400_000)), notExists(db.select({ x: sql`1` }).from(s.orders).where(eq(s.orders.userId, s.users.id))))).catch(() => undefined);
  const id = randomBytes(6).toString("hex");
  const [u] = await db.insert(s.users).values({ email: `guest-${id}@${GUEST_DOMAIN}`, name: "Guest", passwordHash: await hashPassword(randomBytes(32).toString("base64url")), emailVerifiedAt: new Date(), isGuest: true }).returning();
  await audit({ actorUserId: u.id, action: "auth.guest_create", entityType: "user", entityId: u.id });
  return u;
}

/** Turns the current guest account into a normal one (keeps all designs, carts and orders). */
export async function claimGuestAccount(user: SessionUser, raw: { name: unknown; email: unknown; password: unknown }, origin: string) {
  if (!user.isGuest) throw new ApiError(409, "not_guest", "This account is already a full account.");
  const name = nameSchema.parse(raw.name);
  const email = emailSchema.parse(raw.email);
  if (isGuestAddress(email)) throw new ApiError(400, "bad_email", "Use your own email address.");
  const password = String(raw.password ?? "");
  const strength = passwordStrength(password, email);
  if (!strength.ok) throw new ApiError(400, "weak_password", strength.problems.join(" "));
  const db = await getDb();
  const [taken] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, email));
  if (taken) throw new ApiError(409, "email_taken", "An account with this email already exists. Sign in to it instead.");
  const [u] = await db.update(s.users).set({ name, email, passwordHash: await hashPassword(password), isGuest: false, emailVerifiedAt: null, updatedAt: new Date() }).where(eq(s.users.id, user.id)).returning();
  await sendVerificationEmail(u, origin);
  await audit({ actorUserId: u.id, action: "auth.guest_claim", entityType: "user", entityId: u.id });
  return u;
}
