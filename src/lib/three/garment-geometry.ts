/**
 * Parametric 3D garment geometry (pure TypeScript — no three.js dependency so
 * it can be unit-tested). Units: centimetres. World: +Y up, garment faces +Z,
 * wearer's left = +X. Origin: high point shoulder (HPS) level at y = 0.
 *
 * Torso panels are fine grids clipped to the flat panel outline (boundary
 * vertices snapped to the outline) and bent around a superelliptic body
 * section. Sleeves are lofted from the actual 3D armhole loop to the cuff
 * ring. UVs come from the flat panel coordinates, so the same composed
 * textures used by the 2D editor map correctly onto the 3D garment.
 */
import { computeMeasurements } from "../garment/sizing";
import { pocketPlacement, shoulderSlope, sleeveShape, torsoShape, zoneCanvas, type Pt, type Rect } from "../garment/panels";
import type { DesignConfig } from "../garment/schema";
import type { GarmentMeasurements } from "../garment/types";
import { getFabric } from "../garment/fabrics";
import { thicknessFactor } from "../garment/fabric-lab";
import { drapeProfile, type DrapeProfile } from "../garment/drape";

export interface MeshData {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

export interface ButtonData {
  position: [number, number, number];
  normal: [number, number, number];
  radius: number;
  /** Where the button sits (placket, cuff, collar tip, pocket flap). */
  site?: "placket" | "cuff" | "collar" | "pocket";
}

/** A buttonhole: a satin-stitched slit, oriented along `along` (unit vector), lying on the surface with normal `normal`. */
export interface ButtonholeData {
  position: [number, number, number];
  normal: [number, number, number];
  along: [number, number, number];
  length: number;
  width: number;
}

export interface GarmentGeometry {
  measurements: GarmentMeasurements;
  front: MeshData;
  back: MeshData;
  sleeveLeft: MeshData;
  sleeveRight: MeshData;
  collar: MeshData[];
  cuffs: MeshData[];
  placket: MeshData | null;
  pockets: MeshData[];
  /** Shirt sleeve (gauntlet) plackets above the cuffs, [left, right]. */
  sleevePlackets: MeshData[];
  buttons: ButtonData[];
  buttonholes: ButtonholeData[];
  sleeveAngleDeg: number;
  shoulderPoints: { left: [number, number, number]; right: [number, number, number] };
  /** Points of interest for detail inspection (garment-local coordinates). */
  anchors: { collar: [number, number, number]; chest: [number, number, number]; cuff: [number, number, number]; hem: [number, number, number]; back: [number, number, number] };
  drape: DrapeProfile;
}

type V3 = [number, number, number];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

function pointInPolygon(x: number, y: number, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}

function nearestOnPolygon(x: number, y: number, poly: Pt[]): Pt {
  let best: Pt = poly[0];
  let bd = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    const px = a[0] + dx * t;
    const py = a[1] + dy * t;
    const d = (px - x) ** 2 + (py - y) ** 2;
    if (d < bd) {
      bd = d;
      best = [px, py];
    }
  }
  return best;
}

function arcLengthResample(pts: V3[], count: number): V3[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + len(sub(pts[i], pts[i - 1])));
  const total = cum[cum.length - 1] || 1;
  const out: V3[] = [];
  for (let k = 0; k < count; k++) {
    const target = (total * k) / (count - 1);
    let i = 1;
    while (i < cum.length - 1 && cum[i] < target) i++;
    const t = (target - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    out.push(lerp3(pts[i - 1], pts[i], t));
  }
  return out;
}

/** Largest |x| where the closed outline crosses the horizontal line at y (0 when it does not). */
export function outlineHalfWidth(outline: Pt[], y: number): number {
  let best = 0;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [xi, yi] = outline[i];
    const [xj, yj] = outline[j];
    if ((yi <= y && yj >= y) || (yj <= y && yi >= y)) {
      const t = yj === yi ? 0 : (y - yi) / (yj - yi);
      best = Math.max(best, Math.abs(xi + (xj - xi) * t));
    }
  }
  return best;
}

/** Sampled lookup of a function of y (fast, monotone-safe). */
function sampled(f: (y: number) => number, y0: number, y1: number, n = 240): (y: number) => number {
  const step = (y1 - y0) / (n - 1);
  const v = Array.from({ length: n }, (_, i) => f(y0 + i * step));
  return (y) => {
    const t = Math.min(n - 1, Math.max(0, (y - y0) / step));
    const i = Math.min(n - 2, Math.floor(t));
    return v[i] + (v[i + 1] - v[i]) * (t - i);
  };
}

function mergeMeshes(list: MeshData[]): MeshData {
  let vCount = 0;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (const m of list) {
    pos.push(...m.positions);
    uv.push(...m.uvs);
    for (const i of m.indices) idx.push(i + vCount);
    vCount += m.positions.length / 3;
  }
  return { positions: new Float32Array(pos), uvs: new Float32Array(uv), indices: new Uint32Array(idx) };
}

/**
 * Give a grid surface real thickness: an offset second surface (towards `towards(p)`)
 * plus edge walls, so collars, cuffs, plackets and pockets read as layered fabric.
 */
function shellMesh(rows: V3[][], thickness: number, towards: (p: V3) => V3, uvFn: (i: number, j: number) => [number, number], walls: { j0?: boolean; j1?: boolean; i0?: boolean; i1?: boolean } = { j0: true, j1: true, i0: true, i1: true }): MeshData {
  const R = rows.length;
  const C = rows[0].length;
  const under: V3[][] = rows.map((row, j) =>
    row.map((p, i) => {
      const du = sub(row[Math.min(C - 1, i + 1)], row[Math.max(0, i - 1)]);
      const dv = sub(rows[Math.min(R - 1, j + 1)][i], rows[Math.max(0, j - 1)][i]);
      let n = norm(cross(du, dv));
      const t = towards(p);
      if (n[0] * t[0] + n[1] * t[1] + n[2] * t[2] < 0) n = mul(n, -1);
      return add(p, mul(n, thickness));
    }),
  );
  const parts: MeshData[] = [gridMesh(rows, uvFn), gridMesh(under, uvFn)];
  const strip = (a: V3[], b: V3[], uvs: [number, number][]) => gridMesh([a, b], (i) => uvs[i]);
  if (walls.j1) parts.push(strip(rows[R - 1], under[R - 1], rows[R - 1].map((_, i) => uvFn(i, R - 1))));
  if (walls.j0) parts.push(strip(rows[0], under[0], rows[0].map((_, i) => uvFn(i, 0))));
  if (walls.i0) parts.push(strip(rows.map((r) => r[0]), under.map((r) => r[0]), rows.map((_, j) => uvFn(0, j))));
  if (walls.i1) parts.push(strip(rows.map((r) => r[C - 1]), under.map((r) => r[C - 1]), rows.map((_, j) => uvFn(C - 1, j))));
  return mergeMeshes(parts);
}

export interface BodyMapper {
  map(side: "front" | "back", x: number, y: number, offset?: number): V3;
  normal(side: "front" | "back", x: number, y: number): V3;
}

export interface BodyMapperOptions {
  /** Half width of the actual panel outline at y (side seams / armholes) — makes front & back meet exactly. */
  outlineHalf?: (y: number) => number;
  /** Bottom of the side seam (hem curve starts below it). */
  sideSeamEnd?: number;
  /** Procedural fold field (omit for a smooth body, e.g. try-on overlays). */
  drape?: DrapeProfile;
}

export function createBodyMapper(config: DesignConfig, m: GarmentMeasurements, opts: BodyMapperOptions = {}): BodyMapper {
  const halfNeck = m.neckWidth / 2;
  const shoulderX = m.shoulderWidth / 2;
  const slope = shoulderSlope(m);
  const waistY = m.armholeDepth + (m.bodyLength - m.armholeDepth) * 0.45;
  const depthRatio = config.fit === "slim" ? 0.66 : config.fit === "regular" || config.fit === "longline" ? 0.63 : 0.58;
  const ramp = 9;
  const p = 2.6;
  const halfWidthAt = (y: number) => {
    if (y <= m.armholeDepth) return m.chest / 4;
    if (y <= waistY) return m.chest / 4 + (m.waist / 4 - m.chest / 4) * ((y - m.armholeDepth) / (waistY - m.armholeDepth));
    return m.waist / 4 + (m.hem / 4 - m.waist / 4) * Math.min(1, (y - waistY) / (m.bodyLength - waistY));
  };
  const sideEnd = opts.sideSeamEnd ?? m.bodyLength - m.hemCurve;
  // Below the armhole the cross-section ends exactly at the side seam of the real outline.
  const sectionHalf = (y: number) => {
    if (!opts.outlineHalf || y <= m.armholeDepth) return halfWidthAt(y);
    const w = opts.outlineHalf(Math.min(y, sideEnd - 0.01));
    return w > 1 ? w : halfWidthAt(y);
  };
  const shirt = config.garmentType === "shirt";
  const hasPlacket = shirt && m.placketWidth > 0;
  const drape = opts.drape;
  // ── Procedural folds (cm, outward). Zero at seams so panels stay joined. ──
  const fold = (side: "front" | "back", x: number, y: number): number => {
    if (!drape) return 0;
    const ax = Math.abs(x);
    const edge = opts.outlineHalf ? opts.outlineHalf(Math.min(y, sideEnd)) : halfWidthAt(y);
    const wSide = smooth(0.4, 4.5, edge - ax);
    const wTop = smooth(slope + 1.2, slope + 8, y);
    if (wSide <= 0 || wTop <= 0) return 0;
    const L = m.bodyLength;
    const A = drape.foldAmplitude;
    const lam = drape.foldWavelength;
    const front = side === "front";
    // a) vertical drape folds: grow from the chest to the hem, larger for loose fits
    const sway = Math.sin(y / 21 + (front ? 0.6 : 2.1)) * lam * 0.2;
    const th = (2 * Math.PI * (x + sway)) / lam + (front ? 0.9 : 2.4);
    const env = smooth(m.armholeDepth * 0.5, L * 0.92, y);
    const vertical = A * (0.45 + 0.55 * drape.looseness) * env * (Math.sin(th) + 0.28 * drape.creaseSharpness * Math.sin(2 * th + 0.7));
    // b) underarm drag folds radiating from the armpit towards the waist (arms-down pose)
    let drag = 0;
    const armEdge = halfWidthAt(m.armholeDepth);
    for (const s of [1, -1]) {
      const px = s * x - (armEdge - 1.5);
      const py = y - (m.armholeDepth + 1);
      const a = (40 * Math.PI) / 180;
      const u = -px * Math.cos(a) + py * Math.sin(a);
      const v = px * Math.sin(a) + py * Math.cos(a);
      const Lf = 11 + 10 * drape.looseness;
      const envU = smooth(0, 2.5, u) * (1 - smooth(Lf * 0.45, Lf, u));
      const spacing = 2.6 + 1.6 * drape.looseness;
      let ridges = 0;
      for (let j = -1; j <= 1; j++) ridges += (j === 0 ? 1 : -0.55) * Math.exp(-(((v - j * spacing) / (0.9 + 0.5 * (1 - drape.creaseSharpness))) ** 2));
      drag += envU * ridges;
    }
    drag *= (0.4 + 0.6 * drape.looseness) * (1 - 0.3 * drape.stiffness) * (front ? 1 : 0.6);
    // c) waist creasing at the sides of fitted garments
    const waist = 0.14 * (1 - drape.looseness) * (1 - 0.5 * drape.stiffness) * Math.sin((2 * Math.PI * y) / 2.6 + x * 0.25) * Math.exp(-(((y - waistY) / 6) ** 2)) * smooth(edge - 10, edge - 3, ax);
    // d) gentle hem waviness
    const hem = 0.3 * A * Math.sin((2 * Math.PI * x) / (lam * 0.85) + (front ? 1.3 : 0.2)) * smooth(L - 12, L, y);
    let total = (vertical + drag + waist + hem) * wSide * wTop;
    if (hasPlacket && front) total *= 0.45 + 0.55 * smooth(m.placketWidth / 2, m.placketWidth / 2 + 5, ax);
    return total;
  };
  const depth = (x: number, y: number, side: "front" | "back") => {
    const wb = sectionHalf(y);
    const D = depthRatio * wb * (0.38 + 0.62 * smooth(0, m.armholeDepth * 1.05, y));
    const s = Math.min(1, Math.abs(x) / wb);
    // The superellipse is vertical at the side seam: snap vertices on the seam to z = 0 so the
    // front and back panels meet exactly (a hair inside the edge would otherwise lift ~1 cm).
    const prof = Math.abs(x) >= wb - 0.03 ? 0 : Math.pow(Math.max(0, 1 - Math.pow(s, p)), 1 / p);
    const ax = Math.abs(x);
    const topYz = ax <= halfNeck ? 0 : slope * Math.min(1.4, (ax - halfNeck) / Math.max(1, shoulderX - halfNeck));
    const f = Math.sin((Math.min(1, Math.max(0, y - topYz) / ramp) * Math.PI) / 2);
    return D * prof * f + fold(side, x, y);
  };
  const map = (side: "front" | "back", x: number, y: number, offset = 0): V3 => {
    const sign = side === "front" ? 1 : -1;
    const X = side === "front" ? x : -x;
    return [X, -y, sign * (depth(x, y, side) + offset)];
  };
  const normal = (side: "front" | "back", x: number, y: number): V3 => {
    const e = 0.4;
    const a = map(side, x, y);
    const bx = map(side, x + e, y);
    const by = map(side, x, y + e);
    let nrm = norm(cross(sub(bx, a), sub(by, a)));
    if ((side === "front" && nrm[2] < 0) || (side === "back" && nrm[2] > 0)) nrm = mul(nrm, -1);
    return nrm;
  };
  return { map, normal };
}

function panelMesh(outline: Pt[], canvas: Rect, mapFn: (x: number, y: number) => V3, res: number): MeshData {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of outline) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const cell = Math.max((maxX - minX) / res, 0.35);
  const cols = Math.ceil((maxX - minX) / cell) + 1;
  const rows = Math.ceil((maxY - minY) / cell) + 1;
  const inside = new Uint8Array(cols * rows);
  const pts: Pt[] = new Array(cols * rows);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x = minX + c * cell;
      const y = minY + r * cell;
      pts[r * cols + c] = [x, y];
      inside[r * cols + c] = pointInPolygon(x, y, outline) ? 1 : 0;
    }
  // expand by one ring so the snapped boundary reaches the outline
  const keep = new Uint8Array(inside);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (inside[r * cols + c]) continue;
      for (let dr = -1; dr <= 1 && !keep[r * cols + c]; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr, cc = c + dc;
          if (rr >= 0 && rr < rows && cc >= 0 && cc < cols && inside[rr * cols + cc]) {
            keep[r * cols + c] = 1;
            break;
          }
        }
    }
  const index = new Int32Array(cols * rows).fill(-1);
  const positions: number[] = [];
  const uvs: number[] = [];
  const W = canvas.x1 - canvas.x0;
  const H = canvas.y1 - canvas.y0;
  for (let i = 0; i < cols * rows; i++) {
    if (!keep[i]) continue;
    let [x, y] = pts[i];
    if (!inside[i]) [x, y] = nearestOnPolygon(x, y, outline);
    index[i] = positions.length / 3;
    const v = mapFn(x, y);
    positions.push(v[0], v[1], v[2]);
    uvs.push((x - canvas.x0) / W, 1 - (y - canvas.y0) / H);
  }
  const indices: number[] = [];
  for (let r = 0; r < rows - 1; r++)
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
      const ia = index[a], ib = index[b], id = index[d], ie = index[e];
      const any = inside[a] || inside[b] || inside[d] || inside[e];
      if (!any) continue;
      if (ia >= 0 && ib >= 0 && id >= 0) indices.push(ia, id, ib);
      if (ib >= 0 && id >= 0 && ie >= 0) indices.push(ib, id, ie);
    }
  return { positions: new Float32Array(positions), uvs: new Float32Array(uvs), indices: new Uint32Array(indices) };
}

function gridMesh(rows: V3[][], uvFn: (i: number, j: number) => [number, number], closedU = false): MeshData {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const R = rows.length;
  const C = rows[0].length;
  for (let j = 0; j < R; j++)
    for (let i = 0; i < C; i++) {
      positions.push(...rows[j][i]);
      uvs.push(...uvFn(i, j));
    }
  const cMax = closedU ? C : C - 1;
  for (let j = 0; j < R - 1; j++)
    for (let i = 0; i < cMax; i++) {
      const i2 = (i + 1) % C;
      const a = j * C + i, b = j * C + i2, d = (j + 1) * C + i, e = (j + 1) * C + i2;
      indices.push(a, d, b, b, d, e);
    }
  return { positions: new Float32Array(positions), uvs: new Float32Array(uvs), indices: new Uint32Array(indices) };
}

export const SLEEVE_DROP_DEG: Record<string, number> = { "set-in": 54, raglan: 52, "drop-shoulder": 58 };

export function buildGarmentGeometry(config: DesignConfig, opts: { resolution?: number; folds?: boolean } = {}): GarmentGeometry {
  const m = computeMeasurements(config);
  const c = config.construction;
  const res = opts.resolution ?? 64;
  // Fabric Lab: trims (collar, cuffs, placket, pockets) are as thick as the chosen cloth.
  const tk = thicknessFactor(getFabric(config.fabric.id), config.fabric.gsm);
  const front = torsoShape(m, "front", c);
  const back = torsoShape(m, "back", c);
  const drape = drapeProfile(config, m);
  const outlineHalf = sampled((y) => Math.max(outlineHalfWidth(front.outline, y), outlineHalfWidth(back.outline, y)), -2, m.bodyLength + 2);
  const body = createBodyMapper(config, m, { outlineHalf, drape: opts.folds === false ? undefined : drape });
  const torsoCanvas = zoneCanvas(m, "front");

  const frontMesh = panelMesh(front.outline, torsoCanvas, (x, y) => body.map("front", x, y), res);
  const backMesh = panelMesh(back.outline, torsoCanvas, (x, y) => body.map("back", x, y), res);

  // ── Sleeves ──────────────────────────────────────────────────
  const sl = sleeveShape(m, c);
  const sleeveCanvas = zoneCanvas(m, "sleeveLeft");
  const SW = sleeveCanvas.x1 - sleeveCanvas.x0;
  const SH = sleeveCanvas.y1 - sleeveCanvas.y0;
  const dropDeg = SLEEVE_DROP_DEG[c.sleeveStyle] ?? 54;
  const N = 56; // ring resolution (must be even)
  const ROWS = 90;
  const longSleeve = c.sleeveLength === "long" || c.sleeveLength === "three-quarter";
  // Sleeve folds (procedural): cuff bunching, inner-elbow creases, underarm ripples.
  const sleeveFold = (t: number, cc: number, side: 1 | -1): number => {
    if (opts.folds === false) return 0;
    const Ls = sl.length;
    const sharp = drape.creaseSharpness;
    const A = (0.18 + 0.55 * drape.sleeveLooseness) * (0.8 + 0.4 * (1 - drape.stiffness));
    let d = 0;
    if (longSleeve) {
      const env = smooth(0.62, 0.8, t) * (1 - smooth(0.93, 0.995, t));
      const ph = (t * Ls) / (5 + 2 * drape.stiffness) + 0.45 * Math.sin(2 * Math.PI * cc + side) + 0.15 * cc;
      d += 0.85 * A * env * (Math.sin(2 * Math.PI * ph) + 0.2 * sharp * Math.sin(4 * Math.PI * ph));
      const elbowT = 0.55;
      d += 0.9 * A * Math.exp(-(((t - elbowT) / 0.07) ** 2)) * Math.exp(-(((cc - 0.25) / 0.14) ** 2)) * Math.sin((2 * Math.PI * t * Ls) / 2.4);
    } else {
      d += 0.5 * A * smooth(0.55, 1, t) * Math.sin(2 * Math.PI * 3 * cc + side * 0.8);
    }
    const under = Math.exp(-(((Math.abs(cc) - 0.5) / 0.12) ** 2));
    d += 0.8 * A * under * smooth(0.04, 0.12, t) * (1 - smooth(0.25, 0.42, t)) * Math.sin((2 * Math.PI * t * Ls) / 2.8 + 0.4);
    return d * smooth(0, 0.06, t);
  };
  const buildSleeve = (side: 1 | -1): { mesh: MeshData; endRing: V3[]; dir: V3; shoulder: V3; endCenter: V3; rEnd: number } => {
    const armF = front.armhole.map(([x, y]) => body.map("front", side * x, y));
    const armB = back.armhole.map(([x, y]) => body.map("back", -side * x, y));
    const half = N / 2;
    const fr = arcLengthResample(armF, half + 1); // c: 0 → 0.5 (front)
    const bk = arcLengthResample(armB, half + 1); // c: 0 → -0.5 (back)
    // ring ordered by c from -0.5 (underarm via back) → 0 (shoulder) → +0.5 (underarm via front)
    const base: V3[] = [...bk.slice(1).reverse(), ...fr];
    const shoulder = fr[0];
    const phi = (dropDeg * Math.PI) / 180;
    const dir = norm([side * Math.cos(phi), -Math.sin(phi), 0]);
    const up = norm(cross([0, 0, side], dir)); // perpendicular to dir in the X-Y plane, pointing up
    const upFixed: V3 = up[1] < 0 ? mul(up, -1) : up;
    const z: V3 = [0, 0, 1];
    const rEnd = m.sleeveOpening / (2 * Math.PI);
    const rBicep = m.bicep / (2 * Math.PI);
    const endTop = add(shoulder, mul(dir, sl.length));
    const endCenter = sub(endTop, mul(upFixed, rEnd));
    const ringAt = (center: V3, r: number, cc: number): V3 => {
      const a = 2 * Math.PI * cc;
      return add(center, add(mul(upFixed, r * Math.cos(a)), mul(z, r * Math.sin(a))));
    };
    const rows: V3[][] = [];
    for (let j = 0; j < ROWS; j++) {
      const t = j / (ROWS - 1);
      const row: V3[] = [];
      for (let i = 0; i <= N; i++) {
        const cc = -0.5 + i / N;
        const b = base[i];
        const capBlend = smooth(0, 0.35, t);
        const r = rBicep + (rEnd - rBicep) * smooth(0.15, 1, t) + sleeveFold(t, cc, side);
        const centerT = add(shoulder, mul(dir, sl.length * t));
        const target = ringAt(sub(centerT, mul(upFixed, r)), r, cc);
        row.push(lerp3(b, target, capBlend * (1 - t) + t));
      }
      rows.push(row);
    }
    const mesh = gridMesh(rows, (i, j) => {
      const t = j / (ROWS - 1);
      const cc = -0.5 + i / N;
      const circ = m.bicep + (m.sleeveOpening - m.bicep) * t;
      // Outer face reads correctly from outside: wearer's left sleeve runs toward the back.
      const xf = (side === 1 ? -cc : cc) * circ;
      const yf = t * sl.length;
      return [(xf - sleeveCanvas.x0) / SW, 1 - (yf - sleeveCanvas.y0) / SH];
    });
    return { mesh, endRing: rows[ROWS - 1], dir, shoulder, endCenter, rEnd };
  };
  const left = buildSleeve(1);
  const right = buildSleeve(-1);

  // ── Collar / neckline ──────────────────────────────────────────
  const neckFront = front.neckline.map(([x, y]) => body.map("front", x, y));
  const neckBack = back.neckline.map(([x, y]) => body.map("back", x, y));
  const loopRaw: V3[] = [...neckFront, ...neckBack.slice(1, -1)];
  const loop = arcLengthResample([...loopRaw, loopRaw[0]], 97).slice(0, 96);
  const centroid = mul(loop.reduce((a, b) => add(a, b), [0, 0, 0] as V3), 1 / loop.length);
  const outward = (p: V3): V3 => norm([p[0] - centroid[0], 0, p[2] - centroid[2]]);
  // index of centre front (max z) and centre back (min z)
  let cf = 0;
  let cb = 0;
  loop.forEach((p, i) => {
    if (p[2] > loop[cf][2]) cf = i;
    if (p[2] < loop[cb][2]) cb = i;
  });
  const collarCanvas = zoneCanvas(m, "collar");
  const CW = collarCanvas.x1 - collarCanvas.x0;
  const CH = collarCanvas.y1 - collarCanvas.y0;
  // signed loop parameter: 0 at centre back, ±1 at centre front
  const L = loop.length;
  const param = (i: number) => {
    const d = (((i - cb) % L) + L) % L;
    const s = d / L; // 0..1 going around
    return s <= 0.5 ? s * 2 : -(1 - s) * 2;
  };
  const collars: MeshData[] = [];
  const buttons: ButtonData[] = [];
  const buttonholes: ButtonholeData[] = [];
  const shirt = config.garmentType === "shirt";
  const up: V3 = [0, 1, 0];
  const ringBand = (height: number, lean: number, thickness: number, heightFn?: (k: number) => number): MeshData => {
    const ordered = Array.from({ length: L + 1 }, (_, k) => (cb + k) % L); // start at centre back
    const rowsOut: V3[][] = [[], [], [], []];
    ordered.forEach((idx, k) => {
      const p = loop[idx];
      const o = outward(p);
      const h = height * (heightFn ? heightFn(param(idx)) : 1);
      const baseOut = add(p, mul(o, 0.05));
      const topOut = add(add(p, mul(up, h)), mul(o, -lean * h));
      const topIn = add(topOut, mul(o, -thickness));
      const baseIn = add(add(p, mul(o, -thickness)), mul(up, -0.2));
      rowsOut[0][k] = baseOut;
      rowsOut[1][k] = topOut;
      rowsOut[2][k] = topIn;
      rowsOut[3][k] = baseIn;
    });
    return gridMesh(rowsOut, (i, j) => {
      const sArc = (i / L - 0.5) * m.collarSize;
      const v = j === 0 ? 0 : j === 1 ? 1 : j === 2 ? 1 : 0;
      return [(sArc - collarCanvas.x0) / CW, 1 - (v * Math.max(1, m.collarHeight) - collarCanvas.y0) / CH];
    });
  };
  if (!shirt) {
    if (c.neckline === "mock") collars.push(ringBand(m.collarHeight, 0.08, 0.35));
    else collars.push(ringBand(m.collarHeight * 0.75, 0.45, 0.3));
  } else {
    const isBand = c.collar === "band" || c.collar === "mandarin";
    const standH = isBand ? m.collarHeight : 3.2;
    const roundFront = c.collar === "mandarin" ? (k: number) => 1 - 0.35 * smooth(0.82, 1, Math.abs(k)) : undefined;
    collars.push(ringBand(standH, 0.12, 0.3, roundFront));
    if (!isBand) {
      const styles: Record<string, { fall: number; tip: number; spread: number; maxK: number; round?: boolean }> = {
        point: { fall: 4.6, tip: 4.6, spread: 0.25, maxK: 0.97 },
        spread: { fall: 4.6, tip: 3.6, spread: 0.75, maxK: 0.96 },
        cutaway: { fall: 4.4, tip: 2.8, spread: 1.15, maxK: 0.95 },
        "button-down": { fall: 4.8, tip: 4.2, spread: 0.35, maxK: 0.97 },
        club: { fall: 4.4, tip: 2.4, spread: 0.55, maxK: 0.96, round: true },
        camp: { fall: 6.0, tip: 4.2, spread: 0.9, maxK: 0.8 },
      };
      const st = styles[c.collar] ?? styles.point;
      const kScale = 1;
      const KS = 70;
      const VS = 6;
      const rowsLeaf: V3[][] = [];
      for (let v = 0; v <= VS; v++) rowsLeaf.push([]);
      for (let k = 0; k <= KS; k++) {
        const kk = -st.maxK + (2 * st.maxK * k) / KS; // signed param
        // locate loop position for kk
        const target = kk >= 0 ? kk / 2 : 1 + kk / 2; // fraction around from cb
        const fIdx = (cb + target * L) % L;
        const i0 = Math.floor(fIdx);
        const p = lerp3(loop[i0 % L], loop[(i0 + 1) % L], fIdx - i0);
        const o = outward(p);
        const fold = add(add(p, mul(up, standH + 0.15)), mul(o, 0.25));
        const tipW = smooth(0.62, st.maxK, Math.abs(kk));
        const sideways: V3 = [Math.sign(p[0]) || 1, 0, 0];
        const tipDir = norm(add(mul([0, -1, 0.35], Math.cos(st.spread)), mul(sideways, Math.sin(st.spread) * 0.8)));
        const fall = st.fall * kScale;
        let edge = add(add(fold, mul(up, -fall)), mul(o, fall * 0.55));
        edge = add(edge, mul(tipDir, st.tip * kScale * (st.round ? Math.sin(tipW * Math.PI * 0.5) * 0.8 : tipW)));
        for (let v = 0; v <= VS; v++) {
          const t = v / VS;
          const bulge = mul(o, Math.sin(Math.PI * t) * 0.9);
          rowsLeaf[v].push(add(lerp3(fold, edge, t), bulge));
        }
      }
      // Leaves get real thickness (two plies + edge) so the collar edge reads in close-ups.
      collars.push(shellMesh(rowsLeaf, 0.16 * tk, (p) => norm([centroid[0] - p[0], 0.4, centroid[2] - p[2]]), (i, j) => [i / KS, 1 - j / VS], { j1: true, i0: true, i1: true }));
      if (c.collar === "button-down") {
        for (const k of [Math.round(KS * 0.035), Math.round(KS * 0.965)]) {
          const pt = rowsLeaf[VS - 1][k];
          const prev = rowsLeaf[VS - 2][k];
          const tip = norm(sub(pt, prev));
          const o = outward(pt);
          buttons.push({ position: add(pt, mul(o, 0.1)), normal: norm(add(o, mul(tip, -0.3))), radius: 0.45, site: "collar" });
        }
      }
    }
  }

  // ── Cuffs (rings at sleeve ends) ─────────────────────────────
  const cuffs: MeshData[] = [];
  const sleevePlackets: MeshData[] = [];
  if (!["hem", "none"].includes(c.cuff)) {
    // UVs follow the unrolled cuff canvas (x along circumference, 0 = outer face; y from top edge),
    // so the "cuffs" artwork zone maps 1:1 from the 2D editor.
    const cuffCanvas = zoneCanvas(m, "cuffs");
    const CWc = cuffCanvas.x1 - cuffCanvas.x0;
    const CHc = cuffCanvas.y1 - cuffCanvas.y0;
    const circ = cuffCanvas.x1 - cuffCanvas.x0;
    for (const [s, side] of [[left, 1], [right, -1]] as const) {
      const h = m.cuffHeight;
      const rows: V3[][] = [];
      const steps = 4;
      for (let j = 0; j <= steps; j++) {
        const back = (h * (steps - j)) / steps;
        const ctr = sub(s.endCenter, mul(s.dir, back));
        // slight barrel shape: the cuff is fuller in the middle of its height
        const bulge = c.cuff === "rib" ? 1.02 - 0.04 * (j / steps) : 1.06 + 0.02 * Math.sin((Math.PI * j) / steps);
        rows.push(s.endRing.map((p) => add(ctr, mul(sub(p, s.endCenter), bulge))));
      }
      const uv = (i: number, j: number): [number, number] => {
        const cc = -0.5 + i / N;
        const xf = (side === 1 ? -cc : cc) * circ;
        const yf = (j / steps) * h;
        return [(xf - cuffCanvas.x0) / CWc, 1 - (yf - cuffCanvas.y0) / CHc];
      };
      const axisAt = (p: V3) => {
        const rel = sub(p, s.endCenter);
        const along = mul(s.dir, rel[0] * s.dir[0] + rel[1] * s.dir[1] + rel[2] * s.dir[2]);
        return norm(mul(sub(rel, along), -1));
      };
      cuffs.push(shellMesh(rows, (c.cuff === "rib" ? 0.22 : 0.3) * tk, axisAt, uv, { j0: true, j1: true }));
      if (shirt && c.cuff !== "rib" && c.buttons.count > 0) {
        // Cuff button on the back of the wrist (towards the little finger), mid-height.
        let bi = 0;
        rows[2].forEach((p, i) => {
          if (p[2] < rows[2][bi][2]) bi = i;
        });
        const p = rows[2][bi];
        const o = mul(axisAt(p), -1);
        if (c.cuff !== "french") buttons.push({ position: add(p, mul(o, 0.32)), normal: o, radius: c.buttons.sizeMm / 22, site: "cuff" });
        // Gauntlet (sleeve) placket: the opening above the cuff on the back of the sleeve, with its own small button.
        if (c.sleeveLength === "long") {
          const top = rows[0][bi];
          const out = mul(axisAt(top), -1);
          const up = mul(s.dir, -1);
          const across = norm([up[1] * out[2] - up[2] * out[1], up[2] * out[0] - up[0] * out[2], up[0] * out[1] - up[1] * out[0]]);
          const L = 12.5;
          const W = 2.3;
          const steps = 6;
          const prow: V3[][] = [];
          for (let i = 0; i <= steps; i++) {
            const d = (L * i) / steps;
            // the sleeve widens above the cuff; sit just proud of the surface
            const base = add(add(top, mul(up, d)), mul(out, 0.1 + 0.035 * d));
            prow.push([-W / 2, 0, W / 2].map((u) => add(base, mul(across, u))));
          }
          sleevePlackets.push(shellMesh(prow, 0.12 * tk, () => axisAt(top), (i, j) => [j / 2, 1 - i / steps], { j0: true, j1: true, i1: true }));
          const bd = L * 0.62;
          buttons.push({ position: add(add(top, mul(up, bd)), mul(out, 0.1 + 0.035 * bd + 0.12 * tk + 0.12)), normal: out, radius: (c.buttons.sizeMm / 22) * 0.8, site: "cuff" });
        }
        const nb = rows[2][(bi + 3) % rows[2].length];
        buttonholes.push({ position: add(nb, mul(o, 0.33)), normal: o, along: norm(sub(rows[2][(bi + 4) % rows[2].length], rows[2][(bi + 2) % rows[2].length])), length: c.buttons.sizeMm / 10 + 0.3, width: 0.32 });
      }
    }
  }

  // ── Placket, buttons, pockets ─────────────────────────────────
  let placket: MeshData | null = null;
  const showPlacket = c.placket === "standard" || c.placket === "contrast" || c.placket === "henley";
  if (showPlacket && m.placketWidth > 0) {
    const y0 = m.frontNeckDrop + 0.2;
    const y1 = c.placket === "henley" ? m.frontNeckDrop + m.placketLength : m.bodyLength - 0.4;
    const rows: V3[][] = [];
    const steps = 60;
    for (let j = 0; j <= steps; j++) {
      const y = y0 + ((y1 - y0) * j) / steps;
      const row: V3[] = [];
      for (let i = 0; i <= 4; i++) row.push(body.map("front", -m.placketWidth / 2 + (m.placketWidth * i) / 4, y, 0.2));
      rows.push(row);
    }
    placket = shellMesh(rows, 0.16 * tk, () => [0, 0, -1], (i, j) => [i / 4, 1 - j / steps], { i0: true, i1: true, j1: true });
  }
  if (c.buttons.count > 0 && c.placket !== "hidden") {
    const top = m.frontNeckDrop + (shirt ? 1.4 : 1.8);
    const bottom = c.placket === "henley" ? top + m.placketLength - 3 : m.bodyLength - 9;
    for (let i = 0; i < c.buttons.count; i++) {
      const y = top + ((bottom - top) * i) / Math.max(1, c.buttons.count - 1);
      const nrm = body.normal("front", 0, y);
      buttons.push({ position: body.map("front", 0, y, 0.42), normal: nrm, radius: c.buttons.sizeMm / 20, site: "placket" });
      // Vertical buttonhole through the placket, slightly longer than the button (visible above & below it).
      const len = c.buttons.sizeMm / 10 + 0.3;
      const a = body.map("front", 0, y - 1, 0.38);
      const b = body.map("front", 0, y + 1, 0.38);
      if (c.buttons.material !== "snap" && c.buttons.material !== "pearl-snap")
        buttonholes.push({ position: body.map("front", 0, y, 0.38), normal: nrm, along: norm(sub(b, a)), length: len, width: 0.34 });
    }
  }
  const pockets: MeshData[] = [];
  const pocketCanvas = zoneCanvas(m, "pocket");
  for (let k = 0; k < c.pocketCount; k++) {
    const pl = pocketPlacement(m, k as 0 | 1);
    const rows: V3[][] = [];
    const steps = 10;
    for (let j = 0; j <= steps; j++) {
      const yy = (m.pocketHeight * j) / steps;
      const row: V3[] = [];
      for (let i = 0; i <= steps; i++) {
        const xx = -m.pocketWidth / 2 + (m.pocketWidth * i) / steps;
        const taper = c.pocketStyle === "patch" && config.garmentType === "tshirt" ? 0 : yy > m.pocketHeight - 1.5 ? (1 - Math.abs(xx) / (m.pocketWidth / 2)) * 0 : 0;
        row.push(body.map("front", pl.x + xx, pl.y + yy + taper, 0.18));
      }
      rows.push(row);
    }
    pockets.push(shellMesh(rows, 0.1 * tk, () => [0, 0, -1], (i, j) => {
      const xx = -m.pocketWidth / 2 + (m.pocketWidth * i) / steps;
      const yy = (m.pocketHeight * j) / steps;
      return [(xx - pocketCanvas.x0) / (pocketCanvas.x1 - pocketCanvas.x0), 1 - (yy - pocketCanvas.y0) / (pocketCanvas.y1 - pocketCanvas.y0)];
    }, { i0: true, i1: true, j0: true, j1: true }));
    if (c.pocketStyle === "flap" || c.pocketStyle === "western-flap") {
      const fr: V3[][] = [];
      for (let j = 0; j <= 3; j++) {
        const yy = -0.3 + (4.2 * j) / 3;
        const row: V3[] = [];
        for (let i = 0; i <= 8; i++) {
          const xx = -m.pocketWidth / 2 - 0.3 + ((m.pocketWidth + 0.6) * i) / 8;
          const point = c.pocketStyle === "western-flap" ? (1 - Math.abs(xx) / (m.pocketWidth / 2 + 0.3)) * 1.6 * (j / 3) : 0;
          row.push(body.map("front", pl.x + xx, pl.y + yy + point, 0.32));
        }
        fr.push(row);
      }
      pockets.push(shellMesh(fr, 0.12 * tk, () => [0, 0, -1], (i, j) => [i / 8, 1 - j / 3], { i0: true, i1: true, j1: true }));
      if (c.buttons.count > 0) buttons.push({ position: body.map("front", pl.x, pl.y + 2.8, 0.55), normal: body.normal("front", pl.x, pl.y + 2.8), radius: c.buttons.sizeMm / 22, site: "pocket" });
    }
  }

  return {
    measurements: m,
    front: frontMesh,
    back: backMesh,
    sleeveLeft: left.mesh,
    sleeveRight: right.mesh,
    collar: collars,
    cuffs,
    placket,
    pockets,
    sleevePlackets,
    buttons,
    buttonholes,
    sleeveAngleDeg: dropDeg,
    shoulderPoints: { left: left.shoulder, right: right.shoulder },
    anchors: {
      collar: add(centroid, [0, 2, 3]),
      chest: body.map("front", 0, m.armholeDepth, 0),
      cuff: left.endCenter,
      hem: body.map("front", 0, m.bodyLength - 2, 0),
      back: body.map("back", 0, m.yokeDepth || 10, 0),
    },
    drape,
  };
}
