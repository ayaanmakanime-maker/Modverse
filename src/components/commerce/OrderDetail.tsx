"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import clsx from "clsx";
import { api, errorMessage } from "@/lib/client/api";
import { formatINR } from "@/lib/garment/pricing";
import { Logo } from "@/components/brand/Logo";
import { Badge, Button, Notice, Select, toast } from "@/components/ui";
import { FIT_FEEDBACK_LABEL, FIT_FEEDBACK_SCALE, type FitFeedbackValue } from "@/lib/garment/fit";

/** "Verified fit": only the customer, after wearing the delivered garment, can verify fit. */
function FitFeedbackForm({ itemId, existing }: { itemId: string; existing?: { overall: FitFeedbackValue; areas: Record<string, FitFeedbackValue> } }) {
  const [overall, setOverall] = useState<FitFeedbackValue>(existing?.overall ?? "true");
  const [areas, setAreas] = useState<Record<string, FitFeedbackValue>>(existing?.areas ?? {});
  const [saved, setSaved] = useState(!!existing);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await api("/api/account/fit-feedback", { body: { orderItemId: itemId, overall, areas } });
      setSaved(true);
      toast("Thanks — your verified fit is saved and improves future size recommendations");
    } catch (e) {
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-line p-2" data-testid="fit-feedback">
      <p className="text-[0.68rem] text-bone-2">How did it fit? {saved && <Badge tone="ok">verified fit saved</Badge>}</p>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Select aria-label="Overall fit" value={overall} onChange={(e) => setOverall(e.target.value as FitFeedbackValue)} className="!w-auto !py-1 !text-xs" data-testid="fit-overall">
          {FIT_FEEDBACK_SCALE.map((v) => <option key={v} value={v}>{FIT_FEEDBACK_LABEL[v]}</option>)}
        </Select>
        {(["chest", "length", "sleeves", "shoulders"] as const).map((a) => (
          <Select key={a} aria-label={`${a} fit`} value={areas[a] ?? ""} onChange={(e) => setAreas({ ...areas, [a]: e.target.value as FitFeedbackValue })} className="!w-auto !py-1 !text-[0.65rem]">
            <option value="">{a}: —</option>
            {FIT_FEEDBACK_SCALE.map((v) => <option key={v} value={v}>{a}: {FIT_FEEDBACK_LABEL[v]}</option>)}
          </Select>
        ))}
        <Button size="sm" loading={busy} onClick={submit} data-testid="fit-submit">{saved ? "Update" : "Save"}</Button>
      </div>
    </div>
  );
}

const FLOW = ["pending_payment", "payment_confirmed", "design_validation", "awaiting_production_approval", "manufacturing", "quality_inspection", "packed", "shipped", "delivered"];

interface Data {
  order: { id: string; orderNumber: string; status: string; subtotal: number; gst: number; shipping: number; total: number; isSimulated: boolean; paymentStatus: string; createdAt: string; shippingAddress: Record<string, string> };
  items: { id: string; designName: string; size: string; quantity: number; unitPrice: number; version: number; reviewStatus: string; projectId: string | null; specSnapshot: { validation?: { status: string } } }[];
  events: { id: string; status: string; note: string | null; createdAt: string }[];
  payments: { provider: string; environment: string; status: string; amount: number; signatureVerified: boolean; providerPaymentId: string | null }[];
  shipments: { courier: string | null; awb: string | null; status: string; trackingUrl: string | null }[];
}

export function OrderDetail({ data, confirmation }: { data: Data; confirmation?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const o = data.order;
  const step = FLOW.indexOf(o.status);
  const canVerify = o.status === "shipped" || o.status === "delivered";
  const [feedback, setFeedback] = useState<Record<string, { overall: FitFeedbackValue; areas: Record<string, FitFeedbackValue> }>>({});
  useEffect(() => {
    if (!canVerify) return;
    api<{ feedback: { orderItemId: string; overall: FitFeedbackValue; areas: Record<string, FitFeedbackValue> }[] }>("/api/account/fit-feedback").then((r) => setFeedback(Object.fromEntries(r.feedback.map((f) => [f.orderItemId, f])))).catch(() => undefined);
  }, [canVerify]);
  async function pay() {
    setBusy(true);
    try {
      await api(`/api/orders/${o.id}/pay`, { body: { method: "simulated" } });
      toast("Simulated payment confirmed — no money was charged");
      router.refresh();
    } catch (e) {
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6" data-testid="order-detail">
      {confirmation && <div className="flex flex-col items-center gap-3 py-6 text-center"><Logo variant="lockup" className="w-56" /><p className="mv-display text-3xl">Thank you — your order is placed</p></div>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="mv-eyebrow">Order</p><h1 className="font-mono text-2xl">{o.orderNumber}</h1><p className="text-xs text-mute">{new Date(o.createdAt).toLocaleString("en-IN")}</p></div>
        <div className="flex gap-1">{o.isSimulated && <Badge tone="warn">simulated payment — local test mode</Badge>}<Badge>{o.status.replace(/_/g, " ")}</Badge></div>
      </div>
      {o.status === "pending_payment" && o.isSimulated && (
        <Notice tone="warn" title="Simulated checkout">No payment provider is configured, so this is a clearly-labelled local simulation. Confirming moves no money.
          <div className="mt-2"><Button size="sm" loading={busy} onClick={pay} data-testid="simulate-payment">Confirm simulated payment of {formatINR(o.total)}</Button></div>
        </Notice>
      )}
      <ol className="grid gap-2 sm:grid-cols-3 lg:grid-cols-9" aria-label="Order progress">
        {FLOW.map((s, i) => (
          <li key={s} className={clsx("flex items-center gap-1.5 text-[0.68rem] lg:flex-col lg:text-center", i <= step ? "text-bone" : "text-mute-2")}>
            {i <= step ? <CheckCircle2 className="size-4 text-ok" /> : <Circle className="size-4" />}{s.replace(/_/g, " ")}
          </li>
        ))}
      </ol>
      {(o.status === "cancelled" || o.status === "refunded") && <Notice tone="bad">This order is {o.status}.</Notice>}
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="mv-card divide-y divide-line">
          {data.items.map((it) => (
            <div key={it.id} className="p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <div><p>{it.designName} <span className="text-mute">· v{it.version} snapshot</span></p><p className="text-xs text-mute">Size {it.size} · qty {it.quantity} · review {it.reviewStatus.replace("_", " ")} · checks {it.specSnapshot.validation?.status ?? "-"}</p></div>
                <span className="tabular-nums">{formatINR(it.unitPrice * it.quantity)}</span>
              </div>
              {canVerify && <FitFeedbackForm key={feedback[it.id] ? "has" : "new"} itemId={it.id} existing={feedback[it.id]} />}
            </div>
          ))}
          <div className="space-y-1 p-3 text-sm">
            <p className="flex justify-between text-mute"><span>Subtotal</span><span>{formatINR(o.subtotal)}</span></p>
            <p className="flex justify-between text-mute"><span>GST (estimate)</span><span>{formatINR(o.gst)}</span></p>
            <p className="flex justify-between text-mute"><span>Shipping</span><span>{o.shipping ? formatINR(o.shipping) : "Free"}</span></p>
            <p className="flex justify-between font-medium"><span>Total</span><span>{formatINR(o.total)}</span></p>
          </div>
        </div>
        <div className="space-y-3 text-sm">
          <div className="mv-card p-3"><p className="mv-label">Ship to</p><p>{o.shippingAddress.fullName}</p><p className="text-mute">{o.shippingAddress.line1}{o.shippingAddress.line2 ? `, ${o.shippingAddress.line2}` : ""}, {o.shippingAddress.city}, {o.shippingAddress.state} {o.shippingAddress.pincode}</p></div>
          <div className="mv-card p-3"><p className="mv-label">Payment</p>{data.payments.map((p, i) => <p key={i}>{p.provider} ({p.environment}) · {p.status}{p.signatureVerified ? " · signature verified" : ""}</p>)}</div>
          <div className="mv-card p-3"><p className="mv-label">Tracking</p>{data.shipments.length ? data.shipments.map((s, i) => <p key={i}>{s.courier} · AWB {s.awb} · {s.status}{s.trackingUrl && <> · <a className="underline" href={s.trackingUrl} target="_blank" rel="noopener noreferrer">track</a></>}</p>) : <p className="text-mute">Tracking appears once the order ships. No courier integration is active in local mode.</p>}</div>
        </div>
      </div>
      <div>
        <h2 className="mv-display text-xl">Timeline</h2>
        <ul className="mt-2 space-y-1 text-xs">{data.events.map((e) => <li key={e.id} className="flex gap-3"><span className="w-36 shrink-0 text-mute">{new Date(e.createdAt).toLocaleString("en-IN")}</span><span>{e.status.replace(/_/g, " ")}{e.note ? ` — ${e.note}` : ""}</span></li>)}</ul>
      </div>
      {["pending_payment", "payment_confirmed", "design_validation", "awaiting_production_approval"].includes(o.status) && (
        <button className="text-xs text-mute underline" onClick={async () => { if (!confirm("Cancel this order?")) return; try { await api(`/api/orders/${o.id}/cancel`, { method: "POST" }); router.refresh(); } catch (e) { toast(errorMessage(e), "bad"); } }}>Cancel order</button>
      )}
      <p className="text-xs text-mute"><Link href="/account/orders" className="underline">All orders</Link></p>
    </div>
  );
}
