import { expect, test } from "@playwright/test";
import { ADMIN, login, logout, openEditor, register, saveDesign } from "./helpers";

test("cart → simulated checkout → order snapshot → admin production approval", async ({ page }) => {
  await register(page, "Buyer");
  await openEditor(page, "tee-classic-crew", "men", "studio");
  await page.getByTestId("tab-text").click();
  await page.locator("#new-text").fill("CHAI");
  await page.getByTestId("add-text").click();
  await saveDesign(page);
  await page.getByTestId("tab-check").click();
  await page.getByTestId("add-to-cart").click();
  await expect(page.getByText("Added to cart")).toBeVisible();
  await page.goto("/cart");
  await expect(page.getByTestId("cart")).toBeVisible();
  await page.getByTestId("checkout-link").click();
  await page.getByTestId("addr-fullName").fill("Buyer One");
  await page.getByTestId("addr-phone").fill("9876543210");
  await page.getByTestId("addr-line1").fill("21 Park Street");
  await page.getByTestId("addr-city").fill("Kolkata");
  await page.getByTestId("addr-state").fill("West Bengal");
  await page.getByTestId("addr-pincode").fill("700016");
  await page.getByTestId("place-order").click();
  await page.waitForURL(/\/orders\//);
  await expect(page.getByText(/simulated payment/i).first()).toBeVisible();
  await page.getByTestId("simulate-payment").click();
  await expect(page.getByText(/awaiting production approval/i).first()).toBeVisible();
  const orderUrl = page.url();
  const orderId = orderUrl.split("/").pop()!;

  await logout(page);
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto(`/admin/orders/${orderId}`);
  await expect(page.getByTestId("admin-order")).toBeVisible();
  await page.getByTestId("approve-item").click();
  await page.getByLabel("New status").selectOption("manufacturing");
  await page.getByTestId("update-status").click();
  await expect(page.getByText("manufacturing").first()).toBeVisible();
});
