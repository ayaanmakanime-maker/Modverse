"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorMessage } from "@/lib/client/api";
import { formatINR } from "@/lib/garment/pricing";
import { useSession } from "@/components/session";
import { AddressForm, EMPTY_ADDRESS } from "@/components/account/Managers";
import { Button, Notice, toast } from "@/components/ui";

declare global {
  interface Window { Razorpay?: new (opts: Record<string, unknown>) => { open(): void } }
}

function loadRazorpay(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

export function CheckoutView({ total, subtotal, gst, shipping, count, addresses, provider, user, discount = 0, discountCode = null }: { total: number; subtotal: number; gst: number; shipping: number; count: number; discount?: number; discountCode?: string | null; addresses: { id: string; label: string; fullName: string; line1: string; city: string; pincode: string; isDefault: boolean }[]; provider: string; user: { name: string; email: string } }) {
  const router = useRouter();
  const { setCartCount } = useSession();
  const [addressId, setAddressId] = useState(addresses.find((a) => a.isDefault)?.id ?? addresses[0]?.id ?? "");
  const [form, setForm] = useState({ ...EMPTY_ADDRESS, fullName: user.name });
  const [busy, setBusy] = useState(false);
  async function place() {
    setBusy(true);
    try {
      // The server recomputes everything; sending what the customer saw lets it refuse silently-changed totals.
      const body = addressId ? { addressId, expectedTotal: total } : { expectedTotal: total, address: { fullName: form.fullName, phone: form.phone, line1: form.line1, line2: form.line2 || undefined, city: form.city, state: form.state, pincode: form.pincode } };
      const r = await api<{ order: { id: string }; provider: string; razorpayOrder: { id: string; keyId: string; amount: number } | null }>("/api/checkout", { body });
      setCartCount(0);
      if (r.provider === "razorpay" && r.razorpayOrder) {
        if (!(await loadRazorpay())) throw new Error("Could not load Razorpay Checkout. Your order is saved as pending payment.");
        const rz = new window.Razorpay!({
          key: r.razorpayOrder.keyId, amount: r.razorpayOrder.amount, currency: "INR", order_id: r.razorpayOrder.id, name: "ModVerse", description: "Custom garment order", prefill: { name: user.name, email: user.email },
          handler: async (resp: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
            await api(`/api/orders/${r.order.id}/pay`, { body: { method: "razorpay", ...resp } });
            router.push(`/orders/${r.order.id}`);
          },
          modal: { ondismiss: () => router.push(`/orders/${r.order.id}`) },
        });
        rz.open();
        return;
      }
      router.push(`/orders/${r.order.id}`);
    } catch (e) {
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-8 lg:grid-cols-[1.5fr_1fr]" data-testid="checkout">
      <div className="space-y-4">
        <h1 className="mv-display text-4xl">Checkout</h1>
        <div className="mv-card space-y-3 p-4">
          <p className="font-medium">Shipping address</p>
          {addresses.map((a) => (
            <label key={a.id} className="flex items-start gap-2 text-sm"><input type="radio" name="addr" checked={addressId === a.id} onChange={() => setAddressId(a.id)} className="mt-1" /> <span>{a.label} — {a.fullName}, {a.line1}, {a.city} {a.pincode}</span></label>
          ))}
          {addresses.length > 0 && <label className="flex items-center gap-2 text-sm"><input type="radio" name="addr" checked={!addressId} onChange={() => setAddressId("")} /> Use a new address</label>}
          {!addressId && <AddressForm value={form} onChange={setForm} />}
        </div>
        {provider === "simulated" ? (
          <Notice tone="warn" title="Simulated payment (local test mode)">No payment provider is configured. You&apos;ll confirm a clearly-labelled simulated payment on the next screen — no money moves. Admins can connect Razorpay (test mode first) in the Integration Manager.</Notice>
        ) : (
          <Notice tone="info" title={`Razorpay (${provider.endsWith("live") ? "LIVE" : "test mode"})`}>UPI, cards and net banking via Razorpay. Your order is only marked paid after server-side signature verification.</Notice>
        )}
      </div>
      <aside className="mv-card h-fit space-y-2 p-5 text-sm">
        <p className="text-mute">{count} item(s)</p>
        <p className="flex justify-between text-mute"><span>Subtotal</span><span>{formatINR(subtotal)}</span></p>
        {discount > 0 && <p className="flex justify-between text-ok"><span>Discount {discountCode}</span><span>−{formatINR(discount)}</span></p>}
        <p className="flex justify-between text-mute"><span>GST (estimate)</span><span>{formatINR(gst)}</span></p>
        <p className="flex justify-between text-mute"><span>Shipping</span><span>{shipping ? formatINR(shipping) : "Free"}</span></p>
        <p className="flex justify-between border-t border-line pt-2 text-lg"><span>Total</span><span>{formatINR(total)}</span></p>
        <Button className="w-full" loading={busy} onClick={place} data-testid="place-order">Place order</Button>
      </aside>
    </div>
  );
}
