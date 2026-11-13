import { expect, test } from "@playwright/test";
import { ADMIN, login, logout, register } from "./helpers";

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

test("Human Studio is Atelier Pro only: Atelier shows a note, Atelier Pro shows the entry in the Fit tab and the toolbar", async ({ page }) => {
  await page.goto("/design/new?model=tee-classic-crew&audience=men&mode=atelier");
  await page.getByTestId("tab-fit").click();
  await expect(page.getByTestId("avatar-pro-only")).toContainText("Atelier Pro");
  await expect(page.getByTestId("open-human-studio")).toHaveCount(0);
  await page.goto("/design/new?model=tee-classic-crew&audience=men&mode=pro");
  await page.getByTestId("tab-fit").click();
  await expect(page.getByTestId("open-human-studio")).toBeVisible();
  await expect(page.getByTestId("avatar-pro-only")).toHaveCount(0);
});
