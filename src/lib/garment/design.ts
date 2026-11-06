import { FABRIC_BY_ID, fabricsFor } from "./fabrics";
import { getModel, type GarmentModel } from "./models";
import { computeMeasurements, DEFAULT_SIZE, sizesFor } from "./sizing";
import { fitToPlacement, placementPreset, type PlacementPreset } from "./panels";
import type { Construction, DesignConfig, GraphicLayer, ImageLayer, Layer, PanelStyle, TextLayer } from "./schema";
import { adjustmentsSchema, designConfigSchema, DESIGN_SCHEMA_VERSION } from "./schema";
import { LAYER_FX_DEFAULTS } from "./layer-fx";
import {
  COLLARS, CUFFS, PANELS, PLACKETS, type Audience, type Collar, type Cuff, type GarmentMeasurements, type Neckline,
  type PanelId, type Placket, type PrintMethod, type SleeveLength, type Zone,
} from "./types";
import { DEFAULT_FONT } from "../typography/fonts";
import { readableInk } from "../color";

/** Which construction options apply to a garment — drives garment-specific UI controls. */
export interface OptionAvailability {
  necklines: Neckline[];
  collars: Collar[];
  plackets: Placket[];
  cuffs: Cuff[];
  sleeveLengths: SleeveLength[];
  yokes: ("none" | "straight" | "western")[];
  pleats: ("none" | "box" | "side")[];
  darts: boolean;
  pockets: boolean;
  ribTrim: boolean;
  buttons: boolean;
}

export function optionAvailability(config: Pick<DesignConfig, "garmentType" | "construction">): OptionAvailability {
  const shirt = config.garmentType === "shirt";
  const c = config.construction;
  const long = c.sleeveLength === "long";
  return {
    necklines: shirt ? ["collared"] : ["crew", "v", "mock", "henley"],
    collars: shirt ? COLLARS.filter((x) => x !== "none") : ["none"],
    plackets: shirt ? PLACKETS.filter((p) => p !== "none" && p !== "henley") : c.neckline === "henley" ? ["henley"] : ["none"],
    cuffs: shirt ? (long ? CUFFS.filter((x) => ["barrel", "french", "convertible", "adjustable"].includes(x)) : ["hem"]) : long || c.sleeveLength === "three-quarter" ? ["rib", "hem"] : ["hem", "rib"],
    sleeveLengths: ["short", "elbow", "three-quarter", "long"],
    yokes: shirt ? ["none", "straight", "western"] : ["none"],
    pleats: shirt ? ["none", "box", "side"] : ["none"],
    darts: shirt,
    pockets: true,
    ribTrim: !shirt,
    buttons: shirt || c.neckline === "henley",
  };
}

/** Panels that physically exist for the current construction. */
export function availablePanels(config: Pick<DesignConfig, "garmentType" | "construction">): PanelId[] {
  const c = config.construction;
  return PANELS.filter((p) => {
    switch (p) {
      case "collar": return true;
      case "cuffs": return c.cuff !== "hem" && c.cuff !== "none";
      case "pocket": return c.pocketCount > 0;
      case "placket": return c.placket !== "none" && c.placket !== "french";
      case "yoke": return c.backYoke !== "none";
      case "shoulderPanels": return c.shoulderPanels;
      case "sidePanels": return c.sidePanels;
      default: return true;
    }
  });
}

export function availableZones(config: Pick<DesignConfig, "garmentType" | "construction">): Zone[] {
  const panels = availablePanels(config);
  const zones: Zone[] = ["front", "back", "sleeveLeft", "sleeveRight", "collar"];
  if (panels.includes("cuffs")) zones.push("cuffs");
  if (panels.includes("pocket")) zones.push("pocket");
  if (panels.includes("yoke")) zones.push("yoke");
  return zones;
}

/**
 * Enforce construction compatibility rules. Returns a corrected config plus
 * human-readable notes about every automatic correction.
 */
export function normalizeDesign(input: DesignConfig): { config: DesignConfig; corrections: string[] } {
  const config: DesignConfig = structuredClone(input);
  const notes: string[] = [];
  const c = config.construction;
  const shirt = config.garmentType === "shirt";

  if (shirt) {
    if (c.neckline !== "collared") { c.neckline = "collared"; notes.push("Shirts use a collared neckline."); }
    if (c.collar === "none") { c.collar = "point"; notes.push("Shirts need a collar — set to point collar."); }
    if (c.placket === "none" || c.placket === "henley") { c.placket = "standard"; notes.push("Shirts use a front placket — set to standard."); }
    if (c.sleeveLength === "long" && !["barrel", "french", "convertible", "adjustable"].includes(c.cuff)) { c.cuff = "barrel"; notes.push("Long-sleeve shirts need a cuff — set to barrel cuff."); }
    if (c.sleeveLength !== "long" && c.cuff !== "hem") { notes.push(`${c.cuff === "french" ? "French" : "Shirt"} cuffs require long sleeves — short sleeves use a turned hem.`); c.cuff = "hem"; }
    if (c.ribTrim) c.ribTrim = false;
    if (c.collar === "camp" && c.placket !== "hidden" && c.placket !== "standard") { c.placket = "standard"; }
    if (c.buttons.count < 4) { c.buttons.count = 7; notes.push("Shirt placket needs at least 4 buttons — set to 7."); }
  } else {
    if (c.neckline === "collared") { c.neckline = "crew"; notes.push("T-shirts use a knit neckline — set to crew."); }
    if (c.collar !== "none") { c.collar = "none"; notes.push("Woven shirt collars are not available on T-shirts."); }
    if (c.neckline === "henley") {
      if (c.placket !== "henley") c.placket = "henley";
      if (c.buttons.count < 2 || c.buttons.count > 5) c.buttons.count = 3;
    } else if (c.placket !== "none") { c.placket = "none"; notes.push("Only henley T-shirts have a placket."); }
    if (!["hem", "rib"].includes(c.cuff)) { c.cuff = c.sleeveLength === "long" ? "rib" : "hem"; notes.push("T-shirt sleeves finish with a hem or rib cuff."); }
    if (c.backYoke !== "none") { c.backYoke = "none"; notes.push("Back yokes are a shirt construction."); }
    if (c.backPleat !== "none") { c.backPleat = "none"; notes.push("Back pleats are a shirt construction."); }
    if (c.darts) { c.darts = false; notes.push("Darts are not used on knit T-shirts."); }
    if (c.neckline !== "henley" && c.buttons.count) c.buttons.count = 0;
    if (c.pocketStyle === "western-flap" || c.pocketStyle === "welt") c.pocketStyle = "patch";
  }
  if (c.sleeveStyle === "raglan" && c.shoulderPanels) { c.shoulderPanels = false; notes.push("Raglan sleeves already form the shoulder — shoulder panels removed."); }
  if (c.pocketCount === 0 && config.layers.some((l) => l.zone === "pocket")) {
    config.layers = config.layers.filter((l) => l.zone !== "pocket");
    notes.push("Removed artwork from the pocket because the pocket was removed.");
  }
  if ((c.cuff === "hem" || c.cuff === "none") && config.layers.some((l) => l.zone === "cuffs")) {
    config.layers = config.layers.filter((l) => l.zone !== "cuffs");
    notes.push("Removed cuff artwork because the sleeves no longer have cuffs.");
  }
  for (const l of config.layers) {
    if (l.type === "graphic" || l.type === "image") {
      const cr = l.crop;
      if (cr.x + cr.w > 1) cr.w = Math.max(0.05, +(1 - cr.x).toFixed(4));
      if (cr.y + cr.h > 1) cr.h = Math.max(0.05, +(1 - cr.y).toFixed(4));
    }
  }
  if (c.backYoke === "none" && config.layers.some((l) => l.zone === "yoke")) {
    config.layers = config.layers.filter((l) => l.zone !== "yoke");
    notes.push("Removed artwork from the yoke because the yoke was removed.");
  }
  const fabric = FABRIC_BY_ID.get(config.fabric.id);
  if (!fabric || !fabric.garmentTypes.includes(config.garmentType)) {
    // Keep incompatible fabric so validation can explain it, unless unknown.
    if (!fabric) {
      config.fabric.id = fabricsFor(config.garmentType)[0].id;
      notes.push("Unknown fabric replaced with the default fabric.");
    }
  }
  if (!sizesFor(config.audience).includes(config.size)) {
    config.size = DEFAULT_SIZE[config.audience];
    notes.push(`Size reset to ${config.size} for ${config.audience}.`);
  }
  return { config, corrections: notes };
}

function blankPanel(): PanelStyle {
  return { color: null, fabricId: null, patternId: null, patternScale: 1, patternOpacity: 1 };
}

export function defaultPrintMethod(fabricId: string): PrintMethod {
  const f = FABRIC_BY_ID.get(fabricId);
  if (!f) return "dtg";
  if (f.printMethods.dtg === "good") return "dtg";
  if (f.printMethods.dtf === "good") return "dtf";
  if (f.printMethods.screen === "good") return "screen";
  return "embroidery";
}

/** Create a fresh design from a catalogue model. */
export function createDesign(modelId: string, audience: Audience, size?: string): DesignConfig {
  const model: GarmentModel = getModel(modelId);
  const aud = model.audiences.includes(audience) ? audience : model.audiences[0];
  const panels = Object.fromEntries(PANELS.map((p) => [p, blankPanel()])) as DesignConfig["panels"];
  for (const [p, color] of Object.entries(model.panelColors ?? {})) panels[p as PanelId].color = color;
  const draft: DesignConfig = {
    schemaVersion: DESIGN_SCHEMA_VERSION,
    audience: aud,
    garmentType: model.garmentType,
    modelId: model.id,
    size: size && sizesFor(aud).includes(size) ? size : DEFAULT_SIZE[aud],
    fit: model.fit,
    adjustments: adjustmentsSchema.parse({}),
    construction: structuredClone(model.construction),
    fabric: { id: model.fabricId, gsm: model.gsm, color: model.color },
    panels,
    layers: [],
    folders: [],
    printMethod: defaultPrintMethod(model.fabricId),
    measurementProfileId: null,
    notes: "",
  };
  return designConfigSchema.parse(normalizeDesign(draft).config);
}

/** Switch model while preserving colours, artwork and typography where compatible. */
export function switchModel(config: DesignConfig, modelId: string): { config: DesignConfig; corrections: string[] } {
  const next = createDesign(modelId, config.audience, config.size);
  next.fabric.color = config.fabric.color;
  if (next.garmentType === config.garmentType && FABRIC_BY_ID.get(config.fabric.id)?.garmentTypes.includes(next.garmentType)) {
    // keep fabric choice only when the model family matches
  }
  next.panels = structuredClone(config.panels);
  next.layers = structuredClone(config.layers);
  next.printMethod = config.printMethod;
  next.measurementProfileId = config.measurementProfileId;
  next.notes = config.notes;
  return normalizeDesign(next);
}

export function panelColor(config: DesignConfig, panel: PanelId): string {
  const own = config.panels[panel]?.color;
  if (own) return own;
  if (panel === "sleeveRight" && config.panels.sleeveLeft.color && config.construction.sleeveStyle === "raglan") return config.panels.sleeveLeft.color;
  return config.fabric.color;
}

export function panelFabricId(config: DesignConfig, panel: PanelId): string {
  return config.panels[panel]?.fabricId ?? config.fabric.id;
}

export function measurementsFor(config: DesignConfig, body?: Parameters<typeof computeMeasurements>[1]): GarmentMeasurements {
  return computeMeasurements(config, body);
}

let idCounter = 0;
export function newLayerId(prefix = "layer"): string {
  idCounter = (idCounter + 1) % 1_000_000;
  const rand = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${rand}-${idCounter.toString(36)}`;
}

export function createTextLayer(config: DesignConfig, text: string, preset: PlacementPreset = "center-chest", overrides: Partial<TextLayer> = {}): TextLayer {
  const m = computeMeasurements(config);
  const p = placementPreset(m, preset);
  const fontSize = overrides.fontSize ?? Math.max(1, Math.min(p.maxHeight * 0.6, (p.maxWidth / Math.max(4, text.length)) * 1.7));
  const lines = text.split("\n").length;
  const width = Math.min(p.maxWidth, Math.max(2, text.split("\n").reduce((mx, l) => Math.max(mx, l.length), 1) * fontSize * 0.62));
  const height = Math.max(fontSize * 1.2, lines * fontSize * 1.2);
  const bg = panelColor(config, p.zone);
  return {
    id: newLayerId("text"),
    type: "text",
    name: text.slice(0, 24) || "Text",
    zone: p.zone,
    x: p.x,
    y: p.top + height / 2,
    width,
    height,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    groupId: null,
    method: null,
    flipX: false,
    flipY: false,
    ...LAYER_FX_DEFAULTS,
    text,
    fontFamily: DEFAULT_FONT,
    fontWeight: 700,
    italic: false,
    underline: false,
    textTransform: "none",
    fontSize: Math.round(fontSize * 100) / 100,
    color: readableInk(bg),
    letterSpacing: 0.02,
    lineHeight: 1.15,
    align: "center",
    verticalAlign: "middle",
    curve: { mode: "none", amount: 0 },
    outline: { enabled: false, color: "#000000", width: 0.1 },
    shadow: { enabled: false, color: "#000000", offsetX: 0.1, offsetY: 0.1, blur: 0.1 },
    background: { enabled: false, color: "#000000", padding: 0.4, radius: 0.2 },
    skewX: 0,
    effects: [],
    fontAssetId: null,
    fill: null,
    ...overrides,
  };
}

export function createGraphicLayer(
  config: DesignConfig,
  asset: { id: string; name: string; url: string; width: number; height: number },
  preset: PlacementPreset = "center-chest",
  source: GraphicLayer["source"] = "library",
  scale = 1,
): GraphicLayer {
  const m = computeMeasurements(config);
  const aspect = asset.width > 0 && asset.height > 0 ? asset.width / asset.height : 1;
  const pos = fitToPlacement(placementPreset(m, preset), aspect, scale);
  return {
    id: newLayerId("gfx"),
    type: "graphic",
    name: asset.name,
    ...pos,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    groupId: null,
    method: null,
    flipX: false,
    flipY: false,
    ...LAYER_FX_DEFAULTS,
    source,
    assetId: asset.id,
    url: asset.url,
    colorMap: {},
    aspect,
    crop: { x: 0, y: 0, w: 1, h: 1 },
  };
}

export function createImageLayer(
  config: DesignConfig,
  img: { id: string; name: string; url: string; pixelWidth: number; pixelHeight: number },
  preset: PlacementPreset = "center-chest",
  source: ImageLayer["source"] = "upload",
): ImageLayer {
  const m = computeMeasurements(config);
  const pos = fitToPlacement(placementPreset(m, preset), img.pixelWidth / img.pixelHeight);
  return {
    id: newLayerId("img"),
    type: "image",
    name: img.name,
    ...pos,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    groupId: null,
    method: null,
    flipX: false,
    flipY: false,
    ...LAYER_FX_DEFAULTS,
    source,
    assetId: img.id,
    url: img.url,
    pixelWidth: img.pixelWidth,
    pixelHeight: img.pixelHeight,
    crop: { x: 0, y: 0, w: 1, h: 1 },
  };
}

export function layerMethod(config: DesignConfig, layer: Layer): PrintMethod {
  return layer.method ?? config.printMethod;
}

/** Duplicate a layer with a small offset. */
export function duplicateLayer(layer: Layer): Layer {
  return { ...structuredClone(layer), id: newLayerId(layer.type), name: `${layer.name} copy`, x: layer.x + 1.5, y: layer.y + 1.5, locked: false };
}

/** Summarise a design in one line (used for cards, orders, Muse). */
export function designSummary(config: DesignConfig): string {
  const model = getModel(config.modelId);
  const fabric = FABRIC_BY_ID.get(config.fabric.id);
  const texts = config.layers.filter((l) => l.type === "text").length;
  const gfx = config.layers.filter((l) => l.type !== "text").length;
  return `${model.name} · ${config.fit} · ${fabric?.name ?? config.fabric.id} ${config.fabric.gsm} GSM · size ${config.size}${texts ? ` · ${texts} text` : ""}${gfx ? ` · ${gfx} artwork` : ""}`;
}

export type { Construction };
