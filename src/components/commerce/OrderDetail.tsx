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
import { useSession } from "@/components/session";
import { DisputeForm } from "@/components/partners/DisputeForm";
import { DesignFlat } from "@/components/garment/DesignFlat";
import { MtoDetails, MtoThumb } from "./MtoLine";
import type { DesignConfig } from "@/lib/garment/schema";

/** Customer-facing production wording (partner identities are never shown). */
const PRODUCTION_LABEL: Record<string, string> = {
  offered: "Matching your order with a ModVerse workshop", accepted: "Workshop confirmed — preparing production", quoted: "Workshop confirmed — preparing production",
  quote_approved: "Scheduled for production", in_production: "In production", rework: "In production — quality rework", qc_passed: "Passed quality inspection",
  ready_to_dispatch: "Packed — awaiting courier pickup", dispatched: "Handed to the courier",
};

function MyDisputes({ orderId, version }: { orderId: string; version: number }) {
  const [list, setList] = useState<{ id: string; kind: string; status: string; description: string; resolution: string | null; createdAt: string }[]>([]);
  useEffect(() => {
    api<{ disputes: typeof list }>(`/api/disputes?orderId=${orderId}`).then((r) => setList(r.disputes)).catch(() => undefined);
  }, [orderId, version]);
  if (!list.length) return null;
  return (
    <div className="mv-card p-3 text-sm" data-testid="my-disputes">
      <p className="mv-label">Reported problems</p>
      {list.map((d) => <p key={d.id} className="mt-1"><Badge tone={d.status === "resolved" ? "ok" : d.status === "rejected" ? "bad" : "warn"}>{d.status}</Badge> {d.kind}: {d.description}{d.resolution ? <span className="text-mute"> — ModVerse: {d.resolution}</span> : null}</p>)}
    </div>
  );
}

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
  order: { id: string; orderNumber: string; status: string; subtotal: number; discount?: number; discountCode?: string | null; gst: number; shipping: number; total: number; isSimulated: boolean; paymentStatus: string; createdAt: string; shippingAddress: Record<string, string> };
  items: { id: string; kind?: "design" | "library"; designName: string; size: string; quantity: number; unitPrice: number; version: number; reviewStatus: string; projectId: string | null; designSnapshot?: DesignConfig | Record<string, unknown>; specSnapshot: { validation?: { status: string } } }[];
  events: { id: string; status: string; note: string | null; createdAt: string }[];
  payments: { provider: string; environment: string; status: string; amount: number; signatureVerified: boolean; providerPaymentId: string | null }[];
  shipments: { courier: string | null; awb: string | null; status: string; trackingUrl: string | null; direction?: string; events?: { at: string; status: string; location?: string | null; note?: string | null }[]; podName?: string | null }[];
  fulfilment?: { production: { status: string; stage: string | null } | null };
}

export function OrderDetail({ data, confirmation }: { data: Data; confirmation?: boolean }) {
  const router = useRouter();
  const { setCartCount } = useSession();
  const [busy, setBusy] = useState(false);
  const [disputeVersion, setDisputeVersion] = useState(0);
  const o = data.order;
  const production = data.fulfilment?.production;
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
      {confirmation && FLOW.indexOf(o.status) <= FLOW.indexOf("awaiting_production_approval") && FLOW.indexOf(o.status) >= 0 && <div className="flex flex-col items-center gap-3 py-6 text-center"><Logo variant="lockup" className="w-56" /><p className="mv-display text-3xl">Thank you — your order is placed</p></div>}
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
                {it.kind === "library" ? <MtoThumb snapshot={it.designSnapshot} className="h-14 w-14" /> : it.designSnapshot && <div className="grid w-28 shrink-0 grid-cols-2 gap-1"><DesignFlat config={it.designSnapshot as DesignConfig} view="front" className="h-14 w-full" /><DesignFlat config={it.designSnapshot as DesignConfig} view="back" className="h-14 w-full" /></div>}
                <div className="min-w-0 flex-1"><p>{it.designName} <span className="text-mute">· {it.kind === "library" ? "made to order" : `v${it.version} snapshot`}</span></p>{it.kind === "library" && <MtoDetails snapshot={it.designSnapshot} compact />}<p className="text-xs text-mute">Size {it.size} · qty {it.quantity} · review {it.reviewStatus.replace("_", " ")} · checks {it.specSnapshot.validation?.status ?? "-"}</p></div>
                <span className="tabular-nums">{formatINR(it.unitPrice * it.quantity)}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button className="mv-chip !text-[0.65rem]" data-testid="reorder-item" onClick={async () => { try { const r = await api<{ cart: { lines: { quantity: number }[] }; restored: number }>(`/api/orders/${o.id}/reorder`, { body: { itemId: it.id } }); setCartCount(r.cart.lines.reduce((a, l) => a + l.quantity, 0)); toast(r.restored ? "Restored the ordered design and added it to your cart" : "Added to your cart at today's price"); } catch (e) { toast(errorMessage(e), "bad"); } }}>Reorder</button>
                {it.kind !== "library" && <button className="mv-chip !text-[0.65rem]" data-testid="redesign-item" onClick={async () => { try { const r = await api<{ projectId: string }>(`/api/orders/${o.id}/redesign`, { body: { itemId: it.id } }); router.push(`/design/${r.projectId}?mode=atelier`); } catch (e) { toast(errorMessage(e), "bad"); } }}>Redesign</button>}
              </div>
              {canVerify && <FitFeedbackForm key={feedback[it.id] ? "has" : "new"} itemId={it.id} existing={feedback[it.id]} />}
            </div>
          ))}
          <div className="space-y-1 p-3 text-sm">
            <p className="flex justify-between text-mute"><span>Subtotal</span><span>{formatINR(o.subtotal)}</span></p>
            {!!o.discount && <p className="flex justify-between text-ok"><span>Discount {o.discountCode}</span><span>−{formatINR(o.discount)}</span></p>}
            <p className="flex justify-between text-mute"><span>GST (estimate)</span><span>{formatINR(o.gst)}</span></p>
            <p className="flex justify-between text-mute"><span>Shipping</span><span>{o.shipping ? formatINR(o.shipping) : "Free"}</span></p>
            <p className="flex justify-between font-medium"><span>Total</span><span>{formatINR(o.total)}</span></p>
          </div>
        </div>
        <div className="space-y-3 text-sm">
          <div className="mv-card p-3"><p className="mv-label">Ship to</p><p>{o.shippingAddress.fullName}</p><p className="text-mute">{o.shippingAddress.line1}{o.shippingAddress.line2 ? `, ${o.shippingAddress.line2}` : ""}, {o.shippingAddress.city}, {o.shippingAddress.state} {o.shippingAddress.pincode}</p></div>
          <div className="mv-card p-3"><p className="mv-label">Payment</p>{data.payments.map((p, i) => <p key={i}>{p.provider} ({p.environment}) · {p.status}{p.signatureVerified ? " · signature verified" : ""}</p>)}</div>
          {production && PRODUCTION_LABEL[production.status] && !["shipped", "delivered", "cancelled", "refunded"].includes(o.status) && <div className="mv-card p-3" data-testid="order-production"><p className="mv-label">Production</p><p>{PRODUCTION_LABEL[production.status]}{production.status === "in_production" && production.stage ? ` — ${production.stage}` : ""}</p></div>}
          <div className="mv-card p-3" data-testid="order-tracking"><p className="mv-label">Tracking</p>{data.shipments.length ? data.shipments.map((s, i) => (
            <div key={i} className={clsx(i > 0 && "mt-2 border-t border-line pt-2")}>
              <p>{s.direction === "return" ? "Return · " : ""}{s.courier} · AWB {s.awb ?? "being generated"} · {s.status.replace(/_/g, " ")}{s.trackingUrl && <> · <a className="underline" href={s.trackingUrl} target="_blank" rel="noopener noreferrer">track</a></>}</p>
              {!!s.events?.length && <ul className="mt-1 space-y-0.5 text-xs text-mute">{[...s.events].reverse().slice(0, 6).map((e, j) => <li key={j}>{new Date(e.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} — {e.status.replace(/_/g, " ")}{e.location ? ` · ${e.location}` : ""}</li>)}</ul>}
              {s.podName && <p className="text-xs text-mute">Received by {s.podName}</p>}
            </div>
          )) : <p className="text-mute">Tracking appears once the order ships.</p>}</div>
          <MyDisputes orderId={o.id} version={disputeVersion} />
        </div>
      </div>
      <div>
        <h2 className="mv-display text-xl">Timeline</h2>
        <ul className="mt-2 space-y-1 text-xs">{data.events.map((e) => <li key={e.id} className="flex gap-3"><span className="w-36 shrink-0 text-mute">{new Date(e.createdAt).toLocaleString("en-IN")}</span><span>{e.status.replace(/_/g, " ")}{e.note ? ` — ${e.note}` : ""}</span></li>)}</ul>
      </div>
      {["pending_payment", "payment_confirmed", "design_validation", "awaiting_production_approval"].includes(o.status) && (
        <button className="text-xs text-mute underline" onClick={async () => { if (!confirm("Cancel this order?")) return; try { await api(`/api/orders/${o.id}/cancel`, { method: "POST" }); router.refresh(); } catch (e) { toast(errorMessage(e), "bad"); } }}>Cancel order</button>
      )}
      {!["pending_payment", "cancelled"].includes(o.status) && <DisputeForm orderId={o.id} title="Report a problem with this order" onSent={() => setDisputeVersion((v) => v + 1)} />}
      <p className="text-xs text-mute"><Link href="/account/orders" className="underline">All orders</Link></p>
    </div>
  );
}
