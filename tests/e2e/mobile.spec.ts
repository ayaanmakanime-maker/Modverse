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

test("mobile: product page, cart, checkout, Human Studio, the Muse and the 3D editor fit a phone", async ({ page }) => {
  test.setTimeout(240_000);
  const { register } = await import("./helpers");
  await register(page, "Phone Shopper");
  // made-to-order product page: no sideways scroll, the price and Add to cart stay on screen
  await page.goto("/shop/men/elvs-male-shirt-untucked-bd1");
  await expect(page.getByTestId("mto")).toBeVisible();
  await noHorizontalOverflow(page);
  await expect(page.getByTestId("mto-mobile-bar")).toBeVisible();
  await page.getByTestId("mto-size-L").click();
  await page.getByTestId("mto-add").click();
  await expect(page.getByText("Added to your cart")).toBeVisible();
  for (const url of ["/cart", "/checkout", "/search?q=shirt", "/shop/men?cat=shirts", "/account", "/design/muse"]) {
    await page.goto(url);
    await noHorizontalOverflow(page);
  }
  await page.goto("/cart");
  await expect(page.getByTestId("cart-try-on")).toBeVisible();
  // Human Studio: the mannequin first, then real-unit sliders that work by touch
  await page.goto("/design/human-studio?garment=elvs-male-shirt-untucked-bd1");
  const canvas = page.getByTestId("human-canvas");
  await expect(canvas).toHaveAttribute("data-ready", "1", { timeout: 120_000 });
  await noHorizontalOverflow(page);
  const box = (await canvas.boundingBox())!;
  const vh = page.viewportSize()!.height;
  expect(box.y).toBeLessThan(vh * 0.3);
  expect(box.height).toBeGreaterThan(vh * 0.5);
  await page.getByTestId("hm-range-height").fill("182");
  await expect(page.getByTestId("hm-in-height")).toHaveValue("182");
  // the editor keeps a usable canvas with the 3D view's controls in one row
  await page.goto("/design/new?model=tee-classic-crew&audience=men&mode=pro");
  await expect(page.getByTestId("canvas-2d")).toBeVisible();
  await noHorizontalOverflow(page);
  const c2d = (await page.getByTestId("canvas-2d").boundingBox())!;
  expect(c2d.height).toBeGreaterThan(220);
});
