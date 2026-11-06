import { route } from "@/lib/api/handler";
import { productionBoard } from "@/lib/services/partners";

export const GET = route({ auth: "staff" }, async () => ({ jobs: await productionBoard() }));
