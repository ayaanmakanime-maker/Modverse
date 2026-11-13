import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { openEditor, register } from "./helpers";

/** Upload robustness: large phone images, missing MIME types, unsupported formats, and artwork on made-to-order garments. */
test("PNG uploads: a 36 MB photo is optimised in the browser, a typeless upload is recognised, unsupported files get a clear message", async ({ page }) => {
  test.setTimeout(180_000);
  await register(page, "Upload Tester");
  await openEditor(page, "tee-classic-crew", "men", "pro");
  await page.getByTestId("tab-upload").click();
  // 3000 × 3000 RGBA noise: incompressible, ~36 MB as PNG — over the 12 MB limit unless the browser optimises it
  const raw = Buffer.alloc(3000 * 3000 * 4);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24;
  for (let i = 3; i < raw.length; i += 4) raw[i] = 255;
  const big = await sharp(raw, { raw: { width: 3000, height: 3000, channels: 4 } }).png({ compressionLevel: 0 }).toBuffer();
  expect(big.length).toBeGreaterThan(12 * 1024 * 1024);
  const sizes: number[] = [];
  page.on("request", (r) => { if (r.url().endsWith("/api/uploads") && r.method() === "POST") sizes.push(r.postDataBuffer()?.length ?? 0); });
  await page.getByTestId("upload-input").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: big });
  await expect(page.locator("[data-layer-id]")).toHaveCount(1, { timeout: 90_000 });
  expect(sizes.length).toBe(1);
  expect(sizes[0]).toBeLessThan(12 * 1024 * 1024);

  // an Android picker that sends no type: the PNG is recognised from its bytes
  const small = await sharp({ create: { width: 600, height: 400, channels: 4, background: { r: 200, g: 30, b: 60, alpha: 0.5 } } }).png().toBuffer();
  await page.getByTestId("upload-input").setInputFiles({ name: "IMG_2041.PNG", mimeType: "application/octet-stream", buffer: small });
  await expect(page.locator("[data-layer-id]")).toHaveCount(2, { timeout: 30_000 });
  // transparency is kept (PNG stays PNG)
  const list = (await (await page.request.get("/api/uploads")).json()).uploads as { mime: string; width: number }[];
  expect(list.some((u) => u.mime === "image/png" && u.width === 600)).toBe(true);

  // a GIF the browser can read is converted to PNG (first frame) instead of failing
  const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
  await page.getByTestId("upload-input").setInputFiles({ name: "anim.gif", mimeType: "image/gif", buffer: gif });
  await expect(page.locator("[data-layer-id]")).toHaveCount(3, { timeout: 30_000 });
  expect(sizes.length).toBe(3);
  // a file that is not an image is refused before anything is sent, with what to do instead
  await page.getByTestId("upload-input").setInputFiles({ name: "notes.png", mimeType: "image/png", buffer: Buffer.from("just some text, not an image") });
  await expect(page.getByText(/isn't a supported image\. Use PNG, JPG, WebP or SVG/).first()).toBeVisible();
  expect(sizes.length).toBe(3);
});

test("made-to-order artwork: own PNG, a library graphic and text, moved and rotated, reach the cart and the order", async ({ page }) => {
  test.setTimeout(180_000);
  await register(page, "MTO Artist");
  await page.goto("/design/garment/new?garment=toigo-basic-tucked-t-shirt&mode=atelier");
  await expect(page.getByTestId("library-studio")).toHaveAttribute("data-loaded", "yes", { timeout: 60_000 });
  const mto = page.getByTestId("mto");
  await page.getByTestId("gd-tab-artwork").click();
  const png = await sharp({ create: { width: 800, height: 800, channels: 4, background: { r: 20, g: 60, b: 160, alpha: 1 } } }).png().toBuffer();
  await page.getByTestId("mto-art-upload").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png });
  await expect(page.getByTestId("mto-art-item")).toHaveCount(1, { timeout: 60_000 });
  // library graphic on the next free placement
  await page.getByTestId("mto-art-tab-library").click();
  await page.getByTestId("mto-lib-item").first().click();
  await expect(page.getByTestId("mto-art-item")).toHaveCount(2);
  // text
  await page.getByTestId("mto-art-tab-text").click();
  await page.getByTestId("mto-text").fill("CHAI CLUB");
  await page.getByTestId("mto-text-add").click();
  await expect(page.getByTestId("mto-art-item")).toHaveCount(3);
  // move and rotate the first placement within its area
  const first = page.getByTestId("mto-art-item").first();
  await first.getByTestId("mto-art-width").fill("20");
  await first.getByTestId("mto-art-rotate").fill("15");
  await first.getByTestId("mto-art-x").fill("2");
  await expect(mto).toHaveAttribute("data-valid", "yes");
  // proportions previewed on the model
  await page.getByTestId("gd-tab-size").click();
  await page.getByRole("button", { name: "Longer body length" }).click();
  await page.getByTestId("gd-tab-order").click();
  await page.getByTestId("mto-add").click();
  await expect(page.getByText("Added to your cart")).toBeVisible();
  const cart = (await (await page.request.get("/api/cart")).json()).cart;
  const line = cart.lines.find((l: { kind: string }) => l.kind === "library");
  const art = line.library.options.artwork as { uploadId?: string; assetId?: string; text?: string; rotation: number; offsetXCm: number }[];
  expect(art.map((a) => (a.uploadId ? "upload" : a.assetId ? "library" : "text"))).toEqual(["upload", "library", "text"]);
  expect(art[0]).toMatchObject({ rotation: 15, offsetXCm: 2 });
  expect(art[2].text).toBe("CHAI CLUB");
  // Buy now goes straight to checkout
  await page.getByTestId("mto-buy").click();
  await page.waitForURL("**/checkout");
});
