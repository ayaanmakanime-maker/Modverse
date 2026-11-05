import { hash, verify } from "@node-rs/argon2";

/** OWASP-recommended Argon2id parameters (m=19 MiB, t=2, p=1). Argon2id is the library default algorithm. */
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}

export { passwordStrength, type PasswordStrength } from "./password-policy";
