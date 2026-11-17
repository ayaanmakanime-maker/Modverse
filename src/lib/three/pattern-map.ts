/**
 * All-over print preview: a repeating pattern on a garment, tiled at its real size.
 *  · `cmPerUv`: how many cm of garment surface one unit of UV spans (median over the triangles, so UV islands at odd
 *    scales do not skew it). Garment meshes are in cm.
 *  · The pattern is composited on the fabric colour (the print ground) once, so transparent parts of a pattern show
 *    the fabric, then repeated `scaleCm` wide (its height follows the image's aspect ratio) and rotated.
 */
import * as THREE from "three";

export function cmPerUv(positions: ArrayLike<number>, uv: ArrayLike<number>, index: ArrayLike<number> | null): number {
  const n = index ? index.length : positions.length / 3;
  const at = (k: number) => (index ? index[k] : k);
  const ratios: number[] = [];
  const step = Math.max(3, Math.floor(n / 3 / 4000) * 3); // a sample of up to ~4000 triangles
  for (let t = 0; t + 2 < n; t += step) {
    const a = at(t), b = at(t + 1), c = at(t + 2);
    const ux = positions[b * 3] - positions[a * 3], uy = positions[b * 3 + 1] - positions[a * 3 + 1], uz = positions[b * 3 + 2] - positions[a * 3 + 2];
    const vx = positions[c * 3] - positions[a * 3], vy = positions[c * 3 + 1] - positions[a * 3 + 1], vz = positions[c * 3 + 2] - positions[a * 3 + 2];
    const area3 = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    const s1 = uv[b * 2] - uv[a * 2], t1 = uv[b * 2 + 1] - uv[a * 2 + 1], s2 = uv[c * 2] - uv[a * 2], t2 = uv[c * 2 + 1] - uv[a * 2 + 1];
    const areaUv = Math.abs(s1 * t2 - s2 * t1);
    if (area3 > 1e-6 && areaUv > 1e-9) ratios.push(Math.sqrt(area3 / areaUv));
  }
  if (!ratios.length) return 100;
  ratios.sort((x, y) => x - y);
  return ratios[Math.floor(ratios.length / 2)];
}

const images = new Map<string, Promise<HTMLImageElement>>();
function image(url: string): Promise<HTMLImageElement> {
  let p = images.get(url);
  if (!p) {
    p = new Promise((res, rej) => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => res(im); im.onerror = () => rej(new Error("pattern")); im.src = url; });
    p.catch(() => images.delete(url));
    images.set(url, p);
  }
  return p;
}

export interface PatternSpec { url: string; ground: string; scaleCm: number; rotation: number }

/** A repeating texture for `spec` on a mesh with `cmPerUv`; it fills in once the image has loaded (calls `onLoad`). */
export function patternTexture(spec: PatternSpec, cmPerUvValue: number, onLoad?: () => void): THREE.CanvasTexture {
  const canvas = typeof document !== "undefined" ? document.createElement("canvas") : (null as unknown as HTMLCanvasElement);
  canvas.width = canvas.height = 4;
  const g = canvas.getContext("2d")!;
  g.fillStyle = spec.ground; g.fillRect(0, 0, 4, 4);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.center.set(0.5, 0.5);
  tex.rotation = (-spec.rotation * Math.PI) / 180;
  const fit = (aspect: number) => tex.repeat.set(cmPerUvValue / spec.scaleCm, cmPerUvValue / (spec.scaleCm * aspect));
  fit(1);
  image(spec.url).then((im) => {
    const k = Math.min(1, 1024 / Math.max(im.naturalWidth, im.naturalHeight));
    canvas.width = Math.max(4, Math.round(im.naturalWidth * k)); canvas.height = Math.max(4, Math.round(im.naturalHeight * k));
    g.fillStyle = spec.ground; g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(im, 0, 0, canvas.width, canvas.height);
    fit(canvas.height / canvas.width);
    tex.needsUpdate = true;
    onLoad?.();
  }).catch(() => undefined);
  return tex;
}
