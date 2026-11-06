import { z } from "zod";
import { route } from "@/lib/api/handler";
import { STAGES, getMyJob, markReadyToDispatch, postStage, reportIssue, resolveIssue, respondToJob, submitQc, submitQuotation } from "@/lib/services/partners";
import { LIMITS } from "@/lib/security/rate-limit";

export const GET = route<{ id: string }>({ auth: "user" }, async ({ user, params }) => getMyJob(user, params.id));

const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept") }),
  z.object({ action: z.literal("reject"), reason: z.string().trim().min(3).max(300) }),
  z.object({ action: z.literal("quote"), quotation: z.unknown() }),
  z.object({ action: z.literal("stage"), stage: z.enum(STAGES), note: z.string().trim().max(300).optional() }),
  z.object({ action: z.literal("issue"), issue: z.unknown() }),
  z.object({ action: z.literal("resolve_issue"), issueId: z.string().uuid(), note: z.string().trim().max(300).default("") }),
  z.object({ action: z.literal("qc"), report: z.unknown() }),
  z.object({ action: z.literal("ready") }),
]);

/** Manufacturer actions on its own job — every call is scoped to the caller's organisation. */
export const POST = route<{ id: string }>({ auth: "user", rate: { name: "partner-write", ...LIMITS.write, by: "user" } }, async ({ user, params, body }) => {
  const a = await body(action);
  switch (a.action) {
    case "accept": await respondToJob(user, params.id, "accept"); break;
    case "reject": await respondToJob(user, params.id, "reject", a.reason); break;
    case "quote": await submitQuotation(user, params.id, a.quotation); break;
    case "stage": await postStage(user, params.id, a.stage, a.note); break;
    case "issue": await reportIssue(user, params.id, a.issue); break;
    case "resolve_issue": await resolveIssue(user, params.id, a.issueId, a.note); break;
    case "qc": await submitQc(user, params.id, a.report); break;
    case "ready": await markReadyToDispatch(user, params.id); break;
  }
  return getMyJob(user, params.id);
});
