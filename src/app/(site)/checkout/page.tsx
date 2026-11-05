import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getCart } from "@/lib/services/commerce";
import { listAddresses } from "@/lib/services/account";
import { getActiveIntegration } from "@/lib/integrations/config";
import { CheckoutView } from "@/components/commerce/CheckoutView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Checkout" };

export default async function CheckoutPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/checkout");
  const [cart, addresses, razorpay] = await Promise.all([getCart(user), listAddresses(user), getActiveIntegration("razorpay")]);
  if (!cart.lines.length) redirect("/cart");
  return <div className="mx-auto max-w-5xl px-4 py-10 md:px-6"><CheckoutView total={cart.total} subtotal={cart.subtotal} gst={cart.gst} shipping={cart.shipping} count={cart.lines.reduce((a, l) => a + l.quantity, 0)} addresses={JSON.parse(JSON.stringify(addresses))} provider={razorpay ? `razorpay-${razorpay.environment}` : "simulated"} user={{ name: user.name, email: user.email }} /></div>;
}
