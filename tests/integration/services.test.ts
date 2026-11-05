/**
 * Service-level integration tests against a real (in-memory) PostgreSQL via PGlite,
 * with migrations + reference seed applied exactly as in the running app.
 */
import { beforeAll, describe, expect, it } from "vitest";
process.env.MODVERSE_DB = "memory";
process.env.MODVERSE_DATA_DIR = ".data/test-int";
process.env.MODVERSE_DEMO_ACCOUNTS = "false";
process.env.ADMIN_PASSWORD = "Integration-Test-Admin-9!";

import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createProject, saveProject, listVersions, revertProject, duplicateProject, getProjectWithVersion, deleteProject, listProjects } from "@/lib/services/designs";
import { addToCart, checkout, confirmSimulatedPayment, getCart, getOrder, staffUpdateOrder, reviewOrderItem, cancelOrder } from "@/lib/services/commerce";
import { createChild, upsertMeasurementProfile, deleteChild, listMeasurementProfiles, deleteAccount, submitFitFeedback, listFitFeedback } from "@/lib/services/account";
import { saveCredentials, setEnabled, getActiveIntegration, listIntegrations, recordTest } from "@/lib/integrations/config";
import { createDesign, createTextLayer } from "@/lib/garment/design";
import { detectType, rasterSize, storeFont, listFonts, readUpload, deleteFont } from "@/lib/services/uploads";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

let alice: SessionUser;
let bob: SessionUser;
let staff: SessionUser;

async function makeUser(email: string, role: "customer" | "staff" | "admin" = "customer"): Promise<SessionUser> {
  const db = await getDb();
  const [u] = await db.insert(s.users).values({ email, name: email.split("@")[0], passwordHash: await hashPassword("Correct-Horse-Battery-9"), role }).returning();
  return { id: u.id, email: u.email, name: u.name, role: u.role, emailVerified: false, sessionId: "test" };
}

const address = { fullName: "Alice Example", phone: "9876543210", line1: "12 MG Road", city: "Bengaluru", state: "Karnataka", pincode: "560001" };

beforeAll(async () => {
  const db = await getDb();
  const [{ n }] = (await db.select({ n: s.creativeAssets.id }).from(s.creativeAssets).limit(1)) as { n: string }[];
  expect(n).toMatch(/^MV/);
  alice = await makeUser("alice@example.com");
  bob = await makeUser("bob@example.com");
  staff = await makeUser("staff@example.com", "staff");
}, 120_000);

describe("seed & auth", () => {
  it("seeds the real catalogue, library and an admin with an Argon2id hash", async () => {
    const db = await getDb();
    expect((await db.select().from(s.creativeAssets)).length).toBe(1000);
    expect((await db.select().from(s.garmentModels)).length).toBe(32);
    const [admin] = await db.select().from(s.users).where(eq(s.users.role, "admin"));
    expect(admin.passwordHash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(admin.passwordHash, "Integration-Test-Admin-9!")).toBe(true);
    expect(await verifyPassword(admin.passwordHash, "wrong")).toBe(false);
  });
});

describe("designs: save, versions, ownership", () => {
  it("creates, saves, versions, reverts and duplicates designs", async () => {
    const { project } = await createProject(alice, { modelId: "tee-oversized", audience: "men", mode: "atelier" });
    const cfg = createDesign("tee-oversized", "men");
    cfg.fabric.color = "#1B2A47";
    cfg.layers = [createTextLayer(cfg, "MUMBAI", "upper-back")];
    await saveProject(alice, project.id, { config: cfg });
    const v2 = await saveProject(alice, project.id, { config: { ...cfg, fabric: { ...cfg.fabric, color: "#C8102E" } }, asNewVersion: true, note: "Red" });
    expect(v2.version.version).toBe(2);
    const versions = await listVersions(alice, project.id);
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    const reverted = await revertProject(alice, project.id, 1);
    expect(reverted.version.version).toBe(3);
    expect((reverted.version.config as { fabric: { color: string } }).fabric.color).toBe("#1B2A47");
    const dbRows = await (await getDb()).select().from(s.designLayers).where(eq(s.designLayers.versionId, reverted.version.id));
    expect(dbRows).toHaveLength(1);
    const dup = await duplicateProject(alice, project.id);
    expect(dup.project.name).toContain("copy");
    expect((await listProjects(alice)).length).toBe(2);
  });

  it("never lets another customer read or modify a private design", async () => {
    const { project } = await createProject(alice, { modelId: "shirt-linen", audience: "women" });
    await expect(getProjectWithVersion(bob, project.id)).rejects.toMatchObject({ status: 404 });
    await expect(saveProject(bob, project.id, { config: createDesign("shirt-linen", "women") })).rejects.toMatchObject({ status: 404 });
    await expect(deleteProject(bob, project.id)).rejects.toMatchObject({ status: 404 });
    // staff may read for review, but not modify
    await expect(getProjectWithVersion(staff, project.id)).resolves.toBeTruthy();
    await expect(saveProject(staff, project.id, { config: createDesign("shirt-linen", "women") })).rejects.toMatchObject({ status: 403 });
  });

  it("rejects malformed configs", async () => {
    const { project } = await createProject(alice, { modelId: "tee-classic-crew", audience: "men" });
    await expect(saveProject(alice, project.id, { config: { schemaVersion: 1, garmentType: "tshirt" } })).rejects.toBeTruthy();
  });
});

describe("guardian-managed child profiles", () => {
  it("requires a guardian child profile for kids measurements and deletes data with the profile", async () => {
    await expect(upsertMeasurementProfile(alice, { name: "Kid", audience: "kids", measurements: { chest: 64, height: 128 }, fitPreference: "true" })).rejects.toMatchObject({ status: 400 });
    const child = await createChild(alice, { nickname: "Ria", birthYear: new Date().getFullYear() - 8, consent: true, allowSharing: false });
    expect(child.allowSharing).toBe(false);
    const m = await upsertMeasurementProfile(alice, { name: "Ria", audience: "kids", measurements: { chest: 64, height: 128 }, fitPreference: "true", childProfileId: child.id });
    expect(m.childProfileId).toBe(child.id);
    await expect(upsertMeasurementProfile(bob, { name: "steal", audience: "kids", measurements: { chest: 64 }, fitPreference: "true", childProfileId: child.id })).rejects.toMatchObject({ status: 403 });
    await expect(createProject(bob, { modelId: "tee-classic-crew", audience: "kids", childProfileId: child.id })).rejects.toMatchObject({ status: 403 });
    await deleteChild(alice, child.id);
    expect((await listMeasurementProfiles(alice)).filter((p) => p.childProfileId === child.id)).toHaveLength(0);
  });

  it("rejects implausible measurements", async () => {
    await expect(upsertMeasurementProfile(alice, { name: "x", audience: "men", measurements: { chest: 400 }, fitPreference: "true" })).rejects.toMatchObject({ status: 400 });
  });
});

describe("commerce: cart → simulated checkout → production approval", () => {
  it("runs the full order flow with server-side pricing and snapshots", async () => {
    const { project } = await createProject(alice, { modelId: "tee-classic-crew", audience: "men" });
    const cfg = createDesign("tee-classic-crew", "men");
    cfg.layers = [createTextLayer(cfg, "MODVERSE", "center-chest")];
    await saveProject(alice, project.id, { config: cfg });
    const cart = await addToCart(alice, { projectId: project.id, size: "L", quantity: 2 });
    expect(cart.lines[0].unitPrice).toBeGreaterThan(799);
    expect(cart.total).toBe(cart.subtotal + cart.gst + cart.shipping);
    await expect(addToCart(bob, { projectId: project.id, quantity: 1 })).rejects.toMatchObject({ status: 404 });

    const { order, provider } = await checkout(alice, { address });
    expect(provider).toBe("simulated");
    expect(order.isSimulated).toBe(true);
    expect((await getCart(alice)).lines).toHaveLength(0);
    await expect(getOrder(bob, order.id)).rejects.toMatchObject({ status: 404 });

    // Editing the design after ordering must not change the order snapshot
    await saveProject(alice, project.id, { config: { ...cfg, fabric: { ...cfg.fabric, color: "#C8102E" } } });
    const paid = await confirmSimulatedPayment(alice, order.id);
    expect(paid.order.status).toBe("awaiting_production_approval");
    expect(paid.payments[0].status).toBe("captured");
    expect((paid.items[0].designSnapshot as { fabric: { color: string } }).fabric.color).toBe(cfg.fabric.color);
    expect(paid.items[0].size).toBe("L");

    await expect(staffUpdateOrder(staff, order.id, { status: "manufacturing" })).rejects.toMatchObject({ code: "review_required" });
    await reviewOrderItem(staff, paid.items[0].id, "approved");
    const m = await staffUpdateOrder(staff, order.id, { status: "manufacturing", note: "Cut" });
    expect(m.order.status).toBe("manufacturing");
    await expect(staffUpdateOrder(staff, order.id, { status: "payment_confirmed" })).rejects.toMatchObject({ code: "invalid_transition" });
    await expect(cancelOrder(alice, order.id)).rejects.toMatchObject({ code: "cannot_cancel" });
    // Fit can only be verified once delivered/shipped, and only by the customer who ordered.
    await expect(submitFitFeedback(alice, { orderItemId: paid.items[0].id, overall: "true", areas: {} })).rejects.toMatchObject({ status: 400 });
    const shipped = await staffUpdateOrder(staff, order.id, { status: "shipped", tracking: { courier: "Delhivery", awb: "TEST123" } });
    expect(shipped.shipments).toHaveLength(1);
    await expect(submitFitFeedback(bob, { orderItemId: paid.items[0].id, overall: "true", areas: {} })).rejects.toMatchObject({ status: 404 });
    const fb = await submitFitFeedback(alice, { orderItemId: paid.items[0].id, overall: "slightly-loose", areas: { length: "true" } });
    expect(fb).toMatchObject({ modelId: "tee-classic-crew", size: "L", overall: "slightly-loose" });
    const again = await submitFitFeedback(alice, { orderItemId: paid.items[0].id, overall: "true", areas: {} });
    expect(again.id).toBe(fb.id);
    expect((await listFitFeedback(alice, "tee-classic-crew")).map((f) => f.overall)).toEqual(["true"]);
    expect(await listFitFeedback(bob)).toHaveLength(0);
  });

  it("blocks adding designs with validation errors to the cart", async () => {
    const { project } = await createProject(alice, { modelId: "tee-classic-crew", audience: "men" });
    const cfg = createDesign("tee-classic-crew", "men");
    cfg.fabric.id = "pure-linen";
    await saveProject(alice, project.id, { config: cfg });
    await expect(addToCart(alice, { projectId: project.id, quantity: 1 })).rejects.toMatchObject({ code: "design_invalid" });
  });
});

describe("integration manager", () => {
  it("never activates a provider without a passing test and stores secrets encrypted", async () => {
    const admin = (await (await getDb()).select().from(s.users).where(eq(s.users.role, "admin")))[0];
    await expect(saveCredentials("razorpay", { keyId: "bad", keySecret: "x" }, admin.id)).rejects.toThrow(/invalid format/);
    await saveCredentials("razorpay", { keyId: "rzp_test_ABC123", keySecret: "super-secret-value" }, admin.id);
    const [row] = await (await getDb()).select().from(s.integrationConfigs).where(eq(s.integrationConfigs.providerId, "razorpay"));
    expect(row.credentialsEncrypted).not.toContain("super-secret-value");
    expect(await getActiveIntegration("razorpay")).toBeNull();
    await expect(setEnabled("razorpay", true, "test", admin.id)).rejects.toThrow(/successful connection test/);
    await recordTest("razorpay", true, null);
    await setEnabled("razorpay", true, "test", admin.id);
    expect((await getActiveIntegration("razorpay"))?.credentials.keyId).toBe("rzp_test_ABC123");
    const view = (await listIntegrations()).find((i) => i.def.id === "razorpay")!;
    expect(view.status).toBe("test");
    expect(view.maskedCredentials.keySecret).toBe("••••••alue");
    // saving new credentials resets to untested + disabled
    await saveCredentials("razorpay", { keyId: "rzp_test_ABC124", keySecret: "" }, admin.id);
    expect(await getActiveIntegration("razorpay")).toBeNull();
  });
});

describe("uploads", () => {
  it("detects types from magic bytes and reads dimensions", () => {
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452000001f4000000c80806000000", "hex");
    expect(detectType(png)?.mime).toBe("image/png");
    expect(rasterSize(png, "image/png")).toEqual({ width: 500, height: 200 });
    expect(detectType(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))?.mime).toBe("image/svg+xml");
    expect(detectType(Buffer.from("<html><script>1</script></html>"))).toBeNull();
    expect(detectType(Buffer.from("MZ\x90\x00"))).toBeNull();
  });
});

describe("measurement provenance", () => {
  it("stores per-field provenance and never lets camera estimates claim high confidence", async () => {
    const p = await upsertMeasurementProfile(alice, { name: "Cam", audience: "men", measurements: { chest: 98, shoulder: 45 }, provenance: { shoulder: { source: "camera", confidence: "high", toleranceCm: 3 } } });
    expect((p.provenance as Record<string, { confidence: string }>).shoulder.confidence).toBe("medium");
    const plain = await upsertMeasurementProfile(alice, { name: "Tape", audience: "men", measurements: { chest: 98 } });
    expect(plain.provenance).toEqual({});
  });
});

describe("custom fonts", () => {
  it("stores fonts privately with rights metadata and enforces ownership", async () => {
    const dir = path.join(process.cwd(), "public/fonts/inter");
    const bytes = readFileSync(path.join(dir, readdirSync(dir).find((f) => f.endsWith(".woff2"))!));
    const font = await storeFont(alice, { name: "brand.woff2", bytes }, "Alice Brand");
    expect(font.family).toMatch(/^Alice Brand MV[0-9a-f]{6}$/);
    expect(font.mime).toBe("font/woff2");
    expect((await listFonts(alice)).map((f) => f.id)).toContain(font.id);
    expect(await listFonts(bob)).toHaveLength(0);
    await expect(readUpload(bob, font.id)).rejects.toBeTruthy();
    expect((await readUpload(staff, font.id)).bytes.length).toBe(bytes.length);
    await expect(storeFont(alice, { name: "x.ttf", bytes: Buffer.from("<svg onload=alert(1)>") }, "Bad")).rejects.toMatchObject({ status: 415 });
    await expect(deleteFont(bob, font.id)).rejects.toBeTruthy();
    await deleteFont(alice, font.id);
    expect(await listFonts(alice)).toHaveLength(0);
  });
});

describe("account deletion", () => {
  it("anonymises the user and removes personal data", async () => {
    const carol = await makeUser("carol@example.com");
    await createChild(carol, { nickname: "C", birthYear: new Date().getFullYear() - 5, consent: true, allowSharing: false });
    await deleteAccount(carol);
    const db = await getDb();
    const [u] = await db.select().from(s.users).where(eq(s.users.id, carol.id));
    expect(u.status).toBe("deleted");
    expect(u.email).toMatch(/@deleted\.invalid$/);
    expect(await db.select().from(s.childProfiles).where(eq(s.childProfiles.guardianUserId, carol.id))).toHaveLength(0);
  });
});
