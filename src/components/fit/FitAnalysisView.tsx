"use client";
import clsx from "clsx";
import { CheckCircle2, Eye, Ruler, Shirt, Sparkles, Camera } from "lucide-react";
import { analyseFit, FIT_FEEDBACK_LABEL, SOURCE_LABEL, type FitFeedbackValue, type ProvenanceMap } from "@/lib/garment/fit";
import type { DesignConfig } from "@/lib/garment/schema";
import type { BodyMeasurements } from "@/lib/garment/types";
import { Badge } from "@/components/ui";

const CAT_TONE: Record<string, "ok" | "warn" | "bad" | "info" | "neutral"> = { tight: "bad", fitted: "info", regular: "ok", relaxed: "ok", oversized: "warn" };

export interface VerifiedFit { modelId: string; size: string; overall: FitFeedbackValue; createdAt: string }

/** Shows estimated fit per zone and keeps recommended / estimated / simulated / verified clearly separate. */
export function FitAnalysisView({ config, body, provenance, verified }: { config: DesignConfig; body: Partial<BodyMeasurements>; provenance?: ProvenanceMap; verified?: VerifiedFit[] }) {
  const a = analyseFit(config, body, provenance);
  const sameModel = (verified ?? []).filter((v) => v.modelId === config.modelId);
  return (
    <div className="space-y-3" data-testid="fit-analysis">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-bone-2">Estimated fit:</span>
        <Badge tone={a.overall === "unknown" ? "neutral" : CAT_TONE[a.overall]}>{a.overall}</Badge>
        <Badge tone={a.confidence === "high" ? "ok" : a.confidence === "medium" ? "warn" : "neutral"}>{a.confidence} confidence</Badge>
      </div>
      <table className="w-full text-[0.68rem]">
        <thead><tr className="text-left text-mute"><th className="py-1 font-normal">Zone</th><th className="font-normal">Garment</th><th className="font-normal">You</th><th className="font-normal">Fit</th></tr></thead>
        <tbody>
          {a.zones.map((z) => (
            <tr key={z.zone} className="border-t border-line">
              <td className="py-1 capitalize">{z.zone}</td>
              <td className="tabular-nums">{z.garmentCm} cm</td>
              <td className="tabular-nums">{z.bodyCm !== null ? <>{z.bodyCm} cm {z.source === "camera" && <Camera className="inline size-3 text-champagne" aria-label="camera estimate" />}{z.source === "derived" && <span className="text-warn" title={SOURCE_LABEL.derived}>≈</span>}</> : <span className="text-mute">—</span>}</td>
              <td>{z.category ? <span className={clsx(z.category === "tight" ? "text-bad" : "text-bone-2")} title={z.note}>{z.category}{z.easeCm !== null ? ` (${z.easeCm > 0 ? "+" : ""}${z.easeCm})` : ""}</span> : <span className="text-mute" title={z.note}>—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(a.basis.camera.length > 0 || a.basis.derived.length > 0) && (
        <p className="text-[0.62rem] text-mute">
          {a.basis.camera.length > 0 && <>Camera estimates: {a.basis.camera.join(", ")} (± tolerance, never exact). </>}
          {a.basis.derived.length > 0 && <>Rough estimates from height & weight: {a.basis.derived.join(", ")} — measure with a tape for a reliable result.</>}
        </p>
      )}
      <ul className="space-y-1 text-[0.66rem]">
        <li className="flex gap-1.5"><Ruler className="mt-0.5 size-3 shrink-0 text-mute" /><span><b className="text-bone">Recommended size</b> — {a.statements.recommended}</span></li>
        <li className="flex gap-1.5"><Shirt className="mt-0.5 size-3 shrink-0 text-mute" /><span><b className="text-bone">Estimated fit</b> — {a.statements.estimated}</span></li>
        <li className="flex gap-1.5"><Eye className="mt-0.5 size-3 shrink-0 text-mute" /><span><b className="text-bone">Visual simulation</b> — {a.statements.simulated}</span></li>
        <li className="flex gap-1.5" data-testid="verified-fit">
          {sameModel.length ? <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-ok" /> : <Sparkles className="mt-0.5 size-3 shrink-0 text-mute" />}
          <span><b className="text-bone">Verified fit</b> — {sameModel.length ? sameModel.map((v) => `size ${v.size}: ${FIT_FEEDBACK_LABEL[v.overall]} (your feedback, ${new Date(v.createdAt).toLocaleDateString("en-IN")})`).join("; ") : a.statements.verified}</span>
        </li>
      </ul>
    </div>
  );
}
