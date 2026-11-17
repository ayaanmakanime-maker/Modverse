import { expect, test } from "@playwright/test";
import { register } from "./helpers";

// a small opaque PNG (2 × 2, white and red), so adjustments have pixels to work on
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAE0lEQVR4nGP4////BQUFBiAGsgA6JAgb+jYMogAAAABJRU5ErkJggg==", "base64");

test("Atelier and Atelier Pro on a shop style: all-over print, drawing, image adjustments, layers, versions, tech sheet", async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await register(page, "Atelier Maker");
  const origin = new URL(page.url()).origin;
  await page.goto("/design/garment/new?garment=elvs-male-shirt-untucked-bd1&mode=atelier&fabric=poplin-110");
  const root = page.getByTestId("mto");
  await expect(root).toHaveAttribute("data-mode", "atelier");
  for (const t of ["colour", "size", "artwork", "pattern", "layers", "versions", "order"]) await expect(page.getByTestId(`gd-tab-${t}`)).toBeVisible();
  await expect(page.getByTestId("gd-tab-techpack")).toHaveCount(0); // Atelier Pro only
  const price = async () => Number(await root.getAttribute("data-price"));
  const p0 = await price();

  // all-over print from my own tile: priced, previewed, manufacturable on poplin
  await page.getByTestId("gd-tab-pattern").click();
  await expect(page.getByTestId("ao-panel")).toBeVisible();
  await page.getByTestId("ao-src-mine").click();
  await page.getByTestId("ao-upload").setInputFiles({ name: "tile.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByTestId("ao-current")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("ao-scale").fill("20");
  await expect(page.getByTestId("ao-current")).toContainText("20 cm repeat");
  await expect.poll(price).toBeGreaterThan(p0);
  await expect(root).toHaveAttribute("data-valid", "yes");

  // artwork: an upload, adjusted (a new image of mine replaces it), text with a shadow, and a drawing
  await page.getByTestId("gd-tab-artwork").click();
  await page.getByTestId("mto-art-upload").setInputFiles({ name: "crest.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByTestId("mto-art-item")).toHaveCount(1, { timeout: 30_000 });
  await page.getByTestId("mto-art-adjust").click();
  await page.getByTestId("adj-knockout").check();
  await page.getByTestId("adj-apply").click();
  await expect(page.getByText("Adjustments applied")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("mto-art-tab-text").click();
  await page.getByTestId("mto-text").fill("ATELIER");
  await page.getByTestId("mto-text-add").click();
  await expect(page.getByTestId("mto-art-item")).toHaveCount(2);
  await page.getByTestId("mto-text-shadow").last().check();
  await page.getByTestId("mto-art-tab-draw").click();
  const pad = page.getByTestId("draw-canvas");
  await pad.scrollIntoViewIfNeeded();
  const b = (await pad.boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.2, b.y + b.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.8, b.y + b.height * 0.7, { steps: 12 });
  await page.mouse.up();
  await page.getByTestId("draw-place").click();
  await expect(page.getByTestId("mto-art-item")).toHaveCount(3, { timeout: 30_000 });

  // layers: a hidden layer is kept but neither printed nor charged; a locked one cannot be moved
  const p1 = await price();
  await page.getByTestId("gd-tab-layers").click();
  await expect(page.getByTestId("layer-row")).toHaveCount(3);
  await expect(page.getByTestId("layer-allover")).toBeVisible();
  await page.getByTestId("layer-visible").first().click();
  await expect.poll(price).toBeLessThan(p1);
  await page.getByTestId("layer-lock").last().click();
  await page.getByTestId("gd-tab-artwork").click();
  await expect(page.getByTestId("mto-art-width").first()).toBeDisabled();

  // versions: save, change, restore
  await page.getByTestId("design-name").fill("Atelier shirt");
  await page.getByTestId("gd-save").click();
  await expect(page).toHaveURL(/\/design\/garment\/[0-9a-f-]{36}/);
  await page.getByTestId("gd-tab-versions").click();
  await page.getByTestId("version-note").fill("First draft");
  await page.getByTestId("version-save").click();
  await expect(page.getByTestId("version-row")).toHaveCount(1, { timeout: 30_000 });
  await page.getByTestId("gd-tab-colour").click();
  const colours = page.getByRole("radiogroup", { name: "Colour" }).getByRole("radio");
  const before = await colours.evaluateAll((els) => els.findIndex((e) => e.getAttribute("aria-checked") === "true"));
  await colours.nth(before === 0 ? 1 : 0).click();
  await page.getByTestId("gd-tab-versions").click();
  await page.getByTestId("version-restore").click();
  await page.getByTestId("gd-tab-colour").click();
  await expect(colours.nth(before)).toHaveAttribute("aria-checked", "true");

  // Atelier Pro: exact placement, alignment and the tech sheet
  await page.getByRole("radio", { name: "Atelier Pro" }).click();
  await expect(root).toHaveAttribute("data-mode", "pro");
  await page.getByTestId("gd-tab-artwork").click();
  await expect(page.getByTestId("mto-art-precise").first()).toBeVisible();
  await page.getByTestId("gd-tab-techpack").click();
  await expect(page.getByTestId("techsheet-panel")).toContainText("All-over print");
  await expect(page.getByTestId("techsheet-panel")).toContainText("20 cm repeat");

  // ordering: the server takes the all-over print; switched-off layers are not part of the order
  await page.getByTestId("gd-tab-order").click();
  await page.getByTestId("mto-add").click();
  await expect(page.getByText("Added to your cart")).toBeVisible({ timeout: 30_000 });
  const cart = await (await page.request.get("/api/cart", { headers: { origin } })).json();
  const options = cart.cart.lines.find((l: { kind: string }) => l.kind === "library").library.options;
  expect(options.allOver.scaleCm).toBe(20);
  expect(options.artwork.some((a: { hidden?: boolean }) => a.hidden)).toBe(false);
  expect(options.artwork).toHaveLength(2);
  expect(errors).toEqual([]);
});
