import { expect, test } from "@playwright/test";
import { ADMIN, login, logout } from "./helpers";

test("graphics library: category browsing, synonym search, suggestions, licence details and placing a graphic", async ({ page }) => {
  await page.goto("/library");
  const cats = page.getByTestId("category-browser");
  await expect(cats).toBeVisible();
  await expect(cats.getByTestId("cat-skulls")).toContainText(/\d/);
  // a category from the brief, with real graphics from the open sources
  await cats.getByTestId("cat-motorcycles").click();
  await expect(page.getByTestId("active-filters")).toContainText("Motorcycles");
  await expect(page.locator('[data-testid="library-item"][data-source]:not([data-source="modverse"])').first()).toBeVisible();
  await page.getByTestId("active-filters").getByRole("button", { name: /Motorcycles/ }).click();

  // Hinglish synonym → elephant; the search box suggests categories while typing
  const search = page.getByTestId("graphics-search");
  await search.fill("haathi");
  await expect(page.getByTestId("graphics-suggest")).toContainText("Animals");
  await expect(page.getByTestId("library-item").filter({ hasText: /Elephant/ }).first()).toBeVisible();
  await search.fill("cars");
  await expect(page.getByTestId("facet-chips")).toContainText("Cars");
  await page.getByTestId("graphics-suggest").getByTestId("suggest-cars").click();
  await expect(page.getByTestId("active-filters")).toContainText("Cars");

  // nothing found → helpful message, not an empty grid
  await search.fill("zzqxv");
  await expect(page.getByTestId("library-empty")).toBeVisible();

  // licence and credit of an attribution-required source
  await search.fill("skull");
  await page.getByTestId("active-filters").getByRole("button", { name: "Clear filters" }).click();
  await page.getByTestId("filter-source").selectOption("game");
  const item = page.getByTestId("library-item").first();
  await expect(item).toHaveAttribute("data-source", "game");
  await item.click();
  await expect(page.getByTestId("asset-credit")).toContainText("Required");
  await expect(page.getByTestId("asset-credit")).toContainText("CC BY 3.0");
  const href = await page.getByTestId("use-in-design").getAttribute("href");
  expect(href).toMatch(/asset=og-game-/);

  // "no credit line needed" hides the CC BY sources
  await page.keyboard.press("Escape");
  await page.getByTestId("filter-source").selectOption("");
  await page.getByTestId("filter-nocredit").check();
  await expect(page.getByTestId("library-item").first()).toBeVisible();
  const r = await (await page.request.get("/api/library?kind=graphic&q=skull&noCredit=1&limit=120")).json();
  expect(r.items.every((a: { sourceId: string | null }) => !["game", "twemoji", "streamline"].includes(a.sourceId ?? ""))).toBe(true);

  // using a graphic carries it to the editor
  await page.goto("/design/new?mode=studio&asset=og-noto-tiger-face");
  await expect(page.getByTestId("carry-asset")).toContainText("Tiger face");
  await page.getByTestId("pick-tee-classic-crew").click();
  await expect(page).toHaveURL(/asset=og-noto-tiger-face/);
  await expect(page.locator("[data-layer-id]")).toHaveCount(1, { timeout: 30_000 });
});

test("editor library panel: category and style filters, and the upload shortcut offers a guest account", async ({ page }) => {
  await page.goto("/design/new?model=tee-classic-crew&audience=men&mode=atelier");
  await page.getByTestId("tab-library").click();
  const panel = page.getByTestId("library-panel");
  await panel.getByTestId("library-category").selectOption("flags");
  await panel.getByTestId("library-style").selectOption("flag");
  const flag = panel.locator('[data-testid^="asset-og-flags-"]').first();
  await expect(flag).toBeVisible();
  await flag.click();
  await expect(page.locator("[data-layer-id]")).toHaveCount(1);
  await panel.getByTestId("library-upload").click();
  await expect(page.getByTestId("upload-panel")).toBeVisible();
  await page.getByTestId("upload-guest").click();
  await expect(page.getByTestId("upload-input")).toBeAttached();
  // a PNG of the customer's own artwork is uploaded and placed
  const png = await page.evaluate(() => { const c = document.createElement("canvas"); c.width = 600; c.height = 600; const g = c.getContext("2d")!; g.fillStyle = "#C8102E"; g.beginPath(); g.arc(300, 300, 250, 0, 7); g.fill(); return c.toDataURL("image/png"); });
  await page.getByTestId("upload-input").setInputFiles({ name: "my-logo.png", mimeType: "image/png", buffer: Buffer.from(png.split(",")[1], "base64") });
  await expect(page.getByText("Artwork uploaded and placed")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("[data-layer-id]")).toHaveCount(2);
});

test("admin graphics registry: sources with licences, CSV with the registry fields, approval hides a source", async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto("/admin/graphics");
  await expect(page.getByTestId("registry-table")).toContainText("Noto Emoji");
  await expect(page.getByTestId("registry-twemoji")).toContainText("Required");
  const csv = await page.request.get("/api/admin/graphics?format=csv");
  const text = await csv.text();
  expect(text.split("\n")[0]).toBe("asset_id,asset_name,category,source_url,creator,licence,commercial_permissions,attribution_requirements,redistribution_restrictions,original_format,optimized_format,download_date,approval_status");
  expect(text).toContain("og-noto-red-apple");
  const before = (await (await page.request.get("/api/library?source=mapicons&limit=1")).json()).total;
  expect(before).toBeGreaterThan(0);
  await page.getByTestId("approval-mapicons").selectOption("pending");
  await expect.poll(async () => (await (await page.request.get("/api/library?source=mapicons&limit=1")).json()).total).toBe(0);
  await page.getByTestId("approval-mapicons").selectOption("approved");
  await expect.poll(async () => (await (await page.request.get("/api/library?source=mapicons&limit=1")).json()).total).toBe(before);
  await logout(page);
});
