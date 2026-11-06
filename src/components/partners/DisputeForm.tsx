"use client";
import { useState } from "react";
import { api, errorMessage } from "@/lib/client/api";
import { Button, Input, Select, toast } from "@/components/ui";

/** Raise a dispute on an order — used by customers (order page) and partners (job/shipment pages). */
export function DisputeForm({ orderId, jobId, shipmentId, title = "Raise a dispute with ModVerse", onSent }: { orderId: string; jobId?: string; shipmentId?: string; title?: string; onSent?: () => void }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("quality");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open) return <button className="text-xs text-mute underline" onClick={() => setOpen(true)} data-testid="dispute-open">{title}</button>;
  return (
    <section className="mv-card space-y-3 p-4" data-testid="dispute-form"><p className="mv-eyebrow">{title}</p>
      <div className="flex flex-wrap gap-2">
        <Select aria-label="Dispute type" value={kind} onChange={(e) => setKind(e.target.value)} className="!w-40">{["quality", "delay", "damage", "delivery", "payment", "other"].map((k) => <option key={k} value={k}>{k}</option>)}</Select>
        <Input placeholder="Describe the problem (at least 10 characters)" value={description} onChange={(e) => setDescription(e.target.value)} className="min-w-64 flex-1" data-testid="dispute-text" />
      </div>
      <div className="flex gap-2">
        <Button size="sm" loading={busy} disabled={description.trim().length < 10} onClick={async () => {
          setBusy(true);
          try {
            await api("/api/disputes", { body: { orderId, kind, description, jobId, shipmentId } });
            toast("Sent to ModVerse — we'll investigate");
            setOpen(false);
            setDescription("");
            onSent?.();
          } catch (e) {
            toast(errorMessage(e), "bad");
          } finally {
            setBusy(false);
          }
        }} data-testid="dispute-submit">Submit</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </section>
  );
}
