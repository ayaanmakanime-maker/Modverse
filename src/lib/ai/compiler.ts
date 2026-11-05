/**
 * Layer 3 — the design compiler.
 *
 * Converts a validated Director proposal (+ resolved artwork) into a
 * deterministic list of allowlisted DesignOps, applies them to a COPY of the
 * current design through the garment engine, and reports:
 *  • a human-readable preview of every change (before → after),
 *  • conflicts and how they were resolved,
 *  • rejected / unsupported items with reasons,
 *  • compatibility corrections, new validation issues and the price impact.
 * Nothing is applied to the real design until the customer accepts the
 * transaction, which the editor applies as ONE undoable step.
 */
import { applyOperations, fixToOp, LAYER_SETTABLE, type DesignOp, type ResolvedAsset } from "../garment/operations";
import { createDesign, designSummary } from "../garment/design";
import { getModel, MODEL_BY_ID } from "../garment/models";
import { FABRIC_BY_ID, getFabric } from "../garment/fabrics";
import { priceDesign } from "../garment/pricing";
import { validateDesign, type ValidationContext } from "../garment/validation";
import type { DesignConfig, Layer } from "../garment/schema";
import { colorName } from "../color";
import { PANEL_LABELS, type Audience } from "../garment/types";
import { PLACEMENT_LABELS, type PlacementPreset } from "../garment/panels";
import { designProposalSchema, toPreset, type DesignProposal } from "./proposal";
import { artworkAssets, type ResolvedArtwork } from "./artwork";

export const COMPILE_VERSION = "modverse.compile/1" as const;

export interface PreviewChange {
  area: "garment" | "fabric" | "construction" | "proportions" | "panels" | "artwork" | "typography" | "layers";
  label: string;
  before?: string;
  after?: string;
}

export interface CompileResult {
  version: typeof COMPILE_VERSION;
  ok: boolean;
  summary: string;
  ops: DesignOp[];
  assets: Record<string, ResolvedAsset>;
  preview: PreviewChange[];
  conflicts: { issue: string; resolution: string }[];
  rejected: { item: string; reason: string }[];
  corrections: string[];
  validation: { status: "pass" | "warnings" | "fail"; newIssues: { code: string; severity: string; message: string }[] };
  price: { before: number | null; after: number; currency: "INR"; delta: number | null };
  artwork: ResolvedArtwork[];
  baseHash: string;
  config: DesignConfig;
}

/** Stable short hash of a design (lets the editor detect a stale preview). */
export function configHash(config: DesignConfig | null): string {
  if (!config) return "none";
  const s = JSON.stringify(config);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

const ALT_PLACEMENT: Partial<Record<PlacementPreset, PlacementPreset>> = {
  "center-chest": "left-chest", "full-front": "center-chest", "left-chest": "right-chest", "right-chest": "left-chest",
  "upper-back": "nape", "full-back": "upper-back", nape: "upper-back", "left-sleeve": "right-sleeve", "right-sleeve": "left-sleeve",
  pocket: "left-chest", hem: "right-chest",
};

const show = (v: unknown): string => {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string" && /^#[0-9A-Fa-f]{6}$/.test(v)) return `${colorName(v)} ${v.toUpperCase()}`;
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return `${+v.toFixed(2)}`;
  return String(v);
};

const LABEL: Record<string, string> = {
  neckline: "Neckline", collar: "Collar", placket: "Placket", sleeveLength: "Sleeve length", sleeveStyle: "Sleeve style", cuff: "Cuffs", hemShape: "Hem shape",
  hemFinish: "Hem finish", sideSlits: "Side slits", pocketCount: "Pockets", pocketStyle: "Pocket style", backYoke: "Back yoke", backPleat: "Back pleat", darts: "Darts",
  sidePanels: "Side panels", shoulderPanels: "Shoulder panels", ribTrim: "Rib trim", "buttons.count": "Buttons", "buttons.material": "Button material",
  "buttons.color": "Button colour", "buttons.sizeMm": "Button size", "stitching.color": "Stitching colour", "stitching.contrast": "Contrast stitching",
  "stitching.style": "Stitch style", "stitching.spi": "Stitches per inch",
};

/** Human-readable before/after diff of two designs (garment-level fields and layers). */
export function diffDesigns(before: DesignConfig | null, after: DesignConfig): PreviewChange[] {
  const out: PreviewChange[] = [];
  const b = before;
  const add = (area: PreviewChange["area"], label: string, x: unknown, y: unknown, fmt = show) => {
    if (JSON.stringify(x) !== JSON.stringify(y)) out.push({ area, label, before: b ? fmt(x) : undefined, after: fmt(y) });
  };
  add("garment", "Garment", b ? getModel(b.modelId).name : null, getModel(after.modelId).name, (v) => String(v ?? "—"));
  add("garment", "Category", b?.audience, after.audience);
  add("garment", "Fit", b?.fit, after.fit);
  add("garment", "Size", b?.size, after.size);
  add("fabric", "Fabric", b ? getFabric(b.fabric.id).name : null, getFabric(after.fabric.id).name, (v) => String(v ?? "—"));
  add("fabric", "GSM", b?.fabric.gsm, after.fabric.gsm);
  add("fabric", "Base colour", b?.fabric.color, after.fabric.color);
  add("garment", "Decoration method", b?.printMethod, after.printMethod);
  const ca = after.construction as unknown as Record<string, unknown>;
  const cb = (b?.construction ?? {}) as unknown as Record<string, unknown>;
  for (const k of Object.keys(LABEL)) {
    const [p, q] = k.split(".");
    const x = q ? (cb[p] as Record<string, unknown> | undefined)?.[q] : cb[p];
    const y = q ? (ca[p] as Record<string, unknown>)[q] : ca[p];
    if (b) add("construction", LABEL[k], x, y);
  }
  for (const k of Object.keys(after.adjustments) as (keyof DesignConfig["adjustments"])[]) {
    const x = b?.adjustments[k] ?? 0;
    const y = after.adjustments[k];
    if (Math.abs(x - y) > 0.001) out.push({ area: "proportions", label: k.replace(/([A-Z])/g, " $1").toLowerCase(), before: `${x > 0 ? "+" : ""}${x} cm`, after: `${y > 0 ? "+" : ""}${y} cm` });
  }
  for (const panel of Object.keys(after.panels) as (keyof DesignConfig["panels"])[]) {
    const x = b?.panels[panel];
    const y = after.panels[panel];
    if (b && x?.color !== y.color) out.push({ area: "panels", label: `${PANEL_LABELS[panel]} colour`, before: show(x?.color ?? "base"), after: show(y.color ?? "base") });
    if (b && x?.patternId !== y.patternId) out.push({ area: "panels", label: `${PANEL_LABELS[panel]} pattern`, before: show(x?.patternId), after: show(y.patternId) });
  }
  const beforeIds = new Set((b?.layers ?? []).map((l) => l.id));
  const afterIds = new Set(after.layers.map((l) => l.id));
  const name = (l: Layer) => (l.type === "text" ? `"${l.text.slice(0, 30)}"` : l.name);
  for (const l of after.layers) if (!beforeIds.has(l.id)) out.push({ area: l.type === "text" ? "typography" : "artwork", label: `Add ${l.type === "text" ? "text" : l.type} ${name(l)}`, after: `${l.zone} · ${l.width.toFixed(1)}×${l.height.toFixed(1)} cm${l.type === "text" ? ` · ${l.fontFamily} · ${colorName(l.color)}` : ""}` });
  for (const l of b?.layers ?? []) if (!afterIds.has(l.id)) out.push({ area: "layers", label: `Remove ${l.type} ${name(l)}`, before: l.zone });
  for (const l of after.layers) {
    const old = b?.layers.find((x) => x.id === l.id);
    if (old && JSON.stringify(old) !== JSON.stringify(l)) out.push({ area: "layers", label: `Edit ${l.type} ${name(l)}`, before: `${old.zone} (${old.x.toFixed(1)}, ${old.y.toFixed(1)})`, after: `${l.zone} (${l.x.toFixed(1)}, ${l.y.toFixed(1)})` });
  }
  return out;
}

export interface CompileOptions {
  defaultAudience?: Audience;
  validation?: ValidationContext;
}

export function compileProposal(base: DesignConfig | null, rawProposal: unknown, artwork: ResolvedArtwork[], opts: CompileOptions = {}): CompileResult {
  const proposal: DesignProposal = designProposalSchema.parse(rawProposal);
  const ops: DesignOp[] = [];
  const labels: string[] = [];
  const conflicts: CompileResult["conflicts"] = [];
  const rejected: CompileResult["rejected"] = [];
  const push = (op: DesignOp, label: string) => {
    ops.push(op);
    labels.push(label);
  };
  const g = proposal.garment;

  // ── Garment & category ───────────────────────────────────────
  let start: DesignConfig | null = base;
  if (g.modelId && !MODEL_BY_ID.has(g.modelId)) {
    rejected.push({ item: `Garment model "${g.modelId}"`, reason: "Not in the ModVerse catalogue (15 T-shirts, 17 shirts)." });
  }
  const modelOk = g.modelId && MODEL_BY_ID.has(g.modelId) ? g.modelId : undefined;
  if (!base || (proposal.intent === "create" && modelOk)) {
    const modelId = modelOk ?? base?.modelId ?? "tee-classic-crew";
    const model = getModel(modelId);
    const audience = g.audience && model.audiences.includes(g.audience) ? g.audience : model.audiences.includes(opts.defaultAudience ?? "men") ? (opts.defaultAudience ?? "men") : model.audiences[0];
    if (g.audience && !model.audiences.includes(g.audience)) conflicts.push({ issue: `${model.name} is not offered for ${g.audience}`, resolution: `Created it for ${audience}` });
    push({ op: "reset", modelId, audience }, `New ${model.name}`);
    start = null;
  } else {
    if (g.audience && g.audience !== base.audience) push({ op: "setAudience", audience: g.audience }, `Category ${g.audience}`);
    if (modelOk && modelOk !== base.modelId) push({ op: "setModel", modelId: modelOk }, `Model ${getModel(modelOk).name}`);
  }
  if (modelOk && g.fit) {
    const m = getModel(modelOk);
    if (m.fit !== g.fit) conflicts.push({ issue: `${m.name} is normally cut ${m.fit}, but "${g.fit}" was requested`, resolution: `Kept the ${m.name} construction with a ${g.fit} fit` });
  }
  if (g.fit) push({ op: "set", path: "fit", value: g.fit }, `Fit ${g.fit}`);
  if (g.size) push({ op: "set", path: "size", value: g.size }, `Size ${g.size}`);
  if (g.printMethod) push({ op: "set", path: "printMethod", value: g.printMethod }, `Decoration ${g.printMethod}`);
  if (g.baseColor) push({ op: "set", path: "fabric.color", value: g.baseColor.toUpperCase() }, `Base colour ${colorName(g.baseColor)}`);

  // ── Fabric ───────────────────────────────────────────────────
  if (proposal.fabric.id) {
    if (FABRIC_BY_ID.has(proposal.fabric.id)) push({ op: "set", path: "fabric.id", value: proposal.fabric.id }, `Fabric ${getFabric(proposal.fabric.id).name}`);
    else rejected.push({ item: `Fabric "${proposal.fabric.id}"`, reason: "Unknown fabric — choose one of the 19 ModVerse fabrics." });
  }
  if (proposal.fabric.gsm) push({ op: "set", path: "fabric.gsm", value: proposal.fabric.gsm }, `${proposal.fabric.gsm} GSM`);

  // ── Construction & proportions ───────────────────────────────
  for (const [key, value] of Object.entries(proposal.construction)) push({ op: "set", path: `construction.${key}`, value }, `${LABEL[key] ?? key} → ${show(value)}`);
  for (const [key, a] of Object.entries(proposal.adjustments)) {
    if (!a) continue;
    if (a.mode === "set") push({ op: "set", path: `adjustments.${key}`, value: a.value }, `${key} = ${a.value} cm`);
    else push({ op: "adjust", path: `adjustments.${key}`, delta: a.value }, `${key} ${a.value > 0 ? "+" : ""}${a.value} cm`);
  }
  for (const p of proposal.panels) {
    if (p.color !== undefined) push({ op: "set", path: `panels.${p.panel}.color`, value: p.color ? p.color.toUpperCase() : null }, `${PANEL_LABELS[p.panel]} colour`);
    if (p.patternId !== undefined) push({ op: "set", path: `panels.${p.panel}.patternId`, value: p.patternId }, `${PANEL_LABELS[p.panel]} pattern`);
  }

  // ── Artwork & typography (resolve placement conflicts inside the proposal) ──
  const used = new Map<PlacementPreset, string>();
  const place = (want: PlacementPreset, what: string): PlacementPreset => {
    if (!used.has(want)) {
      used.set(want, what);
      return want;
    }
    const alt = ALT_PLACEMENT[want];
    if (alt && !used.has(alt)) {
      conflicts.push({ issue: `${what} and ${used.get(want)} were both requested at ${PLACEMENT_LABELS[want]}`, resolution: `Placed ${what} at ${PLACEMENT_LABELS[alt]} instead` });
      used.set(alt, what);
      return alt;
    }
    conflicts.push({ issue: `${what} overlaps ${used.get(want)} at ${PLACEMENT_LABELS[want]}`, resolution: "Kept both — adjust them in the editor if they collide" });
    return want;
  };
  for (const req of proposal.artwork) {
    const r = artwork.find((a) => a.ref === req.ref);
    if (!r || r.status !== "resolved" || !r.assetId) {
      rejected.push({ item: `Artwork "${req.description.slice(0, 50)}"`, reason: r?.note ?? "Artwork could not be resolved" });
      continue;
    }
    const preset = place(toPreset(req.placement), r.name ?? "artwork");
    const colorMap = undefined;
    if (r.format === "raster") push({ op: "addImage", assetId: r.assetId, preset, scale: req.scale }, `Image ${r.name}`);
    else push({ op: "addGraphic", assetId: r.assetId, preset, scale: req.scale, ...(colorMap ? { colorMap } : {}) }, `Graphic ${r.name}`);
    if (req.method) push({ op: "updateLayer", target: { by: "last", type: r.format === "raster" ? "image" : "graphic" }, changes: { set: { method: req.method } } }, `Method ${req.method}`);
  }
  for (const t of proposal.typography) {
    const preset = place(toPreset(t.placement), `"${t.text.slice(0, 24)}"`);
    const style: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(t.style ?? {})) {
      if (LAYER_SETTABLE.has(k) && !["x", "y", "width", "height", "name", "groupId", "locked", "visible"].includes(k)) style[k] = v;
      else rejected.push({ item: `Typography style "${k}"`, reason: "Not a supported text property" });
    }
    if (t.color) style.color = t.color.toUpperCase();
    if (t.fontFamily) style.fontFamily = t.fontFamily;
    if (t.fontWeight) style.fontWeight = t.fontWeight;
    if (t.textTransform) style.textTransform = t.textTransform;
    if (t.method) style.method = t.method;
    if (t.curve && !style.curve) style.curve = { mode: t.curve, amount: t.curve === "arc" ? 40 : t.curve === "circle" ? 100 : 0 };
    push({ op: "addText", text: t.text, preset, ...(Object.keys(style).length ? { style } : {}) }, `Text "${t.text.slice(0, 30)}"`);
  }
  for (const e of proposal.edits) push(e, `Edit (${e.op})`);

  // ── Execute on a copy through the deterministic engine ──────
  const assets = artworkAssets(artwork);
  const seed = base ?? createDesign("tee-classic-crew", opts.defaultAudience ?? "men");
  let res = applyOperations(seed, ops, { resolveAsset: (id) => assets[id] });
  for (const r of res.rejected) rejected.push({ item: labels[r.index] ?? `Operation ${r.index + 1}`, reason: r.reason });
  const corrections = [...res.corrections];

  // Artwork boundaries: fit NEW layers that fall outside the printable area or method limits.
  const existing = new Set((start ?? { layers: [] as Layer[] }).layers.map((l) => l.id));
  const report = validateDesign(res.config, opts.validation);
  const fixOps: DesignOp[] = [];
  for (const i of report.issues) {
    if (!i.layerId || existing.has(i.layerId) || !i.fix) continue;
    if (["OUTSIDE_PRINT_AREA", "CROSSES_PRINT_BOUNDARY", "METHOD_MAX_AREA", "TEXT_TOO_SMALL"].includes(i.code)) {
      fixOps.push(fixToOp(i.fix.patch));
      corrections.push(`${i.fix.label}: ${i.message}`);
    }
  }
  if (fixOps.length) {
    const fixed = applyOperations(res.config, fixOps, { resolveAsset: (id) => assets[id] });
    res = { ...fixed, applied: [...res.applied, ...fixed.applied], rejected: res.rejected };
    ops.push(...fixOps);
  }

  const final = res.config;
  const before = start ? validateDesign(start, opts.validation) : null;
  const after = validateDesign(final, opts.validation);
  const seen = new Set((before?.issues ?? []).map((i) => `${i.code}:${i.layerId ?? ""}`));
  const newIssues = after.issues.filter((i) => !seen.has(`${i.code}:${i.layerId ?? ""}`)).map((i) => ({ code: i.code, severity: i.severity, message: i.message }));
  const priceAfter = priceDesign(final).unitTotal;
  const priceBefore = start ? priceDesign(start).unitTotal : null;
  return {
    version: COMPILE_VERSION,
    ok: res.applied.length > 0,
    summary: proposal.summary || designSummary(final),
    ops,
    assets,
    preview: diffDesigns(start, final),
    conflicts,
    rejected: [...rejected, ...proposal.unsupported.map((u) => ({ item: u, reason: "Not supported by ModVerse" }))],
    corrections,
    validation: { status: after.status, newIssues },
    price: { before: priceBefore, after: priceAfter, currency: "INR", delta: priceBefore === null ? null : priceAfter - priceBefore },
    artwork,
    baseHash: configHash(base),
    config: final,
  };
}
