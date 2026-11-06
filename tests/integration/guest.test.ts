import { beforeAll, describe, expect, it } from "vitest";
process.env.MODVERSE_DB = "memory";
process.env.MODVERSE_DATA_DIR = ".data/test-guest";
process.env.MODVERSE_DEMO_ACCOUNTS = "false";
process.env.ADMIN_PASSWORD = "Integration-Test-Admin-9!";

import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { createProject, saveProject, listProjects } from "@/lib/services/designs";
import { createDesign, createTextLayer } from "@/lib/garment/design";
import { claimGuestAccount, createGuestUser, guestModeEnabled, isGuestAddress } from "@/lib/services/guest";
import { applyAsPartner } from "@/lib/services/partners";
import { sendEmail } from "@/lib/email";
import { verifyPassword } from "@/lib/auth/password";

const asSession = (u: typeof s.users.$inferSelect): SessionUser => ({ id: u.id, email: u.email, name: u.name, role: u.role, emailVerified: !!u.emailVerifiedAt, isGuest: u.isGuest, sessionId: "t" });
beforeAll(async () => { await getDb(); }, 120_000);

describe("guest mode", () => {
  it("creates a real customer account with a throw-away address that nobody can sign in to", async () => {
    expect(guestModeEnabled()).toBe(true);
    const u = await createGuestUser();
    expect(u).toMatchObject({ role: "customer", isGuest: true, name: "Guest" });
    expect(isGuestAddress(u.email)).toBe(true);
    expect(await verifyPassword(u.passwordHash, "password")).toBe(false);
    expect((await createGuestUser()).email).not.toBe(u.email);
  });

  it("supports every signed-in feature: designs persist, and nothing is shared between guests", async () => {
    const a = asSession(await createGuestUser()), b = asSession(await createGuestUser());
    const { project } = await createProject(a, { modelId: "tee-classic-crew", audience: "men" });
    const cfg = createDesign("tee-classic-crew", "men");
    cfg.layers = [createTextLayer(cfg, "HELLO", "center-chest")];
    await saveProject(a, project.id, { config: cfg });
    expect((await listProjects(a)).length).toBe(1);
    expect((await listProjects(b)).length).toBe(0);
  });

  it("can't become a partner, and real email is never attempted for guest addresses", async () => {
    const g = asSession(await createGuestUser());
    await expect(applyAsPartner(g, { type: "logistics", name: "X Logistics", contactEmail: "x@y.example", capabilities: { couriers: ["Delhivery"] } })).rejects.toMatchObject({ code: "guest_not_allowed" });
    const r = await sendEmail({ to: g.email, userId: g.id, subject: "hi", body: "x" });
    expect(r.provider).toBe("local-simulated");
  });

  it("is saved into a normal account keeping its designs; strong password and a free email required", async () => {
    const g = asSession(await createGuestUser());
    const { project } = await createProject(g, { modelId: "tee-oversized", audience: "men" });
    await expect(claimGuestAccount(g, { name: "Asha", email: "asha@example.com", password: "short" }, "http://x")).rejects.toMatchObject({ code: "weak_password" });
    await expect(claimGuestAccount(g, { name: "Asha", email: "x@guest.modverse.local", password: "Correct-Horse-Battery-9" }, "http://x")).rejects.toMatchObject({ code: "bad_email" });
    const u = await claimGuestAccount(g, { name: "Asha", email: "asha@example.com", password: "Correct-Horse-Battery-9" }, "http://x");
    expect(u).toMatchObject({ isGuest: false, email: "asha@example.com", name: "Asha" });
    expect(await verifyPassword(u.passwordHash, "Correct-Horse-Battery-9")).toBe(true);
    expect(u.emailVerifiedAt).toBeNull(); // must verify the new address
    expect((await listProjects(asSession(u))).map((p) => p.id)).toEqual([project.id]);
    await expect(claimGuestAccount(asSession(u), { name: "A", email: "b@example.com", password: "Correct-Horse-Battery-9" }, "http://x")).rejects.toMatchObject({ code: "not_guest" });
    const g2 = asSession(await createGuestUser());
    await expect(claimGuestAccount(g2, { name: "Other", email: "asha@example.com", password: "Correct-Horse-Battery-9" }, "http://x")).rejects.toMatchObject({ code: "email_taken" });
  });

  it("can be switched off, and abandoned guests without orders are cleaned up", async () => {
    const db = await getDb();
    const old = await createGuestUser();
    await db.update(s.users).set({ lastLoginAt: new Date(Date.now() - 40 * 86_400_000) }).where(eq(s.users.id, old.id));
    await createGuestUser(); // triggers housekeeping
    expect((await db.select().from(s.users).where(eq(s.users.id, old.id))).length).toBe(0);
    process.env.MODVERSE_GUEST_MODE = "false";
    await expect(createGuestUser()).rejects.toMatchObject({ code: "guest_disabled" });
    delete process.env.MODVERSE_GUEST_MODE;
  });
});
