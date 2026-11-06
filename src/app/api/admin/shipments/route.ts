import { route } from "@/lib/api/handler";
import { listAllShipments } from "@/lib/services/partners";

export const GET = route({ auth: "staff" }, async () => ({ shipments: await listAllShipments() }));
