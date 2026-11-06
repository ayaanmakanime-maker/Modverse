import { ManufacturerJob } from "@/components/partners/PartnerPortal";

export const metadata = { title: "Production job" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ManufacturerJob id={id} />;
}
