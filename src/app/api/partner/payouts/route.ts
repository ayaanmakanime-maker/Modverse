import { route } from "@/lib/api/handler";
import { listMySettlements } from "@/lib/services/settlements";

/** The caller organisation's payouts only. */
export const GET = route({ auth: "user" }, async ({ user }) => listMySettlements(user));
