import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth/session";
import { getOrder } from "@/lib/services/commerce";
import { OrderDetail } from "@/components/commerce/OrderDetail";
import { orderFulfilment } from "@/lib/services/partners";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePageUser("/account/orders");
  const data = await getOrder(user, id).catch(() => null);
  if (!data || data.order.userId !== user.id) notFound();
  return <OrderDetail data={JSON.parse(JSON.stringify({ ...data, fulfilment: await orderFulfilment(data.order.id) }))} />;
}
