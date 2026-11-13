import { expect, test, type Page } from "@playwright/test";

/**
 * AI photo try-on. Puter.js is replaced by a local stub (no real Puter account or AI call in CI): the stub records what
 * the page would send, and returns a fixed picture.
 */
const STUB = `
window.__puterCalls = [];
window.puter = {
  auth: { isSignedIn: () => true, signIn: async () => ({}) },
  ai: {
    listModels: async () => [],
    chat: async () => "ok",
    txt2img: async (prompt, opts) => {
      window.__puterCalls.push({ prompt, model: opts && opts.model, images: ((opts && opts.input_images) || []).map((i) => String(i).slice(0, 22)) });
      if (window.__puterFail) throw { error: { code: window.__puterFail, message: window.__puterFail } };
      const c = document.createElement("canvas"); c.width = 64; c.height = 80;
      const g = c.getContext("2d"); g.fillStyle = "#6E1423"; g.fillRect(0, 0, 64, 80);
      const img = new Image(); img.src = c.toDataURL("image/png"); return img;
    },
  },
};`;

async function photoFile(page: Page) {
  const data = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 480; c.height = 640;
    const g = c.getContext("2d")!;
    g.fillStyle = "#c9b8a6"; g.fillRect(0, 0, 480, 640);
    g.fillStyle = "#333"; g.fillRect(170, 120, 140, 300);
    return c.toDataURL("image/png");
  });
  return { name: "me.png", mimeType: "image/png", buffer: Buffer.from(data.split(",")[1], "base64") };
}

test("photo try-on: photo stays local, nothing loads from Puter before consent, then photo + garment render go to the image model", async ({ page }) => {
  test.setTimeout(150_000);
  const puterRequests: string[] = [];
  await page.route("https://js.puter.com/**", (route) => { puterRequests.push(route.request().url()); return route.fulfill({ contentType: "application/javascript", body: STUB }); });
  const uploads: string[] = [];
  page.on("request", (r) => { if (r.method() !== "GET" && (r.postData()?.length ?? 0) > 50_000) uploads.push(r.url()); });

  await page.goto("/try-on");
  await expect(page.getByTestId("photo-tryon")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("tryon-generate")).toBeDisabled();
  await page.getByTestId("photo-input").setInputFiles(await photoFile(page));
  await expect(page.getByTestId("photo-preview")).toBeVisible();
  // the on-device check runs (no person in this synthetic photo → advice, or "skipped" without the CV runtime)
  await expect(page.getByTestId("photo-check")).toHaveAttribute("data-status", /warn|skipped/, { timeout: 60_000 });
  await expect(page.getByTestId("garment-reference")).toHaveAttribute("data-ready", "1", { timeout: 60_000 });
  // consent is required, and Puter is not contacted until Generate
  await expect(page.getByTestId("tryon-generate")).toBeDisabled();
  await page.getByTestId("consent-puter").check();
  await expect(page.getByTestId("tryon-generate")).toBeDisabled();
  await page.getByTestId("consent-person").check();
  expect(puterRequests).toEqual([]);
  const usage = page.waitForRequest((r) => r.url().endsWith("/api/muse/puter") && r.method() === "POST");
  await page.getByTestId("tryon-generate").click();
  await expect(page.getByTestId("tryon-result")).toBeVisible({ timeout: 60_000 });
  expect(puterRequests.length).toBe(1);
  const calls = await page.evaluate(() => (window as unknown as { __puterCalls: { prompt: string; images: string[] }[] }).__puterCalls);
  expect(calls).toHaveLength(1);
  expect(calls[0].images).toEqual(["data:image/jpeg;base64", "data:image/png;base64,"]);
  expect(calls[0].prompt).toMatch(/Keep the person exactly as they are/);
  // ModVerse only logs the job and outcome — never the photo
  const log = JSON.parse((await usage).postData() ?? "{}");
  expect(log).toMatchObject({ job: "tryon", ok: true });
  expect(uploads).toEqual([]);
  await expect(page.getByTestId("tryon-result-panel")).toContainText("not a fit check");
  const download = page.waitForEvent("download");
  await page.getByTestId("tryon-download").click();
  expect((await download).suggestedFilename()).toMatch(/^modverse-ai-try-on-\d+\.png$/);

  // a moderation refusal is explained, not swallowed
  await page.evaluate(() => { (window as unknown as { __puterFail: string }).__puterFail = "moderation_flagged"; });
  await page.getByTestId("tryon-again").click();
  await expect(page.getByTestId("tryon-consent")).toContainText("safety filter");
});

test("photo try-on: made-to-order styles are rendered as the reference; unsupported files are rejected", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/try-on");
  await page.getByRole("radio", { name: "Made-to-order styles" }).click();
  await page.getByTestId("tryon-lib-search").fill("shirt");
  const first = page.getByTestId("tryon-lib-grid").locator("button").first();
  await first.click();
  await expect(page.getByTestId("garment-reference")).toHaveAttribute("data-ready", "1", { timeout: 60_000 });
  await expect(page.getByTestId("garment-reference").locator("img")).toHaveAttribute("src", /^data:image\/png/);
  await page.getByTestId("photo-input").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(page.getByText("Please choose a JPEG, PNG or WebP photo.")).toBeVisible();
});

test("navigation points to the AI photo try-on", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("footer").getByRole("link", { name: "AI photo try-on" })).toHaveAttribute("href", "/try-on");
});
