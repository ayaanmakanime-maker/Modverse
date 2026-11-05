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

export interface MeshData {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

export interface ButtonData {
  position: [number, number, number];
  normal: [number, number, number];
  radius: number;
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
  buttons: ButtonData[];
  sleeveAngleDeg: number;
  shoulderPoints: { left: [number, number, number]; right: [number, number, number] };
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

export interface BodyMapper {
  map(side: "front" | "back", x: number, y: number, offset?: number): V3;
  normal(side: "front" | "back", x: number, y: number): V3;
}

export function createBodyMapper(config: DesignConfig, m: GarmentMeasurements): BodyMapper {
  const kids = config.audience === "kids";
  const halfNeck = m.neckWidth / 2;
  const shoulderX = m.shoulderWidth / 2;
  const slope = shoulderSlope(m, kids);
  const waistY = m.armholeDepth + (m.bodyLength - m.armholeDepth) * 0.45;
  const depthRatio = config.fit === "slim" ? 0.66 : config.fit === "regular" || config.fit === "longline" ? 0.63 : 0.58;
  const ramp = kids ? 6 : 9;
  const p = 2.6;
  const halfWidthAt = (y: number) => {
    if (y <= m.armholeDepth) return m.chest / 4;
    if (y <= waistY) return m.chest / 4 + (m.waist / 4 - m.chest / 4) * ((y - m.armholeDepth) / (waistY - m.armholeDepth));
    return m.waist / 4 + (m.hem / 4 - m.waist / 4) * Math.min(1, (y - waistY) / (m.bodyLength - waistY));
  };
  const depth = (x: number, y: number) => {
    const wb = halfWidthAt(y) + 0.01;
    const D = depthRatio * wb * (0.38 + 0.62 * smooth(0, m.armholeDepth * 1.05, y));
    const s = Math.min(1, Math.abs(x) / wb);
    const prof = Math.pow(Math.max(0, 1 - Math.pow(s, p)), 1 / p);
    const ax = Math.abs(x);
    const topYz = ax <= halfNeck ? 0 : slope * Math.min(1.4, (ax - halfNeck) / Math.max(1, shoulderX - halfNeck));
    const f = Math.sin((Math.min(1, Math.max(0, y - topYz) / ramp) * Math.PI) / 2);
    // gentle drape below the chest
    const drape = 1 + 0.025 * Math.sin((x / wb) * Math.PI * 3) * smooth(m.armholeDepth, m.bodyLength, y);
    return D * prof * f * drape;
  };
  const map = (side: "front" | "back", x: number, y: number, offset = 0): V3 => {
    const sign = side === "front" ? 1 : -1;
    const X = side === "front" ? x : -x;
    return [X, -y, sign * (depth(x, y) + offset)];
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

export function buildGarmentGeometry(config: DesignConfig, opts: { resolution?: number } = {}): GarmentGeometry {
  const m = computeMeasurements(config);
  const c = config.construction;
  const kids = config.audience === "kids";
  const res = opts.resolution ?? 64;
  const body = createBodyMapper(config, m);
  const front = torsoShape(m, "front", c, kids);
  const back = torsoShape(m, "back", c, kids);
  const torsoCanvas = zoneCanvas(m, "front");

  const frontMesh = panelMesh(front.outline, torsoCanvas, (x, y) => body.map("front", x, y), res);
  const backMesh = panelMesh(back.outline, torsoCanvas, (x, y) => body.map("back", x, y), res);

  // ── Sleeves ──────────────────────────────────────────────────
  const sl = sleeveShape(m, c);
  const sleeveCanvas = zoneCanvas(m, "sleeveLeft");
  const SW = sleeveCanvas.x1 - sleeveCanvas.x0;
  const SH = sleeveCanvas.y1 - sleeveCanvas.y0;
  const dropDeg = SLEEVE_DROP_DEG[c.sleeveStyle] ?? 54;
  const N = 48; // ring resolution (must be even)
  const ROWS = 30;
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
        const r = rBicep + (rEnd - rBicep) * smooth(0.15, 1, t);
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
    const standH = isBand ? m.collarHeight : 3.2 * (kids ? 0.8 : 1);
    const roundFront = c.collar === "mandarin" ? (k: number) => 1 - 0.35 * smooth(0.82, 1, Math.abs(k)) : undefined;
    collars.push(ringBand(standH, 0.12, 0.3, roundFront));
    if (!isBand) {
      const styles: Record<string, { fall: number; tip: number; spread: number; maxK: number; round?: boolean }> = {
        point: { fall: 4.2, tip: 3.2, spread: 0.25, maxK: 0.965 },
        spread: { fall: 4.2, tip: 2.4, spread: 0.75, maxK: 0.955 },
        cutaway: { fall: 4.0, tip: 1.8, spread: 1.15, maxK: 0.94 },
        "button-down": { fall: 4.4, tip: 3.0, spread: 0.35, maxK: 0.965 },
        club: { fall: 4.0, tip: 1.6, spread: 0.55, maxK: 0.955, round: true },
        camp: { fall: 6.0, tip: 4.2, spread: 0.9, maxK: 0.8 },
      };
      const st = styles[c.collar] ?? styles.point;
      const kScale = kids ? 0.8 : 1;
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
      collars.push(gridMesh(rowsLeaf, (i, j) => [i / KS, 1 - j / VS]));
    }
  }

  // ── Cuffs (rings at sleeve ends) ─────────────────────────────
  const cuffs: MeshData[] = [];
  if (!["hem", "none"].includes(c.cuff)) {
    for (const s of [left, right]) {
      const h = m.cuffHeight;
      const rows: V3[][] = [];
      for (let j = 0; j <= 2; j++) {
        const back = (h * (2 - j)) / 2;
        const ctr = sub(s.endCenter, mul(s.dir, back));
        rows.push(s.endRing.map((p) => add(ctr, mul(sub(p, s.endCenter), 1.06))));
      }
      cuffs.push(gridMesh(rows, (i, j) => [i / N, j / 2]));
    }
  }

  // ── Placket, buttons, pockets ─────────────────────────────────
  let placket: MeshData | null = null;
  const buttons: ButtonData[] = [];
  const showPlacket = c.placket === "standard" || c.placket === "contrast" || c.placket === "henley";
  if (showPlacket && m.placketWidth > 0) {
    const y0 = m.frontNeckDrop + 0.2;
    const y1 = c.placket === "henley" ? m.frontNeckDrop + m.placketLength : m.bodyLength - 0.4;
    const rows: V3[][] = [];
    const steps = 40;
    for (let j = 0; j <= steps; j++) {
      const y = y0 + ((y1 - y0) * j) / steps;
      const row: V3[] = [];
      for (let i = 0; i <= 2; i++) row.push(body.map("front", -m.placketWidth / 2 + (m.placketWidth * i) / 2, y, 0.12));
      rows.push(row);
    }
    placket = gridMesh(rows, (i, j) => [i / 2, 1 - j / steps]);
  }
  if (c.buttons.count > 0 && c.placket !== "hidden") {
    const top = m.frontNeckDrop + (shirt ? 1.4 : 1.8);
    const bottom = c.placket === "henley" ? top + m.placketLength - 3 : m.bodyLength - 9;
    for (let i = 0; i < c.buttons.count; i++) {
      const y = top + ((bottom - top) * i) / Math.max(1, c.buttons.count - 1);
      buttons.push({ position: body.map("front", 0, y, 0.3), normal: body.normal("front", 0, y), radius: c.buttons.sizeMm / 20 });
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
    pockets.push(gridMesh(rows, (i, j) => {
      const xx = -m.pocketWidth / 2 + (m.pocketWidth * i) / steps;
      const yy = (m.pocketHeight * j) / steps;
      return [(xx - pocketCanvas.x0) / (pocketCanvas.x1 - pocketCanvas.x0), 1 - (yy - pocketCanvas.y0) / (pocketCanvas.y1 - pocketCanvas.y0)];
    }));
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
      pockets.push(gridMesh(fr, (i, j) => [i / 8, 1 - j / 3]));
      if (c.buttons.count > 0) buttons.push({ position: body.map("front", pl.x, pl.y + 2.8, 0.45), normal: body.normal("front", pl.x, pl.y + 2.8), radius: c.buttons.sizeMm / 22 });
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
    buttons,
    sleeveAngleDeg: dropDeg,
    shoulderPoints: { left: left.shoulder, right: right.shoulder },
  };
}
