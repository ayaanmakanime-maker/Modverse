"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import clsx from "clsx";
import { ZoomIn, ZoomOut, Grid3x3, Square, Maximize } from "lucide-react";
import { useEditor } from "@/lib/editor/store";
import { GarmentFlat, flatViewBox } from "@/components/garment/GarmentFlat";
import { computeMeasurements } from "@/lib/garment/sizing";
import { printableArea, sleeveShape, zoneCanvas, polygonToPath, rotatedBounds, type Rect } from "@/lib/garment/panels";
import { layerMarkup, patternDef, type AssetResolver } from "@/lib/render/compose";
import { assetVersion, ensureDesignAssets, getDataUrl, getPatternUrl, getSvg, subscribeAssets } from "@/lib/render/assets";
import { availableZones, panelColor } from "@/lib/garment/design";
import type { Layer } from "@/lib/garment/schema";
import type { Zone } from "@/lib/garment/types";
import { isDark } from "@/lib/color";

const resolver: AssetResolver = { svg: getSvg, dataUrl: getDataUrl, patternUrl: getPatternUrl };

export const ZONE_LABELS: Record<Zone, string> = { front: "Front", back: "Back", sleeveLeft: "Left sleeve", sleeveRight: "Right sleeve", collar: "Collar", pocket: "Pocket", yoke: "Yoke" };

type Gesture =
  | { kind: "move"; start: { x: number; y: number }; origs: Layer[] }
  | { kind: "scale"; start: { x: number; y: number }; origs: Layer[]; center: { x: number; y: number } }
  | { kind: "rotate"; start: { x: number; y: number }; origs: Layer[]; center: { x: number; y: number } };

function useAssetsTick() {
  return useSyncExternalStore(subscribeAssets, assetVersion, () => 0);
}

export function Canvas2D({ compact }: { compact?: boolean }) {
  const config = useEditor((s) => s.config);
  const zone = useEditor((s) => s.zone);
  const setZone = useEditor((s) => s.setZone);
  const selectedId = useEditor((s) => s.selectedId);
  const multi = useEditor((s) => s.multi);
  const select = useEditor((s) => s.select);
  const checkpoint = useEditor((s) => s.checkpoint);
  const transient = useEditor((s) => s.transient);
  const setMeasured = useEditor((s) => s.setMeasured);
  const tick = useAssetsTick();
  const [zoom, setZoom] = useState(1);
  const [grid, setGrid] = useState(false);
  const [bounds, setBounds] = useState(true);
  const [guides, setGuides] = useState<{ v: number | null; h: number | null }>({ v: null, h: null });
  const svgRef = useRef<SVGSVGElement | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const m = useMemo(() => computeMeasurements(config), [config]);
  const zones = availableZones(config);

  useEffect(() => {
    ensureDesignAssets(config).catch(() => undefined);
  }, [config]);
  useEffect(() => {
    if (!zones.includes(zone)) setZone("front");
  }, [zones, zone, setZone]);

  const layers = config.layers.filter((l) => l.zone === zone);
  const area = printableArea(m, zone, config.garmentType, config.construction);
  const canvas = zoneCanvas(m, zone);
  const isTorso = zone === "front" || zone === "back";
  const baseVb: [number, number, number, number] = isTorso ? flatViewBox(m, true, config.construction, config.audience === "kids") : [canvas.x0 - 2, canvas.y0 - 2, canvas.x1 - canvas.x0 + 4, canvas.y1 - canvas.y0 + 4];
  const vb = baseVb;

  // Measure real text bounding boxes after render (fonts must be loaded).
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    for (const l of layers) {
      if (l.type !== "text") continue;
      const el = svg.querySelector(`[data-layer="${CSS.escape(l.id)}"] .mv-text-content`) as SVGGraphicsElement | null;
      if (!el) continue;
      try {
        const b = el.getBBox();
        if (b.width > 0 && b.height > 0) setMeasured(l.id, b.width, b.height);
      } catch {
        /* not rendered */
      }
    }
  });
  useEffect(() => {
    if (typeof document === "undefined" || !("fonts" in document)) return;
    const done = () => useEditor.setState((s) => ({ config: { ...s.config } }));
    document.fonts.addEventListener("loadingdone", done);
    return () => document.fonts.removeEventListener("loadingdone", done);
  }, []);

  const toCm = useCallback((e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  }, []);

  const cmPerPx = useMemo(() => {
    const svg = svgRef.current;
    if (!svg) return 0.1;
    const ctm = svg.getScreenCTM();
    return ctm ? 1 / ctm.a : 0.1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, vb[2], vb[3], tick, config]);

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (e.button !== 0) return;
    const target = e.target as Element;
    const handle = target.closest("[data-handle]")?.getAttribute("data-handle");
    const layerEl = target.closest("[data-layer-id]");
    const p = toCm(e);
    const state = useEditor.getState();
    if (handle && state.selectedId) {
      const sel = state.config.layers.find((l) => l.id === state.selectedId);
      if (!sel || sel.locked) return;
      checkpoint(handle === "rotate" ? "Rotate" : "Resize");
      gesture.current = { kind: handle === "rotate" ? "rotate" : "scale", start: p, origs: [sel], center: { x: sel.x, y: sel.y } } as Gesture;
      (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
      return;
    }
    if (layerEl) {
      const id = layerEl.getAttribute("data-layer-id")!;
      select(id, e.shiftKey);
      const s2 = useEditor.getState();
      const ids = s2.multi.length ? s2.multi : [id];
      const origs = s2.config.layers.filter((l) => ids.includes(l.id) && !l.locked);
      if (!origs.length) return;
      checkpoint("Move");
      gesture.current = { kind: "move", start: p, origs };
      (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
      return;
    }
    select(null);
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const g = gesture.current;
    if (!g) return;
    const p = toCm(e);
    const ids = g.origs.map((o) => o.id);
    if (g.kind === "move") {
      let dx = p.x - g.start.x;
      let dy = p.y - g.start.y;
      let gv: number | null = null;
      let gh: number | null = null;
      if (g.origs.length === 1 && !e.altKey) {
        const o = g.origs[0];
        const tol = Math.max(0.4, cmPerPx * 8);
        if (Math.abs(o.x + dx) < tol) {
          dx = -o.x;
          gv = 0;
        }
        const b = rotatedBounds(o.x + dx, o.y + dy, o.width, o.height, o.rotation);
        if (Math.abs(b.y0 - area.y0) < tol) {
          dy += area.y0 - b.y0;
          gh = area.y0;
        } else if (Math.abs((o.y + dy) - (area.y0 + area.y1) / 2) < tol) {
          dy = (area.y0 + area.y1) / 2 - o.y;
          gh = (area.y0 + area.y1) / 2;
        }
      }
      setGuides({ v: gv, h: gh });
      transient((d) => {
        for (const l of d.layers) {
          const o = g.origs.find((x) => x.id === l.id);
          if (o) {
            l.x = +(o.x + dx).toFixed(2);
            l.y = +(o.y + dy).toFixed(2);
          }
        }
      });
    } else if (g.kind === "scale") {
      const o = g.origs[0];
      const d0 = Math.hypot(g.start.x - g.center.x, g.start.y - g.center.y) || 1;
      const d1 = Math.hypot(p.x - g.center.x, p.y - g.center.y);
      const f = Math.max(0.05, d1 / d0);
      transient((d) => {
        const l = d.layers.find((x) => ids.includes(x.id));
        if (!l) return;
        l.width = +Math.max(0.3, o.width * f).toFixed(2);
        l.height = +Math.max(0.3, o.height * f).toFixed(2);
        if (l.type === "text" && o.type === "text") l.fontSize = +Math.max(0.3, o.fontSize * f).toFixed(2);
      });
    } else {
      const o = g.origs[0];
      const a0 = Math.atan2(g.start.y - g.center.y, g.start.x - g.center.x);
      const a1 = Math.atan2(p.y - g.center.y, p.x - g.center.x);
      let r = o.rotation + ((a1 - a0) * 180) / Math.PI;
      r = ((r + 540) % 360) - 180;
      if (!e.altKey) {
        const snap = Math.round(r / 15) * 15;
        if (Math.abs(snap - r) < 3) r = snap;
      }
      transient((d) => {
        const l = d.layers.find((x) => ids.includes(x.id));
        if (l) l.rotation = +r.toFixed(1);
      });
    }
  }

  function onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    if (gesture.current) {
      gesture.current = null;
      setGuides({ v: null, h: null });
      try {
        (e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
  }

  const bg = panelColor(config, zone);
  const guideColor = isDark(bg) ? "#F3EFE8" : "#111111";
  const selected = layers.find((l) => l.id === selectedId) ?? null;
  const handle = Math.max(0.35, cmPerPx * 10);

  const overlay = (
    <g>
      {grid && (
        <g opacity={0.35} pointerEvents="none">
          {Array.from({ length: Math.ceil(vb[2]) + 1 }).map((_, i) => {
            const x = Math.floor(vb[0]) + i;
            return <line key={`gx${i}`} x1={x} x2={x} y1={vb[1]} y2={vb[1] + vb[3]} stroke={guideColor} strokeWidth={x % 5 === 0 ? 0.05 : 0.02} />;
          })}
          {Array.from({ length: Math.ceil(vb[3]) + 1 }).map((_, i) => {
            const y = Math.floor(vb[1]) + i;
            return <line key={`gy${i}`} y1={y} y2={y} x1={vb[0]} x2={vb[0] + vb[2]} stroke={guideColor} strokeWidth={y % 5 === 0 ? 0.05 : 0.02} />;
          })}
        </g>
      )}
      {bounds && (
        <g pointerEvents="none">
          <rect x={area.x0} y={area.y0} width={area.x1 - area.x0} height={area.y1 - area.y0} fill="none" stroke={guideColor} strokeOpacity={0.5} strokeWidth={Math.max(0.06, cmPerPx * 1.2)} strokeDasharray={`${handle * 0.8} ${handle * 0.6}`} />
          <line x1={0} x2={0} y1={area.y0 - 2} y2={area.y1 + 2} stroke={guideColor} strokeOpacity={0.25} strokeWidth={cmPerPx} />
          <text x={area.x0} y={area.y0 - handle * 0.6} fontSize={handle * 1.1} fill={guideColor} opacity={0.6} fontFamily="Inter">Print area {(area.x1 - area.x0).toFixed(0)} × {(area.y1 - area.y0).toFixed(0)} cm</text>
        </g>
      )}
      {layers.map((l) => (
        <g key={l.id} data-layer-id={l.id} style={{ cursor: l.locked ? "not-allowed" : "move" }} dangerouslySetInnerHTML={{ __html: layerMarkup(l, resolver) }} />
      ))}
      {guides.v !== null && <line x1={guides.v} x2={guides.v} y1={vb[1]} y2={vb[1] + vb[3]} stroke="#C9B896" strokeWidth={cmPerPx * 1.5} pointerEvents="none" />}
      {guides.h !== null && <line y1={guides.h} y2={guides.h} x1={vb[0]} x2={vb[0] + vb[2]} stroke="#C9B896" strokeWidth={cmPerPx * 1.5} pointerEvents="none" />}
      {layers.filter((l) => multi.includes(l.id) && l.id !== selectedId).map((l) => (
        <rect key={`m-${l.id}`} x={l.x - l.width / 2} y={l.y - l.height / 2} width={l.width} height={l.height} transform={`rotate(${l.rotation} ${l.x} ${l.y})`} fill="none" stroke="#C9B896" strokeDasharray={`${handle * 0.5}`} strokeWidth={cmPerPx * 1.2} pointerEvents="none" />
      ))}
      {selected && (
        <g transform={`translate(${selected.x} ${selected.y}) rotate(${selected.rotation})`}>
          <rect x={-selected.width / 2} y={-selected.height / 2} width={selected.width} height={selected.height} fill="none" stroke="#C9B896" strokeWidth={cmPerPx * 1.5} strokeDasharray={selected.locked ? `${handle * 0.4}` : undefined} pointerEvents="none" />
          {!selected.locked && (
            <>
              {[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => (
                <rect key={`${sx}${sy}`} data-handle="scale" x={(sx * selected.width) / 2 - handle / 2} y={(sy * selected.height) / 2 - handle / 2} width={handle} height={handle} fill="#F3EFE8" stroke="#111" strokeWidth={cmPerPx} style={{ cursor: "nwse-resize" }} />
              ))}
              <line x1={0} x2={0} y1={-selected.height / 2} y2={-selected.height / 2 - handle * 2.4} stroke="#C9B896" strokeWidth={cmPerPx * 1.2} pointerEvents="none" />
              <circle data-handle="rotate" cx={0} cy={-selected.height / 2 - handle * 2.6} r={handle * 0.6} fill="#C9B896" stroke="#111" strokeWidth={cmPerPx} style={{ cursor: "grab" }} />
            </>
          )}
        </g>
      )}
    </g>
  );

  const svgProps = {
    ref: svgRef,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    style: { touchAction: "none", width: `${100 * zoom}%`, height: `${100 * zoom}%`, maxWidth: "none" } as React.CSSProperties,
    "data-testid": "canvas-2d",
  };

  let content: React.ReactNode;
  if (isTorso) {
    content = <GarmentFlat config={config} view={zone} measurements={m} overlay={overlay} svgProps={svgProps} viewBoxOverride={vb} title={`${zone} 2D editor`} />;
  } else {
    let shape: React.ReactNode;
    if (zone === "sleeveLeft" || zone === "sleeveRight") {
      const sl = sleeveShape(m, config.construction);
      const [defs, fill] = patternDef(config, zone, resolver, "c2d");
      shape = (
        <>
          <defs dangerouslySetInnerHTML={{ __html: defs }} />
          <path d={polygonToPath(sl.outline)} fill={fill ?? bg} stroke={guideColor} strokeOpacity={0.4} strokeWidth={0.15} />
          <line x1={0} x2={0} y1={0} y2={sl.length} stroke={guideColor} strokeOpacity={0.2} strokeWidth={0.08} strokeDasharray="0.5 0.4" />
          <text x={0} y={sl.length + 1.4} fontSize={0.9} fill={guideColor} opacity={0.5} textAnchor="middle" fontFamily="Inter">outer sleeve · centre line</text>
        </>
      );
    } else {
      const [defs, fill] = patternDef(config, zone, resolver, "c2d");
      shape = (
        <>
          <defs dangerouslySetInnerHTML={{ __html: defs }} />
          <rect x={canvas.x0} y={canvas.y0} width={canvas.x1 - canvas.x0} height={canvas.y1 - canvas.y0} rx={zone === "pocket" ? 0.4 : 0.8} fill={fill ?? bg} stroke={guideColor} strokeOpacity={0.4} strokeWidth={0.1} />
        </>
      );
    }
    content = (
      <svg {...svgProps} viewBox={vb.join(" ")} xmlns="http://www.w3.org/2000/svg" role="img" aria-label={`${zone} 2D editor`}>
        {shape}
        {overlay}
      </svg>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-1 border-b border-line px-2 py-1.5">
        <div role="tablist" aria-label="Garment zone" className="flex flex-wrap gap-1">
          {zones.map((z) => (
            <button key={z} role="tab" aria-selected={zone === z} onClick={() => setZone(z)} className={clsx("rounded-full px-2.5 py-1 text-[0.7rem] transition", zone === z ? "bg-bone text-ink" : "text-bone-2 hover:bg-surface-3")} data-testid={`zone-${z}`}>
              {ZONE_LABELS[z]}
              {config.layers.some((l) => l.zone === z) && <span className="ml-1 opacity-60">•</span>}
            </button>
          ))}
        </div>
        {!compact && (
          <div className="ml-auto flex items-center gap-0.5">
            <button className="rounded p-1.5 text-mute hover:text-bone" title="Zoom out" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(1, +(z - 0.5).toFixed(1)))}><ZoomOut className="size-4" /></button>
            <span className="w-10 text-center text-[0.68rem] tabular-nums text-mute">{Math.round(zoom * 100)}%</span>
            <button className="rounded p-1.5 text-mute hover:text-bone" title="Zoom in" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(4, z + 0.5))}><ZoomIn className="size-4" /></button>
            <button className="rounded p-1.5 text-mute hover:text-bone" title="Fit" aria-label="Fit to view" onClick={() => setZoom(1)}><Maximize className="size-4" /></button>
            <button className={clsx("rounded p-1.5", grid ? "text-bone" : "text-mute")} title="Grid (1 cm)" aria-pressed={grid} aria-label="Toggle grid" onClick={() => setGrid((g) => !g)}><Grid3x3 className="size-4" /></button>
            <button className={clsx("rounded p-1.5", bounds ? "text-bone" : "text-mute")} title="Print boundaries & guides" aria-pressed={bounds} aria-label="Toggle print boundaries" onClick={() => setBounds((b) => !b)}><Square className="size-4" /></button>
          </div>
        )}
      </div>
      <div className="relative min-h-0 flex-1 overflow-auto mv-scroll bg-[radial-gradient(ellipse_at_center,#1a1a1c_0%,#0a0a0b_70%)]">
        <div className="flex h-full w-full items-center justify-center p-3" style={{ minWidth: `${100 * zoom}%`, minHeight: `${100 * zoom}%` }}>
          {content}
        </div>
        {layers.length === 0 && <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-ink/70 px-3 py-1 text-[0.7rem] text-mute">Add text or graphics from the panel — drag to move, corners to resize, ● to rotate</p>}
      </div>
    </div>
  );
}

export type { Rect };
