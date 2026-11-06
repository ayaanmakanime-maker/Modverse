/**
 * ModVerse typography assets — curated, editable text styles built only from
 * the bundled OFL fonts. They appear in the Creative Library ("Typography")
 * and the Text panel, can be dragged onto any compatible garment surface, and
 * stay fully editable after placement (they are ordinary text layers).
 */
import type { PlacementPreset } from "../garment/panels";
import type { DesignConfig, TextLayer } from "../garment/schema";
import { createTextLayer } from "../garment/design";

export type TypographyCategory = "names-numbers" | "slogans" | "monograms" | "badges" | "script" | "indic" | "effects";

export const TYPOGRAPHY_CATEGORIES: { id: TypographyCategory; label: string }[] = [
  { id: "names-numbers", label: "Names & numbers" },
  { id: "slogans", label: "Slogans" },
  { id: "monograms", label: "Monograms & initials" },
  { id: "badges", label: "Badges & circular" },
  { id: "script", label: "Script & signature" },
  { id: "indic", label: "Indian scripts" },
  { id: "effects", label: "Layered effects" },
];

export interface TypographyPreset {
  id: string;
  name: string;
  category: TypographyCategory;
  text: string;
  /** Default placement when added without dropping at a point. */
  preset: PlacementPreset;
  style: Partial<TextLayer>;
  tags: string[];
}

const off = { enabled: false, color: "#000000", width: 0.1 } as const;

export const TYPOGRAPHY_PRESETS: TypographyPreset[] = [
  { id: "TY_001", name: "Name across the back", category: "names-numbers", text: "SHARMA", preset: "upper-back", tags: ["name", "jersey"], style: { fontFamily: "Bebas Neue", fontWeight: 400, letterSpacing: 0.08, textTransform: "uppercase" } },
  { id: "TY_002", name: "Varsity number", category: "names-numbers", text: "07", preset: "full-back", tags: ["number", "varsity", "sport"], style: { fontFamily: "Oswald", fontWeight: 700, fontSize: 18, outline: { enabled: true, color: "#F3EFE8", width: 0.25 } } },
  { id: "TY_003", name: "Arched team name", category: "names-numbers", text: "MUMBAI", preset: "upper-back", tags: ["team", "arch", "varsity"], style: { fontFamily: "Oswald", fontWeight: 700, textTransform: "uppercase", curve: { mode: "arc", amount: 30 }, letterSpacing: 0.06 } },
  { id: "TY_004", name: "Arched slogan", category: "slogans", text: "YOUR WORLD", preset: "center-chest", tags: ["slogan", "arch"], style: { fontFamily: "Archivo Black", fontWeight: 400, curve: { mode: "arc", amount: 45 } } },
  { id: "TY_005", name: "Editorial serif quote", category: "slogans", text: "Made in\nslow time", preset: "center-chest", tags: ["quote", "serif", "editorial"], style: { fontFamily: "Playfair Display", fontWeight: 700, italic: true, lineHeight: 1.05, textTransform: "none" } },
  { id: "TY_006", name: "Wide-tracked caption", category: "slogans", text: "ATELIER EDITION", preset: "center-chest", tags: ["minimal", "caption", "luxury"], style: { fontFamily: "Montserrat", fontWeight: 500, letterSpacing: 0.45, textTransform: "uppercase", fontSize: 1.1 } },
  { id: "TY_007", name: "Title-case headline", category: "slogans", text: "the art of the everyday", preset: "center-chest", tags: ["title case", "headline"], style: { fontFamily: "DM Serif Display", fontWeight: 400, textTransform: "title" } },
  { id: "TY_008", name: "Classic serif monogram", category: "monograms", text: "AK", preset: "left-chest", tags: ["monogram", "initials", "serif"], style: { fontFamily: "Cormorant Garamond", fontWeight: 700, letterSpacing: 0.02 } },
  { id: "TY_009", name: "Cuff monogram", category: "monograms", text: "R.S.", preset: "cuff", tags: ["monogram", "cuff", "shirt", "embroidery"], style: { fontFamily: "Cormorant Garamond", fontWeight: 600, italic: true, method: "embroidery" } },
  { id: "TY_010", name: "Circular badge", category: "badges", text: "MODVERSE • ORIGINAL • ", preset: "left-chest", tags: ["badge", "circle", "round"], style: { fontFamily: "Space Grotesk", fontWeight: 700, curve: { mode: "circle", amount: 100 }, fontSize: 0.9 } },
  { id: "TY_011", name: "Boxed label", category: "badges", text: "LIMITED", preset: "left-chest", tags: ["label", "box"], style: { fontFamily: "Inter", fontWeight: 800, letterSpacing: 0.18, textTransform: "uppercase", background: { enabled: true, color: "#F3EFE8", padding: 0.4, radius: 0.1 }, color: "#0B0B0B" } },
  { id: "TY_012", name: "Vertical spine", category: "badges", text: "TOKYO", preset: "left-sleeve", tags: ["vertical", "sleeve", "streetwear"], style: { fontFamily: "Bebas Neue", fontWeight: 400, curve: { mode: "vertical", amount: 0 } } },
  { id: "TY_013", name: "Script signature", category: "script", text: "Mumbai", preset: "left-chest", tags: ["script", "signature"], style: { fontFamily: "Dancing Script", fontWeight: 700 } },
  { id: "TY_014", name: "Brush slogan", category: "script", text: "Stay wild", preset: "center-chest", tags: ["brush", "handwritten"], style: { fontFamily: "Permanent Marker", fontWeight: 400, skewX: -6 } },
  { id: "TY_015", name: "हिन्दी headline", category: "indic", text: "अपनी दुनिया", preset: "center-chest", tags: ["hindi", "devanagari"], style: { fontFamily: "Noto Sans Devanagari", fontWeight: 700 } },
  { id: "TY_016", name: "தமிழ் slogan", category: "indic", text: "வணக்கம்", preset: "center-chest", tags: ["tamil"], style: { fontFamily: "Noto Sans Tamil", fontWeight: 700 } },
  { id: "TY_017", name: "বাংলা headline", category: "indic", text: "আমার পৃথিবী", preset: "center-chest", tags: ["bengali", "bangla"], style: { fontFamily: "Noto Sans Bengali", fontWeight: 700 } },
  { id: "TY_018", name: "Retro extrude", category: "effects", text: "RETRO", preset: "center-chest", tags: ["3d", "extrude", "retro", "layered"], style: { fontFamily: "Bungee", fontWeight: 400, color: "#F3EFE8", effects: [{ kind: "extrude", color: "#C2410C", width: 0, offsetX: 0.5, offsetY: 0.5, blur: 0, opacity: 1 }] } },
  { id: "TY_019", name: "Double outline", category: "effects", text: "NEON", preset: "center-chest", tags: ["outline", "layered", "double"], style: { fontFamily: "Righteous", fontWeight: 400, color: "#0B0B0B", outline: { enabled: true, color: "#F3EFE8", width: 0.12 }, effects: [{ kind: "stroke", color: "#E11D48", width: 0.3, offsetX: 0, offsetY: 0, blur: 0, opacity: 1 }] } },
  { id: "TY_020", name: "Offset print", category: "effects", text: "ECHO", preset: "center-chest", tags: ["offset", "misregistration", "layered"], style: { fontFamily: "Anton", fontWeight: 400, color: "#F3EFE8", outline: off, effects: [{ kind: "shadow", color: "#2563EB", width: 0, offsetX: 0.35, offsetY: 0.2, blur: 0, opacity: 0.9 }, { kind: "shadow", color: "#E11D48", width: 0, offsetX: -0.35, offsetY: -0.2, blur: 0, opacity: 0.9 }] } },
];

export const TYPOGRAPHY_BY_ID = new Map(TYPOGRAPHY_PRESETS.map((p) => [p.id, p]));

export function searchTypography(q: string, category?: TypographyCategory | ""): TypographyPreset[] {
  const s = q.trim().toLowerCase();
  return TYPOGRAPHY_PRESETS.filter((p) => (!category || p.category === category) && (!s || p.name.toLowerCase().includes(s) || p.text.toLowerCase().includes(s) || p.tags.some((t) => t.includes(s)) || (p.style.fontFamily ?? "").toLowerCase().includes(s)));
}

/** Build an ordinary, editable text layer from a typography preset (pure — usable on the server). */
export function presetLayer(config: DesignConfig, p: TypographyPreset, preset?: PlacementPreset): TextLayer {
  const base = createTextLayer(config, p.text, preset ?? p.preset);
  const f = p.style.fontSize ? p.style.fontSize / base.fontSize : 1;
  return { ...base, ...p.style, name: p.name, width: base.width * f, height: base.height * f } as TextLayer;
}
