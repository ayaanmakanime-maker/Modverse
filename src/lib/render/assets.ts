"use client";
/**
 * Client-side asset cache used by the composer: sanitised SVG markup for
 * library/uploaded graphics, raster images as data URLs (needed because SVG
 * rendered as an image cannot load external resources), pattern tiles, and
 * font files as base64 for embedding in 3D textures.
 */
import { FONT_BY_FAMILY, fontFileUrl, nearestWeight } from "../typography/fonts";
import type { DesignConfig } from "../garment/schema";

const svgText = new Map<string, string>();
const dataUrls = new Map<string, string>();
const fontData = new Map<string, string>();
const patternUrls = new Map<string, string>();
const pending = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
let version = 0;

function bump() {
  version++;
  listeners.forEach((l) => l());
}

export function subscribeAssets(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
export const assetVersion = () => version;

function once(key: string, fn: () => Promise<void>): Promise<void> {
  let p = pending.get(key);
  if (!p) {
    p = fn().catch((e) => {
      console.warn("[assets] failed", key, e);
      pending.delete(key);
    });
    pending.set(key, p);
  }
  return p;
}

export const getSvg = (url: string) => svgText.get(url);
export const getDataUrl = (url: string) => dataUrls.get(url);
export const getPatternUrl = (id: string) => patternUrls.get(id);

export function loadSvg(url: string): Promise<void> {
  if (svgText.has(url)) return Promise.resolve();
  return once(`svg:${url}`, async () => {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) throw new Error(`${res.status}`);
    const text = await res.text();
    if (!/<svg[\s>]/i.test(text)) throw new Error("not svg");
    svgText.set(url, text);
    bump();
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

export function loadDataUrl(url: string): Promise<void> {
  if (dataUrls.has(url)) return Promise.resolve();
  return once(`data:${url}`, async () => {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) throw new Error(`${res.status}`);
    dataUrls.set(url, await blobToDataUrl(await res.blob()));
    bump();
  });
}

export function loadPatterns(ids: string[]): Promise<void> {
  const missing = ids.filter((id) => !patternUrls.has(id));
  if (!missing.length) return Promise.resolve();
  return once(`patterns:${missing.sort().join(",")}`, async () => {
    const res = await fetch(`/api/library?ids=${missing.join(",")}&limit=100`);
    const data = (await res.json()) as { items: { id: string; url: string }[] };
    for (const it of data.items) patternUrls.set(it.id, it.url);
    await Promise.all(data.items.map((it) => loadSvg(it.url)));
    bump();
  });
}

export interface FontNeed {
  family: string;
  weight: number;
  italic: boolean;
}

export function fontFiles(n: FontNeed): string[] {
  const f = FONT_BY_FAMILY.get(n.family);
  if (!f) return [];
  const w = nearestWeight(f, n.weight);
  const italic = n.italic && f.italic.includes(w);
  return f.subsets.map((s) => fontFileUrl(f, s, w, italic));
}

export function loadFont(n: FontNeed): Promise<void> {
  const files = fontFiles(n);
  return Promise.all(
    files.map((url) =>
      fontData.has(url)
        ? Promise.resolve()
        : once(`font:${url}`, async () => {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`${res.status}`);
            const buf = new Uint8Array(await res.arrayBuffer());
            let bin = "";
            for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
            fontData.set(url, btoa(bin));
            bump();
          }),
    ),
  ).then(async () => {
    if (typeof document !== "undefined" && "fonts" in document) {
      try {
        await document.fonts.load(`${n.italic ? "italic " : ""}${n.weight} 32px "${n.family}"`, "AaनमTஅক");
      } catch {
        /* ignore */
      }
    }
  });
}

/** @font-face rules with embedded font data for every font need (for SVG-as-image textures). */
export function embeddedFontCss(needs: FontNeed[]): string {
  const rules: string[] = [];
  const seen = new Set<string>();
  for (const n of needs) {
    const f = FONT_BY_FAMILY.get(n.family);
    if (!f) continue;
    const w = nearestWeight(f, n.weight);
    const italic = n.italic && f.italic.includes(w);
    for (const url of fontFiles(n)) {
      if (seen.has(url)) continue;
      seen.add(url);
      const b64 = fontData.get(url);
      if (b64) rules.push(`@font-face{font-family:'${f.family}';font-weight:${w};font-style:${italic ? "italic" : "normal"};src:url(data:font/woff2;base64,${b64}) format('woff2');}`);
    }
  }
  return rules.join("");
}

export function fontNeeds(config: DesignConfig): FontNeed[] {
  return config.layers.filter((l) => l.type === "text").map((l) => ({ family: (l as { fontFamily: string }).fontFamily, weight: (l as { fontWeight: number }).fontWeight, italic: (l as { italic: boolean }).italic }));
}

/** Load everything a design needs to render (graphics, images, patterns, fonts). */
export async function ensureDesignAssets(config: DesignConfig, opts: { fonts?: boolean } = {}): Promise<void> {
  const jobs: Promise<void>[] = [];
  for (const l of config.layers) {
    if (l.type === "graphic") jobs.push(loadSvg(l.url));
    if (l.type === "image") jobs.push(loadDataUrl(l.url));
  }
  const pats = Object.values(config.panels).map((p) => p.patternId).filter(Boolean) as string[];
  if (pats.length) jobs.push(loadPatterns(pats));
  if (opts.fonts !== false) for (const n of fontNeeds(config)) jobs.push(loadFont(n));
  await Promise.all(jobs);
}
