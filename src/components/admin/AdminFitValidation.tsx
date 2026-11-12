"use client";
import { useEffect, useState } from "react";
import type { RegionStats, SizeAgreement } from "@/lib/tryon/validation";

interface Data { evidence: { subjects: number; samples: number; level: string; statement: string }; regions: RegionStats[]; sizes: SizeAgreement; byAudience: { men: RegionStats[]; women: RegionStats[] } }
const LABEL: Record<string, string> = { height: "Height", chest: "Chest / bust", waist: "Waist", hip: "Hip", shoulder: "Shoulder width", armLength: "Arm length", torsoLength: "Torso length", inseam: "Inseam", neck: "Neck", bicep: "Bicep", wrist: "Wrist" };

function Table({ rows }: { rows: RegionStats[] }) {
  if (!rows.length) return <p className="mt-2 text-sm text-mute">No comparisons recorded.</p>;
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-left text-sm" data-testid="fit-validation-table">
        <thead className="text-xs text-mute"><tr><th className="p-2">Region</th><th className="p-2">Samples</th><th className="p-2">Mean abs. error</th><th className="p-2">RMSE</th><th className="p-2">Bias (scan − tape)</th><th className="p-2">Error %</th><th className="p-2">Worst</th><th className="p-2">Repeatability (SD)</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.key} className="border-t border-line" data-testid={`fit-validation-${r.key}`}>
            <td className="p-2">{LABEL[r.key]}</td><td className="p-2">{r.n}</td><td className="p-2">{r.mae} cm</td><td className="p-2">{r.rmse} cm</td>
            <td className="p-2">{r.bias > 0 ? "+" : ""}{r.bias} cm</td><td className="p-2">{r.mape}%</td><td className="p-2">{r.worst} cm</td>
            <td className="p-2">{r.repeatability === null ? "needs repeat scans" : `${r.repeatability} cm (${r.repeatSubjects} people)`}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

/** Admin: how the body scan compares with tape measurements. Shows only what the recorded samples support. */
export function AdminFitValidation() {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { fetch("/api/admin/fit-validation").then((r) => r.json()).then(setD).catch(() => setErr("Could not load")); }, []);
  if (!d) return <p className="text-sm text-mute">{err || "Loading…"}</p>;
  return (
    <div>
      <h1 className="mv-display text-3xl">Fit accuracy</h1>
      <p className="mt-2 max-w-3xl text-sm text-bone-2">Scan values compared with tape measurements of the same person, contributed with consent from the scanner&apos;s review step. Numbers only; contributors are not shown.</p>
      <p className={`mt-4 rounded-lg border p-3 text-sm ${d.evidence.level === "study" ? "border-line text-bone-2" : "border-warn/50 text-warn"}`} data-testid="fit-validation-evidence">{d.evidence.statement} ({d.evidence.samples} comparison{d.evidence.samples === 1 ? "" : "s"})</p>
      <h2 className="mt-6 text-sm text-bone">All ranges</h2>
      <Table rows={d.regions} />
      <h2 className="mt-6 text-sm text-bone">Size recommendation</h2>
      <p className="mt-1 text-sm text-bone-2" data-testid="fit-validation-sizes">{d.sizes.n ? `For a regular-fit T-shirt, the size recommended from the scan matched the size from the tape in ${d.sizes.exact} of ${d.sizes.n} comparisons (${d.sizes.exactPct}%); within one size in ${d.sizes.withinOnePct}%.` : "No comparison includes a camera chest value and a tape chest value yet."}</p>
      <h2 className="mt-6 text-sm text-bone">Men</h2><Table rows={d.byAudience.men} />
      <h2 className="mt-6 text-sm text-bone">Women</h2><Table rows={d.byAudience.women} />
      <p className="mt-6 text-xs text-mute">How to run a study: scan each volunteer twice (same person code) on the device you care about, then enter tape measurements taken by one trained person. Aim for 30 or more people across sizes before quoting any figure. <a className="underline" href="/api/admin/fit-validation?format=csv">Download CSV</a></p>
    </div>
  );
}
