import { expect, test } from "@playwright/test";
import { ADMIN, login } from "./helpers";

test("admin dashboard and Integration Manager never activates untested providers", async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto("/admin");
  await expect(page.getByTestId("admin-overview")).toBeVisible();
  await page.goto("/admin/integrations");
  const rz = page.getByTestId("integration-razorpay");
  await expect(rz).toContainText("NOT CONFIGURED");
  await expect(rz.getByRole("button", { name: "Enable (test)" })).toBeDisabled();
  // Invalid key format is rejected
  await rz.getByRole("button", { name: "Credentials" }).click();
  await page.getByLabel(/Key ID/).fill("not-a-key");
  await page.getByLabel(/Key secret/).fill("secret-value-for-test");
  await page.getByRole("button", { name: "Save credentials" }).click();
  await expect(page.getByText(/invalid format/)).toBeVisible();
  // Missing credentials handling via API
  const r = await page.request.patch("/api/admin/integrations/openai", { headers: { Origin: "http://localhost:3100" }, data: { enabled: true, environment: "test", confirmBillable: true } });
  expect(r.status()).toBe(409);
  // Local fallbacks still work
  expect((await (await page.request.get("/api/integrations/status")).json()).active.razorpay).toBe(false);
  for (const p of ["/admin/orders", "/admin/designs", "/admin/users", "/admin/catalogue", "/admin/library", "/admin/audit", "/admin/settings"]) {
    await page.goto(p);
    await expect(page.locator("h1")).toBeVisible();
  }
});
