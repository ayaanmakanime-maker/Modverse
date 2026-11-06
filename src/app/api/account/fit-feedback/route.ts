import { z } from "zod";
import { route } from "@/lib/api/handler";
import { fitFeedbackSchema, listFitFeedback, submitFitFeedback } from "@/lib/services/account";

/** "Verified fit": customers record how a delivered garment actually fitted. */
export const GET = route({ auth: "user" }, async ({ user, query }) => {
  const q = query(z.object({ modelId: z.string().max(64).optional() }));
  return { feedback: await listFitFeedback(user, q.modelId) };
});

export const POST = route({ auth: "user" }, async ({ user, body }) => ({ feedback: await submitFitFeedback(user, await body(fitFeedbackSchema)) }));
