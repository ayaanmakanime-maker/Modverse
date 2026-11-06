import { expect, test } from "@playwright/test";
import { register, saveDesign } from "./helpers";

/**
 * The complete V2 customer journey in one session (V2 spec, Part 15.3):
 * account → garment → Design Studio → artwork → typography → panels → fabric & colour →
 * construction → 3D → save → reopen → AI assistant → structured AI changes → validation →
 * live try-on → updated price → cart → checkout → order data.
 */
test("complete customer journey from idea to verified order data", async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // 1. Create a customer account
  await register(page, "Journey Customer");

  // 2. Select a garment from the catalogue
  await page.goto("/shop/men?type=tshirt");
  await page.getByTestId("product-card").filter({ hasText: "Classic Crew" }).first().click();
  await expect(page.getByTestId("design-studio")).toBeVisible();

  // 3. Open Design Studio
  await page.getByTestId("design-studio").click();
  await expect(page.getByTestId("canvas-2d")).toBeVisible();
  await expect(page.getByTestId("tab-start")).toBeVisible();

  // 4. Add artwork from the real Creative Library
  await page.getByTestId("tab-library").click();
  await page.getByTestId("asset-MVG_001").click();
  await expect(page.locator("[data-layer-id]")).toHaveCount(1);

  // 5. Add typography
  await page.getByTestId("tab-text").click();
  await page.locator("#new-text").fill("JOURNEY");
  await page.getByTestId("add-text").click();
  await expect(page.locator("[data-layer-id]")).toHaveCount(2);

  // Switch the same design to Atelier for panels and construction (one engine, one config)
  await page.getByRole("radiogroup", { name: "Design mode" }).getByRole("radio", { name: "Atelier", exact: true }).click();
  await expect(page.getByTestId("tab-panels")).toBeVisible();

  // 6. Change garment panels (left sleeve colour)
  await page.getByTestId("tab-panels").click();
  const panels = page.getByTestId("panels-panel");
  await panels.getByRole("button", { name: /Left sleeve/ }).click();
  await panels.getByRole("button", { name: "Colour #1B2A47" }).first().click();

  // 7. Change fabric and colour
  await page.getByTestId("tab-fabric").click();
  await page.getByTestId("fabric-list").getByRole("button").nth(1).click();
  await page.getByRole("button", { name: "Colour #0B0B0B" }).first().click();

  // 8. Change construction
  await page.getByTestId("tab-construction").click();
  await page.getByTestId("construction-panel").getByRole("radio", { name: "V-neck" }).click();

  // 9. Inspect the 3D model
  await page.getByRole("radiogroup", { name: "Canvas view" }).getByRole("radio", { name: "3D" }).click();
  await expect(page.getByTestId("garment-3d").locator("canvas")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("radiogroup", { name: "Canvas view" }).getByRole("radio", { name: "2D" }).click();

  // 10. Save the design
  const id = await saveDesign(page);
  const saved = (await (await page.request.get(`/api/designs/${id}`)).json()).version.config;
  expect(saved.panels.sleeveLeft.color).toBe("#1B2A47");
  expect(saved.fabric.color).toBe("#0B0B0B");
  expect(saved.construction.neckline).toBe("v");
  expect(saved.layers).toHaveLength(2);

  // 11. Reopen the design
  await page.goto(`/design/${id}?mode=atelier`);
  await expect(page.getByTestId("canvas-2d")).toBeVisible();
  await expect(page.locator("[data-layer-id]")).toHaveCount(2);

  // 12–13. Use the AI design assistant and apply its structured changes as one transaction
  await page.getByTestId("tab-muse").click();
  await page.getByTestId("muse-input").fill("make the right sleeve maroon");
  await page.keyboard.press("Enter");
  const card = page.getByTestId("muse-proposal").last();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("muse-apply").last().click();
  await expect(card).toContainText("Applied");

  // 14. Validate the design: the V-neck now overlaps the chest artwork and the text is black on black —
  // the rules engine reports both and its one-click fixes resolve them.
  await page.getByTestId("tab-check").click();
  await expect(page.getByText(/extends past the safe print boundary/).first()).toBeVisible();
  await expect(page.getByText(/very low contrast/)).toBeVisible();
  await expect(page.getByTestId("add-to-cart")).toBeDisabled();
  const fixes = page.getByRole("button", { name: /^(Fit inside print area|Use readable colour)$/ });
  for (let i = 0; i < 6 && (await fixes.count()) > 0; i++) await fixes.first().click();
  await expect(fixes).toHaveCount(0);
  await expect(page.getByTestId("add-to-cart")).toBeEnabled();

  // 16. Calculate the updated price (itemised, manufacturing-aware)
  await page.getByTestId("price-details").click();
  const total = Number(((await page.getByTestId("price-total").first().textContent()) ?? "").replace(/[^\d]/g, ""));
  expect(total).toBeGreaterThan(799);
  const afterAi = await saveDesign(page);
  expect(afterAi).toBe(id);
  const cfg = (await (await page.request.get(`/api/designs/${id}`)).json()).version.config;
  expect(cfg.panels.sleeveRight.color).toBe("#6E1423");

  // 15. Live try-on with the saved design (fake camera in CI)
  await page.goto("/try-on");
  await page.getByTestId("tryon-garment").selectOption({ value: `saved:${id}` });
  await page.getByTestId("start-camera").click();
  await expect(page.getByTestId("stop-camera")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/FPS/)).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("stop-camera").click();

  // 17. Add the design to the cart
  await page.goto(`/design/${id}?mode=atelier`);
  await page.getByTestId("tab-check").click();
  await page.getByTestId("add-to-cart").click();
  await expect(page.getByText("Added to cart")).toBeVisible();

  // 18. Checkout (simulated payment, clearly labelled)
  await page.goto("/checkout");
  await page.getByTestId("addr-fullName").fill("Journey Customer");
  await page.getByTestId("addr-phone").fill("9822001100");
  await page.getByTestId("addr-line1").fill("8 Marine Drive");
  await page.getByTestId("addr-city").fill("Mumbai");
  await page.getByTestId("addr-state").fill("Maharashtra");
  await page.getByTestId("addr-pincode").fill("400020");
  await page.getByTestId("place-order").click();
  await page.waitForURL(/\/orders\//);
  await page.getByTestId("simulate-payment").click();
  await expect(page.getByText(/awaiting production approval/i).first()).toBeVisible();

  // 19. Verify order data: immutable design snapshot, price snapshot and placements
  const orderId = page.url().split("/").pop()!;
  const order = await (await page.request.get(`/api/orders/${orderId}`)).json();
  const item = order.items[0];
  expect(item.projectId).toBe(id);
  expect(item.designSnapshot.panels.sleeveLeft.color).toBe("#1B2A47");
  expect(item.designSnapshot.panels.sleeveRight.color).toBe("#6E1423");
  expect(item.designSnapshot.construction.neckline).toBe("v");
  expect(item.specSnapshot.price.unitTotal).toBe(total);
  expect(item.specSnapshot.placements.length).toBeGreaterThanOrEqual(2);
  expect(order.order.isSimulated).toBe(true);
  expect(order.payments[0].status).toBe("captured");
  expect(errors).toEqual([]);
});
