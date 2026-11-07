import { expect, test } from "@playwright/test";
import { openEditor, register } from "./helpers";

test("guided body scan: consent, camera guidance, honest review, correction and saving", async ({ page }) => {
  test.setTimeout(120_000);
  await register(page, "Scan Tester");
  await page.goto("/account/measurements");
  await page.getByTestId("scan-open-men").click();
  const scanner = page.getByTestId("body-scanner");
  await expect(scanner).toBeVisible();
  // Nothing happens without consent.
  await expect(page.getByTestId("scan-start")).toBeDisabled();
  await page.getByTestId("scan-consent-check").check();
  await page.getByTestId("scan-start").click();
  await page.getByTestId("scan-height").fill("178");
  await page.getByTestId("scan-camera").click();
  // The fake test camera shows no person: the live guidance says so and capture is refused.
  await expect(page.getByTestId("scan-guidance")).toContainText(/No person found|step into/i, { timeout: 60_000 });
  // Skip the camera: nothing is invented — only the typed height is known.
  await page.getByTestId("scan-manual").click();
  const review = page.getByTestId("scan-review");
  await expect(review).toBeVisible();
  await expect(page.getByTestId("scan-row-height")).toContainText("manually entered");
  await expect(page.getByTestId("scan-row-chest")).toContainText("needs a view");
  await expect(page.getByTestId("scan-row-neck")).toContainText("tape only");
  await expect(page.getByTestId("scan-value-chest")).toHaveValue("");
  // Correct by hand, then save only with explicit consent.
  await page.getByTestId("scan-value-chest").fill("100");
  await expect(page.getByTestId("scan-row-chest")).toContainText("manually entered");
  await expect(page.getByTestId("scan-save")).toBeDisabled();
  await page.getByTestId("scan-store-consent").check();
  await page.getByTestId("scan-save").click();
  await expect(page.getByTestId("measurements")).toContainText("Camera scan");
});

test("Fit tab: Atlas avatar studio (Aura for the Women's range) and scan-to-fit", async ({ page }) => {
  test.setTimeout(120_000);
  await register(page, "Avatar Fit");
  await openEditor(page, "tee-classic-crew", "men", "pro");
  await page.getByTestId("tab-fit").click();
  const studio = page.getByTestId("avatar-studio");
  await expect(studio).toBeVisible();
  await expect(page.getByTestId("avatar-atlas")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("avatar-aura")).toBeDisabled(); // Aura belongs to the Women's range
  await page.getByTestId("avatar-toggle").check();
  await expect(page.getByTestId("avatar-toggle")).toBeChecked();
  // Body sliders feed the fit check.
  await page.getByTestId("avatar-sliders").getByRole("slider").nth(1).fill("118");
  await expect(page.getByTestId("fit-panel")).toContainText(/Fit analysis/i);
  // Scan flow from the Fit tab (manual entry path) applies reviewed values.
  await page.getByTestId("fit-scan").click();
  await page.getByTestId("scan-consent-check").check();
  await page.getByTestId("scan-start").click();
  await page.getByTestId("scan-height").fill("170");
  await page.getByTestId("scan-camera").click();
  await page.getByTestId("scan-manual").click();
  await page.getByTestId("scan-value-chest").fill("96");
  await page.getByTestId("scan-apply").click();
  await expect(page.getByTestId("fit-panel")).toContainText("Using your reviewed scan");
});
