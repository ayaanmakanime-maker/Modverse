import { route } from "@/lib/api/handler";
import { getPuterConfig, puterUsage } from "@/lib/ai/puter-server";

export const GET = route({ auth: "admin" }, async () => ({ config: await getPuterConfig(), usage: await puterUsage() }));
