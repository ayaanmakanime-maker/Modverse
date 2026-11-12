"use client";
import { useCallback, useEffect, useState } from "react";

interface Source { id: string; name: string; sourceUrl: string; package: string | null; creator: string; licence: string; licenceUrl: string | null; commercial: boolean; attributionRequired: boolean; attribution: string; redistribution: string; downloadedAt: string; approval: "approved" | "pending" | "rejected"; assetCount: number; style: string | null }
interface Data { sources: Source[]; modverseAssets: number; excluded: Record<string, number>; generatedAt: string | null; emojiData: string | null }

/** Admin: the graphics registry — every external source with its licence terms, and approval per source. */
export function AdminGraphics() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => fetch("/api/admin/graphics").then((r) => r.json()).then(setData).catch(() => setError("Could not load the registry")), []);
  useEffect(() => { load(); }, [load]);
  const set = async (s: Source, approval: Source["approval"]) => {
    setError("");
    const res = await fetch("/api/admin/graphics", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: s.id, approval }) });
    if (!res.ok) setError((await res.json().catch(() => null))?.error?.message ?? "Only admins can change approval");
    load();
  };
  const total = (data?.sources ?? []).reduce((n, s) => n + (s.approval === "approved" ? s.assetCount : 0), 0) + (data?.modverseAssets ?? 0);
  return (
    <div>
      <h1 className="mv-display text-3xl">Graphics registry</h1>
      <p className="mt-2 max-w-3xl text-sm text-bone-2">Openly licensed graphics imported by <code>npm run graphics:import</code> from pinned npm packages. Each package&apos;s licence is checked against the expected licence before import; brand logos, third-party characters, realistic firearms, gore, hate symbols and sub-national flags are excluded. Rejecting or suspending a source hides all its graphics immediately (designs that already use them keep their copy).</p>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-mute">
        <span data-testid="registry-total">{data ? `${total.toLocaleString("en-IN")} graphics visible (${data.modverseAssets.toLocaleString("en-IN")} ModVerse assets)` : "Loading…"}</span>
        {data?.generatedAt && <span>Imported {data.generatedAt.slice(0, 10)} · keywords: {data.emojiData}</span>}
        <a className="mv-btn mv-btn-ghost !px-3 !py-1 !text-xs" href="/api/admin/graphics?format=csv" data-testid="registry-csv">Download registry (CSV, every asset)</a>
      </div>
      {error && <p className="mt-2 text-sm text-red-400" role="alert">{error}</p>}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-xs" data-testid="registry-table">
          <thead className="text-mute"><tr><th className="p-2">Source</th><th className="p-2">Licence</th><th className="p-2">Credit on product</th><th className="p-2">Redistribution</th><th className="p-2">Package · date</th><th className="p-2 text-right">Graphics</th><th className="p-2">Approval</th></tr></thead>
          <tbody>
            {(data?.sources ?? []).map((s) => (
              <tr key={s.id} className="border-t border-line align-top" data-testid={`registry-${s.id}`}>
                <td className="p-2"><a className="underline" href={s.sourceUrl} target="_blank" rel="noopener noreferrer">{s.name}</a><div className="text-mute">{s.creator}</div></td>
                <td className="p-2">{s.licenceUrl ? <a className="underline" href={s.licenceUrl} target="_blank" rel="noopener noreferrer">{s.licence}</a> : s.licence}<div className="text-mute">{s.commercial ? "commercial use allowed" : "non-commercial"}</div></td>
                <td className="p-2">{s.attributionRequired ? <span className="text-warn">Required</span> : "Not required"}<div className="text-mute">{s.attribution}</div></td>
                <td className="p-2 text-mute">{s.redistribution}</td>
                <td className="p-2 font-mono text-[0.65rem]">{s.package}<div>{s.downloadedAt}</div></td>
                <td className="p-2 text-right">{s.assetCount.toLocaleString("en-IN")}</td>
                <td className="p-2">
                  <select className="mv-input !w-32 !py-1 !text-xs" value={s.approval} onChange={(e) => set(s, e.target.value as Source["approval"])} aria-label={`Approval for ${s.name}`} data-testid={`approval-${s.id}`}>
                    <option value="approved">Approved</option><option value="pending">Suspended</option><option value="rejected">Rejected</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && Object.keys(data.excluded).length > 0 && (
        <div className="mt-6 text-xs">
          <h2 className="font-medium text-bone">Excluded at import</h2>
          <ul className="mt-1 grid gap-0.5 text-mute sm:grid-cols-2">{Object.entries(data.excluded).sort((a, b) => b[1] - a[1]).map(([k, n]) => <li key={k}>{k}: {n.toLocaleString("en-IN")}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
