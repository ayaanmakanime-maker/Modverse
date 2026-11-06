"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import clsx from "clsx";
import { ZoomIn, ZoomOut, Grid3x3, Square, Maximize, Hand } from "lucide-react";
import { useEditor } from "@/lib/editor/store";
import { GarmentFlat, flatViewBox } from "@/components/garment/GarmentFlat";
import { computeMeasurements } from "@/lib/garment/sizing";
import { printableArea, sleeveShape, zoneCanvas, polygonToPath, rotatedBounds, type Rect } from "@/lib/garment/panels";
import { flatPatternFills, layerMarkup, patternDef, type AssetResolver } from "@/lib/render/compose";
import { assetVersion, ensureDesignAssets, getDataUrl, getPatternUrl, getSvg, subscribeAssets } from "@/lib/render/assets";
import { availableZones, panelColor } from "@/lib/garment/design";
import type { Layer } from "@/lib/garment/schema";
import type { Zone } from "@/lib/garment/types";
import { isDark } from "@/lib/color";
import { ACCEPTED_ARTWORK, DRAG_MIME, insertPayload, parsePayload, uploadAndInsert } from "@/lib/editor/insert";
import { useSession } from "@/components/session";
import { toast } from "@/components/ui";
import { errorMessage } from "@/lib/client/api";

const resolver: AssetResolver = { svg: getSvg, dataUrl: getDataUrl, patternUrl: getPatternUrl };

export const ZONE_LABELS: Record<Zone, string> = { front: "Front", back: "Back", sleeveLeft: "Left sleeve", sleeveRight: "Right sleeve", collar: "Collar", cuffs: "Cuff", pocket: "Pocket", yoke: "Yoke" };

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 8;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, +z.toFixed(3)));

type Gesture =
  | { kind: "pan"; client: { x: number; y: number }; pan: { x: number; y: number }; cmPerPx: number }
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
  const { user } = useSession();
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hand, setHand] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [dropping, setDropping] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
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
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [zone]);

  const layers = config.layers.filter((l) => l.zone === zone);
  const area = printableArea(m, zone, config.garmentType, config.construction);
  const canvas = zoneCanvas(m, zone);
  const isTorso = zone === "front" || zone === "back";
  const baseVb: [number, number, number, number] = isTorso ? flatViewBox(m, true, config.construction, config.audience === "kids") : [canvas.x0 - 2, canvas.y0 - 2, canvas.x1 - canvas.x0 + 4, canvas.y1 - canvas.y0 + 4];
  // Zoom & pan operate on the SVG viewBox (vector-sharp at any zoom level).
  const vb: [number, number, number, number] = [
    baseVb[0] + (baseVb[2] - baseVb[2] / zoom) / 2 + pan.x,
    baseVb[1] + (baseVb[3] - baseVb[3] / zoom) / 2 + pan.y,
    baseVb[2] / zoom,
    baseVb[3] / zoom,
  ];
  const vbRef = useRef(vb);
  vbRef.current = vb;
  const baseRef = useRef(baseVb);
  baseRef.current = baseVb;

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
  }, [zoom, pan.x, pan.y, vb[2], vb[3], tick, config]);

  /** Zoom by a factor keeping the point under (clientX, clientY) fixed on screen. */
  const zoomAt = useCallback((factor: number, client?: { clientX: number; clientY: number }) => {
    const svg = svgRef.current;
    setZoom((z0) => {
      const z1 = clampZoom(z0 * factor);
      if (z1 === z0) return z0;
      const cur = vbRef.current;
      const base = baseRef.current;
      const p = svg && client ? (() => {
        const pt = svg.createSVGPoint();
        pt.x = client.clientX;
        pt.y = client.clientY;
        const ctm = svg.getScreenCTM();
        return ctm ? pt.matrixTransform(ctm.inverse()) : { x: cur[0] + cur[2] / 2, y: cur[1] + cur[3] / 2 };
      })() : { x: cur[0] + cur[2] / 2, y: cur[1] + cur[3] / 2 };
      const w1 = base[2] / z1;
      const h1 = base[3] / z1;
      const nx0 = p.x - ((p.x - cur[0]) / cur[2]) * w1;
      const ny0 = p.y - ((p.y - cur[1]) / cur[3]) * h1;
      setPan({ x: nx0 - (base[0] + (base[2] - w1) / 2), y: ny0 - (base[1] + (base[3] - h1) / 2) });
      return z1;
    });
  }, []);
  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  // Wheel: Ctrl/⌘ + wheel or trackpad pinch zooms at the cursor; plain wheel pans when zoomed in.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomAt(Math.exp(-e.deltaY * 0.0025), e);
      } else if (zoomRef.current > 1.001) {
        e.preventDefault();
        const svg = svgRef.current;
        const k = svg?.getScreenCTM() ? 1 / svg.getScreenCTM()!.a : 0.1;
        setPan((p) => ({ x: p.x + e.deltaX * k, y: p.y + e.deltaY * k }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // Keyboard: Space (hold) = hand tool, H = toggle hand, ⌘/Ctrl +/−/0 = zoom.
  useEffect(() => {
    const typing = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.code === "Space" && !mod) {
        e.preventDefault();
        setSpaceHeld(true);
      } else if (!mod && e.key.toLowerCase() === "h") setHand((h) => !h);
      else if (mod && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        zoomAt(1.25);
      } else if (mod && e.key === "-") {
        e.preventDefault();
        zoomAt(0.8);
      } else if (mod && e.key === "0") {
        e.preventDefault();
        resetView();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceHeld(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [zoomAt, resetView]);

  // Drag & drop: library items, typography assets, uploads and image files.
  function onDragOver(e: React.DragEvent) {
    const types = Array.from(e.dataTransfer.types);
    if (types.includes(DRAG_MIME) || types.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      if (!dropping) setDropping(true);
    }
  }
  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDropping(false);
    const at = { zone, ...toCm(e) };
    const raw = e.dataTransfer.getData(DRAG_MIME);
    const payload = raw ? parsePayload(raw) : null;
    if (payload) {
      const notes = insertPayload(payload, { at }, !!user);
      for (const n of notes) toast(n, n.startsWith("Change rejected") ? "bad" : "info");
      return;
    }
    const files = Array.from(e.dataTransfer.files).filter((f) => ACCEPTED_ARTWORK.includes(f.type) || /\.svg$/i.test(f.name));
    if (!files.length) return void (e.dataTransfer.files.length && toast("Drop PNG, JPG, WebP or SVG artwork", "bad"));
    if (!user) return void toast("Sign in to upload artwork — uploads are stored privately in your account.", "info");
    for (const f of files.slice(0, 5)) {
      try {
        await uploadAndInsert(f, { at });
        toast(`Uploaded ${f.name}`);
      } catch (err) {
        toast(errorMessage(err), "bad");
      }
    }
  }

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      // Two-finger pinch: cancel any layer gesture and zoom instead.
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom };
      if (gesture.current && gesture.current.kind !== "pan") useEditor.getState().undo();
      gesture.current = null;
      return;
    }
    if (e.button === 1 || ((hand || spaceHeld) && e.button === 0)) {
      e.preventDefault();
      gesture.current = { kind: "pan", client: { x: e.clientX, y: e.clientY }, pan, cmPerPx };
      (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
      return;
    }
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
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const target = clampZoom(pinch.current.zoom * (d / pinch.current.dist));
      zoomAt(target / zoom, { clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
      return;
    }
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "pan") {
      setPan({ x: g.pan.x - (e.clientX - g.client.x) * g.cmPerPx, y: g.pan.y - (e.clientY - g.client.y) * g.cmPerPx });
      return;
    }
    const p = toCm(e);
    const ids = g.origs.map((o) => o.id);
    if (g.kind === "move") {
      let dx = p.x - g.start.x;
      let dy = p.y - g.start.y;
      let gv: number | null = null;
      let gh: number | null = null;
      if (g.origs.length === 1 && !e.altKey) {
        // Smart guides: snap centre/edges to the garment centre line, print-area edges and other layers.
        const o = g.origs[0];
        const tol = Math.max(0.4, cmPerPx * 8);
        const others = layers.filter((l) => l.id !== o.id && l.visible);
        const b = rotatedBounds(o.x + dx, o.y + dy, o.width, o.height, o.rotation);
        const hw = (b.x1 - b.x0) / 2;
        const hh = (b.y1 - b.y0) / 2;
        const cx = o.x + dx;
        const cy = o.y + dy;
        const vCands: { line: number; centre: number }[] = [
          { line: 0, centre: 0 }, { line: area.x0, centre: area.x0 + hw }, { line: area.x1, centre: area.x1 - hw },
          ...others.map((l) => ({ line: l.x, centre: l.x })),
        ];
        const hCands: { line: number; centre: number }[] = [
          { line: area.y0, centre: area.y0 + hh }, { line: area.y1, centre: area.y1 - hh }, { line: (area.y0 + area.y1) / 2, centre: (area.y0 + area.y1) / 2 },
          ...others.map((l) => ({ line: l.y, centre: l.y })),
        ];
        const bestV = vCands.map((c) => ({ ...c, d: Math.abs(c.centre - cx) })).sort((p1, p2) => p1.d - p2.d)[0];
        const bestH = hCands.map((c) => ({ ...c, d: Math.abs(c.centre - cy) })).sort((p1, p2) => p1.d - p2.d)[0];
        if (bestV && bestV.d < tol) {
          dx = bestV.centre - o.x;
          gv = bestV.line;
        }
        if (bestH && bestH.d < tol) {
          dy = bestH.centre - o.y;
          gh = bestH.line;
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
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
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
    style: { touchAction: "none", width: "100%", height: "100%", cursor: hand || spaceHeld ? (gesture.current?.kind === "pan" ? "grabbing" : "grab") : undefined } as React.CSSProperties,
    "data-testid": "canvas-2d",
  };

  let content: React.ReactNode;
  if (isTorso) {
    const pats = flatPatternFills(config, resolver, "c2d");
    content = <GarmentFlat config={config} view={zone} measurements={m} overlay={overlay} svgProps={svgProps} viewBoxOverride={vb} title={`${zone} 2D editor`} defs={<g dangerouslySetInnerHTML={{ __html: pats.defs }} />} patternFill={pats.fill} />;
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
          <rect x={canvas.x0} y={canvas.y0} width={canvas.x1 - canvas.x0} height={canvas.y1 - canvas.y0} rx={zone === "pocket" ? 0.4 : zone === "cuffs" ? 0.3 : 0.8} fill={fill ?? bg} stroke={guideColor} strokeOpacity={0.4} strokeWidth={0.1} />
          {zone === "cuffs" && (
            <>
              <circle cx={canvas.x1 - 1.4} cy={(canvas.y0 + canvas.y1) / 2} r={0.55} fill="none" stroke={guideColor} strokeOpacity={0.45} strokeWidth={0.08} />
              <line x1={canvas.x0 + 0.9} x2={canvas.x0 + 2.2} y1={(canvas.y0 + canvas.y1) / 2} y2={(canvas.y0 + canvas.y1) / 2} stroke={guideColor} strokeOpacity={0.45} strokeWidth={0.12} />
              <text x={0} y={canvas.y1 + 1.2} fontSize={0.7} fill={guideColor} opacity={0.5} textAnchor="middle" fontFamily="Inter">cuff band unrolled · outer face centred · wearer&apos;s left cuff</text>
            </>
          )}
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
            <button className={clsx("rounded p-1.5", hand ? "text-bone" : "text-mute hover:text-bone")} title="Hand tool — pan (H, or hold Space)" aria-label="Hand tool" aria-pressed={hand} onClick={() => setHand((h) => !h)} data-testid="hand-tool"><Hand className="size-4" /></button>
            <button className="rounded p-1.5 text-mute hover:text-bone" title="Zoom out (⌘−)" aria-label="Zoom out" onClick={() => zoomAt(0.8)}><ZoomOut className="size-4" /></button>
            <span className="w-10 text-center text-[0.68rem] tabular-nums text-mute" data-testid="zoom-level">{Math.round(zoom * 100)}%</span>
            <button className="rounded p-1.5 text-mute hover:text-bone" title="Zoom in (⌘+)" aria-label="Zoom in" onClick={() => zoomAt(1.25)}><ZoomIn className="size-4" /></button>
            <button className="rounded p-1.5 text-mute hover:text-bone" title="Fit (⌘0)" aria-label="Fit to view" onClick={resetView}><Maximize className="size-4" /></button>
            <button className={clsx("rounded p-1.5", grid ? "text-bone" : "text-mute")} title="Grid (1 cm)" aria-pressed={grid} aria-label="Toggle grid" onClick={() => setGrid((g) => !g)}><Grid3x3 className="size-4" /></button>
            <button className={clsx("rounded p-1.5", bounds ? "text-bone" : "text-mute")} title="Print boundaries & guides" aria-pressed={bounds} aria-label="Toggle print boundaries" onClick={() => setBounds((b) => !b)}><Square className="size-4" /></button>
          </div>
        )}
      </div>
      <div
        ref={containerRef}
        className={clsx("relative min-h-0 flex-1 overflow-hidden mv-canvas-bg", dropping && "outline outline-2 -outline-offset-4 outline-champagne/70")}
        onDragOver={onDragOver}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setDropping(false); }}
        onDrop={onDrop}
        data-testid="canvas-drop"
      >
        <div className="flex h-full w-full items-center justify-center p-3">
          {content}
        </div>
        {dropping && <p className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-ink/80 px-3 py-1 text-[0.7rem] text-champagne">Drop onto the {ZONE_LABELS[zone].toLowerCase()}</p>}
        {layers.length === 0 && !dropping && <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-ink/70 px-3 py-1 text-[0.7rem] text-mute">Add or drag text, graphics and files here — drag to move, corners to resize, ● to rotate</p>}
      </div>
    </div>
  );
}

export type { Rect };
