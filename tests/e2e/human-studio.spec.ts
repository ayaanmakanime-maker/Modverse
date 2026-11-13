import { expect, test } from "@playwright/test";
import { openEditor, register } from "./helpers";

test("Human Studio: the mannequin is shaped to tape measurements, tries a garment on by size with a fit map, moves and exports", async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/design/human-studio");
  const canvas = page.getByTestId("human-canvas");
  await expect(canvas).toHaveAttribute("data-ready", "1", { timeout: 120_000 });
  // a fitting mannequin, not a person: no face, skin or hair controls
  await expect(canvas).toHaveAttribute("data-style", "wire");
  await expect(page.getByRole("tab", { name: "Face" })).toHaveCount(0);
  await expect(page.getByTestId("hm-hair")).toHaveCount(0);
  await page.getByRole("radio", { name: "Women" }).click();
  const t = { height: 163, chest: 92, waist: 72, hip: 100, shoulder: 38, armLength: 55, inseam: 76 };
  for (const [k, v] of Object.entries(t)) await page.getByTestId(`hm-in-${k}`).fill(String(v));
  await page.getByTestId("hm-fit").click();
  await expect(page.getByTestId("hm-fit-result")).toBeVisible({ timeout: 120_000 });
  for (const k of Object.keys(t)) {
    await expect.poll(async () => Math.abs(Number(await page.getByTestId(`hm-out-${k}`).getAttribute("data-delta"))), { timeout: 30_000, message: k }).toBeLessThanOrEqual(1);
  }
  // dressed by default in a fitted 3D collection garment; the size chart recommends a size and the fit map shows it
  await expect(canvas).not.toHaveAttribute("data-garment", "none", { timeout: 120_000 });
  await expect(page.getByTestId("hm-recommended")).toContainText("M");
  await expect(canvas).toHaveAttribute("data-fitmap", "on", { timeout: 120_000 });
  await expect(page.getByTestId("hm-legend")).toBeVisible();
  const tightAt = async () => Number(await page.getByTestId("hm-fit-summary").getAttribute("data-tight"));
  const tightM = await tightAt();
  // two sizes down pulls
  await page.getByTestId("hm-size-XS").click();
  await expect(canvas).toHaveAttribute("data-size", "XS");
  await expect.poll(tightAt, { timeout: 120_000 }).toBeGreaterThan(tightM + 0.05);
  await page.getByTestId("hm-style-solid").click();
  await expect(canvas).toHaveAttribute("data-style", "solid");
  await page.getByTestId("hm-fitmap").uncheck();
  await expect(canvas).toHaveAttribute("data-fitmap", "off");
  // alive: the default pose animates; walking simulates the loose fabric
  await expect(canvas).toHaveAttribute("data-pose", "relaxed");
  await page.getByTestId("hm-pose-walk").click();
  await expect(canvas).toHaveAttribute("data-cloth", "on");
  await expect.poll(async () => Number(await canvas.getAttribute("data-cloth-particles")), { timeout: 60_000 }).toBeGreaterThan(500);
  const f0 = Number(await canvas.getAttribute("data-frames"));
  await expect.poll(async () => Number(await canvas.getAttribute("data-frames")), { timeout: 60_000 }).toBeGreaterThan(f0 + 15);
  await page.getByTestId("hm-cloth").uncheck();
  await expect(canvas).toHaveAttribute("data-cloth", "off");
  // the fitting as shown exports as one scene
  const [d] = await Promise.all([page.waitForEvent("download", { timeout: 90_000 }), page.getByTestId("export3d-glb").click()]);
  expect(d.suggestedFilename()).toMatch(/^modverse-fitting-.+\.glb$/);
  const chunks: Buffer[] = [];
  for await (const c of await d.createReadStream()) chunks.push(c as Buffer);
  const glb = Buffer.concat(chunks);
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8"));
  expect(json.meshes.length).toBeGreaterThanOrEqual(3);
  expect(errors).toEqual([]);
});

test("Human Studio opens with a garment from the link", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/design/human-studio?garment=toigo-keyhole-neck-dress");
  const canvas = page.getByTestId("human-canvas");
  await expect(canvas).toHaveAttribute("data-garment", "toigo-keyhole-neck-dress", { timeout: 120_000 });
  await expect(page.getByRole("radio", { name: "Women" })).toHaveAttribute("aria-checked", "true");
});

test("Human Studio is reached from Atelier Pro and reads saved measurements", async ({ page }) => {
  test.setTimeout(240_000);
  await register(page, "Studio Body");
  const res = await page.request.post("/api/account/measurements", { data: { name: "Tape 2026", audience: "men", measurements: { height: 178, chest: 100, waist: 86, hip: 100, inseam: 80 } }, headers: { origin: new URL(page.url()).origin } });
  expect(res.ok()).toBe(true);
  await openEditor(page, "tee-classic-crew", "men", "pro");
  await page.getByTestId("tab-fit").click();
  await expect(page.getByTestId("open-human-studio")).toHaveAttribute("href", "/design/human-studio");
  await page.goto("/design/human-studio");
  await expect(page.getByTestId("human-canvas")).toHaveAttribute("data-ready", "1", { timeout: 120_000 });
  await page.getByTestId("hm-profile").selectOption({ label: "Tape 2026" });
  await expect(page.getByTestId("hm-in-inseam")).toHaveValue("80");
  await expect(page.getByTestId("hm-in-height")).toHaveValue("178");
});
