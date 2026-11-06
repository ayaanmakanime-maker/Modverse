import { z } from "zod";
import { route } from "@/lib/api/handler";
import { addTrackingEvent, generateLabel, getMyShipment } from "@/lib/services/partners";
import { LIMITS } from "@/lib/security/rate-limit";

export const GET = route<{ id: string }>({ auth: "user" }, async ({ user, params }) => getMyShipment(user, params.id));

const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("label") }),
  z.object({ action: z.literal("track"), event: z.unknown() }),
]);

/** Logistics actions on the caller organisation's own shipment. */
export const POST = route<{ id: string }>({ auth: "user", rate: { name: "partner-write", ...LIMITS.write, by: "user" } }, async ({ user, params, body }) => {
  const a = await body(action);
  if (a.action === "label") await generateLabel(user, params.id);
  else await addTrackingEvent(user, params.id, a.event);
  return getMyShipment(user, params.id);
});
