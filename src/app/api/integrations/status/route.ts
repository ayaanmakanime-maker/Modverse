import { route } from "@/lib/api/handler";
import { getActiveIntegration } from "@/lib/integrations/config";

/** Public, non-sensitive view of which optional providers are active (e.g. to show/hide social login). */
export const GET = route({}, async () => {
  const ids = ["google-oauth", "apple-signin", "razorpay", "ollama", "openai", "comfyui", "resend", "shiprocket"];
  const out: Record<string, boolean> = {};
  for (const id of ids) out[id] = !!(await getActiveIntegration(id));
  return { active: out };
});
