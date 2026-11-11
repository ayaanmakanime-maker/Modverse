"use client";
/** "Export Studio": every 3D format, grouped by use, from one baked garment scene. */
import { useEffect, useState } from "react";
import type * as THREE from "three";
import { Download } from "lucide-react";
import { toast } from "@/components/ui";
import { downloadBlob, EXPORT_GROUPS, export3D, ExportUnavailableError, FORMAT_INFO, type Export3DFormat } from "@/lib/three/export3d";

export function Export3DPanel({ getRoot, name, attribution, licence, compact, note }: { getRoot: () => THREE.Object3D | null | undefined; name: string; attribution?: string; licence?: string; compact?: boolean; note?: string }) {
  const [busy, setBusy] = useState<Export3DFormat | null>(null);
  const [usdc, setUsdc] = useState<boolean | null>(null);
  useEffect(() => { fetch("/api/export/usdc").then((r) => r.json()).then((d: { available?: boolean }) => setUsdc(!!d.available)).catch(() => setUsdc(false)); }, []);
  async function run(f: Export3DFormat) {
    const root = getRoot();
    if (!root) return toast("Open the 3D view and wait for the model to load first", "info");
    setBusy(f);
    try {
      const { blob, filename } = await export3D(root, f, { name, attribution, licence });
      downloadBlob(blob, filename);
    } catch (e) {
      toast(e instanceof ExportUnavailableError ? e.message : `Export failed: ${(e as Error).message}`, e instanceof ExportUnavailableError ? "info" : "bad");
    } finally { setBusy(null); }
  }
  return (
    <div className="space-y-3" data-testid="export-3d">
      {EXPORT_GROUPS.map((g) => (
        <div key={g.label}>
          <p className={compact ? "text-[0.6rem] uppercase tracking-widest text-mute" : "text-xs text-bone-2"}>{g.label}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {g.formats.map((f) => {
              const info = FORMAT_INFO[f];
              const off = f === "usdc" && usdc === false;
              return (
                <button key={f} type="button" className="mv-chip !px-2.5 !py-1 !text-[0.68rem]" disabled={!!busy} onClick={() => run(f)} title={`${info.keeps} · ${info.unit === "mm" ? "millimetres" : info.unit === "cm" ? "centimetres" : "metres"}${off ? " · needs OpenUSD on the server" : ""}`} data-testid={`export3d-${f}`} data-unavailable={off ? "1" : undefined}>
                  {busy === f ? "…" : <><Download className="mr-1 inline size-3" />{info.label}{f === "obj-print" ? " (mm)" : ""}</>}{off && <span className="ml-1 text-mute">*</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <p className="text-[0.62rem] text-mute">
        GLB is the default and keeps the most. OBJ and USD come as ZIPs with their textures. STL, 3MF and DXF are geometry for printing and CAD, in millimetres.{usdc === false ? " * USDC needs OpenUSD on the server; USDZ and USD work everywhere USD does." : ""} No rig, animation or cloth simulation is included.{note ? ` ${note}` : ""}
      </p>
    </div>
  );
}
