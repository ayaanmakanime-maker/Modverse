import { expect, test } from "@playwright/test";

test("live camera trial room starts, tracks, reports performance and stops", async ({ page }) => {
  await page.goto("/try-on");
  await expect(page.getByTestId("trial-room")).toBeVisible();
  await page.getByTestId("start-camera").click();
  await expect(page.getByTestId("stop-camera")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/FPS/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/local models|MediaPipe CDN/)).toBeVisible();
  // The fake camera shows no person → tracking-loss guidance instead of a frozen garment.
  await expect(page.getByTestId("tryon-guidance")).toContainText(/Tracking lost/, { timeout: 30_000 });
  await page.getByRole("radio", { name: /Level C/ }).click();
  // Live customisation, full screen and the consented measurement estimate.
  await page.getByTestId("live-color-6E1423").click();
  await expect(page.getByTestId("live-color-6E1423")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("tryon-fullscreen").click();
  await expect(page.getByTestId("trial-room")).toHaveClass(/fixed|inset-0/);
  await page.getByTestId("tryon-fullscreen").click();
  await page.getByTestId("tryon-measure").click();
  await expect(page.getByTestId("tryon-measure-result")).toContainText(/Not enough clear frames/, { timeout: 30_000 });
  await page.keyboard.press("Escape");
  await page.getByTestId("stop-camera").click();
  await expect(page.getByTestId("start-camera")).toBeVisible();
});

test("trial room explains camera permission denial", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
  });
  await page.goto("/try-on");
  await page.getByTestId("start-camera").click();
  await expect(page.getByText(/Camera permission was denied/)).toBeVisible();
});

test("editor fit analysis keeps estimates, simulation and verified fit separate", async ({ page }) => {
  await page.goto("/design/new?model=tee-oversized&audience=men&mode=atelier");
  await page.getByTestId("tab-fit").click();
  await page.getByTestId("fit-height").fill("178");
  await page.getByTestId("fit-weight").fill("76");
  await expect(page.getByText(/rough estimates \(±8 cm\)/)).toBeVisible();
  const fa = page.getByTestId("fit-analysis");
  await expect(fa).toContainText("Estimated fit");
  await expect(fa).toContainText("Visual simulation");
  await expect(page.getByTestId("verified-fit")).toContainText("Not verified");
  await page.getByTestId("fit-chest").fill("100");
  await expect(page.getByText(/rough estimates \(±8 cm\)/)).toHaveCount(0);
});
