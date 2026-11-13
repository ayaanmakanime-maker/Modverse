import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { ADMIN, login, openEditor, register } from "./helpers";

const index = JSON.parse(fs.readFileSync(path.join(process.cwd(), "public/garment-library/index.json"), "utf8")) as { garments: { id: string; path: string; glb: string; licence: string; audience: string }[] };

test("3D collection lists only downloaded, licensed garment files; a real model loads, is customised to order and exports", async ({ page }) => {
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
  // the old 3D collection pages now lead to the Men / Women ranges
  await page.goto("/collection?for=women");
  await expect(page).toHaveURL(/\/shop\/women/);
  await page.goto("/collection/toigo-shift-dress");
  await expect(page).toHaveURL(/\/shop\/women\/toigo-shift-dress$/);
  // every made-to-order garment is listed in its range (unisex in both)
  const inMen = index.garments.filter((g) => g.audience !== "women").length;
  await page.goto("/shop/men");
  await expect(page.getByTestId("catalogue-count")).toContainText(`· ${inMen} made-to-order styles`);
  await page.getByTestId("catalogue-q").fill("polo");
  await page.getByTestId("catalogue-apply").click();
  await page.getByTestId("shop-garment-card").first().click();
  const studio = page.getByTestId("library-studio");
  await expect(studio).toHaveAttribute("data-loaded", "yes", { timeout: 120_000 });
  await expect(page.getByTestId("garment-attribution")).toContainText("MakeHuman");
  // made to order: the stocked colour card drives the preview (the creator's texture is off)
  await page.getByTestId("mto-colour-maroon").click();
  await expect(page.getByTestId("mto")).toHaveAttribute("data-valid", "yes");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("library-export").click()]);
  expect(download.suggestedFilename()).toMatch(/preview\.png$/);
  // 3D downloads of the customised garment in every format of the Export Studio
  const grab = async (id: string) => {
    const [d] = await Promise.all([page.waitForEvent("download"), page.getByTestId(id).click()]);
    const chunks: Buffer[] = [];
    for await (const c of await d.createReadStream()) chunks.push(c as Buffer);
    return { name: d.suggestedFilename(), buf: Buffer.concat(chunks) };
  };
  const has = (b: Buffer, s: string) => b.includes(Buffer.from(s));
  const glb = await grab("export3d-glb");
  expect(glb.buf.subarray(0, 4).toString("latin1")).toBe("glTF");
  expect(glb.buf.length).toBeGreaterThan(20_000);
  const gltf = JSON.parse((await grab("export3d-gltf")).buf.toString("utf8"));
  expect(gltf.asset.version).toBe("2.0");
  expect(gltf.meshes.length).toBeGreaterThan(0);
  const obj = await grab("export3d-obj");
  expect(obj.name).toMatch(/-obj\.zip$/);
  for (const n of [".obj", ".mtl", "README.txt"]) expect(has(obj.buf, n), n).toBe(true);
  const fbx = await grab("export3d-fbx");
  expect(fbx.buf.subarray(0, 18).toString("latin1")).toBe("Kaydara FBX Binary");
  expect(fbx.buf.length).toBeGreaterThan(20_000);
  expect((await grab("export3d-ply")).buf.subarray(0, 3).toString("latin1")).toBe("ply");
  const usd = await grab("export3d-usd");
  expect(has(usd.buf, ".usda")).toBe(true);
  const usdz = await grab("export3d-usdz");
  expect(usdz.buf.subarray(0, 2).toString("latin1")).toBe("PK");
  expect(has(usdz.buf, ".usda")).toBe(true);
  // USDC needs OpenUSD on the server: without it the customer is told what to use instead
  if ((await (await page.request.get("/api/export/usdc")).json()).available === false) {
    await page.getByTestId("export3d-usdc").click();
    await expect(page.getByText(/USDC needs OpenUSD/)).toBeVisible();
  }
  expect((await grab("export3d-stl")).buf.length).toBeGreaterThan(10_000);
  const tmf = await grab("export3d-3mf");
  expect(has(tmf.buf, "3D/3dmodel.model")).toBe(true);
  // headless Chromium throttles a long burst of downloads from one page: continue on a fresh load
  await page.reload();
  await expect(studio).toHaveAttribute("data-loaded", "yes", { timeout: 120_000 });
  expect((await grab("export3d-obj-print")).name).toMatch(/-obj-mm\.zip$/);
  const dxf = (await grab("export3d-dxf")).buf.toString("utf8");
  expect(dxf).toContain("AC1009");
  expect(dxf.match(/\n3DFACE\n/g)?.length ?? 0).toBeGreaterThan(1000);
  const zip = (await grab("export-zip")).buf;
  expect(zip.subarray(0, 2).toString("latin1")).toBe("PK");
  for (const name of ["garment.glb", "project.json", "ATTRIBUTION.txt"]) expect(zip.includes(Buffer.from(name))).toBe(true);
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
