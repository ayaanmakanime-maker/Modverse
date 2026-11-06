import { expect, test } from "@playwright/test";
import { openEditor, register, saveDesign } from "./helpers";

test("Studio library: search by interest, place anywhere (front/back/sleeve), palette swap, templates, all-over pattern", async ({ page }) => {
  await register(page, "Library Tester");
  await openEditor(page, "shirt-classic-formal", "men", "atelier");
  await page.getByTestId("tab-library").click();
  const panel = page.getByTestId("library-panel");

  // Search by interest across both libraries (new original artwork)
  await panel.getByLabel("Search library").fill("diwali");
  const diya = panel.locator("[data-testid^=asset-MXG_]").first();
  await expect(diya).toBeVisible({ timeout: 15_000 });
  await diya.click();
  await expect(page.locator("[data-layer-id]")).toHaveCount(1);

  // Recolour the whole graphic with a palette in one tap
  const before = await page.locator("[data-layer-id]").first().innerHTML();
  await page.getByTestId("palette-swap").getByTestId("swap-MXC_003").click();
  await expect.poll(async () => page.locator("[data-layer-id]").first().innerHTML()).not.toBe(before);

  // Place other artwork on the back and on a sleeve
  await page.getByTestId("zone-back").click();
  await panel.getByLabel("Search library").fill("mandala");
  await panel.locator("[data-testid^=asset-MXG_]").first().click();
  await expect(page.locator("[data-layer-id]")).toHaveCount(1);
  await page.getByTestId("zone-sleeveLeft").click();
  await panel.getByRole("button", { name: "Stickers" }).click();
  await panel.getByLabel("Search library").fill("sparkle");
  await panel.locator("[data-testid^=asset-MXE_]").first().click();
  await expect(page.locator("[data-layer-id]")).toHaveCount(1);

  // Editable-text template becomes real typography layers
  await page.getByTestId("zone-front").click();
  await expect(page.locator("[data-layer-id]")).toHaveCount(1);
  await panel.getByRole("button", { name: "Templates" }).click();
  await panel.getByLabel("Search library").fill("badge");
  await panel.locator("[data-testid^=asset-MXT_]").first().click();
  await expect(page.locator("[data-layer-id]").first()).toBeVisible();
  await expect.poll(async () => page.locator("[data-layer-id]").count()).toBeGreaterThan(2);

  // All-over seamless pattern on body and sleeves
  await panel.getByRole("button", { name: "Patterns" }).click();
  await panel.getByLabel("Pattern target panel").selectOption("allover");
  await panel.getByLabel("Search library").fill("paisley");
  await panel.locator("[data-testid^=asset-MXP_]").first().click();
  // The 2D flat shows the pattern on the body too (not just in 3D)
  await expect(page.locator('[data-testid="canvas-2d"] pattern[id$="pat-front"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="canvas-2d"] pattern[id$="pat-sleeveLeft"]')).toHaveCount(1);

  const id = await saveDesign(page);
  const c = (await (await page.request.get(`/api/designs/${id}`)).json()).version.config;
  const zones = new Set(c.layers.map((l: { zone: string }) => l.zone));
  expect([...zones].sort()).toEqual(expect.arrayContaining(["back", "front", "sleeveLeft"]));
  expect(c.layers.some((l: { assetId?: string; colorMap?: Record<string, string> }) => l.assetId?.startsWith("MXG_") && Object.keys(l.colorMap ?? {}).length > 0)).toBe(true);
  const texts = c.layers.filter((l: { type: string }) => l.type === "text");
  expect(texts.length).toBeGreaterThan(0);
  expect(texts.some((l: { fontFamily: string }) => l.fontFamily !== "Inter")).toBe(true); // template fonts are kept
  for (const p of ["front", "back", "sleeveLeft", "sleeveRight"]) expect(c.panels[p].patternId, p).toMatch(/^MXP_/);

  // The 3D view renders the same design without errors
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByRole("radiogroup", { name: "Canvas view" }).getByRole("radio", { name: "3D" }).click();
  await expect(page.getByTestId("garment-3d").locator("canvas")).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(2500);
  expect(errors).toEqual([]);
});
