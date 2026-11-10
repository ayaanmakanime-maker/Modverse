import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { ADMIN, login, openEditor, register } from "./helpers";

const index = JSON.parse(fs.readFileSync(path.join(process.cwd(), "public/garment-library/index.json"), "utf8")) as { garments: { id: string; path: string; glb: string; licence: string }[] };

test("3D collection lists only downloaded, licensed garment files; a real model loads and is customised", async ({ page }) => {
  test.setTimeout(180_000);
  // every catalogue entry points at a real GLB with an accepted licence
  expect(index.garments.length).toBeGreaterThan(50);
  for (const g of index.garments) {
    const file = path.join(process.cwd(), "public/garment-library", g.path, g.glb);
    expect(fs.existsSync(file), g.id).toBe(true);
    expect(fs.readFileSync(file).subarray(0, 4).toString("latin1")).toBe("glTF");
    expect(["CC0", "CC-BY"]).toContain(g.licence);
  }
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/collection");
  await expect(page.getByTestId("collection-count")).toContainText(`${index.garments.length} garments`);
  await page.getByTestId("collection-for-men").click();
  await expect(page.getByTestId("collection-card").first()).toBeVisible();
  await page.getByTestId("collection-search").fill("polo");
  await page.getByTestId("collection-search").press("Enter");
  await page.getByTestId("collection-card").first().click();
  const studio = page.getByTestId("library-studio");
  await expect(studio).toHaveAttribute("data-loaded", "yes", { timeout: 120_000 });
  await expect(page.getByTestId("garment-attribution")).toContainText("MakeHuman");
  await page.getByTestId("tint-B3261E").click();
  await page.getByTestId("side-back").click();
  await page.getByTestId("decal-text").fill("MODVERSE");
  await page.getByTestId("decal-add-text").click();
  await expect(studio).toHaveAttribute("data-decals", "1");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("library-export").click()]);
  expect(download.suggestedFilename()).toMatch(/preview\.png$/);
  expect(errors).toEqual([]);
});

test("admin switches a library garment off and it disappears for customers", async ({ page }) => {
  test.setTimeout(120_000);
  const id = index.garments[0].id;
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto("/admin/garment-library");
  await page.getByTestId(`garment-toggle-${id}`).click();
  await expect(page.getByTestId(`garment-toggle-${id}`)).toHaveText("Off");
  expect((await page.request.get(`/collection/${id}`)).status()).toBe(404);
  await page.getByTestId(`garment-toggle-${id}`).click();
  await expect(page.getByTestId(`garment-toggle-${id}`)).toHaveText("On");
  expect((await page.request.get(`/collection/${id}`)).status()).toBe(200);
});

test("The Muse offers Puter AI with a user-pays explanation; declining keeps the built-in assistant working", async ({ page }) => {
  test.setTimeout(120_000);
  let puterLoaded = false;
  await page.route("https://js.puter.com/**", (r) => { puterLoaded = true; return r.abort(); });
  await register(page, "Puter Decliner");
  await openEditor(page, "tee-classic-crew", "men", "pro");
  await page.getByTestId("tab-muse").click();
  await page.getByTestId("muse-puter-offer").click();
  await expect(page.getByTestId("muse-puter-consent")).toContainText("Puter bills you");
  await expect(page.getByTestId("muse-puter-consent")).toContainText("ModVerse credits do not pay");
  await page.getByTestId("muse-puter-decline").click();
  expect(puterLoaded).toBe(false); // nothing from Puter loads without consent
  await page.getByTestId("muse-input").fill("Make the sleeves navy");
  await page.getByTestId("muse-input").press("Enter");
  await expect(page.getByTestId("muse-apply")).toBeVisible({ timeout: 30_000 });
});
