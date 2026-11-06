import { normalizeHex, relativeLuminance } from "../color";

/**
 * Recolour a graphic with a whole palette in one step: the artwork's colours and the palette's
 * colours are both ordered dark → light and matched in rank, so shadows stay shadows and
 * highlights stay highlights. Returns a `colorMap` (original → replacement) for the layer.
 */
export function paletteSwapMap(assetColors: string[], paletteColors: string[], shift = 0): Record<string, string> {
  const a = [...new Set(assetColors.map(normalizeHex))].sort((x, y) => relativeLuminance(x) - relativeLuminance(y));
  const p = [...new Set(paletteColors.map(normalizeHex))].sort((x, y) => relativeLuminance(x) - relativeLuminance(y));
  if (!a.length || !p.length) return {};
  const out: Record<string, string> = {};
  a.forEach((c, i) => {
    const idx = a.length === 1 ? Math.floor(p.length / 2) : Math.round((i * (p.length - 1)) / (a.length - 1));
    out[c] = p[(idx + shift) % p.length];
  });
  return out;
}
