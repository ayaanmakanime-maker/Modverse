import type { Construction } from "./schema";
import type { GarmentMeasurements, GarmentType, PrintMethod, Zone } from "./types";
import { PRINT_METHOD_INFO } from "./fabrics";

/**
 * Flat panel geometry shared by the 2D editor (garment flats + print areas)
 * and the 3D renderer (UV space). Units: centimetres.
 *
 * Torso panel coordinates: x = 0 on the centre line, +x to the viewer's right;
 * y = 0 at the high point shoulder (HPS) level, +y downward.
 * Front is seen from the front; back is seen from behind.
 * Sleeve coordinates: x = 0 on the outer arm line, y = 0 at the sleeve cap top.
 */

export type Pt = [number, number];

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const rectW = (r: Rect) => r.x1 - r.x0;
export const rectH = (r: Rect) => r.y1 - r.y0;

export function shoulderSlope(m: GarmentMeasurements, kids = false): number {
  return Math.max(1.2, (kids ? 2.6 : 4) - m.dropAmount * 0.35);
}

function quad(a: Pt, c: Pt, b: Pt, n = 10): Pt[] {
  const out: Pt[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
  }
  return out;
}

export interface TorsoShape {
  outline: Pt[];
  neckPoint: Pt;
  shoulderPoint: Pt;
  underarm: Pt;
  waistPoint: Pt;
  hemSide: Pt;
  hemCentreY: number;
  waistY: number;
  /** Neckline curve from right neck point to left neck point (through centre). */
  neckline: Pt[];
  /** Raglan seam (right side) from underarm to neckline, when raglan. */
  raglanSeam: Pt[] | null;
  /** Right-side armhole curve from shoulder point to underarm. */
  armhole: Pt[];
}

/** Flat outline of the front or back torso panel. */
export function torsoShape(m: GarmentMeasurements, side: "front" | "back", c: Construction, kids = false): TorsoShape {
  const halfNeck = m.neckWidth / 2;
  const slope = shoulderSlope(m, kids);
  const shoulderX = m.shoulderWidth / 2;
  const chestX = m.chest / 4;
  const waistX = m.waist / 4;
  const hemX = m.hem / 4;
  const L = m.bodyLength;
  const waistY = m.armholeDepth + (L - m.armholeDepth) * 0.45;
  const sideHemY = L - m.hemCurve;
  const drop = side === "front" ? m.frontNeckDrop : m.backNeckDrop;

  // Neckline (right neck point → centre → left neck point)
  const neckline: Pt[] = [[halfNeck, 0]];
  if (side === "front" && c.neckline === "v") {
    for (let i = 1; i <= 8; i++) {
      const t = i / 8;
      neckline.push([halfNeck * (1 - t), drop * Math.pow(t, 0.92)]);
    }
  } else {
    neckline.push(...quad([halfNeck, 0], [halfNeck * 0.95, drop * 0.95], [0, drop], 8));
  }
  const left = neckline.slice(0, -1).reverse().map(([x, y]) => [-x, y] as Pt);
  neckline.push(...left);

  const right: Pt[] = [];
  right.push([halfNeck, 0]);
  right.push([shoulderX, slope]);
  // armhole: shoulder point → underarm
  const armCtrl: Pt = [chestX - (chestX - shoulderX) * 0.15 - 0.5, m.armholeDepth * 0.82];
  const armhole: Pt[] = [[shoulderX, slope], ...quad([shoulderX, slope], armCtrl, [chestX, m.armholeDepth], 12)];
  right.push(...armhole.slice(1));
  // side seam
  right.push(...quad([chestX, m.armholeDepth], [waistX + (chestX - waistX) * 0.25, (m.armholeDepth + waistY) / 2], [waistX, waistY], 6));
  right.push(...quad([waistX, waistY], [(waistX + hemX) / 2, (waistY + sideHemY) / 2], [hemX, sideHemY], 6));
  // hem to centre
  const hemPts: Pt[] =
    m.hemCurve > 0.2 ? quad([hemX, sideHemY], [hemX * 0.55, L + m.hemCurve * 0.15], [0, L], 12) : [[0, L]];
  right.push(...hemPts);

  const leftSide = right.slice(1, -1).reverse().map(([x, y]) => [-x, y] as Pt);
  // closed outline: start right neck point → shoulder → … → centre hem → left side … → left neck → neckline back to start
  const outline: Pt[] = [...right, ...leftSide, [-halfNeck, 0], ...neckline.slice(1, -1).reverse()];

  let raglanSeam: Pt[] | null = null;
  if (c.sleeveStyle === "raglan") {
    raglanSeam = quad([chestX, m.armholeDepth], [halfNeck + (chestX - halfNeck) * 0.45, m.armholeDepth * 0.35], [halfNeck * 1.1, Math.min(drop * 0.55, 3)], 10);
    raglanSeam.unshift([chestX, m.armholeDepth]);
  }

  return {
    outline,
    neckPoint: [halfNeck, 0],
    shoulderPoint: [shoulderX, slope],
    underarm: [chestX, m.armholeDepth],
    waistPoint: [waistX, waistY],
    hemSide: [hemX, sideHemY],
    hemCentreY: L,
    waistY,
    neckline,
    raglanSeam,
    armhole,
  };
}

export interface SleeveShape {
  outline: Pt[];
  capHeight: number;
  halfBicep: number;
  halfOpening: number;
  length: number;
}

export function sleeveShape(m: GarmentMeasurements, c: Construction): SleeveShape {
  const halfBicep = m.bicep / 2;
  const halfOpening = m.sleeveOpening / 2;
  const capHeight = Math.max(4, m.armholeDepth * (c.sleeveStyle === "drop-shoulder" ? 0.32 : c.sleeveStyle === "raglan" ? 0.5 : 0.55));
  const len = m.sleeveLength;
  const outline: Pt[] = [[0, 0]];
  outline.push(...quad([0, 0], [halfBicep * 0.85, 0.5], [halfBicep, capHeight], 10));
  outline.push([halfOpening, len]);
  outline.push([-halfOpening, len]);
  outline.push([-halfBicep, capHeight]);
  outline.push(...quad([-halfBicep, capHeight], [-halfBicep * 0.85, 0.5], [0, 0], 10).slice(0, -1));
  return { outline, capHeight, halfBicep, halfOpening, length: len };
}

/** The rectangle of each zone's flat canvas (used for 2D view boxes and 3D UVs). */
export function zoneCanvas(m: GarmentMeasurements, zone: Zone): Rect {
  switch (zone) {
    case "front":
    case "back": {
      const half = Math.max(m.chest / 4, m.hem / 4, m.shoulderWidth / 2) + 3;
      return { x0: -half, y0: -2, x1: half, y1: m.bodyLength + 3 };
    }
    case "sleeveLeft":
    case "sleeveRight": {
      const half = Math.max(m.bicep / 2, m.sleeveOpening / 2) + 2;
      return { x0: -half, y0: -1, x1: half, y1: m.sleeveLength + 2 };
    }
    case "collar":
      return { x0: -m.collarSize / 2, y0: 0, x1: m.collarSize / 2, y1: Math.max(m.collarHeight, 2) };
    case "cuffs": {
      // Cuff band unrolled: x along the circumference (0 = outer face), y from top edge.
      const half = cuffCircumference(m) / 2;
      return { x0: -half, y0: 0, x1: half, y1: Math.max(m.cuffHeight, 2) };
    }
    case "pocket":
      return { x0: -m.pocketWidth / 2, y0: 0, x1: m.pocketWidth / 2, y1: m.pocketHeight };
    case "yoke": {
      const half = m.shoulderWidth / 2 + 1;
      return { x0: -half, y0: 0, x1: half, y1: Math.max(m.yokeDepth, 4) };
    }
  }
}

/** Safe printable area for a zone (cm, zone coordinates). */
export function printableArea(m: GarmentMeasurements, zone: Zone, garmentType: GarmentType, c: Construction): Rect {
  switch (zone) {
    case "front": {
      const half = Math.min(m.chest, m.hem, m.waist + 4) / 4 - 3;
      const top = m.frontNeckDrop + (c.neckline === "henley" ? 1.5 : 2.5);
      return { x0: -half, y0: top, x1: half, y1: m.bodyLength - m.hemCurve - 4 };
    }
    case "back": {
      const half = Math.min(m.chest, m.hem, m.waist + 4) / 4 - 3;
      return { x0: -half, y0: m.backNeckDrop + (garmentType === "shirt" ? 3.5 : 3), x1: half, y1: m.bodyLength - m.hemCurve - 4 };
    }
    case "sleeveLeft":
    case "sleeveRight": {
      const half = Math.min(m.bicep, m.sleeveOpening + 4) / 2 - 1.8;
      return { x0: -half, y0: 3, x1: half, y1: Math.max(4, m.sleeveLength - (c.cuff === "none" || c.cuff === "hem" ? 2 : m.cuffHeight) - 1.5) };
    }
    case "collar":
      return { x0: -m.collarSize / 2 + 3, y0: 0.5, x1: m.collarSize / 2 - 3, y1: Math.max(1, m.collarHeight - 0.5) };
    case "cuffs": {
      // Only the outer face is decorated (monograms / small embroidery).
      const half = Math.min(cuffCircumference(m) / 2 - 2, 6);
      return { x0: -half, y0: 0.6, x1: half, y1: Math.max(1.2, m.cuffHeight - 0.6) };
    }
    case "pocket":
      return { x0: -m.pocketWidth / 2 + 1, y0: c.pocketStyle === "flap" || c.pocketStyle === "western-flap" ? 4.5 : 1.5, x1: m.pocketWidth / 2 - 1, y1: m.pocketHeight - 1 };
    case "yoke":
      return { x0: -m.shoulderWidth / 2 + 3, y0: 1, x1: m.shoulderWidth / 2 - 3, y1: Math.max(1.5, m.yokeDepth - 1) };
  }
}

/** Finished cuff circumference (cm) — the sleeve opening plus overlap ease for shirt cuffs. */
export function cuffCircumference(m: GarmentMeasurements): number {
  return Math.max(12, m.sleeveOpening * 1.06);
}

export function methodMaxArea(method: PrintMethod): { w: number; h: number } {
  const info = PRINT_METHOD_INFO[method];
  return { w: info.maxWidthCm, h: info.maxHeightCm };
}

/** Pocket placement on the front panel (centre top of pocket) — wearer's left chest = viewer's right. */
export function pocketPlacement(m: GarmentMeasurements, which: 0 | 1): { x: number; y: number } {
  const x = (m.chest / 4) * 0.48 * (which === 0 ? 1 : -1);
  return { x, y: m.armholeDepth * 0.72 };
}

export type PlacementPreset =
  | "center-chest" | "full-front" | "left-chest" | "right-chest" | "upper-back" | "full-back" | "nape"
  | "left-sleeve" | "right-sleeve" | "pocket" | "hem" | "collar" | "cuff" | "yoke";

export const PLACEMENT_LABELS: Record<PlacementPreset, string> = {
  "center-chest": "Centre chest",
  "full-front": "Full front",
  "left-chest": "Left chest",
  "right-chest": "Right chest",
  "upper-back": "Upper back",
  "full-back": "Full back",
  nape: "Back neck (nape)",
  "left-sleeve": "Left sleeve",
  "right-sleeve": "Right sleeve",
  pocket: "Pocket",
  hem: "Hem",
  collar: "Collar",
  cuff: "Cuff (monogram)",
  yoke: "Back yoke",
};

export interface Placement {
  zone: Zone;
  x: number;
  /** top edge (y) of the artwork */
  top: number;
  maxWidth: number;
  maxHeight: number;
}

/** Industry-typical placement presets computed from the actual garment measurements. */
export function placementPreset(m: GarmentMeasurements, preset: PlacementPreset, kids = false): Placement {
  const k = kids ? 0.7 : 1;
  switch (preset) {
    case "center-chest":
      return { zone: "front", x: 0, top: m.frontNeckDrop + 7 * k, maxWidth: 25 * k, maxHeight: 22 * k };
    case "full-front":
      return { zone: "front", x: 0, top: m.frontNeckDrop + 6 * k, maxWidth: 30 * k, maxHeight: 38 * k };
    case "left-chest":
      return { zone: "front", x: (m.chest / 4) * 0.46, top: m.frontNeckDrop + 7 * k, maxWidth: 9 * k, maxHeight: 9 * k };
    case "right-chest":
      return { zone: "front", x: -(m.chest / 4) * 0.46, top: m.frontNeckDrop + 7 * k, maxWidth: 9 * k, maxHeight: 9 * k };
    case "upper-back":
      return { zone: "back", x: 0, top: m.backNeckDrop + Math.max(6, m.yokeDepth + 2) * k, maxWidth: 28 * k, maxHeight: 10 * k };
    case "full-back":
      return { zone: "back", x: 0, top: m.backNeckDrop + Math.max(8, m.yokeDepth + 3) * k, maxWidth: 30 * k, maxHeight: 40 * k };
    case "nape":
      return { zone: "back", x: 0, top: m.backNeckDrop + 3 * k, maxWidth: 7 * k, maxHeight: 4 * k };
    case "left-sleeve":
      return { zone: "sleeveLeft", x: 0, top: 4 * k, maxWidth: 7 * k, maxHeight: Math.max(4, m.sleeveLength - 9) };
    case "right-sleeve":
      return { zone: "sleeveRight", x: 0, top: 4 * k, maxWidth: 7 * k, maxHeight: Math.max(4, m.sleeveLength - 9) };
    case "pocket":
      return { zone: "pocket", x: 0, top: 2, maxWidth: m.pocketWidth - 3, maxHeight: m.pocketHeight - 4 };
    case "hem":
      return { zone: "front", x: -(m.hem / 4) * 0.55, top: m.bodyLength - m.hemCurve - 12 * k, maxWidth: 6 * k, maxHeight: 6 * k };
    case "collar":
      return { zone: "collar", x: 0, top: 0.6, maxWidth: 8, maxHeight: Math.max(1, m.collarHeight - 1.2) };
    case "cuff":
      return { zone: "cuffs", x: 0, top: 0.8, maxWidth: 6, maxHeight: Math.max(1, m.cuffHeight - 1.6) };
    case "yoke":
      return { zone: "yoke", x: 0, top: 1.2, maxWidth: m.shoulderWidth - 8, maxHeight: Math.max(1.5, m.yokeDepth - 2.4) };
  }
}

/** Fit an artwork of the given aspect ratio (w/h) into a placement → centre position and size. */
export function fitToPlacement(p: Placement, aspect: number, scale = 1): { zone: Zone; x: number; y: number; width: number; height: number } {
  let width = p.maxWidth * scale;
  let height = width / aspect;
  if (height > p.maxHeight * scale) {
    height = p.maxHeight * scale;
    width = height * aspect;
  }
  return { zone: p.zone, x: p.x, y: p.top + height / 2, width: round2(width), height: round2(height) };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Axis-aligned bounding box of a rotated rectangle centred at (x, y). */
export function rotatedBounds(x: number, y: number, w: number, h: number, rotationDeg: number): Rect {
  const r = (rotationDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(r));
  const sin = Math.abs(Math.sin(r));
  const bw = w * cos + h * sin;
  const bh = w * sin + h * cos;
  return { x0: x - bw / 2, y0: y - bh / 2, x1: x + bw / 2, y1: y + bh / 2 };
}

export function rectContains(outer: Rect, inner: Rect, tolerance = 0.05): boolean {
  return inner.x0 >= outer.x0 - tolerance && inner.y0 >= outer.y0 - tolerance && inner.x1 <= outer.x1 + tolerance && inner.y1 <= outer.y1 + tolerance;
}

export function rectIntersects(a: Rect, b: Rect): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}

export function polygonToPath(points: Pt[], close = true): string {
  if (!points.length) return "";
  return points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ") + (close ? " Z" : "");
}
