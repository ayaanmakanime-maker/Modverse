/** Password policy (pure — safe to use in the browser for the strength meter). */
const COMMON = new Set([
  "password", "password1", "password123", "12345678", "123456789", "1234567890", "qwerty123", "qwertyuiop", "iloveyou", "admin123",
  "welcome123", "letmein", "abc12345", "11111111", "00000000", "passw0rd", "india123", "modverse", "modverse123", "football",
]);

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  label: "very weak" | "weak" | "fair" | "strong" | "very strong";
  ok: boolean;
  problems: string[];
}

/** Password policy: ≥10 chars, not common, not containing the email name, ≥ "fair" strength. */
export function passwordStrength(password: string, email?: string): PasswordStrength {
  const problems: string[] = [];
  if (password.length < 10) problems.push("Use at least 10 characters.");
  if (password.length > 128) problems.push("Use at most 128 characters.");
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) problems.push("This password is too common.");
  const local = email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 3 && lower.includes(local)) problems.push("Don't include your email name.");
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  const unique = new Set(password).size;
  let score = 0;
  if (password.length >= 10) score++;
  if (password.length >= 14) score++;
  if (classes >= 3) score++;
  if (classes === 4 || password.length >= 18) score++;
  if (unique < 5) score = Math.min(score, 1);
  if (COMMON.has(lower)) score = 0;
  const labels = ["very weak", "weak", "fair", "strong", "very strong"] as const;
  if (score < 2 && !problems.length) problems.push("Mix upper/lower case, numbers and symbols, or use a longer passphrase.");
  const s = Math.max(0, Math.min(4, score)) as PasswordStrength["score"];
  return { score: s, label: labels[s], ok: problems.length === 0 && s >= 2, problems };
}
