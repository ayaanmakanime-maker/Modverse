import { route } from "@/lib/api/handler";
import { listMyShipments } from "@/lib/services/partners";

export const GET = route({ auth: "user" }, async ({ user }) => ({ shipments: await listMyShipments(user) }));
