import { route } from "@/lib/api/handler";
import { museModels } from "@/lib/services/muse";

/** Models, capabilities and availability for the studio (no server URLs or credentials). */
export const GET = route({ auth: "user" }, async () => museModels());
