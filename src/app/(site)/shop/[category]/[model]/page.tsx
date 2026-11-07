import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { Sparkles, Layers, Ruler } from "lucide-react";
import { GarmentFlat } from "@/components/garment/GarmentFlat";
import { createDesign } from "@/lib/garment/design";
import { MODEL_BY_ID } from "@/lib/garment/models";
import { getFabric, FABRICS } from "@/lib/garment/fabrics";
import { computeMeasurements, SIZE_CHARTS } from "@/lib/garment/sizing";
import { formatINR } from "@/lib/garment/pricing";
import { getDb } from "@/lib/db/client";
import { products } from "@/lib/db/schema";
import { AUDIENCES, FIT_LABELS, type Audience } from "@/lib/garment/types";
import { ProductActions } from "./ProductActions";
import { ProductPreview3D } from "./ProductPreview3D";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ model: string }> }) {
  const { model } = await params;
  return { title: MODEL_BY_ID.get(model)?.name ?? "Garment" };
}

export default async function ProductPage({ params }: { params: Promise<{ category: string; model: string }> }) {
  const { category, model: modelId } = await params;
  const model = MODEL_BY_ID.get(modelId);
  if (!model || !(AUDIENCES as readonly string[]).includes(category) || !model.audiences.includes(category as Audience)) notFound();
  const db = await getDb();
  const [product] = await db.select().from(products).where(and(eq(products.categoryId, category), eq(products.garmentModelId, modelId)));
  if (!product || !product.active) notFound();
  const audience = category as Audience;
  const design = createDesign(model.id, audience);
  const fabric = getFabric(model.fabricId);
  const chart = SIZE_CHARTS[audience].map((r) => ({ size: r.size, m: computeMeasurements({ ...design, size: r.size }) }));
  const altFabrics = FABRICS.filter((f) => f.garmentTypes.includes(model.garmentType));
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 md:px-6">
      <nav aria-label="Breadcrumb" className="text-xs text-mute"><Link href={`/shop/${category}`} className="hover:text-bone">{category}</Link> / {model.name}</nav>
      <div className="mt-4 grid gap-8 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-3">
          <ProductPreview3D config={design} />
          <div className="grid grid-cols-2 gap-3">
            <div className="mv-card flex aspect-square items-center justify-center p-4"><GarmentFlat config={design} view="front" className="h-full w-full" title="Front flat" /></div>
            <div className="mv-card flex aspect-square items-center justify-center p-4"><GarmentFlat config={design} view="back" className="h-full w-full" title="Back flat" /></div>
          </div>
        </div>
        <div>
          <p className="mv-eyebrow">{model.garmentType === "tshirt" ? "T-shirt" : "Shirt"} · {FIT_LABELS[model.fit]} fit</p>
          <h1 className="mv-display mt-2 text-5xl">{model.name}</h1>
          <p className="mt-4 text-bone-2">{model.description}</p>
          <p className="mt-6 text-2xl">from {formatINR(product.basePrice)} <span className="text-xs text-mute">incl. design · GST extra (estimate)</span></p>
          <ul className="mt-5 flex flex-wrap gap-2">{model.highlights.map((h) => <li key={h} className="mv-chip">{h}</li>)}</ul>
          <ProductActions productId={product.id} modelId={model.id} audience={audience} />
          <div className="mt-8 space-y-5 text-sm">
            <div className="mv-card p-4">
              <p className="mv-label">Default fabric</p>
              <p>{fabric.name} · {model.gsm} GSM · {fabric.composition}</p>
              <p className="mt-1 text-mute">{fabric.description}</p>
              <p className="mt-2 text-xs text-mute">Also available: {altFabrics.filter((f) => f.id !== fabric.id).map((f) => f.name).join(", ")}.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="mv-card p-4"><Sparkles className="size-4 text-champagne" /><p className="mt-2 font-medium">Design Studio</p><p className="text-xs text-mute">Guided, with templates and AI Muse.</p></div>
              <div className="mv-card p-4"><Layers className="size-4 text-champagne" /><p className="mt-2 font-medium">Atelier</p><p className="text-xs text-mute">Panels, collars, cuffs, layers.</p></div>
              <div className="mv-card p-4"><Ruler className="size-4 text-champagne" /><p className="mt-2 font-medium">Atelier Pro</p><p className="text-xs text-mute">Measurements, tech pack, BOM.</p></div>
            </div>
          </div>
        </div>
      </div>
      <section className="mt-12">
        <h2 className="mv-display text-3xl">Garment measurements</h2>
        <p className="mt-1 text-sm text-mute">Parametric estimates in cm for the default configuration — a manufacturer&apos;s graded chart replaces these before production.</p>
        <div className="mt-4 overflow-x-auto mv-scroll">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-mute"><tr>{["Size", "Chest", "Length", "Shoulder", "Sleeve", "Bicep", "Hem"].map((h) => <th key={h} className="border-b border-line py-2 pr-4 font-normal">{h}</th>)}</tr></thead>
            <tbody>
              {chart.map(({ size, m }) => (
                <tr key={size} className="border-b border-line/60"><td className="py-2 pr-4">{size}</td><td className="pr-4 tabular-nums">{m.chest}</td><td className="pr-4 tabular-nums">{m.bodyLength}</td><td className="pr-4 tabular-nums">{m.shoulderWidth}</td><td className="pr-4 tabular-nums">{m.sleeveLength}</td><td className="pr-4 tabular-nums">{m.bicep}</td><td className="pr-4 tabular-nums">{m.hem}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-mute">3D geometry: {model.geometry.notes} ({model.geometry.completeness}).</p>
      </section>
    </div>
  );
}
