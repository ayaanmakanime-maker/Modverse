/**
 * SVG generation for Atelier Pro layer effects (design schema v3).
 *
 * All output is plain SVG 1.1/2 (masks, filters, clip paths, <use>,
 * mix-blend-mode) so the SAME markup renders in the 2D editor, in the 3D
 * panel textures and in print exports. Units are centimetres in the layer's
 * local space: the layer box spans x ∈ [−w/2, w/2], y ∈ [−h/2, h/2].
 */
import type { Adjust, BrushStroke, LayerFilter, LayerMask, MaskShape, Retouch, TextFill, Warp } from "../garment/layer-fx";
import { MESH_N } from "../garment/layer-fx";

const n = (v: number) => (Math.round(v * 1000) / 1000).toString();
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Reference length used to scale brush sizes, feathers and filters with the layer. */
export const refSize = (w: number, h: number) => Math.sqrt(Math.max(0.01, w * h));

type P = [number, number];

/**
 * Filter/mask region in user space around the layer box. (Bounding-box
 * percentages collapse to nothing for straight strokes, whose box has zero
 * height, so every region here is explicit.)
 */
const region = (w: number, h: number, pad: number) => `filterUnits="userSpaceOnUse" x="${n(-w / 2 - pad)}" y="${n(-h / 2 - pad)}" width="${n(w + 2 * pad)}" height="${n(h + 2 * pad)}"`;
const local = (u: number, v: number, w: number, h: number): P => [(u - 0.5) * w, (v - 0.5) * h];

/** Pairs [u, v] (or triples with pressure) from a flat list. */
export function unflatten(points: number[], stride = 2): number[][] {
  const out: number[][] = [];
  for (let i = 0; i + stride - 1 < points.length; i += stride) out.push(points.slice(i, i + stride));
  return out;
}

/* ------------------------------------------------------------------ paths */

/** Smooth open path through points (quadratic midpoints). */
export function smoothPath(pts: P[]): string {
  if (!pts.length) return "";
  if (pts.length === 1) return `M ${n(pts[0][0])} ${n(pts[0][1])} l 0.001 0`;
  if (pts.length === 2) return `M ${n(pts[0][0])} ${n(pts[0][1])} L ${n(pts[1][0])} ${n(pts[1][1])}`;
  let d = `M ${n(pts[0][0])} ${n(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += ` Q ${n(pts[i][0])} ${n(pts[i][1])} ${n(mx)} ${n(my)}`;
  }
  const l = pts[pts.length - 1];
  return `${d} L ${n(l[0])} ${n(l[1])}`;
}

const polyPath = (pts: P[], close = true) => (pts.length ? `M ${pts.map((p) => `${n(p[0])} ${n(p[1])}`).join(" L ")}${close ? " Z" : ""}` : "");

/** Filled outline of a stroke whose half-width varies per point (pressure brushes). */
function variableOutline(pts: P[], half: number[]): string {
  if (pts.length < 2) return "";
  const left: P[] = [];
  const right: P[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    left.push([pts[i][0] - dy * half[i], pts[i][1] + dx * half[i]]);
    right.push([pts[i][0] + dy * half[i], pts[i][1] - dx * half[i]]);
  }
  const caps = [0, pts.length - 1].map((i) => `<circle cx="${n(pts[i][0])}" cy="${n(pts[i][1])}" r="${n(half[i])}"/>`).join("");
  return `<path d="${polyPath([...left, ...right.reverse()])}"/>${caps}`;
}

/** Swept flat nib (calligraphy): the outline of a line segment dragged along the path. */
function nibOutline(pts: P[], halfW: number, angleDeg: number): string {
  if (pts.length < 2) return "";
  const a = (angleDeg * Math.PI) / 180;
  const ox = Math.cos(a) * halfW;
  const oy = Math.sin(a) * halfW;
  // Quads between consecutive nib positions — the union is the swept area.
  let d = "";
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    d += `M ${n(x0 - ox)} ${n(y0 - oy)} L ${n(x0 + ox)} ${n(y0 + oy)} L ${n(x1 + ox)} ${n(y1 + oy)} L ${n(x1 - ox)} ${n(y1 - oy)} Z `;
  }
  return `<path d="${d.trim()}" fill-rule="nonzero"/>`;
}

/* ------------------------------------------------------------- drawings */

/** Markup for a drawing layer's strokes. Eraser strokes mask everything drawn before them. */
export function drawingMarkup(strokes: BrushStroke[], w: number, h: number, id: string): string {
  const R = refSize(w, h);
  const defs: string[] = [];
  const blurIds = new Map<string, string>();
  const blurFilter = (sigma: number) => {
    const key = n(sigma);
    if (!blurIds.has(key)) {
      const fid = `db-${id}-${blurIds.size}`;
      blurIds.set(key, fid);
      defs.push(`<filter id="${fid}" ${region(w, h, R)} primitiveUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="${key}"/></filter>`);
    }
    return blurIds.get(key)!;
  };
  let chalkId: string | null = null;
  const chalk = () => {
    if (!chalkId) {
      chalkId = `dc-${id}`;
      defs.push(`<filter id="${chalkId}" ${region(w, h, R)} primitiveUnits="userSpaceOnUse"><feTurbulence type="fractalNoise" baseFrequency="${n(7)}" numOctaves="2" seed="3" result="t"/><feColorMatrix in="t" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  2.6 0 0 0 -0.9" result="g"/><feComposite in="SourceGraphic" in2="g" operator="in"/></filter>`);
    }
    return chalkId;
  };
  const strokeEl = (s: BrushStroke, color: string): string => {
    const raw = unflatten(s.points, 3);
    const pts = raw.map(([u, v]) => local(u, v, w, h));
    if (!pts.length) return "";
    const W = Math.max(0.01, s.size * R);
    const pressures = raw.map((p) => clamp01(p[2] ?? 0.5));
    const varies = Math.max(...pressures) - Math.min(...pressures) > 0.08;
    const soft = s.tool === "airbrush" ? W * 0.45 : s.tool === "pencil" ? 0 : (1 - s.hardness) * W * 0.35;
    const filter = s.tool === "chalk" ? chalk() : soft > 0.004 ? blurFilter(soft) : null;
    const op = s.opacity * (s.tool === "marker" ? 0.75 : s.tool === "airbrush" ? 0.7 : 1);
    const common = `${op < 0.999 ? ` opacity="${n(op)}"` : ""}${filter ? ` filter="url(#${filter})"` : ""}`;
    if (s.tool === "calligraphy") return `<g fill="${color}"${common}>${nibOutline(pts, W / 2, s.angle)}</g>`;
    if (s.tool === "brush" && varies) return `<g fill="${color}"${common}>${variableOutline(pts, pressures.map((p) => (W / 2) * (0.25 + 0.75 * p)))}</g>`;
    const cap = s.tool === "marker" ? "butt" : s.tool === "pencil" ? "square" : "round";
    const d = s.tool === "pencil" ? polyPath(pts, false) : smoothPath(pts);
    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${n(s.tool === "pencil" ? Math.max(0.02, W * 0.6) : W)}" stroke-linecap="${cap}" stroke-linejoin="round"${common}/>`;
  };
  let acc = "";
  strokes.forEach((s, k) => {
    if (s.tool === "eraser") {
      const mid = `de-${id}-${k}`;
      defs.push(`<mask id="${mid}" maskUnits="userSpaceOnUse" x="${n(-w / 2 - R)}" y="${n(-h / 2 - R)}" width="${n(w + 2 * R)}" height="${n(h + 2 * R)}"><rect x="${n(-w / 2 - R)}" y="${n(-h / 2 - R)}" width="${n(w + 2 * R)}" height="${n(h + 2 * R)}" fill="#fff"/>${strokeEl({ ...s, tool: s.hardness < 0.5 ? "airbrush" : "brush", opacity: s.opacity }, "#000")}</mask>`);
      acc = `<g mask="url(#${mid})">${acc}</g>`;
    } else acc += strokeEl(s, s.color);
  });
  return (defs.length ? `<defs>${defs.join("")}</defs>` : "") + acc;
}

/* ----------------------------------------------------------------- masks */

function shapeEl(s: MaskShape, w: number, h: number, R: number, color: string, filter: string | null): string {
  const f = filter ? ` filter="url(#${filter})"` : "";
  switch (s.kind) {
    case "rect": {
      const [x, y] = local(s.x, s.y, w, h);
      return `<rect x="${n(x)}" y="${n(y)}" width="${n(s.w * w)}" height="${n(s.h * h)}" fill="${color}"${f}/>`;
    }
    case "ellipse": {
      const [cx, cy] = local(s.x + s.w / 2, s.y + s.h / 2, w, h);
      return `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n((s.w * w) / 2)}" ry="${n((s.h * h) / 2)}" fill="${color}"${f}/>`;
    }
    case "polygon":
      return `<path d="${polyPath(unflatten(s.points).map(([u, v]) => local(u, v, w, h)))}" fill="${color}"${f}/>`;
    case "path":
      return `<path d="${s.rings.map((r) => polyPath(unflatten(r).map(([u, v]) => local(u, v, w, h)))).join(" ")}" fill-rule="evenodd" fill="${color}"${f}/>`;
    case "stroke":
      return `<path d="${smoothPath(unflatten(s.points).map(([u, v]) => local(u, v, w, h)))}" fill="none" stroke="${color}" stroke-width="${n(Math.max(0.01, s.size * R))}" stroke-linecap="round" stroke-linejoin="round"${f}/>`;
  }
}

/** <mask> definition for a layer mask (luminance: white shows, black hides). */
export function maskDef(mask: LayerMask, w: number, h: number, maskId: string): string {
  const R = refSize(w, h);
  const on = mask.invert ? "#000" : "#fff";
  const off = mask.invert ? "#fff" : "#000";
  const box = `x="${n(-w / 2 - R)}" y="${n(-h / 2 - R)}" width="${n(w + 2 * R)}" height="${n(h + 2 * R)}"`;
  const filters: string[] = [];
  const feather = new Map<string, string>();
  const featherId = (f: number) => {
    if (f <= 0) return null;
    const key = n(f * R * 0.5);
    if (!feather.has(key)) {
      const fid = `${maskId}-f${feather.size}`;
      feather.set(key, fid);
      filters.push(`<filter id="${fid}" ${region(w, h, R)} primitiveUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="${key}"/></filter>`);
    }
    return feather.get(key)!;
  };
  const shapes = mask.shapes.map((s) => shapeEl(s, w, h, R, s.op === "add" ? on : off, featherId(s.feather))).join("");
  return `${filters.join("")}<mask id="${maskId}" maskUnits="userSpaceOnUse" ${box}><rect ${box} fill="${mask.base === "reveal" ? on : off}"/>${shapes}</mask>`;
}

/* ----------------------------------------------------------- adjustments */

const srgbToLin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linToSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

/** Monotone cubic (Fritsch–Carlson) curve through control points; identity when empty. */
export function curveFn(points: [number, number][]): (x: number) => number {
  if (!points.length) return (x) => x;
  const pts = [...points].sort((a, b) => a[0] - b[0]).filter((p, i, a) => i === 0 || p[0] - a[i - 1][0] > 1e-4);
  if (pts[0][0] > 1e-3) pts.unshift([0, 0]);
  if (pts[pts.length - 1][0] < 1 - 1e-3) pts.push([1, 1]);
  const k = pts.length;
  if (k === 2) {
    const [[x0, y0], [x1, y1]] = pts;
    return (x) => clamp01(y0 + ((y1 - y0) * (x - x0)) / (x1 - x0 || 1));
  }
  const d = pts.slice(0, -1).map((p, i) => (pts[i + 1][1] - p[1]) / (pts[i + 1][0] - p[0]));
  const m = pts.map((_, i) => (i === 0 ? d[0] : i === k - 1 ? d[k - 2] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2));
  for (let i = 0; i < k - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x) => {
    if (x <= pts[0][0]) return clamp01(pts[0][1]);
    if (x >= pts[k - 1][0]) return clamp01(pts[k - 1][1]);
    let i = 0;
    while (i < k - 2 && x > pts[i + 1][0]) i++;
    const hgt = pts[i + 1][0] - pts[i][0];
    const t = (x - pts[i][0]) / hgt;
    const t2 = t * t;
    const t3 = t2 * t;
    return clamp01((2 * t3 - 3 * t2 + 1) * pts[i][1] + (t3 - 2 * t2 + t) * hgt * m[i] + (-2 * t3 + 3 * t2) * pts[i + 1][1] + (t3 - t2) * hgt * m[i + 1]);
  };
}

const hexRgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];

/** Per-channel transfer tables: exposure → levels → brightness/contrast → curves → colour balance → grading. */
export function adjustTables(a: Adjust, samples = 33): [number[], number[], number[]] {
  const rgbCurve = curveFn(a.curves.rgb);
  const chCurves = [curveFn(a.curves.r), curveFn(a.curves.g), curveFn(a.curves.b)];
  const k = a.contrast >= 0 ? 1 + a.contrast * 2 : 1 + a.contrast;
  const ev = Math.pow(2, a.exposure);
  const { inBlack, inWhite, gamma, outBlack, outWhite } = a.levels;
  const sh = hexRgb(a.grade.shadowColor);
  const hi = hexRgb(a.grade.highlightColor);
  const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const shDir = sh.map((c) => c - lum(sh));
  const hiDir = hi.map((c) => c - lum(hi));
  return [0, 1, 2].map((ch) =>
    Array.from({ length: samples }, (_, i) => {
      let x = i / (samples - 1);
      if (a.exposure) x = linToSrgb(Math.min(1, srgbToLin(x) * ev));
      x = Math.pow(clamp01((x - inBlack) / Math.max(0.01, inWhite - inBlack)), 1 / gamma);
      x = outBlack + x * (outWhite - outBlack);
      x = clamp01((x - 0.5) * k + 0.5 + a.brightness * 0.4);
      x = chCurves[ch](rgbCurve(x));
      const ws = (1 - x) * (1 - x);
      const wm = 4 * x * (1 - x);
      const wh = x * x;
      x += 0.3 * (a.balance.shadows[ch] * ws + a.balance.midtones[ch] * wm + a.balance.highlights[ch] * wh);
      const t = clamp01(x + a.grade.balance * 0.25);
      x += 0.7 * (a.grade.shadowAmount * shDir[ch] * (1 - t) * (1 - t) + a.grade.highlightAmount * hiDir[ch] * t * t);
      return Math.round(clamp01(x) * 10000) / 10000;
    }),
  ) as [number[], number[], number[]];
}

const isNeutralTable = (t: number[]) => t.every((v, i) => Math.abs(v - i / (t.length - 1)) < 0.002);

/** Filter primitives for the adjustment stack (consumes `in`, returns the result name). */
function adjustPrimitives(a: Adjust, input: string, tag: string): { prims: string; out: string } {
  const prims: string[] = [];
  let cur = input;
  const tables = adjustTables(a);
  if (!tables.every(isNeutralTable)) {
    const [r, g, b] = tables.map((t) => t.join(" "));
    prims.push(`<feComponentTransfer in="${cur}" result="${tag}t"><feFuncR type="table" tableValues="${r}"/><feFuncG type="table" tableValues="${g}"/><feFuncB type="table" tableValues="${b}"/></feComponentTransfer>`);
    cur = `${tag}t`;
  }
  if (Math.abs(a.hue) > 0.5) {
    prims.push(`<feColorMatrix in="${cur}" type="hueRotate" values="${n(a.hue)}" result="${tag}h"/>`);
    cur = `${tag}h`;
  }
  // Vibrance is approximated as a gentler saturation change (a true per-pixel vibrance needs raster processing).
  const sat = (1 + a.saturation) * (1 + 0.55 * a.vibrance);
  if (Math.abs(sat - 1) > 0.005) {
    prims.push(`<feColorMatrix in="${cur}" type="saturate" values="${n(Math.max(0, sat))}" result="${tag}s"/>`);
    cur = `${tag}s`;
  }
  return { prims: prims.join(""), out: cur };
}

/* --------------------------------------------------------------- filters */

const LUMA_TO_RGB = "0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0 0 0 1 0";

function filterPrimitives(f: LayerFilter, input: string, tag: string, R: number): { prims: string; out: string } {
  const a = f.amount;
  const out = `${tag}o`;
  switch (f.type) {
    case "blur":
      return { prims: `<feGaussianBlur in="${input}" stdDeviation="${n(a * 0.045 * R)}" result="${out}"/>`, out };
    case "sharpen": {
      const sigma = 0.03 + f.size * 0.18;
      return {
        prims: `<feGaussianBlur in="${input}" stdDeviation="${n(sigma)}" result="${tag}b"/><feComposite in="${input}" in2="${tag}b" operator="arithmetic" k2="${n(1 + a * 2.5)}" k3="${n(-a * 2.5)}" result="${tag}u"/><feComposite in="${tag}u" in2="${input}" operator="in" result="${out}"/>`,
        out,
      };
    }
    case "grain": {
      const freq = 2 + (1 - f.size) * 16;
      const mono = f.variant !== "colour";
      return {
        prims: `<feTurbulence type="fractalNoise" baseFrequency="${n(freq)}" numOctaves="2" seed="${f.seed}" result="${tag}n"/><feColorMatrix in="${tag}n" type="matrix" values="${mono ? "1 0 0 0 0  1 0 0 0 0  1 0 0 0 0  0 0 0 0 1" : "1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0 1"}" result="${tag}g"/><feComposite in="${input}" in2="${tag}g" operator="arithmetic" k2="1" k3="${n(a * 0.55)}" k4="${n(-a * 0.275)}" result="${tag}m"/><feComposite in="${tag}m" in2="${input}" operator="in" result="${out}"/>`,
        out,
      };
    }
    case "halftone": {
      const s = 0.15 + f.size * 0.85; // cell size in cm
      const line = f.variant === "line";
      const sq = line ? `x="${n(-s / 2)}" y="${n(-s * 0.3)}" width="${n(s)}" height="${n(s * 0.6)}"` : `x="${n(-s * 0.35)}" y="${n(-s * 0.35)}" width="${n(s * 0.7)}" height="${n(s * 0.7)}"`;
      const tile = `x="${n(-s / 2)}" y="${n(-s / 2)}" width="${n(s)}" height="${n(s)}"`;
      return {
        prims: [
          // ink density: darkness × alpha
          `<feColorMatrix in="${input}" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -0.2126 -0.7152 -0.0722 1 0" result="${tag}d"/>`,
          // one soft dot (or line) per cell, tiled
          `<feFlood flood-color="#fff" ${sq} result="${tag}q"/>`,
          `<feGaussianBlur in="${tag}q" stdDeviation="${line ? `0 ${n(s * 0.16)}` : n(s * 0.18)}" ${tile} result="${tag}c"/>`,
          `<feTile in="${tag}c" result="${tag}f"/>`,
          `<feComponentTransfer in="${tag}f" result="${tag}F"><feFuncA type="linear" slope="1.15" intercept="-0.05"/></feComponentTransfer>`,
          // threshold density against the dot field (amount shifts the threshold)
          `<feComposite in="${tag}d" in2="${tag}F" operator="arithmetic" k2="1" k3="1" k4="${n(-1 + (a - 0.5) * 0.5)}" result="${tag}x"/>`,
          `<feComponentTransfer in="${tag}x" result="${tag}D"><feFuncA type="linear" slope="14" intercept="0"/></feComponentTransfer>`,
          `<feComposite in="${input}" in2="${tag}D" operator="in" result="${out}"/>`,
        ].join(""),
        out,
      };
    }
    case "distort": {
      const v = f.variant || "wave";
      const scale = a * 0.12 * R;
      const s = 0.2 + f.size * 1.6; // feature size (cm)
      const freq = v === "wave" ? `${n(0.6 / (s * 4))} ${n(0.6 / s)}` : v === "ripple" ? n(1 / s) : v === "glitch" ? `0.0001 ${n(1.2 / s)}` : n(3.5 / s);
      const type = v === "roughen" ? "turbulence" : "fractalNoise";
      const oct = v === "roughen" ? 3 : 1;
      const y = v === "glitch" ? `<feColorMatrix in="${tag}n" type="matrix" values="1 0 0 0 0  0 0 0 0 0.5  0 0 0 0 0  0 0 0 0 1" result="${tag}n2"/>` : "";
      return {
        prims: `<feTurbulence type="${type}" baseFrequency="${freq}" numOctaves="${oct}" seed="${f.seed}" result="${tag}n"/>${y}<feDisplacementMap in="${input}" in2="${y ? `${tag}n2` : `${tag}n`}" scale="${n(v === "roughen" ? scale * 0.25 : scale)}" xChannelSelector="R" yChannelSelector="G" result="${out}"/>`,
        out,
      };
    }
    case "texture": {
      const v = f.variant || "distressed";
      if (v === "canvas") {
        const fr = 1.2 + (1 - f.size) * 5;
        return {
          prims: `<feTurbulence type="fractalNoise" baseFrequency="${n(fr * 2.5)} ${n(fr * 0.35)}" numOctaves="2" seed="${f.seed}" result="${tag}a"/><feTurbulence type="fractalNoise" baseFrequency="${n(fr * 0.35)} ${n(fr * 2.5)}" numOctaves="2" seed="${f.seed + 5}" result="${tag}b"/><feComposite in="${tag}a" in2="${tag}b" operator="arithmetic" k2="0.5" k3="0.5" result="${tag}c"/><feColorMatrix in="${tag}c" type="matrix" values="1 0 0 0 0  1 0 0 0 0  1 0 0 0 0  0 0 0 0 1" result="${tag}g"/><feComposite in="${input}" in2="${tag}g" operator="arithmetic" k1="${n(a * 1.4)}" k2="${n(1 - a * 0.7)}" result="${tag}m"/><feComposite in="${tag}m" in2="${input}" operator="in" result="${out}"/>`,
          out,
        };
      }
      const crackle = v === "crackle";
      const fr = crackle ? 0.25 + (1 - f.size) * 1.2 : 0.6 + (1 - f.size) * 4;
      const thr = crackle ? 0.06 + a * 0.12 : 0.62 - a * 0.42;
      const slope = crackle ? -12 : 10;
      const intercept = crackle ? thr * 12 : -thr * 10;
      const holes = `<feTurbulence type="${crackle ? "turbulence" : "fractalNoise"}" baseFrequency="${n(fr)}" numOctaves="${crackle ? 2 : 4}" seed="${f.seed}" result="${tag}n"/><feColorMatrix in="${tag}n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0" result="${tag}r"/><feComponentTransfer in="${tag}r" result="${tag}h"><feFuncA type="linear" slope="${slope}" intercept="${n(intercept)}"/></feComponentTransfer><feComposite in="${input}" in2="${tag}h" operator="out" result="${v === "vintage" ? `${tag}e` : out}"/>`;
      if (v !== "vintage") return { prims: holes, out };
      return {
        prims: `${holes}<feColorMatrix in="${tag}e" type="matrix" values="0.86 0.1 0.04 0 0.04  0.06 0.84 0.04 0 0.03  0.05 0.08 0.72 0 0.02  0 0 0 0.9 0" result="${out}"/>`,
        out,
      };
    }
    case "posterize": {
      const levels = Math.max(2, Math.round(2 + (1 - a) * 8));
      const t = Array.from({ length: levels }, (_, i) => n(i / (levels - 1))).join(" ");
      return { prims: `<feComponentTransfer in="${input}" result="${out}"><feFuncR type="discrete" tableValues="${t}"/><feFuncG type="discrete" tableValues="${t}"/><feFuncB type="discrete" tableValues="${t}"/></feComponentTransfer>`, out };
    }
    case "threshold":
    case "duotone": {
      const [ar, ag, ab] = hexRgb(f.colorA);
      const [br, bg, bb] = hexRgb(f.colorB);
      const func = (c0: number, c1: number) => {
        if (f.type === "duotone") return `type="table" tableValues="${n(c0)} ${n(c1)}"`;
        const cut = Math.round(clamp01(a) * 20);
        return `type="discrete" tableValues="${Array.from({ length: 20 }, (_, i) => n(i < cut ? c0 : c1)).join(" ")}"`;
      };
      return {
        prims: `<feColorMatrix in="${input}" type="matrix" values="${LUMA_TO_RGB}" result="${tag}l"/><feComponentTransfer in="${tag}l" result="${out}"><feFuncR ${func(ar, br)}/><feFuncG ${func(ag, bg)}/><feFuncB ${func(ab, bb)}/></feComponentTransfer>`,
        out,
      };
    }
    case "outline": {
      const r = 0.05 + a * 0.6;
      return {
        prims: `<feMorphology in="${input}" operator="dilate" radius="${n(r)}" result="${tag}d"/><feFlood flood-color="${f.colorA}" result="${tag}c"/><feComposite in="${tag}c" in2="${tag}d" operator="in" result="${tag}r"/><feMerge result="${out}"><feMergeNode in="${tag}r"/><feMergeNode in="${input}"/></feMerge>`,
        out,
      };
    }
    case "emboss": {
      const az = 225 + f.angle;
      return {
        prims: `<feGaussianBlur in="${input}" stdDeviation="${n(0.05 + f.size * 0.3)}" result="${tag}b"/><feSpecularLighting in="${tag}b" surfaceScale="${n(1 + a * 6)}" specularConstant="0.9" specularExponent="18" lighting-color="#ffffff" result="${tag}s"><feDistantLight azimuth="${n(az)}" elevation="42"/></feSpecularLighting><feComposite in="${tag}s" in2="${input}" operator="in" result="${tag}c"/><feComposite in="${input}" in2="${tag}c" operator="arithmetic" k2="1" k3="${n(0.35 + a * 0.5)}" result="${out}"/>`,
        out,
      };
    }
    case "invert":
      return { prims: `<feComponentTransfer in="${input}" result="${out}"><feFuncR type="table" tableValues="1 0"/><feFuncG type="table" tableValues="1 0"/><feFuncB type="table" tableValues="1 0"/></feComponentTransfer>`, out };
  }
}

/** One <filter> for a layer's adjustments + filter stack, or null when there is nothing to apply. */
export function layerFilterDef(adjust: Adjust | null, filters: LayerFilter[], w: number, h: number, filterId: string): { def: string; halftoneAngle: number | null } | null {
  const R = refSize(w, h);
  const parts: string[] = [];
  let cur = "SourceGraphic";
  if (adjust) {
    const r = adjustPrimitives(adjust, cur, "a");
    parts.push(r.prims);
    cur = r.out;
  }
  let pad = 0.1 * R;
  let halftoneAngle: number | null = null;
  filters.filter((f) => f.enabled).forEach((f, i) => {
    const r = filterPrimitives(f, cur, `f${i}`, R);
    parts.push(r.prims);
    cur = r.out;
    if (f.type === "blur") pad = Math.max(pad, f.amount * 0.045 * R * 3);
    if (f.type === "distort") pad = Math.max(pad, f.amount * 0.12 * R);
    if (f.type === "outline") pad = Math.max(pad, 0.05 + f.amount * 0.6 + 0.1);
    if (f.type === "halftone" && halftoneAngle === null) halftoneAngle = f.angle;
  });
  if (!parts.join("")) return null;
  // Rotated (halftone screen angle) filter space needs a square region that covers the rotated box.
  const half = halftoneAngle !== null ? Math.hypot(w, h) / 2 + pad : 0;
  const region = halftoneAngle !== null
    ? `x="${n(-half)}" y="${n(-half)}" width="${n(2 * half)}" height="${n(2 * half)}"`
    : `x="${n(-w / 2 - pad)}" y="${n(-h / 2 - pad)}" width="${n(w + 2 * pad)}" height="${n(h + 2 * pad)}"`;
  return {
    def: `<filter id="${filterId}" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" ${region} color-interpolation-filters="sRGB">${parts.join("")}</filter>`,
    halftoneAngle,
  };
}

/* --------------------------------------------------------------- retouch */

/** Non-destructive retouching: each stroke reveals a processed copy of the original content. */
export function retouchMarkup(contentId: string, ops: Retouch[], w: number, h: number, id: string): { defs: string; markup: string } {
  const R = refSize(w, h);
  const defs: string[] = [];
  const out: string[] = [`<use href="#${contentId}"/>`];
  const box = `x="${n(-w / 2 - R)}" y="${n(-h / 2 - R)}" width="${n(w + 2 * R)}" height="${n(h + 2 * R)}"`;
  ops.forEach((op, k) => {
    const pts = unflatten(op.points).map(([u, v]) => local(u, v, w, h));
    if (!pts.length) return;
    const W = Math.max(0.02, op.size * R);
    const mid = `rm-${id}-${k}`;
    const soft = op.tool === "heal" ? W * 0.3 : W * 0.15;
    defs.push(`<filter id="${mid}-s" ${region(w, h, R)} primitiveUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="${n(soft)}"/></filter><mask id="${mid}" maskUnits="userSpaceOnUse" ${box}><path d="${smoothPath(pts)}" fill="none" stroke="#fff" stroke-width="${n(W)}" stroke-linecap="round" stroke-linejoin="round" filter="url(#${mid}-s)"/></mask>`);
    const fid = `${mid}-p`;
    const s = op.strength;
    let copy = "";
    if (op.tool === "blur") {
      defs.push(`<filter id="${fid}" filterUnits="userSpaceOnUse" ${box} primitiveUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="${n(0.02 + s * W * 0.3)}"/></filter>`);
      copy = `<use href="#${contentId}" filter="url(#${fid})"/>`;
    } else if (op.tool === "sharpen") {
      defs.push(`<filter id="${fid}" filterUnits="userSpaceOnUse" ${box} primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${n(0.06)}" result="b"/><feComposite in="SourceGraphic" in2="b" operator="arithmetic" k2="${n(1 + s * 3)}" k3="${n(-s * 3)}" result="u"/><feComposite in="u" in2="SourceGraphic" operator="in"/></filter>`);
      copy = `<use href="#${contentId}" filter="url(#${fid})"/>`;
    } else if (op.tool === "smudge") {
      // Approximation: content dragged along the stroke direction and softened.
      const [x0, y0] = pts[0];
      const [x1, y1] = pts[pts.length - 1];
      const len = Math.hypot(x1 - x0, y1 - y0) || 1;
      const shift = Math.min(len, W * 1.2) * s;
      defs.push(`<filter id="${fid}" filterUnits="userSpaceOnUse" ${box} primitiveUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="${n(W * 0.12 * s)}"/></filter>`);
      copy = `<use href="#${contentId}" transform="translate(${n(((x1 - x0) / len) * shift)} ${n(((y1 - y0) / len) * shift)})" filter="url(#${fid})"/>`;
    } else {
      // clone / heal: pixels from the source offset; healing (approximate) adds a softer edge and a slight blur.
      const tx = -op.dx * w;
      const ty = -op.dy * h;
      if (op.tool === "heal") defs.push(`<filter id="${fid}" filterUnits="userSpaceOnUse" ${box} primitiveUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="${n(0.015 + W * 0.04)}"/></filter>`);
      copy = `<use href="#${contentId}" transform="translate(${n(tx)} ${n(ty)})"${op.tool === "heal" ? ` filter="url(#${fid})"` : ""}/>`;
    }
    out.push(`<g mask="url(#${mid})"${op.tool === "heal" ? ` opacity="${n(0.55 + s * 0.45)}"` : ""}>${copy}</g>`);
  });
  return { defs: defs.join(""), markup: out.join("") };
}

/* ------------------------------------------------------------------ warp */

/** Projective map of the unit square onto the quad TL, TR, BR, BL. */
export function homography(c: number[]): (u: number, v: number) => P {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = c;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  const det = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(det) < 1e-9) return (u, v) => [u, v];
  const g = (dx3 * dy2 - dx2 * dy3) / det;
  const hh = (dx1 * dy3 - dx3 * dy1) / det;
  const a = x1 - x0 + g * x1, b = x3 - x0 + hh * x3, cc = x0;
  const d = y1 - y0 + g * y1, e = y3 - y0 + hh * y3, f = y0;
  return (u, v) => {
    const den = g * u + hh * v + 1 || 1e-9;
    return [(a * u + b * v + cc) / den, (d * u + e * v + f) / den];
  };
}

const catmull = (p0: number, p1: number, p2: number, p3: number, t: number) =>
  0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);

/** Smooth (Catmull–Rom) interpolation of the 5×5 mesh offsets. */
function meshFn(mesh: number[]): (u: number, v: number) => P {
  const N = MESH_N;
  const at = (i: number, j: number, k: 0 | 1) => mesh[(Math.max(0, Math.min(N, i)) * (N + 1) + Math.max(0, Math.min(N, j))) * 2 + k];
  return (u, v) => {
    const fu = Math.max(0, Math.min(N - 1e-6, u * N));
    const fv = Math.max(0, Math.min(N - 1e-6, v * N));
    const j = Math.floor(fu), i = Math.floor(fv);
    const tu = fu - j, tv = fv - i;
    const res = ([0, 1] as const).map((k) => {
      const rows = [-1, 0, 1, 2].map((di) => catmull(at(i + di, j - 1, k), at(i + di, j, k), at(i + di, j + 1, k), at(i + di, j + 2, k), tu));
      return catmull(rows[0], rows[1], rows[2], rows[3], tv);
    });
    return [u + res[0], v + res[1]];
  };
}

function presetFn(w: Warp): (u: number, v: number) => P {
  const b = w.bend;
  const base = (u: number, v: number): P => {
    const x = 2 * u - 1; // −1…1
    const y = 2 * v - 1;
    switch (w.preset) {
      case "arc": return [u, v - b * 0.5 * (1 - x * x) * (1 - 0.45 * v)];
      case "arch": return [u, v - b * 0.45 * (1 - x * x)];
      case "bulge": return [u, v + b * 0.3 * (1 - x * x) * y];
      case "flag": return [u, v + b * 0.14 * Math.sin(Math.PI * 2 * u)];
      case "wave": return [u, v + b * 0.12 * Math.sin(Math.PI * 2 * u + Math.PI * v)];
      case "fish": return [u, v + b * 0.32 * Math.sin(Math.PI * u) * y * (1 - 0.6 * u)];
      case "rise": return [u, v - b * 0.3 * x * (1 - 0.3 * y)];
      case "squeeze": return [u - b * 0.22 * x * Math.sin(Math.PI * v), v];
      case "inflate": {
        const r2 = Math.min(1, (x * x + y * y) / 2);
        const s = 1 + b * 0.35 * (1 - r2);
        return [0.5 + (x * s) / 2, 0.5 + (y * s) / 2];
      }
      case "twist": {
        const r = Math.min(1, Math.hypot(x, y) / Math.SQRT2);
        const ang = b * Math.PI * 0.6 * (1 - r);
        const c = Math.cos(ang), s = Math.sin(ang);
        return [0.5 + (x * c - y * s) / 2, 0.5 + (x * s + y * c) / 2];
      }
    }
  };
  return (u, v) => {
    const [pu, pv] = base(u, v);
    // horizontal / vertical distortion (keystone-like)
    return [pu + w.h * 0.3 * (u - 0.5) * (2 * v - 1), pv + w.v * 0.3 * (v - 0.5) * (2 * u - 1)];
  };
}

export function warpFn(w: Warp): (u: number, v: number) => P {
  if (w.kind === "perspective") return homography(w.corners);
  if (w.kind === "mesh") return meshFn(w.mesh);
  return presetFn(w);
}

/** Affine matrix mapping triangle s → triangle d. */
function triAffine(s: P[], d: P[]): number[] | null {
  const [[x0, y0], [x1, y1], [x2, y2]] = s;
  const det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (Math.abs(det) < 1e-12) return null;
  const solve = (q0: number, q1: number, q2: number) => {
    const A = ((q1 - q0) * (y2 - y0) - (q2 - q0) * (y1 - y0)) / det;
    const B = ((x1 - x0) * (q2 - q0) - (x2 - x0) * (q1 - q0)) / det;
    return [A, B, q0 - A * x0 - B * y0];
  };
  const [a, c, e] = solve(d[0][0], d[1][0], d[2][0]);
  const [b, dd, f] = solve(d[0][1], d[1][1], d[2][1]);
  return [a, b, c, dd, e, f];
}

/**
 * Piecewise-affine warp: the content is drawn once per triangle of a fine
 * grid, each copy transformed and clipped to its destination triangle.
 */
export function warpMarkup(contentId: string, warp: Warp, w: number, h: number, id: string): { defs: string; markup: string } {
  const f = warpFn(warp);
  const G = warp.kind === "perspective" ? 8 : 10;
  const margin = 0.12;
  const defs: string[] = [];
  const out: string[] = [];
  const eps = 0.06; // overlap between neighbouring triangles hides anti-aliasing seams
  const step = (1 + 2 * margin) / G;
  let k = 0;
  for (let i = 0; i < G; i++) {
    for (let j = 0; j < G; j++) {
      const u0 = -margin + j * step, u1 = u0 + step;
      const v0 = -margin + i * step, v1 = v0 + step;
      for (const tri of [[[u0, v0], [u1, v0], [u1, v1]], [[u0, v0], [u1, v1], [u0, v1]]] as P[][]) {
        const src = tri.map(([u, v]) => local(u, v, w, h));
        const dst = tri.map(([u, v]) => { const [a, b] = f(u, v); return local(a, b, w, h); });
        const m = triAffine(src, dst);
        if (!m) continue;
        const cx = (dst[0][0] + dst[1][0] + dst[2][0]) / 3;
        const cy = (dst[0][1] + dst[1][1] + dst[2][1]) / 3;
        const grown = dst.map(([x, y]) => { const dx = x - cx, dy = y - cy, l = Math.hypot(dx, dy) || 1; return [x + (dx / l) * eps, y + (dy / l) * eps] as P; });
        const cid = `wt-${id}-${k++}`;
        defs.push(`<clipPath id="${cid}"><path d="${polyPath(grown)}"/></clipPath>`);
        out.push(`<g clip-path="url(#${cid})"><use href="#${contentId}" transform="matrix(${m.map(n).join(" ")})"/></g>`);
      }
    }
  }
  return { defs: defs.join(""), markup: out.join("") };
}

/* ------------------------------------------------------------ text fills */

export function textFillDef(fill: TextFill, w: number, h: number, gradId: string): string {
  const stops = [...fill.stops].sort((a, b) => a.offset - b.offset).map((s) => `<stop offset="${n(s.offset)}" stop-color="${s.color}"/>`).join("");
  if (fill.kind === "radial") return `<radialGradient id="${gradId}" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="${n(Math.max(w, h) / 2)}">${stops}</radialGradient>`;
  const a = (fill.angle * Math.PI) / 180;
  const dx = Math.cos(a), dy = Math.sin(a);
  const half = Math.abs((w / 2) * dx) + Math.abs((h / 2) * dy);
  return `<linearGradient id="${gradId}" gradientUnits="userSpaceOnUse" x1="${n(-dx * half)}" y1="${n(-dy * half)}" x2="${n(dx * half)}" y2="${n(dy * half)}">${stops}</linearGradient>`;
}
