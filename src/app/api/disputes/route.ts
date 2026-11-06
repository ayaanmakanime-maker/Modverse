import { z } from "zod";
import { route } from "@/lib/api/handler";
import { myDisputes, raiseDispute } from "@/lib/services/partners";

const q = z.object({ orderId: z.string().uuid() });
export const GET = route({ auth: "user" }, async ({ user, query }) => ({ disputes: await myDisputes(user, query(q).orderId) }));
export const POST = route({ auth: "user", rate: { name: "dispute", limit: 10, windowMs: 60 * 60_000, by: "user" } }, async ({ user, body }) => ({ dispute: await raiseDispute(user, await body(z.unknown())) }));
