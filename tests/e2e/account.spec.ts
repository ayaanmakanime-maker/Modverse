import { expect, test } from "@playwright/test";
import { register } from "./helpers";

test("measurement profiles and size recommendation; no kids or child-profile features", async ({ page }) => {
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

  // The Kids range is retired: kids profiles are refused and the child-profile endpoints are gone.
  const r = await page.request.post("/api/account/measurements", { headers: { Origin: "http://localhost:3100" }, data: { name: "Kid", audience: "kids", measurements: { chest: 64 } } });
  expect(r.status()).toBe(400);
  expect((await page.request.get("/api/account/children")).status()).toBe(404);
  await page.goto("/account");
  await expect(page.getByText("Child profiles")).toHaveCount(0);

  await page.goto("/account/mailbox");
  await expect(page.getByTestId("mail").first()).toContainText("Verify your ModVerse email");
});
