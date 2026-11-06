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
  /** Customer-uploaded font (served privately from /api/uploads/:id). */
  assetId?: string | null;
}

// ── Customer-uploaded fonts ───────────────────────────────────────
const customFonts = new Map<string, { family: string; b64: string; mime: string }>();

const customFontUrl = (assetId: string) => `/api/uploads/${assetId}`;

/** Load a customer font, register it with the document (2D) and keep base64 for 3D/print embedding. */
export function loadCustomFont(assetId: string, family: string): Promise<void> {
  if (customFonts.has(assetId)) return Promise.resolve();
  return once(`cfont:${assetId}`, async () => {
    const res = await fetch(customFontUrl(assetId), { credentials: "same-origin" });
    if (!res.ok) throw new Error(`${res.status}`);
    const mime = res.headers.get("content-type") ?? "font/ttf";
    const buf = new Uint8Array(await res.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    if (typeof document !== "undefined" && "fonts" in document && typeof FontFace !== "undefined") {
      const face = new FontFace(family, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
      await face.load();
      document.fonts.add(face);
    }
    customFonts.set(assetId, { family, b64: btoa(bin), mime });
    bump();
  });
}

export const isCustomFontLoaded = (assetId: string) => customFonts.has(assetId);

const FONT_FORMAT: Record<string, string> = { "font/woff2": "woff2", "font/woff": "woff", "font/otf": "opentype", "font/ttf": "truetype" };

export function fontFiles(n: FontNeed): string[] {
  if (n.assetId) return [];
  const f = FONT_BY_FAMILY.get(n.family);
  if (!f) return [];
  const w = nearestWeight(f, n.weight);
  const italic = n.italic && f.italic.includes(w);
  return f.subsets.map((s) => fontFileUrl(f, s, w, italic));
}

export function loadFont(n: FontNeed): Promise<void> {
  if (n.assetId) return loadCustomFont(n.assetId, n.family);
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
    if (n.assetId) {
      const cf = customFonts.get(n.assetId);
      if (cf && !seen.has(`c:${n.assetId}`)) {
        seen.add(`c:${n.assetId}`);
        rules.push(`@font-face{font-family:'${cf.family.replace(/'/g, "")}';src:url(data:${cf.mime};base64,${cf.b64}) format('${FONT_FORMAT[cf.mime] ?? "truetype"}');}`);
      }
      continue;
    }
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
  return config.layers.flatMap((l) => (l.type === "text" ? [{ family: l.fontFamily, weight: l.fontWeight, italic: l.italic, assetId: l.fontAssetId }] : []));
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
