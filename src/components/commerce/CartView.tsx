"use client";
import Link from "next/link";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { api, errorMessage } from "@/lib/client/api";
import { formatINR, type PriceLine } from "@/lib/garment/pricing";
import { DesignFlat } from "@/components/garment/DesignFlat";
import type { DesignConfig } from "@/lib/garment/schema";
import { useSession } from "@/components/session";
import { Badge, Button, EmptyState, Select, toast } from "@/components/ui";
import { MtoThumb } from "./MtoLine";

interface Line { id: string; kind?: "design" | "library"; library?: { garment: { id: string } } | null; projectId: string | null; name: string; version: number; size: string; quantity: number; sizes: string[]; unitPrice: number; unitGst: number; lineTotal: number; summary: string; validationStatus: string; config: DesignConfig | null; priceLines?: PriceLine[]; priceChanged?: boolean }
interface Cart { lines: Line[]; subtotal: number; discount?: number; discountCode?: string | null; discountError?: string | null; gst: number; shipping: number; total: number; illustrative?: boolean; shippingRule?: { flatRate: number; freeAbove: number } }

export function CartView({ initial }: { initial: Cart }) {
  const [cart, setCart] = useState(initial);
  const [code, setCode] = useState("");
  const { setCartCount } = useSession();
  const update = async (fn: () => Promise<{ cart: Cart }>) => {
    try {
      const r = await fn();
      setCart(r.cart);
      setCartCount(r.cart.lines.reduce((a, l) => a + l.quantity, 0));
    } catch (e) {
      toast(errorMessage(e), "bad");
    }
  };
  if (!cart.lines.length) return <EmptyState title="Your cart is empty" action={<Link href="/design/new" className="mv-btn mv-btn-primary">Start designing</Link>}>Save a design in the studio, then add it to your cart.</EmptyState>;
  return (
    <div className="grid gap-8 lg:grid-cols-[1.5fr_1fr]" data-testid="cart">
      <div className="space-y-3">
        <h1 className="mv-display text-4xl">Cart</h1>
        {cart.lines.map((l) => (
          <div key={l.id} className="mv-card flex gap-4 p-3">
            {l.kind === "library" && l.library
              ? <Link href={`/collection/${l.library.garment.id}`} className="w-24"><MtoThumb snapshot={l.library} className="h-24 w-24" /></Link>
              : <Link href={`/design/${l.projectId}`} className="flex w-24 shrink-0 items-center justify-center rounded-lg bg-surface-2">{l.config && <DesignFlat config={l.config} view="front" className="h-24 w-full" />}</Link>}
            <div className="min-w-0 flex-1 space-y-1" data-testid={l.kind === "library" ? "cart-line-mto" : "cart-line"}>
              <p className="font-medium">{l.name} {l.kind === "library" ? <Badge>made to order</Badge> : <span className="text-xs text-mute">v{l.version}</span>}</p>
              <p className="text-xs text-mute">{l.summary}</p>
              {l.validationStatus === "warnings" && <Badge tone="warn">production warnings — studio review</Badge>}
              {l.kind === "library" && l.validationStatus === "fail" && <Badge tone="bad">no longer manufacturable — remove and customise again</Badge>}
              {l.priceChanged && <Badge tone="info">price updated to current rates</Badge>}
              {l.priceLines && (
                <details className="text-[0.68rem]"><summary className="cursor-pointer text-bone-2">Price breakdown</summary>
                  <ul className="mt-1">{l.priceLines.map((p, i) => <li key={i} className="flex justify-between gap-2 text-mute"><span>{p.label}{p.detail ? ` · ${p.detail}` : ""}</span><span className="tabular-nums">{formatINR(p.amount)}</span></li>)}</ul>
                </details>
              )}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Select aria-label="Size" value={l.size} onChange={(e) => update(() => api(`/api/cart/${l.id}`, { method: "PATCH", body: { size: e.target.value } }))} className="!w-24 !py-1 !text-xs">{l.sizes.map((s) => <option key={s} value={s}>{s}</option>)}</Select>
                <Select aria-label="Quantity" value={l.quantity} onChange={(e) => update(() => api(`/api/cart/${l.id}`, { method: "PATCH", body: { quantity: Number(e.target.value) } }))} className="!w-20 !py-1 !text-xs">{Array.from({ length: 10 }).map((_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</Select>
                <button className="text-mute hover:text-bad" aria-label="Remove" onClick={() => update(() => api(`/api/cart/${l.id}`, { method: "DELETE" }))}><Trash2 className="size-4" /></button>
              </div>
            </div>
            <p className="tabular-nums">{formatINR(l.lineTotal)}</p>
          </div>
        ))}
      </div>
      <aside className="mv-card h-fit space-y-2 p-5 text-sm">
        <p className="flex justify-between text-mute"><span>Subtotal</span><span>{formatINR(cart.subtotal)}</span></p>
        {!!cart.discount && <p className="flex justify-between text-ok" data-testid="cart-discount"><span>Discount {cart.discountCode}</span><span>−{formatINR(cart.discount)}</span></p>}
        <p className="flex justify-between text-mute"><span>GST (estimate)</span><span>{formatINR(cart.gst)}</span></p>
        <p className="flex justify-between text-mute"><span>Shipping (local estimate)</span><span>{cart.shipping ? formatINR(cart.shipping) : "Free"}</span></p>
        {cart.shippingRule && cart.shipping > 0 && <p className="text-[0.68rem] text-mute">Free shipping above {formatINR(cart.shippingRule.freeAbove)}.</p>}
        <p className="flex justify-between border-t border-line pt-2 text-lg"><span>Total</span><span data-testid="cart-total">{formatINR(cart.total)}</span></p>
        {cart.discountError && <p className="text-xs text-bad">{cart.discountError}</p>}
        {cart.discountCode ? (
          <button className="text-xs text-mute underline" onClick={() => update(() => api("/api/cart/discount", { method: "DELETE" }))}>Remove code {cart.discountCode}</button>
        ) : (
          <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); if (code.trim()) update(() => api("/api/cart/discount", { body: { code } })).then(() => setCode("")); }}>
            <input className="mv-input !py-1.5 !text-xs" placeholder="Discount code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} aria-label="Discount code" data-testid="discount-input" />
            <Button size="sm" variant="ghost" type="submit" data-testid="discount-apply">Apply</Button>
          </form>
        )}
        {cart.illustrative && <p className="text-[0.68rem] text-warn">Illustrative pricing — estimates until verified supplier rates are connected.</p>}
        <p className="text-xs text-mute">Prices are recalculated securely at checkout. Every design is reviewed by the studio before production.</p>
        <Link href="/checkout" className="mv-btn mv-btn-primary w-full" data-testid="checkout-link">Checkout</Link>
      </aside>
    </div>
  );
}
