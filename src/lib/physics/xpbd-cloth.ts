/**
 * XPBD cloth solver (extended position-based dynamics with small substeps, after Macklin et al., "XPBD" 2016 and
 * "Small Steps in Physics Simulation" 2019; written from the papers). Pure TypeScript, no DOM: runs in a Web Worker
 * or in tests.
 *
 * Constraints: edge distance (stretch / shear along triangle edges) and bending (distance between the two vertices
 * opposite a shared edge). Forces: gravity, velocity damping. Collisions: capsules (from a skeleton), with friction,
 * and an optional ground plane. Pinned particles (inverse mass 0) do not move.
 *
 * Units are whatever the caller uses (ModVerse: centimetres, seconds). Compliance is the inverse stiffness in XPBD
 * terms; per-fabric values must come from measured data when they exist (see docs/HUMAN_AND_PHYSICS_SOURCES.md).
 */

export interface ClothParams {
  /** Edge compliance (0 = inextensible). */
  stretchCompliance: number;
  /** Bending compliance (larger = softer folds). */
  bendCompliance: number;
  /** Velocity damping per second (0..1+). */
  damping: number;
  /** Coulomb-style friction against colliders (0 = slippery, 1 = sticky). */
  friction: number;
  gravity: [number, number, number];
  /** Collision margin (half the fabric thickness plus a little air). */
  thickness: number;
  substeps: number;
  /** Optional ground plane height (y). */
  groundY?: number;
}

export interface Capsule { a: [number, number, number]; b: [number, number, number]; r: number }

export const DEFAULT_CLOTH: ClothParams = { stretchCompliance: 0, bendCompliance: 0.5, damping: 0.6, friction: 0.4, gravity: [0, -981, 0], thickness: 0.4, substeps: 12 };

export class XpbdCloth {
  readonly positions: Float32Array;
  private prev: Float32Array;
  private vel: Float32Array;
  private invMass: Float32Array;
  private edges: Uint32Array; // pairs
  private edgeRest: Float32Array;
  private bends: Uint32Array; // pairs (opposite vertices)
  private bendRest: Float32Array;
  constructor(positions: Float32Array, triangles: Uint32Array, readonly params: ClothParams, pinned?: ArrayLike<number>) {
    const n = positions.length / 3;
    this.positions = positions.slice();
    this.prev = positions.slice();
    this.vel = new Float32Array(positions.length);
    // particle mass from the area of its triangles (uniform density)
    const mass = new Float32Array(n);
    for (let t = 0; t < triangles.length; t += 3) {
      const [a, b, c] = [triangles[t], triangles[t + 1], triangles[t + 2]];
      const area = triArea(positions, a, b, c);
      mass[a] += area / 3; mass[b] += area / 3; mass[c] += area / 3;
    }
    this.invMass = new Float32Array(n);
    for (let i = 0; i < n; i++) this.invMass[i] = mass[i] > 0 ? 1 / mass[i] : 0;
    if (pinned) for (let k = 0; k < pinned.length; k++) this.invMass[pinned[k]] = 0;
    // unique edges, and the opposite-vertex pairs across each shared edge (bending)
    const edgeMap = new Map<number, number>(); // key → opposite vertex of the first triangle
    const e: number[] = [], bnd: number[] = [];
    const key = (i: number, j: number) => (i < j ? i * n + j : j * n + i);
    for (let t = 0; t < triangles.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const i = triangles[t + k], j = triangles[t + ((k + 1) % 3)], o = triangles[t + ((k + 2) % 3)];
        const kk = key(i, j);
        const other = edgeMap.get(kk);
        if (other === undefined) { edgeMap.set(kk, o); e.push(i, j); }
        else if (other >= 0) { bnd.push(other, o); edgeMap.set(kk, -1); }
      }
    }
    this.edges = Uint32Array.from(e);
    this.edgeRest = Float32Array.from({ length: e.length / 2 }, (_, k) => dist(positions, e[k * 2], e[k * 2 + 1]));
    this.bends = Uint32Array.from(bnd);
    this.bendRest = Float32Array.from({ length: bnd.length / 2 }, (_, k) => dist(positions, bnd[k * 2], bnd[k * 2 + 1]));
  }

  get edgeCount() { return this.edges.length / 2; }
  get bendCount() { return this.bends.length / 2; }

  /** Largest relative edge stretch (for quality checks). */
  maxStretch(): number {
    let m = 0;
    for (let k = 0; k < this.edgeRest.length; k++) m = Math.max(m, Math.abs(dist(this.positions, this.edges[k * 2], this.edges[k * 2 + 1]) / this.edgeRest[k] - 1));
    return m;
  }

  /** Advances the simulation by dt seconds, split into the configured substeps. */
  step(dt: number, colliders: Capsule[] = []): void {
    const { substeps, gravity, damping } = this.params;
    const h = dt / substeps;
    const x = this.positions, p = this.prev, v = this.vel, w = this.invMass;
    const n = x.length / 3;
    for (let s = 0; s < substeps; s++) {
      const damp = Math.max(0, 1 - damping * h);
      for (let i = 0; i < n; i++) {
        if (w[i] === 0) continue;
        for (let c = 0; c < 3; c++) {
          const k = i * 3 + c;
          v[k] = v[k] * damp + gravity[c] * h;
          p[k] = x[k];
          x[k] += v[k] * h;
        }
      }
      this.solvePairs(this.edges, this.edgeRest, this.params.stretchCompliance / (h * h));
      this.solvePairs(this.bends, this.bendRest, this.params.bendCompliance / (h * h));
      this.collide(colliders);
      for (let k = 0; k < x.length; k++) v[k] = (x[k] - p[k]) / h;
    }
  }

  private solvePairs(pairs: Uint32Array, rest: Float32Array, alpha: number) {
    const x = this.positions, w = this.invMass;
    for (let k = 0; k < rest.length; k++) {
      const i = pairs[k * 2], j = pairs[k * 2 + 1];
      const wsum = w[i] + w[j];
      if (wsum === 0) continue;
      const dx = x[i * 3] - x[j * 3], dy = x[i * 3 + 1] - x[j * 3 + 1], dz = x[i * 3 + 2] - x[j * 3 + 2];
      const len = Math.hypot(dx, dy, dz);
      if (len < 1e-9) continue;
      const C = len - rest[k];
      const dl = -C / (wsum + alpha);
      const sx = (dx / len) * dl, sy = (dy / len) * dl, sz = (dz / len) * dl;
      x[i * 3] += sx * w[i]; x[i * 3 + 1] += sy * w[i]; x[i * 3 + 2] += sz * w[i];
      x[j * 3] -= sx * w[j]; x[j * 3 + 1] -= sy * w[j]; x[j * 3 + 2] -= sz * w[j];
    }
  }

  private collide(colliders: Capsule[]) {
    const x = this.positions, p = this.prev, w = this.invMass;
    const { thickness, friction, groundY } = this.params;
    const n = x.length / 3;
    for (let i = 0; i < n; i++) {
      if (w[i] === 0) continue;
      for (const cap of colliders) {
        // closest point on the capsule axis
        const ax = cap.b[0] - cap.a[0], ay = cap.b[1] - cap.a[1], az = cap.b[2] - cap.a[2];
        const px = x[i * 3] - cap.a[0], py = x[i * 3 + 1] - cap.a[1], pz = x[i * 3 + 2] - cap.a[2];
        const aa = ax * ax + ay * ay + az * az;
        const t = aa > 0 ? Math.max(0, Math.min(1, (px * ax + py * ay + pz * az) / aa)) : 0;
        const cx = cap.a[0] + ax * t, cy = cap.a[1] + ay * t, cz = cap.a[2] + az * t;
        let nx = x[i * 3] - cx, ny = x[i * 3 + 1] - cy, nz = x[i * 3 + 2] - cz;
        const d = Math.hypot(nx, ny, nz);
        const r = cap.r + thickness;
        if (d >= r) continue;
        if (d < 1e-9) { nx = 0; ny = 1; nz = 0; } else { nx /= d; ny /= d; nz /= d; }
        // push out to the surface, then remove part of the tangential motion of this substep (friction)
        const pen = r - d;
        x[i * 3] += nx * pen; x[i * 3 + 1] += ny * pen; x[i * 3 + 2] += nz * pen;
        this.applyFriction(i, nx, ny, nz, friction, p);
      }
      if (groundY !== undefined && x[i * 3 + 1] < groundY + thickness) {
        x[i * 3 + 1] = groundY + thickness;
        this.applyFriction(i, 0, 1, 0, friction, p);
      }
    }
  }

  private applyFriction(i: number, nx: number, ny: number, nz: number, mu: number, p: Float32Array) {
    const x = this.positions;
    const dx = x[i * 3] - p[i * 3], dy = x[i * 3 + 1] - p[i * 3 + 1], dz = x[i * 3 + 2] - p[i * 3 + 2];
    const dn = dx * nx + dy * ny + dz * nz;
    const tx = dx - dn * nx, ty = dy - dn * ny, tz = dz - dn * nz;
    const k = Math.max(0, Math.min(1, mu));
    x[i * 3] -= tx * k; x[i * 3 + 1] -= ty * k; x[i * 3 + 2] -= tz * k;
  }
}

function dist(p: Float32Array, i: number, j: number) {
  return Math.hypot(p[i * 3] - p[j * 3], p[i * 3 + 1] - p[j * 3 + 1], p[i * 3 + 2] - p[j * 3 + 2]);
}
function triArea(p: Float32Array, a: number, b: number, c: number) {
  const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
  const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
  return 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
}

/** A rectangular grid of particles (tests, fabric swatches): w × h cells of `size`, in the XY plane at z. */
export function clothGrid(w: number, h: number, size: number, origin: [number, number, number] = [0, 0, 0]): { positions: Float32Array; triangles: Uint32Array } {
  const positions = new Float32Array((w + 1) * (h + 1) * 3);
  for (let j = 0; j <= h; j++) for (let i = 0; i <= w; i++) positions.set([origin[0] + i * size, origin[1] - j * size, origin[2]], (j * (w + 1) + i) * 3);
  const tris: number[] = [];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const a = j * (w + 1) + i, b = a + 1, c = a + w + 1, d = c + 1;
    tris.push(a, c, b, b, c, d);
  }
  return { positions, triangles: Uint32Array.from(tris) };
}
