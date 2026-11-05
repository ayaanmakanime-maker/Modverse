import { z } from "zod";
import { route, ApiError, notFound } from "@/lib/api/handler";
import { INTEGRATION_BY_ID } from "@/lib/integrations/registry";
import { clearCredentials, loadCredentials, recordTest, saveCredentials, setEnabled } from "@/lib/integrations/config";
import { testIntegration } from "@/lib/integrations/tests";
import { LIMITS } from "@/lib/security/rate-limit";
import { audit } from "@/lib/audit";

function def(id: string) {
  const d = INTEGRATION_BY_ID.get(id);
  if (!d) throw notFound("Integration");
  return d;
}

/** Save credentials (encrypted at rest). Saving always resets the provider to untested + disabled. */
const save = z.object({ values: z.record(z.string(), z.string().max(20000)) });
export const PUT = route<{ id: string }>({ auth: "admin" }, async ({ user, params, body, ipHash }) => {
  const d = def(params.id);
  const { values } = await body(save);
  try {
    await saveCredentials(d.id, values, user.id);
  } catch (e) {
    throw new ApiError(400, "invalid_credentials", e instanceof Error ? e.message : "Invalid credentials");
  }
  await audit({ actorUserId: user.id, action: "integration.credentials_saved", entityType: "integration", entityId: d.id, details: { fields: Object.keys(values) }, ipHash });
  return { ok: true };
});

/** Run a real connection test (read-only, no charges). */
export const POST = route<{ id: string }>({ auth: "admin", rate: { name: "integration-test", ...LIMITS.integrationTest } }, async ({ user, params, ipHash }) => {
  const d = def(params.id);
  const { creds } = await loadCredentials(d.id);
  if (!creds) throw new ApiError(400, "not_configured", "Enter credentials before testing");
  if (!d.testable) {
    await recordTest(d.id, false, "No automated connection test is implemented for this provider yet.");
    return { ok: false, message: "No automated connection test is implemented for this provider yet; it stays disabled." };
  }
  const r = await testIntegration(d.id, creds);
  await recordTest(d.id, r.ok, r.ok ? null : r.message);
  await audit({ actorUserId: user.id, action: "integration.tested", entityType: "integration", entityId: d.id, details: { ok: r.ok }, ipHash });
  return r;
});

const toggle = z.object({ enabled: z.boolean(), environment: z.enum(["test", "live"]), confirmBillable: z.boolean().optional(), confirmLive: z.boolean().optional() });
export const PATCH = route<{ id: string }>({ auth: "admin" }, async ({ user, params, body, ipHash }) => {
  const d = def(params.id);
  const input = await body(toggle);
  if (input.enabled && d.billable && !input.confirmBillable) throw new ApiError(400, "confirm_billable", `${d.name} is a billable service. Confirm that you accept its charges before enabling.`);
  if (input.enabled && input.environment === "live" && !input.confirmLive) throw new ApiError(400, "confirm_live", "Switching to LIVE mode requires explicit confirmation.");
  try {
    const status = await setEnabled(d.id, input.enabled, input.environment, user.id);
    await audit({ actorUserId: user.id, action: input.enabled ? "integration.enabled" : "integration.disabled", entityType: "integration", entityId: d.id, details: { environment: input.environment }, ipHash });
    return { status };
  } catch (e) {
    throw new ApiError(409, "cannot_enable", e instanceof Error ? e.message : "Cannot change provider state");
  }
});

export const DELETE = route<{ id: string }>({ auth: "admin" }, async ({ user, params, ipHash }) => {
  const d = def(params.id);
  await clearCredentials(d.id, user.id);
  await audit({ actorUserId: user.id, action: "integration.credentials_cleared", entityType: "integration", entityId: d.id, ipHash });
  return { ok: true };
});
