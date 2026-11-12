/**
 * Real-time cloth for a garment that is fitted to the body (XPBD-style position-based dynamics).
 *
 * Each frame the garment has a fitted target shape (its .mhclo binding on the posed body). Where the fabric lies on
 * the body it follows that target; where it hangs away from the body (hems, skirts, loose sleeves) its particles are
 * simulated: gravity, inertia, damping, inextensible edges, and three kinds of contact —
 *   · a maximum distance from the fitted position that grows with how loose the fabric is there,
 *   · a backstop along the fitted surface normal, so cloth cannot sink into the body it lies on,
 *   · capsules for arms and legs, built from the posed skeleton.
 * This is the "skinned cloth with max distance and backstop" model used by production real-time cloth systems, with
 * the looseness measured from the garment itself rather than painted by hand.
 */
export interface Capsule { ax: number; ay: number; az: number; bx: number; by: number; bz: number; r: number }

export interface ClothSettings { gravity: number; damping: number; substeps: number; stretchIterations: number; looseness: number; maxFree: number; backstop: number; /** allowance of fabric hanging below the crotch (a skirt), cm */ skirtFree: number }
export const CLOTH_DEFAULTS: ClothSettings = { gravity: 620, damping: 2.2, substeps: 3, stretchIterations: 3, looseness: 1.7, maxFree: 14, backstop: 0.35, skirtFree: 45 };

export class GarmentCloth {
  readonly particles: number;
  /** render vertex → particle */
  readonly map: Uint32Array;
  /** per particle: how far it may leave its fitted position (cm); 0 = follows the body */
  readonly free: Float32Array;
  private x: Float32Array; private p: Float32Array; private v: Float32Array;
  private tgt: Float32Array; private nrm: Float32Array;
  private edges: Uint32Array; private rest: Float32Array;
  private tris: Uint32Array;
  private first: Uint32Array;
  /** 1 = hanging fabric (skirt): no backstop, wide allowance */
  private hanging: Uint8Array;
  private started = false;
  /**
   * `crotchY`: height of the crotch on the unposed body. Loose fabric below it hangs between / around the legs, where
   * the fitted target tears apart when the legs move, so it is simulated freely there.
   */
  constructor(restTargets: Float32Array, index: ArrayLike<number>, bodyRest: Float32Array, bodyMask: Uint8Array, readonly settings: ClothSettings = CLOTH_DEFAULTS, crotchY = -Infinity) {
    const n = restTargets.length / 3;
    // weld render vertices that share a position (UV seams)
    const key = new Map<string, number>();
    this.map = new Uint32Array(n);
    const firstOf: number[] = [];
    for (let i = 0; i < n; i++) {
      const k = `${Math.round(restTargets[i * 3] * 200)},${Math.round(restTargets[i * 3 + 1] * 200)},${Math.round(restTargets[i * 3 + 2] * 200)}`;
      let id = key.get(k);
      if (id === undefined) { id = firstOf.length; key.set(k, id); firstOf.push(i); }
      this.map[i] = id;
    }
    this.particles = firstOf.length;
    this.first = Uint32Array.from(firstOf);
    const m = this.particles;
    this.x = new Float32Array(m * 3); this.p = new Float32Array(m * 3); this.v = new Float32Array(m * 3);
    this.tgt = new Float32Array(m * 3); this.nrm = new Float32Array(m * 3);
    for (let q = 0; q < m; q++) for (let c = 0; c < 3; c++) this.x[q * 3 + c] = restTargets[firstOf[q] * 3 + c];
    // triangles and unique edges in particle space
    const tri: number[] = [], es = new Set<number>(), e: number[] = [];
    for (let t = 0; t + 2 < index.length; t += 3) {
      const a = this.map[index[t]], b = this.map[index[t + 1]], c = this.map[index[t + 2]];
      if (a === b || b === c || a === c) continue;
      tri.push(a, b, c);
      for (const [i, j] of [[a, b], [b, c], [c, a]]) { const k = i < j ? i * m + j : j * m + i; if (!es.has(k)) { es.add(k); e.push(i, j); } }
    }
    this.tris = Uint32Array.from(tri);
    this.edges = Uint32Array.from(e);
    this.rest = new Float32Array(e.length / 2);
    for (let k = 0; k < this.rest.length; k++) this.rest[k] = Math.hypot(this.x[e[k * 2] * 3] - this.x[e[k * 2 + 1] * 3], this.x[e[k * 2] * 3 + 1] - this.x[e[k * 2 + 1] * 3 + 1], this.x[e[k * 2] * 3 + 2] - this.x[e[k * 2 + 1] * 3 + 2]);
    // looseness: distance from each particle to the nearest skin vertex of the unposed body (uniform grid)
    const cell = 4, grid = new Map<number, number[]>();
    const h = (ix: number, iy: number, iz: number) => ((ix + 512) * 1024 + (iy + 512)) * 1024 + (iz + 512);
    for (let vtx = 0; vtx < bodyMask.length; vtx++) {
      if (!bodyMask[vtx]) continue;
      const k = h(Math.floor(bodyRest[vtx * 3] / cell), Math.floor(bodyRest[vtx * 3 + 1] / cell), Math.floor(bodyRest[vtx * 3 + 2] / cell));
      let l = grid.get(k); if (!l) { l = []; grid.set(k, l); } l.push(vtx);
    }
    this.free = new Float32Array(m);
    for (let q = 0; q < m; q++) {
      const px = this.x[q * 3], py = this.x[q * 3 + 1], pz = this.x[q * 3 + 2];
      const ix = Math.floor(px / cell), iy = Math.floor(py / cell), iz = Math.floor(pz / cell);
      let best = Infinity;
      for (let ring = 1; ring <= 4 && best === Infinity; ring++) {
        for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) for (let dz = -ring; dz <= ring; dz++) {
          const l = grid.get(h(ix + dx, iy + dy, iz + dz));
          if (!l) continue;
          for (const vtx of l) { const d = Math.hypot(bodyRest[vtx * 3] - px, bodyRest[vtx * 3 + 1] - py, bodyRest[vtx * 3 + 2] - pz); if (d < best) best = d; }
        }
      }
      const d = best === Infinity ? cell * 4 : best;
      this.free[q] = Math.max(0, Math.min(settings.maxFree, (d - 1.4) * settings.looseness));
    }
    this.hanging = new Uint8Array(m);
    for (let q = 0; q < m; q++) {
      const below = crotchY - this.x[q * 3 + 1];
      if (this.free[q] > 0 && below > 0) { this.hanging[q] = 1; this.free[q] = Math.min(settings.skirtFree, this.free[q] + below * 1.6); }
    }
  }

  /** Share of particles that are simulated (0 … 1). */
  get freeShare(): number { let c = 0; for (let q = 0; q < this.particles; q++) if (this.free[q] > 0) c++; return this.particles ? c / this.particles : 0; }

  /**
   * Advances the cloth towards `targets` (render-vertex positions of the fitted garment this frame) and writes the
   * simulated render-vertex positions to `out`.
   */
  step(targets: Float32Array, dt: number, capsules: Capsule[], out: Float32Array): void {
    const m = this.particles, x = this.x, p = this.p, v = this.v, tgt = this.tgt, nrm = this.nrm, free = this.free, s = this.settings;
    for (let q = 0; q < m; q++) { const f = this.first[q] * 3; tgt[q * 3] = targets[f]; tgt[q * 3 + 1] = targets[f + 1]; tgt[q * 3 + 2] = targets[f + 2]; }
    // fitted surface normals (area-weighted)
    nrm.fill(0);
    const T = this.tris;
    for (let t = 0; t < T.length; t += 3) {
      const a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3;
      const ux = tgt[b] - tgt[a], uy = tgt[b + 1] - tgt[a + 1], uz = tgt[b + 2] - tgt[a + 2], wx = tgt[c] - tgt[a], wy = tgt[c + 1] - tgt[a + 1], wz = tgt[c + 2] - tgt[a + 2];
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      nrm[a] += nx; nrm[a + 1] += ny; nrm[a + 2] += nz; nrm[b] += nx; nrm[b + 1] += ny; nrm[b + 2] += nz; nrm[c] += nx; nrm[c + 1] += ny; nrm[c + 2] += nz;
    }
    for (let q = 0; q < m; q++) { const l = Math.hypot(nrm[q * 3], nrm[q * 3 + 1], nrm[q * 3 + 2]) || 1; nrm[q * 3] /= l; nrm[q * 3 + 1] /= l; nrm[q * 3 + 2] /= l; }
    if (!this.started || dt <= 0 || dt > 0.25) { x.set(tgt); v.fill(0); this.started = true; this.write(out); return; }
    const h = Math.min(dt, 1 / 30) / s.substeps;
    const E = this.edges, rest = this.rest;
    for (let sub = 0; sub < s.substeps; sub++) {
      const damp = Math.max(0, 1 - s.damping * h);
      for (let q = 0; q < m; q++) {
        const o = q * 3;
        if (free[q] === 0) { p[o] = x[o]; p[o + 1] = x[o + 1]; p[o + 2] = x[o + 2]; x[o] = tgt[o]; x[o + 1] = tgt[o + 1]; x[o + 2] = tgt[o + 2]; continue; }
        v[o] *= damp; v[o + 1] = v[o + 1] * damp - s.gravity * h; v[o + 2] *= damp;
        p[o] = x[o]; p[o + 1] = x[o + 1]; p[o + 2] = x[o + 2];
        x[o] += v[o] * h; x[o + 1] += v[o + 1] * h; x[o + 2] += v[o + 2] * h;
      }
      for (let it = 0; it < s.stretchIterations; it++) {
        for (let k = 0; k < rest.length; k++) {
          const i = E[k * 2], j = E[k * 2 + 1], wi = free[i] > 0 ? 1 : 0, wj = free[j] > 0 ? 1 : 0;
          if (wi + wj === 0) continue;
          const a = i * 3, b = j * 3;
          const dx = x[a] - x[b], dy = x[a + 1] - x[b + 1], dz = x[a + 2] - x[b + 2];
          const len = Math.hypot(dx, dy, dz);
          if (len < 1e-7) continue;
          const c = (len - rest[k]) / len / (wi + wj);
          x[a] -= dx * c * wi; x[a + 1] -= dy * c * wi; x[a + 2] -= dz * c * wi;
          x[b] += dx * c * wj; x[b + 1] += dy * c * wj; x[b + 2] += dz * c * wj;
        }
      }
      for (let q = 0; q < m; q++) {
        const f = free[q];
        if (f === 0) continue;
        const o = q * 3;
        // limb capsules
        for (const cap of capsules) {
          const ax = cap.bx - cap.ax, ay = cap.by - cap.ay, az = cap.bz - cap.az;
          const px = x[o] - cap.ax, py = x[o + 1] - cap.ay, pz = x[o + 2] - cap.az;
          const aa = ax * ax + ay * ay + az * az;
          const t = aa > 0 ? Math.max(0, Math.min(1, (px * ax + py * ay + pz * az) / aa)) : 0;
          const nx = px - ax * t, ny = py - ay * t, nz = pz - az * t;
          const d = Math.hypot(nx, ny, nz);
          if (d < cap.r && d > 1e-6) { const k = (cap.r - d) / d; x[o] += nx * k; x[o + 1] += ny * k; x[o + 2] += nz * k; }
        }
        // backstop: not behind the fitted surface
        let dx = x[o] - tgt[o], dy = x[o + 1] - tgt[o + 1], dz = x[o + 2] - tgt[o + 2];
        const along = dx * nrm[o] + dy * nrm[o + 1] + dz * nrm[o + 2];
        if (!this.hanging[q] && along < -s.backstop) { const k = -s.backstop - along; x[o] += nrm[o] * k; x[o + 1] += nrm[o + 1] * k; x[o + 2] += nrm[o + 2] * k; dx += nrm[o] * k; dy += nrm[o + 1] * k; dz += nrm[o + 2] * k; }
        // maximum distance from the fitted position
        const d = Math.hypot(dx, dy, dz);
        if (d > f) { const k = f / d; x[o] = tgt[o] + dx * k; x[o + 1] = tgt[o + 1] + dy * k; x[o + 2] = tgt[o + 2] + dz * k; }
        // hanging fabric swings but does not get longer than it was cut
        if (this.hanging[q] && x[o + 1] < tgt[o + 1] - 2.5) x[o + 1] = tgt[o + 1] - 2.5;
        if (x[o + 1] < 0.2) x[o + 1] = 0.2;
      }
      for (let k = 0; k < m * 3; k++) v[k] = (x[k] - p[k]) / h;
    }
    this.write(out);
  }

  private write(out: Float32Array) {
    const x = this.x, map = this.map;
    for (let i = 0; i < map.length; i++) { const q = map[i] * 3; out[i * 3] = x[q]; out[i * 3 + 1] = x[q + 1]; out[i * 3 + 2] = x[q + 2]; }
  }

  /** Largest relative stretch of an edge between two simulated particles (quality check). */
  maxStretch(): number {
    let mx = 0; const E = this.edges, x = this.x;
    for (let k = 0; k < this.rest.length; k++) {
      if (this.rest[k] < 0.3 || this.free[E[k * 2]] === 0 || this.free[E[k * 2 + 1]] === 0) continue;
      const a = E[k * 2] * 3, b = E[k * 2 + 1] * 3;
      mx = Math.max(mx, Math.abs(Math.hypot(x[a] - x[b], x[a + 1] - x[b + 1], x[a + 2] - x[b + 2]) / this.rest[k] - 1));
    }
    return mx;
  }
  /** Share of simulated edges stretched or compressed by more than `tol` (0 … 1). */
  stretchedShare(tol = 0.25): number {
    let bad = 0, n = 0; const E = this.edges, x = this.x;
    for (let k = 0; k < this.rest.length; k++) {
      if (this.rest[k] < 0.3 || this.free[E[k * 2]] === 0 || this.free[E[k * 2 + 1]] === 0) continue;
      const a = E[k * 2] * 3, b = E[k * 2 + 1] * 3;
      n++;
      if (Math.abs(Math.hypot(x[a] - x[b], x[a + 1] - x[b + 1], x[a + 2] - x[b + 2]) / this.rest[k] - 1) > tol) bad++;
    }
    return n ? bad / n : 0;
  }
  /** Largest distance of any particle from its fitted position, relative to its allowance (≤ 1 when respected). */
  maxExcursion(): number {
    let mx = 0;
    for (let q = 0; q < this.particles; q++) { const o = q * 3, d = Math.hypot(this.x[o] - this.tgt[o], this.x[o + 1] - this.tgt[o + 1], this.x[o + 2] - this.tgt[o + 2]); mx = Math.max(mx, this.free[q] > 0 ? d / this.free[q] : d > 1e-4 ? 2 : 0); }
    return mx;
  }
}

/** Arm and leg capsules from posed joints; radii from the unposed body (mean distance of each limb's skin to its bone). */
export function limbRadii(names: string[], head: Float32Array, rest: Float32Array, joints: Uint8Array, isBody: Uint8Array): Map<string, number> {
  const idx = new Map(names.map((n, i) => [n, i]));
  const out = new Map<string, number>();
  for (const [a, b] of LIMBS) {
    const ia = idx.get(a), ib = idx.get(b);
    if (ia === undefined || ib === undefined) continue;
    const ax = head[ia * 3], ay = head[ia * 3 + 1], az = head[ia * 3 + 2], dx = head[ib * 3] - ax, dy = head[ib * 3 + 1] - ay, dz = head[ib * 3 + 2] - az;
    const dd = dx * dx + dy * dy + dz * dz || 1;
    let sum = 0, n = 0;
    for (let v = 0; v < isBody.length; v++) {
      if (!isBody[v] || joints[v * 4] !== ia) continue;
      const px = rest[v * 3] - ax, py = rest[v * 3 + 1] - ay, pz = rest[v * 3 + 2] - az;
      const t = Math.max(0, Math.min(1, (px * dx + py * dy + pz * dz) / dd));
      sum += Math.hypot(px - dx * t, py - dy * t, pz - dz * t); n++;
    }
    if (n) out.set(a, (sum / n) * 0.92);
  }
  return out;
}
export const LIMBS: [string, string][] = [["LeftUpLeg", "LeftLeg"], ["LeftLeg", "LeftFoot"], ["RightUpLeg", "RightLeg"], ["RightLeg", "RightFoot"], ["LeftArm", "LeftForeArm"], ["LeftForeArm", "LeftHand"], ["RightArm", "RightForeArm"], ["RightForeArm", "RightHand"]];
export function limbCapsules(names: string[], heads: Float32Array, radii: Map<string, number>): Capsule[] {
  const idx = new Map(names.map((n, i) => [n, i]));
  const out: Capsule[] = [];
  for (const [a, b] of LIMBS) {
    const ia = idx.get(a), ib = idx.get(b), r = radii.get(a);
    if (ia === undefined || ib === undefined || !r) continue;
    out.push({ ax: heads[ia * 3], ay: heads[ia * 3 + 1], az: heads[ia * 3 + 2], bx: heads[ib * 3], by: heads[ib * 3 + 1], bz: heads[ib * 3 + 2], r });
  }
  return out;
}
