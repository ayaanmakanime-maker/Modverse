"use client";
/** Shared rendering of a made-to-order collection garment line (cart, orders, admin, partner portal). */
import clsx from "clsx";
import { describeMto, getMtoFabric, mtoProfileFor, parseLibraryLine } from "@/lib/garment/made-to-order";

export function MtoThumb({ snapshot, className }: { snapshot: unknown; className?: string }) {
  const line = parseLibraryLine(snapshot);
  const colour = line && getMtoFabric(line.options.fabricId)?.colours.find((c) => c.id === line.options.colourId);
  return (
    <span className={clsx("relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-2", className)} data-testid="mto-thumb">
      {line?.garment.thumbnail ? <img src={line.garment.thumbnail} alt="" className="h-full w-full object-contain p-1" /> : null}
      {colour && <span className="absolute bottom-1 right-1 size-3.5 rounded-full border border-line" style={{ background: colour.hex }} title={colour.name} />}
    </span>
  );
}

/** Production details a workshop needs; `prices` is never shown here. */
export function MtoDetails({ snapshot, compact }: { snapshot: unknown; compact?: boolean }) {
  const line = parseLibraryLine(snapshot);
  if (!line) return <p className="text-xs text-bad">Unreadable made-to-order item</p>;
  const { garment, options: o } = line;
  const p = mtoProfileFor(garment.category);
  const fabric = getMtoFabric(o.fabricId);
  if (compact) return <p className="text-xs text-mute">{describeMto(garment, o)}</p>;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs" data-testid="mto-details">
      <dt className="text-mute">Style</dt><dd>{garment.name} · {p?.label ?? garment.category} · {garment.audience}</dd>
      <dt className="text-mute">Fabric</dt><dd>{fabric ? `${fabric.name} · ${fabric.composition} · ${fabric.gsm} GSM · ${fabric.colours.find((c) => c.id === o.colourId)?.name ?? o.colourId}` : o.fabricId}</dd>
      <dt className="text-mute">Size</dt><dd>{o.measurementProfileId ? "Made to measure (customer's saved measurements)" : o.size} · {o.fit} fit{o.lengthAdjustCm ? ` · length ${o.lengthAdjustCm > 0 ? "+" : ""}${o.lengthAdjustCm} cm` : ""}{o.sleeveAdjustCm ? ` · sleeves ${o.sleeveAdjustCm > 0 ? "+" : ""}${o.sleeveAdjustCm} cm` : ""}</dd>
      {!!p?.trims.length && <><dt className="text-mute">Trims</dt><dd>{p.trims.map((t) => `${t.label}: ${t.options.find((x) => x.id === o.trims[t.id])?.label ?? t.options[0].label}`).join(" · ")}</dd></>}
      {o.monogram && <><dt className="text-mute">Monogram</dt><dd>&ldquo;{o.monogram.text}&rdquo; · {o.monogram.placement} · {o.monogram.thread} thread</dd></>}
      {!!o.artwork.length && <><dt className="text-mute">Artwork</dt><dd>{o.artwork.map((a) => `${a.zone}: ${a.method.toUpperCase()} ${a.widthCm}×${a.heightCm} cm`).join(" · ")}</dd></>}
      {p && <><dt className="text-mute">Lead time</dt><dd>{p.leadDays[0]}–{p.leadDays[1]} working days after approval</dd></>}
    </dl>
  );
}
