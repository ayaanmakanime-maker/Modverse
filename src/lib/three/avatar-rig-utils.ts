/**
 * Pure mesh utilities for the supplied FBX characters (no THREE import, so they
 * are unit-testable). All arrays are flat typed arrays in the character's own
 * space (centimetres, y up).
 *
 *  • weldComponents / splitOutfit — the characters come with their own clothes
 *    baked into one "Outfit" material; the upper garment is separated from the
 *    trousers so ModVerse's designed garment can replace it.
 *  • buildGrid / transferWeights — copy skin weights from the character's body
 *    to garment vertices (nearest-neighbour, inverse-distance blended), so the
 *    designed garment follows the skeleton (poses and animations).
 *  • shrinkAlongNormals — the hidden shirt becomes a skin-coloured torso/arm
 *    "fill" under the designed garment (the models are hollow under their
 *    clothes).
 *  • girthScale — smooth radial scale field for chest / waist / hip morphs.
 */

export interface Components { comp: Int32Array; count: number; tris: number[]; size: number[]; minY: number[]; maxY: number[]; sumY: number[] }

const key3 = (x: number, y: number, z: number, q: number) => `${Math.round(x * q)},${Math.round(y * q)},${Math.round(z * q)}`;

/** Connected components of a triangle list whose vertices are welded by quantised position (the geometry is non-indexed). */
export function weldComponents(positions: ArrayLike<number>, triangles: ArrayLike<number> /* triangle indices; vertices are 3t..3t+2 */, quant = 50): Components {
  const ids = new Map<string, number>();
  const parent: number[] = [];
  const find = (a: number) => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  const vid = (v: number) => {
    const k = key3(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2], quant);
    let i = ids.get(k);
    if (i === undefined) {
      i = parent.length;
      ids.set(k, i);
      parent.push(i);
    }
    return i;
  };
  const first: number[] = [];
  const tris: number[] = [];
  for (let n = 0; n < triangles.length; n++) {
    const t = triangles[n];
    const a = vid(t * 3), b = vid(t * 3 + 1), c = vid(t * 3 + 2);
    first.push(a);
    tris.push(t);
    const ra = find(a);
    parent[find(b)] = ra;
    parent[find(c)] = ra;
  }
  const remap = new Map<number, number>();
  const comp = new Int32Array(triangles.length);
  const size: number[] = [], minY: number[] = [], maxY: number[] = [], sumY: number[] = [];
  for (let n = 0; n < triangles.length; n++) {
    const r = find(first[n]);
    let ci = remap.get(r);
    if (ci === undefined) {
      ci = size.length;
      remap.set(r, ci);
      size.push(0);
      minY.push(Infinity);
      maxY.push(-Infinity);
      sumY.push(0);
    }
    comp[n] = ci;
    size[ci]++;
    const t = triangles[n];
    for (let k = 0; k < 3; k++) {
      const y = positions[(t * 3 + k) * 3 + 1];
      if (y < minY[ci]) minY[ci] = y;
      if (y > maxY[ci]) maxY[ci] = y;
      sumY[ci] += y / 3;
    }
  }
  return { comp, count: size.length, tris, size, minY, maxY, sumY };
}

export interface OutfitSplit { upper: number[]; lower: number[]; method: "components" | "plane"; cutY: number; lowerTopY: number }

/**
 * Split the baked outfit into the upper garment (replaced by the designed garment) and the trousers (kept).
 * Two separate big pieces → the higher one is the top. One welded piece (shirt tucked into the trousers) →
 * cut at a plane just above the waistband (hips + 7 % of the height).
 */
export function splitOutfit(positions: ArrayLike<number>, outfitTris: number[], hipsY: number, heightCm: number): OutfitSplit {
  const w = weldComponents(positions, outfitTris);
  const big = w.size.map((s, i) => [s, i] as const).filter(([s]) => s > 150).map(([, i]) => i);
  if (big.length >= 2) {
    const meanY = (i: number) => w.sumY[i] / w.size[i];
    const top = big.reduce((a, b) => (meanY(b) > meanY(a) ? b : a));
    const upper: number[] = [], lower: number[] = [];
    w.comp.forEach((ci, n) => (ci === top ? upper : lower).push(w.tris[n]));
    const lowerTopY = Math.max(...big.filter((i) => i !== top).map((i) => w.maxY[i]));
    return { upper, lower, method: "components", cutY: w.minY[top], lowerTopY };
  }
  const cutY = hipsY + 0.07 * heightCm;
  const upper: number[] = [], lower: number[] = [];
  for (const t of outfitTris) {
    const y = (positions[t * 9 + 1] + positions[t * 9 + 4] + positions[t * 9 + 7]) / 3;
    (y > cutY ? upper : lower).push(t);
  }
  return { upper, lower, method: "plane", cutY, lowerTopY: cutY };
}

/** Move every vertex inwards along its normal by `d` (the clothing thickness), turning a garment into a body surface. */
export function shrinkAlongNormals(positions: Float32Array, normals: ArrayLike<number>, d: number): Float32Array {
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    out[i] = positions[i] - normals[i] * d;
    out[i + 1] = positions[i + 1] - normals[i + 1] * d;
    out[i + 2] = positions[i + 2] - normals[i + 2] * d;
  }
  return out;
}

/** Unique vertices (welded by quantised position) of a triangle soup, with the index of one source vertex for each. */
export function uniqueVertices(positions: ArrayLike<number>, vertexIndices: ArrayLike<number>, quant = 20): number[] {
  const seen = new Set<string>();
  const out: number[] = [];
  for (let n = 0; n < vertexIndices.length; n++) {
    const v = vertexIndices[n];
    const k = key3(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2], quant);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

/**
 * One representative vertex per `cell`-sized voxel (the first one met), in encounter order. Much faster than
 * string-keyed welding and also thins dense meshes to a uniform spacing.
 */
export function voxelUnique(positions: ArrayLike<number>, vertexIndices: ArrayLike<number>, cell: number): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (let n = 0; n < vertexIndices.length; n++) {
    const v = vertexIndices[n];
    const key = ((Math.floor(positions[v * 3] / cell) + 4096) * 16384 + (Math.floor(positions[v * 3 + 1] / cell) + 4096)) * 16384 + (Math.floor(positions[v * 3 + 2] / cell) + 4096);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

/** Linear-blend skinning of one position by up to four weighted 4×4 matrices (column-major, as three.js stores them). */
export function skinPoint(out: Float32Array | number[], o: number, x: number, y: number, z: number, idx: ArrayLike<number>, w: ArrayLike<number>, base: number, mats: ArrayLike<number>[]): void {
  let ox = 0, oy = 0, oz = 0;
  for (let j = 0; j < 4; j++) {
    const wj = w[base + j];
    if (wj <= 0) continue;
    const m = mats[idx[base + j]];
    ox += wj * (m[0] * x + m[4] * y + m[8] * z + m[12]);
    oy += wj * (m[1] * x + m[5] * y + m[9] * z + m[13]);
    oz += wj * (m[2] * x + m[6] * y + m[10] * z + m[14]);
  }
  out[o] = ox; out[o + 1] = oy; out[o + 2] = oz;
}

/* ------------------------------------------------------------ weights */

export interface Grid { cell: number; map: Map<number, number[]>; positions: ArrayLike<number> }
const hash = (x: number, y: number, z: number) => ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) | 0;

export function buildGrid(positions: ArrayLike<number>, indices: ArrayLike<number> | null, cell = 3): Grid {
  const map = new Map<number, number[]>();
  const n = indices ? indices.length : positions.length / 3;
  for (let k = 0; k < n; k++) {
    const v = indices ? indices[k] : k;
    const h = hash(Math.floor(positions[v * 3] / cell), Math.floor(positions[v * 3 + 1] / cell), Math.floor(positions[v * 3 + 2] / cell));
    const a = map.get(h);
    if (a) a.push(v);
    else map.set(h, [v]);
  }
  return { cell, map, positions };
}

/** The k nearest grid vertices to (x, y, z) with their distances. */
export function nearestK(g: Grid, x: number, y: number, z: number, k: number, maxRing = 8): { v: number; d: number }[] {
  const cx = Math.floor(x / g.cell), cy = Math.floor(y / g.cell), cz = Math.floor(z / g.cell);
  const found: { v: number; d: number }[] = [];
  for (let ring = 1; ring <= maxRing; ring++) {
    found.length = 0;
    for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) for (let dz = -ring; dz <= ring; dz++) {
      const list = g.map.get(hash(cx + dx, cy + dy, cz + dz));
      if (!list) continue;
      for (const v of list) {
        const ex = g.positions[v * 3] - x, ey = g.positions[v * 3 + 1] - y, ez = g.positions[v * 3 + 2] - z;
        found.push({ v, d: Math.sqrt(ex * ex + ey * ey + ez * ez) });
      }
    }
    if (found.length >= k) {
      found.sort((a, b) => a.d - b.d);
      // a vertex in the next ring could still be closer than the k-th found when the ring is small: accept once the k-th is inside the searched radius
      if (found[k - 1].d <= ring * g.cell || ring === maxRing) return found.slice(0, k);
    }
  }
  found.sort((a, b) => a.d - b.d);
  return found.slice(0, k);
}

export interface SkinData { skinIndex: ArrayLike<number>; skinWeight: ArrayLike<number> } // 4 influences per vertex

/** Inverse-distance blend of the k nearest source vertices' skin weights → 4 influences per target vertex. */
export function transferWeights(src: SkinData, grid: Grid, targets: ArrayLike<number>, k = 3): { skinIndex: Uint16Array; skinWeight: Float32Array } {
  const n = targets.length / 3;
  const skinIndex = new Uint16Array(n * 4);
  const skinWeight = new Float32Array(n * 4);
  const acc = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const near = nearestK(grid, targets[i * 3], targets[i * 3 + 1], targets[i * 3 + 2], k);
    acc.clear();
    let wsum = 0;
    for (const { v, d } of near) {
      const w = 1 / (d + 0.1) ** 2;
      wsum += w;
      for (let j = 0; j < 4; j++) {
        const sw = src.skinWeight[v * 4 + j];
        if (sw > 0) acc.set(src.skinIndex[v * 4 + j], (acc.get(src.skinIndex[v * 4 + j]) ?? 0) + sw * w);
      }
    }
    const top = [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const tot = top.reduce((a, [, w]) => a + w, 0) || 1;
    top.forEach(([bi, w], j) => {
      skinIndex[i * 4 + j] = bi;
      skinWeight[i * 4 + j] = w / tot;
    });
    if (!top.length || wsum === 0) skinWeight[i * 4] = 1;
  }
  return { skinIndex, skinWeight };
}

/* ------------------------------------------------------------- morphs */

/** Smoothstep interpolation of a piecewise "level → factor" list (levels ascending in y). */
export function levelFactor(levels: [number, number][], y: number): number {
  if (y <= levels[0][0]) return levels[0][1];
  for (let i = 1; i < levels.length; i++) {
    if (y <= levels[i][0]) {
      const t = (y - levels[i - 1][0]) / (levels[i][0] - levels[i - 1][0]);
      const s = t * t * (3 - 2 * t);
      return levels[i - 1][1] + (levels[i][1] - levels[i - 1][1]) * s;
    }
  }
  return levels[levels.length - 1][1];
}

/**
 * Radial girth morph around the body axis: vertices are scaled in x/z about (cx, cz(y)) by a factor that
 * depends on height (chest / waist / hip ratios). `mask` selects which vertices take part (torso and thighs,
 * never the head, hands or feet).
 */
export function girthMorph(positions: Float32Array, mask: (i: number) => boolean, axis: (y: number, i: number) => [number, number], levels: [number, number][]): Float32Array {
  const out = positions.slice();
  for (let i = 0; i < positions.length / 3; i++) {
    if (!mask(i)) continue;
    const y = positions[i * 3 + 1];
    const f = levelFactor(levels, y);
    if (Math.abs(f - 1) < 1e-4) continue;
    const [cx, cz] = axis(y, i);
    out[i * 3] = cx + (positions[i * 3] - cx) * f;
    out[i * 3 + 2] = cz + (positions[i * 3 + 2] - cz) * f;
  }
  return out;
}

/* ---------------------------------------------------------- collisions */

/**
 * One-time collision resolution of a garment against the body in the bind pose: every garment vertex that lies
 * inside the body (or closer than `margin`) is moved out along the local body normal. The signed distance and the
 * normal are inverse-distance averages over the nearest body points, so sampling noise of the (decimated) body surface
 * does not roughen the cloth, and body points carry outward normals so garment vertices in concave gaps (underarm)
 * that merely face a body part are left alone. Returns xyz displacements.
 */
export function collisionPush(points: ArrayLike<number>, grid: Grid, bodyNormals: ArrayLike<number>, margin: number, reach: number): Float32Array {
  const n = points.length / 3;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = points[i * 3], y = points[i * 3 + 1], z = points[i * 3 + 2];
    let ws = 0, sd = 0, bx = 0, by = 0, bz = 0, deepest = -Infinity;
    for (const { v, d } of nearestK(grid, x, y, z, 6, 2)) {
      if (d > reach) continue;
      const nx = bodyNormals[v * 3], ny = bodyNormals[v * 3 + 1], nz = bodyNormals[v * 3 + 2];
      const dist = (x - grid.positions[v * 3]) * nx + (y - grid.positions[v * 3 + 1]) * ny + (z - grid.positions[v * 3 + 2]) * nz;
      const w = 1 / (d + 0.3) ** 2;
      ws += w; sd += w * dist; bx += w * nx; by += w * ny; bz += w * nz;
      deepest = Math.max(deepest, margin - dist);
    }
    if (!ws) continue;
    sd /= ws;
    const l = Math.hypot(bx, by, bz) || 1;
    // the averaged estimate decides how far to move; a single deeply buried body point still guarantees half of its depth
    const req = Math.max(margin - sd, deepest * 0.5);
    if (req > 0) { out[i * 3] = (bx / l) * req; out[i * 3 + 1] = (by / l) * req; out[i * 3 + 2] = (bz / l) * req; }
  }
  return out;
}

/** Uniform neighbour averaging of per-point vectors (a blur that also keeps coincident points identical). */
export function blurPoints(points: Float32Array, values: Float32Array, radius: number, passes = 1): Float32Array {
  const n = points.length / 3;
  const { start, list } = neighbourLists(points, radius);
  let cur = values;
  for (let p = 0; p < passes; p++) {
    const next = new Float32Array(cur.length);
    for (let i = 0; i < n; i++) {
      const a = start[i], b = start[i + 1];
      if (b === a) { next[i * 3] = cur[i * 3]; next[i * 3 + 1] = cur[i * 3 + 1]; next[i * 3 + 2] = cur[i * 3 + 2]; continue; }
      let sx = 0, sy = 0, sz = 0;
      for (let k = a; k < b; k++) { const j = list[k]; sx += cur[j * 3]; sy += cur[j * 3 + 1]; sz += cur[j * 3 + 2]; }
      next[i * 3] = sx / (b - a); next[i * 3 + 1] = sy / (b - a); next[i * 3 + 2] = sz / (b - a);
    }
    cur = next;
  }
  return cur;
}

/** Neighbour lists (all points within `radius`, including the point itself) in compressed form. */
export function neighbourLists(points: Float32Array, radius: number): { start: Int32Array; list: Int32Array } {
  const n = points.length / 3;
  const grid = buildGrid(points, null, radius);
  const start = new Int32Array(n + 1);
  const list: number[] = [];
  const r2 = radius * radius;
  for (let i = 0; i < n; i++) {
    const x = points[i * 3], y = points[i * 3 + 1], z = points[i * 3 + 2];
    const cx = Math.floor(x / radius), cy = Math.floor(y / radius), cz = Math.floor(z / radius);
    start[i] = list.length;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const cell = grid.map.get(hash(cx + dx, cy + dy, cz + dz));
      if (!cell) continue;
      for (const j of cell) {
        const ex = points[j * 3] - x, ey = points[j * 3 + 1] - y, ez = points[j * 3 + 2] - z;
        if (ex * ex + ey * ey + ez * ez <= r2) list.push(j);
      }
    }
  }
  start[n] = list.length;
  return { start, list: Int32Array.from(list) };
}

/**
 * Spreads displacements over spatially neighbouring points (cloth drapes over a bump instead of tenting). Works on
 * the points of ALL garment pieces together, so vertices that coincide at a seam end up with identical results:
 * each pass lets a point take the (damped) average displacement of the points within `radius` when that is larger
 * than its own.
 */
export function spreadSpatial(points: Float32Array, disp: Float32Array, radius: number, passes = 3, damp = 0.9): Float32Array {
  const n = points.length / 3;
  const { start, list } = neighbourLists(points, radius);
  let cur = disp;
  for (let p = 0; p < passes; p++) {
    const next = cur.slice();
    for (let i = 0; i < n; i++) {
      const a = start[i], b = start[i + 1];
      if (b === a) continue;
      let sx = 0, sy = 0, sz = 0;
      for (let k = a; k < b; k++) { const j = list[k]; sx += cur[j * 3]; sy += cur[j * 3 + 1]; sz += cur[j * 3 + 2]; }
      const f = damp / (b - a);
      sx *= f; sy *= f; sz *= f;
      if (sx * sx + sy * sy + sz * sz > cur[i * 3] ** 2 + cur[i * 3 + 1] ** 2 + cur[i * 3 + 2] ** 2) { next[i * 3] = sx; next[i * 3 + 1] = sy; next[i * 3 + 2] = sz; }
    }
    cur = next;
  }
  return cur;
}

/**
 * Smooths 4-influence skin weights over spatial neighbours, so weights do not jump between (say) the two thighs
 * under a hem. Positions only: points that coincide at a seam get identical results.
 */
export function smoothSkinWeights(points: Float32Array, skinIndex: Uint16Array, skinWeight: Float32Array, nBones: number, radius = 2.5, passes = 1): { skinIndex: Uint16Array; skinWeight: Float32Array } {
  const n = points.length / 3;
  const { start, list } = neighbourLists(points, radius);
  let idx = skinIndex, wt = skinWeight;
  const acc = new Float32Array(nBones);
  const touched: number[] = [];
  for (let p = 0; p < passes; p++) {
    const ni = new Uint16Array(n * 4), nw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      touched.length = 0;
      for (let k = start[i]; k < start[i + 1]; k++) {
        const j = list[k];
        for (let q = 0; q < 4; q++) {
          const w = wt[j * 4 + q];
          if (w <= 0) continue;
          const b = idx[j * 4 + q];
          if (acc[b] === 0) touched.push(b);
          acc[b] += w;
        }
      }
      touched.sort((a, b) => acc[b] - acc[a]);
      let tot = 0;
      const top = Math.min(4, touched.length);
      for (let q = 0; q < top; q++) tot += acc[touched[q]];
      for (let q = 0; q < top; q++) { ni[i * 4 + q] = touched[q]; nw[i * 4 + q] = acc[touched[q]] / (tot || 1); }
      if (!top) nw[i * 4] = 1;
      for (const b of touched) acc[b] = 0;
    }
    idx = ni;
    wt = nw;
  }
  return { skinIndex: idx as Uint16Array, skinWeight: wt as Float32Array };
}
