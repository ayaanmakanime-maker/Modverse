import { expect, test } from "@playwright/test";
import { register } from "./helpers";

test("measurement profiles, size recommendation and guardian-managed children", async ({ page }) => {
  await register(page, "Guardian");
  await page.goto("/account/measurements");
  await page.getByTestId("add-measurements").click();
  await page.getByTestId("mp-name").fill("Me");
  await page.getByTestId("mp-chest").fill("104");
  await page.getByTestId("mp-waist").fill("90");
  await page.getByTestId("mp-shoulder").fill("48");
  await page.getByTestId("mp-height").fill("180");
  await page.getByTestId("mp-save").click();
  await expect(page.getByText(/Regular tee:/)).toBeVisible();
  await expect(page.getByText(/estimate/).first()).toBeVisible();

  // Kids measurements require a guardian child profile
  const r = await page.request.post("/api/account/measurements", { headers: { Origin: "http://localhost:3100" }, data: { name: "Kid", audience: "kids", measurements: { chest: 64 } } });
  expect(r.status()).toBe(400);
  await page.goto("/account/family");
  await page.getByTestId("child-nickname").fill("Ria");
  await expect(page.getByTestId("child-save")).toBeDisabled();
  await page.getByTestId("child-consent").check();
  await page.getByTestId("child-save").click();
  await expect(page.getByText(/Ria/).first()).toBeVisible();
  await expect(page.getByText(/sharing off/)).toBeVisible();

  await page.goto("/account/mailbox");
  await expect(page.getByTestId("mail").first()).toContainText("Verify your ModVerse email");
});
