/**
 * Garment-aware artwork placement: copy a layer onto other garment regions
 * (front, back, sleeves, collar, cuffs, pocket, yoke). The copy keeps the
 * artwork's physical size, colours, rotation and typography whenever it fits;
 * it is only scaled down (uniformly) when the target print area is smaller,
 * and it keeps its relative position inside the print area.
 */
import { availableZones, duplicateLayer } from "./design";
import { printableArea } from "./panels";
import { computeMeasurements } from "./sizing";
import type { DesignConfig, Layer } from "./schema";
import type { Zone } from "./types";

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const SLEEVES: Zone[] = ["sleeveLeft", "sleeveRight"];
export const REGION_NAMES: Record<Zone, string> = { front: "front", back: "back", sleeveLeft: "left sleeve", sleeveRight: "right sleeve", collar: "collar", cuffs: "cuff", pocket: "pocket", yoke: "yoke" };

export function copyLayerToZones(config: DesignConfig, layer: Layer, zones: Zone[], opts: { mirrorSleeves?: boolean } = {}): { layers: Layer[]; scaled: Zone[] } {
  const m = computeMeasurements(config);
  const allowed = availableZones(config);
  const src = printableArea(m, layer.zone, config.garmentType, config.construction);
  const ru = clamp((layer.x - src.x0) / Math.max(0.01, src.x1 - src.x0), 0, 1);
  const rv = clamp((layer.y - src.y0) / Math.max(0.01, src.y1 - src.y0), 0, 1);
  const layers: Layer[] = [];
  const scaled: Zone[] = [];
  for (const z of zones) {
    if (z === layer.zone || !allowed.includes(z)) continue;
    const a = printableArea(m, z, config.garmentType, config.construction);
    const scale = Math.min(1, (a.x1 - a.x0) / layer.width, (a.y1 - a.y0) / layer.height);
    if (scale < 0.999) scaled.push(z);
    const w = layer.width * scale;
    const h = layer.height * scale;
    const mirror = !!opts.mirrorSleeves && SLEEVES.includes(layer.zone) && SLEEVES.includes(z);
    const u = mirror ? 1 - ru : ru;
    const copy = {
      ...duplicateLayer(layer),
      zone: z,
      name: `${layer.name} · ${REGION_NAMES[z]}`.slice(0, 80),
      x: r3(clamp(a.x0 + u * (a.x1 - a.x0), a.x0 + w / 2, a.x1 - w / 2)),
      y: r3(clamp(a.y0 + rv * (a.y1 - a.y0), a.y0 + h / 2, a.y1 - h / 2)),
      width: r3(w),
      height: r3(h),
      rotation: mirror ? -layer.rotation : layer.rotation,
      // Text is never mirrored (it would read backwards); artwork is.
      flipX: mirror && layer.type !== "text" ? !layer.flipX : layer.flipX,
      groupId: null,
    } as Layer;
    if (copy.type === "text" && layer.type === "text") copy.fontSize = r3(Math.max(0.3, layer.fontSize * scale));
    layers.push(copy);
  }
  return { layers, scaled };
}
