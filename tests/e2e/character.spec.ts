import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { openEditor, register } from "./helpers";

/**
 * The supplied rigged characters (public/avatars/man.fbx and woman.fbx; not committed to the public repository).
 * The character tests need the files; the fallback test runs everywhere.
 */
const installed = ["man.fbx", "woman.fbx"].every((f) => fs.existsSync(path.join(process.cwd(), "public", "avatars", f)));

test("without the character files ModVerse falls back to the procedural Atlas / Aura", async ({ page }) => {
  test.setTimeout(120_000);
  await page.route("**/avatars/*.fbx", (route) => route.fulfill({ status: 404, body: "not found" }));
  await page.goto("/lab/3d?model=tee-regular&audience=men&avatar=1&view=front&quality=low");
  await expect(page.getByTestId("garment-viewer")).toHaveAttribute("data-avatar", "procedural", { timeout: 60_000 });
  await expect(page.getByTestId("garment-viewer")).toHaveAttribute("data-garment", "static");
});

test.describe("supplied FBX characters", () => {
  test.skip(!installed, "the supplied character files are not installed in public/avatars");

  for (const [audience, label] of [["men", "Atlas (man)"], ["women", "Aura (woman)"]] as const) {
    test(`${label}: the Men's / Women's range wears the designed garment on the rigged character`, async ({ page }) => {
      test.setTimeout(240_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`/lab/3d?model=tee-regular&audience=${audience}&avatar=1&view=front&quality=low`);
      const viewer = page.getByTestId("garment-viewer");
      await expect(viewer).toHaveAttribute("data-avatar", "character", { timeout: 180_000 });
      await expect(viewer).toHaveAttribute("data-garment", "skinned", { timeout: 60_000 });
      await expect(page.getByTestId("avatar-loading")).toHaveCount(0);
      // detail inspection and view changes keep working with the character in the scene
      for (const id of ["detail-collar", "view3d-three-quarter", "view3d-back"]) {
        await page.getByTestId(id).click();
        await page.waitForTimeout(400);
      }
      const shot = await page.getByTestId("garment-3d").screenshot();
      expect(shot.length).toBeGreaterThan(20_000); // not a blank canvas
      expect(errors).toEqual([]);
    });
  }

  test("walk and run clips play (continuous rendering) and the garment stays skinned", async ({ page }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/lab/3d?model=tee-regular&audience=women&avatar=1&view=three-quarter&quality=low&motion=walk&expr=smile");
    const viewer = page.getByTestId("garment-viewer");
    await expect(viewer).toHaveAttribute("data-avatar", "character", { timeout: 180_000 });
    await expect(viewer).toHaveAttribute("data-motion", "walk");
    await expect(viewer).toHaveAttribute("data-garment", "skinned", { timeout: 60_000 });
    await expect(page.getByTestId("viewer-stats")).toContainText("fps", { timeout: 30_000 });
    expect(errors).toEqual([]);
  });

  test("editor: motion and face controls, size change re-binds the garment, GLB export of the worn garment", async ({ page }) => {
    test.setTimeout(300_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await register(page, "Character User");
    await openEditor(page, "tee-classic-crew", "men", "pro");
    await page.getByTestId("tab-fit").click();
    await page.getByTestId("avatar-toggle").check();
    const viewer = page.getByTestId("garment-viewer");
    await expect(viewer).toHaveAttribute("data-avatar", "character", { timeout: 180_000 });
    // character controls replace the procedural pose chips
    await expect(page.getByTestId("motion-rest")).toBeVisible();
    await expect(page.getByTestId("pose-t-pose")).toHaveCount(0);
    await page.getByTestId("motion-idle").click();
    await expect(viewer).toHaveAttribute("data-motion", "idle");
    await page.getByTestId("expression-smile").click();
    await page.getByTestId("motion-rest").click();
    await expect(viewer).toHaveAttribute("data-motion", "rest");
    // height / chest sliders reshape the character and re-bind the garment without errors
    await page.getByTestId("avatar-sliders").getByRole("slider").nth(0).fill("186");
    await page.getByTestId("avatar-sliders").getByRole("slider").nth(1).fill("112");
    await expect(viewer).toHaveAttribute("data-garment", "skinned", { timeout: 60_000 });
    // GLB export of the garment as worn (baked from the current pose)
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
});
