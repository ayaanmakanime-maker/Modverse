/**
 * The Muse — ModVerse AI Fashion Director (local rule-based engine).
 *
 * Every suggestion that changes the design carries structured DesignOps, so
 * applying it goes through the real garment configuration engine. Output from
 * this module is labelled `source: "local-rules"` — it is deterministic
 * guidance, not generative model output.
 */
import { colorName, contrastRatio, harmonies, isDark, hexToHsl } from "../color";
import { designSummary, panelColor } from "../garment/design";
import { FABRICS, getFabric } from "../garment/fabrics";
import { getModel } from "../garment/models";
import type { DesignOp, ResolvedAsset } from "../garment/operations";
import { fixToOp } from "../garment/operations";
import type { DesignConfig } from "../garment/schema";
import { computeMeasurements, recommendSize } from "../garment/sizing";
import { validateDesign } from "../garment/validation";
import type { BodyMeasurements } from "../garment/types";
import type { LibraryLookup } from "../library/lookup";
import { interpretInstruction } from "./text-to-design";

export type SuggestionKind = "critique" | "colour" | "fabric" | "typography" | "graphic" | "placement" | "outfit" | "fit" | "manufacturing" | "summary";

export interface MuseSuggestion {
  id: string;
  kind: SuggestionKind;
  title: string;
  detail: string;
  ops?: DesignOp[];
  assets?: Record<string, ResolvedAsset>;
  swatches?: string[];
}

export interface MuseReply {
  source: "local-rules" | "ollama" | "openai" | "gemini";
  message: string;
  applied?: { ops: DesignOp[]; understood: string[]; unsupported: string[]; assets: Record<string, ResolvedAsset>; mode: "create" | "edit" };
  suggestions: MuseSuggestion[];
}

const COLLECTION_FONTS: Record<string, string[]> = {
  Cyberpunk_Futurism: ["Orbitron", "Audiowide"], Japanese_Streetwear: ["Bebas Neue", "Anton"], Minimalist_Geometric: ["Inter", "Josefin Sans"],
  Vintage_Retro: ["Abril Fatface", "Lobster"], Gothic_Dark: ["UnifrakturMaguntia", "Cormorant Garamond"], Graffiti_Urban: ["Permanent Marker", "Bungee"],
  Botanical_Nature: ["Cormorant Garamond", "Lora"], Abstract_Surreal: ["Syne", "DM Serif Display"], Space_Astronomy: ["Orbitron", "Space Grotesk"],
  Automotive_Racing: ["Audiowide", "Oswald"], Typography: ["Archivo Black", "Inter"], Fantasy_Mythology: ["Cormorant Garamond", "UnifrakturMaguntia"],
  Sports_Athletics: ["Oswald", "Anton"], "3D_Liquid_Chrome": ["Syne", "Monoton"], Architecture_Brutalism: ["Archivo Black", "Space Grotesk"],
  Pop_Comics: ["Bungee", "Righteous"], Music_Psychedelic: ["Monoton", "Righteous"], Glitch_Digital: ["Rubik Glitch", "Space Mono"],
  Luxury_Ornamental: ["Playfair Display", "Cormorant Garamond"], Experimental_Collage: ["Syne", "Space Mono"],
};

function outfitIdeas(config: DesignConfig): string[] {
  const c = config.fabric.color;
  const [h, s, l] = hexToHsl(c);
  const ideas: string[] = [];
  if (l < 0.2) ideas.push("Stone or beige chinos", "Light-wash denim", "White low-top sneakers");
  else if (l > 0.85) ideas.push("Indigo or black denim", "Olive cargo trousers", "Tan loafers or kolhapuris");
  else if (s < 0.2) ideas.push("Black tapered trousers", "Ecru linen pants", "Minimal white sneakers");
  else if (h >= 180 && h <= 260) ideas.push("Beige or khaki chinos", "White trousers", "Brown leather sandals");
  else if (h < 40 || h > 330) ideas.push("Charcoal denim", "Black trousers", "White sneakers");
  else if (h >= 40 && h < 180) ideas.push("Navy chinos", "Off-white trousers", "Brown suede shoes");
  else ideas.push("Neutral grey trousers", "Dark denim");
  if (config.garmentType === "shirt" && getFabric(config.fabric.id).id.includes("linen")) ideas.push("Pair open over a white tee for monsoon evenings");
  return ideas;
}

export function museSuggestions(config: DesignConfig, lib: LibraryLookup, opts: { body?: Partial<BodyMeasurements>; assetColors?: Record<string, string[]> } = {}): MuseSuggestion[] {
  const out: MuseSuggestion[] = [];
  const report = validateDesign(config, { body: opts.body, assetColors: opts.assetColors });
  const model = getModel(config.modelId);
  const fabric = getFabric(config.fabric.id);
  const base = config.fabric.color;
  const m = computeMeasurements(config);

  // ── Critique (validation + aesthetics) ─────────────────────────
  for (const issue of report.issues.filter((i) => i.severity !== "info").slice(0, 4)) {
    out.push({ id: `fix-${issue.code}-${issue.layerId ?? issue.panel ?? ""}`, kind: "critique", title: issue.message, detail: issue.suggestion, ops: issue.fix ? [fixToOp(issue.fix.patch)] : undefined });
  }
  const distinctColors = new Set<string>([base.toUpperCase()]);
  for (const p of Object.values(config.panels)) if (p.color) distinctColors.add(p.color.toUpperCase());
  for (const l of config.layers) if (l.type === "text") distinctColors.add(l.color.toUpperCase());
  if (distinctColors.size > 5)
    out.push({ id: "critique-colours", kind: "critique", title: `${distinctColors.size} colours compete for attention`, detail: "Limit the palette to 3–4 colours: one base, one accent and one or two neutrals." });
  for (const l of config.layers) {
    if (Math.abs(l.x) > 0.05 && Math.abs(l.x) < 1.2 && (l.zone === "front" || l.zone === "back"))
      out.push({ id: `centre-${l.id}`, kind: "placement", title: `"${l.name}" is ${Math.abs(l.x).toFixed(1)} cm off-centre`, detail: "Nearly-centred artwork reads as a mistake. Snap it to the centre line.", ops: [{ op: "updateLayer", target: { by: "id", id: l.id }, changes: { set: { x: 0 } } }] });
    if (l.zone === "front" && l.y - l.height / 2 < m.frontNeckDrop + 4 && l.width > 12)
      out.push({ id: `high-${l.id}`, kind: "placement", title: `"${l.name}" sits very close to the neckline`, detail: "Centre-chest graphics usually start 7–9 cm below the neckline.", ops: [{ op: "updateLayer", target: { by: "id", id: l.id }, changes: { preset: "center-chest" } }] });
  }

  // ── Colour ────────────────────────────────────────────────────
  const hm = harmonies(base);
  out.push({
    id: "colour-contrast-sleeves", kind: "colour", title: `Contrast sleeves in ${colorName(hm.complementary)}`,
    detail: `A complementary accent against ${colorName(base)} — sporty and balanced.`, swatches: [base, hm.complementary],
    ops: [{ op: "set", path: "panels.sleeveLeft.color", value: hm.complementary }, { op: "set", path: "panels.sleeveRight.color", value: hm.complementary }],
  });
  out.push({
    id: "colour-tonal-collar", kind: "colour", title: `Tonal ${config.garmentType === "shirt" ? "collar & cuffs" : "neck rib"}`,
    detail: "A darker tone of the base colour adds quiet depth without adding a new hue.", swatches: [base, hm.tonal[1]],
    ops: [{ op: "set", path: "panels.collar.color", value: hm.tonal[1] }, ...(config.construction.cuff !== "hem" ? [{ op: "set" as const, path: "panels.cuffs.color", value: hm.tonal[1] }] : [])],
  });
  const pal = lib.nearestPalettes(base, 2);
  for (const p of pal) {
    const accent = p.colors.find((h) => contrastRatio(h, base) > 2.2) ?? p.colors[1];
    out.push({ id: `palette-${p.id}`, kind: "colour", title: `${p.name} palette`, detail: `From the ModVerse Creative Library — use ${colorName(accent)} as your accent.`, swatches: p.colors, ops: config.layers.some((l) => l.type === "text") ? [{ op: "updateLayer", target: { by: "all", type: "text" }, changes: { set: { color: accent } } }] : undefined });
  }

  // ── Fabric ────────────────────────────────────────────────────
  const candidates = FABRICS.filter((f) => f.garmentTypes.includes(config.garmentType) && f.id !== fabric.id);
  const summer = candidates.filter((f) => f.season.includes("summer") && f.breathability === "high").slice(0, 2);
  for (const f of summer) out.push({ id: `fabric-${f.id}`, kind: "fabric", title: `${f.name} for Indian summers`, detail: `${f.description} (${f.gsmRange.join("–")} GSM, breathability ${f.breathability}).`, ops: [{ op: "set", path: "fabric.id", value: f.id }, { op: "set", path: "fabric.gsm", value: f.defaultGsm }] });
  if (config.fit === "oversized" || config.fit === "boxy") {
    const heavy = candidates.find((f) => f.id === "heavyweight-cotton-jersey");
    if (heavy) out.push({ id: "fabric-heavy", kind: "fabric", title: "Heavyweight jersey holds an oversized shape", detail: "240 GSM keeps dropped shoulders crisp instead of collapsing.", ops: [{ op: "set", path: "fabric.id", value: heavy.id }, { op: "set", path: "fabric.gsm", value: 240 }] });
  }

  // ── Typography ───────────────────────────────────────────────
  const gfxCollections = config.layers.filter((l) => l.type === "graphic").map((l) => lib.get((l as { assetId: string }).assetId)?.collection).filter(Boolean) as string[];
  const vibe = gfxCollections[0] ?? (isDark(base) ? "Cyberpunk_Futurism" : "Minimalist_Geometric");
  const fonts = COLLECTION_FONTS[vibe] ?? ["Inter"];
  const hasText = config.layers.some((l) => l.type === "text");
  out.push({
    id: `type-${vibe}`, kind: "typography", title: `Pair with ${fonts.join(" or ")}`,
    detail: `Typefaces that match the ${vibe.replace(/_/g, " ")} mood${hasText ? "" : " — add a word or name to try them"}.`,
    ops: hasText ? [{ op: "updateLayer", target: { by: "all", type: "text" }, changes: { set: { fontFamily: fonts[0] } } }] : [{ op: "addText", text: model.garmentType === "shirt" ? "MV" : "MODVERSE", preset: model.garmentType === "shirt" ? "left-chest" : "center-chest", style: { fontFamily: fonts[0] } }],
  });

  // ── Graphics ─────────────────────────────────────────────────
  const collections = gfxCollections.length ? [gfxCollections[0]] : lib.matchCollections(`${model.tags.join(" ")} ${isDark(base) ? "dark neon night" : "minimal clean"}`).map((c) => c.slug).slice(0, 1);
  const g = lib.pick("graphic", collections, `${config.modelId}${base}${config.layers.length}`);
  if (g?.url) {
    const back = !config.layers.some((l) => l.zone === "back");
    out.push({
      id: `gfx-${g.id}`, kind: "graphic", title: `Add “${g.name}” to the ${back ? "back" : "front"}`, detail: `${g.collectionName} collection — editable SVG from the ModVerse library.`,
      ops: [{ op: "addGraphic", assetId: g.id, preset: back ? "full-back" : "center-chest", scale: 0.9 }],
      assets: { [g.id]: { id: g.id, name: g.name, url: g.url, width: g.width, height: g.height } },
    });
  }
  const el = lib.pick("element", collections, `${config.modelId}-el`);
  if (el?.url && !config.layers.some((l) => l.zone === "front" && l.x > 4))
    out.push({ id: `el-${el.id}`, kind: "placement", title: "Balance with a small left-chest mark", detail: `A ${el.collectionName} sticker at 8–9 cm anchors a back print.`, ops: [{ op: "addGraphic", assetId: el.id, preset: "left-chest", scale: 1 }], assets: { [el.id]: { id: el.id, name: el.name, url: el.url, width: el.width, height: el.height } } });

  // ── Outfit ───────────────────────────────────────────────────
  out.push({ id: "outfit", kind: "outfit", title: "Outfit coordination", detail: outfitIdeas(config).join(" · ") });

  // ── Fit ──────────────────────────────────────────────────────
  if (opts.body?.chest) {
    const rec = recommendSize(opts.body as BodyMeasurements, config);
    out.push({
      id: "fit-size", kind: "fit", title: `Recommended size: ${rec.size} (${rec.confidence} confidence)`,
      detail: `${rec.notes.join(" ")} This is a measurement-based estimate, not a verified fit.`,
      ops: rec.size !== config.size ? [{ op: "set", path: "size", value: rec.size }] : undefined,
    });
  } else out.push({ id: "fit-profile", kind: "fit", title: "Add your measurements for a size recommendation", detail: "Chest, waist, shoulder and height let ModVerse compare real garment dimensions to your body." });

  // ── Manufacturing & summary ─────────────────────────────────
  out.push({
    id: "mfg", kind: "manufacturing",
    title: report.status === "pass" ? "Ready for production review" : report.status === "warnings" ? `${report.counts.warning} production warning(s)` : `${report.counts.error} issue(s) block production`,
    detail: `${fabric.name} ${config.fabric.gsm} GSM · ${config.layers.length} decoration placement(s) · default method ${config.printMethod.toUpperCase()}. Human pre-production approval is still required.`,
  });
  out.push({
    id: "summary", kind: "summary", title: "Technical summary",
    detail: `${designSummary(config)} · chest ${m.chest} cm · length ${m.bodyLength} cm · sleeve ${m.sleeveLength} cm · shoulder ${m.shoulderWidth} cm.`,
  });
  return out;
}

const QUESTION_ROUTES: [RegExp, SuggestionKind[], string][] = [
  [/\b(colou?r|palette|shade|tone)s?\b.*\?|\bwhat colou?r|which colou?r|suggest (a )?colou?r/, ["colour"], "Here are colour directions that work with your current base:"],
  [/\b(fabric|material|cloth)\b.*\?|\bwhich fabric|what fabric|suggest (a )?fabric/, ["fabric"], "Fabric recommendations for this garment:"],
  [/\b(font|typeface|typography)\b/, ["typography"], "Typography that suits this design:"],
  [/\b(graphic|artwork|print idea|illustration)s?\b.*\?|\bsuggest (a |some )?graphic/, ["graphic", "placement"], "From the ModVerse Creative Library:"],
  [/\b(critique|review|feedback|how does it look|what do you think|improve|better)\b/, ["critique", "placement"], "My critique of the current design:"],
  [/\b(wear (it )?with|outfit|pair|style it|match)\b/, ["outfit"], "Outfit coordination:"],
  [/\b(size|fit)\b.*\?|\bwhat size|which size|will it fit/, ["fit"], "Fit guidance:"],
  [/\b(manufactur|production|printable|ready|feasib)/, ["manufacturing", "critique"], "Manufacturing feasibility:"],
  [/\b(summary|summari[sz]e|spec|technical)\b/, ["summary", "manufacturing"], "Technical summary:"],
];

/** True when the message asks for advice (suggestions) rather than giving a design instruction. */
export function isMuseQuestion(message: string): boolean {
  const text = message.trim();
  return /\?$/.test(text) || /^(what|which|how|should|can you suggest|any (ideas|suggestions)|suggest|recommend|give me (ideas|suggestions)|critique|review)\b/i.test(text);
}

/** Chat entry point: answers questions with suggestions or applies instructions via text-to-design. */
export function museRespond(message: string, config: DesignConfig | null, lib: LibraryLookup, opts: { body?: Partial<BodyMeasurements>; selectedLayerId?: string | null; defaultAudience?: DesignConfig["audience"]; assetColors?: Record<string, string[]> } = {}): MuseReply {
  const text = message.trim();
  if (config && isMuseQuestion(text)) {
    const all = museSuggestions(config, lib, opts);
    for (const [re, kinds, intro] of QUESTION_ROUTES) {
      if (re.test(text.toLowerCase())) {
        const picked = all.filter((s) => kinds.includes(s.kind));
        return { source: "local-rules", message: intro, suggestions: picked };
      }
    }
    return { source: "local-rules", message: "Here's what I'd consider next:", suggestions: all.filter((s) => ["critique", "colour", "graphic", "typography"].includes(s.kind)).slice(0, 6) };
  }
  const r = interpretInstruction(text, config, lib, { defaultAudience: opts.defaultAudience, selectedLayerId: opts.selectedLayerId });
  const parts: string[] = [];
  if (r.understood.length) parts.push(r.mode === "create" ? "Created a new design:" : "Applied your changes:");
  if (r.unsupported.length) parts.push(r.unsupported.join(" "));
  return {
    source: "local-rules",
    message: parts.join(" ") || "Done.",
    applied: { ops: r.ops, understood: r.understood, unsupported: r.unsupported, assets: r.assets, mode: r.mode },
    suggestions: [],
  };
}

export { panelColor };
