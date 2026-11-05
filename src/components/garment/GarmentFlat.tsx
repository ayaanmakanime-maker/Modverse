import { panelColor } from "@/lib/garment/design";
import { computeMeasurements } from "@/lib/garment/sizing";
import { polygonToPath, shoulderSlope, sleeveShape, torsoShape, type Pt } from "@/lib/garment/panels";
import type { DesignConfig } from "@/lib/garment/schema";
import type { GarmentMeasurements } from "@/lib/garment/types";
import { hexToHsl, hslToHex, isDark } from "@/lib/color";

/**
 * Parametric technical flat of a garment (front or back), drawn in
 * centimetres from the same panel geometry the 3D renderer and print
 * engine use. Used for catalogue imagery and as the 2D editor base.
 */
export interface FlatProps {
  config: DesignConfig;
  view: "front" | "back";
  className?: string;
  /** Extra SVG content (artwork layers) rendered on top of the torso, in torso coordinates. */
  children?: React.ReactNode;
  /** Pattern fills by panel id → pattern element id defined in `defs` */
  patternFill?: Partial<Record<string, string>>;
  defs?: React.ReactNode;
  showSleeves?: boolean;
  stroke?: string;
  title?: string;
  measurements?: GarmentMeasurements;
  /** Rendered last and unclipped (editor artwork, guides, selection handles). */
  overlay?: React.ReactNode;
  viewBoxOverride?: [number, number, number, number];
  svgProps?: React.SVGProps<SVGSVGElement> & { ref?: React.Ref<SVGSVGElement> };
}

export const SLEEVE_ANGLE: Record<string, number> = { "set-in": 50, raglan: 48, "drop-shoulder": 44 };

function shade(hex: string, dl: number): string {
  const [h, s, l] = hexToHsl(hex);
  return hslToHex(h, s, Math.max(0, Math.min(1, l + dl)));
}

export function sleevePlacement(m: GarmentMeasurements, styleKey: string, side: 1 | -1, kids = false) {
  const slope = shoulderSlope(m, kids);
  const angle = SLEEVE_ANGLE[styleKey] ?? 58;
  const x = side * (m.shoulderWidth / 2 - m.bicep * 0.03);
  return { x, y: slope - 0.5, rotate: -side * angle };
}

/** Tight view box from the real torso outline and the transformed sleeve outlines. */
export function flatViewBox(m: GarmentMeasurements, showSleeves = true, c?: DesignConfig["construction"], kids = false): [number, number, number, number] {
  let minX = -Math.max(m.chest / 4, m.hem / 4, m.shoulderWidth / 2);
  let maxX = -minX;
  let minY = -Math.max(5, m.collarHeight + 2.5);
  let maxY = m.bodyLength + 1;
  if (showSleeves && c) {
    const sl = sleeveShape(m, c);
    const flatOutline = sl.outline.map(([x, y]) => [x * 0.5, y] as Pt);
    for (const side of [1, -1] as const) {
      const p = sleevePlacement(m, c.sleeveStyle, side, kids);
      const r = (p.rotate * Math.PI) / 180;
      for (const [x, y] of flatOutline) {
        const X = p.x + x * Math.cos(r) - y * Math.sin(r);
        const Y = p.y + x * Math.sin(r) + y * Math.cos(r);
        minX = Math.min(minX, X); maxX = Math.max(maxX, X); minY = Math.min(minY, Y); maxY = Math.max(maxY, Y);
      }
    }
  }
  const pad = 2;
  const half = Math.max(-minX, maxX) + pad;
  return [-half, minY - pad, half * 2, maxY - minY + pad * 2];
}

export function GarmentFlat({ config, view, className, children, patternFill = {}, defs, showSleeves = true, stroke, title, measurements, overlay, viewBoxOverride, svgProps }: FlatProps) {
  const m = measurements ?? computeMeasurements(config);
  const c = config.construction;
  const kids = config.audience === "kids";
  const torso = torsoShape(m, view, c, kids);
  // A technical flat shows the sleeve folded flat: width = half the circumference.
  const sleeveRaw = sleeveShape(m, c);
  const sleeve = { ...sleeveRaw, outline: sleeveRaw.outline.map(([x, y]) => [x * 0.5, y] as Pt), halfOpening: sleeveRaw.halfOpening * 0.5, halfBicep: sleeveRaw.halfBicep * 0.5 };
  const body = panelColor(config, view);
  const line = stroke ?? (isDark(body) ? shade(body, 0.32) : shade(body, -0.3));
  const stitchColor = c.stitching.contrast ? c.stitching.color : line;
  const stitchW = 0.12;
  const vb = viewBoxOverride ?? flatViewBox(m, showSleeves, c, kids);
  const fill = (panel: string, fallback: string) => (patternFill[panel] ? `url(#${patternFill[panel]})` : fallback);
  const shirt = config.garmentType === "shirt";
  const sleeveL = panelColor(config, "sleeveLeft");
  const sleeveR = panelColor(config, "sleeveRight");
  // In front view the wearer's left sleeve is on the viewer's right (+x). In back view it's on the left.
  const rightSide = view === "front" ? { color: sleeveL, panel: "sleeveLeft" } : { color: sleeveR, panel: "sleeveRight" };
  const leftSide = view === "front" ? { color: sleeveR, panel: "sleeveRight" } : { color: sleeveL, panel: "sleeveLeft" };
  const neckPath = polygonToPath(torso.neckline, false);
  const hasCuff = !["hem", "none"].includes(c.cuff);
  const cuffColor = panelColor(config, "cuffs");

  const sleeveEl = (side: 1 | -1, color: string, panel: string) => {
    const p = sleevePlacement(m, c.sleeveStyle, side, kids);
    const pts = sleeve.outline.map(([x, y]) => [x, y] as Pt);
    return (
      <g transform={`translate(${p.x} ${p.y}) rotate(${p.rotate})`} key={panel}>
        <path d={polygonToPath(pts)} fill={fill(panel, color)} stroke={line} strokeWidth={0.26} strokeLinejoin="round" />
        {hasCuff && <rect x={-sleeve.halfOpening} y={sleeve.length - m.cuffHeight} width={sleeve.halfOpening * 2} height={m.cuffHeight} fill={c.cuff === "rib" ? shade(cuffColor, -0.04) : cuffColor} stroke={line} strokeWidth={0.15} />}
        {c.cuff === "rib" && Array.from({ length: Math.floor(sleeve.halfOpening * 2 / 0.6) }).map((_, i) => <line key={i} x1={-sleeve.halfOpening + 0.3 + i * 0.6} x2={-sleeve.halfOpening + 0.3 + i * 0.6} y1={sleeve.length - m.cuffHeight + 0.2} y2={sleeve.length - 0.2} stroke={line} strokeWidth={0.05} opacity={0.6} />)}
        {!hasCuff && <line x1={-sleeve.halfOpening + 0.2} x2={sleeve.halfOpening - 0.2} y1={sleeve.length - 1.6} y2={sleeve.length - 1.6} stroke={stitchColor} strokeWidth={stitchW} strokeDasharray="0.35 0.25" />}
        {(c.cuff === "barrel" || c.cuff === "adjustable" || c.cuff === "convertible") && <circle cx={sleeve.halfOpening * 0.55} cy={sleeve.length - m.cuffHeight / 2} r={c.buttons.sizeMm / 20} fill={c.buttons.color} stroke={line} strokeWidth={0.06} />}
        {c.cuff === "french" && <rect x={sleeve.halfOpening * 0.4} y={sleeve.length - m.cuffHeight * 0.65} width={1.2} height={0.7} rx={0.2} fill="#C0C6CC" stroke={line} strokeWidth={0.05} />}
      </g>
    );
  };

  // Collar / neckline construction
  let collar: React.ReactNode = null;
  if (!shirt) {
    if (c.neckline === "mock") {
      collar = <path d={`${neckPath} L ${-m.neckWidth / 2 + 0.6} ${-m.collarHeight + 0.4} Q 0 ${-m.collarHeight - 0.4} ${m.neckWidth / 2 - 0.6} ${-m.collarHeight + 0.4} Z`} fill={fill("collar", panelColor(config, "collar"))} stroke={line} strokeWidth={0.18} />;
    } else {
      collar = (
        <g>
          <path d={neckPath} fill="none" stroke={panelColor(config, "collar")} strokeWidth={m.collarHeight * 0.9} strokeLinecap="round" strokeLinejoin="round" />
          <path d={neckPath} fill="none" stroke={line} strokeWidth={0.12} transform={`translate(0 ${m.collarHeight * 0.45})`} />
        </g>
      );
    }
  } else if (view === "front") {
    const nw = m.neckWidth / 2;
    const stand = c.collar === "band" || c.collar === "mandarin" ? m.collarHeight : 3.2;
    const collarColor = panelColor(config, "collar");
    const standPath = `M ${-nw} 0 Q 0 ${m.frontNeckDrop * 0.55} ${nw} 0 L ${nw - 0.3} ${-stand * 0.8} Q 0 ${-stand * 0.35 + m.frontNeckDrop * 0.3} ${-nw + 0.3} ${-stand * 0.8} Z`;
    if (c.collar === "band" || c.collar === "mandarin") {
      collar = <path d={standPath} fill={collarColor} stroke={line} strokeWidth={0.18} strokeLinejoin="round" />;
    } else {
      const spread: Record<string, [number, number]> = { point: [2.2, 8.2], spread: [5, 7.4], cutaway: [7.5, 6.2], "button-down": [2.8, 8.2], club: [3.5, 6.8], camp: [6.5, 11] };
      const [sx, len] = spread[c.collar] ?? [3, 8];
      const tipY = m.frontNeckDrop * 0.55 + len * 0.62;
      const leaf = (side: 1 | -1) => {
        const tip: Pt = [side * (sx + 0.6), tipY];
        const inner: Pt = [side * 0.35, m.frontNeckDrop * 0.55 + 0.5];
        const outer: Pt = [side * (nw + 2.2), 1.2];
        const d = c.collar === "club"
          ? `M ${side * nw} -1.2 L ${outer[0]} ${outer[1]} Q ${tip[0] + side * 1.6} ${tip[1] + 0.6} ${tip[0] - side * 0.6} ${tip[1]} Q ${inner[0] + side * 0.6} ${inner[1] + 1} ${inner[0]} ${inner[1]} Z`
          : `M ${side * nw} -1.2 L ${outer[0]} ${outer[1]} L ${tip[0]} ${tip[1]} L ${inner[0]} ${inner[1]} Z`;
        return (
          <g key={side}>
            <path d={d} fill={collarColor} stroke={line} strokeWidth={0.18} strokeLinejoin="round" />
            <path d={d} fill="none" stroke={stitchColor} strokeWidth={stitchW * 0.8} strokeDasharray="0.3 0.22" transform={`translate(${side * -0.25} 0.05) scale(0.985)`} opacity={0.9} />
            {c.collar === "button-down" && <circle cx={tip[0] - side * 0.6} cy={tip[1] - 0.9} r={0.42} fill={c.buttons.color} stroke={line} strokeWidth={0.05} />}
          </g>
        );
      };
      collar = (
        <g>
          {c.collar !== "camp" && <path d={standPath} fill={shade(collarColor, -0.06)} stroke={line} strokeWidth={0.15} />}
          {leaf(1)}
          {leaf(-1)}
        </g>
      );
    }
  } else {
    const nw = m.neckWidth / 2;
    const h = c.collar === "band" || c.collar === "mandarin" ? m.collarHeight : 4.2;
    collar = <path d={`M ${-nw - (c.collar === "band" || c.collar === "mandarin" ? 0 : 1.5)} 0.2 Q 0 ${m.backNeckDrop + 0.6} ${nw + (c.collar === "band" || c.collar === "mandarin" ? 0 : 1.5)} 0.2 L ${nw - 0.2} ${-h + 0.6} Q 0 ${-h + 0.2} ${-nw + 0.2} ${-h + 0.6} Z`} fill={panelColor(config, "collar")} stroke={line} strokeWidth={0.18} />;
  }

  const placket = view === "front" && (c.placket === "standard" || c.placket === "contrast" || c.placket === "henley");
  const placketColor = panelColor(config, "placket");
  const showButtons = view === "front" && c.buttons.count > 0 && c.placket !== "hidden";
  const buttonsY: number[] = [];
  if (showButtons) {
    const top = m.frontNeckDrop + (shirt ? 1.4 : 1.8);
    const bottom = top + (c.placket === "henley" ? m.placketLength - 3 : m.bodyLength - m.frontNeckDrop - 9);
    for (let i = 0; i < c.buttons.count; i++) buttonsY.push(top + ((bottom - top) * i) / Math.max(1, c.buttons.count - 1));
  }
  const pockets = view === "front" ? Array.from({ length: c.pocketCount }).map((_, i) => ({ x: (m.chest / 4) * 0.48 * (i === 0 ? 1 : -1), y: m.armholeDepth * 0.72 })) : [];
  const yokeColor = panelColor(config, "yoke");
  const sideColor = panelColor(config, "sidePanels");
  const shoulderColor = panelColor(config, "shoulderPanels");
  const clipId = `torso-clip-${view}-${config.modelId}`;

  return (
    <svg {...svgProps} viewBox={vb.join(" ")} className={className} role="img" aria-label={title ?? `${view} view`} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <clipPath id={clipId}><path d={polygonToPath(torso.outline)} /></clipPath>
        <linearGradient id={`${clipId}-shade`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#000" stopOpacity="0.22" />
          <stop offset="0.18" stopColor="#000" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.06" />
          <stop offset="0.82" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.22" />
        </linearGradient>
        {defs}
      </defs>
      {showSleeves && sleeveEl(-1, leftSide.color, leftSide.panel)}
      {showSleeves && sleeveEl(1, rightSide.color, rightSide.panel)}
      <path d={polygonToPath(torso.outline)} fill={fill(view, body)} stroke={line} strokeWidth={0.28} strokeLinejoin="round" />
      <g clipPath={`url(#${clipId})`}>
        {c.sidePanels && [1, -1].map((s) => <path key={s} d={`M ${s * (m.chest / 4)} ${m.armholeDepth} L ${s * (m.chest / 4 - 5)} ${m.armholeDepth + 2} L ${s * (m.hem / 4 - 5)} ${m.bodyLength} L ${s * (m.hem / 4 + 2)} ${m.bodyLength} Z`} fill={sideColor} stroke={line} strokeWidth={0.12} />)}
        {c.shoulderPanels && c.sleeveStyle !== "raglan" && <path d={`M ${-m.shoulderWidth / 2 - 2} -2 L ${m.shoulderWidth / 2 + 2} -2 L ${m.shoulderWidth / 2 + 2} ${shoulderSlope(m, kids) + 3.5} L ${-m.shoulderWidth / 2 - 2} ${shoulderSlope(m, kids) + 3.5} Z`} fill={shoulderColor} stroke={line} strokeWidth={0.12} />}
        {torso.raglanSeam && [1, -1].map((s) => {
          const seam = torso.raglanSeam!.map(([x, y]) => [s * x, y] as Pt);
          const region: Pt[] = [...seam, [s * (m.neckWidth / 2), -3], [s * (m.chest / 4 + 6), -3], [s * (m.chest / 4 + 6), m.armholeDepth]];
          return <path key={s} d={polygonToPath(region)} fill={(s === 1) === (view === "front") ? fill("sleeveLeft", sleeveL) : fill("sleeveRight", sleeveR)} stroke={line} strokeWidth={0.15} />;
        })}
        {view === "back" && c.backYoke !== "none" && (
          <path d={c.backYoke === "western" ? `M ${-m.chest / 2} -3 L ${m.chest / 2} -3 L ${m.chest / 2} ${m.yokeDepth * 0.7} L 0 ${m.yokeDepth} L ${-m.chest / 2} ${m.yokeDepth * 0.7} Z` : `M ${-m.chest / 2} -3 L ${m.chest / 2} -3 L ${m.chest / 2} ${m.yokeDepth} L ${-m.chest / 2} ${m.yokeDepth} Z`} fill={fill("yoke", yokeColor)} stroke={line} strokeWidth={0.15} />
        )}
        {view === "front" && c.backYoke === "western" && [1, -1].map((s) => <path key={s} d={`M ${s * 1.5} -3 L ${s * (m.chest / 2)} -3 L ${s * (m.chest / 2)} ${m.yokeDepth * 0.55} L ${s * (m.shoulderWidth * 0.22)} ${m.yokeDepth * 0.75} Z`} fill={fill("yoke", yokeColor)} stroke={line} strokeWidth={0.15} />)}
        {view === "back" && c.backPleat === "box" && <g stroke={line} strokeWidth={0.12}><line x1={-1.6} x2={-1.6} y1={m.yokeDepth || 8} y2={(m.yokeDepth || 8) + 9} /><line x1={1.6} x2={1.6} y1={m.yokeDepth || 8} y2={(m.yokeDepth || 8) + 9} /></g>}
        {view === "back" && c.backPleat === "side" && [1, -1].map((s) => <line key={s} x1={s * m.shoulderWidth * 0.32} x2={s * m.shoulderWidth * 0.32} y1={m.yokeDepth || 8} y2={(m.yokeDepth || 8) + 7} stroke={line} strokeWidth={0.12} />)}
        {view === "back" && c.darts && [1, -1].map((s) => <path key={s} d={`M ${s * m.chest * 0.1} ${m.armholeDepth + 2} L ${s * m.chest * 0.11} ${torso.waistY} L ${s * m.chest * 0.1} ${m.bodyLength - 8}`} fill="none" stroke={line} strokeWidth={0.12} />)}
        <rect x={vb[0]} y={vb[1]} width={vb[2]} height={vb[3]} fill={`url(#${clipId}-shade)`} pointerEvents="none" />
        {children}
        {/* hem stitching */}
        <path d={polygonToPath(torso.outline.filter(([, y]) => y > m.bodyLength - m.hemCurve - 0.5).sort((a, b) => a[0] - b[0]).map(([x, y]) => [x, y - 1.5] as Pt), false)} fill="none" stroke={stitchColor} strokeWidth={stitchW} strokeDasharray="0.35 0.25" />
        {c.stitching.style === "double" && <path d={polygonToPath(torso.outline.filter(([, y]) => y > m.bodyLength - m.hemCurve - 0.5).sort((a, b) => a[0] - b[0]).map(([x, y]) => [x, y - 2.1] as Pt), false)} fill="none" stroke={stitchColor} strokeWidth={stitchW} strokeDasharray="0.35 0.25" />}
      </g>
      {c.sideSlits && [1, -1].map((s) => <line key={s} x1={s * (m.hem / 4)} x2={s * (m.hem / 4 - 0.4)} y1={m.bodyLength - m.hemCurve} y2={m.bodyLength - m.hemCurve - 6} stroke={line} strokeWidth={0.25} />)}
      {placket && <rect x={-m.placketWidth / 2} y={m.frontNeckDrop + (shirt ? 0 : 0.5)} width={m.placketWidth} height={c.placket === "henley" ? m.placketLength : m.bodyLength - m.frontNeckDrop} fill={c.placket === "contrast" ? placketColor : config.panels.placket.color ? placketColor : "none"} stroke={line} strokeWidth={0.15} />}
      {view === "front" && c.placket === "hidden" && <line x1={0.6} x2={0.6} y1={m.frontNeckDrop} y2={m.bodyLength - 0.5} stroke={line} strokeWidth={0.15} />}
      {view === "front" && c.placket === "french" && <line x1={0} x2={0} y1={m.frontNeckDrop} y2={m.bodyLength - 0.5} stroke={line} strokeWidth={0.1} opacity={0.6} />}
      {buttonsY.map((y, i) => (
        <g key={i}>
          <circle cx={0} cy={y} r={c.buttons.sizeMm / 20} fill={c.buttons.color} stroke={shade(c.buttons.color, -0.3)} strokeWidth={0.06} />
          {!c.buttons.material.includes("snap") && <><circle cx={-0.12} cy={y} r={0.07} fill={shade(c.buttons.color, -0.4)} /><circle cx={0.12} cy={y} r={0.07} fill={shade(c.buttons.color, -0.4)} /></>}
        </g>
      ))}
      {pockets.map((p, i) => (
        <g key={i}>
          <path d={c.pocketStyle === "western-flap" ? `M ${p.x - m.pocketWidth / 2} ${p.y} L ${p.x + m.pocketWidth / 2} ${p.y} L ${p.x + m.pocketWidth / 2} ${p.y + m.pocketHeight} L ${p.x - m.pocketWidth / 2} ${p.y + m.pocketHeight} Z` : `M ${p.x - m.pocketWidth / 2} ${p.y} L ${p.x + m.pocketWidth / 2} ${p.y} L ${p.x + m.pocketWidth / 2} ${p.y + m.pocketHeight - 1.5} L ${p.x} ${p.y + m.pocketHeight} L ${p.x - m.pocketWidth / 2} ${p.y + m.pocketHeight - 1.5} Z`} fill={fill("pocket", panelColor(config, "pocket"))} stroke={line} strokeWidth={0.15} />
          <path d={`M ${p.x - m.pocketWidth / 2 + 0.4} ${p.y + 0.4} L ${p.x + m.pocketWidth / 2 - 0.4} ${p.y + 0.4}`} stroke={stitchColor} strokeWidth={stitchW} strokeDasharray="0.3 0.22" />
          {(c.pocketStyle === "flap" || c.pocketStyle === "western-flap") && <path d={c.pocketStyle === "western-flap" ? `M ${p.x - m.pocketWidth / 2 - 0.3} ${p.y - 0.3} L ${p.x + m.pocketWidth / 2 + 0.3} ${p.y - 0.3} L ${p.x + m.pocketWidth / 2} ${p.y + 2.2} L ${p.x} ${p.y + 4} L ${p.x - m.pocketWidth / 2} ${p.y + 2.2} Z` : `M ${p.x - m.pocketWidth / 2 - 0.3} ${p.y - 0.3} L ${p.x + m.pocketWidth / 2 + 0.3} ${p.y - 0.3} L ${p.x + m.pocketWidth / 2 + 0.3} ${p.y + 3.8} L ${p.x - m.pocketWidth / 2 - 0.3} ${p.y + 3.8} Z`} fill={panelColor(config, "pocket")} stroke={line} strokeWidth={0.15} />}
          {(c.pocketStyle === "flap" || c.pocketStyle === "western-flap") && c.buttons.count > 0 && <circle cx={p.x} cy={p.y + 2.6} r={c.buttons.sizeMm / 22} fill={c.buttons.color} stroke={line} strokeWidth={0.05} />}
        </g>
      ))}
      {collar}
      {c.monogram && view === "front" && c.monogram.position === "chest" && <text x={-(m.chest / 4) * 0.46} y={m.armholeDepth * 0.8} fontSize={1.4} fill={c.monogram.color} textAnchor="middle" fontFamily="Playfair Display">{c.monogram.text}</text>}
      {overlay}
    </svg>
  );
}
