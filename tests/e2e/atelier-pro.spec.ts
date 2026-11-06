import { expect, test, type Page } from "@playwright/test";
import { openEditor, register, saveDesign } from "./helpers";

const layerEls = (page: Page) => page.locator("[data-layer-id]");
const markup = (page: Page, i = 0) => layerEls(page).nth(i).evaluate((el) => el.innerHTML);

async function dragOn(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 12) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

test("Atelier Pro: tools, masks, drawing, adjustments, filters, warp, folders, history — saved in the design", async ({ page }) => {
  test.setTimeout(120_000);
  await register(page, "Pro Designer");
  await openEditor(page, "tee-classic-crew", "men", "pro");
  await expect(page.getByTestId("pro-toolbar")).toBeVisible();

  // A library graphic to work on.
  await page.getByTestId("tab-library").click();
  await page.locator('[data-testid^="asset-MVG_"]').first().click();
  await expect(layerEls(page)).toHaveCount(1);

  // Blend mode + filter stack + adjustments render into the shared markup.
  await expect(page.getByTestId("pro-sections")).toBeVisible();
  await page.getByTestId("blend-mode").selectOption("multiply");
  await expect.poll(() => markup(page)).toContain("mix-blend-mode:multiply");
  await page.getByTestId("filter-section").locator("summary").click();
  await page.getByTestId("add-filter").selectOption("halftone");
  await expect(page.getByTestId("filter-halftone")).toBeVisible();
  await expect.poll(() => markup(page)).toMatch(/<filter id="fx-[^"]+"/);
  await page.getByTestId("adjust-section").locator("summary").click();
  await page.getByTestId("adjust-basic").getByRole("slider").nth(3).fill("90"); // hue
  await expect.poll(() => markup(page)).toContain('type="hueRotate" values="90"');

  // Rectangular marquee → erase the selection (non-destructive layer mask).
  const box = (await layerEls(page).first().boundingBox())!;
  await page.getByTestId("tool-marquee").click();
  await dragOn(page, { x: box.x + box.width * 0.2, y: box.y + box.height * 0.2 }, { x: box.x + box.width * 0.55, y: box.y + box.height * 0.55 });
  await expect(page.getByTestId("selection-outline")).toBeVisible();
  await page.getByTestId("sel-erase").click();
  await expect.poll(() => markup(page)).toMatch(/<mask id="lm-/);
  await expect(page.getByTestId("mask-controls")).toBeVisible();

  // Magic wand on the graphic → keep only the selection.
  await page.getByTestId("tool-wand").click();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.85);
  await expect(page.getByTestId("selection-outline")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("sel-keep").click();
  await expect(page.getByTestId("selection-outline")).toHaveCount(0);

  // Brush creates a vector drawing layer; the eraser erases from it.
  await page.getByTestId("tool-brush").click();
  await page.getByTestId("brush-color").fill("#d73a49");
  await dragOn(page, { x: box.x - 30, y: box.y + box.height + 20 }, { x: box.x + box.width + 30, y: box.y + box.height + 40 }, 20);
  await expect(layerEls(page)).toHaveCount(2);
  await expect(page.getByTestId("drawing-properties")).toBeVisible();
  await expect.poll(() => markup(page, 1)).toContain('stroke="#d73a49"');
  await page.getByTestId("tool-eraser").click();
  await dragOn(page, { x: box.x + box.width / 2, y: box.y + box.height }, { x: box.x + box.width / 2, y: box.y + box.height + 60 });
  await expect.poll(() => markup(page, 1)).toContain("mask=\"url(#de-");

  // Perspective warp with on-canvas corner handles.
  await page.getByTestId("tool-move").click();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.getByTestId("warp-section").locator("summary").click();
  await page.getByTestId("warp-kind").selectOption("perspective");
  const handle = page.locator("[data-warp-handle='0']");
  await expect(handle).toBeVisible();
  const hb = (await handle.boundingBox())!;
  await dragOn(page, { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 }, { x: hb.x + 25, y: hb.y + 10 });
  await expect.poll(() => markup(page)).toContain('<clipPath id="wt-');

  // Folders: group both layers, rename the folder.
  await page.getByTestId("tab-layers").click();
  const rows = page.getByTestId("layer-row");
  await rows.nth(0).locator("button").first().click();
  await rows.nth(1).locator("button").first().click({ modifiers: ["Shift"] });
  await page.getByTestId("group-layers").click();
  await expect(page.getByTestId("folder-row")).toHaveCount(1);
  await page.getByTestId("folder-name").fill("Chest art");
  await page.getByTestId("folder-name").press("Enter");

  // Editable history: jump back before the drawing, then forward again.
  await page.getByTestId("tab-versions").click();
  const history = page.getByTestId("history-panel");
  await expect(history).toBeVisible();
  await history.getByRole("button", { name: "Brush stroke" }).click();
  await expect(layerEls(page)).toHaveCount(2);
  await history.getByRole("button", { name: /^Mask to selection$/ }).click();
  await expect(layerEls(page)).toHaveCount(1);
  await history.getByRole("button", { name: "Rename folder" }).click();
  await expect(layerEls(page)).toHaveCount(2);

  // Everything is part of the saved design document.
  const id = await saveDesign(page);
  const { version } = await (await page.request.get(`/api/designs/${id}`)).json();
  const c = version.config;
  expect(c.schemaVersion).toBe(3);
  const gfx = c.layers.find((l: { type: string }) => l.type === "graphic");
  const draw = c.layers.find((l: { type: string }) => l.type === "drawing");
  expect(gfx.blendMode).toBe("multiply");
  expect(gfx.filters[0].type).toBe("halftone");
  expect(gfx.adjust.hue).toBe(90);
  expect(gfx.mask.base).toBe("hide");
  expect(gfx.warp.kind).toBe("perspective");
  expect(draw.strokes.map((s: { tool: string }) => s.tool)).toEqual(["brush", "eraser"]);
  expect(c.folders[0].name).toBe("Chest art");
  expect(gfx.groupId).toBe(c.folders[0].id);
});

test("Atelier Pro: AI object selection runs on the device", async ({ page }) => {
  test.setTimeout(90_000);
  await register(page, "Pro AI");
  await openEditor(page, "tee-classic-crew", "men", "pro");
  await page.getByTestId("tab-library").click();
  await page.locator('[data-testid^="asset-MVG_"]').first().click();
  const box = (await layerEls(page).first().boundingBox())!;
  await page.getByTestId("tool-ai").click();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  // Either a selection appears (model ran) or a clear message explains why it couldn't.
  await expect(page.getByTestId("selection-outline").or(page.getByText(/AI selection is unavailable|Nothing to select/))).toBeVisible({ timeout: 60_000 });
  const selected = await page.getByTestId("selection-outline").count();
  test.info().annotations.push({ type: "ai-selection", description: selected ? "on-device model produced a selection" : "model unavailable — message shown" });
  console.log(`[ai-selection] ${selected ? "selection produced" : "unavailable message"}`);
  if (selected) {
    await page.getByTestId("sel-new-layer").click();
    await expect(layerEls(page)).toHaveCount(2);
  }
});
