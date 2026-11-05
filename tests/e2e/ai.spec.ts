import { expect, test } from "@playwright/test";
import { openEditor, register, saveDesign } from "./helpers";

const ORIGIN = { Origin: "http://localhost:3100" };

test("AI pipeline: Fashion Director proposal → preview → one undoable transaction → saved design", async ({ page }) => {
  await register(page, "Muse User");
  await openEditor(page, "tee-classic-crew", "men", "studio");
  await page.getByTestId("tab-muse").click();
  await page.getByTestId("muse-input").fill("Create a black oversized T-shirt with Japanese cyberpunk artwork on the back, red typography on the front and wider sleeves.");
  await page.keyboard.press("Enter");
  const card = page.getByTestId("muse-proposal").last();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText("Garment");
  await expect(card).toContainText("Artwork");
  await expect(card).toContainText("Typography");
  await expect(card).toContainText("Estimated price");
  // Preview only — the canvas is unchanged until the transaction is applied.
  await expect(page.locator("[data-layer-id]")).toHaveCount(0);
  await page.getByTestId("muse-apply").last().click();
  await expect(card).toContainText("Applied");
  await page.getByTestId("zone-back").click();
  await expect(page.locator("[data-layer-id]")).toHaveCount(1);

  // One undo step reverts the whole transaction; redo restores it.
  await page.getByTestId("undo").click();
  await page.getByTestId("zone-front").click();
  await expect(page.locator("[data-layer-id]")).toHaveCount(0);
  await page.getByTestId("redo").click();
  await expect(page.locator("[data-layer-id]")).toHaveCount(1);

  const id = await saveDesign(page);
  const { version } = await (await page.request.get(`/api/designs/${id}`)).json();
  const c = version.config;
  expect(c.modelId).toBe("tee-oversized");
  expect(c.fabric.color).toBe("#0B0B0B");
  expect(c.adjustments.sleeveWidth).toBeGreaterThan(0);
  expect(c.layers.some((l: { zone: string; type: string }) => l.zone === "back" && l.type === "graphic")).toBe(true);
  expect(c.layers.some((l: { zone: string; type: string }) => l.zone === "front" && l.type === "text")).toBe(true);
});

test("design compiler rejects unsafe or unsupported proposals with reasons", async ({ request }) => {
  const res = await request.post("/api/muse/compile", {
    headers: ORIGIN,
    data: {
      config: null,
      proposal: {
        version: "modverse.proposal/1",
        summary: "hostile",
        garment: { modelId: "rocket-suit" },
        construction: { "__proto__.polluted": "yes", zipper: "gold" },
        typography: [{ text: "HELLO", placement: "center-chest", style: { fontFamily: "Inter", onload: "alert(1)" } }],
        artwork: [{ ref: "a", description: "something that does not exist anywhere zzqx", placement: "full-back", source: "generate" }],
      },
    },
  });
  expect(res.status()).toBe(200);
  const r = await res.json();
  const reasons = r.transaction.rejected.map((x: { item: string; reason: string }) => `${x.item} ${x.reason}`).join(" | ");
  expect(reasons).toMatch(/rocket-suit/);
  expect(reasons).toMatch(/zipper/);
  expect(reasons).toMatch(/polluted|not allowed/i);
  expect(JSON.stringify(r.transaction.ops)).not.toContain("onload");
  expect(r.transaction.artwork[0].source).not.toBe("generated");
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  // Malformed proposals are refused outright.
  const bad = await request.post("/api/muse/compile", { headers: ORIGIN, data: { config: null, proposal: { version: "something-else" } } });
  expect(bad.status()).toBe(400);
});
