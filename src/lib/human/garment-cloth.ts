/**
 * Garment cloth engine for Human Studio: XPBD (extended position-based dynamics, Macklin, Müller & Chentanez 2016)
 * with the "small steps" scheme (Macklin et al. 2019: many substeps, one constraint iteration each), the method used
 * by production real-time cloth solvers.
 *
 * Every frame each garment has a fitted target shape (its .mhclo binding on the posed body). Particles where the
 * fabric lies on the body are driven kinematically by that target; particles where it hangs or stands away (hems,
 * skirts, loose sleeves, jacket fronts) are simulated:
 *   · gravity, inertia and air damping;
 *   · stretch constraints on every mesh edge and bending constraints across every pair of adjacent triangles, each
 *     with its own compliance (a fabric's resistance to stretching and folding);
 *   · a tether: a maximum distance from the fitted position that grows with how loose the fabric is there (long-range
 *     attachment, which stops hanging cloth from stretching under its own weight);
 *   · collision with the posed body surface (spatial hash of the skin, contact planes with thickness and friction),
 *     with limb capsules as a second line of defence;
 *   · a backstop along the fitted surface normal for fabric that lies close to the body.
 * After the step, every garment vertex — simulated or not — is pushed out of the body (BodyCollider.pushOut), so no
 * body proportion makes the skin poke through a garment.
 * Self-collision of the fabric is not simulated.
 */
export interface Capsule { ax: number; ay: number; az: number; bx: number; by: number; bz: number; r: number }

export interface ClothSettings {
  gravity: number; damping: number; substeps: number;
  /** XPBD compliance (inverse stiffness) for stretch and bending; 0 = rigid. Units: cm / (unit mass · s²)⁻¹. */
  stretchCompliance: number; bendCompliance: number;
  /** Contact thickness (cm) and friction coefficient against the body. */
  thickness: number; friction: number;
  looseness: number; maxFree: number; backstop: number;
  /** allowance of fabric hanging below the crotch (a skirt), cm */ skirtFree: number;
}
export const CLOTH_DEFAULTS: ClothSettings = { gravity: 981, damping: 1.6, substeps: 8, stretchCompliance: 1e-7, bendCompliance: 4e-4, thickness: 0.35, friction: 0.35, looseness: 1.7, maxFree: 14, backstop: 0.35, skirtFree: 45 };
/** Fabric families: knits stretch and fold softly, suiting is stiff, chiffon is light and limp. */
export const FABRIC_CLOTH: Record<"jersey" | "woven" | "suiting" | "denim" | "chiffon", Partial<ClothSettings>> = {
  jersey: { stretchCompliance: 2e-6, bendCompliance: 8e-4, damping: 1.8 },
  woven: { stretchCompliance: 1e-7, bendCompliance: 3e-4 },
  suiting: { stretchCompliance: 0, bendCompliance: 6e-5, damping: 2.4 },
  denim: { stretchCompliance: 0, bendCompliance: 4e-5, damping: 2.6 },
  chiffon: { stretchCompliance: 2e-7, bendCompliance: 3e-3, damping: 1.1 },
};

/**
 * The posed body as a collision surface: skin vertices with smooth normals in a uniform spatial hash, rebuilt each
 * frame. Contact is taken against the tangent plane at the nearest skin vertex (skin vertices are 1–2 cm apart).
 */
export class BodyCollider {
  private n: Float32Array;
  private cell = 3;
  /** dense grid over the posed body's bounding box: head vertex per cell, linked list through `next` */
  private heads = new Int32Array(0);
  private dims = [0, 0, 0];
  private origin = [0, 0, 0];
  private next: Int32Array;
  private p: Float32Array | null = null;
  private skin: Uint32Array;
  /** `tris`: body triangles in base-vertex indices; `mask`: 1 for the rendered body's vertices. */
  constructor(private tris: Uint32Array, mask: Uint8Array) {
    this.n = new Float32Array(mask.length * 3);
    this.next = new Int32Array(mask.length).fill(-1);
    const s: number[] = [];
    for (let v = 0; v < mask.length; v++) if (mask[v]) s.push(v);
    this.skin = Uint32Array.from(s);
  }
  /** Rebuild normals and the grid for the posed body positions `P` (base-vertex space). */
  update(P: Float32Array) {
    this.p = P;
    const n = this.n, T = this.tris;
    n.fill(0);
    for (let t = 0; t < T.length; t += 3) {
      const a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      n[a] += nx; n[a + 1] += ny; n[a + 2] += nz; n[b] += nx; n[b + 1] += ny; n[b + 2] += nz; n[c] += nx; n[c + 1] += ny; n[c + 2] += nz;
    }
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const v of this.skin) { const o = v * 3; if (P[o] < x0) x0 = P[o]; if (P[o] > x1) x1 = P[o]; if (P[o + 1] < y0) y0 = P[o + 1]; if (P[o + 1] > y1) y1 = P[o + 1]; if (P[o + 2] < z0) z0 = P[o + 2]; if (P[o + 2] > z1) z1 = P[o + 2]; }
    const cs = this.cell, m = 2 * cs;
    this.origin = [x0 - m, y0 - m, z0 - m];
    this.dims = [Math.ceil((x1 - x0 + 2 * m) / cs) + 1, Math.ceil((y1 - y0 + 2 * m) / cs) + 1, Math.ceil((z1 - z0 + 2 * m) / cs) + 1];
    const size = this.dims[0] * this.dims[1] * this.dims[2];
    if (this.heads.length < size) this.heads = new Int32Array(size);
    this.heads.fill(-1, 0, size);
    const [ox, oy, oz] = this.origin, [dx, dy] = this.dims;
    for (const v of this.skin) {
      const o = v * 3, l = Math.sqrt(n[o] * n[o] + (n[o + 1]) * (n[o + 1]) + (n[o + 2]) * (n[o + 2])) || 1;
      n[o] /= l; n[o + 1] /= l; n[o + 2] /= l;
      const c = (((P[o + 2] - oz) / cs) | 0) * dx * dy + (((P[o + 1] - oy) / cs) | 0) * dx + (((P[o] - ox) / cs) | 0);
      this.next[v] = this.heads[c];
      this.heads[c] = v;
    }
  }
  /** Nearest skin vertex within ~1.5 cells (−1 if none). */
  nearest(x: number, y: number, z: number): number {
    const P = this.p!, cs = this.cell, [ox, oy, oz] = this.origin, [dx, dy, dz] = this.dims;
    const ix = Math.floor((x - ox) / cs), iy = Math.floor((y - oy) / cs), iz = Math.floor((z - oz) / cs);
    if (ix < 1 || iy < 1 || iz < 1 || ix >= dx - 1 || iy >= dy - 1 || iz >= dz - 1) return -1;
    let best = -1, bd = Infinity;
    const H = this.heads, N = this.next;
    for (let k = iz - 1; k <= iz + 1; k++) for (let j = iy - 1; j <= iy + 1; j++) {
      const row = k * dx * dy + j * dx;
      for (let i = ix - 1; i <= ix + 1; i++) {
        for (let v = H[row + i]; v !== -1; v = N[v]) {
          const o = v * 3, ex = P[o] - x, ey = P[o + 1] - y, ez = P[o + 2] - z, d = ex * ex + ey * ey + ez * ez;
          if (d < bd) { bd = d; best = v; }
        }
      }
    }
    return best;
  }
  /** Contact plane at a skin vertex: point and outward normal. */
  plane(v: number, out: Float32Array, o: number) {
    const P = this.p!, n = this.n, k = v * 3;
    out[o] = P[k]; out[o + 1] = P[k + 1]; out[o + 2] = P[k + 2]; out[o + 3] = n[k]; out[o + 4] = n[k + 1]; out[o + 5] = n[k + 2];
  }
  /**
   * Push every point of `buf` that is inside (or closer than `thickness` to) the skin back outside, along the skin
   * normal. Returns how many points were moved.
   */
  pushOut(buf: Float32Array, thickness: number): number {
    if (!this.p) return 0;
    const P = this.p, n = this.n;
    let moved = 0;
    for (let i = 0; i < buf.length; i += 3) {
      const v = this.nearest(buf[i], buf[i + 1], buf[i + 2]);
      if (v < 0) continue;
      const o = v * 3, d = (buf[i] - P[o]) * n[o] + (buf[i + 1] - P[o + 1]) * n[o + 1] + (buf[i + 2] - P[o + 2]) * n[o + 2];
      if (d < thickness && d > -6) { const k = thickness - d; buf[i] += n[o] * k; buf[i + 1] += n[o + 1] * k; buf[i + 2] += n[o + 2] * k; moved++; }
    }
    return moved;
  }
}

export class GarmentCloth {
  readonly particles: number;
  /** render vertex → particle */
  readonly map: Uint32Array;
  /** per particle: how far it may leave its fitted position (cm); 0 = follows the body */
  readonly free: Float32Array;
  private x: Float32Array; private p: Float32Array; private v: Float32Array;
  private tgt: Float32Array; private prevTgt: Float32Array; private nrm: Float32Array;
  private edges: Uint32Array; private rest: Float32Array;
  private bends: Uint32Array; private bendRest: Float32Array;
  private simEdges!: Uint32Array; private simRest!: Float32Array; private simBends!: Uint32Array; private simBendRest!: Float32Array;
  private tris: Uint32Array;
  private first: Uint32Array;
  /** simulated particle ids, and kinematic (body-following) particle ids */
  private dyn: Uint32Array; private kin: Uint32Array;
  /** inverse mass per particle: 1 simulated, 0 kinematic */
  private invMass: Float32Array;
  /** per dynamic particle: contact plane (px, py, pz, nx, ny, nz) or NaN */
  private contact: Float32Array;
  /** 1 = hanging fabric (skirt): no backstop, wide allowance */
  private hanging: Uint8Array;
  private started = false;
  readonly settings: ClothSettings;
  /**
   * `crotchY`: height of the crotch on the unposed body. Loose fabric below it hangs between / around the legs, where
   * the fitted target tears apart when the legs move, so it is simulated freely there.
   */
  constructor(restTargets: Float32Array, index: ArrayLike<number>, bodyRest: Float32Array, bodyMask: Uint8Array, settings: Partial<ClothSettings> = CLOTH_DEFAULTS, crotchY = -Infinity) {
    this.settings = { ...CLOTH_DEFAULTS, ...settings };
    const st = this.settings;
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
    this.tgt = new Float32Array(m * 3); this.prevTgt = new Float32Array(m * 3); this.nrm = new Float32Array(m * 3);
    for (let q = 0; q < m; q++) for (let c = 0; c < 3; c++) this.x[q * 3 + c] = restTargets[firstOf[q] * 3 + c];
    // triangles, unique edges, and the opposite-vertex pair of every interior edge (bending)
    const tri: number[] = [], e: number[] = [], opp = new Map<number, number>(), bend: number[] = [];
    for (let t = 0; t + 2 < index.length; t += 3) {
      const a = this.map[index[t]], b = this.map[index[t + 1]], c = this.map[index[t + 2]];
      if (a === b || b === c || a === c) continue;
      tri.push(a, b, c);
      for (const [i, j, o] of [[a, b, c], [b, c, a], [c, a, b]]) {
        const k = i < j ? i * m + j : j * m + i;
        const other = opp.get(k);
        if (other === undefined) { opp.set(k, o); e.push(i, j); }
        else if (other >= 0 && other !== o) { bend.push(other, o); opp.set(k, -1); }
      }
    }
    this.tris = Uint32Array.from(tri);
    this.edges = Uint32Array.from(e);
    this.bends = Uint32Array.from(bend);
    const dist = (i: number, j: number) => Math.sqrt((this.x[i * 3] - this.x[j * 3]) * (this.x[i * 3] - this.x[j * 3]) + (this.x[i * 3 + 1] - this.x[j * 3 + 1]) * (this.x[i * 3 + 1] - this.x[j * 3 + 1]) + (this.x[i * 3 + 2] - this.x[j * 3 + 2]) * (this.x[i * 3 + 2] - this.x[j * 3 + 2]));
    this.rest = new Float32Array(e.length / 2);
    for (let k = 0; k < this.rest.length; k++) this.rest[k] = dist(e[k * 2], e[k * 2 + 1]);
    this.bendRest = new Float32Array(bend.length / 2);
    for (let k = 0; k < this.bendRest.length; k++) this.bendRest[k] = dist(bend[k * 2], bend[k * 2 + 1]);
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
          for (const vtx of l) { const d = Math.sqrt((bodyRest[vtx * 3] - px) * (bodyRest[vtx * 3] - px) + (bodyRest[vtx * 3 + 1] - py) * (bodyRest[vtx * 3 + 1] - py) + (bodyRest[vtx * 3 + 2] - pz) * (bodyRest[vtx * 3 + 2] - pz)); if (d < best) best = d; }
        }
      }
      const d = best === Infinity ? cell * 4 : best;
      this.free[q] = Math.max(0, Math.min(st.maxFree, (d - 1.4) * st.looseness));
    }
    this.hanging = new Uint8Array(m);
    for (let q = 0; q < m; q++) {
      const below = crotchY - this.x[q * 3 + 1];
      if (this.free[q] > 0 && below > 0) { this.hanging[q] = 1; this.free[q] = Math.min(st.skirtFree, this.free[q] + below * 1.6); }
    }
    const d: number[] = [], kin: number[] = [];
    for (let q = 0; q < m; q++) (this.free[q] > 0 ? d : kin).push(q);
    this.dyn = Uint32Array.from(d);
    this.kin = Uint32Array.from(kin);
    this.invMass = new Float32Array(m);
    for (const q of d) this.invMass[q] = 1;
    this.activeConstraints();
    this.contact = new Float32Array(d.length * 6).fill(NaN);
  }

  /** Constraints that touch no simulated particle never move anything: only the others are solved. */
  private activeConstraints() {
    const keep = (pairs: Uint32Array, restLen: Float32Array) => {
      const P: number[] = [], L: number[] = [];
      for (let k = 0; k < restLen.length; k++) if (this.free[pairs[k * 2]] > 0 || this.free[pairs[k * 2 + 1]] > 0) { P.push(pairs[k * 2], pairs[k * 2 + 1]); L.push(restLen[k]); }
      return [Uint32Array.from(P), Float32Array.from(L)] as const;
    };
    [this.simEdges, this.simRest] = keep(this.edges, this.rest);
    [this.simBends, this.simBendRest] = keep(this.bends, this.bendRest);
  }

  /** Fix render vertices to their fitted position (e.g. a waistband); rebuilds the solver lists. */
  pin(renderVertices: number[]) {
    for (const r of renderVertices) this.free[this.map[r]] = 0;
    const d: number[] = [], kin: number[] = [];
    for (let q = 0; q < this.particles; q++) (this.free[q] > 0 ? d : kin).push(q);
    this.dyn = Uint32Array.from(d); this.kin = Uint32Array.from(kin);
    this.invMass.fill(0); for (const q of d) this.invMass[q] = 1;
    this.contact = new Float32Array(d.length * 6).fill(NaN);
    this.activeConstraints();
  }

  /** Share of particles that are simulated (0 … 1). */
  get freeShare(): number { return this.particles ? this.dyn.length / this.particles : 0; }

  /**
   * Advances the cloth towards `targets` (render-vertex positions of the fitted garment this frame) and writes the
   * simulated render-vertex positions to `out`. `body` (optional) is the posed body collider.
   */
  step(targets: Float32Array, dt: number, capsules: Capsule[], out: Float32Array, body?: BodyCollider): void {
    const m = this.particles, x = this.x, p = this.p, v = this.v, tgt = this.tgt, prev = this.prevTgt, nrm = this.nrm, free = this.free, s = this.settings;
    prev.set(tgt);
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
    for (let q = 0; q < m; q++) { const l = Math.sqrt((nrm[q * 3]) * (nrm[q * 3]) + (nrm[q * 3 + 1]) * (nrm[q * 3 + 1]) + (nrm[q * 3 + 2]) * (nrm[q * 3 + 2])) || 1; nrm[q * 3] /= l; nrm[q * 3 + 1] /= l; nrm[q * 3 + 2] /= l; }
    if (!this.started || dt <= 0 || dt > 0.25) { x.set(tgt); prev.set(tgt); v.fill(0); this.started = true; this.write(out); if (body) body.pushOut(out, s.thickness); return; }

    // contact planes for the simulated particles (detected once per frame, enforced every substep)
    const D = this.dyn, C = this.contact;
    if (body) for (let k = 0; k < D.length; k++) {
      const o = D[k] * 3, vtx = body.nearest(x[o], x[o + 1], x[o + 2]);
      if (vtx < 0) C[k * 6] = NaN; else body.plane(vtx, C, k * 6);
    }
    const sub = s.substeps, h = Math.min(dt, 1 / 30) / sub, h2 = h * h;
    const aS = s.stretchCompliance / h2, aB = s.bendCompliance / h2;
    const W = this.invMass, K = this.kin;
    const CB = new Float32Array(capsules.length * 6);
    capsules.forEach((c, i) => { CB[i * 6] = Math.min(c.ax, c.bx) - c.r; CB[i * 6 + 1] = Math.max(c.ax, c.bx) + c.r; CB[i * 6 + 2] = Math.min(c.ay, c.by) - c.r; CB[i * 6 + 3] = Math.max(c.ay, c.by) + c.r; CB[i * 6 + 4] = Math.min(c.az, c.bz) - c.r; CB[i * 6 + 5] = Math.max(c.az, c.bz) + c.r; });
    // XPBD distance constraint, one iteration (λ restarts each substep): Δx = −C / (wᵢ + wⱼ + α̃) · ∇C
    const solve = (pairs: Uint32Array, restLen: Float32Array, alpha: number) => {
      for (let k = 0, n = restLen.length; k < n; k++) {
        const i = pairs[k * 2], j = pairs[k * 2 + 1], wi = W[i], wj = W[j];
        if (wi + wj + alpha === 0) continue;
        const a = i * 3, b = j * 3;
        const dx = x[a] - x[b], dy = x[a + 1] - x[b + 1], dz = x[a + 2] - x[b + 2];
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (len < 1e-7) continue;
        const dl = -(len - restLen[k]) / ((wi + wj + alpha) * len);
        const ex = dx * dl, ey = dy * dl, ez = dz * dl;
        x[a] += ex * wi; x[a + 1] += ey * wi; x[a + 2] += ez * wi;
        x[b] -= ex * wj; x[b + 1] -= ey * wj; x[b + 2] -= ez * wj;
      }
    };
    for (let it = 0; it < sub; it++) {
      const damp = Math.max(0, 1 - s.damping * h), tt = (it + 1) / sub;
      // kinematic particles follow the fitted target, interpolated through the frame
      for (let k = 0, n = K.length; k < n; k++) {
        const o = K[k] * 3;
        x[o] = prev[o] + (tgt[o] - prev[o]) * tt; x[o + 1] = prev[o + 1] + (tgt[o + 1] - prev[o + 1]) * tt; x[o + 2] = prev[o + 2] + (tgt[o + 2] - prev[o + 2]) * tt;
      }
      for (let k = 0; k < D.length; k++) {
        const o = D[k] * 3;
        v[o] *= damp; v[o + 1] = v[o + 1] * damp - s.gravity * h; v[o + 2] *= damp;
        p[o] = x[o]; p[o + 1] = x[o + 1]; p[o + 2] = x[o + 2];
        x[o] += v[o] * h; x[o + 1] += v[o + 1] * h; x[o + 2] += v[o + 2] * h;
      }
      solve(this.simEdges, this.simRest, aS);
      solve(this.simBends, this.simBendRest, aB);
      for (let k = 0; k < D.length; k++) {
        const q = D[k], o = q * 3, f = free[q];
        // body contact: stay outside the skin's tangent plane, with friction against sliding along it
        const c = k * 6;
        if (C[c] === C[c]) {
          const nx = C[c + 3], ny = C[c + 4], nz = C[c + 5];
          const d = (x[o] - C[c]) * nx + (x[o + 1] - C[c + 1]) * ny + (x[o + 2] - C[c + 2]) * nz;
          if (d < s.thickness) {
            const push = s.thickness - d;
            x[o] += nx * push; x[o + 1] += ny * push; x[o + 2] += nz * push;
            const mx = x[o] - p[o], my = x[o + 1] - p[o + 1], mz = x[o + 2] - p[o + 2];
            const mn = mx * nx + my * ny + mz * nz, tx = mx - mn * nx, ty = my - mn * ny, tz = mz - mn * nz, tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
            if (tl > 1e-9) { const kf = Math.min(1, (s.friction * push) / tl); x[o] -= tx * kf; x[o + 1] -= ty * kf; x[o + 2] -= tz * kf; }
          }
        }
        // limb capsules (bounding-box early out)
        for (let ci = 0; ci < capsules.length; ci++) {
          const cap = capsules[ci], bb = ci * 6;
          if (x[o] < CB[bb] || x[o] > CB[bb + 1] || x[o + 1] < CB[bb + 2] || x[o + 1] > CB[bb + 3] || x[o + 2] < CB[bb + 4] || x[o + 2] > CB[bb + 5]) continue;
          const ax = cap.bx - cap.ax, ay = cap.by - cap.ay, az = cap.bz - cap.az;
          const px = x[o] - cap.ax, py = x[o + 1] - cap.ay, pz = x[o + 2] - cap.az;
          const aa = ax * ax + ay * ay + az * az;
          const t = aa > 0 ? Math.max(0, Math.min(1, (px * ax + py * ay + pz * az) / aa)) : 0;
          const nx = px - ax * t, ny = py - ay * t, nz = pz - az * t;
          const dd = Math.sqrt(nx * nx + ny * ny + nz * nz);
          if (dd < cap.r && dd > 1e-6) { const kk = (cap.r - dd) / dd; x[o] += nx * kk; x[o + 1] += ny * kk; x[o + 2] += nz * kk; }
        }
        // backstop: not behind the fitted surface
        let dx = x[o] - tgt[o], dy = x[o + 1] - tgt[o + 1], dz = x[o + 2] - tgt[o + 2];
        const along = dx * nrm[o] + dy * nrm[o + 1] + dz * nrm[o + 2];
        if (!this.hanging[q] && along < -s.backstop) { const kk = -s.backstop - along; x[o] += nrm[o] * kk; x[o + 1] += nrm[o + 1] * kk; x[o + 2] += nrm[o + 2] * kk; dx += nrm[o] * kk; dy += nrm[o + 1] * kk; dz += nrm[o + 2] * kk; }
        // tether: maximum distance from the fitted position
        const dd = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dd > f) { const kk = f / dd; x[o] = tgt[o] + dx * kk; x[o + 1] = tgt[o + 1] + dy * kk; x[o + 2] = tgt[o + 2] + dz * kk; }
        // hanging fabric swings but does not get longer than it was cut
        if (this.hanging[q] && x[o + 1] < tgt[o + 1] - 2.5) x[o + 1] = tgt[o + 1] - 2.5;
        if (x[o + 1] < 0.2) x[o + 1] = 0.2;
      }
      for (let k = 0; k < D.length; k++) { const o = D[k] * 3; v[o] = (x[o] - p[o]) / h; v[o + 1] = (x[o + 1] - p[o + 1]) / h; v[o + 2] = (x[o + 2] - p[o + 2]) / h; }
    }
    this.write(out);
    if (body) body.pushOut(out, s.thickness);
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
  /** Number of bending constraints (adjacent triangle pairs). */
  get bendCount(): number { return this.bendRest.length; }
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

/** Body triangles of a Human Studio asset in base-vertex indices (for the collider). */
export function bodyTriangles(bodyIndex: Uint32Array, orig: Uint32Array): Uint32Array {
  const t = new Uint32Array(bodyIndex.length);
  for (let i = 0; i < bodyIndex.length; i++) t[i] = orig[bodyIndex[i]];
  return t;
}
