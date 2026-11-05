import { route } from "@/lib/api/handler";
import { getOrder } from "@/lib/services/commerce";

export const GET = route<{ id: string }>({ auth: "user" }, async ({ user, params }) => getOrder(user, params.id));
