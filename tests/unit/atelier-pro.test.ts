import { describe, expect, it } from "vitest";
import { designConfigSchema, layerSchema, type Layer } from "@/lib/garment/schema";
import { NEUTRAL_ADJUST, adjustSchema, layerFilterSchema, FILTER_TYPES } from "@/lib/garment/layer-fx";
import { createDesign } from "@/lib/garment/design";
import { layerContext, layerMarkup, zoneLayersMarkup, NO_ASSETS, type AssetResolver } from "@/lib/render/compose";
import { adjustTables, curveFn, homography, warpFn } from "@/lib/render/layer-fx-svg";
import { magicWand, maskToShape, traceMask, colorRange, type Raster } from "@/lib/editor/raster-select";
import { alignLayers, cropLayerTo, invertShapes, maskWithSelection, uvToZone, zoneToUV } from "@/lib/editor/selection";
import { useEditor } from "@/lib/editor/store";

const star = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#1f6feb"/></svg>`;
const assets: AssetResolver = { svg: (u) => (u === "star" ? star : undefined), dataUrl: () => undefined, patternUrl: () => undefined };
const gfx = (id: string, extra: object = {}) => layerSchema.parse({ id, name: id, zone: "front", x: 0, y: 10, width: 10, height: 10, type: "graphic", source: "library", assetId: "a", url: "star", ...extra });

describe("design schema v3", () => {
  it("upgrades v2 documents losslessly with neutral Atelier Pro defaults", () => {
    const d = createDesign("tee-classic-crew", "men");
    const v2 = { ...JSON.parse(JSON.stringify(d)), schemaVersion: 2, folders: undefined, layers: [{ ...gfx("g1"), blendMode: undefined, mask: undefined, filters: undefined }] };
    const parsed = designConfigSchema.parse(v2);
    expect(parsed.schemaVersion).toBe(3);
    expect(parsed.folders).toEqual([]);
    const l = parsed.layers[0];
    expect(l.blendMode).toBe("normal");
    expect(l.mask).toBeNull();
    expect(l.filters).toEqual([]);
    expect(l.warp).toBeNull();
  });
  it("accepts drawing layers and rejects oversized strokes", () => {
    const ok = layerSchema.safeParse({ id: "d", name: "d", zone: "front", x: 0, y: 0, width: 20, height: 20, type: "drawing", strokes: [{ tool: "brush", color: "#ff0000", size: 0.02, points: [0.1, 0.1, 0.5] }] });
    expect(ok.success).toBe(true);
    const bad = layerSchema.safeParse({ id: "d", name: "d", zone: "front", x: 0, y: 0, width: 20, height: 20, type: "drawing", strokes: [{ tool: "brush", color: "#ff0000", size: 0.02, points: Array(2000).fill(0.5) }] });
    expect(bad.success).toBe(false);
  });
});

describe("composer: non-destructive layer effects", () => {
  it("renders blend modes, folders and opacity", () => {
    const l = gfx("g1", { blendMode: "multiply", opacity: 0.5, groupId: "f1" });
    const out = layerMarkup(l, assets, { folder: { id: "f1", name: "F", collapsed: false, visible: true, locked: false, opacity: 0.5 } });
    expect(out).toContain('style="mix-blend-mode:multiply"');
    expect(out).toContain('opacity="0.25"');
    expect(layerMarkup(l, assets, { folder: { id: "f1", name: "F", collapsed: false, visible: false, locked: false, opacity: 1 } })).toBe("");
  });
  it("adds a luminance mask for layer masks and an alpha mask for clipping", () => {
    const base = gfx("base");
    const top = gfx("top", { clip: true, mask: { shapes: [{ kind: "rect", op: "subtract", x: 0.25, y: 0.25, w: 0.5, h: 0.5 }] } });
    const cfg = { layers: [base, top], folders: [] };
    const ctx = layerContext(cfg, top);
    expect(ctx.clipBase?.id).toBe("base");
    const out = layerMarkup(top, assets, ctx);
    expect(out).toMatch(/<mask id="lm-top"[^>]*maskUnits="userSpaceOnUse"/);
    expect(out).toContain('fill="#000"');
    expect(out).toMatch(/<mask id="cm-top"[^>]*style="mask-type:alpha"/);
    expect(out).toContain('data-layer="base"'); // clip base rendered inside the mask
    // unclipped layer at the bottom has no clip base
    expect(layerContext(cfg, base).clipBase).toBeNull();
  });
  it("emits a filter primitive chain for every filter type", () => {
    for (const type of FILTER_TYPES) {
      const out = layerMarkup(gfx("f", { filters: [layerFilterSchema.parse({ type })] }), assets);
      expect(out, type).toMatch(/<filter id="fx-f"[^>]*filterUnits="userSpaceOnUse"/);
      expect(out, type).toContain('filter="url(#fx-f)"');
    }
    expect(layerMarkup(gfx("f", { filters: [{ type: "halftone", angle: 30 }] }), assets)).toContain("rotate(30)");
  });
  it("builds piecewise-affine warps from clip triangles", () => {
    const out = layerMarkup(gfx("w", { warp: { kind: "perspective", corners: [0.1, 0, 0.9, 0, 1, 1, 0, 1] } }), assets);
    expect((out.match(/<clipPath id="wt-w-/g) ?? []).length).toBe(8 * 8 * 2);
    expect(out).toContain('<use href="#wc-w"');
  });
  it("renders drawings with eraser masks and retouch copies", () => {
    const d = layerSchema.parse({ id: "d", name: "d", zone: "front", x: 0, y: 10, width: 20, height: 20, type: "drawing", strokes: [
      { tool: "brush", color: "#ff0000", size: 0.05, points: [0.1, 0.5, 0.5, 0.9, 0.5, 0.5] },
      { tool: "eraser", color: "#000000", size: 0.05, points: [0.5, 0, 0.5, 0.5, 1, 0.5] },
      { tool: "calligraphy", color: "#0000ff", size: 0.05, points: [0.1, 0.1, 0.5, 0.9, 0.2, 0.5] },
    ] });
    const out = layerMarkup(d, assets);
    expect(out).toContain('mask="url(#de-d-1)"');
    expect(out).toContain('stroke="#ff0000"');
    expect(out).toContain('fill="#0000ff"');
    const r = layerMarkup(gfx("r", { retouch: [{ tool: "clone", size: 0.1, points: [0.2, 0.2, 0.3, 0.3], dx: 0.4, dy: 0 }] }), assets);
    expect(r).toContain('<g id="rc-r">');
    expect(r).toContain('translate(-4 0)');
  });
  it("uses gradients for text fills and namespaces ids per render", () => {
    const d = createDesign("tee-classic-crew", "men");
    const t = { ...(layerSchema.parse({ id: "t1", name: "t", zone: "front", x: 0, y: 10, width: 10, height: 3, type: "text", text: "HI", fontFamily: "Inter", fontSize: 2, color: "#111111", curve: { mode: "none", amount: 0 }, outline: { enabled: false, color: "#000000", width: 0 }, shadow: { enabled: false, color: "#000000", offsetX: 0, offsetY: 0, blur: 0 }, background: { enabled: false, color: "#000000", padding: 0, radius: 0 }, fill: { kind: "linear", angle: 0, stops: [{ offset: 0, color: "#ff0000" }, { offset: 1, color: "#0000ff" }] } }) as Layer) };
    const out = zoneLayersMarkup({ ...d, layers: [t] }, "front", NO_ASSETS, { idPrefix: "x-" });
    expect(out).toContain('<linearGradient id="tf-x-t1"');
    expect(out).toContain('fill="url(#tf-x-t1)"');
  });
});

describe("adjustment maths", () => {
  it("neutral adjustments are the identity and are omitted", () => {
    const [r] = adjustTables(NEUTRAL_ADJUST);
    expect(r[0]).toBe(0);
    expect(r[16]).toBeCloseTo(0.5, 3);
    expect(layerMarkup(gfx("n", { adjust: NEUTRAL_ADJUST }), assets)).not.toContain("<filter");
  });
  it("exposure +1 EV doubles linear light; levels and curves map as expected", () => {
    const [r] = adjustTables(adjustSchema.parse({ exposure: 1 }));
    const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    expect(lin(r[8])).toBeCloseTo(Math.min(1, 2 * lin(8 / 32)), 2);
    const [lv] = adjustTables(adjustSchema.parse({ levels: { inBlack: 0.25, inWhite: 0.75 } }));
    expect(lv[8]).toBe(0); // 0.25 → black
    expect(lv[24]).toBe(1); // 0.75 → white
    const c = curveFn([[0, 0], [0.5, 0.25], [1, 1]]);
    expect(c(0.5)).toBeCloseTo(0.25, 5);
    for (let x = 0; x < 1; x += 0.05) expect(c(x + 0.05)).toBeGreaterThanOrEqual(c(x) - 1e-9); // monotone
  });
  it("perspective maps the unit square onto the corner pins", () => {
    const corners = [0.1, 0, 0.9, 0.05, 1, 1, 0, 0.95];
    const h = homography(corners);
    [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([u, v], i) => {
      const [x, y] = h(u, v);
      expect(x).toBeCloseTo(corners[i * 2], 6);
      expect(y).toBeCloseTo(corners[i * 2 + 1], 6);
    });
    const id = warpFn({ kind: "mesh", corners: [], preset: "arc", bend: 0, h: 0, v: 0, mesh: Array(50).fill(0) });
    expect(id(0.3, 0.7)[0]).toBeCloseTo(0.3, 6);
  });
});

describe("pixel selections", () => {
  // 20×20 image: red square (4..15) with a transparent 4×4 hole in the middle.
  const W = 20;
  const data = new Uint8ClampedArray(W * W * 4);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const inSq = x >= 4 && x < 16 && y >= 4 && y < 16;
    const hole = x >= 8 && x < 12 && y >= 8 && y < 12;
    if (inSq && !hole) { data[i] = 220; data[i + 3] = 255; }
  }
  const r: Raster = { data, width: W, height: W };
  it("magic wand selects the contiguous region within tolerance", () => {
    const m = magicWand(r, 5, 5, 10, true);
    expect(m.reduce((a, v) => a + v, 0)).toBe(12 * 12 - 16);
    const outside = magicWand(r, 0, 0, 10, true);
    expect(outside[0]).toBe(1);
    expect(outside[5 * W + 5]).toBe(0);
    expect(outside[10 * W + 10]).toBe(0); // hole is not connected to the outside
    expect(magicWand(r, 0, 0, 10, false)[10 * W + 10]).toBe(1); // global
  });
  it("traces outer boundary and hole as closed rings", () => {
    const m = magicWand(r, 5, 5, 10, true);
    const rings = traceMask(m, W, W);
    expect(rings.length).toBe(2);
    const shape = maskToShape(m, W, W)!;
    expect(shape.kind).toBe("path");
    expect(shape.rings.length).toBe(2);
    const xs = shape.rings[0].filter((_, i) => i % 2 === 0);
    expect(Math.min(...xs)).toBeCloseTo(4 / W, 1);
    expect(Math.max(...xs)).toBeCloseTo(16 / W, 1);
  });
  it("colour range ignores transparent pixels", () => {
    const m = colorRange(r, "#dc0000", 20);
    expect(m.reduce((a, v) => a + v, 0)).toBe(12 * 12 - 16);
  });
});

describe("selection helpers", () => {
  const l = gfx("s", { x: 3, y: 12, width: 8, height: 4, rotation: 30, flipX: true });
  it("zone ↔ layer coordinates round-trip with rotation and flips", () => {
    const p = uvToZone(l, 0.2, 0.7);
    const [u, v] = zoneToUV(l, p);
    expect(u).toBeCloseTo(0.2, 9);
    expect(v).toBeCloseTo(0.7, 9);
  });
  it("commits selections to masks (keep, erase, invert)", () => {
    const sel = [{ kind: "rect" as const, op: "add" as const, x: 0.1, y: 0.1, w: 0.5, h: 0.5, points: [], rings: [], size: 0.05, feather: 0 }];
    const keep = maskWithSelection(null, sel, "keep");
    expect(keep.base).toBe("hide");
    expect(keep.shapes[0].op).toBe("add");
    const erase = maskWithSelection(null, sel, "erase");
    expect(erase.base).toBe("reveal");
    expect(erase.shapes[0].op).toBe("subtract");
    const erasedOnInverted = maskWithSelection({ enabled: true, base: "reveal", invert: true, shapes: [] }, sel, "erase");
    expect(erasedOnInverted.shapes[0].op).toBe("add");
    const inv = invertShapes(sel);
    expect(inv[0].w).toBe(2);
    expect(inv[1].op).toBe("subtract");
  });
  it("crop to selection keeps the artwork in place on the garment", () => {
    const g = gfx("c", { x: 0, y: 10, width: 10, height: 10 });
    const before = uvToZone(g, 0.5, 0.75);
    const c = cropLayerTo(g, { x0: 0.5, y0: 0.5, x1: 1, y1: 1 });
    expect(c.type === "graphic" && c.crop).toEqual({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
    expect(c.width).toBe(5);
    const after = uvToZone(c, 0, 0.5);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });
  it("aligns to the print area or to each other", () => {
    const a = gfx("a", { x: -5, width: 4 });
    const b = gfx("b", { x: 6, width: 2 });
    const moves = alignLayers([a, b], "left", { x0: -20, y0: 0, x1: 20, y1: 40 });
    expect(moves.a.x).toBe(-5);
    expect(moves.b.x).toBe(-6);
    expect(alignLayers([b], "right", { x0: -20, y0: 0, x1: 20, y1: 40 }).b.x).toBe(19);
  });
});

describe("editor history", () => {
  it("undo after a slider drag returns to the state before the drag", () => {
    const d = createDesign("tee-classic-crew", "men");
    const st = useEditor.getState();
    st.init({ projectId: null, name: "t", mode: "pro", version: 1, config: { ...d, layers: [gfx("g")] } });
    st.transient((c) => void (c.layers[0].opacity = 0.7));
    st.transient((c) => void (c.layers[0].opacity = 0.4));
    st.checkpoint("Opacity");
    expect(useEditor.getState().config.layers[0].opacity).toBe(0.4);
    useEditor.getState().undo();
    expect(useEditor.getState().config.layers[0].opacity).toBe(1);
    // drag pattern: checkpoint first, then live changes, then endGesture
    useEditor.getState().checkpoint("Move");
    useEditor.getState().transient((c) => void (c.layers[0].x = 4));
    useEditor.getState().endGesture();
    useEditor.getState().transient((c) => void (c.layers[0].opacity = 0.3));
    useEditor.getState().checkpoint("Opacity");
    useEditor.getState().undo();
    expect(useEditor.getState().config.layers[0].opacity).toBe(1);
    expect(useEditor.getState().config.layers[0].x).toBe(4);
    useEditor.getState().jumpHistory(-1);
    expect(useEditor.getState().config.layers[0].x).toBe(0);
    useEditor.getState().jumpHistory(2);
    expect(useEditor.getState().config.layers[0].opacity).toBe(0.3);
  });
});

describe("production checks for Atelier Pro effects", () => {
  it("flags blend previews, gradient embroidery and soft strokes; prices drawing colours", async () => {
    const { validateDesign } = await import("@/lib/garment/validation");
    const { layerColours } = await import("@/lib/garment/pricing");
    const d = createDesign("tee-classic-crew", "men");
    const t = layerSchema.parse({ id: "t", name: "t", zone: "front", x: 0, y: 12, width: 10, height: 3, type: "text", text: "HI", fontFamily: "Inter", fontSize: 2, color: "#111111", method: "embroidery", curve: { mode: "none", amount: 0 }, outline: { enabled: false, color: "#000000", width: 0 }, shadow: { enabled: false, color: "#000000", offsetX: 0, offsetY: 0, blur: 0 }, background: { enabled: false, color: "#000000", padding: 0, radius: 0 }, fill: { kind: "linear", angle: 0, stops: [{ offset: 0, color: "#ff0000" }, { offset: 1, color: "#0000ff" }] } });
    const dr = layerSchema.parse({ id: "d", name: "d", zone: "front", x: 0, y: 25, width: 10, height: 10, type: "drawing", method: "embroidery", blendMode: "multiply", strokes: [{ tool: "airbrush", color: "#00aa00", size: 0.05, points: [0.1, 0.1, 0.5, 0.9, 0.9, 0.5] }, { tool: "brush", color: "#00AA00", size: 0.05, points: [0.1, 0.5, 0.5, 0.9, 0.5, 0.5] }] });
    const codes = validateDesign({ ...d, layers: [t, dr] }).issues.map((i) => i.code);
    expect(codes).toContain("EMBROIDERY_GRADIENT");
    expect(codes).toContain("BLEND_PREVIEW");
    expect(codes).toContain("EMBROIDERY_SOFT_STROKES");
    expect(layerColours(dr)).toEqual(["#00AA00"]);
  });
});
