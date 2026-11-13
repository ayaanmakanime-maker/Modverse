import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client";
import * as s from "../db/schema";
import { ApiError, badRequest, notFound } from "../api/handler";
import type { SessionUser } from "../auth/session";
import { hashPassword } from "../auth/password";
import { sha256 } from "../security/request";
import { sendEmail } from "../email";
import { validateBody } from "../garment/sizing";
import { getStorage } from "../storage";

export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const nameSchema = z.string().trim().min(1).max(80);
export const phoneSchema = z.string().trim().regex(/^(\+91[\s-]?)?[6-9]\d{9}$/, "Enter a valid Indian mobile number");

export const addressSchema = z.object({
  label: z.string().trim().max(30).default("Home"),
  fullName: nameSchema,
  phone: phoneSchema,
  line1: z.string().trim().min(3).max(120),
  line2: z.string().trim().max(120).optional().nullable(),
  city: z.string().trim().min(2).max(60),
  state: z.string().trim().min(2).max(60),
  pincode: z.string().trim().regex(/^[1-9][0-9]{5}$/, "Enter a valid 6-digit PIN code"),
  isDefault: z.boolean().optional(),
});

export const bodySchema = z.object({
  height: z.number().positive().optional(),
  chest: z.number().positive(),
  waist: z.number().positive().optional(),
  hip: z.number().positive().optional(),
  shoulder: z.number().positive().optional(),
  armLength: z.number().positive().optional(),
  neck: z.number().positive().optional(),
  bicep: z.number().positive().optional(),
  wrist: z.number().positive().optional(),
  torsoLength: z.number().positive().optional(),
  inseam: z.number().positive().optional(),
  thigh: z.number().positive().optional(),
  calf: z.number().positive().optional(),
  /** Human Studio: underbust girth (bra band) and body weight in kg */
  underbust: z.number().positive().optional(),
  weight: z.number().positive().max(400).optional(),
});

const provenanceSchema = z.object({ source: z.enum(["user", "camera", "derived"]), confidence: z.enum(["high", "medium", "low"]), toleranceCm: z.number().min(0).max(30).optional(), at: z.string().max(40).optional() });

export const measurementProfileSchema = z.object({
  name: z.string().trim().min(1).max(60),
  audience: z.enum(["men", "women"]),
  measurements: bodySchema,
  /** Per-field provenance; fields without an entry are user-provided. Camera estimates can never claim "high". */
  provenance: z.partialRecord(z.enum(["height", "chest", "waist", "hip", "shoulder", "armLength", "neck", "bicep", "wrist", "torsoLength"]), provenanceSchema).default({}).transform((p) => {
    for (const v of Object.values(p)) if (v && v.source !== "user" && v.confidence === "high") v.confidence = "medium";
    return p;
  }),
  fitPreference: z.enum(["closer", "true", "looser"]).default("true"),
});

export const avatarSchema = z.object({
  name: z.string().trim().min(1).max(60),
  measurementProfileId: z.string().uuid().nullable().optional(),
  appearance: z.object({
    skinTone: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    build: z.enum(["slim", "average", "athletic", "broad", "curvy"]),
    height: z.number().min(70).max(220),
    hair: z.enum(["short", "medium", "long", "bun", "none"]).default("short"),
    pose: z.enum(["a-pose", "relaxed"]).default("a-pose"),
    bodyType: z.enum(["masculine", "feminine"]).default("masculine"),
  }),
});

// ── Email verification / password reset tokens ─────────────────────
export async function issueToken(userId: string, type: "verify_email" | "reset_password", ttlMs: number): Promise<string> {
  const db = await getDb();
  const token = randomBytes(32).toString("base64url");
  await db.insert(s.authTokens).values({ userId, type, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMs) });
  return token;
}

export async function consumeToken(token: string, type: "verify_email" | "reset_password") {
  const db = await getDb();
  const [t] = await db.select().from(s.authTokens).where(and(eq(s.authTokens.tokenHash, sha256(token)), eq(s.authTokens.type, type), isNull(s.authTokens.usedAt), gt(s.authTokens.expiresAt, new Date())));
  if (!t) throw new ApiError(400, "invalid_token", "This link is invalid or has expired");
  await db.update(s.authTokens).set({ usedAt: new Date() }).where(eq(s.authTokens.id, t.id));
  return t;
}

export async function sendVerificationEmail(user: { id: string; email: string; name: string }, origin: string) {
  const token = await issueToken(user.id, "verify_email", 48 * 3600_000);
  await sendEmail({ to: user.email, userId: user.id, subject: "Verify your ModVerse email", body: `Hi ${user.name},\n\nConfirm your email address:\n${origin}/verify-email?token=${token}\n\nThis link expires in 48 hours.` });
}

// ── Profile ──────────────────────────────────────────────────────────
export async function getProfile(user: SessionUser) {
  const db = await getDb();
  const [u] = await db.select({ id: s.users.id, email: s.users.email, name: s.users.name, phone: s.users.phone, role: s.users.role, emailVerifiedAt: s.users.emailVerifiedAt, marketingOptIn: s.users.marketingOptIn, createdAt: s.users.createdAt }).from(s.users).where(eq(s.users.id, user.id));
  return u;
}

export async function deleteAccount(user: SessionUser) {
  if (user.role === "admin") {
    const db = await getDb();
    const admins = await db.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.role, "admin"), eq(s.users.status, "active")));
    if (admins.length <= 1) throw new ApiError(409, "last_admin", "The last active admin account cannot be deleted");
  }
  const db = await getDb();
  const uploads = await db.select({ key: s.uploadedAssets.storageKey }).from(s.uploadedAssets).where(eq(s.uploadedAssets.userId, user.id));
  await db.transaction(async (tx) => {
    await tx.delete(s.sessions).where(eq(s.sessions.userId, user.id));
    await tx.delete(s.addresses).where(eq(s.addresses.userId, user.id));
    await tx.delete(s.avatarProfiles).where(eq(s.avatarProfiles.userId, user.id));
    await tx.delete(s.measurementProfiles).where(eq(s.measurementProfiles.userId, user.id));
    await tx.delete(s.fitValidationSamples).where(eq(s.fitValidationSamples.userId, user.id));
    // The Kids range is retired, but any guardian/child data stored earlier is still erased with the account.
    await tx.delete(s.childProfiles).where(eq(s.childProfiles.guardianUserId, user.id));
    await tx.delete(s.guardianProfiles).where(eq(s.guardianProfiles.userId, user.id));
    await tx.delete(s.libraryFavorites).where(eq(s.libraryFavorites.userId, user.id));
    await tx.delete(s.libraryRecent).where(eq(s.libraryRecent.userId, user.id));
    await tx.delete(s.savedCompositions).where(eq(s.savedCompositions.userId, user.id));
    await tx.delete(s.wishlistItems).where(eq(s.wishlistItems.userId, user.id));
    await tx.delete(s.wishlistGarments).where(eq(s.wishlistGarments.userId, user.id));
    await tx.delete(s.fittings).where(eq(s.fittings.userId, user.id));
    await tx.delete(s.outboxEmails).where(eq(s.outboxEmails.userId, user.id));
    await tx.update(s.designProjects).set({ deletedAt: new Date(), status: "archived" }).where(eq(s.designProjects.userId, user.id));
    await tx.delete(s.uploadedAssets).where(eq(s.uploadedAssets.userId, user.id));
    // Orders are retained for accounting/legal reasons but detached from personal identity.
    await tx
      .update(s.users)
      .set({ status: "deleted", email: `deleted-${randomUUID()}@deleted.invalid`, name: "Deleted user", phone: null, passwordHash: "!", marketingOptIn: false, updatedAt: new Date() })
      .where(eq(s.users.id, user.id));
  });
  for (const u of uploads) await getStorage().delete(u.key).catch(() => undefined);
}

export async function setNewPassword(userId: string, password: string) {
  const db = await getDb();
  await db.update(s.users).set({ passwordHash: await hashPassword(password), updatedAt: new Date() }).where(eq(s.users.id, userId));
  await db.delete(s.sessions).where(eq(s.sessions.userId, userId));
}

// ── Addresses ────────────────────────────────────────────────────────
export async function listAddresses(user: SessionUser) {
  const db = await getDb();
  return db.select().from(s.addresses).where(eq(s.addresses.userId, user.id)).orderBy(desc(s.addresses.isDefault), desc(s.addresses.createdAt));
}

export async function upsertAddress(user: SessionUser, input: z.infer<typeof addressSchema>, id?: string) {
  const db = await getDb();
  const existing = await listAddresses(user);
  if (!id && existing.length >= 10) throw badRequest("You can save up to 10 addresses");
  const makeDefault = input.isDefault || existing.length === 0;
  if (makeDefault) await db.update(s.addresses).set({ isDefault: false }).where(eq(s.addresses.userId, user.id));
  if (id) {
    const [row] = await db.update(s.addresses).set({ ...input, line2: input.line2 ?? null, isDefault: !!makeDefault }).where(and(eq(s.addresses.id, id), eq(s.addresses.userId, user.id))).returning();
    if (!row) throw notFound("Address");
    return row;
  }
  const [row] = await db.insert(s.addresses).values({ ...input, line2: input.line2 ?? null, userId: user.id, isDefault: !!makeDefault }).returning();
  return row;
}

export async function deleteAddress(user: SessionUser, id: string) {
  const db = await getDb();
  const r = await db.delete(s.addresses).where(and(eq(s.addresses.id, id), eq(s.addresses.userId, user.id))).returning();
  if (!r.length) throw notFound("Address");
}

// ── Measurement profiles ─────────────────────────────────────────────
export async function listMeasurementProfiles(user: SessionUser) {
  const db = await getDb();
  // Profiles of the retired Kids range stay in the database but are no longer offered.
  return db.select().from(s.measurementProfiles).where(and(eq(s.measurementProfiles.userId, user.id), inArray(s.measurementProfiles.audience, ["men", "women"]))).orderBy(desc(s.measurementProfiles.updatedAt));
}

export async function upsertMeasurementProfile(user: SessionUser, raw: z.input<typeof measurementProfileSchema>, id?: string) {
  const input = measurementProfileSchema.parse(raw);
  const errors = validateBody(input.audience, input.measurements);
  if (errors.length) throw badRequest(`Measurements look implausible: ${errors.join("; ")}`);
  const db = await getDb();
  if (id) {
    const [row] = await db.update(s.measurementProfiles).set({ ...input, updatedAt: new Date() }).where(and(eq(s.measurementProfiles.id, id), eq(s.measurementProfiles.userId, user.id))).returning();
    if (!row) throw notFound("Measurement profile");
    return row;
  }
  const [row] = await db.insert(s.measurementProfiles).values({ ...input, userId: user.id }).returning();
  return row;
}

export async function deleteMeasurementProfile(user: SessionUser, id: string) {
  const db = await getDb();
  const r = await db.delete(s.measurementProfiles).where(and(eq(s.measurementProfiles.id, id), eq(s.measurementProfiles.userId, user.id))).returning();
  if (!r.length) throw notFound("Measurement profile");
}

// ── Avatars ──────────────────────────────────────────────────────────
export async function listAvatars(user: SessionUser) {
  const db = await getDb();
  return db.select().from(s.avatarProfiles).where(eq(s.avatarProfiles.userId, user.id)).orderBy(desc(s.avatarProfiles.updatedAt));
}

export async function upsertAvatar(user: SessionUser, input: z.infer<typeof avatarSchema>, id?: string) {
  const db = await getDb();
  if (input.measurementProfileId) {
    const [m] = await db.select().from(s.measurementProfiles).where(and(eq(s.measurementProfiles.id, input.measurementProfileId), eq(s.measurementProfiles.userId, user.id)));
    if (!m) throw notFound("Measurement profile");
  }
  const values = { name: input.name, appearance: input.appearance, measurementProfileId: input.measurementProfileId ?? null };
  if (id) {
    const [row] = await db.update(s.avatarProfiles).set({ ...values, updatedAt: new Date() }).where(and(eq(s.avatarProfiles.id, id), eq(s.avatarProfiles.userId, user.id))).returning();
    if (!row) throw notFound("Avatar");
    return row;
  }
  const [row] = await db.insert(s.avatarProfiles).values({ ...values, userId: user.id }).returning();
  return row;
}

export async function deleteAvatar(user: SessionUser, id: string) {
  const db = await getDb();
  const r = await db.delete(s.avatarProfiles).where(and(eq(s.avatarProfiles.id, id), eq(s.avatarProfiles.userId, user.id))).returning();
  if (!r.length) throw notFound("Avatar");
}

export async function mailbox(user: SessionUser) {
  const db = await getDb();
  return db.select().from(s.outboxEmails).where(eq(s.outboxEmails.userId, user.id)).orderBy(desc(s.outboxEmails.createdAt)).limit(50);
}

export async function listSessions(user: SessionUser) {
  const db = await getDb();
  const rows = await db.select().from(s.sessions).where(and(eq(s.sessions.userId, user.id), gt(s.sessions.expiresAt, new Date()))).orderBy(desc(s.sessions.lastSeenAt));
  return rows.map((r) => ({ id: r.id.slice(0, 12), current: r.id === user.sessionId, userAgent: r.userAgent, createdAt: r.createdAt, lastSeenAt: r.lastSeenAt }));
}

// ── Verified fit (feedback after wearing a delivered garment) ──────────
export const fitFeedbackSchema = z.object({
  orderItemId: z.string().uuid(),
  overall: z.enum(["too-tight", "slightly-tight", "true", "slightly-loose", "too-loose"]),
  areas: z.partialRecord(z.enum(["chest", "waist", "shoulders", "sleeves", "length"]), z.enum(["too-tight", "slightly-tight", "true", "slightly-loose", "too-loose"])).default({}),
  notes: z.string().trim().max(500).optional(),
});

export async function submitFitFeedback(user: SessionUser, input: z.infer<typeof fitFeedbackSchema>) {
  const db = await getDb();
  const [row] = await db.select({ item: s.orderItems, order: s.orders }).from(s.orderItems).innerJoin(s.orders, eq(s.orders.id, s.orderItems.orderId)).where(eq(s.orderItems.id, input.orderItemId));
  if (!row || row.order.userId !== user.id) throw notFound("Order item");
  if (!["shipped", "delivered"].includes(row.order.status)) throw badRequest("Fit can be verified once the garment has been delivered");
  // made-to-order collection garments record the collection id and the chosen fit
  const lib = row.item.kind === "library" ? (row.item.designSnapshot as { garment: { id: string }; options: { fit: string } }) : null;
  const snap = lib ? { modelId: `collection:${lib.garment.id}`, fit: lib.options.fit } : (row.item.designSnapshot as { modelId: string; fit: string });
  const values = { userId: user.id, orderItemId: input.orderItemId, modelId: snap.modelId, size: row.item.size, fit: snap.fit, overall: input.overall, areas: input.areas, notes: input.notes ?? null };
  const [saved] = await db.insert(s.fitFeedback).values(values).onConflictDoUpdate({ target: s.fitFeedback.orderItemId, set: { overall: values.overall, areas: values.areas, notes: values.notes } }).returning();
  return saved;
}

export async function listFitFeedback(user: SessionUser, modelId?: string) {
  const db = await getDb();
  const rows = await db.select().from(s.fitFeedback).where(eq(s.fitFeedback.userId, user.id)).orderBy(desc(s.fitFeedback.createdAt));
  return modelId ? rows.filter((r) => r.modelId === modelId) : rows;
}
