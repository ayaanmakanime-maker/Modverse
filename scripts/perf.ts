/**
 * Performance probe (V2 spec, Part 15.4) — run against a production build:
 *
 *   npm run build && npx next start -p 3200 &      # any running instance
 *   PERF_BASE_URL=http://localhost:3200 npm run perf
 *
 * Measures page load (TTFB, FCP, LCP, load), transferred JS, 3D first frame + FPS + scene size,
 * editor responsiveness, trial-room FPS / inference latency (fake camera), and JS heap.
 * Writes docs/evaluation/performance.json. Numbers depend on hardware; in a headless container
 * WebGL runs on SwiftShader (software), so FPS here is a lower bound, not a device benchmark.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { chromium, type Page } from "@playwright/test";

const BASE = process.env.PERF_BASE_URL ?? "http://localhost:3200";

interface Load { url: string; ttfbMs: number; fcpMs: number | null; lcpMs: number | null; domContentLoadedMs: number; loadMs: number; jsKb: number; totalKb: number; requests: number }

async function measureLoad(page: Page, url: string, ready: (p: Page) => Promise<unknown>): Promise<Load> {
  await page.addInitScript(() => {
    (window as unknown as { __lcp: number }).__lcp = 0;
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) (window as unknown as { __lcp: number }).__lcp = e.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
  });
  await page.goto(BASE + url, { waitUntil: "load" });
  await ready(page);
  await page.waitForTimeout(500);
  return page.evaluate((u) => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    const res = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null;
    const js = res.filter((r) => r.initiatorType === "script" || r.name.endsWith(".js")).reduce((a, r) => a + (r.transferSize || r.encodedBodySize), 0);
    const total = res.reduce((a, r) => a + (r.transferSize || r.encodedBodySize), 0) + (nav.transferSize || 0);
    const r = (n: number) => Math.round(n);
    return { url: u, ttfbMs: r(nav.responseStart), fcpMs: fcp === null ? null : r(fcp), lcpMs: r((window as unknown as { __lcp: number }).__lcp) || null, domContentLoadedMs: r(nav.domContentLoadedEventEnd), loadMs: r(nav.loadEventEnd), jsKb: r(js / 1024), totalKb: r(total / 1024), requests: res.length + 1 };
  }, url);
}

async function heapMb(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.collectGarbage").catch(() => undefined);
  const { usedSize } = (await cdp.send("Runtime.getHeapUsage")) as { usedSize: number };
  return Math.round((usedSize / 1048576) * 10) / 10;
}

async function main() {
  const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["camera"] });
  // tsx (esbuild keepNames) wraps named functions in __name(); define it for code passed to page.evaluate.
  await ctx.addInitScript("globalThis.__name = (fn) => fn;");
  const out: Record<string, unknown> = { measuredAt: new Date().toISOString(), baseUrl: BASE, environment: { platform: `${os.platform()} ${os.arch()}`, cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model, memoryGb: Math.round(os.totalmem() / 1073741824), browser: `Chromium ${browser.version()} headless`, webgl: "SwiftShader (software) unless a GPU is available" } };

  // 1. Page loads (cold page per URL, warm server)
  const loads: Load[] = [];
  for (const [url, ready] of [
    ["/", (p: Page) => p.getByRole("img", { name: /ModVerse/ }).first().waitFor()],
    ["/shop/men", (p: Page) => p.getByTestId("product-card").first().waitFor()],
    ["/library", (p: Page) => p.locator("[data-testid^=asset-], img").first().waitFor()],
    ["/design/new?model=tee-classic-crew&audience=men&mode=studio", (p: Page) => p.getByTestId("canvas-2d").waitFor()],
    ["/try-on", (p: Page) => p.getByTestId("trial-room").waitFor()],
  ] as const) {
    const page = await ctx.newPage();
    await page.goto(BASE + url); // warm the server route once
    await page.close();
    const p2 = await ctx.newPage();
    loads.push(await measureLoad(p2, url, ready));
    await p2.close();
  }
  out.pageLoads = loads;

  // 2. 3D viewer: time to first rendered frame, FPS (continuous rendering in the lab), scene size
  {
    const runs: Record<string, unknown>[] = [];
    for (const q of ["auto", "low", "balanced"]) {
      const page = await ctx.newPage();
      const t0 = Date.now();
      await page.goto(`${BASE}/lab/3d?model=shirt-oxford-button-down&color=F5F3EE&view=front${q === "auto" ? "" : `&quality=${q}`}`);
      await page.getByTestId("garment-3d").locator("canvas").waitFor({ timeout: 120_000 });
      const canvasMs = Date.now() - t0;
      await page.getByTestId("viewer-stats").waitFor({ timeout: 60_000 }).catch(() => undefined);
      await page.waitForTimeout(5000);
      const stats = (await page.getByTestId("viewer-stats").textContent().catch(() => null)) ?? "";
      const fps = Number(/(\d+) fps/.exec(stats)?.[1] ?? NaN);
      runs.push({ quality: q, timeToCanvasMs: canvasMs, fps: Number.isFinite(fps) ? fps : null, stats, heapMb: await heapMb(page) });
      await page.close();
    }
    out.viewer3d = { model: "shirt-oxford-button-down", runs };
  }

  // 3. Editor responsiveness (wall-clock incl. Playwright round-trip, so an upper bound),
  //    measured with the default split 2D+3D view and with the 2D canvas alone.
  {
    const editorRuns: Record<string, unknown>[] = [];
    for (const view of ["split", "2d"] as const) {
      const page = await ctx.newPage();
      await page.goto(`${BASE}/design/new?model=tee-classic-crew&audience=men&mode=atelier`);
      await page.getByTestId("canvas-2d").waitFor();
      // Explicit choice: on GPU-less machines the editor opens in 2D by default.
      await page.getByRole("radiogroup", { name: "Canvas view" }).getByRole("radio", { name: view === "2d" ? "2D" : "Split" }).click();
      if (view === "split") await page.getByTestId("garment-3d").locator("canvas").waitFor({ timeout: 120_000 });
      await page.waitForTimeout(1500);
      const time = async (fn: () => Promise<unknown>) => { const t = Date.now(); await fn(); return Date.now() - t; };
      await page.getByTestId("tab-text").click();
      await page.locator("#new-text").fill("SPEED");
      const addText = await time(async () => { await page.getByTestId("add-text").click(); await page.locator("[data-layer-id]").first().waitFor(); });
      await page.getByTestId("tab-library").click();
      await page.getByTestId("asset-MVG_001").waitFor();
      const addGraphic = await time(async () => { await page.getByTestId("asset-MVG_001").click(); await page.locator("[data-layer-id]").nth(1).waitFor(); });
      const undos: number[] = [];
      for (let i = 0; i < 5; i++) {
        undos.push(await time(async () => { await page.getByTestId("undo").click(); await page.waitForFunction((n) => document.querySelectorAll("[data-layer-id]").length === n, 1); }));
        await page.getByTestId("redo").click();
        await page.locator("[data-layer-id]").nth(1).waitFor();
      }
      const drag = await page.evaluate(async () => {
        // Pointer-move processing cost: dispatch 60 moves on a layer and time the main thread.
        const el = document.querySelector("[data-layer-id]") as SVGGraphicsElement | null;
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const x = r.x + r.width / 2, y = r.y + r.height / 2;
        el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true, button: 0, buttons: 1 }));
        const t = performance.now();
        for (let i = 0; i < 60; i++) window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: x + i, clientY: y + i / 2, pointerId: 1, isPrimary: true, buttons: 1 }));
        await new Promise((res) => requestAnimationFrame(() => res(null)));
        const ms = performance.now() - t;
        window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: x + 60, clientY: y + 30, pointerId: 1, isPrimary: true }));
        return Math.round((ms / 60) * 100) / 100;
      });
      editorRuns.push({ view, addTextMs: addText, addLibraryGraphicMs: addGraphic, undoMedianMs: undos.sort((a, b) => a - b)[2], dragMsPerPointerMove: drag, heapMb: await heapMb(page) });
      await page.close();
    }
    out.editor = editorRuns;
  }

  // 4. Trial room with Chromium's fake camera (verifies the pipeline; no real person in frame)
  {
    const page = await ctx.newPage();
    await page.goto(`${BASE}/try-on`);
    const t0 = Date.now();
    await page.getByTestId("start-camera").click();
    await page.getByTestId("stop-camera").waitFor({ timeout: 120_000 });
    const startMs = Date.now() - t0;
    await page.getByText(/FPS/).first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(6000);
    const fps = Number(/(\d+) FPS/.exec((await page.getByText(/\d+ FPS/).first().textContent()) ?? "")?.[1] ?? NaN);
    const infer = Number(/([\d.]+) ms inference/.exec((await page.getByText(/ms inference/).first().textContent()) ?? "")?.[1] ?? NaN);
    out.trialRoom = { cameraStartToTrackingMs: startMs, fps, inferenceMs: infer, heapMb: await heapMb(page), note: "Fake camera device + software WebGL; inference latency is per-frame MediaPipe pose time on CPU." };
    await page.getByTestId("stop-camera").click();
    await page.close();
  }

  await browser.close();
  const file = path.join(process.cwd(), "docs/evaluation/performance.json");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
