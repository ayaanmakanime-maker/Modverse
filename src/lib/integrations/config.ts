import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { integrationConfigs } from "../db/schema";
import { decryptJson, encryptJson, maskSecret } from "../security/secrets";
import { INTEGRATION_BY_ID, INTEGRATIONS, type IntegrationDef } from "./registry";

export type IntegrationStatus = "not_configured" | "test" | "live" | "disabled" | "error";

export interface IntegrationView {
  def: IntegrationDef;
  status: IntegrationStatus;
  environment: "test" | "live";
  enabled: boolean;
  hasCredentials: boolean;
  credentialSource: "database" | "environment" | "none";
  maskedCredentials: Record<string, string>;
  publicConfig: Record<string, unknown>;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  lastError: string | null;
}

/** Credentials from env vars (e.g. RAZORPAY_KEY_SECRET) — used only to pre-fill, never to auto-activate. */
function envCredentials(def: IntegrationDef): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const f of def.fields) {
    const name = `${def.envPrefix}_${f.key.replace(/([A-Z])/g, "_$1").toUpperCase()}`;
    const v = process.env[name];
    if (v) out[f.key] = v;
  }
  return def.fields.filter((f) => f.required).every((f) => out[f.key]) ? out : null;
}

export async function loadCredentials(id: string): Promise<{ creds: Record<string, string> | null; source: IntegrationView["credentialSource"] }> {
  const def = INTEGRATION_BY_ID.get(id);
  if (!def) return { creds: null, source: "none" };
  const db = await getDb();
  const [row] = await db.select().from(integrationConfigs).where(eq(integrationConfigs.providerId, id));
  if (row?.credentialsEncrypted) {
    try {
      return { creds: decryptJson<Record<string, string>>(row.credentialsEncrypted), source: "database" };
    } catch {
      return { creds: null, source: "none" };
    }
  }
  const env = envCredentials(def);
  return env ? { creds: env, source: "environment" } : { creds: null, source: "none" };
}

export async function listIntegrations(): Promise<IntegrationView[]> {
  const db = await getDb();
  const rows = await db.select().from(integrationConfigs);
  const byId = new Map(rows.map((r) => [r.providerId, r]));
  const out: IntegrationView[] = [];
  for (const def of INTEGRATIONS) {
    const r = byId.get(def.id);
    const { creds, source } = await loadCredentials(def.id);
    const masked: Record<string, string> = {};
    for (const f of def.fields) if (creds?.[f.key]) masked[f.key] = f.secret ? maskSecret(creds[f.key]) : creds[f.key];
    out.push({
      def,
      status: (r?.status as IntegrationStatus) ?? "not_configured",
      environment: r?.environment ?? "test",
      enabled: r?.enabled ?? false,
      hasCredentials: !!creds,
      credentialSource: source,
      maskedCredentials: masked,
      publicConfig: (r?.publicConfig as Record<string, unknown>) ?? {},
      lastTestedAt: r?.lastTestedAt?.toISOString() ?? null,
      lastTestOk: r?.lastTestOk ?? null,
      lastError: r?.lastError ?? null,
    });
  }
  return out;
}

/** Returns credentials only for an enabled provider whose last connection test passed. */
export async function getActiveIntegration(id: string): Promise<{ credentials: Record<string, string>; environment: "test" | "live" } | null> {
  try {
    const db = await getDb();
    const [row] = await db.select().from(integrationConfigs).where(eq(integrationConfigs.providerId, id));
    if (!row || !row.enabled || !(row.status === "test" || row.status === "live") || row.lastTestOk !== true) return null;
    const { creds } = await loadCredentials(id);
    return creds ? { credentials: creds, environment: row.environment } : null;
  } catch {
    return null;
  }
}

export async function saveCredentials(id: string, values: Record<string, string>, actorId: string): Promise<void> {
  const def = INTEGRATION_BY_ID.get(id);
  if (!def) throw new Error("Unknown integration");
  const existing = (await loadCredentials(id)).creds ?? {};
  const merged: Record<string, string> = {};
  for (const f of def.fields) {
    const v = values[f.key];
    // Blank secret fields keep the stored value (secrets are never sent back to the browser).
    const val = v === undefined || (v === "" && f.secret) ? existing[f.key] : v.trim();
    if (f.required && !val) throw new Error(`${f.label} is required`);
    if (val && f.pattern && !new RegExp(f.pattern).test(val)) throw new Error(`${f.label} has an invalid format`);
    if (val) merged[f.key] = val;
  }
  const db = await getDb();
  await db
    .insert(integrationConfigs)
    .values({ providerId: id, credentialsEncrypted: encryptJson(merged), status: "not_configured", enabled: false, lastTestOk: null, lastError: null, updatedBy: actorId })
    .onConflictDoUpdate({ target: integrationConfigs.providerId, set: { credentialsEncrypted: encryptJson(merged), status: "not_configured", enabled: false, lastTestOk: null, lastError: null, updatedBy: actorId, updatedAt: new Date() } });
}

export async function clearCredentials(id: string, actorId: string): Promise<void> {
  const db = await getDb();
  await db.update(integrationConfigs).set({ credentialsEncrypted: null, status: "not_configured", enabled: false, lastTestOk: null, lastError: null, updatedBy: actorId, updatedAt: new Date() }).where(eq(integrationConfigs.providerId, id));
}

export async function recordTest(id: string, ok: boolean, message: string | null): Promise<void> {
  const db = await getDb();
  const [row] = await db.select().from(integrationConfigs).where(eq(integrationConfigs.providerId, id));
  const status: IntegrationStatus = ok ? (row?.enabled ? (row.environment === "live" ? "live" : "test") : row?.status === "disabled" ? "disabled" : "not_configured") : "error";
  await db.update(integrationConfigs).set({ lastTestedAt: new Date(), lastTestOk: ok, lastError: ok ? null : message, status, updatedAt: new Date() }).where(eq(integrationConfigs.providerId, id));
}

export async function setEnabled(id: string, enabled: boolean, environment: "test" | "live", actorId: string): Promise<IntegrationStatus> {
  const db = await getDb();
  const [row] = await db.select().from(integrationConfigs).where(eq(integrationConfigs.providerId, id));
  if (!row) throw new Error("Unknown integration");
  if (enabled && row.lastTestOk !== true) throw new Error("Run a successful connection test before enabling this provider.");
  const status: IntegrationStatus = enabled ? (environment === "live" ? "live" : "test") : "disabled";
  await db.update(integrationConfigs).set({ enabled, environment, status, updatedBy: actorId, updatedAt: new Date() }).where(eq(integrationConfigs.providerId, id));
  return status;
}
