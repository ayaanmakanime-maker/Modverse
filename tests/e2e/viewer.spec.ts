import { expect, test } from "@playwright/test";
import { openEditor, register } from "./helpers";

test("3D viewer: views, detail inspection, reset and quality without errors; GLB export", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/lab/3d?model=shirt-oxford-button-down&color=F5F3EE&view=front");
  await expect(page.getByTestId("garment-3d").locator("canvas")).toBeVisible({ timeout: 60_000 });
  for (const id of ["detail-collar", "detail-cuff", "view3d-back", "detail-hem", "view3d-reset", "view3d-three-quarter"]) {
    await page.getByTestId(id).click();
    await page.waitForTimeout(400);
  }
  await page.getByTestId("quality-toggle").click();
  await expect(page.getByTestId("viewer-stats")).toContainText("fps", { timeout: 30_000 });
  expect(errors).toEqual([]);

  // GLB export of the parametric garment from the Atelier Pro tech pack
  await register(page, "GLB User");
  await openEditor(page, "tee-classic-crew", "men", "pro");
  await page.getByRole("radio", { name: "3D" }).click();
  await expect(page.getByTestId("garment-3d").locator("canvas")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("tab-techpack").click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /3D model GLB/ }).click()]);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  const glb = Buffer.concat(chunks);
  expect(glb.subarray(0, 4).toString("latin1")).toBe("glTF");
  expect(glb.length).toBeGreaterThan(50_000);
  expect(errors).toEqual([]);
});
