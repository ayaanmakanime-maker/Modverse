import { route } from "@/lib/api/handler";
import { cancelOrder } from "@/lib/services/commerce";

export const POST = route<{ id: string }>({ auth: "user" }, async ({ user, params }) => cancelOrder(user, params.id));
