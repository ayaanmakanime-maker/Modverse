import { route } from "@/lib/api/handler";
import { cancelGeneration } from "@/lib/services/muse";

export const POST = route<{ id: string }>({ auth: "user" }, async ({ user, params }) => ({ generation: await cancelGeneration(user, params.id) }));
