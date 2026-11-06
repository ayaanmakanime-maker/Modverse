import { ApiError, route } from "@/lib/api/handler";
import { getMyShipment } from "@/lib/services/partners";
import { renderShippingLabel } from "@/lib/shipping-label-pdf";

export const GET = route<{ id: string }>({ auth: "user" }, async ({ user, params }) => {
  const v = await getMyShipment(user, params.id);
  if (!v.shipment.awb) throw new ApiError(409, "no_label", "Generate the label first");
  const pdf = await renderShippingLabel({
    awb: v.shipment.awb, courier: v.shipment.courier ?? "Courier", orderNumber: v.orderNumber, direction: v.shipment.direction, weightGrams: v.shipment.weightGrams ?? 400, units: v.units, cod: v.codAmount,
    to: v.drop as unknown as Record<string, string>, from: (({ name, city, state }) => ({ name: String(name ?? ""), city, state }))(v.pickup as { name?: string; city?: string | null; state?: string | null }), partner: v.organization.name,
  });
  return new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="label-${v.shipment.awb}.pdf"`, "Cache-Control": "private, no-store" } });
});
