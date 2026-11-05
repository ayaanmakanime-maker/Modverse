import Link from "next/link";
import { requirePageUser } from "@/lib/auth/session";
import { listOrders } from "@/lib/services/commerce";
import { formatINR } from "@/lib/garment/pricing";
import { Badge, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Orders" };

export default async function Page() {
  const user = await requirePageUser("/account/orders");
  const orders = await listOrders(user);
  if (!orders.length) return <EmptyState title="No orders yet" action={<Link href="/design/new" className="mv-btn mv-btn-primary">Design something</Link>} />;
  return (
    <div className="space-y-2">
      <h1 className="mv-display text-3xl">Orders</h1>
      {orders.map((o) => (
        <Link key={o.id} href={`/account/orders/${o.id}`} className="mv-card flex items-center justify-between p-4 hover:border-line-2">
          <span><span className="block font-mono">{o.orderNumber}</span><span className="text-xs text-mute">{new Date(o.createdAt).toLocaleString("en-IN")} · {formatINR(o.total)}</span></span>
          <span className="flex gap-1">{o.isSimulated && <Badge tone="warn">simulated payment</Badge>}<Badge>{o.status.replace(/_/g, " ")}</Badge></span>
        </Link>
      ))}
    </div>
  );
}
