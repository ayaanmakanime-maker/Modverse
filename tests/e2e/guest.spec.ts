import { expect, test } from "@playwright/test";
import { logout, login, openEditor, saveDesign, PASSWORD, uniqueEmail } from "./helpers";

test("guest mode: one click, every signed-in feature, then save as a real account", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("continue-as-guest").click();
  await page.waitForURL("**/account**");
  await expect(page.getByTestId("guest-banner")).toBeVisible();

  // Signed-in features: save a design, add to cart, open the account pages
  await openEditor(page, "tee-classic-crew", "men", "studio");
  await page.getByTestId("tab-text").click();
  await page.locator("#new-text").fill("GUEST");
  await page.getByTestId("add-text").click();
  const id = await saveDesign(page);
  await page.getByTestId("tab-check").click();
  await page.getByTestId("add-to-cart").click();
  await expect(page.getByText("Added to cart")).toBeVisible();
  for (const p of ["/account/designs", "/account/orders", "/account/measurements", "/account/addresses", "/account/mailbox", "/account/settings"]) {
    await page.goto(p);
    await expect(page.getByRole("link", { name: "Dashboard" }), p).toBeVisible(); // the account shell renders for guests
    await expect(page.getByText(/Something went wrong|not found/i), p).toHaveCount(0);
  }
  const me = await (await page.request.get("/api/auth/me")).json();
  expect(JSON.stringify(me)).toContain("guest.modverse.local");

  // Guests can't apply as partners
  const apply = await page.request.post("/api/partner/apply", { headers: { Origin: "http://localhost:3100" }, data: { type: "logistics", name: "Guest Co", contactEmail: "g@example.com", capabilities: { couriers: ["Delhivery"] } } });
  expect(apply.status()).toBe(403);

  // Save the account: same designs, now with a real login
  const email = uniqueEmail("saved");
  await page.goto("/account");
  await page.getByTestId("guest-save-open").click();
  await page.getByTestId("claim-name").fill("Saved Guest");
  await page.getByTestId("claim-email").fill(email);
  await page.getByTestId("claim-password").fill(PASSWORD);
  await page.getByTestId("claim-submit").click();
  await expect(page.getByTestId("guest-banner")).toHaveCount(0);
  await logout(page);
  await login(page, email);
  await page.goto("/account/designs");
  await expect(page.getByText("Classic Crew Neck design").first()).toBeVisible();
  expect((await page.request.get(`/api/designs/${id}`)).status()).toBe(200);
});
