import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { getCart } from "@/lib/services/commerce";
import { CartView } from "@/components/commerce/CartView";
import { EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cart" };

export default async function CartPage() {
  const user = await getCurrentUser();
  if (!user) return <div className="mx-auto max-w-3xl px-4 py-16"><EmptyState title="Sign in to see your cart" action={<Link className="mv-btn mv-btn-primary" href="/login?next=/cart">Sign in</Link>}>Your cart holds your own saved designs — sign in to continue.</EmptyState></div>;
  const cart = await getCart(user);
  return <div className="mx-auto max-w-5xl px-4 py-10 md:px-6"><CartView initial={JSON.parse(JSON.stringify(cart))} /></div>;
}
