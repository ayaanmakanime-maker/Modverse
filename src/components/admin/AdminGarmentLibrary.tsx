"use client";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface Row { id: string; name: string; audience: string; collection: string; path: string; thumbnail: string | null; licence: string; creator: string; triangles: number; qualityLevel: string; enabled: boolean }

/** Admin: the downloaded 3D garment library — licence, creator, quality level, and an on/off switch per garment. */
export function AdminGarmentLibrary() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const load = useCallback(() => fetch("/api/admin/garment-library").then((r) => r.json()).then((d) => setRows(d.garments ?? [])).catch(() => setError("Could not load the library")), []);
  useEffect(() => { load(); }, [load]);
  const toggle = async (r: Row) => {
    setError("");
    const res = await fetch("/api/admin/garment-library", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id, enabled: !r.enabled }) });
    if (!res.ok) setError((await res.json().catch(() => null))?.error?.message ?? "Only admins can change availability");
    load();
  };
  const shown = (rows ?? []).filter((r) => !q || `${r.name} ${r.collection} ${r.creator} ${r.audience}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <h1 className="mv-display text-3xl">3D garment library</h1>
      <p className="mt-2 max-w-3xl text-sm text-bone-2">Downloaded garment models with verified licences. Switch a garment off to hide it from customers. To add garments, list a source in <code>scripts/assets/sources.json</code> (or drop manually downloaded files in <code>asset-inbox/</code>) and run <code>npm run assets:acquire</code>; the pipeline checks the licence, validates the model, converts it and updates <code>docs/ASSET_VERIFICATION_REPORT.md</code>. Nothing appears here unless its file exists.</p>
      <div className="mt-4 flex items-center gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter" aria-label="Filter garments" className="mv-input w-64" />
        <span className="text-xs text-mute" data-testid="admin-garment-count">{rows ? `${rows.filter((r) => r.enabled).length} of ${rows.length} enabled` : "Loading…"}</span>
      </div>
      {error && <p className="mt-2 text-sm text-red-400" role="alert">{error}</p>}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-mute"><tr><th className="p-2">Garment</th><th className="p-2">Range</th><th className="p-2">Creator</th><th className="p-2">Licence</th><th className="p-2">Level</th><th className="p-2">Triangles</th><th className="p-2">Available</th></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className="border-t border-line" data-testid="admin-garment-row">
                <td className="p-2"><Link href={`/shop/${r.audience === "women" ? "women" : "men"}/${r.id}`} className="flex items-center gap-2 underline-offset-2 hover:underline">{r.thumbnail && <Image src={`/garment-library/${r.path}/${r.thumbnail}`} alt="" width={36} height={36} unoptimized className="rounded bg-surface-2" />}{r.name}</Link></td>
                <td className="p-2 text-bone-2">{r.audience} · {r.collection}</td>
                <td className="p-2 text-bone-2">{r.creator}</td>
                <td className="p-2 text-bone-2">{r.licence}</td>
                <td className="p-2 text-bone-2">{r.qualityLevel}</td>
                <td className="p-2 text-bone-2">{r.triangles.toLocaleString("en-IN")}</td>
                <td className="p-2"><button role="switch" aria-checked={r.enabled} onClick={() => toggle(r)} className={`mv-chip ${r.enabled ? "!border-champagne !text-bone" : ""}`} data-testid={`garment-toggle-${r.id}`}>{r.enabled ? "On" : "Off"}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
