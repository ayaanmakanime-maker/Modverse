import { expect, test } from "@playwright/test";
import { ADMIN, login, logout, openEditor, register, saveDesign } from "./helpers";

test("dynamic pricing: admin rules & discount → itemised editor price → cart discount → checkout snapshot → reorder & redesign", async ({ page }) => {
  // Admin: create a discount code and raise the decoration margin.
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto("/admin/pricing");
  await expect(page.getByTestId("admin-pricing")).toBeVisible();
  const code = `E2E${Date.now().toString().slice(-6)}`;
  await page.getByTestId("discount-code").fill(code);
  await page.getByTestId("discount-value").fill("15");
  await page.getByTestId("discount-create").click();
  await expect(page.getByTestId("discounts")).toContainText(code);
  await page.getByTestId("margin-decoration").fill("2");
  await page.getByTestId("pricing-save").click();
  await expect(page.getByText(/Pricing rules saved/)).toBeVisible();
  await logout(page);

  // Customer: itemised price in the editor follows the admin's rules.
  await register(page, "Price Shopper");
  await openEditor(page, "tee-classic-crew", "men", "studio");
  await page.getByTestId("tab-text").click();
  await page.locator("#new-text").fill("PRICED");
  await page.getByTestId("add-text").click();
  await saveDesign(page);
  await page.getByTestId("tab-check").click();
  await page.getByTestId("price-details").click();
  const bd = page.getByTestId("price-breakdown").first();
  await expect(bd).toContainText("Decoration");
  await expect(bd).toContainText("Illustrative pricing");
  const editorTotal = await bd.getByTestId("price-total").textContent();
  await page.getByTestId("add-to-cart").click();
  await expect(page.getByText("Added to cart")).toBeVisible();

  await page.goto("/cart");
  await page.getByTestId("discount-input").fill(code.toLowerCase());
  await page.getByTestId("discount-apply").click();
  await expect(page.getByTestId("cart-discount")).toContainText(code);
  await page.getByTestId("checkout-link").click();
  await expect(page.getByText(`Discount ${code}`)).toBeVisible();
  await page.getByTestId("addr-fullName").fill("Price Shopper");
  await page.getByTestId("addr-phone").fill("9876543210");
  await page.getByTestId("addr-line1").fill("5 Residency Road");
  await page.getByTestId("addr-city").fill("Bengaluru");
  await page.getByTestId("addr-state").fill("Karnataka");
  await page.getByTestId("addr-pincode").fill("560025");
  await page.getByTestId("place-order").click();
  await page.waitForURL(/\/orders\//);
  await expect(page.getByText(`Discount ${code}`)).toBeVisible();
  const orderId = page.url().split("/").pop()!;
  const { order, items } = await (await page.request.get(`/api/orders/${orderId}`)).json();
  expect(order.discountCode).toBe(code);
  expect(items[0].specSnapshot.price.lines.length).toBeGreaterThan(1);
  expect(`${items[0].unitPrice + items[0].specSnapshot.price.gst}`).toBe((editorTotal ?? "").replace(/[^\d]/g, ""));

  // Reorder and redesign from the order page.
  await page.getByTestId("reorder-item").first().click();
  await expect(page.getByText(/added it to your cart|Added to your cart/)).toBeVisible();
  await page.getByTestId("redesign-item").first().click();
  await page.waitForURL(/\/design\/[0-9a-f-]{36}/);
  await expect(page.getByTestId("canvas-2d")).toBeVisible();

  // Restore default pricing for other tests.
  await logout(page);
  await login(page, ADMIN.email, ADMIN.password);
  const res = await page.request.delete("/api/admin/pricing", { headers: { Origin: new URL(page.url()).origin } });
  expect(res.ok()).toBe(true);
});

test("catalogue search and filters", async ({ page }) => {
  await page.goto("/shop/men?fit=oversized");
  const count = page.getByTestId("catalogue-count");
  await expect(count).toBeVisible();
  const cards = page.getByTestId("product-card");
  const n = await cards.count();
  expect(n).toBeGreaterThan(0);
  expect(n).toBeLessThan(32);
  await page.getByTestId("catalogue-q").fill("linen");
  await page.getByTestId("catalogue-fit").selectOption("");
  await page.getByTestId("catalogue-apply").click();
  await expect(page).toHaveURL(/q=linen/);
  await expect(page.getByTestId("product-card").first()).toBeVisible();
  await page.goto("/search?q=oxford");
  await expect(page.getByTestId("search-result").first()).toContainText(/Oxford/i);
  await page.getByTestId("header-search").click();
  await expect(page).toHaveURL(/\/search/);
});
