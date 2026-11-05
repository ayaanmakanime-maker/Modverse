import { route } from "@/lib/api/handler";
import { listIntegrations } from "@/lib/integrations/config";

export const GET = route({ auth: "admin" }, async () => ({ integrations: await listIntegrations() }));
