import { z } from "zod";
import { route } from "@/lib/api/handler";
import { reassignShipment } from "@/lib/services/partners";

export const PATCH = route<{ id: string }>({ auth: "staff" }, async ({ user, params, body }) => ({ shipment: await reassignShipment(user, params.id, await body(z.unknown())) }));
