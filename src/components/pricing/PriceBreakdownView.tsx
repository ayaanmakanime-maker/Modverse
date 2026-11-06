"use client";
import { formatINR, type PriceBreakdown, type PriceCategory } from "@/lib/garment/pricing";

const CAT_LABEL: Record<PriceCategory, string> = { base: "Base garment", material: "Material", construction: "Construction", decoration: "Decoration" };

/** Itemised price: base, material, construction, decoration → GST → unit total. */
export function PriceBreakdownView({ price, compact }: { price: PriceBreakdown; compact?: boolean }) {
  const cats = (Object.keys(CAT_LABEL) as PriceCategory[]).filter((c) => price.lines.some((l) => l.category === c));
  return (
    <div className="space-y-2 text-xs" data-testid="price-breakdown">
      {price.illustrative && <p className="rounded-md bg-warn/10 px-2 py-1 text-[0.65rem] text-warn">Illustrative pricing — estimates until verified supplier rates are connected.</p>}
      {cats.map((c) => (
        <div key={c}>
          <p className="flex justify-between text-[0.62rem] uppercase tracking-wider text-champagne"><span>{CAT_LABEL[c]}</span><span className="tabular-nums">{formatINR(price.categories[c])}</span></p>
          <ul>
            {price.lines.filter((l) => l.category === c).map((l, i) => (
              <li key={i} className="flex justify-between gap-2 border-b border-line/40 py-0.5">
                <span className="min-w-0 text-bone-2">{l.label}{!compact && l.detail && <span className="block text-[0.6rem] text-mute">{l.detail}</span>}</span>
                <span className="shrink-0 tabular-nums">{formatINR(l.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="flex justify-between"><span className="text-mute">Unit price</span><span className="tabular-nums">{formatINR(price.unitPrice)}</span></p>
      <p className="flex justify-between"><span className="text-mute">GST {Math.round(price.gstRate * 100)}% (estimate)</span><span className="tabular-nums">{formatINR(price.gst)}</span></p>
      <p className="flex justify-between font-medium"><span>Total per unit</span><span className="tabular-nums" data-testid="price-total">{formatINR(price.unitTotal)}</span></p>
      {!compact && <p className="text-[0.6rem] text-mute">Moving artwork doesn&apos;t change the price; size, colours, stitches, placements and construction do. Shipping and discounts are applied in the cart.</p>}
    </div>
  );
}
