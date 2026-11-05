/**
 * The ModVerse composer: turns a DesignConfig into SVG markup per zone, in
 * centimetre units. The SAME markup is used by the 2D editor (inline SVG) and
 * the 3D renderer (rasterised into panel textures), guaranteeing that text,
 * graphics and patterns render consistently in 2D and 3D.
 */
import { namespaceSvgIds, parseSvgDimensions, recolorSvg, svgInner } from "../svg/sanitize";
import { panelColor } from "../garment/design";
import { polygonToPath, shoulderSlope, sleeveShape, torsoShape, zoneCanvas, type Pt, type Rect } from "../garment/panels";
import type { DesignConfig, Layer, TextLayer } from "../garment/schema";
import type { GarmentMeasurements, PanelId, Zone } from "../garment/types";
import { hexToHsl, hslToHex, isDark } from "../color";

export interface AssetResolver {
  svg(url: string): string | undefined;
  dataUrl(url: string): string | undefined;
  patternUrl(id: string): string | undefined;
}

export const NO_ASSETS: AssetResolver = { svg: () => undefined, dataUrl: () => undefined, patternUrl: () => undefined };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n = (v: number) => (Math.round(v * 1000) / 1000).toString();
const safeId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "");

export function shade(hex: string, dl: number): string {
  const [h, s, l] = hexToHsl(hex);
  return hslToHex(h, s, Math.max(0, Math.min(1, l + dl)));
}

const MINOR_WORDS = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "in", "nor", "of", "on", "or", "per", "the", "to", "via", "vs"]);

/** True title case: words capitalised, minor words lower-case except first/last of each line. */
export function titleCase(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const words = line.split(/(\s+)/);
      const idx = words.map((w, i) => (/\S/.test(w) ? i : -1)).filter((i) => i >= 0);
      const first = idx[0];
      const last = idx[idx.length - 1];
      return words
        .map((w, i) => {
          if (!/\S/.test(w)) return w;
          // Keep deliberate all-caps acronyms (e.g. "NYC") and words with digits as typed.
          if (w.length > 1 && w === w.toUpperCase() && /\p{L}/u.test(w)) return w;
          const lower = w.toLocaleLowerCase();
          if (i !== first && i !== last && MINOR_WORDS.has(lower.replace(/[^\p{L}]/gu, ""))) return lower;
          return lower.replace(/\p{L}/u, (c) => c.toLocaleUpperCase());
        })
        .join("");
    })
    .join("\n");
}

export function transformText(l: Pick<TextLayer, "text" | "textTransform">): string {
  switch (l.textTransform) {
    case "uppercase": return l.text.toUpperCase();
    case "lowercase": return l.text.toLowerCase();
    case "capitalize": return l.text.replace(/(^|[^\p{L}\p{N}'’])(\p{L})/gu, (_m, pre: string, c: string) => pre + c.toUpperCase());
    case "title": return titleCase(l.text);
    default: return l.text;
  }
}

/** Approximate advance width of a string (used for curve radius before real measurement). */
export function estimateTextWidth(l: TextLayer, line: string): number {
  return line.length * l.fontSize * (0.56 + l.letterSpacing) + 0.001;
}

function textBody(l: TextLayer, opts: { fill: string; strokeColor?: string; strokeWidth?: number; filter?: string; pathId: string }): string {
  const text = transformText(l);
  const fs = l.fontSize;
  const attrs = [
    `font-family="'${esc(l.fontFamily)}', sans-serif"`,
    `font-size="${n(fs)}"`,
    `font-weight="${l.fontWeight}"`,
    l.italic ? `font-style="italic"` : "",
    l.underline ? `text-decoration="underline"` : "",
    l.letterSpacing ? `letter-spacing="${n(l.letterSpacing * fs)}"` : "",
    `fill="${opts.fill}"`,
    opts.strokeColor ? `stroke="${opts.strokeColor}" stroke-width="${n(opts.strokeWidth ?? 0)}" stroke-linejoin="round" paint-order="stroke"` : "",
    opts.filter ? `filter="url(#${opts.filter})"` : "",
  ].filter(Boolean).join(" ");
  const anchor = l.align === "left" ? "start" : l.align === "right" ? "end" : "middle";
  const ax = l.align === "left" ? -l.width / 2 : l.align === "right" ? l.width / 2 : 0;

  if (l.curve.mode === "arc" || l.curve.mode === "circle") {
    const line = text.replace(/\n/g, " ");
    const w = estimateTextWidth(l, line);
    let d: string;
    if (l.curve.mode === "circle") {
      const r = Math.max(fs * 1.2, w / (2 * Math.PI) * 1.08);
      // start at bottom so the text's midpoint (startOffset 50%) sits at the top of the circle
      d = `M 0 ${n(r)} A ${n(r)} ${n(r)} 0 1 1 0 ${n(-r)} A ${n(r)} ${n(r)} 0 1 1 0 ${n(r)}`;
      return `<path id="${opts.pathId}" d="${d}" fill="none"/><text ${attrs} text-anchor="middle"><textPath href="#${opts.pathId}" startOffset="50%">${esc(line)}</textPath></text>`;
    }
    const amt = Math.max(-100, Math.min(100, l.curve.amount)) / 100;
    const c = fs * 0.35; // optical centring of the text block on the arc
    if (Math.abs(amt) < 0.02) d = `M ${n(-w)} ${n(c)} L ${n(w)} ${n(c)}`;
    else {
      const theta = Math.abs(amt) * Math.PI; // total sweep angle
      const r = w / theta;
      const sx = r * Math.sin(theta / 2);
      const sy = r * (1 - Math.cos(theta / 2));
      // amt > 0: rainbow (arches up, clockwise over the top); amt < 0: smile (counter-clockwise underneath)
      d = amt > 0
        ? `M ${n(-sx)} ${n(sy / 2 + c)} A ${n(r)} ${n(r)} 0 0 1 ${n(sx)} ${n(sy / 2 + c)}`
        : `M ${n(-sx)} ${n(-sy / 2 + c)} A ${n(r)} ${n(r)} 0 0 0 ${n(sx)} ${n(-sy / 2 + c)}`;
    }
    return `<path id="${opts.pathId}" d="${d}" fill="none"/><text ${attrs} text-anchor="middle"><textPath href="#${opts.pathId}" startOffset="50%">${esc(line)}</textPath></text>`;
  }

  if (l.curve.mode === "vertical") {
    const chars = [...text.replace(/\n/g, "")];
    const step = fs * l.lineHeight * 0.92;
    const top = -((chars.length - 1) * step) / 2;
    return `<text ${attrs} text-anchor="middle">${chars.map((ch, i) => `<tspan x="0" y="${n(top + i * step + fs * 0.35)}">${esc(ch)}</tspan>`).join("")}</text>`;
  }

  const lines = text.split("\n");
  const lh = fs * l.lineHeight;
  const blockH = lines.length * lh;
  let top = -blockH / 2;
  if (l.verticalAlign === "top") top = -l.height / 2;
  if (l.verticalAlign === "bottom") top = l.height / 2 - blockH;
  return `<text ${attrs} text-anchor="${anchor}">${lines.map((ln, i) => `<tspan x="${n(ax)}" y="${n(top + (i + 0.5) * lh + fs * 0.35)}">${esc(ln) || " "}</tspan>`).join("")}</text>`;
}

function textContent(l: TextLayer): string {
  const id = safeId(l.id);
  const parts: string[] = [];
  const defs: string[] = [];
  if (l.background.enabled) {
    const p = l.background.padding;
    parts.push(`<rect x="${n(-l.width / 2 - p)}" y="${n(-l.height / 2 - p)}" width="${n(l.width + 2 * p)}" height="${n(l.height + 2 * p)}" rx="${n(l.background.radius)}" fill="${l.background.color}"/>`);
  }
  // Layered effects (v2): drawn back-to-front, so effects[0] sits directly behind the main text.
  for (let ei = l.effects.length - 1; ei >= 0; ei--) {
    const fx = l.effects[ei];
    const fid = `${id}-fx${ei}`;
    const outlineW = l.outline.enabled ? l.outline.width * 2 : 0;
    let filter: string | undefined;
    if (fx.blur > 0 || fx.kind === "glow") {
      filter = `blur-${fid}`;
      defs.push(`<filter id="${filter}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${n(fx.kind === "glow" ? Math.max(fx.blur, fx.width) : fx.blur)}"/></filter>`);
    }
    const body = (pathId: string) =>
      textBody(l, { fill: fx.color, pathId, filter, strokeColor: fx.color, strokeWidth: fx.kind === "stroke" || fx.kind === "glow" ? outlineW + fx.width * 2 : outlineW || undefined });
    const op = fx.opacity < 1 ? ` opacity="${n(fx.opacity)}"` : "";
    if (fx.kind === "extrude") {
      const steps = Math.max(2, Math.min(14, Math.round(Math.hypot(fx.offsetX, fx.offsetY) / 0.08)));
      const copies: string[] = [];
      for (let k = steps; k >= 1; k--) copies.push(`<g transform="translate(${n((fx.offsetX * k) / steps)} ${n((fx.offsetY * k) / steps)})">${body(`tpx-${fid}-${k}`)}</g>`);
      parts.push(`<g${op}>${copies.join("")}</g>`);
    } else {
      parts.push(`<g transform="translate(${n(fx.offsetX)} ${n(fx.offsetY)})"${op}>${body(`tpx-${fid}`)}</g>`);
    }
  }
  if (l.shadow.enabled) {
    let filter: string | undefined;
    if (l.shadow.blur > 0) {
      filter = `blur-${id}`;
      defs.push(`<filter id="${filter}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${n(l.shadow.blur)}"/></filter>`);
    }
    parts.push(`<g transform="translate(${n(l.shadow.offsetX)} ${n(l.shadow.offsetY)})">${textBody(l, { fill: l.shadow.color, filter, pathId: `tps-${id}`, strokeColor: l.outline.enabled ? l.shadow.color : undefined, strokeWidth: l.outline.enabled ? l.outline.width * 2 : undefined })}</g>`);
  }
  parts.push(`<g class="mv-text-content">${textBody(l, { fill: l.color, pathId: `tp-${id}`, strokeColor: l.outline.enabled ? l.outline.color : undefined, strokeWidth: l.outline.enabled ? l.outline.width * 2 : undefined })}</g>`);
  const inner = parts.join("");
  return (defs.length ? `<defs>${defs.join("")}</defs>` : "") + (l.skewX ? `<g transform="skewX(${n(l.skewX)})">${inner}</g>` : inner);
}

function graphicContent(l: Extract<Layer, { type: "graphic" }>, assets: AssetResolver): string {
  const raw = assets.svg(l.url);
  if (!raw) return `<rect x="${n(-l.width / 2)}" y="${n(-l.height / 2)}" width="${n(l.width)}" height="${n(l.height)}" fill="none" stroke="#888" stroke-width="0.1" stroke-dasharray="0.4 0.3"/>`;
  const dims = parseSvgDimensions(raw);
  let inner = svgInner(namespaceSvgIds(raw, `g${safeId(l.id)}`));
  if (Object.keys(l.colorMap).length) inner = recolorSvg(inner, l.colorMap);
  const [vx, vy, vw, vh] = dims.viewBox;
  const cropped = isCropped(l.crop);
  const vb = cropped ? [vx + l.crop.x * vw, vy + l.crop.y * vh, l.crop.w * vw, l.crop.h * vh] : dims.viewBox;
  return `<svg x="${n(-l.width / 2)}" y="${n(-l.height / 2)}" width="${n(l.width)}" height="${n(l.height)}" viewBox="${vb.map(n).join(" ")}" preserveAspectRatio="xMidYMid meet" overflow="${cropped ? "hidden" : "visible"}">${inner}</svg>`;
}

function imageContent(l: Extract<Layer, { type: "image" }>, assets: AssetResolver, forTexture: boolean): string {
  const href = forTexture ? assets.dataUrl(l.url) : (assets.dataUrl(l.url) ?? l.url);
  if (!href) return `<rect x="${n(-l.width / 2)}" y="${n(-l.height / 2)}" width="${n(l.width)}" height="${n(l.height)}" fill="#8883"/>`;
  if (!isCropped(l.crop)) return `<image href="${esc(href)}" x="${n(-l.width / 2)}" y="${n(-l.height / 2)}" width="${n(l.width)}" height="${n(l.height)}" preserveAspectRatio="none"/>`;
  // Crop: show only the crop window of the source pixels, stretched to the layer box.
  const pw = l.pixelWidth;
  const ph = l.pixelHeight;
  return `<svg x="${n(-l.width / 2)}" y="${n(-l.height / 2)}" width="${n(l.width)}" height="${n(l.height)}" viewBox="${n(l.crop.x * pw)} ${n(l.crop.y * ph)} ${n(l.crop.w * pw)} ${n(l.crop.h * ph)}" preserveAspectRatio="none" overflow="hidden"><image href="${esc(href)}" x="0" y="0" width="${pw}" height="${ph}" preserveAspectRatio="none"/></svg>`;
}

export function isCropped(c: { x: number; y: number; w: number; h: number } | undefined): boolean {
  return !!c && (c.x > 0.0005 || c.y > 0.0005 || c.w < 0.9995 || c.h < 0.9995);
}

/** Markup of a single layer, positioned in zone coordinates (cm). */
export function layerMarkup(l: Layer, assets: AssetResolver, opts: { forTexture?: boolean } = {}): string {
  if (!l.visible) return "";
  const sx = l.flipX ? -1 : 1;
  const sy = l.flipY ? -1 : 1;
  const content = l.type === "text" ? textContent(l) : l.type === "graphic" ? graphicContent(l, assets) : imageContent(l, assets, !!opts.forTexture);
  return `<g data-layer="${esc(l.id)}" transform="translate(${n(l.x)} ${n(l.y)}) rotate(${n(l.rotation)})${sx !== 1 || sy !== 1 ? ` scale(${sx} ${sy})` : ""}" opacity="${n(l.opacity)}">${content}</g>`;
}

/** Pattern fill definition for a panel. Returns [defs, fill]. */
export function patternDef(config: DesignConfig, panel: PanelId, assets: AssetResolver, idPrefix: string): [string, string | null] {
  const ps = config.panels[panel];
  if (!ps.patternId) return ["", null];
  const url = assets.patternUrl(ps.patternId);
  const raw = url ? assets.svg(url) : undefined;
  if (!raw) return ["", null];
  const dims = parseSvgDimensions(raw);
  const tile = 12 * ps.patternScale * (config.audience === "kids" ? 0.75 : 1);
  const id = `${idPrefix}-pat-${panel}`;
  const inner = svgInner(namespaceSvgIds(raw, id));
  return [`<pattern id="${id}" width="${n(tile)}" height="${n(tile)}" patternUnits="userSpaceOnUse"><svg width="${n(tile)}" height="${n(tile)}" viewBox="${dims.viewBox.join(" ")}" preserveAspectRatio="none" opacity="${n(ps.patternOpacity)}">${inner}</svg></pattern>`, `url(#${id})`];
}

function stitchLine(points: Pt[], color: string, double: boolean, offset = 0): string {
  const d = polygonToPath(points, false);
  const base = `<path d="${d}" fill="none" stroke="${color}" stroke-width="0.09" stroke-dasharray="0.32 0.22" transform="translate(0 ${n(offset)})"/>`;
  return double ? base + `<path d="${d}" fill="none" stroke="${color}" stroke-width="0.09" stroke-dasharray="0.32 0.22" transform="translate(0 ${n(offset - 0.6)})"/>` : base;
}

/** Construction details painted onto panel textures (raglan, yoke, side/shoulder panels, stitching). */
function constructionOverlay(config: DesignConfig, zone: Zone, m: GarmentMeasurements, assets: AssetResolver, idPrefix: string): { defs: string; markup: string } {
  const c = config.construction;
  const kids = config.audience === "kids";
  const body = panelColor(config, zone as PanelId);
  const stitch = c.stitching.contrast ? c.stitching.color : isDark(body) ? shade(body, 0.12) : shade(body, -0.18);
  const seam = isDark(body) ? shade(body, 0.08) : shade(body, -0.12);
  const defs: string[] = [];
  const out: string[] = [];
  if (zone === "front" || zone === "back") {
    const t = torsoShape(m, zone, c, kids);
    if (c.sidePanels) {
      const [d, f] = patternDef(config, "sidePanels", assets, idPrefix);
      defs.push(d);
      for (const s of [1, -1]) out.push(`<path d="M ${n(s * (m.chest / 4 + 1))} ${n(m.armholeDepth - 1)} L ${n(s * (m.chest / 4 - 5))} ${n(m.armholeDepth + 2)} L ${n(s * (m.hem / 4 - 5))} ${n(m.bodyLength + 2)} L ${n(s * (m.hem / 4 + 2))} ${n(m.bodyLength + 2)} Z" fill="${f ?? panelColor(config, "sidePanels")}" stroke="${seam}" stroke-width="0.12"/>`);
    }
    if (c.shoulderPanels && c.sleeveStyle !== "raglan") {
      const [d, f] = patternDef(config, "shoulderPanels", assets, idPrefix);
      defs.push(d);
      out.push(`<rect x="${n(-m.shoulderWidth / 2 - 4)}" y="-3" width="${n(m.shoulderWidth + 8)}" height="${n(shoulderSlope(m, kids) + 6.5)}" fill="${f ?? panelColor(config, "shoulderPanels")}" stroke="${seam}" stroke-width="0.12"/>`);
    }
    if (t.raglanSeam) {
      for (const s of [1, -1]) {
        const panel: PanelId = (s === 1) === (zone === "front") ? "sleeveLeft" : "sleeveRight";
        const [d, f] = patternDef(config, panel, assets, `${idPrefix}-r${s}`);
        defs.push(d);
        const seamPts = t.raglanSeam.map(([x, y]) => [s * x, y] as Pt);
        const region: Pt[] = [...seamPts, [s * (m.neckWidth / 2), -3], [s * (m.chest / 4 + 8), -3], [s * (m.chest / 4 + 8), m.armholeDepth]];
        out.push(`<path d="${polygonToPath(region)}" fill="${f ?? panelColor(config, panel)}"/>`);
        out.push(`<path d="${polygonToPath(seamPts, false)}" fill="none" stroke="${seam}" stroke-width="0.14"/>`);
      }
    }
    if (c.backYoke !== "none" && (zone === "back" || c.backYoke === "western")) {
      const [d, f] = patternDef(config, "yoke", assets, idPrefix);
      defs.push(d);
      const yokeFill = f ?? panelColor(config, "yoke");
      const W = m.chest / 2 + 6;
      const path = zone === "back"
        ? c.backYoke === "western" ? `M ${n(-W)} -3 L ${n(W)} -3 L ${n(W)} ${n(m.yokeDepth * 0.7)} L 0 ${n(m.yokeDepth)} L ${n(-W)} ${n(m.yokeDepth * 0.7)} Z` : `M ${n(-W)} -3 L ${n(W)} -3 L ${n(W)} ${n(m.yokeDepth)} L ${n(-W)} ${n(m.yokeDepth)} Z`
        : [1, -1].map((s) => `M ${n(s * 1.6)} -3 L ${n(s * W)} -3 L ${n(s * W)} ${n(m.yokeDepth * 0.55)} L ${n(s * m.shoulderWidth * 0.22)} ${n(m.yokeDepth * 0.75)} Z`).join(" ");
      out.push(`<path d="${path}" fill="${yokeFill}" stroke="${seam}" stroke-width="0.12"/>`);
      if (c.stitching.contrast) out.push(`<path d="${path}" fill="none" stroke="${stitch}" stroke-width="0.08" stroke-dasharray="0.3 0.2" transform="translate(0 0.4)"/>`);
    }
    if (zone === "back" && c.backPleat !== "none") {
      const top = m.yokeDepth || 8;
      const xs = c.backPleat === "box" ? [-1.6, 1.6] : [-m.shoulderWidth * 0.32, m.shoulderWidth * 0.32];
      for (const x of xs) out.push(`<line x1="${n(x)}" x2="${n(x)}" y1="${n(top)}" y2="${n(top + 9)}" stroke="${seam}" stroke-width="0.12"/><rect x="${n(x - 0.6)}" y="${n(top)}" width="1.2" height="9" fill="#000" opacity="0.05"/>`);
    }
    if (zone === "back" && c.darts) for (const s of [1, -1]) out.push(`<path d="M ${n(s * m.chest * 0.1)} ${n(m.armholeDepth + 2)} L ${n(s * m.chest * 0.112)} ${n(t.waistY)} L ${n(s * m.chest * 0.1)} ${n(m.bodyLength - 8)}" fill="none" stroke="${seam}" stroke-width="0.12"/>`);
    // hem stitching (follows hem curve)
    const hemPts = t.outline.filter(([, y]) => y > m.bodyLength - m.hemCurve - 0.6).sort((a, b) => a[0] - b[0]);
    out.push(stitchLine(hemPts, stitch, c.stitching.style === "double", -1.4));
    // armhole / side seams (subtle)
    const side = t.outline.filter(([x, y]) => x > 0 && y >= m.armholeDepth - 0.2 && y <= m.bodyLength - m.hemCurve);
    for (const s of [1, -1]) out.push(`<path d="${polygonToPath(side.map(([x, y]) => [s * x, y] as Pt), false)}" fill="none" stroke="${seam}" stroke-width="0.14"/>`);
    if (c.sideSlits) for (const s of [1, -1]) out.push(`<line x1="${n(s * (m.hem / 4 - 0.1))}" x2="${n(s * (m.hem / 4 - 0.1))}" y1="${n(m.bodyLength - m.hemCurve - 6)}" y2="${n(m.bodyLength - m.hemCurve + 0.5)}" stroke="${shade(body, -0.35)}" stroke-width="0.35"/>`);
    // neckline stitching
    out.push(stitchLine(t.neckline, stitch, false, config.garmentType === "shirt" ? 0.7 : m.collarHeight + 0.4));
    if (zone === "front" && (c.placket === "standard" || c.placket === "contrast" || c.placket === "henley")) {
      const len = c.placket === "henley" ? m.placketLength : m.bodyLength - m.frontNeckDrop;
      out.push(`<line x1="${n(-m.placketWidth / 2 + 0.25)}" x2="${n(-m.placketWidth / 2 + 0.25)}" y1="${n(m.frontNeckDrop)}" y2="${n(m.frontNeckDrop + len)}" stroke="${stitch}" stroke-width="0.08" stroke-dasharray="0.3 0.2"/>`);
    }
  } else if (zone === "sleeveLeft" || zone === "sleeveRight") {
    const sl = sleeveShape(m, c);
    if (c.cuff === "hem" || c.cuff === "none") out.push(stitchLine([[-sl.halfOpening, sl.length - 1.5], [sl.halfOpening, sl.length - 1.5]], stitch, c.stitching.style === "double"));
  }
  return { defs: defs.join(""), markup: out.join("") };
}

/** Full texture SVG for one zone (px size derived from cm canvas). */
export function zoneTextureSvg(config: DesignConfig, zone: Zone, m: GarmentMeasurements, assets: AssetResolver, opts: { pxPerCm?: number; fontCss?: string; includeLayers?: boolean } = {}): { svg: string; canvas: Rect; widthPx: number; heightPx: number } {
  const canvas = zoneCanvas(m, zone);
  const pxPerCm = opts.pxPerCm ?? 14;
  const W = canvas.x1 - canvas.x0;
  const H = canvas.y1 - canvas.y0;
  const widthPx = Math.round(Math.min(2048, W * pxPerCm));
  const heightPx = Math.round(Math.min(2048, H * pxPerCm));
  const panel: PanelId = zone;
  const idPrefix = `z-${zone}`;
  const base = panelColor(config, panel);
  const [patDefs, patFill] = patternDef(config, panel, assets, idPrefix);
  const overlay = constructionOverlay(config, zone, m, assets, idPrefix);
  const layers = opts.includeLayers === false ? "" : config.layers.filter((l) => l.zone === zone).map((l) => layerMarkup(l, assets, { forTexture: true })).join("");
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${widthPx}" height="${heightPx}" viewBox="${n(canvas.x0)} ${n(canvas.y0)} ${n(W)} ${n(H)}" preserveAspectRatio="none">`,
    opts.fontCss ? `<style>${opts.fontCss}</style>` : "",
    `<defs>${patDefs}${overlay.defs}</defs>`,
    `<rect x="${n(canvas.x0)}" y="${n(canvas.y0)}" width="${n(W)}" height="${n(H)}" fill="${base}"/>`,
    patFill ? `<rect x="${n(canvas.x0)}" y="${n(canvas.y0)}" width="${n(W)}" height="${n(H)}" fill="${patFill}"/>` : "",
    overlay.markup,
    layers,
    `</svg>`,
  ].join("");
  return { svg, canvas, widthPx, heightPx };
}

/** Print-ready artwork export for one zone: transparent background, artwork only, real-world size in cm. */
export function zoneArtworkSvg(config: DesignConfig, zone: Zone, m: GarmentMeasurements, assets: AssetResolver, fontCss = ""): string {
  const canvas = zoneCanvas(m, zone);
  const W = canvas.x1 - canvas.x0;
  const H = canvas.y1 - canvas.y0;
  const layers = config.layers.filter((l) => l.zone === zone).map((l) => layerMarkup(l, assets, { forTexture: true })).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n(W)}cm" height="${n(H)}cm" viewBox="${n(canvas.x0)} ${n(canvas.y0)} ${n(W)} ${n(H)}">${fontCss ? `<style>${fontCss}</style>` : ""}<title>ModVerse artwork — ${zone} (1 unit = 1 cm)</title>${layers}</svg>`;
}

/** Front torso overlay (garment outline clipped, with construction + artwork) for the 2D virtual trial room. */
export function torsoOverlaySvg(config: DesignConfig, m: GarmentMeasurements, assets: AssetResolver, fontCss = ""): { svg: string; canvas: Rect; widthPx: number; heightPx: number } {
  const z = zoneTextureSvg(config, "front", m, assets, { pxPerCm: 10, fontCss });
  const t = torsoShape(m, "front", config.construction, config.audience === "kids");
  const inner = z.svg.slice(z.svg.indexOf(">") + 1, z.svg.lastIndexOf("</svg>"));
  const c = z.canvas;
  const W = c.x1 - c.x0;
  const H = c.y1 - c.y0;
  const outline = polygonToPath(t.outline);
  const rib = config.garmentType === "tshirt" ? `<path d="${polygonToPath(t.neckline, false)}" fill="none" stroke="${panelColor(config, "collar")}" stroke-width="${n(m.collarHeight * 0.9)}" stroke-linecap="round"/>` : `<path d="${polygonToPath(t.neckline, false)}" fill="none" stroke="${panelColor(config, "collar")}" stroke-width="3" stroke-linecap="round"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${z.widthPx}" height="${z.heightPx}" viewBox="${n(c.x0)} ${n(c.y0)} ${n(W)} ${n(H)}"><defs><clipPath id="to-clip"><path d="${outline}"/></clipPath></defs><g clip-path="url(#to-clip)">${inner}</g><path d="${outline}" fill="none" stroke="#000" stroke-opacity="0.25" stroke-width="0.25"/>${rib}</svg>`;
  return { svg, canvas: c, widthPx: z.widthPx, heightPx: z.heightPx };
}

/** Flat sleeve overlay (folded flat: half circumference), cap top at (0,0). */
export function sleeveOverlaySvg(config: DesignConfig, m: GarmentMeasurements, side: "sleeveLeft" | "sleeveRight"): { svg: string; box: Rect } {
  const sl = sleeveShape(m, config.construction);
  const pts = sl.outline.map(([x, y]) => [x * 0.5, y] as Pt);
  const half = Math.max(sl.halfBicep, sl.halfOpening) * 0.5 + 0.5;
  const box: Rect = { x0: -half, y0: -0.5, x1: half, y1: sl.length + 0.5 };
  const color = panelColor(config, side);
  const cuff = !["hem", "none"].includes(config.construction.cuff) ? `<rect x="${n(-sl.halfOpening * 0.5)}" y="${n(sl.length - m.cuffHeight)}" width="${n(sl.halfOpening)}" height="${n(m.cuffHeight)}" fill="${panelColor(config, "cuffs")}"/>` : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round((box.x1 - box.x0) * 10)}" height="${Math.round((box.y1 - box.y0) * 10)}" viewBox="${n(box.x0)} ${n(box.y0)} ${n(box.x1 - box.x0)} ${n(box.y1 - box.y0)}"><path d="${polygonToPath(pts)}" fill="${color}" stroke="#000" stroke-opacity="0.25" stroke-width="0.25"/>${cuff}</svg>`;
  return { svg, box };
}
