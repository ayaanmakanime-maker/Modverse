import { expect, test } from "@playwright/test";

async function noHorizontalOverflow(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test("mobile layouts: home, shop, library and the editor keep essential tools", async ({ page }) => {
  for (const url of ["/", "/shop/women", "/library", "/try-on", "/login"]) {
    await page.goto(url);
    await noHorizontalOverflow(page);
  }
  await page.goto("/design/new?model=tee-classic-crew&audience=men&mode=atelier");
  await expect(page.getByTestId("canvas-2d")).toBeVisible();
  await expect(page.getByTestId("tab-text")).toBeVisible();
  await page.getByTestId("tab-text").click();
  await page.locator("#new-text").fill("Hi");
  await page.getByTestId("add-text").click();
  await expect(page.getByTestId("text-content").first()).toBeVisible();
});
