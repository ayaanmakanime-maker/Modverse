import { expect, test } from "@playwright/test";
import { openEditor, register, saveDesign } from "./helpers";

const ORIGIN = { Origin: "http://localhost:3100" };

test("Design Studio, Atelier and Atelier Pro share one engine", async ({ page }) => {
  await register(page, "Designer");
  for (const [mode, tab] of [["studio", "tab-start"], ["atelier", "tab-construction"], ["pro", "tab-techpack"]] as const) {
    await openEditor(page, "tee-classic-crew", "men", mode);
    await expect(page.getByTestId(tab)).toBeVisible();
  }
  await expect(page.getByTestId("tab-measurements")).toBeVisible();
});

test("text, typography, library graphics, patterns, construction, undo/redo, Muse, save and versions", async ({ page }) => {
  await register(page, "Atelier User");
  await openEditor(page, "shirt-classic-formal", "men", "atelier");

  // Text + typography
  await page.getByTestId("tab-text").click();
  await page.locator("#new-text").fill("ModVerse\nमुंबई");
  await page.getByTestId("add-text").click();
  await expect(page.locator("[data-layer-id]")).toHaveCount(1);
  const props = page.getByTestId("text-properties").first();
  await props.getByTestId("text-content").fill("Kolkata");
  await props.getByRole("option", { name: /Playfair Display/ }).click();
  await props.getByRole("radio", { name: "Arched" }).click();
  await expect(page.locator("[data-layer-id] textPath")).toHaveCount(1);

  // Real Creative Library graphic + pattern on sleeves
  await page.getByTestId("tab-library").click();
  await page.getByTestId("asset-MVG_001").click();
  await expect(page.locator("[data-layer-id]")).toHaveCount(2);
  await page.getByRole("button", { name: "Patterns" }).click();
  await page.getByLabel("Pattern target panel").selectOption("sleeveLeft");
  await page.getByTestId("asset-MVP_001").click();

  // Construction change: mandarin collar, then undo/redo
  await page.getByTestId("tab-construction").click();
  await page.getByRole("radio", { name: "Mandarin" }).click();
  await page.getByTestId("undo").click();
  await page.getByTestId("redo").click();

  // AI Muse applies real changes
  await page.getByTestId("tab-muse").click();
  await page.getByTestId("muse-input").fill("make the sleeves navy and the buttons brown");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/sleeveLeft colour → navy/)).toBeVisible();
  // AI Muse proposes a previewed transaction; nothing changes until it is applied.
  await expect(page.getByTestId("muse-proposal").last()).toContainText("Left sleeve colour");
  await page.getByTestId("muse-apply").last().click();

  const id = await saveDesign(page);
  const res = await page.request.get(`/api/designs/${id}`);
  const { version } = await res.json();
  const c = version.config;
  expect(c.construction.collar).toBe("mandarin");
  expect(c.panels.sleeveLeft.patternId).toBe("MVP_001");
  expect(c.panels.sleeveLeft.color).toBe("#1B2A47");
  expect(c.construction.buttons.color).toBe("#5C4033");
  const text = c.layers.find((l: { type: string }) => l.type === "text");
  expect(text.text).toBe("Kolkata");
  expect(text.fontFamily).toBe("Playfair Display");
  expect(text.curve.mode).toBe("arc");
  expect(c.layers.some((l: { assetId?: string }) => l.assetId === "MVG_001")).toBe(true);

  // Versions
  await page.getByTestId("tab-versions").click();
  await page.getByRole("button", { name: /Save as v2/ }).click();
  await expect(page.getByText("v2").first()).toBeVisible();
  const versions = await (await page.request.get(`/api/designs/${id}/versions`)).json();
  expect(versions.versions.length).toBe(2);
});

test("validation, uploads and technical documents", async ({ page }) => {
  await register(page, "Pro User");
  await openEditor(page, "tee-oversized", "men", "pro");
  // Upload a real PNG (1x1) — goes through server-side type detection
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await page.getByTestId("tab-upload").click();
  await page.getByTestId("upload-input").setInputFiles({ name: "dot.png", mimeType: "image/png", buffer: png });
  await expect(page.locator("[data-layer-id]")).toHaveCount(1);
  // A 1 px image at chest size must fail the DPI check
  await page.getByTestId("tab-check").click();
  await expect(page.getByTestId("issue-IMAGE_LOW_RES")).toBeVisible();
  await page.getByTestId("issue-IMAGE_LOW_RES").getByRole("button", { name: /Shrink to 150 DPI/ }).click();
  const id = await saveDesign(page);
  const pdf = await page.request.get(`/api/designs/${id}/techpack?format=pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  const json = await (await page.request.get(`/api/designs/${id}/techpack?format=json`)).json();
  expect(json.documentType).toContain("design intent");
  expect(json.bom.length).toBeGreaterThan(2);
  // Malicious SVG uploads are sanitised
  const up = await page.request.post("/api/uploads", { headers: ORIGIN, multipart: { file: { name: "x.svg", mimeType: "image/svg+xml", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect onclick="x()" width="5" height="5"/></svg>') } } });
  const { upload } = await up.json();
  const body = await (await page.request.get(upload.url)).text();
  expect(body).not.toMatch(/script|onclick/);
});
