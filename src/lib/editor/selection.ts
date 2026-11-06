/**
 * Atelier Pro selection & coordinate helpers (pure functions, no DOM).
 * Selections live in a layer's normalised content space (u, v ∈ 0…1 over
 * the unrotated, unflipped layer box) — the same space as layer masks.
 */
import type { Layer } from "../garment/schema";
import type { LayerMask, MaskShape } from "../garment/layer-fx";

export interface Pt { x: number; y: number }

/** Zone point (cm) → layer content coordinates (u, v). */
export function zoneToUV(l: Pick<Layer, "x" | "y" | "rotation" | "width" | "height" | "flipX" | "flipY">, p: Pt): [number, number] {
  const r = (-l.rotation * Math.PI) / 180;
  const dx = p.x - l.x;
  const dy = p.y - l.y;
  let lx = dx * Math.cos(r) - dy * Math.sin(r);
  let ly = dx * Math.sin(r) + dy * Math.cos(r);
  if (l.flipX) lx = -lx;
  if (l.flipY) ly = -ly;
  return [lx / l.width + 0.5, ly / l.height + 0.5];
}

/** Layer content coordinates → zone point (cm). */
export function uvToZone(l: Pick<Layer, "x" | "y" | "rotation" | "width" | "height" | "flipX" | "flipY">, u: number, v: number): Pt {
  let lx = (u - 0.5) * l.width;
  let ly = (v - 0.5) * l.height;
  if (l.flipX) lx = -lx;
  if (l.flipY) ly = -ly;
  const r = (l.rotation * Math.PI) / 180;
  return { x: l.x + lx * Math.cos(r) - ly * Math.sin(r), y: l.y + lx * Math.sin(r) + ly * Math.cos(r) };
}

export const refLength = (l: Pick<Layer, "width" | "height">) => Math.sqrt(Math.max(0.01, l.width * l.height));
const r4 = (v: number) => Math.round(v * 10000) / 10000;

/** Ramer–Douglas–Peucker for open polylines of [x, y, …extra] tuples. */
export function simplifyPolyline(pts: number[][], eps: number): number[][] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const dx = pts[b][0] - pts[a][0];
    const dy = pts[b][1] - pts[a][1];
    const len = Math.hypot(dx, dy) || 1e-9;
    let best = -1;
    let bestD = eps;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - pts[a][0]) * dy - (pts[i][1] - pts[a][1]) * dx) / len;
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Flatten & round a list of tuples for compact storage. */
export const flatRound = (pts: number[][]) => pts.flatMap((p) => p.map(r4));

/** Bounding box of a shape in normalised coordinates. */
export function shapeBounds(s: MaskShape): { x0: number; y0: number; x1: number; y1: number } {
  if (s.kind === "rect" || s.kind === "ellipse") return { x0: s.x, y0: s.y, x1: s.x + s.w, y1: s.y + s.h };
  const nums = s.kind === "path" ? s.rings.flat() : s.points;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    x0 = Math.min(x0, nums[i]); x1 = Math.max(x1, nums[i]);
    y0 = Math.min(y0, nums[i + 1]); y1 = Math.max(y1, nums[i + 1]);
  }
  const pad = s.kind === "stroke" ? s.size / 2 : 0;
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
}

/** Bounds of what a selection reveals (union of "add" shapes), clamped to the layer. */
export function selectionBounds(shapes: MaskShape[]): { x0: number; y0: number; x1: number; y1: number } | null {
  const adds = shapes.filter((s) => s.op === "add");
  if (!adds.length) return null;
  const b = adds.map(shapeBounds).reduce((a, c) => ({ x0: Math.min(a.x0, c.x0), y0: Math.min(a.y0, c.y0), x1: Math.max(a.x1, c.x1), y1: Math.max(a.y1, c.y1) }));
  const out = { x0: Math.max(0, b.x0), y0: Math.max(0, b.y0), x1: Math.min(1, b.x1), y1: Math.min(1, b.y1) };
  return out.x1 - out.x0 > 0.01 && out.y1 - out.y0 > 0.01 ? out : null;
}

const flip = (s: MaskShape): MaskShape => ({ ...s, op: s.op === "add" ? "subtract" : "add" });
export const FULL_RECT: MaskShape = { kind: "rect", op: "add", x: -0.5, y: -0.5, w: 2, h: 2, points: [], rings: [], size: 0.05, feather: 0 };

/** Inverse selection (everything except the current selection). */
export function invertShapes(shapes: MaskShape[]): MaskShape[] {
  return [FULL_RECT, ...shapes.map(flip)];
}

export type SelectionAction = "keep" | "erase" | "reveal";

/**
 * Commit a selection to a layer mask.
 *  keep   — show only the selection (replaces the mask)
 *  erase  — hide the selection (adds to the mask)
 *  reveal — show the selection again (adds to the mask)
 */
export function maskWithSelection(mask: LayerMask | null, shapes: MaskShape[], action: SelectionAction, feather = 0): LayerMask {
  const feathered = shapes.map((s) => ({ ...s, feather: Math.max(s.feather, feather) }));
  if (action === "keep") return { enabled: true, base: "hide", invert: false, shapes: feathered.slice(-60) };
  const base: LayerMask = mask ?? { enabled: true, base: "reveal", invert: false, shapes: [] };
  const add = action === "erase" ? feathered.map(flip) : feathered;
  // An inverted mask paints with swapped colours, so invert the ops to keep the visible result.
  const ops = base.invert ? add.map(flip) : add;
  return { ...base, enabled: true, shapes: [...base.shapes, ...ops].slice(-60) };
}

/** Remap every normalised coordinate stored on a layer (masks, strokes, retouching) after a crop. */
export function remapLayerUV<T extends Layer>(l: T, b: { x0: number; y0: number; x1: number; y1: number }): T {
  const sx = 1 / (b.x1 - b.x0);
  const sy = 1 / (b.y1 - b.y0);
  const mu = (u: number) => r4((u - b.x0) * sx);
  const mv = (v: number) => r4((v - b.y0) * sy);
  const pairs = (a: number[], stride = 2) => a.map((v, i) => (i % stride === 0 ? mu(v) : i % stride === 1 ? mv(v) : v));
  const out = { ...l } as T;
  if (l.mask) {
    out.mask = {
      ...l.mask,
      shapes: l.mask.shapes.map((s) => ({ ...s, x: mu(s.x), y: mv(s.y), w: r4(s.w * sx), h: r4(s.h * sy), points: pairs(s.points), rings: s.rings.map((r) => pairs(r)) })),
    };
  }
  out.retouch = l.retouch.map((r) => ({ ...r, points: pairs(r.points), dx: r4(r.dx * sx), dy: r4(r.dy * sy) }));
  if (l.type === "drawing" && out.type === "drawing") out.strokes = l.strokes.map((s) => ({ ...s, points: pairs(s.points, 3) }));
  return out;
}

/**
 * Crop a graphic or image layer to the selection bounds: the visible window
 * shrinks, the layer box shrinks to match and stays in place on the garment.
 */
export function cropLayerTo<T extends Layer>(l: T, b: { x0: number; y0: number; x1: number; y1: number }): T {
  if (l.type !== "graphic" && l.type !== "image") return l;
  const c = l.crop;
  const crop = { x: r4(c.x + b.x0 * c.w), y: r4(c.y + b.y0 * c.h), w: r4(Math.max(0.05, (b.x1 - b.x0) * c.w)), h: r4(Math.max(0.05, (b.y1 - b.y0) * c.h)) };
  const centre = uvToZone(l, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
  const next = remapLayerUV(l, b);
  return { ...next, crop, x: r4(centre.x), y: r4(centre.y), width: r4(l.width * (b.x1 - b.x0)), height: r4(l.height * (b.y1 - b.y0)) };
}

/** Outline path (layer-local cm) of a selection shape, for marching ants. */
export function shapeOutline(s: MaskShape, w: number, h: number): string {
  const P = (u: number, v: number) => `${((u - 0.5) * w).toFixed(3)} ${((v - 0.5) * h).toFixed(3)}`;
  const ring = (a: number[], close = true) => {
    let d = "";
    for (let i = 0; i + 1 < a.length; i += 2) d += `${i ? " L " : "M "}${P(a[i], a[i + 1])}`;
    return d + (close && a.length >= 6 ? " Z" : "");
  };
  switch (s.kind) {
    case "rect": return `M ${P(s.x, s.y)} L ${P(s.x + s.w, s.y)} L ${P(s.x + s.w, s.y + s.h)} L ${P(s.x, s.y + s.h)} Z`;
    case "ellipse": {
      const cx = (s.x + s.w / 2 - 0.5) * w, cy = (s.y + s.h / 2 - 0.5) * h, rx = (s.w * w) / 2, ry = (s.h * h) / 2;
      return `M ${(cx - rx).toFixed(3)} ${cy.toFixed(3)} a ${rx.toFixed(3)} ${ry.toFixed(3)} 0 1 0 ${(2 * rx).toFixed(3)} 0 a ${rx.toFixed(3)} ${ry.toFixed(3)} 0 1 0 ${(-2 * rx).toFixed(3)} 0 Z`;
    }
    case "polygon": return ring(s.points);
    case "path": return s.rings.map((r) => ring(r)).join(" ");
    case "stroke": return ring(s.points, false);
  }
}

/** Align / distribute (zone coordinates). `area` is the print area. */
export type AlignMode = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";
export function alignLayers(layers: Layer[], mode: AlignMode, area: { x0: number; y0: number; x1: number; y1: number }): Record<string, Pt> {
  const target = layers.length > 1
    ? { x0: Math.min(...layers.map((l) => l.x - l.width / 2)), x1: Math.max(...layers.map((l) => l.x + l.width / 2)), y0: Math.min(...layers.map((l) => l.y - l.height / 2)), y1: Math.max(...layers.map((l) => l.y + l.height / 2)) }
    : area;
  const out: Record<string, Pt> = {};
  for (const l of layers) {
    let { x, y } = l;
    if (mode === "left") x = target.x0 + l.width / 2;
    if (mode === "right") x = target.x1 - l.width / 2;
    if (mode === "hcenter") x = (target.x0 + target.x1) / 2;
    if (mode === "top") y = target.y0 + l.height / 2;
    if (mode === "bottom") y = target.y1 - l.height / 2;
    if (mode === "vcenter") y = (target.y0 + target.y1) / 2;
    out[l.id] = { x: r4(x), y: r4(y) };
  }
  return out;
}

export function distributeLayers(layers: Layer[], axis: "x" | "y"): Record<string, Pt> {
  if (layers.length < 3) return {};
  const sorted = [...layers].sort((a, b) => a[axis] - b[axis]);
  const first = sorted[0][axis];
  const step = (sorted[sorted.length - 1][axis] - first) / (sorted.length - 1);
  return Object.fromEntries(sorted.map((l, i) => [l.id, { x: axis === "x" ? r4(first + step * i) : l.x, y: axis === "y" ? r4(first + step * i) : l.y }]));
}
