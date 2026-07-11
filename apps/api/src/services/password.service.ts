import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id hashing (Technical Spec §5). Parameters follow the OWASP
 * recommendation for interactive logins (19 MiB memory, 2 iterations).
 */
const ARGON2_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, plain: string): Promise<boolean> {
  // Seed placeholders (see prisma/seed.ts) are not argon2 strings; verify()
  // would throw on them — treat any malformed hash as a failed login.
  try {
    return await verify(passwordHash, plain);
  } catch {
    return false;
  }
}
