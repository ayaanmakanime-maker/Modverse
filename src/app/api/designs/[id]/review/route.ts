import { route } from "@/lib/api/handler";
import { requestReview } from "@/lib/services/designs";

export const POST = route<{ id: string }>({ auth: "user" }, async ({ user, params }) => ({ design: await requestReview(user, params.id) }));
