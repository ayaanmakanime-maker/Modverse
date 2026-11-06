"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/client/api";
import { JOB_STATUS_LABEL } from "@/lib/partners/constants";
import { Badge, Button, EmptyState, Input, Modal, Notice, Select, Spinner, toast } from "@/components/ui";

function useApi<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => api<T>(url).then(setData).catch((e) => setError(errorMessage(e))), [url]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, error, reload, setData };
}
const H1 = ({ children }: { children: React.ReactNode }) => <h1 className="mv-display mb-6 text-4xl">{children}</h1>;
const human = (s: string) => s.replace(/_/g, " ");
const day = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString("en-IN", { dateStyle: "medium" }) : "—");
const when = (d: string | null | undefined) => (d ? new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");
const tone = (s: string): "ok" | "warn" | "bad" | "info" => (["approved", "qc_passed", "ready_to_dispatch", "dispatched", "delivered", "returned", "quote_approved", "resolved"].includes(s) ? "ok" : ["pending", "offered", "quoted", "rework", "failed_delivery", "rto_initiated", "open", "investigating"].includes(s) ? "warn" : ["rejected", "suspended", "cancelled"].includes(s) ? "bad" : "info");
async function run(fn: () => Promise<unknown>, ok: string, after?: () => unknown) {
  try {
    await fn();
    toast(ok);
    await after?.();
  } catch (e) {
    toast(errorMessage(e), "bad");
  }
}

// ── Partners ──────────────────────────────────────────────────────
interface Org { id: string; type: "manufacturer" | "logistics"; name: string; legalName: string | null; gstin: string | null; contactEmail: string; phone: string | null; city: string | null; state: string | null; status: string; capabilities: Record<string, unknown>; adminNotes: string | null; createdAt: string; reviewedAt: string | null }

function capsSummary(o: Org) {
  const c = o.capabilities as Record<string, unknown>;
  if (o.type === "manufacturer") return `${(c.methods as string[]).join(", ")} · ${(c.garmentTypes as string[]).join(", ")} · ${(c.audiences as string[]).join(", ")} · ${(c.fabrics as string[]).join("/")} · MOQ ${c.minOrderQty} · ${c.dailyCapacity}/day · ${c.leadTimeDays} days`;
  return `${(c.couriers as string[]).join(", ")} · ${(c.serviceStates as string[] | undefined)?.length ? (c.serviceStates as string[]).join(", ") : "pan-India"}${c.cod ? " · COD" : ""}${c.express ? " · express" : ""} · ≤${c.maxWeightKg} kg`;
}

export function AdminPartners() {
  const [status, setStatus] = useState("pending");
  const [type, setType] = useState("");
  const qs = new URLSearchParams(Object.entries({ status, type }).filter(([, v]) => v)).toString();
  const { data, error, reload } = useApi<{ organizations: Org[] }>(`/api/admin/partners${qs ? `?${qs}` : ""}`);
  const decide = (o: Org, decision: string) => {
    const note = decision === "approve" || decision === "reinstate" ? undefined : prompt(`Note for ${o.name} (${decision})`) ?? undefined;
    if (decision !== "approve" && decision !== "reinstate" && note === undefined) return;
    run(() => api(`/api/admin/partners/${o.id}`, { method: "PATCH", body: { decision, note } }), `${o.name}: ${decision}d`, reload);
  };
  return (
    <div data-testid="admin-partners">
      <H1>Partners</H1>
      <div className="mb-4 flex flex-wrap gap-2">
        {[["pending", "Awaiting approval"], ["approved", "Approved"], ["suspended", "Suspended"], ["rejected", "Rejected"], ["", "All"]].map(([v, l]) => <button key={v} className="mv-chip" data-active={status === v} onClick={() => setStatus(v)}>{l}</button>)}
        <Select aria-label="Partner type" value={type} onChange={(e) => setType(e.target.value)} className="!w-44"><option value="">All types</option><option value="manufacturer">Manufacturers</option><option value="logistics">Logistics</option></Select>
      </div>
      {error && <Notice tone="bad">{error}</Notice>}
      {!data ? <Spinner /> : !data.organizations.length ? <EmptyState title="No partners here" /> : (
        <div className="space-y-2">{data.organizations.map((o) => (
          <div key={o.id} className="mv-card space-y-2 p-3 text-sm" data-testid="partner-row">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{o.name}</span><Badge>{o.type}</Badge><Badge tone={tone(o.status)}>{o.status}</Badge>
              <span className="text-xs text-mute">{o.contactEmail}{o.phone ? ` · ${o.phone}` : ""} · {[o.city, o.state].filter(Boolean).join(", ") || "location n/a"} · GSTIN {o.gstin ?? "—"} · applied {day(o.createdAt)}</span>
            </div>
            <p className="text-xs text-bone-2">{capsSummary(o)}</p>
            {o.adminNotes && <p className="text-xs text-mute">Note: {o.adminNotes}</p>}
            <div className="flex flex-wrap gap-1">
              {o.status === "pending" && <><Button size="sm" onClick={() => decide(o, "approve")} data-testid="partner-approve">Approve</Button><Button size="sm" variant="ghost" onClick={() => decide(o, "reject")}>Reject</Button></>}
              {o.status === "approved" && <Button size="sm" variant="ghost" onClick={() => decide(o, "suspend")}>Suspend</Button>}
              {(o.status === "suspended" || o.status === "rejected") && <Button size="sm" variant="ghost" onClick={() => decide(o, "reinstate")}>Approve / reinstate</Button>}
            </div>
          </div>
        ))}</div>
      )}
      <p className="mt-4 text-xs text-mute">Approval decisions are admin-only and recorded in the audit log. Partners only see orders assigned to their organisation.</p>
    </div>
  );
}

// ── Production board ──────────────────────────────────────────────
interface BoardJob { id: string; orderId: string; orderNumber: string; org: string; status: string; stage: string | null; dueAt: string | null; updatedAt: string; openIssues: number; lastQc: string | null; overdue: boolean; pendingQuote: { id: string; amount: number; leadTimeDays: number; notes: string | null; breakdown: Record<string, number> } | null }

export function AdminProduction() {
  const { data, error, reload } = useApi<{ jobs: BoardJob[] }>("/api/admin/production");
  const [filter, setFilter] = useState("active");
  const active = (j: BoardJob) => !["dispatched", "cancelled", "rejected"].includes(j.status);
  const rows = data?.jobs.filter((j) => (filter === "active" ? active(j) : filter === "attention" ? j.overdue || j.openIssues > 0 || j.status === "rework" || !!j.pendingQuote || j.status === "rejected" : true));
  return (
    <div data-testid="admin-production">
      <H1>Production</H1>
      <div className="mb-4 flex gap-2">{[["active", "Active jobs"], ["attention", "Needs attention"], ["all", "All"]].map(([v, l]) => <button key={v} className="mv-chip" data-active={filter === v} onClick={() => setFilter(v)}>{l}</button>)}</div>
      {error && <Notice tone="bad">{error}</Notice>}
      {!rows ? <Spinner /> : !rows.length ? <EmptyState title="No production jobs">Assign manufacturers from an order&apos;s page once its items are approved.</EmptyState> : (
        <div className="space-y-2">{rows.map((j) => (
          <div key={j.id} className="mv-card flex flex-wrap items-center gap-2 p-3 text-sm" data-testid="board-row">
            <Link href={`/admin/orders/${j.orderId}`} className="font-mono underline">{j.orderNumber}</Link>
            <span>{j.org}</span>
            <Badge tone={tone(j.status)}>{JOB_STATUS_LABEL[j.status] ?? human(j.status)}</Badge>
            {j.stage && <span className="text-xs text-mute">stage {j.stage}</span>}
            {j.overdue && <Badge tone="bad">overdue</Badge>}
            {j.openIssues > 0 && <Badge tone="warn">{j.openIssues} open issue(s)</Badge>}
            {j.lastQc && <Badge tone={j.lastQc === "pass" ? "ok" : "bad"}>QC {j.lastQc}</Badge>}
            <span className="text-xs text-mute">due {day(j.dueAt)} · updated {when(j.updatedAt)}</span>
            <div className="ml-auto flex flex-wrap gap-1">
              {j.pendingQuote && <QuoteActions q={j.pendingQuote} onDone={reload} />}
              {["in_production", "qc_passed", "ready_to_dispatch"].includes(j.status) && <Button size="sm" variant="ghost" onClick={() => { const r = prompt("What needs rework?"); if (r) run(() => api(`/api/admin/production/${j.id}`, { body: { action: "rework", reason: r } }), "Rework requested", reload); }}>Request rework</Button>}
            </div>
          </div>
        ))}</div>
      )}
    </div>
  );
}

function QuoteActions({ q, onDone }: { q: { id: string; amount: number; leadTimeDays: number }; onDone: () => unknown }) {
  return (
    <span className="flex items-center gap-1 rounded-lg border border-champagne/40 px-2 py-1 text-xs" data-testid="quote-review">
      Quote ₹{q.amount.toLocaleString("en-IN")} · {q.leadTimeDays}d
      <Button size="sm" onClick={() => run(() => api(`/api/admin/quotations/${q.id}`, { body: { decision: "approved" } }), "Quotation approved — production can start", onDone)} data-testid="quote-approve">Approve</Button>
      <Button size="sm" variant="ghost" onClick={() => { const n = prompt("Reason (sent to the manufacturer)"); if (n) run(() => api(`/api/admin/quotations/${q.id}`, { body: { decision: "rejected", note: n } }), "Quotation rejected", onDone); }}>Reject</Button>
    </span>
  );
}

// ── Shipping ──────────────────────────────────────────────────────
interface ShipRow { id: string; orderId: string; orderNumber: string; org: string | null; courier: string | null; awb: string | null; status: string; direction: string; failedAttempts: number; pickupAt: string | null; updatedAt: string; provider: string }
interface LogisticsOpt { id: string; name: string; couriers: string[] }

export function AdminShipping() {
  const { data, reload } = useApi<{ shipments: ShipRow[] }>("/api/admin/shipments");
  const partners = useApi<{ organizations: { id: string; name: string; capabilities: { couriers: string[] } }[] }>("/api/admin/partners?type=logistics&status=approved");
  const [filter, setFilter] = useState("open");
  const [reassign, setReassign] = useState<ShipRow | null>(null);
  const rows = data?.shipments.filter((s) => (filter === "open" ? !["delivered", "returned", "cancelled"].includes(s.status) : filter === "exceptions" ? ["failed_delivery", "rto_initiated"].includes(s.status) || s.failedAttempts > 0 : true));
  const opts: LogisticsOpt[] = partners.data?.organizations.map((o) => ({ id: o.id, name: o.name, couriers: o.capabilities.couriers })) ?? [];
  return (
    <div data-testid="admin-shipping">
      <H1>Shipping</H1>
      <div className="mb-4 flex gap-2">{[["open", "Open"], ["exceptions", "Exceptions"], ["all", "All"]].map(([v, l]) => <button key={v} className="mv-chip" data-active={filter === v} onClick={() => setFilter(v)}>{l}</button>)}</div>
      {!rows ? <Spinner /> : !rows.length ? <EmptyState title="No shipments">Create shipments from an order&apos;s page once it is packed.</EmptyState> : (
        <div className="space-y-2">{rows.map((s) => (
          <div key={s.id} className="mv-card flex flex-wrap items-center gap-2 p-3 text-sm">
            <Link href={`/admin/orders/${s.orderId}`} className="font-mono underline">{s.orderNumber}</Link>
            <span className="font-mono text-xs">{s.awb ?? "AWB pending"}</span>
            <Badge tone={tone(s.status)}>{human(s.status)}</Badge>
            {s.direction === "return" && <Badge tone="warn">return</Badge>}
            <span className="text-xs text-mute">{s.courier} · {s.org ?? (s.provider === "manual" ? "manual entry" : "—")}{s.failedAttempts ? ` · ${s.failedAttempts} failed attempt(s)` : ""} · updated {when(s.updatedAt)}</span>
            {s.org && ["assigned", "label_created", "pickup_scheduled"].includes(s.status) && <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setReassign(s)}>Reassign</Button>}
          </div>
        ))}</div>
      )}
      <Modal open={!!reassign} onClose={() => setReassign(null)} title={`Reassign shipment ${reassign?.orderNumber ?? ""}`}>
        {reassign && <ShipmentForm partners={opts} submitLabel="Reassign" onSubmit={async (v) => { await run(() => api(`/api/admin/shipments/${reassign.id}`, { method: "PATCH", body: { organizationId: v.organizationId, courier: v.courier } }), "Shipment reassigned", reload); setReassign(null); }} hideExtras />}
      </Modal>
    </div>
  );
}

function ShipmentForm({ partners, onSubmit, submitLabel, hideExtras, allowReturn }: { partners: LogisticsOpt[]; onSubmit: (v: { organizationId: string; courier: string; direction: string; weightGrams: number; cod: boolean }) => unknown; submitLabel: string; hideExtras?: boolean; allowReturn?: boolean }) {
  const [v, setV] = useState({ organizationId: "", courier: "", direction: "forward", weightGrams: 400, cod: false });
  const org = partners.find((p) => p.id === v.organizationId);
  if (!partners.length) return <p className="text-xs text-mute">No approved logistics partners yet — approve one under Partners.</p>;
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="shipment-form">
      <Select aria-label="Logistics partner" value={v.organizationId} onChange={(e) => setV({ ...v, organizationId: e.target.value, courier: partners.find((p) => p.id === e.target.value)?.couriers[0] ?? "" })} className="!w-48" data-testid="shipment-partner"><option value="">Logistics partner…</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
      <Select aria-label="Courier" value={v.courier} onChange={(e) => setV({ ...v, courier: e.target.value })} className="!w-40" disabled={!org}>{org?.couriers.map((c) => <option key={c}>{c}</option>)}</Select>
      {!hideExtras && (
        <>
          {allowReturn && <Select aria-label="Direction" value={v.direction} onChange={(e) => setV({ ...v, direction: e.target.value })} className="!w-32"><option value="forward">Forward</option><option value="return">Return</option></Select>}
          <Input type="number" aria-label="Weight (g)" value={v.weightGrams} min={10} onChange={(e) => setV({ ...v, weightGrams: Math.max(10, Number(e.target.value) || 10) })} className="!w-24" />
          <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={v.cod} onChange={(e) => setV({ ...v, cod: e.target.checked })} /> COD</label>
        </>
      )}
      <Button size="sm" disabled={!v.organizationId || !v.courier} onClick={() => onSubmit(v)} data-testid="shipment-submit">{submitLabel}</Button>
    </div>
  );
}

// ── Disputes ──────────────────────────────────────────────────────
interface Dispute { id: string; orderId: string; orderNumber: string; kind: string; description: string; status: string; resolution: string | null; raisedByOrg: string | null; createdAt: string; resolvedAt: string | null }

export function AdminDisputes() {
  const [status, setStatus] = useState("open");
  const { data, reload } = useApi<{ disputes: Dispute[] }>(`/api/admin/disputes${status ? `?status=${status}` : ""}`);
  const update = (d: Dispute, next: string) => {
    const resolution = next === "investigating" ? undefined : prompt(next === "resolved" ? "Resolution (shared with the party who raised it)" : "Why is this dispute rejected?") ?? undefined;
    if (next !== "investigating" && !resolution) return;
    run(() => api(`/api/admin/disputes/${d.id}`, { method: "PATCH", body: { status: next, resolution } }), `Dispute ${next}`, reload);
  };
  return (
    <div data-testid="admin-disputes">
      <H1>Disputes</H1>
      <div className="mb-4 flex gap-2">{[["open", "Open"], ["investigating", "Investigating"], ["resolved", "Resolved"], ["rejected", "Rejected"], ["", "All"]].map(([v, l]) => <button key={v} className="mv-chip" data-active={status === v} onClick={() => setStatus(v)}>{l}</button>)}</div>
      {!data ? <Spinner /> : !data.disputes.length ? <EmptyState title="No disputes" /> : (
        <div className="space-y-2">{data.disputes.map((d) => (
          <div key={d.id} className="mv-card space-y-1 p-3 text-sm" data-testid="dispute-row">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/admin/orders/${d.orderId}`} className="font-mono underline">{d.orderNumber}</Link>
              <Badge>{d.kind}</Badge><Badge tone={tone(d.status)}>{d.status}</Badge>
              <span className="text-xs text-mute">raised by {d.raisedByOrg ? `partner ${d.raisedByOrg}` : "customer"} · {when(d.createdAt)}</span>
            </div>
            <p>{d.description}</p>
            {d.resolution && <p className="text-xs text-mute">Resolution: {d.resolution}</p>}
            {["open", "investigating"].includes(d.status) && (
              <div className="flex gap-1">
                {d.status === "open" && <Button size="sm" variant="ghost" onClick={() => update(d, "investigating")}>Investigate</Button>}
                <Button size="sm" onClick={() => update(d, "resolved")} data-testid="dispute-resolve">Resolve</Button>
                <Button size="sm" variant="ghost" onClick={() => update(d, "rejected")}>Reject</Button>
              </div>
            )}
          </div>
        ))}</div>
      )}
    </div>
  );
}

// ── Order fulfilment panel (admin order page) ─────────────────────
interface Fulfil {
  jobs: { id: string; org: string; status: string; stage: string | null; dueAt: string | null; rejectionReason: string | null; quotations: { id: string; amount: number; leadTimeDays: number; status: string; notes: string | null; breakdown: Record<string, number> }[]; events: { id: string; kind: string; payload: Record<string, unknown>; createdAt: string }[] }[];
  shipments: { id: string; org: string | null; courier: string | null; awb: string | null; status: string; direction: string; events: { at: string; status: string; location?: string | null; note?: string | null }[]; podName: string | null; podUploadId: string | null; failedAttempts: number }[];
  manufacturers: { id: string; name: string; match: { ok: boolean; reasons: string[] } }[];
  logistics: LogisticsOpt[];
  disputes: { id: string; kind: string; status: string; description: string }[];
}

export function OrderFulfilmentPanel({ orderId, orderStatus, onChange }: { orderId: string; orderStatus: string; onChange: () => void }) {
  const { data, error, setData, reload } = useApi<Fulfil>(`/api/admin/orders/${orderId}/fulfilment`);
  const [maker, setMaker] = useState("");
  if (error) return <Notice tone="bad">{error}</Notice>;
  if (!data) return <Spinner />;
  const post = (body: Record<string, unknown>, ok: string) => run(async () => setData(await api<Fulfil>(`/api/admin/orders/${orderId}/fulfilment`, { body })), ok, onChange);
  const chosen = data.manufacturers.find((m) => m.id === maker);
  const activeJob = data.jobs.find((j) => !["cancelled", "rejected"].includes(j.status));
  const canAssign = ["awaiting_production_approval", "manufacturing", "quality_inspection"].includes(orderStatus);
  return (
    <section className="mv-card space-y-4 p-4" data-testid="fulfilment-panel">
      <p className="mv-eyebrow">Manufacturing & logistics partners</p>
      <div className="space-y-2">
        <p className="text-sm font-medium">Production</p>
        {canAssign && (
          <div className="flex flex-wrap items-center gap-2">
            <Select aria-label="Manufacturer" value={maker} onChange={(e) => setMaker(e.target.value)} className="!w-72" data-testid="assign-maker"><option value="">{activeJob ? "Reassign to…" : "Assign manufacturer…"}</option>{data.manufacturers.map((m) => <option key={m.id} value={m.id}>{m.name}{m.match.ok ? " ✓ capable" : " ⚠ mismatch"}</option>)}</Select>
            {chosen && !chosen.match.ok && <span className="text-xs text-warn">{chosen.match.reasons.join("; ")}</span>}
            <Button size="sm" disabled={!maker} onClick={() => { if (chosen && !chosen.match.ok && !confirm(`${chosen.name} doesn't match: ${chosen.match.reasons.join("; ")}. Assign anyway?`)) return; post({ action: "assign", organizationId: maker, force: !!chosen && !chosen.match.ok }, activeJob ? "Reassigned" : "Manufacturer assigned"); setMaker(""); }} data-testid="assign-submit">{activeJob ? "Reassign" : "Assign"}</Button>
          </div>
        )}
        {!data.manufacturers.length && <p className="text-xs text-mute">No approved manufacturers yet — approve one under Partners. (Until then, staff can still update the order status manually.)</p>}
        {data.jobs.map((j) => (
          <div key={j.id} className="rounded-lg border border-line p-2 text-xs" data-testid="fulfil-job">
            <p className="flex flex-wrap items-center gap-2 text-sm">{j.org}<Badge tone={tone(j.status)}>{JOB_STATUS_LABEL[j.status] ?? human(j.status)}</Badge>{j.stage && <span className="text-mute">stage {j.stage}</span>}<span className="text-mute">due {day(j.dueAt)}</span></p>
            {j.rejectionReason && <p className="text-bad">Declined: {j.rejectionReason}</p>}
            {j.quotations.map((q) => (
              <p key={q.id} className="mt-1 flex flex-wrap items-center gap-2">Quote ₹{q.amount.toLocaleString("en-IN")} · {q.leadTimeDays} days · {Object.entries(q.breakdown).map(([k, v]) => `${k} ₹${v}`).join(", ")}{q.notes ? ` · “${q.notes}”` : ""} <Badge tone={tone(q.status === "submitted" ? "pending" : q.status)}>{q.status}</Badge>{q.status === "submitted" && j.status === "quoted" && <QuoteActions q={q} onDone={() => { reload(); onChange(); }} />}</p>
            ))}
            <ul className="mt-1 space-y-0.5 text-mute">{j.events.slice(-6).map((e) => <li key={e.id}>{when(e.createdAt)} — {e.kind}{e.payload.stage ? `: ${e.payload.stage}` : ""}{e.payload.result ? `: ${String(e.payload.result)}` : ""}{e.payload.title ? `: ${String(e.payload.title)}` : ""}{e.payload.reason ? `: ${String(e.payload.reason)}` : ""}{e.payload.note ? ` (${String(e.payload.note)})` : ""}</li>)}</ul>
            <ProductionPhotos events={j.events} />
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">Shipping</p>
        {(["packed", "quality_inspection", "manufacturing"].includes(orderStatus) || ["shipped", "delivered"].includes(orderStatus)) && <ShipmentForm partners={data.logistics} submitLabel="Create shipment" allowReturn={["shipped", "delivered"].includes(orderStatus)} onSubmit={(v) => post({ action: "shipment", shipment: v }, "Shipment created")} />}
        {data.shipments.map((s) => (
          <div key={s.id} className="rounded-lg border border-line p-2 text-xs" data-testid="fulfil-shipment">
            <p className="flex flex-wrap items-center gap-2 text-sm"><span className="font-mono">{s.awb ?? "AWB pending"}</span><Badge tone={tone(s.status)}>{human(s.status)}</Badge>{s.direction === "return" && <Badge tone="warn">return</Badge>}<span className="text-mute">{s.courier} · {s.org ?? "manual"}</span>{s.podName && <span>POD: {s.podName}</span>}</p>
            <ul className="mt-1 space-y-0.5 text-mute">{(s.events ?? []).slice(-5).map((e, i) => <li key={i}>{when(e.at)} — {human(e.status)}{e.location ? ` · ${e.location}` : ""}{e.note ? ` — ${e.note}` : ""}</li>)}</ul>
          </div>
        ))}
      </div>
      {!!data.disputes.length && <div><p className="text-sm font-medium">Disputes</p><ul className="text-xs">{data.disputes.map((d) => <li key={d.id}><Badge tone={tone(d.status)}>{d.status}</Badge> {d.kind}: {d.description} — <Link className="underline" href="/admin/disputes">manage</Link></li>)}</ul></div>}
    </section>
  );
}

function ProductionPhotos({ events }: { events: { id: string; kind: string; payload: Record<string, unknown> }[] }) {
  const photos = events.filter((e) => e.kind === "photo");
  if (!photos.length) return null;
   
  return <div className="mt-2 flex gap-1">{photos.map((p) => <img key={p.id} src={`/api/uploads/${p.payload.uploadId}`} alt={String(p.payload.caption ?? "Production photo")} className="size-14 rounded object-cover" />)}</div>;
}
