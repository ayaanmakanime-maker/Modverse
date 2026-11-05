"use client";
import Link from "next/link";
import { useState } from "react";
import { Copy, Pencil, Trash2, ShoppingBag, Send } from "lucide-react";
import { api, errorMessage } from "@/lib/client/api";
import { Badge, EmptyState, toast } from "@/components/ui";
import { useSession } from "@/components/session";
import { MODEL_BY_ID } from "@/lib/garment/models";

interface Row { id: string; name: string; audience: string; modelId: string; mode: string; status: string; currentVersion: number; updatedAt: string; reviewStatus: string; childProfileId: string | null }

export function DesignsList({ initial }: { initial: Row[] }) {
  const [rows, setRows] = useState(initial);
  const { setCartCount } = useSession();
  const act = async (fn: () => Promise<void>) => { try { await fn(); } catch (e) { toast(errorMessage(e), "bad"); } };
  if (!rows.length) return <EmptyState title="No saved designs" action={<Link href="/design/new" className="mv-btn mv-btn-primary">Start designing</Link>}>Designs you save from the studio appear here with their version history.</EmptyState>;
  return (
    <div className="space-y-2">
      <h1 className="mv-display text-3xl">My designs</h1>
      {rows.map((d) => (
        <div key={d.id} className="mv-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center" data-testid="design-row">
          <Link href={`/design/${d.id}?mode=${d.mode}`} className="min-w-0 flex-1">
            <p className="truncate font-medium">{d.name}</p>
            <p className="text-xs text-mute">{MODEL_BY_ID.get(d.modelId)?.name} · {d.audience}{d.childProfileId ? " · family" : ""} · {d.mode} · v{d.currentVersion} · {new Date(d.updatedAt).toLocaleString("en-IN")}</p>
          </Link>
          <div className="flex flex-wrap items-center gap-1">
            <Badge tone={d.status === "validated" || d.status === "approved" ? "ok" : d.status === "ordered" ? "accent" : "neutral"}>{d.status}</Badge>
            {d.reviewStatus !== "none" && <Badge tone="info">review: {d.reviewStatus.replace("_", " ")}</Badge>}
            <button className="mv-chip" title="Rename" onClick={() => act(async () => { const n = prompt("New name", d.name); if (!n) return; await api(`/api/designs/${d.id}`, { method: "PATCH", body: { name: n } }); setRows(rows.map((r) => (r.id === d.id ? { ...r, name: n } : r))); })}><Pencil className="size-3" /></button>
            <button className="mv-chip" title="Duplicate" onClick={() => act(async () => { const r = await api<{ design: Row }>(`/api/designs/${d.id}/duplicate`, { method: "POST" }); setRows([{ ...r.design, updatedAt: new Date().toISOString() }, ...rows]); toast("Duplicated"); })}><Copy className="size-3" /></button>
            <button className="mv-chip" title="Request production review" onClick={() => act(async () => { await api(`/api/designs/${d.id}/review`, { method: "POST" }); setRows(rows.map((r) => (r.id === d.id ? { ...r, reviewStatus: "pending", status: "in_review" } : r))); toast("Sent for studio review"); })}><Send className="size-3" /></button>
            <button className="mv-chip" title="Add to cart" onClick={() => act(async () => { const r = await api<{ cart: { lines: { quantity: number }[] } }>("/api/cart", { body: { projectId: d.id, quantity: 1 } }); setCartCount(r.cart.lines.reduce((a, l) => a + l.quantity, 0)); toast("Added to cart"); })}><ShoppingBag className="size-3" /></button>
            <button className="mv-chip text-bad" title="Delete" onClick={() => act(async () => { if (!confirm(`Delete "${d.name}"?`)) return; await api(`/api/designs/${d.id}`, { method: "DELETE" }); setRows(rows.filter((r) => r.id !== d.id)); })}><Trash2 className="size-3" /></button>
          </div>
        </div>
      ))}
    </div>
  );
}
