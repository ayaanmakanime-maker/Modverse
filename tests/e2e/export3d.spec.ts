import { expect, test } from "@playwright/test";

test("editor Export 3D: the designed garment downloads as GLB, FBX, USDZ, STL, 3MF and DXF with the right units", async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto("/design/new?model=tee-classic-crew&audience=men&mode=atelier");
  await page.getByRole("radio", { name: "3D" }).click();
  await expect(page.getByTestId("garment-viewer").locator("canvas")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("open-export-3d").click();
  const panel = page.getByTestId("export-3d");
  await expect(panel).toContainText("Manufacturing / 3D printing");
  const grab = async (id: string) => {
    const [d] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), panel.getByTestId(id).click()]);
    const chunks: Buffer[] = [];
    for await (const c of await d.createReadStream()) chunks.push(c as Buffer);
    return { name: d.suggestedFilename(), buf: Buffer.concat(chunks) };
  };
  const glb = await grab("export3d-glb");
  expect(glb.name).toMatch(/\.glb$/);
  // glTF is in metres: a T-shirt is well under 2 m wide
  const json = JSON.parse(glb.buf.subarray(20, 20 + glb.buf.readUInt32LE(12)).toString("utf8"));
  const span = Math.max(...json.accessors.filter((a: { max?: number[] }) => a.max?.length === 3).map((a: { max: number[]; min: number[] }) => a.max[0] - a.min[0]));
  expect(span).toBeGreaterThan(0.3);
  expect(span).toBeLessThan(2);
  const fbx = await grab("export3d-fbx");
  expect(fbx.buf.subarray(0, 18).toString("latin1")).toBe("Kaydara FBX Binary");
  expect(fbx.buf.readUInt32LE(23)).toBe(7400);
  expect((await grab("export3d-usdz")).buf.subarray(0, 2).toString("latin1")).toBe("PK");
  const stl = await grab("export3d-stl");
  // STL is in millimetres: read the first triangle's x extent order of magnitude
  const tris = stl.buf.readUInt32LE(80);
  expect(tris).toBeGreaterThan(1000);
  let maxX = 0;
  for (let t = 0; t < Math.min(tris, 4000); t++) for (let v = 0; v < 3; v++) maxX = Math.max(maxX, Math.abs(stl.buf.readFloatLE(84 + t * 50 + 12 + v * 12)));
  expect(maxX).toBeGreaterThan(150); // > 15 cm from the centre line, in mm
  expect((await grab("export3d-3mf")).buf.includes(Buffer.from("3D/3dmodel.model"))).toBe(true);
  expect((await grab("export3d-dxf")).buf.toString("utf8")).toContain("3DFACE");
});
