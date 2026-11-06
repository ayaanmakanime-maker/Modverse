import { z } from "zod";
import { route } from "@/lib/api/handler";
import { listOrganizations } from "@/lib/services/partners";

const q = z.object({ type: z.enum(["manufacturer", "logistics"]).optional(), status: z.enum(["pending", "approved", "rejected", "suspended"]).optional() });
export const GET = route({ auth: "staff" }, async ({ query }) => ({ organizations: await listOrganizations(query(q)) }));
