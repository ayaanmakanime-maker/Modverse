import "server-only";
import { MUSE_MODEL_IDS, MUSE_MODELS } from "./models";
import { connFromCredentials, missingFiles } from "./client";

/** Per-model install report for the Integration Manager's connection test. */
export async function museModelReport(creds: { baseUrl: string; token: string | null; enabledModels?: string; modelFiles?: string }) {
  const conn = connFromCredentials({ baseUrl: creds.baseUrl, authToken: creds.token, enabledModels: creds.enabledModels, modelFiles: creds.modelFiles });
  const out: { id: string; name: string; enabled: boolean; ready: boolean; missing: string[] }[] = [];
  for (const id of MUSE_MODEL_IDS) {
    const enabled = conn.enabled.includes(id);
    const missing = enabled ? await missingFiles(conn, id, true) : [];
    out.push({ id, name: MUSE_MODELS[id].name, enabled, ready: enabled && !missing.length, missing });
  }
  return out;
}
