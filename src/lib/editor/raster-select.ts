/**
 * Pixel-based selections for Atelier Pro: magic wand, colour range and AI
 * object selection. The layer is rasterised in the browser, a binary mask is
 * computed, and the mask is traced back into vector rings (marching squares +
 * Douglas–Peucker) stored as a layer-mask "path" shape — so the selection
 * stays non-destructive and renders identically in 2D, 3D and print.
 */
import type { Layer } from "../garment/schema";
import type { MaskShape } from "../garment/layer-fx";

export interface Raster { data: Uint8ClampedArray; width: number; height: number }

/* ---------------------------------------------------------- algorithms */

const channelDist = (d: Uint8ClampedArray, i: number, s: number[]) => {
  // Fully transparent pixels all count as "empty" regardless of their colour.
  if (d[i + 3] < 8 && s[3] < 8) return 0;
  return Math.max(Math.abs(d[i] - s[0]), Math.abs(d[i + 1] - s[1]), Math.abs(d[i + 2] - s[2]), Math.abs(d[i + 3] - s[3]));
};

/** Magic wand: pixels within `tolerance` (0–255 per channel) of the seed, contiguous or global. */
export function magicWand(r: Raster, x: number, y: number, tolerance: number, contiguous = true): Uint8Array {
  const { data, width: W, height: H } = r;
  const out = new Uint8Array(W * H);
  const sx = Math.max(0, Math.min(W - 1, Math.round(x)));
  const sy = Math.max(0, Math.min(H - 1, Math.round(y)));
  const i0 = (sy * W + sx) * 4;
  const seed = [data[i0], data[i0 + 1], data[i0 + 2], data[i0 + 3]];
  if (!contiguous) {
    for (let p = 0; p < W * H; p++) if (channelDist(data, p * 4, seed) <= tolerance) out[p] = 1;
    return out;
  }
  const stack = [sy * W + sx];
  out[sy * W + sx] = 1;
  while (stack.length) {
    const p = stack.pop()!;
    const px = p % W;
    const py = (p - px) / W;
    for (const [nx, ny] of [[px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]]) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const q = ny * W + nx;
      if (out[q] || channelDist(data, q * 4, seed) > tolerance) continue;
      out[q] = 1;
      stack.push(q);
    }
  }
  return out;
}

/** Colour range: every pixel whose colour is within `fuzziness` of `hex` (alpha must be visible). */
export function colorRange(r: Raster, hex: string, fuzziness: number): Uint8Array {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const out = new Uint8Array(r.width * r.height);
  for (let p = 0, i = 0; p < out.length; p++, i += 4) {
    if (r.data[i + 3] < 32) continue;
    if (Math.max(Math.abs(r.data[i] - c[0]), Math.abs(r.data[i + 1] - c[1]), Math.abs(r.data[i + 2] - c[2])) <= fuzziness) out[p] = 1;
  }
  return out;
}

/** Ramer–Douglas–Peucker simplification of a closed or open polyline. */
export function simplify(pts: [number, number][], eps: number): [number, number][] {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-9;
    let best = -1, bestD = eps;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/**
 * Trace the boundaries of a binary mask (marching squares on pixel centres).
 * Returns closed rings in pixel units; holes come back as separate rings and
 * are handled by the even-odd fill rule.
 */
export function traceMask(mask: Uint8Array, W: number, H: number): [number, number][][] {
  const v = (x: number, y: number) => (x >= 0 && y >= 0 && x < W && y < H ? mask[y * W + x] : 0);
  // Edge midpoints are encoded on a doubled grid: key = X * (2H + 4) + Y.
  const K = 2 * H + 4;
  const next = new Map<number, number>();
  const key = (X: number, Y: number) => (X + 2) * K + (Y + 2);
  const add = (a: [number, number], b: [number, number]) => next.set(key(a[0], a[1]), key(b[0], b[1]));
  for (let y = -1; y < H; y++) {
    for (let x = -1; x < W; x++) {
      const tl = v(x, y), tr = v(x + 1, y), br = v(x + 1, y + 1), bl = v(x, y + 1);
      const c = tl * 8 + tr * 4 + br * 2 + bl;
      if (c === 0 || c === 15) continue;
      const T: [number, number] = [2 * x + 1, 2 * y];
      const R: [number, number] = [2 * x + 2, 2 * y + 1];
      const B: [number, number] = [2 * x + 1, 2 * y + 2];
      const L: [number, number] = [2 * x, 2 * y + 1];
      // Segments oriented so the inside is on the right (clockwise rings), saddles split.
      switch (c) {
        case 1: add(L, B); break;
        case 2: add(B, R); break;
        case 3: add(L, R); break;
        case 4: add(R, T); break;
        case 5: add(L, T); add(R, B); break;
        case 6: add(B, T); break;
        case 7: add(L, T); break;
        case 8: add(T, L); break;
        case 9: add(T, B); break;
        case 10: add(T, R); add(B, L); break;
        case 11: add(T, R); break;
        case 12: add(R, L); break;
        case 13: add(R, B); break;
        case 14: add(B, L); break;
      }
    }
  }
  const rings: [number, number][][] = [];
  const decode = (k: number): [number, number] => [Math.floor(k / K) - 2, (k % K) - 2];
  for (const start of [...next.keys()]) {
    if (!next.has(start)) continue;
    const ring: [number, number][] = [];
    let k = start;
    for (let guard = 0; guard < 4_000_000; guard++) {
      const n = next.get(k);
      if (n === undefined) break;
      next.delete(k);
      const [X, Y] = decode(k);
      ring.push([X / 2, Y / 2]);
      k = n;
      if (k === start) break;
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

const ringArea = (r: [number, number][]) => Math.abs(r.reduce((a, [x, y], i) => { const [x2, y2] = r[(i + 1) % r.length]; return a + x * y2 - x2 * y; }, 0)) / 2;

/** Binary mask → layer-mask "path" shape in normalised layer coordinates. */
export function maskToShape(mask: Uint8Array, W: number, H: number, op: "add" | "subtract" = "add"): MaskShape | null {
  let rings = traceMask(mask, W, H).filter((r) => ringArea(r) >= 3).sort((a, b) => ringArea(b) - ringArea(a)).slice(0, 48);
  if (!rings.length) return null;
  // Closed rings: split at the point farthest from the start, simplify both halves.
  const closed = (r: [number, number][], eps: number) => {
    let far = 0, best = -1;
    for (let i = 1; i < r.length; i++) { const d = Math.hypot(r[i][0] - r[0][0], r[i][1] - r[0][1]); if (d > best) { best = d; far = i; } }
    const a = simplify(r.slice(0, far + 1), eps);
    const b = simplify([...r.slice(far), r[0]], eps);
    return [...a, ...b.slice(1, -1)];
  };
  let eps = 0.6;
  let simplified = rings.map((r) => closed(r, eps));
  while (simplified.some((r) => r.length > 1200) && eps < 8) {
    eps *= 1.6;
    simplified = rings.map((r) => closed(r, eps));
  }
  rings = simplified.filter((r) => r.length >= 3);
  const round = (v: number) => Math.round(v * 10000) / 10000;
  return {
    kind: "path", op, x: 0, y: 0, w: 1, h: 1, points: [], size: 0.05, feather: 0,
    rings: rings.map((r) => r.flatMap(([x, y]) => [round((x + 0.5) / W), round((y + 0.5) / H)])),
  };
}

export const maskCoverage = (m: Uint8Array) => m.reduce((a, v) => a + v, 0) / Math.max(1, m.length);

/* ------------------------------------------------------- browser-only */

/** Render a layer's own pixels (no mask, warp or clipping; unflipped) over its box. */
export async function rasterizeLayer(markup: (bare: Layer) => string, l: Layer, maxPx = 512, fontCss = ""): Promise<Raster> {
  const scale = maxPx / Math.max(l.width, l.height);
  const W = Math.max(8, Math.round(l.width * scale));
  const H = Math.max(8, Math.round(l.height * scale));
  const bare = { ...l, x: 0, y: 0, rotation: 0, flipX: false, flipY: false, mask: null, warp: null, clip: false, opacity: 1, blendMode: "normal", visible: true } as Layer;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="${-l.width / 2} ${-l.height / 2} ${l.width} ${l.height}">${fontCss ? `<style>${fontCss}</style>` : ""}${markup(bare)}</svg>`;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, W, H);
  return { data: ctx.getImageData(0, 0, W, H).data, width: W, height: H };
}

let segmenter: Promise<import("@mediapipe/tasks-vision").InteractiveSegmenter> | null = null;

/**
 * AI object selection with MediaPipe's on-device MagicTouch interactive
 * segmenter: the object under the tapped point is segmented locally.
 */
export async function aiObjectSelect(r: Raster, x: number, y: number): Promise<Uint8Array> {
  const { loadVision, resolveModel } = await import("../client/cv-assets");
  segmenter ??= (async () => {
    const { vision, fileset } = await loadVision();
    return vision.InteractiveSegmenter.createFromOptions(fileset, { baseOptions: { modelAssetPath: await resolveModel("magicTouch"), delegate: "CPU" }, outputConfidenceMasks: true, outputCategoryMask: false });
  })().catch((e) => {
    segmenter = null;
    throw e;
  });
  const seg = await segmenter;
  // Flatten transparent areas onto white so the model sees a normal photo.
  const flat = new Uint8ClampedArray(r.data.length);
  for (let i = 0; i < r.data.length; i += 4) {
    const a = r.data[i + 3] / 255;
    flat[i] = r.data[i] * a + 255 * (1 - a);
    flat[i + 1] = r.data[i + 1] * a + 255 * (1 - a);
    flat[i + 2] = r.data[i + 2] * a + 255 * (1 - a);
    flat[i + 3] = 255;
  }
  const image = new ImageData(flat, r.width, r.height);
  return new Promise<Uint8Array>((resolve, reject) => {
    try {
      seg.segment(image, { keypoint: { x: x / r.width, y: y / r.height } }, (res) => {
        const masks = res.confidenceMasks ?? [];
        if (!masks.length) return reject(new Error("The AI selection returned no mask"));
        const conf = masks[masks.length - 1].getAsFloat32Array();
        const out = new Uint8Array(r.width * r.height);
        for (let i = 0; i < out.length; i++) out[i] = conf[i] > 0.5 ? 1 : 0;
        // Model conventions differ between versions: make sure the tapped point is inside.
        const at = Math.round(y) * r.width + Math.round(x);
        if (!out[at]) for (let i = 0; i < out.length; i++) out[i] = out[i] ? 0 : 1;
        resolve(out);
      });
    } catch (e) {
      reject(e);
    }
  });
}
