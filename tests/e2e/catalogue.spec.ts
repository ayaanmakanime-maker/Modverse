import { expect, test } from "@playwright/test";

test("Men, Women and Kids navigation with distinct T-shirt and shirt models", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("img", { name: /ModVerse/ }).first()).toBeVisible();
  for (const [cat, min] of [["men", 30], ["women", 32], ["kids", 26]] as const) {
    await page.goto(`/shop/${cat}`);
    await expect(page.getByTestId("product-card").first()).toBeVisible();
    expect(await page.getByTestId("product-card").count()).toBeGreaterThanOrEqual(min);
  }
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
  await expect(page.getByText("500 graphics")).toBeVisible();
  await expect(page.getByTestId("library-item").first()).toBeVisible();
  await page.getByRole("button", { name: /Space Astronomy/ }).click();
  await expect(page.getByText("25 assets")).toBeVisible();
  await page.getByTestId("library-item").first().click();
  await expect(page.getByText("01_Graphics/MVG_2")).toBeVisible();
});
