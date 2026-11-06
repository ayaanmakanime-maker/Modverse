"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "@/lib/client/api";
import { createDesign, createTextLayer } from "@/lib/garment/design";
import { formatINR, priceDesign, type PricingRules } from "@/lib/garment/pricing";
import { PRINT_METHODS } from "@/lib/garment/types";
import { PRINT_METHOD_INFO } from "@/lib/garment/fabrics";
import { Badge, Button, Input, Notice, Select, Spinner, toast } from "@/components/ui";
import { PriceBreakdownView } from "@/components/pricing/PriceBreakdownView";

interface DiscountRow { id: string; code: string; kind: "percent" | "fixed"; value: number; minSubtotal: number; maxDiscount: number | null; active: boolean; endsAt: string | null; usageLimit: number | null; perUserLimit: number; used: number; description: string | null }

function Num({ label, value, onChange, step = 1, testid }: { label: string; value: number; onChange: (v: number) => void; step?: number; testid?: string }) {
  return (
    <label className="block text-xs">
      <span className="text-mute">{label}</span>
      <Input type="number" step={step} value={Number.isFinite(value) ? value : 0} onChange={(e) => onChange(Number(e.target.value))} className="!py-1 !text-xs" data-testid={testid} />
    </label>
  );
}

/** Example designs used to preview the effect of rule changes. */
function examples() {
  const tee = createDesign("tee-classic-crew", "men");
  tee.layers.push(createTextLayer(tee, "MODVERSE", "center-chest"));
  const shirt = createDesign("shirt-oxford-button-down", "men");
  shirt.layers.push({ ...createTextLayer(shirt, "AK", "left-chest"), method: "embroidery" });
  const over = createDesign("tee-oversized", "men");
  over.layers.push({ ...createTextLayer(over, "TOKYO 2099", "full-back"), method: "screen" });
  return [{ name: "Classic tee + DTG chest text", config: tee }, { name: "Oxford shirt + embroidered monogram", config: shirt }, { name: "Oversized tee + screen-printed back", config: over }];
}

export function AdminPricing() {
  const [rules, setRules] = useState<PricingRules | null>(null);
  const [saved, setSaved] = useState<PricingRules | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<{ rules: PricingRules }>("/api/admin/pricing").then((r) => { setRules(r.rules); setSaved(r.rules); }).catch((e) => toast(errorMessage(e), "bad")), []);
  useEffect(() => {
    load();
  }, [load]);
  const ex = useMemo(examples, []);
  if (!rules || !saved) return <Spinner />;
  const set = (fn: (r: PricingRules) => void) => setRules((r) => { const n = structuredClone(r!); fn(n); return n; });
  async function save() {
    setBusy(true);
    try {
      const r = await api<{ rules: PricingRules }>("/api/admin/pricing", { method: "PUT", body: rules });
      setRules(r.rules);
      setSaved(r.rules);
      toast("Pricing rules saved — all carts and new orders use them");
    } catch (e) {
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(false);
    }
  }
  async function reset() {
    if (!confirm("Reset all pricing rules to the ModVerse defaults?")) return;
    const r = await api<{ rules: PricingRules }>("/api/admin/pricing", { method: "DELETE" });
    setRules(r.rules);
    setSaved(r.rules);
    toast("Defaults restored");
  }
  const dirty = JSON.stringify(rules) !== JSON.stringify(saved);
  return (
    <div className="space-y-6" data-testid="admin-pricing">
      <h1 className="mv-display text-4xl">Pricing</h1>
      <Notice tone="warn" title="Illustrative until supplier rates are verified">These rules drive every price (editor, cart, checkout and the order snapshot). Replace the estimates with manufacturer quotations before selling. GST rates must be confirmed with a tax advisor.</Notice>
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <div className="mv-card space-y-3 p-4">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={rules.illustrative} onChange={(e) => set((r) => void (r.illustrative = e.target.checked))} /> Label prices as illustrative</label>
            <p className="text-xs font-medium">Margins (price = cost × margin)</p>
            <div className="grid grid-cols-3 gap-2">
              {(["material", "construction", "decoration"] as const).map((k) => <Num key={k} label={k} step={0.05} value={rules.margins[k]} onChange={(v) => set((r) => void (r.margins[k] = v))} testid={`margin-${k}`} />)}
            </div>
            <p className="text-xs font-medium">Tax & shipping</p>
            <div className="grid grid-cols-3 gap-2">
              <Num label="GST low rate" step={0.01} value={rules.tax.gstLowRate} onChange={(v) => set((r) => void (r.tax.gstLowRate = v))} />
              <Num label="GST high rate" step={0.01} value={rules.tax.gstHighRate} onChange={(v) => set((r) => void (r.tax.gstHighRate = v))} />
              <Num label="High rate above ₹" value={rules.tax.gstThreshold} onChange={(v) => set((r) => void (r.tax.gstThreshold = v))} />
              <Num label="Shipping flat ₹" value={rules.shipping.flatRate} onChange={(v) => set((r) => void (r.shipping.flatRate = v))} testid="ship-flat" />
              <Num label="Free shipping above ₹" value={rules.shipping.freeAbove} onChange={(v) => set((r) => void (r.shipping.freeAbove = v))} />
              <Num label="Kids price factor" step={0.01} value={rules.kidsFactor} onChange={(v) => set((r) => void (r.kidsFactor = v))} />
            </div>
          </div>
          <div className="mv-card space-y-3 p-4">
            <p className="text-xs font-medium">Material — fabric cost per m² (for consumption changes), GSM step cost</p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {Object.entries(rules.material.costPerM2).map(([k, v]) => <Num key={k} label={k} value={v} onChange={(n) => set((r) => void (r.material.costPerM2[k] = n))} />)}
              <Num label="per 20 GSM" value={rules.material.gsmStepCost} onChange={(v) => set((r) => void (r.material.gsmStepCost = v))} />
              <Num label="threshold m²" step={0.01} value={rules.material.consumptionThresholdM2} onChange={(v) => set((r) => void (r.material.consumptionThresholdM2 = v))} />
            </div>
          </div>
          <div className="mv-card space-y-3 p-4">
            <p className="text-xs font-medium">Construction costs (₹, before margin)</p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {Object.entries(rules.construction).map(([k, v]) => <Num key={k} label={k} value={v} onChange={(n) => set((r) => void (r.construction[k] = n))} />)}
            </div>
          </div>
          <div className="mv-card space-y-3 p-4">
            <p className="text-xs font-medium">Decoration costs (₹, before margin)</p>
            <table className="w-full text-xs">
              <thead><tr className="text-left text-mute"><th className="font-normal">Method</th><th className="font-normal">per cm²</th><th className="font-normal">minimum</th><th className="font-normal">setup / placement</th></tr></thead>
              <tbody>
                {PRINT_METHODS.map((m) => (
                  <tr key={m}>
                    <td className="py-1 pr-2">{PRINT_METHOD_INFO[m].name}</td>
                    <td className="pr-1"><Input type="number" step={0.01} value={rules.decoration.perCm2[m]} onChange={(e) => set((r) => void (r.decoration.perCm2[m] = Number(e.target.value)))} className="!py-1 !text-xs" disabled={m === "embroidery"} /></td>
                    <td className="pr-1"><Input type="number" value={rules.decoration.minimum[m]} onChange={(e) => set((r) => void (r.decoration.minimum[m] = Number(e.target.value)))} className="!py-1 !text-xs" /></td>
                    <td><Input type="number" value={rules.decoration.setupPerPlacement[m]} onChange={(e) => set((r) => void (r.decoration.setupPerPlacement[m] = Number(e.target.value)))} className="!py-1 !text-xs" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="grid grid-cols-3 gap-2">
              <Num label="Screen: per colour" value={rules.decoration.screenPerColour} onChange={(v) => set((r) => void (r.decoration.screenPerColour = v))} />
              <Num label="Embroidery: per 1,000 stitches" value={rules.decoration.embroideryPer1000Stitches} onChange={(v) => set((r) => void (r.decoration.embroideryPer1000Stitches = v))} testid="emb-per-1000" />
              <Num label="Stitches per cm² (fill)" value={rules.decoration.stitchDensityPerCm2} onChange={(v) => set((r) => void (r.decoration.stitchDensityPerCm2 = v))} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={save} loading={busy} disabled={!dirty} data-testid="pricing-save">Save pricing rules</Button>
            <Button variant="ghost" onClick={() => setRules(saved)} disabled={!dirty}>Discard changes</Button>
            <Button variant="ghost" onClick={reset}>Reset to defaults</Button>
          </div>
        </div>
        <div className="space-y-3">
          <p className="mv-eyebrow">Live preview {dirty && <Badge tone="warn">unsaved</Badge>}</p>
          {ex.map((e) => {
            const before = priceDesign(e.config, saved);
            const after = priceDesign(e.config, rules);
            return (
              <details key={e.name} className="mv-card p-3" open={e === ex[0]}>
                <summary className="flex cursor-pointer justify-between text-sm"><span>{e.name}</span><span className="tabular-nums">{dirty && before.unitTotal !== after.unitTotal ? <><span className="text-mute line-through">{formatINR(before.unitTotal)}</span> </> : null}{formatINR(after.unitTotal)}</span></summary>
                <div className="mt-2"><PriceBreakdownView price={after} compact /></div>
              </details>
            );
          })}
        </div>
      </div>
      <DiscountManager />
    </div>
  );
}

function DiscountManager() {
  const [rows, setRows] = useState<DiscountRow[] | null>(null);
  const [form, setForm] = useState({ code: "", kind: "percent" as "percent" | "fixed", value: 10, minSubtotal: 0, maxDiscount: "", usageLimit: "", perUserLimit: 1, endsAt: "", description: "" });
  const load = useCallback(() => api<{ discounts: DiscountRow[] }>("/api/admin/discounts").then((r) => setRows(r.discounts)).catch((e) => toast(errorMessage(e), "bad")), []);
  useEffect(() => {
    load();
  }, [load]);
  async function create() {
    try {
      await api("/api/admin/discounts", { body: { ...form, maxDiscount: form.maxDiscount ? Number(form.maxDiscount) : null, usageLimit: form.usageLimit ? Number(form.usageLimit) : null, endsAt: form.endsAt || null, description: form.description || null } });
      toast(`Discount ${form.code.toUpperCase()} created`);
      setForm({ ...form, code: "", description: "" });
      load();
    } catch (e) {
      toast(errorMessage(e), "bad");
    }
  }
  return (
    <div className="mv-card space-y-3 p-4" data-testid="discounts">
      <p className="font-medium">Discount codes</p>
      <p className="text-xs text-mute">Applied to the pre-tax subtotal (GST is charged on the discounted value). Codes are re-validated at checkout; usage counts placed orders.</p>
      {!rows ? <Spinner /> : rows.length === 0 ? <p className="text-xs text-mute">No discount codes yet.</p> : (
        <table className="w-full text-xs">
          <thead><tr className="text-left text-mute"><th className="font-normal">Code</th><th className="font-normal">Value</th><th className="font-normal">Min</th><th className="font-normal">Used</th><th className="font-normal">Ends</th><th /></tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} className="border-t border-line">
                <td className="py-1 font-mono">{d.code} {!d.active && <Badge>inactive</Badge>}</td>
                <td>{d.kind === "percent" ? `${d.value}%` : formatINR(d.value)}{d.maxDiscount ? ` (max ${formatINR(d.maxDiscount)})` : ""}</td>
                <td>{formatINR(d.minSubtotal)}</td>
                <td>{d.used}{d.usageLimit ? ` / ${d.usageLimit}` : ""}</td>
                <td>{d.endsAt ? new Date(d.endsAt).toLocaleDateString("en-IN") : "—"}</td>
                <td className="text-right">
                  <button className="mv-chip !py-0" onClick={async () => { await api(`/api/admin/discounts/${d.id}`, { method: "PATCH", body: { ...d, active: !d.active } }).catch((e) => toast(errorMessage(e), "bad")); load(); }}>{d.active ? "Deactivate" : "Activate"}</button>
                  <button className="mv-chip !py-0 text-bad" onClick={async () => { if (confirm(`Delete ${d.code}?`)) { await api(`/api/admin/discounts/${d.id}`, { method: "DELETE" }); load(); } }}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="text-xs"><span className="text-mute">Code</span><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} className="!py-1 !text-xs" data-testid="discount-code" /></label>
        <label className="text-xs"><span className="text-mute">Type</span><Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as "percent" | "fixed" })} className="!py-1 !text-xs"><option value="percent">Percent</option><option value="fixed">Fixed ₹</option></Select></label>
        <Num label={form.kind === "percent" ? "Percent" : "Amount ₹"} value={form.value} onChange={(v) => setForm({ ...form, value: v })} testid="discount-value" />
        <Num label="Minimum subtotal ₹" value={form.minSubtotal} onChange={(v) => setForm({ ...form, minSubtotal: v })} />
        <label className="text-xs"><span className="text-mute">Max discount ₹</span><Input type="number" value={form.maxDiscount} onChange={(e) => setForm({ ...form, maxDiscount: e.target.value })} className="!py-1 !text-xs" /></label>
        <label className="text-xs"><span className="text-mute">Usage limit</span><Input type="number" value={form.usageLimit} onChange={(e) => setForm({ ...form, usageLimit: e.target.value })} className="!py-1 !text-xs" /></label>
        <Num label="Per customer" value={form.perUserLimit} onChange={(v) => setForm({ ...form, perUserLimit: v })} />
        <label className="text-xs"><span className="text-mute">Ends</span><Input type="date" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} className="!py-1 !text-xs" /></label>
      </div>
      <Button size="sm" onClick={create} disabled={!form.code} data-testid="discount-create">Create discount</Button>
    </div>
  );
}
