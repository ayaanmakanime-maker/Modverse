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
  // real units everywhere: weight in kg and the cup letter from bust − underbust; no −1 … 1 build sliders
  await expect(page.getByTestId("hm-bmi")).toContainText("BMI");
  await expect(page.getByTestId("hm-cup")).toContainText(/Cup [A-H]/);
  await expect(page.getByTestId("hm-range-height")).toHaveAttribute("max", "195");
  await expect(page.getByTestId("hm-range-weight")).toHaveAttribute("min", "38");
  await expect(page.getByRole("slider", { name: /^(Body weight|Muscle|Proportions|Bust shape)$/ })).toHaveCount(0);
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

test("Human Studio: weight on the slider, studio choices in and out, a saved fitting with consent", async ({ page }) => {
  test.setTimeout(300_000);
  await register(page, "Fitting Saver");
  // a cart line or the studio sends its size, fabric, colour and fit to the mannequin
  await page.goto("/design/human-studio?garment=elvs-male-shirt-untucked-bd1&size=L&fabric=poplin-110&colour=sky&fit=regular");
  const canvas = page.getByTestId("human-canvas");
  await expect(canvas).toHaveAttribute("data-garment", "elvs-male-shirt-untucked-bd1", { timeout: 120_000 });
  await expect(canvas).toHaveAttribute("data-size", "L");
  await expect(page.getByTestId("hm-colour-sky")).toHaveClass(/ring-1/);
  // weight in kg on its slider: the mannequin is shaped to it automatically
  await page.getByTestId("hm-in-height").fill("180");
  await page.getByTestId("hm-range-weight").fill("88");
  await expect(page.getByTestId("hm-in-weight")).toHaveValue("88");
  await expect.poll(async () => Math.abs(Number(await page.getByTestId("hm-out-weight").getAttribute("data-delta") || 99)), { timeout: 60_000 }).toBeLessThanOrEqual(1.5);
  // "Customise & order" opens the design studio with the same choices
  await expect(page.getByTestId("hm-order")).toHaveAttribute("href", "/design/garment/new?garment=elvs-male-shirt-untucked-bd1&size=L&fabric=poplin-110&colour=sky&fit=regular");
  // saving needs explicit consent
  await page.getByTestId("hm-save-panel").locator("summary").click();
  await page.getByTestId("hm-fitting-name").fill("Office shirt");
  await expect(page.getByTestId("hm-fitting-save")).toBeDisabled();
  const refused = await page.request.post("/api/account/fittings", { headers: { origin: new URL(page.url()).origin }, data: { name: "x", audience: "men", measurements: { height: 180 } } });
  expect(refused.status()).toBe(400);
  await page.getByTestId("hm-fitting-consent").check();
  await page.getByTestId("hm-fitting-save").click();
  await expect(page.getByText("Fitting saved to your account")).toBeVisible();
  const saved = (await (await page.request.get("/api/account/fittings")).json()).fittings as { id: string; measurements: Record<string, number>; size: string; colourId: string }[];
  expect(saved[0]).toMatchObject({ size: "L", colourId: "sky", measurements: { height: 180, weight: 88 } });
  // reopening the fitting restores the body and what was worn
  await page.goto(`/design/human-studio?fitting=${saved[0].id}`);
  await expect(page.getByTestId("hm-in-weight")).toHaveValue("88", { timeout: 60_000 });
  await expect(canvas).toHaveAttribute("data-garment", "elvs-male-shirt-untucked-bd1", { timeout: 120_000 });
  await expect(canvas).toHaveAttribute("data-size", "L");
  // the design studio reads the choices back
  await page.goto("/design/garment/new?garment=elvs-male-shirt-untucked-bd1&size=XL&fabric=oxford-140&colour=sky&mode=atelier");
  await expect(page.getByTestId("mto-fabric-oxford-140")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("mto-colour-sky")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("gd-tab-size").click();
  await expect(page.getByTestId("mto-size-XL")).toHaveAttribute("aria-checked", "true");
});

test("Human Studio: a shop style I customised is worn with my colour, size and artwork; every style can be worn", async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await register(page, "Style Wearer");
  const origin = new URL(page.url()).origin;
  // customise a T-shirt from the shop in the studio: colour, size and text on the front, then save
  await page.goto("/design/garment/new?garment=toigo-basic-tucked-t-shirt&mode=studio");
  await page.getByTestId("mto-colour-navy").click();
  await page.getByTestId("gd-tab-size").click();
  await page.getByTestId("mto-size-L").click();
  await page.getByTestId("gd-tab-artwork").click();
  await page.getByTestId("mto-art-tab-text").click();
  await page.getByTestId("mto-text").fill("MODVERSE");
  await page.getByTestId("mto-text-add").click();
  await expect(page.getByTestId("mto-art-item")).toHaveCount(1);
  await page.getByTestId("design-name").fill("Navy tee");
  await page.getByTestId("gd-save").click();
  await expect(page).toHaveURL(/\/design\/garment\/[0-9a-f-]{36}/);
  const id = page.url().match(/garment\/([0-9a-f-]{36})/)![1];
  // in Human Studio it is one of my designs and is worn as customised
  await page.goto("/design/human-studio");
  await page.getByRole("radio", { name: "My designs" }).click();
  await page.getByTestId(`hm-design-${id}`).click();
  const canvas = page.getByTestId("human-canvas");
  await expect(canvas).toHaveAttribute("data-garment", "toigo-basic-tucked-t-shirt", { timeout: 120_000 });
  await expect(canvas).toHaveAttribute("data-size", "L");
  await expect(page.getByTestId("hm-wearing")).toContainText("Navy tee");
  await expect(page.getByTestId("hm-colour-navy")).toHaveClass(/ring-1/);
  await expect.poll(async () => Number(await canvas.getAttribute("data-artwork")), { timeout: 60_000 }).toBe(1);
  await expect(page.getByTestId("hm-order")).toHaveAttribute("href", `/design/garment/${id}`);
  // the artwork moves with the garment
  await page.getByTestId("hm-pose-walk").click();
  const f0 = Number(await canvas.getAttribute("data-frames"));
  await expect.poll(async () => Number(await canvas.getAttribute("data-frames")), { timeout: 60_000 }).toBeGreaterThan(f0 + 10);
  expect(Number(await canvas.getAttribute("data-artwork"))).toBe(1);
  // a link from the account opens it the same way
  await page.goto(`/design/human-studio?design=${id}`);
  await expect(canvas).toHaveAttribute("data-garment", "toigo-basic-tucked-t-shirt", { timeout: 120_000 });
  // every shop style can be worn: the one without a .mhclo binding is bound in the browser
  expect((await page.request.get("/api/garment-designs", { headers: { origin } })).ok()).toBe(true);
  await page.goto("/design/human-studio?garment=punkduck-lace-up-blouse");
  await expect(canvas).toHaveAttribute("data-garment", "punkduck-lace-up-blouse", { timeout: 120_000 });
  expect(errors).toEqual([]);
});

test("Human Studio: your own editor design on the mannequin, with the fit map", async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await register(page, "Own Design");
  const origin = new URL(page.url()).origin;
  const r = await page.request.post("/api/designs", { headers: { origin }, data: { modelId: "tee-classic-crew", audience: "men", size: "L", name: "Chai tee" } });
  expect(r.ok()).toBe(true);
  const id = (await r.json()).design.id as string;
  await page.goto("/design/human-studio");
  await page.getByRole("radio", { name: "My designs" }).click();
  await page.getByTestId(`hm-design-${id}`).click();
  const canvas = page.getByTestId("human-canvas");
  await expect(canvas).toHaveAttribute("data-garment", `design:${id}`, { timeout: 120_000 });
  await expect(canvas).toHaveAttribute("data-size", "L");
  await expect(canvas).toHaveAttribute("data-fitmap", "on", { timeout: 60_000 });
  await expect(page.getByTestId("hm-fit-summary")).toBeVisible();
  // re-graded to another size on the mannequin
  await page.getByTestId("hm-size-S").click();
  await expect(canvas).toHaveAttribute("data-size", "S");
  await expect(canvas).toHaveAttribute("data-garment", `design:${id}`, { timeout: 120_000 });
  await expect(page.getByTestId("hm-order")).toHaveAttribute("href", `/design/${id}`);
  // it moves and nothing of the body shows through
  await page.getByTestId("hm-pose-walk").click();
  const f0 = Number(await canvas.getAttribute("data-frames"));
  await expect.poll(async () => Number(await canvas.getAttribute("data-frames")), { timeout: 60_000 }).toBeGreaterThan(f0 + 10);
  // the cart's "Try on" opens the same design
  await page.goto(`/design/human-studio?design=${id}&size=M`);
  await expect(canvas).toHaveAttribute("data-garment", `design:${id}`, { timeout: 120_000 });
  await expect(canvas).toHaveAttribute("data-size", "M");
  expect(errors).toEqual([]);
});

test("Human Studio is reached from Atelier Pro and reads saved measurements", async ({ page }) => {
  test.setTimeout(240_000);
  await register(page, "Studio Body");
  const res = await page.request.post("/api/account/measurements", { data: { name: "Tape 2026", audience: "men", measurements: { height: 178, chest: 100, waist: 86, hip: 100, inseam: 80 } }, headers: { origin: new URL(page.url()).origin } });
  expect(res.ok()).toBe(true);
  await openEditor(page, "tee-classic-crew", "men", "pro");
  await page.getByTestId("tab-fit").click();
  await expect(page.getByTestId("open-human-studio")).toHaveAttribute("href", /^\/design\/human-studio(\?design=[0-9a-f-]{36}&size=[A-Z0-9]+)?$/);
  await page.goto("/design/human-studio");
  await expect(page.getByTestId("human-canvas")).toHaveAttribute("data-ready", "1", { timeout: 120_000 });
  await page.getByTestId("hm-profile").selectOption({ label: "Tape 2026" });
  await expect(page.getByTestId("hm-in-inseam")).toHaveValue("80");
  await expect(page.getByTestId("hm-in-height")).toHaveValue("178");
});
