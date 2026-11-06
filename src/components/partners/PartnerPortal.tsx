"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Factory, Truck } from "lucide-react";
import { api, errorMessage } from "@/lib/client/api";
import { GarmentFlat } from "@/components/garment/GarmentFlat";
import type { DesignConfig } from "@/lib/garment/schema";
import { AUDIENCES, PRINT_METHODS, type PrintMethod } from "@/lib/garment/types";
import { PRINT_METHOD_INFO } from "@/lib/garment/fabrics";
import { INDIAN_COURIERS, JOB_STATUS_LABEL, QC_CHECKS, SHIPMENT_NEXT, STAGES } from "@/lib/partners/constants";
import { Badge, Button, EmptyState, Field, Input, Notice, Segmented, Select, Spinner, toast } from "@/components/ui";
import { DisputeForm } from "./DisputeForm";

// ── Shared ─────────────────────────────────────────────────────────
type OrgType = "manufacturer" | "logistics";
interface Org { id: string; type: OrgType; name: string; legalName: string | null; gstin: string | null; contactEmail: string; phone: string | null; city: string | null; state: string | null; status: string; capabilities: Record<string, unknown>; adminNotes: string | null; createdAt: string }
interface Membership { org: Org; role: "owner" | "member" }

function useApi<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const reload = useCallback(async () => {
    if (!url) return;
    try {
      setData(await api<T>(url));
      setError(null);
    } catch (e) {
      setError({ code: (e as { code?: string }).code ?? "error", message: errorMessage(e) });
    }
  }, [url]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, error, reload, setData };
}

const when = (d: string | null | undefined) => (d ? new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");
const day = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString("en-IN", { dateStyle: "medium" }) : "—");
const human = (s: string) => s.replace(/_/g, " ");
const statusTone = (s: string): "ok" | "warn" | "bad" | "info" | "neutral" => (["approved", "qc_passed", "ready_to_dispatch", "dispatched", "delivered", "returned", "quote_approved"].includes(s) ? "ok" : ["pending", "offered", "quoted", "rework", "failed_delivery", "rto_initiated"].includes(s) ? "warn" : ["rejected", "suspended", "cancelled"].includes(s) ? "bad" : "info");

function Section({ title, children, className, testId }: { title: string; children: React.ReactNode; className?: string; testId?: string }) {
  return <section className={clsx("mv-card space-y-3 p-4", className)} data-testid={testId}><p className="mv-eyebrow">{title}</p>{children}</section>;
}

function toggle<T>(list: T[], v: T) {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function Chips<T extends string>({ label, options, value, onChange, render }: { label: string; options: readonly T[]; value: T[]; onChange: (v: T[]) => void; render?: (v: T) => string }) {
  return (
    <fieldset>
      <legend className="mv-label mb-1">{label}</legend>
      <div className="flex flex-wrap gap-1.5">{options.map((o) => <button type="button" key={o} className="mv-chip" data-active={value.includes(o)} aria-pressed={value.includes(o)} onClick={() => onChange(toggle(value, o))}>{render ? render(o) : o}</button>)}</div>
    </fieldset>
  );
}

// ── Capabilities editor (apply + organisation profile) ────────────
export interface ManufacturerCapsForm { methods: string[]; garmentTypes: string[]; audiences: string[]; fabrics: string[]; minOrderQty: number; dailyCapacity: number; leadTimeDays: number; certifications: string[] }
export interface LogisticsCapsForm { couriers: string[]; serviceStates: string[]; cod: boolean; express: boolean; maxWeightKg: number }
export const DEFAULT_MANUFACTURER_CAPS: ManufacturerCapsForm = { methods: ["dtg", "screen"], garmentTypes: ["tshirt"], audiences: ["men", "women"], fabrics: ["knit"], minOrderQty: 1, dailyCapacity: 100, leadTimeDays: 7, certifications: [] };
export const DEFAULT_LOGISTICS_CAPS: LogisticsCapsForm = { couriers: ["Delhivery"], serviceStates: [], cod: false, express: false, maxWeightKg: 30 };

function CapabilitiesEditor({ type, value, onChange }: { type: OrgType; value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void }) {
  if (type === "manufacturer") {
    const c = { ...DEFAULT_MANUFACTURER_CAPS, ...value } as ManufacturerCapsForm;
    const set = (p: Partial<ManufacturerCapsForm>) => onChange({ ...c, ...p });
    return (
      <div className="space-y-3" data-testid="caps-manufacturer">
        <Chips label="Decoration methods" options={PRINT_METHODS} value={c.methods} onChange={(methods) => set({ methods })} render={(m) => PRINT_METHOD_INFO[m as PrintMethod].name} />
        <Chips label="Garments" options={["tshirt", "shirt"] as const} value={c.garmentTypes} onChange={(garmentTypes) => set({ garmentTypes })} render={(g) => (g === "tshirt" ? "T-shirts" : "Shirts")} />
        <Chips label="Audiences" options={AUDIENCES} value={c.audiences} onChange={(audiences) => set({ audiences })} />
        <Chips label="Fabric construction" options={["knit", "woven"] as const} value={c.fabrics} onChange={(fabrics) => set({ fabrics })} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Minimum order (pcs)">{(id) => <Input id={id} type="number" min={1} value={c.minOrderQty} onChange={(e) => set({ minOrderQty: Number(e.target.value) || 1 })} />}</Field>
          <Field label="Daily capacity (pcs)">{(id) => <Input id={id} type="number" min={1} value={c.dailyCapacity} onChange={(e) => set({ dailyCapacity: Number(e.target.value) || 1 })} />}</Field>
          <Field label="Typical lead time (days)">{(id) => <Input id={id} type="number" min={1} value={c.leadTimeDays} onChange={(e) => set({ leadTimeDays: Number(e.target.value) || 1 })} />}</Field>
        </div>
        <Field label="Certifications" hint="Comma-separated, self-declared (e.g. OEKO-TEX, GOTS). ModVerse verifies during approval.">{(id) => <Input id={id} value={c.certifications.join(", ")} onChange={(e) => set({ certifications: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />}</Field>
      </div>
    );
  }
  const c = { ...DEFAULT_LOGISTICS_CAPS, ...value } as LogisticsCapsForm;
  const set = (p: Partial<LogisticsCapsForm>) => onChange({ ...c, ...p });
  return (
    <div className="space-y-3" data-testid="caps-logistics">
      <Chips label="Couriers you book" options={INDIAN_COURIERS} value={c.couriers} onChange={(couriers) => set({ couriers })} />
      <Field label="Service states" hint="Comma-separated; leave empty for pan-India.">{(id) => <Input id={id} value={c.serviceStates.join(", ")} onChange={(e) => set({ serviceStates: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />}</Field>
      <div className="flex flex-wrap items-end gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={c.cod} onChange={(e) => set({ cod: e.target.checked })} /> Cash on delivery</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={c.express} onChange={(e) => set({ express: e.target.checked })} /> Express</label>
        <Field label="Max parcel weight (kg)" className="w-44">{(id) => <Input id={id} type="number" min={0.1} step={0.1} value={c.maxWeightKg} onChange={(e) => set({ maxWeightKg: Number(e.target.value) || 1 })} />}</Field>
      </div>
    </div>
  );
}

// ── Apply ─────────────────────────────────────────────────────────
export function PartnerApply({ signedIn, existing }: { signedIn: boolean; existing: Membership | null }) {
  const router = useRouter();
  const [type, setType] = useState<OrgType>("manufacturer");
  const [form, setForm] = useState({ name: "", legalName: "", gstin: "", contactEmail: "", phone: "", city: "", state: "" });
  const [caps, setCaps] = useState<Record<string, unknown>>({ ...DEFAULT_MANUFACTURER_CAPS });
  const [busy, setBusy] = useState(false);
  if (existing) return <Notice tone="info" title={`You're part of ${existing.org.name}`}>Status: {existing.org.status}. <Link href="/partner" className="underline">Open the partner portal</Link></Notice>;
  if (!signedIn) return <Notice title="Sign in to apply">Create a ModVerse account for your business (or sign in), then return here. <Link className="underline" href="/register?next=/partners">Create account</Link> · <Link className="underline" href="/login?next=/partners">Sign in</Link></Notice>;
  const f = (k: keyof typeof form) => ({ value: form[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value }) });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { type, capabilities: caps, ...Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim())) };
      await api("/api/partner/apply", { body });
      toast("Application received — ModVerse will review it");
      router.push("/partner");
      router.refresh();
    } catch (err) {
      toast(errorMessage(err), "bad");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="mv-card space-y-4 p-5" data-testid="partner-apply">
      <Segmented label="Partner type" value={type} onChange={(t) => { setType(t); setCaps(t === "manufacturer" ? { ...DEFAULT_MANUFACTURER_CAPS } : { ...DEFAULT_LOGISTICS_CAPS }); }} options={[{ value: "manufacturer", label: "Manufacturer" }, { value: "logistics", label: "Logistics" }]} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Business name">{(id) => <Input id={id} required minLength={2} {...f("name")} />}</Field>
        <Field label="Legal name (optional)">{(id) => <Input id={id} {...f("legalName")} />}</Field>
        <Field label="GSTIN (optional)" hint="15 characters, e.g. 27AAPFU0939F1ZV">{(id) => <Input id={id} {...f("gstin")} />}</Field>
        <Field label="Contact email">{(id) => <Input id={id} type="email" required {...f("contactEmail")} />}</Field>
        <Field label="Phone (optional)">{(id) => <Input id={id} {...f("phone")} />}</Field>
        <div className="grid grid-cols-2 gap-3"><Field label="City">{(id) => <Input id={id} {...f("city")} />}</Field><Field label="State">{(id) => <Input id={id} {...f("state")} />}</Field></div>
      </div>
      <CapabilitiesEditor type={type} value={caps} onChange={setCaps} />
      <p className="text-xs text-mute">ModVerse reviews every application. Approved partners only ever see the orders assigned to them — never other partners&apos; work, and only the customer data needed for the job.</p>
      <Button type="submit" loading={busy} data-testid="partner-apply-submit">Submit application</Button>
    </form>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────
interface JobRow { id: string; orderNumber: string; status: string; stage: string | null; units: number; dueAt: string | null; updatedAt: string }
interface ShipmentRow { id: string; orderNumber: string; status: string; courier: string | null; awb: string | null; direction: string; city: string; pincode: string; pickupAt: string | null; failedAttempts: number; updatedAt: string }

export function PartnerDashboard() {
  const me = useApi<{ membership: Membership | null }>("/api/partner/me");
  const m = me.data?.membership;
  const approved = m?.org.status === "approved";
  const jobs = useApi<{ jobs: JobRow[] }>(approved && m?.org.type === "manufacturer" ? "/api/partner/jobs" : null);
  const shipments = useApi<{ shipments: ShipmentRow[] }>(approved && m?.org.type === "logistics" ? "/api/partner/shipments" : null);
  if (me.error) return <Notice tone="bad">{me.error.message}</Notice>;
  if (!me.data) return <Spinner />;
  if (!m) return <EmptyState title="You're not a partner yet" action={<Link className="mv-chip" href="/partners">Apply to partner with ModVerse</Link>}>Manufacturers and logistics companies can apply to fulfil ModVerse orders.</EmptyState>;
  return (
    <div className="space-y-6" data-testid="partner-dashboard">
      <div className="flex flex-wrap items-center gap-3">
        {m.org.type === "manufacturer" ? <Factory className="size-6 text-champagne" /> : <Truck className="size-6 text-champagne" />}
        <h1 className="mv-display text-3xl">{m.org.name}</h1>
        <Badge tone={statusTone(m.org.status)}>{m.org.status}</Badge>
        <Badge>{m.org.type}</Badge>
      </div>
      {m.org.status === "pending" && <Notice tone="warn" title="Application under review">ModVerse is reviewing your application. You&apos;ll be able to receive {m.org.type === "manufacturer" ? "production jobs" : "shipments"} once approved.</Notice>}
      {(m.org.status === "rejected" || m.org.status === "suspended") && <Notice tone="bad" title={`Organisation ${m.org.status}`}>{m.org.adminNotes ?? "Contact ModVerse partner support."}</Notice>}
      {approved && m.org.type === "manufacturer" && <JobsTable rows={jobs.data?.jobs} />}
      {approved && m.org.type === "logistics" && <ShipmentsTable rows={shipments.data?.shipments} />}
    </div>
  );
}

function Stat({ label, n }: { label: string; n: number }) {
  return <div className="mv-card p-3"><p className="mv-display text-3xl tabular-nums">{n}</p><p className="text-xs text-mute">{label}</p></div>;
}

function JobsTable({ rows }: { rows?: JobRow[] }) {
  if (!rows) return <Spinner />;
  const count = (st: string[]) => rows.filter((r) => st.includes(r.status)).length;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="New offers" n={count(["offered"])} />
        <Stat label="Awaiting quote / approval" n={count(["accepted", "quoted"])} />
        <Stat label="In production / rework" n={count(["quote_approved", "in_production", "rework", "qc_passed"])} />
        <Stat label="Ready / dispatched" n={count(["ready_to_dispatch", "dispatched"])} />
      </div>
      {!rows.length ? <EmptyState title="No jobs assigned yet">ModVerse assigns approved orders that match your capabilities.</EmptyState> : (
        <div className="mv-card divide-y divide-line" data-testid="partner-jobs">
          {rows.map((r) => {
            const overdue = r.dueAt && new Date(r.dueAt) < new Date() && !["dispatched", "cancelled", "rejected"].includes(r.status);
            return (
              <Link key={r.id} href={`/partner/jobs/${r.id}`} className="flex flex-wrap items-center gap-3 p-3 text-sm hover:bg-surface-2">
                <span className="font-mono">{r.orderNumber}</span>
                <Badge tone={statusTone(r.status)}>{JOB_STATUS_LABEL[r.status] ?? human(r.status)}</Badge>
                {r.stage && <span className="text-xs text-mute">stage: {r.stage}</span>}
                <span className="text-xs text-mute">{r.units} pcs</span>
                <span className={clsx("ml-auto text-xs", overdue ? "text-bad" : "text-mute")}>due {day(r.dueAt)}{overdue ? " · overdue" : ""}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ShipmentsTable({ rows }: { rows?: ShipmentRow[] }) {
  if (!rows) return <Spinner />;
  const count = (st: string[]) => rows.filter((r) => st.includes(r.status)).length;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="To label / schedule" n={count(["assigned", "label_created", "pickup_scheduled"])} />
        <Stat label="In transit" n={count(["picked_up", "in_transit", "out_for_delivery"])} />
        <Stat label="Exceptions" n={count(["failed_delivery", "rto_initiated"])} />
        <Stat label="Delivered / returned" n={count(["delivered", "returned"])} />
      </div>
      {!rows.length ? <EmptyState title="No shipments assigned yet" /> : (
        <div className="mv-card divide-y divide-line" data-testid="partner-shipments">
          {rows.map((r) => (
            <Link key={r.id} href={`/partner/shipments/${r.id}`} className="flex flex-wrap items-center gap-3 p-3 text-sm hover:bg-surface-2">
              <span className="font-mono">{r.awb ?? "AWB pending"}</span>
              <Badge tone={statusTone(r.status)}>{human(r.status)}</Badge>
              {r.direction === "return" && <Badge tone="warn">return</Badge>}
              <span className="text-xs text-mute">{r.courier} · order {r.orderNumber} · {r.city} {r.pincode}</span>
              <span className="ml-auto text-xs text-mute">{r.pickupAt ? `pickup ${day(r.pickupAt)}` : `updated ${day(r.updatedAt)}`}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Manufacturer job ──────────────────────────────────────────────
interface JobEvent { id: string; kind: string; payload: Record<string, unknown>; createdAt: string }
interface Quotation { id: string; amount: number; leadTimeDays: number; breakdown: Record<string, number>; notes: string | null; status: string; reviewNote: string | null; createdAt: string }
interface JobItem { id: string; designName: string; version: number; size: string; quantity: number; designSnapshot: DesignConfig; spec: { garment?: { model?: string; fit?: string }; fabric?: { name?: string; colourName?: string; gsm?: number }; placements: { index: number; zone: string; method: string; widthCm: number; heightCm: number; reference: string }[] } }
interface JobView { job: { id: string; status: string; stage: string | null; dueAt: string | null; rejectionReason: string | null; orderId: string }; order: { orderNumber: string; status: string; createdAt: string }; items: JobItem[]; quotations: Quotation[]; events: JobEvent[] }

export function ManufacturerJob({ id }: { id: string }) {
  const { data, error, setData } = useApi<JobView>(`/api/partner/jobs/${id}`);
  const [busy, setBusy] = useState(false);
  const act = async (body: Record<string, unknown>, ok: string) => {
    setBusy(true);
    try {
      setData(await api<JobView>(`/api/partner/jobs/${id}`, { body }));
      toast(ok);
      return true;
    } catch (e) {
      toast(errorMessage(e), "bad");
      return false;
    } finally {
      setBusy(false);
    }
  };
  if (error) return <Notice tone="bad">{error.message}</Notice>;
  if (!data) return <Spinner />;
  const { job } = data;
  const st = job.status;
  const issues = data.events.filter((e) => e.kind === "issue");
  const resolved = new Set(data.events.filter((e) => e.kind === "issue_resolved").map((e) => e.payload.issueId as string));
  const photos = data.events.filter((e) => e.kind === "photo");
  const reload = async () => setData(await api<JobView>(`/api/partner/jobs/${id}`));
  return (
    <div className="space-y-5" data-testid="partner-job">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mv-display text-3xl">Order <span className="font-mono">{data.order.orderNumber}</span></h1>
        <Badge tone={statusTone(st)}>{JOB_STATUS_LABEL[st] ?? human(st)}</Badge>
        {job.stage && <Badge>stage: {job.stage}</Badge>}
        <span className="text-sm text-mute">due {day(job.dueAt)}</span>
      </div>
      <JobActions st={st} busy={busy} act={act} quotations={data.quotations} />
      <Section title="Garments to produce">
        {data.items.map((it) => (
          <div key={it.id} className="flex flex-wrap gap-4 border-t border-line pt-3 first:border-0 first:pt-0" data-testid="job-item">
            <div className="grid w-48 grid-cols-2 gap-1"><GarmentFlat config={it.designSnapshot} view="front" className="w-full" /><GarmentFlat config={it.designSnapshot} view="back" className="w-full" /></div>
            <div className="min-w-0 flex-1 space-y-1 text-sm">
              <p>{it.designName} <span className="text-mute">· v{it.version}</span></p>
              <p className="text-xs text-mute">{it.spec.garment?.model} · {it.spec.garment?.fit} fit · size <strong className="text-bone">{it.size}</strong> · quantity <strong className="text-bone">{it.quantity}</strong></p>
              <p className="text-xs text-mute">Fabric: {it.spec.fabric?.name} · {it.spec.fabric?.colourName} · {it.spec.fabric?.gsm} GSM</p>
              {!!it.spec.placements.length && <ul className="text-xs">{it.spec.placements.map((p) => <li key={p.index}>#{p.index} {p.zone} · {p.method} · {p.widthCm}×{p.heightCm} cm · {p.reference}</li>)}</ul>}
              <a className="mv-chip inline-flex" href={`/api/partner/jobs/${id}/techpack?item=${it.id}`} target="_blank" rel="noopener" data-testid="job-techpack">Production tech pack (PDF)</a>
            </div>
          </div>
        ))}
      </Section>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Issues">
          {!issues.length && <p className="text-xs text-mute">No issues reported.</p>}
          <ul className="space-y-2 text-sm">{issues.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-2">
              <Badge tone={resolved.has(i.id) ? "ok" : i.payload.severity === "high" ? "bad" : "warn"}>{resolved.has(i.id) ? "resolved" : String(i.payload.severity)}</Badge>
              <span>{String(i.payload.title)}</span>
              {!resolved.has(i.id) && <button className="text-xs underline" onClick={() => { const n = prompt("How was it resolved?"); if (n !== null) act({ action: "resolve_issue", issueId: i.id, note: n }, "Issue resolved"); }}>Resolve</button>}
            </li>
          ))}</ul>
          {!["cancelled", "rejected", "dispatched"].includes(st) && <IssueForm busy={busy} onSubmit={(issue) => act({ action: "issue", issue }, "Issue reported to ModVerse")} />}
        </Section>
        <Section title="Production photos">
          <div className="grid grid-cols-3 gap-2">{photos.map((p) => (
             
            <figure key={p.id}><img src={`/api/uploads/${p.payload.uploadId}`} alt={String(p.payload.caption ?? "Production photo")} className="aspect-square w-full rounded-lg object-cover" /><figcaption className="truncate text-[0.65rem] text-mute">{String(p.payload.caption ?? "")}</figcaption></figure>
          ))}</div>
          {["accepted", "quoted", "quote_approved", "in_production", "rework", "qc_passed", "ready_to_dispatch"].includes(st) && <PhotoUpload url={`/api/partner/jobs/${id}/photos`} onDone={reload} withCaption />}
        </Section>
      </div>
      <Timeline events={data.events} />
      <DisputeForm orderId={job.orderId} jobId={job.id} />
    </div>
  );
}

function JobActions({ st, busy, act, quotations }: { st: string; busy: boolean; act: (b: Record<string, unknown>, ok: string) => Promise<boolean>; quotations: Quotation[] }) {
  const [quote, setQuote] = useState({ fabric: 0, print: 0, labour: 0, other: 0, leadTimeDays: 7, notes: "" });
  const [stage, setStage] = useState<string>(STAGES[0]);
  const [stageNote, setStageNote] = useState("");
  const [checks, setChecks] = useState(() => QC_CHECKS.map((name) => ({ name, pass: true, note: "" })));
  const [qc, setQc] = useState({ defects: 0, sampleSize: 5, notes: "" });
  const total = quote.fabric + quote.print + quote.labour + quote.other;
  const qcPass = checks.every((c) => c.pass);
  if (st === "offered") {
    return (
      <Section title="New production offer" testId="job-offer">
        <p className="text-sm text-bone-2">Review the garments, placements and tech pack below, then accept or decline.</p>
        <div className="flex gap-2">
          <Button loading={busy} onClick={() => act({ action: "accept" }, "Job accepted — submit your quotation")} data-testid="job-accept">Accept job</Button>
          <Button variant="ghost" onClick={() => { const r = prompt("Why are you declining?"); if (r) act({ action: "reject", reason: r }, "Job declined"); }}>Decline</Button>
        </div>
      </Section>
    );
  }
  return (
    <>
      {(st === "accepted" || st === "quoted") && (
        <Section title="Quotation" testId="job-quote">
          {st === "quoted" && <Notice tone="info">Your quotation is with ModVerse for approval. You can submit a revised one — it replaces the pending quote.</Notice>}
          <div className="grid gap-3 sm:grid-cols-5">
            {(["fabric", "print", "labour", "other"] as const).map((k) => <Field key={k} label={`${k[0].toUpperCase()}${k.slice(1)} (₹)`}>{(id) => <Input id={id} type="number" min={0} value={quote[k]} onChange={(e) => setQuote({ ...quote, [k]: Math.max(0, Number(e.target.value) || 0) })} data-testid={`quote-${k}`} />}</Field>)}
            <Field label="Lead time (days)">{(id) => <Input id={id} type="number" min={1} value={quote.leadTimeDays} onChange={(e) => setQuote({ ...quote, leadTimeDays: Math.max(1, Number(e.target.value) || 1) })} />}</Field>
          </div>
          <Input placeholder="Notes for ModVerse (optional)" value={quote.notes} onChange={(e) => setQuote({ ...quote, notes: e.target.value })} />
          <div className="flex items-center gap-3"><span className="text-sm">Total <strong className="tabular-nums">₹{total.toLocaleString("en-IN")}</strong> for the whole job</span>
            <Button loading={busy} disabled={total < 1} onClick={() => act({ action: "quote", quotation: { amount: total, leadTimeDays: quote.leadTimeDays, breakdown: { fabric: quote.fabric, print: quote.print, labour: quote.labour, other: quote.other }, notes: quote.notes || undefined } }, "Quotation submitted")} data-testid="quote-submit">Submit quotation</Button></div>
        </Section>
      )}
      {!!quotations.length && <Section title="Quotation history"><ul className="space-y-1 text-sm">{quotations.map((q) => <li key={q.id} className="flex flex-wrap gap-2"><Badge tone={q.status === "approved" ? "ok" : q.status === "rejected" ? "bad" : "warn"}>{q.status}</Badge>₹{q.amount.toLocaleString("en-IN")} · {q.leadTimeDays} days · {when(q.createdAt)}{q.reviewNote ? <span className="text-mute">— {q.reviewNote}</span> : null}</li>)}</ul></Section>}
      {["quote_approved", "in_production", "rework"].includes(st) && (
        <Section title="Production stage" testId="job-stage">
          {st === "rework" && <Notice tone="warn">Rework requested — fix the issues, update the stage and record a new QC report.</Notice>}
          <div className="flex flex-wrap gap-2">
            <Select aria-label="Stage" value={stage} onChange={(e) => setStage(e.target.value)} className="!w-44">{STAGES.map((s) => <option key={s} value={s}>{s}</option>)}</Select>
            <Input placeholder="Note (optional)" value={stageNote} onChange={(e) => setStageNote(e.target.value)} className="!w-64" />
            <Button loading={busy} onClick={async () => { if (await act({ action: "stage", stage, note: stageNote || undefined }, `Stage updated: ${stage}`)) setStageNote(""); }} data-testid="stage-submit">Update stage</Button>
          </div>
        </Section>
      )}
      {["in_production", "rework"].includes(st) && (
        <Section title="Quality control report" testId="job-qc">
          <ul className="space-y-1.5 text-sm">{checks.map((c, i) => (
            <li key={c.name} className="flex flex-wrap items-center gap-2">
              <label className="flex min-w-64 items-center gap-2"><input type="checkbox" checked={c.pass} onChange={(e) => setChecks(checks.map((x, j) => (j === i ? { ...x, pass: e.target.checked } : x)))} />{c.name}</label>
              {!c.pass && <Input className="!w-56 !py-1 !text-xs" placeholder="What failed?" value={c.note} onChange={(e) => setChecks(checks.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} />}
            </li>
          ))}</ul>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Pieces inspected" className="w-36">{(id) => <Input id={id} type="number" min={1} value={qc.sampleSize} onChange={(e) => setQc({ ...qc, sampleSize: Math.max(1, Number(e.target.value) || 1) })} />}</Field>
            <Field label="Defective pieces" className="w-36">{(id) => <Input id={id} type="number" min={0} value={qc.defects} onChange={(e) => setQc({ ...qc, defects: Math.max(0, Number(e.target.value) || 0) })} />}</Field>
            <Badge tone={qcPass ? "ok" : "bad"}>{qcPass ? "PASS" : "FAIL — goes to rework"}</Badge>
            <Button loading={busy} onClick={() => act({ action: "qc", report: { result: qcPass ? "pass" : "fail", checks: checks.map((c) => ({ name: c.name, pass: c.pass, note: c.note || undefined })), defects: qc.defects, sampleSize: qc.sampleSize, notes: qc.notes || undefined } }, qcPass ? "QC passed" : "QC failed — job moved to rework")} data-testid="qc-submit">Record QC</Button>
          </div>
        </Section>
      )}
      {st === "qc_passed" && (
        <Section title="Dispatch readiness" testId="job-ready">
          <p className="text-sm">QC passed. Pack the order with the ModVerse packing slip, then mark it ready — ModVerse assigns the courier pickup.</p>
          <Button loading={busy} onClick={() => act({ action: "ready" }, "Marked ready to dispatch")} data-testid="job-ready-submit">Mark ready to dispatch</Button>
        </Section>
      )}
      {st === "ready_to_dispatch" && <Notice tone="ok">Ready to dispatch — awaiting courier pickup.</Notice>}
      {st === "dispatched" && <Notice tone="ok">Dispatched. Thank you!</Notice>}
      {(st === "cancelled" || st === "rejected") && <Notice tone="bad">This job is {st}.</Notice>}
    </>
  );
}

function IssueForm({ busy, onSubmit }: { busy: boolean; onSubmit: (issue: { severity: string; title: string; description: string }) => Promise<boolean> }) {
  const [issue, setIssue] = useState({ severity: "medium", title: "", description: "" });
  return (
    <div className="space-y-2 border-t border-line pt-3">
      <div className="flex gap-2">
        <Select aria-label="Severity" value={issue.severity} onChange={(e) => setIssue({ ...issue, severity: e.target.value })} className="!w-28"><option value="low">low</option><option value="medium">medium</option><option value="high">high</option></Select>
        <Input placeholder="Issue (e.g. fabric shade mismatch)" value={issue.title} onChange={(e) => setIssue({ ...issue, title: e.target.value })} />
      </div>
      <Input placeholder="Details (optional)" value={issue.description} onChange={(e) => setIssue({ ...issue, description: e.target.value })} />
      <Button size="sm" variant="ghost" loading={busy} disabled={issue.title.trim().length < 3} onClick={async () => { if (await onSubmit(issue)) setIssue({ severity: "medium", title: "", description: "" }); }}>Report issue</Button>
    </div>
  );
}

function PhotoUpload({ url, onDone, withCaption, label = "Upload photo", testId }: { url: string; onDone: () => void; withCaption?: boolean; label?: string; testId?: string }) {
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
      {withCaption && <Input placeholder="Caption" value={caption} onChange={(e) => setCaption(e.target.value)} className="!w-48" />}
      <label className={clsx("mv-chip cursor-pointer", busy && "opacity-50")}>
        {busy ? "Uploading…" : label}
        <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" data-testid={testId} disabled={busy} onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setBusy(true);
          const form = new FormData();
          form.set("file", file);
          if (caption) form.set("caption", caption);
          try {
            await api(url, { form });
            toast("Photo uploaded");
            setCaption("");
            onDone();
          } catch (err) {
            toast(errorMessage(err), "bad");
          } finally {
            setBusy(false);
            e.target.value = "";
          }
        }} />
      </label>
    </div>
  );
}

function Timeline({ events }: { events: JobEvent[] }) {
  const describe = (e: JobEvent) => {
    const p = e.payload;
    switch (e.kind) {
      case "stage": return `Stage: ${p.stage}${p.note ? ` — ${p.note}` : ""}`;
      case "issue": return `Issue (${p.severity}): ${p.title}`;
      case "issue_resolved": return `Issue resolved${p.note ? ` — ${p.note}` : ""}`;
      case "qc": return `QC ${String(p.result).toUpperCase()} · ${p.defects ?? 0} defects in ${p.sampleSize ?? "?"} pcs`;
      case "rework": return `Rework: ${p.reason}`;
      case "photo": return `Photo uploaded${p.caption ? ` — ${p.caption}` : ""}`;
      case "dispatch": return "Marked ready to dispatch";
      default: return `${human(String(p.status ?? e.kind))}${p.note ? ` — ${p.note}` : ""}`;
    }
  };
  return (
    <Section title="Job timeline">
      <ul className="space-y-1 text-xs">{[...events].reverse().map((e) => <li key={e.id} className="flex gap-3"><span className="w-36 shrink-0 text-mute">{when(e.createdAt)}</span><span>{describe(e)}</span></li>)}</ul>
    </Section>
  );
}

// ── Logistics shipment ────────────────────────────────────────────
interface Place { kind: "facility" | "customer"; name?: string; fullName?: string; line1?: string; line2?: string; city?: string | null; state?: string | null; pincode?: string; phone?: string | null }
interface ShipmentView { shipment: { id: string; orderId: string; status: string; courier: string | null; awb: string | null; direction: string; pickupAt: string | null; pickupWindow: string | null; weightGrams: number | null; cod: boolean; failedAttempts: number; podName: string | null; podUploadId: string | null; events: { at: string; status: string; location?: string | null; note?: string | null }[] }; orderNumber: string; units: number; codAmount: number | null; pickup: Place; drop: Place }

function PlaceCard({ title, p }: { title: string; p: Place }) {
  return (
    <div className="mv-card p-3 text-sm">
      <p className="mv-label">{title}</p>
      <p>{p.fullName ?? p.name}</p>
      <p className="text-mute">{[p.line1, p.line2, p.city, p.state, p.pincode].filter(Boolean).join(", ")}</p>
      {p.phone && <p className="text-mute">Phone {p.phone}</p>}
    </div>
  );
}

export function LogisticsShipment({ id }: { id: string }) {
  const { data, error, setData } = useApi<ShipmentView>(`/api/partner/shipments/${id}`);
  const [busy, setBusy] = useState(false);
  const [ev, setEv] = useState({ status: "", location: "", note: "", reason: "", podName: "", pickupAt: "", pickupWindow: "10:00–13:00" });
  const next = useMemo(() => (data ? SHIPMENT_NEXT[data.shipment.status] ?? [] : []).filter((s) => s !== "label_created" && s !== "cancelled"), [data]);
  const act = async (body: Record<string, unknown>, ok: string) => {
    setBusy(true);
    try {
      setData(await api<ShipmentView>(`/api/partner/shipments/${id}`, { body }));
      toast(ok);
      setEv((e) => ({ ...e, status: "", note: "", reason: "", location: "" }));
    } catch (e) {
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(false);
    }
  };
  if (error) return <Notice tone="bad">{error.message}</Notice>;
  if (!data) return <Spinner />;
  const sh = data.shipment;
  const status = ev.status || next[0] || "";
  return (
    <div className="space-y-5" data-testid="partner-shipment">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mv-display text-3xl">{sh.awb ? <span className="font-mono">{sh.awb}</span> : "New shipment"}</h1>
        <Badge tone={statusTone(sh.status)}>{human(sh.status)}</Badge>
        {sh.direction === "return" && <Badge tone="warn">return pickup</Badge>}
        <span className="text-sm text-mute">{sh.courier} · order {data.orderNumber} · {data.units} unit(s) · {((sh.weightGrams ?? 400) / 1000).toFixed(2)} kg</span>
        {data.codAmount !== null && <Badge tone="warn">COD ₹{data.codAmount}</Badge>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2"><PlaceCard title="Pick up from" p={data.pickup} /><PlaceCard title="Deliver to" p={data.drop} /></div>
      {sh.status === "assigned" && (
        <Section title="Shipping label" testId="ship-label">
          <p className="text-sm">Generate the AWB and label. (Courier integration is simulated locally — the AWB is ModVerse-issued until a courier API key is connected.)</p>
          <Button loading={busy} onClick={() => act({ action: "label" }, "Label generated")} data-testid="label-generate">Generate label</Button>
        </Section>
      )}
      {sh.awb && <a className="mv-chip inline-flex" href={`/api/partner/shipments/${id}/label`} target="_blank" rel="noopener" data-testid="label-download">Download label (PDF)</a>}
      {!!next.length && (
        <Section title="Update tracking" testId="ship-track">
          <div className="flex flex-wrap gap-2">
            <Select aria-label="New status" value={status} onChange={(e) => setEv({ ...ev, status: e.target.value })} className="!w-48" data-testid="track-status">{next.map((s) => <option key={s} value={s}>{human(s)}</option>)}</Select>
            {status === "pickup_scheduled" ? (
              <>
                <Input type="date" aria-label="Pickup date" value={ev.pickupAt} onChange={(e) => setEv({ ...ev, pickupAt: e.target.value })} className="!w-44" data-testid="track-pickup-date" />
                <Input aria-label="Pickup window" value={ev.pickupWindow} onChange={(e) => setEv({ ...ev, pickupWindow: e.target.value })} className="!w-36" />
              </>
            ) : <Input placeholder="Location / hub" value={ev.location} onChange={(e) => setEv({ ...ev, location: e.target.value })} className="!w-48" data-testid="track-location" />}
            {status === "failed_delivery" && <Select aria-label="Reason" value={ev.reason} onChange={(e) => setEv({ ...ev, reason: e.target.value })} className="!w-56" data-testid="track-reason"><option value="">Reason…</option>{["Customer unavailable", "Address incomplete", "Customer refused", "Premises closed", "Payment not ready (COD)", "Weather / access issue"].map((r) => <option key={r}>{r}</option>)}</Select>}
            {status === "delivered" && sh.direction === "forward" && <Input placeholder="Received by (name)" value={ev.podName} onChange={(e) => setEv({ ...ev, podName: e.target.value })} className="!w-48" data-testid="track-pod-name" />}
          </div>
          <Button loading={busy} disabled={!status} onClick={() => act({ action: "track", event: { status, location: ev.location || undefined, note: ev.note || undefined, reason: ev.reason || undefined, podName: ev.podName || undefined, pickupAt: status === "pickup_scheduled" ? ev.pickupAt || undefined : undefined, pickupWindow: status === "pickup_scheduled" ? ev.pickupWindow : undefined } }, `Updated: ${human(status)}`)} data-testid="track-submit">Save update</Button>
          {status === "delivered" && <p className="text-xs text-mute">Proof of delivery is required: the receiver&apos;s name, or a POD photo.</p>}
        </Section>
      )}
      {["out_for_delivery", "failed_delivery", "delivered"].includes(sh.status) && (
        <Section title="Proof of delivery">
          {sh.podName && <p className="text-sm">Received by {sh.podName}</p>}
          { }
          {sh.podUploadId && <img src={`/api/uploads/${sh.podUploadId}`} alt="Proof of delivery" className="h-40 rounded-lg object-cover" />}
          {sh.status !== "delivered" && <PhotoUpload url={`/api/partner/shipments/${id}/pod`} onDone={async () => setData(await api<ShipmentView>(`/api/partner/shipments/${id}`))} label="Upload POD photo" testId="pod-upload" />}
        </Section>
      )}
      {sh.failedAttempts > 0 && <Notice tone="warn">{sh.failedAttempts} failed delivery attempt(s).</Notice>}
      <Section title="Tracking events">
        <ul className="space-y-1 text-xs" data-testid="ship-events">{[...sh.events].reverse().map((e, i) => <li key={i} className="flex gap-3"><span className="w-36 shrink-0 text-mute">{when(e.at)}</span><span>{human(e.status)}{e.location ? ` · ${e.location}` : ""}{e.note ? ` — ${e.note}` : ""}</span></li>)}</ul>
      </Section>
      <DisputeForm orderId={sh.orderId} shipmentId={sh.id} />
    </div>
  );
}

// ── Organisation profile ──────────────────────────────────────────
export function PartnerOrganisation() {
  const me = useApi<{ membership: Membership | null }>("/api/partner/me");
  const members = useApi<{ members: { userId: string; name: string; email: string; role: string }[] }>("/api/partner/members");
  const [caps, setCaps] = useState<Record<string, unknown> | null>(null);
  const [email, setEmail] = useState("");
  const m = me.data?.membership;
  if (!me.data) return <Spinner />;
  if (!m) return <EmptyState title="No organisation" action={<Link className="mv-chip" href="/partners">Apply</Link>} />;
  const owner = m.role === "owner";
  return (
    <div className="space-y-5" data-testid="partner-org">
      <h1 className="mv-display text-3xl">{m.org.name}</h1>
      <Section title="Details">
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          {[["Type", m.org.type], ["Status", m.org.status], ["Legal name", m.org.legalName], ["GSTIN", m.org.gstin], ["Contact", m.org.contactEmail], ["Phone", m.org.phone], ["Location", [m.org.city, m.org.state].filter(Boolean).join(", ")], ["Your role", m.role]].map(([k, v]) => <div key={k}><dt className="mv-label">{k}</dt><dd>{v || "—"}</dd></div>)}
        </dl>
      </Section>
      <Section title="Capabilities">
        <CapabilitiesEditor type={m.org.type} value={caps ?? m.org.capabilities} onChange={setCaps} />
        {owner ? <Button size="sm" disabled={!caps} onClick={async () => { try { await api("/api/partner/me", { method: "PATCH", body: caps }); toast("Capabilities saved"); setCaps(null); me.reload(); } catch (e) { toast(errorMessage(e), "bad"); } }}>Save capabilities</Button> : <p className="text-xs text-mute">Only the organisation owner can change capabilities.</p>}
      </Section>
      <Section title="Team">
        <ul className="text-sm">{members.data?.members.map((u) => <li key={u.userId}>{u.name} · {u.email} · <Badge>{u.role}</Badge></li>)}</ul>
        {owner && (
          <div className="flex gap-2">
            <Input type="email" placeholder="Teammate's ModVerse account email" value={email} onChange={(e) => setEmail(e.target.value)} className="!w-72" />
            <Button size="sm" disabled={!email.includes("@")} onClick={async () => { try { await api("/api/partner/members", { body: { email } }); toast("Teammate added"); setEmail(""); members.reload(); } catch (e) { toast(errorMessage(e), "bad"); } }}>Add</Button>
          </div>
        )}
      </Section>
    </div>
  );
}
