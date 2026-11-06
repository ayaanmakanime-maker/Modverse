/**
 * Guided multi-view body scan (front, side, optional back).
 *
 * Inputs per view: MediaPipe pose landmarks (normalised image coordinates)
 * and a person segmentation mask (multiclass: 0 background, 1 hair,
 * 2 body skin, 3 face skin, 4 clothes, 5 accessories / held objects).
 * Everything runs on the device; no image is uploaded or stored.
 *
 * HONESTY RULES
 *  • Scale comes from the height the user types (manual). No height → no scan.
 *  • Lengths read directly from landmarks are "measured" (camera, ±2–3 cm).
 *  • Circumferences need a front width AND a side depth: they are "estimated"
 *    from an ellipse model, never claimed as measured.
 *  • Anything hidden (loose clothing, missing view, arms covering the body)
 *    is reported as hidden / needs a view — never invented.
 *  • Neck, bicep and wrist are not measurable this way: tape measure only.
 */

export type ScanView = "front" | "side" | "back";
export interface Lm { x: number; y: number; visibility?: number }
export interface SegMask { data: ArrayLike<number>; width: number; height: number; multiclass: boolean }
export interface ScanIssue { code: string; message: string; severity: "block" | "warn" }
export interface ViewCheck { ok: boolean; issues: ScanIssue[]; looseClothing: boolean; heldObject: boolean; armsAgainstBody: boolean }
export interface CapturedView { view: ScanView; landmarks: Lm[]; mask: SegMask; check: ViewCheck }

export type ScanKey = "height" | "chest" | "waist" | "hip" | "shoulder" | "armLength" | "torsoLength" | "inseam" | "neck" | "bicep" | "wrist";
export type ScanStatus = "manual" | "measured" | "estimated" | "hidden" | "needs-view" | "tape-only";
export interface ScanMeasurement { key: ScanKey; valueCm: number | null; status: ScanStatus; confidence: "high" | "medium" | "low" | null; toleranceCm?: number; note: string }

const L = { nose: 0, lSh: 11, rSh: 12, lEl: 13, rEl: 14, lWr: 15, rWr: 16, lHip: 23, rHip: 24, lKn: 25, rKn: 26, lAn: 27, rAn: 28, lHeel: 29, rHeel: 30, lFoot: 31, rFoot: 32 };
const vis = (l?: Lm) => (l ? l.visibility ?? 1 : 0);
const mid = (a: Lm, b: Lm): Lm => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, visibility: Math.min(vis(a), vis(b)) });
const dist = (a: Lm, b: Lm, aspect: number) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);
const isPerson = (m: SegMask, i: number) => (m.multiclass ? m.data[i] > 0 : m.data[i] > 127);

/** Width (px) of the person run on row y that contains column cx (or the nearest person pixel). */
export function rowRun(m: SegMask, yNorm: number, cxNorm: number): { x0: number; x1: number; width: number; clothesFrac: number } | null {
  const y = Math.max(0, Math.min(m.height - 1, Math.round(yNorm * m.height)));
  let cx = Math.max(0, Math.min(m.width - 1, Math.round(cxNorm * m.width)));
  const row = y * m.width;
  if (!isPerson(m, row + cx)) {
    let best = -1;
    for (let d = 1; d < m.width * 0.08 && best < 0; d++) {
      if (cx - d >= 0 && isPerson(m, row + cx - d)) best = cx - d;
      else if (cx + d < m.width && isPerson(m, row + cx + d)) best = cx + d;
    }
    if (best < 0) return null;
    cx = best;
  }
  let x0 = cx, x1 = cx;
  while (x0 > 0 && isPerson(m, row + x0 - 1)) x0--;
  while (x1 < m.width - 1 && isPerson(m, row + x1 + 1)) x1++;
  let clothes = 0;
  if (m.multiclass) for (let x = x0; x <= x1; x++) if (m.data[row + x] === 4) clothes++;
  return { x0, x1, width: x1 - x0 + 1, clothesFrac: m.multiclass ? clothes / (x1 - x0 + 1) : 0 };
}

/** Averaged run width over a few rows (px), robust to a single noisy row. */
function width(m: SegMask, yNorm: number, cxNorm: number): number | null {
  const ws: number[] = [];
  for (const dy of [-2, -1, 0, 1, 2]) {
    const r = rowRun(m, yNorm + dy / m.height, cxNorm);
    if (r) ws.push(r.width);
  }
  if (ws.length < 3) return null;
  ws.sort((a, b) => a - b);
  return ws[Math.floor(ws.length / 2)];
}

/** Top and bottom of the person (normalised y), using the mask around the head column and the feet landmarks. */
export function personExtent(m: SegMask, lms: Lm[]): { top: number; bottom: number } | null {
  const nose = lms[L.nose];
  if (!nose) return null;
  const cx = Math.round(nose.x * m.width);
  const span = Math.round(m.width * 0.06);
  let top = -1;
  for (let y = 0; y < m.height && top < 0; y++) for (let x = Math.max(0, cx - span); x <= Math.min(m.width - 1, cx + span); x++) if (isPerson(m, y * m.width + x)) { top = y; break; }
  if (top < 0) return null;
  const feet = [lms[L.lHeel], lms[L.rHeel], lms[L.lFoot], lms[L.rFoot], lms[L.lAn], lms[L.rAn]].filter((l) => l && vis(l) > 0.4);
  const bottom = feet.length ? Math.max(...feet.map((l) => l.y)) + 0.006 : -1;
  if (bottom < 0) return null;
  return { top: top / m.height, bottom: Math.min(1, bottom) };
}

/** Quality and obstruction checks for one captured view. */
export function checkView(view: ScanView, lms: Lm[] | null, m: SegMask | null, aspect: number): ViewCheck {
  const issues: ScanIssue[] = [];
  const res = (): ViewCheck => ({ ok: !issues.some((i) => i.severity === "block"), issues, looseClothing: issues.some((i) => i.code === "loose_clothing"), heldObject: issues.some((i) => i.code === "held_object"), armsAgainstBody: issues.some((i) => i.code === "arms_down") });
  if (!lms || lms.length < 33) {
    issues.push({ code: "no_person", message: "No person found — step into the frame.", severity: "block" });
    return res();
  }
  const ankles = [lms[L.lAn], lms[L.rAn], lms[L.lHeel], lms[L.rHeel]];
  if (vis(lms[L.nose]) < 0.5 && view !== "back") issues.push({ code: "head_hidden", message: "Your head must be visible.", severity: "block" });
  if (ankles.every((a) => vis(a) < 0.5) || ankles.some((a) => a.y > 0.995)) issues.push({ code: "feet_hidden", message: "Show your whole body, feet included — step back.", severity: "block" });
  const sh = mid(lms[L.lSh], lms[L.rSh]);
  const hip = mid(lms[L.lHip], lms[L.rHip]);
  const torso = Math.abs(hip.y - sh.y);
  const shoulderW = dist(lms[L.lSh], lms[L.rSh], aspect);
  if (view === "side" && shoulderW > torso * 0.45) issues.push({ code: "turn_sideways", message: "Turn 90° so we see your profile.", severity: "block" });
  if (view !== "side" && shoulderW < torso * 0.5) issues.push({ code: "face_camera", message: view === "front" ? "Face the camera squarely." : "Turn your back squarely to the camera.", severity: "block" });
  if (m) {
    const ext = personExtent(m, lms);
    if (ext) {
      const h = ext.bottom - ext.top;
      if (h > 0.96 || ext.top < 0.01) issues.push({ code: "too_close", message: "Step back so there is space above your head.", severity: "block" });
      else if (h < 0.5) issues.push({ code: "too_far", message: "Step closer — fill more of the frame.", severity: "warn" });
    }
    if (view !== "side") {
      // Arms against the body make the torso outline include the arms.
      const run = rowRun(m, hip.y - torso * 0.25, hip.x);
      const wr = [lms[L.lWr], lms[L.rWr]];
      if (run && wr.some((w) => w.x * m.width > run.x0 - 3 && w.x * m.width < run.x1 + 3 && vis(w) > 0.4)) issues.push({ code: "arms_down", message: "Hold your arms slightly away from your body.", severity: "warn" });
      // Loose clothing: the outline at the waist is far wider than the hip joints allow.
      const hipJoints = Math.abs(lms[L.lHip].x - lms[L.rHip].x) * m.width;
      const waistRun = rowRun(m, sh.y + torso * 0.62, hip.x);
      const chestRun = rowRun(m, sh.y + torso * 0.3, sh.x);
      const shoulderJoints = Math.abs(lms[L.lSh].x - lms[L.rSh].x) * m.width;
      const looseWaist = waistRun && hipJoints > 0 && waistRun.width / hipJoints > 2.35 && (!m.multiclass || waistRun.clothesFrac > 0.6);
      const looseChest = chestRun && shoulderJoints > 0 && chestRun.width / shoulderJoints > 1.42 && (!m.multiclass || chestRun.clothesFrac > 0.6);
      if (looseWaist || looseChest) issues.push({ code: "loose_clothing", message: "Loose clothing hides your outline — wear fitted clothes for chest, waist and hip.", severity: "warn" });
    }
    // Held objects: accessory/other pixels next to a hand.
    if (m.multiclass) {
      let near = 0, person = 0;
      const r = Math.round(m.height * 0.07);
      for (const w of [lms[L.lWr], lms[L.rWr]]) {
        const cx = Math.round(w.x * m.width), cy = Math.round(w.y * m.height);
        for (let y = Math.max(0, cy - r); y < Math.min(m.height, cy + r); y++) for (let x = Math.max(0, cx - r); x < Math.min(m.width, cx + r); x++) {
          const v = m.data[y * m.width + x];
          if (v > 0) person++;
          if (v === 5) near++;
        }
      }
      if (person > 0 && near / person > 0.12) issues.push({ code: "held_object", message: "Put down what you are holding (phone, bag…) — it changes your outline.", severity: "block" });
    }
  }
  return res();
}

const ell = (a: number, b: number) => Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
const r1 = (v: number) => Math.round(v * 10) / 10;

/** Turn captured views into labelled measurements (see the honesty rules above). */
export function computeScan(heightCm: number | null, views: Partial<Record<ScanView, CapturedView>>): ScanMeasurement[] {
  const out: ScanMeasurement[] = [];
  const push = (m: ScanMeasurement) => out.push(m);
  if (!heightCm) {
    push({ key: "height", valueCm: null, status: "needs-view", confidence: null, note: "Type your height first — it sets the scale." });
    return out;
  }
  push({ key: "height", valueCm: heightCm, status: "manual", confidence: "high", note: "Entered by you; sets the scale of every camera measurement." });
  const front = views.front?.check.ok ? views.front : undefined;
  const side = views.side?.check.ok ? views.side : undefined;
  const back = views.back?.check.ok ? views.back : undefined;
  const tape = (key: ScanKey) => push({ key, valueCm: null, status: "tape-only", confidence: null, note: "Can't be seen reliably by a camera — measure with a tape." });
  if (!front) {
    for (const key of ["shoulder", "armLength", "torsoLength", "inseam", "chest", "waist", "hip"] as ScanKey[]) push({ key, valueCm: null, status: "needs-view", confidence: null, note: "Needs a successful front view." });
    for (const k of ["neck", "bicep", "wrist"] as ScanKey[]) tape(k);
    return out;
  }
  const fm = front.mask;
  const aspect = fm.width / fm.height;
  const ext = personExtent(fm, front.landmarks);
  if (!ext) {
    push({ key: "chest", valueCm: null, status: "needs-view", confidence: null, note: "Couldn't find your head and feet in the front view." });
    return out;
  }
  const pxPerCmY = ((ext.bottom - ext.top) * fm.height) / heightCm; // pixels per cm (vertical)
  const cmPerNorm = fm.height / pxPerCmY; // normalised y unit → cm
  const lm = front.landmarks;
  const lenCm = (a: Lm, b: Lm) => dist(a, b, aspect) * cmPerNorm;
  const okVis = (...ls: Lm[]) => ls.every((l) => vis(l) >= 0.6);
  // Lengths straight from landmarks (measured).
  if (okVis(lm[L.lSh], lm[L.rSh])) push({ key: "shoulder", valueCm: r1(lenCm(lm[L.lSh], lm[L.rSh]) * 1.17), status: "estimated", confidence: "medium", toleranceCm: 2.5, note: "Shoulder joints × 1.17 (joint → shoulder point calibration)." });
  else push({ key: "shoulder", valueCm: null, status: "hidden", confidence: null, note: "Shoulders not clearly visible." });
  const arms = ([["l", L.lSh, L.lEl, L.lWr], ["r", L.rSh, L.rEl, L.rWr]] as const).filter(([, s, e, w]) => okVis(lm[s], lm[e], lm[w])).map(([, s, e, w]) => lenCm(lm[s], lm[e]) + lenCm(lm[e], lm[w]));
  if (arms.length) push({ key: "armLength", valueCm: r1(Math.max(...arms) * 1.04), status: "measured", confidence: "medium", toleranceCm: 2.5, note: "Shoulder → elbow → wrist from the front view." });
  else push({ key: "armLength", valueCm: null, status: "hidden", confidence: null, note: "Elbows or wrists weren't visible." });
  const sh = mid(lm[L.lSh], lm[L.rSh]);
  const hp = mid(lm[L.lHip], lm[L.rHip]);
  if (okVis(lm[L.lSh], lm[L.rSh], lm[L.lHip], lm[L.rHip])) push({ key: "torsoLength", valueCm: r1(Math.abs(hp.y - sh.y) * cmPerNorm), status: "measured", confidence: "medium", toleranceCm: 2.5, note: "Shoulder line → hip joints." });
  const legs = ([[L.lHip, L.lKn, L.lAn], [L.rHip, L.rKn, L.rAn]] as const).filter(([h, k, a]) => okVis(lm[h], lm[k], lm[a])).map(([h, k, a]) => lenCm(lm[h], lm[k]) + lenCm(lm[k], lm[a]));
  if (legs.length) push({ key: "inseam", valueCm: r1(Math.max(...legs) * 0.93 + heightCm * 0.035), status: "estimated", confidence: "low", toleranceCm: 4, note: "Hip joint → ankle, adjusted to the crotch and floor." });
  // Circumferences: front width × side depth (ellipse model).
  const torso = Math.abs(hp.y - sh.y);
  const levels = { chest: 0.3, waist: 0.62, hip: 1.08 };
  const loose = front.check.looseClothing || back?.check.looseClothing || side?.check.looseClothing;
  const sm = side?.mask;
  const sLm = side?.landmarks;
  const sideScale = side && sm ? (() => { const e = personExtent(sm, side.landmarks); return e ? ((e.bottom - e.top) * sm.height) / heightCm : null; })() : null;
  for (const key of ["chest", "waist", "hip"] as const) {
    if (loose) { push({ key, valueCm: null, status: "hidden", confidence: null, note: "Hidden by loose clothing — rescan in fitted clothes or use a tape." }); continue; }
    const fy = sh.y + torso * levels[key];
    let wPx = width(fm, fy, hp.x);
    if (wPx && back) {
      const bs = back.landmarks, bm = back.mask;
      const bsh = mid(bs[L.lSh], bs[L.rSh]), bhp = mid(bs[L.lHip], bs[L.rHip]);
      const be = personExtent(bm, bs);
      const bw = width(bm, bsh.y + Math.abs(bhp.y - bsh.y) * levels[key], bhp.x);
      if (bw && be) wPx = (wPx + bw * ((ext.bottom - ext.top) * fm.height) / ((be.bottom - be.top) * bm.height)) / 2;
    }
    if (!wPx) { push({ key, valueCm: null, status: "hidden", confidence: null, note: "Outline not found at this height." }); continue; }
    if (!side || !sm || !sLm || !sideScale) { push({ key, valueCm: null, status: "needs-view", confidence: null, note: "Needs the side view for depth." }); continue; }
    const ssh = mid(sLm[L.lSh], sLm[L.rSh]), shp = mid(sLm[L.lHip], sLm[L.rHip]);
    const dPx = width(sm, ssh.y + Math.abs(shp.y - ssh.y) * levels[key], shp.x);
    if (!dPx) { push({ key, valueCm: null, status: "hidden", confidence: null, note: "Profile outline not found at this height." }); continue; }
    const wCm = wPx / pxPerCmY; // mask pixels are square
    const dCm = dPx / sideScale;
    const factor = key === "waist" ? 0.98 : 0.97;
    const armsPenalty = front.check.armsAgainstBody;
    push({ key, valueCm: r1(ell(wCm / 2, dCm / 2) * factor), status: "estimated", confidence: armsPenalty ? "low" : back ? "medium" : "low", toleranceCm: armsPenalty ? 6 : 4, note: `Front width ${r1(wCm)} cm × side depth ${r1(dCm)} cm, ellipse model${back ? " (front + back averaged)" : ""}.` });
  }
  for (const k of ["neck", "bicep", "wrist"] as ScanKey[]) tape(k);
  return out;
}

/** Provenance for saving: measured → camera, estimated → derived, manual → user (camera values never claim "high"). */
export function toProfile(ms: ScanMeasurement[]): { measurements: Record<string, number>; provenance: Record<string, { source: "user" | "camera" | "derived"; confidence: "high" | "medium" | "low"; toleranceCm?: number }> } {
  const measurements: Record<string, number> = {};
  const provenance: Record<string, { source: "user" | "camera" | "derived"; confidence: "high" | "medium" | "low"; toleranceCm?: number }> = {};
  for (const m of ms) {
    if (m.valueCm === null || m.key === "inseam") continue;
    measurements[m.key] = m.valueCm;
    if (m.status === "manual") continue;
    provenance[m.key] = { source: m.status === "measured" ? "camera" : "derived", confidence: m.confidence === "high" ? "medium" : m.confidence ?? "low", ...(m.toleranceCm ? { toleranceCm: m.toleranceCm } : {}) };
  }
  return { measurements, provenance };
}
