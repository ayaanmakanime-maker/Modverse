import { expect, test } from "@playwright/test";

test("Men and Women navigation with distinct T-shirt and shirt models; the Kids range is gone", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("img", { name: /ModVerse/ }).first()).toBeVisible();
  for (const [cat, min] of [["men", 30], ["women", 32]] as const) {
    await page.goto(`/shop/${cat}`);
    await expect(page.getByTestId("product-card").first()).toBeVisible();
    expect(await page.getByTestId("product-card").count()).toBeGreaterThanOrEqual(min);
  }
  // The retired Kids range: no navigation entry, no category page, no product pages.
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Kids", exact: true })).toHaveCount(0);
  expect((await page.goto("/shop/kids"))?.status()).toBe(404);
  expect((await page.goto("/shop/kids/tee-classic-crew"))?.status()).toBe(404);
  expect((await page.goto("/account/family"))?.status()).toBe(404);
  await page.goto("/shop/men?type=shirt");
  expect(await page.getByTestId("product-card").count()).toBe(17);
  await page.goto("/shop/men?type=tshirt");
  expect(await page.getByTestId("product-card").count()).toBe(15);
  await page.goto("/shop/women/shirt-cuban-camp");
  await expect(page.getByRole("heading", { name: "Cuban / Camp Collar Shirt" })).toBeVisible();
  await expect(page.getByTestId("garment-3d")).toBeVisible();
});

test("Creative Library browser uses the real library", async ({ page }) => {
  await page.goto("/library");
  await expect(page.getByText(/\d{1,3}(,\d{2,3})+ graphics in \d+ categories/)).toBeVisible();
  await expect(page.getByTestId("library-item").first()).toBeVisible();
  await page.getByText("ModVerse collections").click();
  await page.getByRole("button", { name: /Space Astronomy/ }).click();
  await expect(page.getByText(/^25 assets/)).toBeVisible();
  await page.getByTestId("library-item").first().click();
  await expect(page.getByText("01_Graphics/MVG_2")).toBeVisible();
});
