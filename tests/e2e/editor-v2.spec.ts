import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { openEditor, register, saveDesign } from "./helpers";

async function pngOf(page: Page, w: number, h: number): Promise<Buffer> {
  const dataUrl = await page.evaluate(([cw, ch]) => {
    const c = document.createElement("canvas");
    c.width = cw;
    c.height = ch;
    const g = c.getContext("2d")!;
    const grad = g.createLinearGradient(0, 0, cw, ch);
    grad.addColorStop(0, "#C9B896");
    grad.addColorStop(1, "#1B2A47");
    g.fillStyle = grad;
    g.fillRect(0, 0, cw, ch);
    return c.toDataURL("image/png");
  }, [w, h]);
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

const layers = (page: Page) => page.locator("[data-layer-id]");

test("V2 editor: drag & drop typography, clipboard, zoom/pan, title case, layered effects, crop, custom fonts and cuff surface", async ({ page }) => {
  await register(page, "V2 Designer");
  await openEditor(page, "shirt-classic-formal", "men", "atelier");

  // Cuff surface exists on a shirt with barrel cuffs.
  await expect(page.getByTestId("zone-cuffs")).toBeVisible();

  // Drag a typography asset from the Creative Library onto the garment.
  await page.getByTestId("tab-library").click();
  await page.getByTestId("library-panel").getByRole("button", { name: "Typography", exact: true }).click();
  await expect(page.getByTestId("typography-grid")).toBeVisible();
  await page.getByTestId("typo-TY_007").dragTo(page.getByTestId("canvas-drop"));
  await expect(layers(page)).toHaveCount(1);

  // It is an ordinary editable text layer: title case + layered effect.
  const props = page.getByTestId("text-properties").first();
  await expect(props).toBeVisible();
  await props.getByRole("radio", { name: "Tt" }).click();
  await expect(layers(page).first().locator(".mv-text-content")).toContainText("The Art of the Everyday");
  await props.getByTestId("add-effect").selectOption("extrude");
  await expect(layers(page).first().locator('[fill="#7C2D12"]').first()).toBeAttached();

  // Clipboard: copy + paste duplicates the layer (new id), undo removes it.
  await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => undefined);
  await layers(page).first().click();
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  await expect(layers(page)).toHaveCount(2);
  await page.keyboard.press("Control+z");
  await expect(layers(page)).toHaveCount(1);

  // Zoom (vector viewBox) and pan with the hand tool.
  const svg = page.getByTestId("canvas-2d");
  const vb0 = await svg.getAttribute("viewBox");
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(page.getByTestId("zoom-level")).toHaveText("125%");
  await page.getByTestId("hand-tool").click();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 40, { steps: 5 });
  await page.mouse.up();
  expect(await svg.getAttribute("viewBox")).not.toBe(vb0);
  await page.getByTestId("hand-tool").click();
  await page.keyboard.press("Control+0");
  await expect(page.getByTestId("zoom-level")).toHaveText("100%");

  // Upload a real raster and crop it: DPI reflects the cropped pixels and the crop is in the config.
  await page.getByTestId("tab-upload").click();
  await page.getByTestId("upload-input").setInputFiles({ name: "gradient.png", mimeType: "image/png", buffer: await pngOf(page, 2400, 1200) });
  await expect(layers(page)).toHaveCount(2);
  const img = page.getByTestId("image-properties").first();
  const dpiBefore = parseInt((await img.getByTestId("image-dpi").textContent())!, 10);
  await img.getByTestId("crop-controls").getByLabel("Left", { exact: true }).fill("40");
  await expect(layers(page).nth(1).locator("svg[viewBox]")).toBeAttached();
  const dpiAfter = parseInt((await img.getByTestId("image-dpi").textContent())!, 10);
  expect(Math.abs(dpiAfter - dpiBefore)).toBeLessThanOrEqual(2); // print scale is preserved while cropping

  // Custom font: upload with rights confirmation, then use it.
  await page.getByTestId("tab-text").click();
  const dir = path.join(process.cwd(), "public/fonts/pacifico");
  const woff2 = readFileSync(path.join(dir, readdirSync(dir).find((f) => f.endsWith(".woff2"))!));
  const upload = page.getByTestId("text-panel").getByTestId("font-upload");
  await upload.getByTestId("font-file").setInputFiles({ name: "brand-script.woff2", mimeType: "font/woff2", buffer: woff2 });
  await upload.getByLabel("Font display name").fill("Brand Script");
  await expect(upload.getByTestId("font-upload-btn")).toBeDisabled();
  await upload.getByTestId("font-rights").check();
  await upload.getByTestId("font-upload-btn").click();
  await page.getByTestId("text-panel").getByRole("button", { name: "Use", exact: true }).first().click();
  await expect(layers(page)).toHaveCount(3);

  // Cuff monogram on the cuff surface.
  await page.getByTestId("zone-cuffs").click();
  await page.locator("#new-text").fill("RS");
  await page.getByTestId("add-text").click();
  await expect(layers(page)).toHaveCount(1); // only the cuff layer is shown on the cuff surface

  const id = await saveDesign(page);
  const { version } = await (await page.request.get(`/api/designs/${id}`)).json();
  const c = version.config;
  expect(c.schemaVersion).toBe(3);
  const title = c.layers.find((l: { name: string }) => l.name === "Title-case headline");
  expect(title.textTransform).toBe("title");
  expect(title.effects[0].kind).toBe("extrude");
  const image = c.layers.find((l: { type: string }) => l.type === "image");
  expect(image.crop.x).toBeCloseTo(0.4, 2);
  const custom = c.layers.find((l: { fontAssetId: string | null }) => l.fontAssetId);
  expect(custom.fontFamily).toMatch(/^Brand Script MV[0-9a-f]{6}$/);
  expect(c.layers.some((l: { zone: string }) => l.zone === "cuffs")).toBe(true);
  // The font file is private: another visitor cannot fetch it.
  const fontUrl = `/api/uploads/${custom.fontAssetId}`;
  expect((await page.request.get(fontUrl)).status()).toBe(200);
  await page.context().clearCookies();
  expect((await page.request.get(fontUrl)).status()).toBe(401);
});
