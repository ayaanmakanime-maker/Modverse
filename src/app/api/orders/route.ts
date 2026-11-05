import { route } from "@/lib/api/handler";
import { listOrders } from "@/lib/services/commerce";

export const GET = route({ auth: "user" }, async ({ user }) => ({ orders: await listOrders(user) }));
