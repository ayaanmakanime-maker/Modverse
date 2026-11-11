/// <reference lib="webworker" />
/** Runs the Human Studio body fit off the main thread. */
import { loadHumanAsset, type ControlId, type MeasureId, type Sex } from "./model";
import { fitBody } from "./solve";

self.onmessage = async (e: MessageEvent<{ id: number; sex: Sex; targets: Partial<Record<MeasureId, number>>; fixed: Partial<Record<ControlId, number>> }>) => {
  const { id, sex, targets, fixed } = e.data;
  try {
    const a = await loadHumanAsset();
    const r = fitBody(a, sex, targets, fixed);
    (self as unknown as Worker).postMessage({ id, ok: true, result: r });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: (err as Error).message });
  }
};
