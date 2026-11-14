import { expect, test } from "@playwright/test";
import { ADMIN, login, logout, register, uniqueEmail } from "./helpers";

const ORIGIN = { Origin: "http://localhost:3100" };
// 1 × 1 transparent PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

test("made to order: shop → customise within manufacturing limits → cart → checkout → admin → manufacturer sheet", async ({ page }) => {
  test.setTimeout(300_000);
  page.on("dialog", (d) => d.accept());
  const stamp = Date.now().toString(36);
  const makerName = `Bombay Cut ${stamp}`;

  // The Men's shop lists the 3D collection by type, including trousers and suits.
  await register(page, "MTO Buyer");
  await page.goto("/shop/men");
  await expect(page.getByTestId("shop-collection")).toBeVisible();
  for (const t of ["shirts", "tailoring", "trousers", "sweatwear"]) await expect(page.getByTestId(`shop-type-${t}`)).toBeVisible();
  await page.getByTestId("shop-type-shirts").click();
  await expect(page.getByTestId("shop-garment-card").first()).toBeVisible();
  // the product page shows the style; customising happens in the design studio
  await page.goto("/shop/men/elvs-male-shirt-untucked-bd1");
  await expect(page.getByTestId("style-page")).toBeVisible();
  await expect(page.getByTestId("mto")).toHaveCount(0);
  await page.getByTestId("customise-pro").click();
  await page.waitForURL(/\/design\/garment\/new\?garment=elvs-male-shirt-untucked-bd1&mode=pro/);
  const mto = page.getByTestId("mto");
  await expect(mto).toHaveAttribute("data-mode", "pro");
  await expect(page.getByTestId("library-studio")).toHaveAttribute("data-loaded", "yes", { timeout: 60_000 });
  const base = Number(await mto.getAttribute("data-price"));

  // Only manufacturable options: Oxford takes embroidery only, the chest placement is at most 8 × 8 cm.
  await page.getByTestId("mto-fabric-oxford-140").click();
  await page.getByTestId("mto-colour-sky").click();
  await page.getByTestId("gd-tab-size").click();
  await page.getByTestId("mto-size-L").click();
  await page.getByTestId("mto-fit-slim").click();
  await page.getByRole("button", { name: "Longer body length" }).click();
  await page.getByRole("button", { name: "Longer body length" }).click();
  await expect(page.getByTestId("mto-length")).toHaveText("+2 cm");
  await page.getByTestId("gd-tab-details").click();
  await page.getByTestId("mto-trim-buttons").selectOption("horn");
  await page.getByTestId("mto-monogram").check();
  await page.getByTestId("mto-monogram-text").fill("AK");
  await page.getByTestId("gd-tab-artwork").click();
  await page.getByTestId("mto-art-upload").setInputFiles({ name: "crest.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByTestId("mto-art-item")).toHaveCount(1, { timeout: 60_000 });
  await expect(page.getByTestId("mto-art-method")).toHaveValue("embroidery");
  await expect(page.getByTestId("mto-art-method").locator("option")).toHaveCount(1);
  await expect(mto).toHaveAttribute("data-valid", "yes");
  expect(Number(await mto.getAttribute("data-price"))).toBeGreaterThan(base + 200 + 160);
  // the 2D print areas show it; undo takes the last change back and redo restores it
  await page.getByRole("radio", { name: "Split" }).click();
  await expect(page.getByTestId("zone-chest-left").getByTestId("zone-art")).toHaveCount(1);
  await page.getByTestId("undo").click();
  await expect(page.getByTestId("zone-art")).toHaveCount(0);
  await page.getByTestId("redo").click();
  await expect(page.getByTestId("zone-art")).toHaveCount(1);
  // saved to the account and reopened in the studio
  await page.getByTestId("design-name").fill("Office Oxford");
  await page.getByTestId("gd-save").click();
  await expect(page).toHaveURL(/\/design\/garment\/[0-9a-f-]{36}\?mode=pro/);
  await page.goto("/account/designs");
  await expect(page.getByTestId("style-design-row").filter({ hasText: "Office Oxford" })).toContainText("ready to order");
  await page.getByTestId("style-design-row").filter({ hasText: "Office Oxford" }).getByRole("link").first().click();
  await expect(page.getByTestId("mto")).toHaveAttribute("data-valid", "yes");
  await page.getByTestId("gd-tab-size").click();
  await expect(page.getByTestId("mto-size-L")).toHaveAttribute("aria-checked", "true");

  // The server applies the same rules: an out-of-range alteration is refused.
  const bad = await page.request.post("/api/cart", { headers: ORIGIN, data: { garmentId: "elvs-male-shirt-untucked-bd1", options: { fabricId: "oxford-140", colourId: "sky", size: "L", fit: "slim", lengthAdjustCm: 9, sleeveAdjustCm: 0, trims: {}, measurementProfileId: null, monogram: null, artwork: [] }, quantity: 1 } });
  expect(bad.status()).toBe(400);
  expect((await bad.json()).error.message).toMatch(/Length can be altered/);

  await page.getByTestId("gd-tab-order").click();
  await page.getByTestId("mto-add").click();
  await expect(page.getByText("Added to your cart")).toBeVisible();
  await page.goto("/cart");
  await expect(page.getByTestId("cart-line-mto")).toContainText("Sky blue Cotton Oxford · slim fit · size L · length +2 cm");
  await page.getByTestId("checkout-link").click();
  await page.getByTestId("addr-fullName").fill("MTO Buyer");
  await page.getByTestId("addr-phone").fill("9822233344");
  await page.getByTestId("addr-line1").fill("12 Marine Drive");
  await page.getByTestId("addr-city").fill("Mumbai");
  await page.getByTestId("addr-state").fill("Maharashtra");
  await page.getByTestId("addr-pincode").fill("400020");
  await page.getByTestId("place-order").click();
  await page.waitForURL(/\/orders\//);
  await page.getByTestId("simulate-payment").click();
  await expect(page.getByText(/awaiting production approval/i).first()).toBeVisible();
  await expect(page.getByTestId("mto-thumb")).toBeVisible();
  await expect(page.getByTestId("redesign-item")).toHaveCount(0);
  const orderId = page.url().split("/").pop()!;
  await logout(page);

  // A shirt maker (woven, embroidery) applies and is approved.
  const maker = await register(page, "Maker", uniqueEmail("mto-maker"));
  const apply = await page.request.post("/api/partner/apply", { headers: ORIGIN, data: { type: "manufacturer", name: makerName, contactEmail: maker, city: "Mumbai", capabilities: { methods: ["embroidery", "dtf"], garmentTypes: ["shirt", "tailoring", "trousers"], audiences: ["men", "women"], fabrics: ["woven"], minOrderQty: 1, dailyCapacity: 40, leadTimeDays: 10 } } });
  expect(apply.ok()).toBe(true);
  await logout(page);

  // Admin: the order shows the production details; approve and assign the capable maker.
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto("/admin/partners");
  await page.getByTestId("partner-row").filter({ hasText: makerName }).getByTestId("partner-approve").click();
  await page.goto(`/admin/orders/${orderId}`);
  await expect(page.getByTestId("mto-details")).toContainText("Cotton Oxford · 100% cotton · 140 GSM · Sky blue");
  await expect(page.getByTestId("mto-details")).toContainText("Monogram");
  await page.getByTestId("approve-item").click();
  await expect(page.getByText(/approved for production/i).first()).toBeVisible();
  await page.getByTestId("assign-maker").selectOption({ label: `${makerName} ✓ capable` });
  await page.getByTestId("assign-submit").click();
  await expect(page.getByTestId("fulfil-job").filter({ hasText: makerName })).toContainText("New offer");
  await logout(page);

  // Manufacturer: the job carries the production sheet (no customer address, no retail price).
  await login(page, maker);
  await page.goto("/partner");
  await page.getByTestId("partner-jobs").getByRole("link").first().click();
  await expect(page.getByTestId("job-item")).toContainText("quantity 1");
  await expect(page.getByTestId("mto-details")).toContainText("Buttons: Horn look");
  await expect(page.getByTestId("partner-job")).not.toContainText("Marine Drive");
  const href = (await page.getByTestId("job-techpack").getAttribute("href"))!;
  const pdf = await page.request.get(href);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  // the embroidery artwork is downloadable by the assigned maker
  const job = await (await page.request.get(`/api/partner/jobs/${page.url().split("/").pop()}`)).json();
  const art = job.items[0].designSnapshot.options.artwork[0].uploadId;
  expect(art).toMatch(/^[0-9a-f-]{36}$/);
});

test("made to order: knitted pieces are graded sizes only; bottoms size by waist and hip", async ({ page }) => {
  await register(page, "MTO Rules");
  await page.goto("/shop/women?cat=skirts#shop");
  await expect(page.getByTestId("shop-garment-card").first()).toBeVisible();
  await page.getByTestId("shop-garment-card").first().click();
  await expect(page.getByTestId("style-options")).toContainText("made to measure");
  await page.getByTestId("customise-pro").click();
  await page.getByTestId("gd-tab-size").click();
  await expect(page.getByTestId("mto-mtm")).toBeVisible(); // skirts can be made to measure (Atelier Pro)
  await page.getByTestId("gd-tab-artwork").click();
  await expect(page.getByTestId("mto-artwork")).toContainText("Left hip up to 8 × 8 cm"); // skirts: a small embroidery at the hip only
  await page.goto("/design/garment/new?garment=toigo-basic-tucked-t-shirt&mode=pro");
  await page.getByTestId("gd-tab-size").click();
  await expect(page.getByText("Knitted garments are made in graded sizes only.")).toBeVisible();
  // Design Studio keeps it simple: no fabric list, alterations or monogram
  await page.goto("/design/garment/new?garment=elvs-male-shirt-untucked-bd1&mode=studio");
  await expect(page.getByTestId("mto-colour-sky")).toBeVisible();
  await expect(page.getByTestId("mto-fabric-oxford-140")).toHaveCount(0);
  await expect(page.getByTestId("gd-tab-details")).toHaveCount(0);
  await page.getByTestId("gd-tab-size").click();
  await expect(page.getByTestId("mto-length")).toHaveCount(0);
});
