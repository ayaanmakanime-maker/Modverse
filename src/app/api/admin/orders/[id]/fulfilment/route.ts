import { z } from "zod";
import { route } from "@/lib/api/handler";
import { adminOrderPartners, assignManufacturer, createShipment } from "@/lib/services/partners";
import { courierStatus } from "@/lib/services/courier";

const view = async (id: string) => ({ ...(await adminOrderPartners(id)), courier: await courierStatus() });

export const GET = route<{ id: string }>({ auth: "staff" }, async ({ params }) => view(params.id));

const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assign"), organizationId: z.string().uuid(), force: z.boolean().default(false), dueAt: z.coerce.date().optional() }),
  z.object({ action: z.literal("shipment"), shipment: z.unknown() }),
]);
export const POST = route<{ id: string }>({ auth: "staff" }, async ({ user, params, body }) => {
  const a = await body(action);
  if (a.action === "assign") await assignManufacturer(user, params.id, a.organizationId, { force: a.force, dueAt: a.dueAt ?? null });
  else await createShipment(user, params.id, a.shipment);
  return view(params.id);
});
