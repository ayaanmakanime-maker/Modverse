import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { ADMIN, login, logout, register } from "./helpers";

const characters = ["man.fbx", "woman.fbx"].every((f) => fs.existsSync(path.join(process.cwd(), "public", "avatars", f)));

test("scan accuracy: a tape comparison is recorded with consent, shows up in the admin statistics, and the contributor can delete it", async ({ page }) => {
  test.setTimeout(180_000);
  await register(page, "Tape Tester");
  await page.goto("/account/measurements");
  await page.getByTestId("scan-open-men").click();
  await page.getByTestId("scan-consent-check").check();
  await page.getByTestId("scan-start").click();
  await page.getByTestId("scan-height").fill("176");
  await page.getByTestId("scan-camera").click();
  await page.getByTestId("scan-manual").click();
  await page.getByTestId("scan-validate-toggle").check();
  // the fake camera measured nothing: the form says so instead of inventing a scan value
  await expect(page.getByTestId("scan-validate")).toContainText("no scan value");
  await page.getByTestId("tape-chest").fill("101");
  await page.getByTestId("tape-waist").fill("86");
  await page.getByTestId("tape-subject").fill("P01");
  await expect(page.getByTestId("tape-submit")).toBeDisabled(); // consent first
  await page.getByTestId("tape-consent").check();
  await page.getByTestId("tape-submit").click();
  await expect(page.getByTestId("scan-validate")).toContainText("Recorded");

  // the API refuses a contribution without consent, and names instead of codes
  const origin = new URL(page.url()).origin;
  const bad = await page.request.post("/api/fit-validation", { headers: { Origin: origin }, data: { subject: "P02", audience: "men", pairs: { chest: { scanCm: 99, tapeCm: 100 } }, consent: false } });
  expect(bad.status()).toBe(400);
  const named = await page.request.post("/api/fit-validation", { headers: { Origin: origin }, data: { subject: "Rahul Sharma", audience: "men", pairs: { chest: { scanCm: 99, tapeCm: 100 } }, consent: true } });
  expect(named.status()).toBe(400);
  // two real camera-vs-tape pairs for the same person, so the statistics have something to compute
  for (const scan of [99, 103]) expect((await page.request.post("/api/fit-validation", { headers: { Origin: origin }, data: { subject: "P03", audience: "men", device: "test rig", pairs: { chest: { scanCm: scan, tapeCm: 100 } }, consent: true } })).status()).toBe(200);
  // customers cannot read the aggregate
  expect((await page.request.get("/api/admin/fit-validation")).status()).toBe(403);

  await page.goto("/account/measurements");
  await expect(page.getByTestId("scan-comparisons")).toContainText("P01");
  const before = await page.getByTestId("scan-comparison-delete").count();
  await page.getByTestId("scan-comparison-delete").last().click(); // the oldest one (P01); the two P03 repeats stay
  await expect(page.getByTestId("scan-comparison-delete")).toHaveCount(before - 1);

  await logout(page);
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto("/admin/fit-validation");
  // a handful of samples is never presented as an accuracy claim
  await expect(page.getByTestId("fit-validation-evidence")).toContainText(/not evidence of accuracy|Pilot data/);
  const chest = page.getByTestId("fit-validation-chest").first();
  await expect(chest).toContainText("cm");
  await expect(chest).toContainText("people"); // repeatability from the person scanned twice
  await expect(page.getByTestId("fit-validation-sizes")).toContainText("comparisons");
  const csv = await page.request.get("/api/admin/fit-validation?format=csv");
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(await csv.text()).toContain("chest_scan,chest_tape");
});

test("trial room: 3D model mode wears the garment on the rigged character with the customer's proportions", async ({ page }) => {
  test.skip(!characters, "the character files are not installed in public/avatars");
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/try-on");
  await page.getByTestId("tryon-mode-model").click();
  const viewer = page.getByTestId("tryon-model").getByTestId("garment-viewer");
  await expect(viewer).toHaveAttribute("data-avatar", "character", { timeout: 180_000 });
  await expect(viewer).toHaveAttribute("data-garment", "skinned", { timeout: 60_000 });
  await page.getByTestId("tryon-motion-walk").click();
  await expect(viewer).toHaveAttribute("data-motion", "walk");
  await page.getByTestId("tryon-motion-rest").click();
  await page.getByTestId("tryon-mode-camera").click();
  await expect(page.getByTestId("tryon-model")).toHaveCount(0);
  expect(errors).toEqual([]);
});
