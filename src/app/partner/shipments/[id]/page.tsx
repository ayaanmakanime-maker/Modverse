import { LogisticsShipment } from "@/components/partners/PartnerPortal";

export const metadata = { title: "Shipment" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LogisticsShipment id={id} />;
}
