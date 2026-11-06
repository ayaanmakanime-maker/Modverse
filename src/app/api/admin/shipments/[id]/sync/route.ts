import { route } from "@/lib/api/handler";
import { syncCourierTracking } from "@/lib/services/courier";

export const POST = route<{ id: string }>({ auth: "staff", rate: { name: "courier-sync", limit: 60, windowMs: 60 * 60_000, by: "user" } }, async ({ user, params }) => syncCourierTracking(user, params.id));
