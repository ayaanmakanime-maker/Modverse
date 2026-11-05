import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { GARMENT_MODELS } from "@/lib/garment/models";
import { availableZones, createDesign, createGraphicLayer, createImageLayer, createTextLayer, normalizeDesign } from "@/lib/garment/design";
import { DESIGN_SCHEMA_VERSION, designConfigSchema, layerSchema } from "@/lib/garment/schema";
import { applyOperations } from "@/lib/garment/operations";
import { validateDesign } from "@/lib/garment/validation";
import { computeMeasurements } from "@/lib/garment/sizing";
import { placementPreset, printableArea, zoneCanvas } from "@/lib/garment/panels";
import { layerMarkup, NO_ASSETS, titleCase, transformText, zoneTextureSvg } from "@/lib/render/compose";
import { buildGarmentGeometry } from "@/lib/three/garment-geometry";
import { presetLayer, searchTypography, TYPOGRAPHY_PRESETS } from "@/lib/typography/presets";
import { FONT_BY_FAMILY } from "@/lib/typography/fonts";
import { customFontFamily, detectFont } from "@/lib/services/uploads";

const svgAssets = { svg: () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><rect width="100" height="50" fill="#ff0000"/></svg>`, dataUrl: () => "data:image/png;base64,AAAA", patternUrl: () => undefined };

describe("design schema v2", () => {
  it("is version 2 and upgrades stored v1 documents losslessly", () => {
    const d = createDesign("tee-classic-crew", "men");
    expect(d.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
    const t = createTextLayer(d, "HELLO");
    const g = createGraphicLayer(d, { id: "MVG_001", name: "g", url: "/library/x.svg", width: 100, height: 100 });
    // Simulate a V1 document: version 1, no v2 fields.
    const v1 = JSON.parse(JSON.stringify({ ...d, schemaVersion: 1, layers: [t, g] }));
    delete v1.layers[0].effects;
    delete v1.layers[0].fontAssetId;
    delete v1.layers[1].crop;
    const up = designConfigSchema.parse(v1);
    expect(up.schemaVersion).toBe(2);
    const [ut, ug] = up.layers;
    expect(ut.type === "text" && ut.effects).toEqual([]);
    expect(ut.type === "text" && ut.fontAssetId).toBeNull();
    expect(ug.type === "graphic" && ug.crop).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(ut.text).toBe("HELLO");
    // unknown future versions are rejected rather than silently accepted
    expect(designConfigSchema.safeParse({ ...d, schemaVersion: 3 }).success).toBe(false);
  });
});

describe("typography", () => {
  it("applies true title case (minor words lower-case, acronyms kept)", () => {
    expect(titleCase("the art of the everyday")).toBe("The Art of the Everyday");
    expect(titleCase("made in NYC for the people")).toBe("Made in NYC for the People");
    expect(titleCase("rise and shine\nall day long")).toBe("Rise and Shine\nAll Day Long");
    expect(transformText({ text: "o'neil's team", textTransform: "capitalize" })).toBe("O'neil's Team");
  });

  it("renders layered effects behind the main text (extrude = stepped copies)", () => {
    const d = createDesign("tee-classic-crew", "men");
    const t = { ...createTextLayer(d, "RETRO"), effects: [{ kind: "extrude" as const, color: "#C2410C", width: 0, offsetX: 0.5, offsetY: 0.5, blur: 0, opacity: 1 }, { kind: "glow" as const, color: "#FDE68A", width: 0.3, offsetX: 0, offsetY: 0, blur: 0.2, opacity: 0.8 }] };
    const svg = layerMarkup(t, NO_ASSETS);
    expect(svg.match(/fill="#C2410C"/g)!.length).toBeGreaterThan(5);
    expect(svg).toContain("feGaussianBlur");
    // effects precede the main text group (painted underneath)
    expect(svg.indexOf("#C2410C")).toBeLessThan(svg.indexOf("mv-text-content"));
    expect(svg.indexOf("#FDE68A")).toBeLessThan(svg.indexOf("#C2410C"));
  });

  it("ships editable typography presets that are valid on every garment", () => {
    expect(TYPOGRAPHY_PRESETS.length).toBeGreaterThanOrEqual(20);
    expect(searchTypography("monogram").length).toBeGreaterThan(0);
    for (const p of TYPOGRAPHY_PRESETS) expect(p.style.fontFamily && FONT_BY_FAMILY.has(p.style.fontFamily)).toBe(true);
    for (const m of GARMENT_MODELS) {
      const d = createDesign(m.id, m.audiences[0]);
      for (const p of TYPOGRAPHY_PRESETS) {
        const zones = availableZones(d);
        const l = presetLayer(d, p, zones.includes(placementPreset(computeMeasurements(d), p.preset).zone) ? undefined : "center-chest");
        expect(layerSchema.safeParse(l).success).toBe(true);
      }
    }
  });
});

describe("crop", () => {
  it("crops images and graphics through the viewBox and uses cropped pixels for DPI", () => {
    const d = createDesign("tee-classic-crew", "men");
    const img = { ...createImageLayer(d, { id: "u1", name: "photo", url: "/api/uploads/u1", pixelWidth: 2000, pixelHeight: 1000 }), crop: { x: 0.25, y: 0, w: 0.5, h: 1 } };
    expect(layerMarkup(img, svgAssets)).toContain('viewBox="500 0 1000 1000"');
    const gfx = { ...createGraphicLayer(d, { id: "MVG_001", name: "g", url: "/x.svg", width: 100, height: 50 }), crop: { x: 0.5, y: 0, w: 0.5, h: 1 } };
    expect(layerMarkup(gfx, svgAssets)).toContain('viewBox="50 0 50 50"');
    // 1000 effective px over 10 cm = 254 DPI (uncropped it would be 508)
    const cfg = { ...d, layers: [{ ...img, width: 10, height: 10 }] };
    expect(validateDesign(cfg).issues.some((i) => i.code === "IMAGE_LOW_RES" || i.code === "IMAGE_MEDIUM_RES")).toBe(false);
    const tight = { ...d, layers: [{ ...img, crop: { x: 0, y: 0, w: 0.1, h: 1 }, width: 10, height: 10 }] };
    expect(validateDesign(tight).issues.some((i) => i.code === "IMAGE_LOW_RES")).toBe(true);
  });

  it("clamps crop windows that overflow the source", () => {
    const d = createDesign("tee-classic-crew", "men");
    const img = { ...createImageLayer(d, { id: "u1", name: "p", url: "/u", pixelWidth: 100, pixelHeight: 100 }), crop: { x: 0.6, y: 0.7, w: 0.9, h: 0.9 } };
    const n = normalizeDesign({ ...d, layers: [img] }).config.layers[0];
    expect(n.type === "image" && n.crop.x + n.crop.w).toBeLessThanOrEqual(1.0001);
    expect(n.type === "image" && n.crop.y + n.crop.h).toBeLessThanOrEqual(1.0001);
  });
});

describe("cuff surface", () => {
  it("exists only when the garment has cuffs and maps to 3D UVs", () => {
    const tee = createDesign("tee-classic-crew", "men");
    expect(availableZones(tee)).not.toContain("cuffs");
    const shirt = createDesign("shirt-classic-formal", "men");
    expect(availableZones(shirt)).toContain("cuffs");
    const m = computeMeasurements(shirt);
    const area = printableArea(m, "cuffs", "shirt", shirt.construction);
    const canvas = zoneCanvas(m, "cuffs");
    expect(area.x0).toBeGreaterThanOrEqual(canvas.x0);
    expect(area.y1).toBeLessThanOrEqual(canvas.y1);
    const geo = buildGarmentGeometry(shirt, { resolution: 16 });
    expect(geo.cuffs).toHaveLength(2);
    for (const c of geo.cuffs) for (const v of c.uvs) expect(v).toBeGreaterThanOrEqual(-0.0001), expect(v).toBeLessThanOrEqual(1.0001);
    const svg = zoneTextureSvg(shirt, "cuffs", m, NO_ASSETS);
    expect(svg.widthPx).toBeGreaterThan(100);
  });

  it("places a cuff monogram via operations and removes it when cuffs are removed", () => {
    const shirt = createDesign("shirt-classic-formal", "men");
    const r = applyOperations(shirt, [{ op: "addText", text: "RS", preset: "cuff", style: { method: "embroidery" } }]);
    expect(r.rejected).toEqual([]);
    expect(r.config.layers[0].zone).toBe("cuffs");
    const after = normalizeDesign({ ...r.config, construction: { ...r.config.construction, cuff: "hem", sleeveLength: "short" } });
    expect(after.config.layers.filter((l) => l.zone === "cuffs")).toHaveLength(0);
    expect(after.corrections.join(" ")).toMatch(/cuff/i);
  });
});

describe("custom fonts", () => {
  it("detects font files by signature and builds safe family names", () => {
    const dir = path.join(process.cwd(), "public/fonts/inter");
    const woff2 = readFileSync(path.join(dir, readdirSync(dir).find((f) => f.endsWith(".woff2"))!));
    expect(detectFont(woff2)?.mime).toBe("font/woff2");
    expect(detectFont(Buffer.from([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))?.mime).toBe("font/ttf");
    expect(detectFont(Buffer.from("OTTO00000000"))?.mime).toBe("font/otf");
    expect(detectFont(Buffer.from("<svg></svg>  "))).toBeNull();
    const fam = customFontFamily(`Evil'"<script>Font`, "0123abcd-0000-0000-0000-000000000000");
    expect(fam).toMatch(/^[A-Za-z0-9 ]+$/);
    expect(fam).toContain("MV0123ab");
  });

  it("validates custom-font text without flagging it as unsupported", () => {
    const d = createDesign("tee-classic-crew", "men");
    const t = { ...createTextLayer(d, "HELLO WORLD"), fontFamily: "My Brand MVabc123", fontAssetId: "abc" };
    const codes = validateDesign({ ...d, layers: [t] }).issues.map((i) => i.code);
    expect(codes).toContain("CUSTOM_FONT");
    expect(codes).not.toContain("FONT_UNSUPPORTED");
  });
});
