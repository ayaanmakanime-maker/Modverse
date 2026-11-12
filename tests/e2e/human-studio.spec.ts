import { expect, test } from "@playwright/test";
import { openEditor, register } from "./helpers";

test("Human Studio: the CC0 body is fitted to tape measurements, tape-checked, wears a fitted 3D collection garment and exports", async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/design/human-studio");
  const canvas = page.getByTestId("human-canvas");
  await expect(canvas).toHaveAttribute("data-ready", "1", { timeout: 120_000 });
  await page.getByRole("radio", { name: "Woman" }).click();
  const t = { height: 163, chest: 92, waist: 72, hip: 100, shoulder: 38, armLength: 55, inseam: 76 };
  for (const [k, v] of Object.entries(t)) await page.getByTestId(`hm-in-${k}`).fill(String(v));
  await page.getByTestId("hm-fit").click();
  await expect(page.getByTestId("hm-fit-result")).toBeVisible({ timeout: 120_000 });
  for (const k of Object.keys(t)) {
    await expect.poll(async () => Math.abs(Number(await page.getByTestId(`hm-out-${k}`).getAttribute("data-delta"))), { timeout: 30_000, message: k }).toBeLessThanOrEqual(1);
  }
  // dressed by default: a fitted 3D collection garment, hair, brows, lashes, eyes and shoes
  await expect(canvas).not.toHaveAttribute("data-garment", "none", { timeout: 120_000 });
  await expect(canvas).not.toHaveAttribute("data-hair", "none", { timeout: 60_000 });
  expect(Number(await canvas.getAttribute("data-worn"))).toBeGreaterThanOrEqual(5);
  // face and look
  await page.getByRole("tab", { name: "Face" }).click();
  await page.getByTestId("hm-shape-round").click();
  expect(await page.getByTestId("hm-tab-face").getByRole("slider").count()).toBeGreaterThanOrEqual(25);
  await page.getByRole("tab", { name: "Skin & hair" }).click();
  await page.getByTestId("hm-hair-long01").click();
  await expect(canvas).toHaveAttribute("data-hair", "long01", { timeout: 60_000 });
  await page.getByTestId("hm-hairtint-auburn").click();
  await page.getByTestId("hm-eye-green").click();
  // alive: the default pose animates; walking simulates the loose fabric
  await expect(canvas).toHaveAttribute("data-pose", "relaxed");
  await page.getByTestId("hm-pose-walk").click();
  await expect(canvas).toHaveAttribute("data-cloth", "on");
  await expect.poll(async () => Number(await canvas.getAttribute("data-cloth-particles")), { timeout: 60_000 }).toBeGreaterThan(500);
  const f0 = Number(await canvas.getAttribute("data-frames"));
  await expect.poll(async () => Number(await canvas.getAttribute("data-frames")), { timeout: 60_000 }).toBeGreaterThan(f0 + 15);
  await page.getByTestId("hm-cloth").uncheck();
  await expect(canvas).toHaveAttribute("data-cloth", "off");
  // the avatar as shown exports as one scene: body, eyes, hair, brows, lashes, shoes and the garment
  const [d] = await Promise.all([page.waitForEvent("download", { timeout: 90_000 }), page.getByTestId("export3d-glb").click()]);
  expect(d.suggestedFilename()).toMatch(/^modverse-avatar-.+\.glb$/);
  const chunks: Buffer[] = [];
  for await (const c of await d.createReadStream()) chunks.push(c as Buffer);
  const glb = Buffer.concat(chunks);
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8"));
  expect(json.meshes.length).toBeGreaterThanOrEqual(5);
  expect(json.images?.length ?? 0).toBeGreaterThanOrEqual(3);
  expect(errors).toEqual([]);
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
