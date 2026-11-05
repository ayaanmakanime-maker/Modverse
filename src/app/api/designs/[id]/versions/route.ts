import { route } from "@/lib/api/handler";
import { listVersions } from "@/lib/services/designs";

export const GET = route<{ id: string }>({ auth: "user" }, async ({ user, params }) => ({ versions: await listVersions(user, params.id) }));
