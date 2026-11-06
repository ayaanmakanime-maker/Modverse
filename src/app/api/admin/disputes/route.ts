import { z } from "zod";
import { route } from "@/lib/api/handler";
import { listDisputes } from "@/lib/services/partners";

const q = z.object({ status: z.enum(["open", "investigating", "resolved", "rejected"]).optional() });
export const GET = route({ auth: "staff" }, async ({ query }) => ({ disputes: await listDisputes(query(q)) }));
