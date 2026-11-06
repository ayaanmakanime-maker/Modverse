import { route } from "@/lib/api/handler";
import { listMyJobs } from "@/lib/services/partners";

export const GET = route({ auth: "user" }, async ({ user }) => ({ jobs: await listMyJobs(user) }));
