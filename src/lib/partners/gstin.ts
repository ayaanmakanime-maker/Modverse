/**
 * GSTIN validation (format + state code + mod-36 check character, as published by GSTN).
 * This proves a number is well-formed, not that it is registered — ModVerse admins still
 * verify partners before approval (an online GST lookup needs a GSP/API account).
 */
const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const FORMAT = /^(\d{2})[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = CHARS.indexOf(first14[i]);
    if (v < 0) return "";
    const p = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36];
}

export type GstinProblem = "format" | "state" | "checksum";

export function validateGstin(raw: string): { ok: true; value: string; stateCode: string } | { ok: false; problem: GstinProblem } {
  const value = raw.trim().toUpperCase();
  const m = FORMAT.exec(value);
  if (!m) return { ok: false, problem: "format" };
  const state = Number(m[1]);
  if (!((state >= 1 && state <= 38) || state === 97 || state === 99)) return { ok: false, problem: "state" };
  if (gstinCheckChar(value.slice(0, 14)) !== value[14]) return { ok: false, problem: "checksum" };
  return { ok: true, value, stateCode: m[1] };
}

export const GSTIN_MESSAGE: Record<GstinProblem, string> = {
  format: "Enter a valid 15-character GSTIN (e.g. 27AAPFU0939F1ZV)",
  state: "The first two digits of a GSTIN must be a valid state code",
  checksum: "This GSTIN's check character doesn't match — please re-check the number",
};
