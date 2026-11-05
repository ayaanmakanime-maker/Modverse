import { expect, test } from "@playwright/test";

test("live camera trial room starts, tracks, reports performance and stops", async ({ page }) => {
  await page.goto("/try-on");
  await expect(page.getByTestId("trial-room")).toBeVisible();
  await page.getByTestId("start-camera").click();
  await expect(page.getByTestId("stop-camera")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/FPS/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/local models|MediaPipe CDN/)).toBeVisible();
  await page.getByRole("radio", { name: /Level C/ }).click();
  await page.getByTestId("stop-camera").click();
  await expect(page.getByTestId("start-camera")).toBeVisible();
});
