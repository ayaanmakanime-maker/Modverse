import { z } from "zod";
import { route } from "@/lib/api/handler";
import { designConfigSchema } from "@/lib/garment/schema";
import { validateDesign } from "@/lib/garment/validation";
import { bodySchema } from "@/lib/services/account";
import { validationContext } from "@/lib/services/designs";

const schema = z.object({ config: designConfigSchema, body: bodySchema.partial().optional() });
export const POST = route({ rate: { name: "validate", limit: 120, windowMs: 60_000 } }, async ({ body }) => {
  const input = await body(schema);
  return { report: validateDesign(input.config, validationContext(input.config, input.body as Record<string, number> | undefined)) };
});
