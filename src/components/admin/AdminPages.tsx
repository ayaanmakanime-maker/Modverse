"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { api, errorMessage } from "@/lib/client/api";
import { formatINR } from "@/lib/garment/pricing";
import { GarmentFlat } from "@/components/garment/GarmentFlat";
import type { DesignConfig } from "@/lib/garment/schema";
import { Badge, Button, EmptyState, Input, Modal, Notice, Select, Spinner, toast } from "@/components/ui";
import { COLLECTIONS } from "@/lib/library/collections";

function useApi<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => api<T>(url).then(setData).catch((e) => setError(errorMessage(e))), [url]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, error, reload };
}

const H1 = ({ children }: { children: React.ReactNode }) => <h1 className="mv-display mb-6 text-4xl">{children}</h1>;

export function AdminOverview() {
  const { data, error } = useApi<{ users: { role: string; n: number }[]; designs: { status: string; n: number }[]; orders: { n: number }; revenue: { total: number; simulated: number }; ordersByStatus: { status: string; n: number }[]; topModels: { model_id: string; n: number }[]; designsPerDay: { day: string; n: number }[]; note: string }>("/api/admin/stats");
  if (error) return <Notice tone="bad">{error}</Notice>;
  if (!data) return <Spinner />;
  const max = Math.max(1, ...data.designsPerDay.map((d) => d.n));
  return (
    <div className="space-y-8" data-testid="admin-overview">
      <H1>Studio overview</H1>
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="mv-card p-4"><p className="mv-display text-4xl">{data.users.reduce((a, u) => a + u.n, 0)}</p><p className="text-xs text-mute">accounts ({data.users.map((u) => `${u.n} ${u.role}`).join(", ")})</p></div>
        <div className="mv-card p-4"><p className="mv-display text-4xl">{data.designs.reduce((a, d) => a + d.n, 0)}</p><p className="text-xs text-mute">designs</p></div>
        <div className="mv-card p-4"><p className="mv-display text-4xl">{data.orders.n}</p><p className="text-xs text-mute">orders</p></div>
        <div className="mv-card p-4"><p className="mv-display text-4xl">{formatINR(data.revenue.total)}</p><p className="text-xs text-mute">paid · {formatINR(data.revenue.simulated)} simulated (test data)</p></div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="mv-card p-4">
          <p className="mv-eyebrow">Designs created · last 14 days</p>
          <div className="mt-4 flex h-32 items-end gap-1" role="img" aria-label="Designs per day">{data.designsPerDay.map((d) => <div key={d.day} className="flex-1 rounded-t bg-champagne/70" style={{ height: `${(d.n / max) * 100}%` }} title={`${d.day}: ${d.n}`} />)}{!data.designsPerDay.length && <p className="text-xs text-mute">No data yet.</p>}</div>
        </section>
        <section className="mv-card p-4">
          <p className="mv-eyebrow">Orders by status</p>
          <ul className="mt-3 space-y-1 text-sm">{data.ordersByStatus.map((s) => <li key={s.status} className="flex justify-between"><span>{s.status.replace(/_/g, " ")}</span><span className="tabular-nums">{s.n}</span></li>)}</ul>
          <p className="mv-eyebrow mt-5">Most designed models</p>
          <ul className="mt-3 space-y-1 text-sm">{data.topModels.map((m) => <li key={m.model_id} className="flex justify-between"><span>{m.model_id}</span><span className="tabular-nums">{m.n}</span></li>)}</ul>
        </section>
      </div>
      <p className="text-xs text-mute">{data.note} Product analytics (PostHog) can be connected in Integrations.</p>
    </div>
  );
}

interface OrderRow { order: { id: string; orderNumber: string; status: string; total: number; createdAt: string; isSimulated: boolean; paymentStatus: string }; customer: { email: string; name: string } }
export function AdminOrders() {
  const [status, setStatus] = useState("");
  const { data } = useApi<{ orders: OrderRow[] }>(`/api/admin/orders${status ? `?status=${status}` : ""}`);
  return (
    <div>
      <H1>Orders</H1>
      <Select value={status} onChange={(e) => setStatus(e.target.value)} className="mb-4 !w-64" aria-label="Filter by status">
        <option value="">All statuses</option>{["pending_payment", "payment_confirmed", "awaiting_production_approval", "manufacturing", "quality_inspection", "packed", "shipped", "delivered", "cancelled", "refunded"].map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
      </Select>
      {!data ? <Spinner /> : !data.orders.length ? <EmptyState title="No orders" /> : (
        <div className="overflow-x-auto mv-scroll"><table className="w-full min-w-[720px] text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-mute"><tr><th className="py-2">Order</th><th>Customer</th><th>Total</th><th>Payment</th><th>Status</th><th>Placed</th></tr></thead>
          <tbody>{data.orders.map(({ order: o, customer }) => (
            <tr key={o.id} className="border-t border-line">
              <td className="py-2"><Link href={`/admin/orders/${o.id}`} className="font-mono underline">{o.orderNumber}</Link></td>
              <td>{customer.name}<span className="block text-xs text-mute">{customer.email}</span></td>
              <td className="tabular-nums">{formatINR(o.total)}</td>
              <td>{o.paymentStatus}{o.isSimulated && <Badge tone="warn" className="ml-1">simulated</Badge>}</td>
              <td><Badge>{o.status.replace(/_/g, " ")}</Badge></td>
              <td className="text-xs text-mute">{new Date(o.createdAt).toLocaleString("en-IN")}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}

interface AdminOrder { order: { id: string; orderNumber: string; status: string; total: number; isSimulated: boolean; paymentStatus: string; shippingAddress: Record<string, string>; notes: string | null }; items: { id: string; designName: string; size: string; quantity: number; unitPrice: number; reviewStatus: string; projectId: string | null; version: number; designSnapshot: DesignConfig; specSnapshot: { validation?: { status: string; counts: Record<string, number> } } }[]; events: { id: string; status: string; note: string | null; createdAt: string }[]; shipments: { courier: string; awb: string; status: string }[] }
const NEXT_STATUSES = ["design_validation", "awaiting_production_approval", "manufacturing", "quality_inspection", "packed", "shipped", "delivered", "cancelled", "refunded"];
export function AdminOrderDetail({ id }: { id: string }) {
  const { data, reload, error } = useApi<AdminOrder>(`/api/admin/orders/${id}`);
  const [status, setStatus] = useState("");
  const [note, setNote] = useState("");
  const [track, setTrack] = useState({ courier: "", awb: "" });
  if (error) return <Notice tone="bad">{error}</Notice>;
  if (!data) return <Spinner />;
  const o = data.order;
  const run = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast(ok); reload(); } catch (e) { toast(errorMessage(e), "bad"); } };
  return (
    <div className="space-y-6" data-testid="admin-order">
      <H1>Order <span className="font-mono">{o.orderNumber}</span></H1>
      <div className="flex flex-wrap gap-2"><Badge>{o.status.replace(/_/g, " ")}</Badge><Badge tone={o.paymentStatus === "paid" ? "ok" : "warn"}>{o.paymentStatus}</Badge>{o.isSimulated && <Badge tone="warn">simulated payment</Badge>}<span className="text-sm">{formatINR(o.total)}</span></div>
      <section className="space-y-3">
        <p className="mv-eyebrow">Items — production approval required before manufacturing</p>
        {data.items.map((it) => (
          <div key={it.id} className="mv-card flex flex-wrap items-center gap-4 p-3">
            <div className="w-24"><GarmentFlat config={it.designSnapshot} view="front" className="h-24 w-full" /></div>
            <div className="min-w-0 flex-1 text-sm">
              <p>{it.designName} · v{it.version} snapshot · size {it.size} · qty {it.quantity}</p>
              <p className="text-xs text-mute">Automated checks: {it.specSnapshot.validation?.status ?? "n/a"} ({it.specSnapshot.validation?.counts?.error ?? 0} errors, {it.specSnapshot.validation?.counts?.warning ?? 0} warnings) · review: {it.reviewStatus.replace("_", " ")}</p>
              {it.projectId && <a className="text-xs underline" href={`/api/designs/${it.projectId}/techpack?format=pdf&version=${it.version}`} target="_blank" rel="noopener">Tech pack PDF</a>}
            </div>
            <div className="flex gap-1">
              <Button size="sm" onClick={() => run(() => api(`/api/admin/order-items/${it.id}/review`, { body: { decision: "approved" } }), "Approved for production")} data-testid="approve-item">Approve</Button>
              <Button size="sm" variant="ghost" onClick={() => { const n = prompt("What needs to change?"); if (n) run(() => api(`/api/admin/order-items/${it.id}/review`, { body: { decision: "changes_requested", note: n } }), "Changes requested"); }}>Request changes</Button>
            </div>
          </div>
        ))}
      </section>
      <section className="mv-card space-y-3 p-4">
        <p className="mv-eyebrow">Update status</p>
        <div className="flex flex-wrap gap-2">
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="!w-60" aria-label="New status"><option value="">Choose status…</option>{NEXT_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</Select>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="!w-64" />
          <Button size="sm" disabled={!status} onClick={() => run(() => api(`/api/admin/orders/${id}`, { method: "PATCH", body: { status, note: note || undefined } }), "Status updated")} data-testid="update-status">Update</Button>
        </div>
        <p className="text-xs text-mute">No manufacturer is connected in the local release — production status is managed by staff. Real refunds must be issued in the payment provider dashboard.</p>
        <div className="flex flex-wrap gap-2">
          <Input value={track.courier} onChange={(e) => setTrack({ ...track, courier: e.target.value })} placeholder="Courier" className="!w-40" />
          <Input value={track.awb} onChange={(e) => setTrack({ ...track, awb: e.target.value })} placeholder="AWB / tracking no." className="!w-48" />
          <Button size="sm" variant="ghost" disabled={!track.courier || !track.awb} onClick={() => run(() => api(`/api/admin/orders/${id}`, { method: "PATCH", body: { tracking: track } }), "Tracking added")}>Add tracking</Button>
        </div>
      </section>
      <section><p className="mv-eyebrow">Ship to</p><p className="text-sm">{Object.values(o.shippingAddress).filter(Boolean).join(", ")}</p>{o.notes && <p className="text-sm text-mute">Notes: {o.notes}</p>}</section>
      <section><p className="mv-eyebrow">Timeline</p><ul className="mt-2 space-y-1 text-xs">{data.events.map((e) => <li key={e.id}><span className="text-mute">{new Date(e.createdAt).toLocaleString("en-IN")}</span> — {e.status.replace(/_/g, " ")}{e.note ? `: ${e.note}` : ""}</li>)}</ul></section>
    </div>
  );
}

interface DesignRow { design: { id: string; name: string; modelId: string; audience: string; status: string; reviewStatus: string; reviewNote: string | null; currentVersion: number; updatedAt: string; childProfileId: string | null }; owner: { email: string; name: string } }
export function AdminDesigns() {
  const [review, setReview] = useState("pending");
  const { data, reload } = useApi<{ designs: DesignRow[] }>(`/api/admin/designs${review ? `?review=${review}` : ""}`);
  const [preview, setPreview] = useState<{ name: string; config: DesignConfig } | null>(null);
  return (
    <div>
      <H1>Design reviews</H1>
      <div className="mb-4 flex gap-2">{[["pending", "Pending review"], ["changes_requested", "Changes requested"], ["approved", "Approved"], ["", "All designs"]].map(([v, l]) => <button key={v} className="mv-chip" data-active={review === v} onClick={() => setReview(v)}>{l}</button>)}</div>
      {!data ? <Spinner /> : !data.designs.length ? <EmptyState title="Nothing to review" /> : (
        <div className="space-y-2">{data.designs.map(({ design: d, owner }) => (
          <div key={d.id} className="mv-card flex flex-wrap items-center gap-3 p-3 text-sm">
            <div className="min-w-0 flex-1"><p>{d.name} <span className="text-xs text-mute">· {d.modelId} · {d.audience}{d.childProfileId ? " · guardian-managed" : ""} · v{d.currentVersion}</span></p><p className="text-xs text-mute">{owner.name} ({owner.email}) · {d.status} · review {d.reviewStatus}{d.reviewNote ? ` — ${d.reviewNote}` : ""}</p></div>
            <Button size="sm" variant="ghost" onClick={async () => { const r = await api<{ version: { config: DesignConfig } }>(`/api/designs/${d.id}`); setPreview({ name: d.name, config: r.version.config }); }}>Preview</Button>
            <a className="mv-chip" href={`/api/designs/${d.id}/techpack?format=pdf`} target="_blank" rel="noopener">Tech pack</a>
            <Button size="sm" onClick={async () => { await api(`/api/admin/designs/${d.id}/review`, { body: { decision: "approved" } }); toast("Approved"); reload(); }}>Approve</Button>
            <Button size="sm" variant="ghost" onClick={async () => { const n = prompt("Feedback for the customer"); if (!n) return; await api(`/api/admin/designs/${d.id}/review`, { body: { decision: "changes_requested", note: n } }); toast("Changes requested"); reload(); }}>Request changes</Button>
          </div>
        ))}</div>
      )}
      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview?.name ?? ""} wide>
        {preview && <div className="grid grid-cols-2 gap-3"><GarmentFlat config={preview.config} view="front" className="w-full" /><GarmentFlat config={preview.config} view="back" className="w-full" /></div>}
      </Modal>
    </div>
  );
}

interface UserRow { id: string; email: string; name: string; role: string; status: string; emailVerifiedAt: string | null; createdAt: string; lastLoginAt: string | null }
export function AdminUsers() {
  const [q, setQ] = useState("");
  const { data, reload } = useApi<{ users: UserRow[] }>(`/api/admin/users${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  const patch = async (id: string, body: Record<string, string>) => { try { await api(`/api/admin/users/${id}`, { method: "PATCH", body }); toast("Updated"); reload(); } catch (e) { toast(errorMessage(e), "bad"); } };
  return (
    <div>
      <H1>Customers &amp; staff</H1>
      <Input placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} className="mb-4 !w-72" />
      {!data ? <Spinner /> : (
        <div className="overflow-x-auto mv-scroll"><table className="w-full min-w-[720px] text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-mute"><tr><th className="py-2">User</th><th>Role</th><th>Status</th><th>Verified</th><th>Last login</th></tr></thead>
          <tbody>{data.users.map((u) => (
            <tr key={u.id} className="border-t border-line">
              <td className="py-2">{u.name}<span className="block text-xs text-mute">{u.email}</span></td>
              <td><Select value={u.role} onChange={(e) => patch(u.id, { role: e.target.value })} className="!w-32 !py-1 !text-xs" disabled={u.status === "deleted"}><option value="customer">customer</option><option value="staff">staff</option><option value="admin">admin</option></Select></td>
              <td>{u.status === "deleted" ? <Badge>deleted</Badge> : <Select value={u.status} onChange={(e) => patch(u.id, { status: e.target.value })} className="!w-32 !py-1 !text-xs"><option value="active">active</option><option value="disabled">disabled</option></Select>}</td>
              <td>{u.emailVerifiedAt ? <Badge tone="ok">yes</Badge> : <Badge>no</Badge>}</td>
              <td className="text-xs text-mute">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString("en-IN") : "—"}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}

export function AdminCatalogue() {
  const { data, reload } = useApi<{ categories: { id: string; name: string; active: boolean }[]; models: { id: string; name: string; garmentType: string; active: boolean; geometryCompleteness: string }[]; fabrics: { id: string; name: string; category: string; active: boolean; priceDelta: number }[]; products: { id: string; name: string; categoryId: string; basePrice: number; active: boolean; featured: boolean }[] }>("/api/admin/catalogue");
  const toggle = async (entity: string, id: string, patch: Record<string, unknown>) => { try { await api("/api/admin/catalogue", { method: "PATCH", body: { entity, id, ...patch } }); reload(); } catch (e) { toast(errorMessage(e), "bad"); } };
  if (!data) return <Spinner />;
  return (
    <div className="space-y-8">
      <H1>Catalogue</H1>
      <section><p className="mv-eyebrow mb-2">Categories</p><div className="flex gap-2">{data.categories.map((c) => <label key={c.id} className="mv-chip"><input type="checkbox" checked={c.active} onChange={(e) => toggle("category", c.id, { active: e.target.checked })} /> {c.name}</label>)}</div></section>
      <section><p className="mv-eyebrow mb-2">Garment models ({data.models.length})</p><div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">{data.models.map((m) => <label key={m.id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm"><span>{m.name} <span className="text-xs text-mute">{m.garmentType} · 3D {m.geometryCompleteness}</span></span><input type="checkbox" checked={m.active} onChange={(e) => toggle("model", m.id, { active: e.target.checked })} aria-label={`Active ${m.name}`} /></label>)}</div></section>
      <section><p className="mv-eyebrow mb-2">Fabrics ({data.fabrics.length})</p><div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">{data.fabrics.map((f) => <label key={f.id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm"><span>{f.name} <span className="text-xs text-mute">{f.category} · {f.priceDelta >= 0 ? "+" : ""}₹{f.priceDelta}</span></span><input type="checkbox" checked={f.active} onChange={(e) => toggle("fabric", f.id, { active: e.target.checked })} aria-label={`Active ${f.name}`} /></label>)}</div></section>
      <section><p className="mv-eyebrow mb-2">Products ({data.products.length})</p><div className="overflow-x-auto mv-scroll"><table className="w-full min-w-[640px] text-sm"><tbody>{data.products.map((p) => (
        <tr key={p.id} className="border-t border-line"><td className="py-1.5">{p.name} <span className="text-xs text-mute">{p.categoryId}</span></td><td><input type="number" defaultValue={p.basePrice} className="mv-input !w-28 !py-1 !text-xs" onBlur={(e) => Number(e.target.value) !== p.basePrice && toggle("product", p.id, { basePrice: Number(e.target.value) })} aria-label="Base price" /></td><td><label className="text-xs"><input type="checkbox" checked={p.featured} onChange={(e) => toggle("product", p.id, { featured: e.target.checked })} /> featured</label></td><td><label className="text-xs"><input type="checkbox" checked={p.active} onChange={(e) => toggle("product", p.id, { active: e.target.checked })} /> active</label></td></tr>
      ))}</tbody></table></div></section>
    </div>
  );
}

export function AdminLibrary() {
  const [collection, setCollection] = useState("Cyberpunk_Futurism");
  const [kind, setKind] = useState("graphic");
  const { data, reload } = useApi<{ total: number; items: { id: string; name: string; url: string; active: boolean; featured: boolean }[] }>(`/api/library?kind=${kind}&collection=${collection}&limit=120&includeInactive=1`);
  return (
    <div>
      <H1>Creative Library</H1>
      <p className="mb-4 text-sm text-mute">All 1,000 assets were imported from the original manifest. Deactivating hides an asset from customers; original files are never modified.</p>
      <div className="mb-4 flex flex-wrap gap-2">
        <Select value={kind} onChange={(e) => setKind(e.target.value)} className="!w-40">{["graphic", "element", "template", "pattern", "palette"].map((k) => <option key={k}>{k}</option>)}</Select>
        <Select value={collection} onChange={(e) => setCollection(e.target.value)} className="!w-60">{COLLECTIONS.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}</Select>
      </div>
      {!data ? <Spinner /> : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-8">{data.items.map((a) => (
          <div key={a.id} className={clsx("mv-card p-1.5", !a.active && "opacity-40")}>
            <div className="mv-checker aspect-[5/6] rounded"><img src={a.url} alt={a.name} className="h-full w-full object-contain" loading="lazy" /></div>
            <p className="mt-1 truncate text-[0.62rem]">{a.id}</p>
            <div className="flex gap-1 text-[0.6rem]">
              <button className="underline" onClick={async () => { await api("/api/admin/library", { method: "PATCH", body: { id: a.id, featured: !a.featured } }); reload(); }}>{a.featured ? "★ featured" : "☆ feature"}</button>
              <button className="underline" onClick={async () => { await api("/api/admin/library", { method: "PATCH", body: { id: a.id, active: !a.active } }); reload(); }}>{a.active ? "hide" : "show"}</button>
            </div>
          </div>
        ))}</div>
      )}
      <p className="mt-2 text-xs text-mute">Inactive assets are hidden from the customer library (inactive items are filtered server-side).</p>
    </div>
  );
}

interface IntegrationView { def: { id: string; category: string; name: string; description: string; docsUrl: string; billable: boolean; testable: boolean; fields: { key: string; label: string; secret: boolean; required: boolean; placeholder?: string; help?: string }[]; localFallback: string }; status: string; environment: "test" | "live"; enabled: boolean; hasCredentials: boolean; credentialSource: string; maskedCredentials: Record<string, string>; lastTestedAt: string | null; lastTestOk: boolean | null; lastError: string | null }
const STATUS_TONE: Record<string, "ok" | "warn" | "bad" | "info" | "neutral"> = { not_configured: "neutral", test: "info", live: "ok", disabled: "warn", error: "bad" };
export function IntegrationManager() {
  const { data, reload, error } = useApi<{ integrations: IntegrationView[] }>("/api/admin/integrations");
  const [open, setOpen] = useState<IntegrationView | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  if (error) return <Notice tone="bad">{error}</Notice>;
  if (!data) return <Spinner />;
  const cats = [...new Set(data.integrations.map((i) => i.def.category))];
  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    try {
      const r = await fn();
      const msg = (r as { message?: string })?.message;
      toast(msg ?? "Done", (r as { ok?: boolean })?.ok === false ? "bad" : "ok");
      await reload();
    } catch (e) {
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="space-y-8" data-testid="integration-manager">
      <H1>Integration Manager</H1>
      <Notice tone="info" title="Nothing is active until you test and enable it">Credentials are encrypted at rest and never returned to the browser. A provider can only be enabled after a successful connection test; billable and LIVE modes require explicit confirmation. Without a provider, ModVerse uses its labelled local fallback.</Notice>
      {cats.map((cat) => (
        <section key={cat}>
          <p className="mv-eyebrow mb-2">{cat}</p>
          <div className="grid gap-2 lg:grid-cols-2">
            {data.integrations.filter((i) => i.def.category === cat).map((i) => (
              <div key={i.def.id} className="mv-card p-4" data-testid={`integration-${i.def.id}`}>
                <div className="flex items-start justify-between gap-2">
                  <div><p className="font-medium">{i.def.name}</p><p className="text-xs text-mute">{i.def.description}</p></div>
                  <Badge tone={STATUS_TONE[i.status]}>{i.status.replace("_", " ").toUpperCase()}</Badge>
                </div>
                <p className="mt-2 text-xs text-mute">Fallback: {i.def.localFallback}</p>
                <p className="mt-1 text-xs">{i.def.billable && <Badge tone="warn">billable</Badge>} {!i.def.testable && <Badge>no automated test yet</Badge>} {i.hasCredentials && <Badge tone="info">credentials · {i.credentialSource}</Badge>} {i.lastTestedAt && <Badge tone={i.lastTestOk ? "ok" : "bad"}>last test {i.lastTestOk ? "passed" : "failed"}</Badge>}</p>
                {i.lastError && <p className="mt-1 text-xs text-bad">{i.lastError}</p>}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => { setOpen(i); setValues(Object.fromEntries(i.def.fields.map((f) => [f.key, f.secret ? "" : i.maskedCredentials[f.key] ?? ""]))); }}>Credentials</Button>
                  <Button size="sm" variant="ghost" disabled={!i.hasCredentials} loading={busy === `test-${i.def.id}`} onClick={() => run(`test-${i.def.id}`, () => api(`/api/admin/integrations/${i.def.id}`, { method: "POST" }))}>Test connection</Button>
                  {i.enabled ? (
                    <Button size="sm" variant="ghost" onClick={() => run("toggle", () => api(`/api/admin/integrations/${i.def.id}`, { method: "PATCH", body: { enabled: false, environment: i.environment } }))}>Disable</Button>
                  ) : (
                    <Button size="sm" variant="ghost" disabled={i.lastTestOk !== true} title={i.lastTestOk !== true ? "Run a successful connection test first" : undefined} onClick={() => run("toggle", () => api(`/api/admin/integrations/${i.def.id}`, { method: "PATCH", body: { enabled: true, environment: "test", confirmBillable: i.def.billable ? confirm(`${i.def.name} is billable. Enable in TEST mode and accept any charges?`) : undefined } }))}>Enable (test)</Button>
                  )}
                  {i.enabled && i.environment === "test" && <Button size="sm" variant="danger" onClick={() => { if (confirm(`Switch ${i.def.name} to LIVE mode? Real customers and real money may be affected.`)) run("live", () => api(`/api/admin/integrations/${i.def.id}`, { method: "PATCH", body: { enabled: true, environment: "live", confirmBillable: true, confirmLive: true } })); }}>Go live…</Button>}
                  <a className="mv-chip" href={i.def.docsUrl} target="_blank" rel="noopener noreferrer">Docs</a>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? `${open.def.name} credentials` : ""}>
        {open && (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run("save", () => api(`/api/admin/integrations/${open.def.id}`, { method: "PUT", body: { values } })).then(() => setOpen(null)); }}>
            {open.def.fields.map((f) => (
              <label key={f.key} className="block"><span className="mv-label">{f.label}{f.required ? " *" : ""}</span>
                {f.key === "workflow" || f.key === "privateKey" ? <textarea className="mv-input min-h-20 font-mono text-xs" value={values[f.key] ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} placeholder={f.secret && open.maskedCredentials[f.key] ? `stored ${open.maskedCredentials[f.key]} — leave blank to keep` : f.placeholder} />
                  : <Input type={f.secret ? "password" : "text"} autoComplete="off" value={values[f.key] ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} placeholder={f.secret && open.maskedCredentials[f.key] ? `stored ${open.maskedCredentials[f.key]} — leave blank to keep` : f.placeholder} />}
                {f.help && <span className="text-xs text-mute">{f.help}</span>}
              </label>
            ))}
            <p className="text-xs text-mute">Saving resets the provider to untested and disabled.</p>
            <div className="flex gap-2"><Button type="submit" loading={busy === "save"}>Save credentials</Button>{open.hasCredentials && open.credentialSource === "database" && <Button type="button" variant="danger" onClick={() => run("clear", () => api(`/api/admin/integrations/${open.def.id}`, { method: "DELETE" })).then(() => setOpen(null))}>Remove</Button>}</div>
          </form>
        )}
      </Modal>
    </div>
  );
}

export function AdminAudit() {
  const { data } = useApi<{ logs: { log: { id: string; action: string; entityType: string; entityId: string | null; details: Record<string, unknown>; createdAt: string }; actor: string | null }[] }>("/api/admin/audit");
  if (!data) return <Spinner />;
  return (
    <div>
      <H1>Audit log</H1>
      <div className="overflow-x-auto mv-scroll"><table className="w-full min-w-[720px] text-xs">
        <thead className="text-left uppercase tracking-wider text-mute"><tr><th className="py-2">Time</th><th>Actor</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead>
        <tbody>{data.logs.map(({ log, actor }) => <tr key={log.id} className="border-t border-line align-top"><td className="py-1.5 whitespace-nowrap">{new Date(log.createdAt).toLocaleString("en-IN")}</td><td>{actor ?? "system"}</td><td className="font-mono">{log.action}</td><td>{log.entityType} {log.entityId?.slice(0, 8)}</td><td className="max-w-md truncate font-mono text-mute">{JSON.stringify(log.details)}</td></tr>)}</tbody>
      </table></div>
    </div>
  );
}

export function AdminSettings() {
  const { data, reload } = useApi<{ settings: { key: string; value: unknown }[] }>("/api/admin/settings");
  const [shipping, setShipping] = useState({ flatRate: 79, freeAbove: 1999 });
  const [sim, setSim] = useState(true);
  useEffect(() => {
    const s = data?.settings.find((x) => x.key === "shipping")?.value as { flatRate: number; freeAbove: number } | undefined;
    if (s) setShipping({ flatRate: s.flatRate, freeAbove: s.freeAbove });
    const c = data?.settings.find((x) => x.key === "checkout")?.value as { simulatedPaymentsEnabled: boolean } | undefined;
    if (c) setSim(c.simulatedPaymentsEnabled);
  }, [data]);
  const save = async (key: string, value: unknown) => { try { await api("/api/admin/settings", { method: "PATCH", body: { key, value } }); toast("Saved"); reload(); } catch (e) { toast(errorMessage(e), "bad"); } };
  if (!data) return <Spinner />;
  return (
    <div className="max-w-xl space-y-6">
      <H1>Platform settings</H1>
      <div className="mv-card space-y-3 p-4">
        <p className="font-medium">Shipping (local estimate)</p>
        <div className="grid grid-cols-2 gap-2"><label className="text-sm">Flat rate (₹)<Input type="number" value={shipping.flatRate} onChange={(e) => setShipping({ ...shipping, flatRate: Number(e.target.value) })} /></label><label className="text-sm">Free above (₹)<Input type="number" value={shipping.freeAbove} onChange={(e) => setShipping({ ...shipping, freeAbove: Number(e.target.value) })} /></label></div>
        <Button size="sm" onClick={() => save("shipping", { ...shipping, currency: "INR" })}>Save shipping</Button>
      </div>
      <div className="mv-card space-y-3 p-4">
        <p className="font-medium">Checkout</p>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sim} onChange={(e) => setSim(e.target.checked)} /> Allow clearly-labelled simulated payments (local testing)</label>
        <Button size="sm" onClick={() => save("checkout", { simulatedPaymentsEnabled: sim })}>Save checkout</Button>
      </div>
      <p className="text-xs text-mute">Pricing rules (GST estimate, print rates) live in src/lib/garment/pricing.ts and are mirrored in the &quot;pricing&quot; setting.</p>
    </div>
  );
}
