import { z } from "zod";
import { route } from "@/lib/api/handler";
import { generateArtwork, imageProviderStatus } from "@/lib/ai/image";

export const GET = route({}, async () => imageProviderStatus());
const schema = z.object({ prompt: z.string().trim().min(3).max(400), count: z.number().int().min(1).max(2).default(1) });
export const POST = route({ auth: "user", rate: { name: "gen-image", limit: 20, windowMs: 3600_000, by: "user" } }, async ({ user, body }) => {
  const input = await body(schema);
  return generateArtwork(user, input.prompt, input.count);
});
