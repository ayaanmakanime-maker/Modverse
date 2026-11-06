/**
 * Meta Muse Image integration — against a SIMULATED Meta API (tests/stubs/meta-muse-sim.ts).
 * Proves the ModVerse side: inactive until tested + enabled, request shape, secrets handling,
 * billing / auth / rate-limit errors, graceful fallback. The real API has been exercised only
 * for authentication and model listing (generation answered HTTP 402: billing not set up).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
process.env.MODVERSE_DB = "memory";
process.env.MODVERSE_DATA_DIR = ".data/test-image-provider";
process.env.MODVERSE_DEMO_ACCOUNTS = "false";
process.env.ADMIN_PASSWORD = "Integration-Test-Admin-9!";

import { readFileSync } from "node:fs";
import path from "node:path";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import { recordTest, saveCredentials, setEnabled, loadCredentials } from "@/lib/integrations/config";
import { testIntegration } from "@/lib/integrations/tests";
import { generateArtwork, imageProviderStatus } from "@/lib/ai/image";
import { museSim } from "../stubs/meta-muse-sim";

const RUN = Math.random().toString(36).slice(2, 8);
const png = readFileSync(path.join(process.cwd(), "public/brand/derived/modverse-app-icon-512.png"));
let user: SessionUser, admin: SessionUser;

async function makeUser(email: string, role: "customer" | "admin" = "customer"): Promise<SessionUser> {
  const db = await getDb();
  const [u] = await db.insert(s.users).values({ email, name: email.split("@")[0], passwordHash: await hashPassword("Correct-Horse-Battery-9"), role }).returning();
  return { id: u.id, email: u.email, name: u.name, role: u.role, emailVerified: false, isGuest: false, sessionId: "test" };
}
const KEY = "LLM_sim_0123456789_abcdefghijklmnop";

beforeAll(async () => {
  user = await makeUser(`maya+${RUN}@example.com`);
  admin = await makeUser(`ops+${RUN}@example.com`, "admin");
}, 120_000);
afterAll(() => vi.unstubAllGlobals());

describe("Meta Muse Image provider (simulated API)", () => {
  it("is inactive until the key is saved, tested and enabled — and never fakes images", async () => {
    expect(await imageProviderStatus()).toEqual({ available: false, provider: null });
    await expect(generateArtwork(user, "a tiger head")).rejects.toMatchObject({ status: 503, code: "no_image_provider" });
    await saveCredentials("meta-muse", { apiKey: KEY }, admin.id);
    expect(await imageProviderStatus()).toEqual({ available: false, provider: null }); // saved ≠ active
    const sim = museSim({ png });
    vi.stubGlobal("fetch", sim.fetchImpl);
    const t = await testIntegration("meta-muse", (await loadCredentials("meta-muse")).creds!);
    expect(t.ok).toBe(true);
    expect(t.message).toMatch(/billed by Meta/);
    expect(sim.requests.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /v1/models"]); // free call only: nothing generated
    await recordTest("meta-muse", true, t.message);
    await setEnabled("meta-muse", true, "live", admin.id);
    expect(await imageProviderStatus()).toEqual({ available: true, provider: "meta-muse" });
  });

  it("rejects a bad key at test time and a missing model", async () => {
    vi.stubGlobal("fetch", museSim({ png, key: "LLM_other_0123456789_zzzzzzzzzz" }).fetchImpl);
    expect(await testIntegration("meta-muse", { apiKey: KEY })).toMatchObject({ ok: false, message: expect.stringMatching(/rejected the API key \(401\)/) });
    vi.stubGlobal("fetch", museSim({ png, models: ["muse-spark-1.3"] }).fetchImpl);
    expect(await testIntegration("meta-muse", { apiKey: KEY })).toMatchObject({ ok: false, partial: true });
  });

  it("generates with the documented request shape and stores the images privately", async () => {
    const sim = museSim({ png });
    vi.stubGlobal("fetch", sim.fetchImpl);
    const r = await generateArtwork(user, "a bold tiger head sticker", 2);
    expect(r.provider).toBe("meta-muse");
    expect(r.images).toHaveLength(2);
    expect(r.images[0]).toMatchObject({ kind: "generated" });
    const req = sim.requests.find((x) => x.path === "/v1/images/generations")!;
    expect(req.auth).toBe(`Bearer ${KEY}`);
    expect(req.body).toMatchObject({ model: "muse-image-1.0", n: 2, size: "1024x1024", response_format: "b64_json", output_format: "png", reasoning_strength: "low", tool_enablement: { enable_image_search: false, enable_web_search: false, enable_shell: false } });
    expect(String(req.body!.prompt)).toContain("a bold tiger head sticker");
    expect(String(req.body!.prompt)).toMatch(/apparel printing/);
    expect(JSON.stringify(r)).not.toContain(KEY); // the key never reaches the response
    const [log] = (await (await getDb()).select().from(s.auditLogs)).filter((l) => l.action === "ai.image_generate");
    expect(log.details).toMatchObject({ provider: "meta-muse", images: 2 });
    expect(JSON.stringify(log)).not.toContain(KEY);
  });

  it("downloads url results over https only", async () => {
    vi.stubGlobal("fetch", museSim({ png, useUrl: true }).fetchImpl);
    const r = await generateArtwork(user, "paisley pattern", 1);
    expect(r.images).toHaveLength(1);
  });

  it("falls back to the minimal request when an API revision rejects the optional extras", async () => {
    const sim = museSim({ png, rejectExtras: true });
    vi.stubGlobal("fetch", sim.fetchImpl);
    const r = await generateArtwork(user, "lotus line art", 1);
    expect(r.images).toHaveLength(1);
    const calls = sim.requests.filter((x) => x.path === "/v1/images/generations");
    expect(calls).toHaveLength(2);
    expect(calls[1].body).not.toHaveProperty("tool_enablement");
  });

  it("explains billing, auth and rate-limit problems instead of failing silently", async () => {
    vi.stubGlobal("fetch", museSim({ png, billing402: true }).fetchImpl);
    await expect(generateArtwork(user, "x art")).rejects.toMatchObject({ status: 402, code: "image_provider_billing", message: expect.stringMatching(/billing/i) });
    vi.stubGlobal("fetch", museSim({ png, key: "LLM_other_0123456789_zzzzzzzzzz" }).fetchImpl);
    await expect(generateArtwork(user, "x art")).rejects.toMatchObject({ code: "image_provider_auth" });
    vi.stubGlobal("fetch", museSim({ png, rateLimit: true }).fetchImpl);
    await expect(generateArtwork(user, "x art")).rejects.toMatchObject({ status: 429, code: "image_provider_rate_limit" });
  });
});
