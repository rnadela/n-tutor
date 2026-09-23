import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import * as argon2 from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

// `import.meta.dirname` would resolve against tsc's `.seed/` output location,
// not the source tree, so this relies on the workspace's guaranteed cwd
// (`pnpm --filter api run seed` / `turbo run seed` always run from `apps/api`).
loadEnv({ path: path.resolve(process.cwd(), '..', '..', '.env'), quiet: true });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const MIN_SEED_PASSWORD_LENGTH = 8;
export const MAX_SEED_PASSWORD_LENGTH = 256;

/**
 * Fails fast rather than seeding a trivially short credential. `change-me-too`
 * (the `.env.example` value) is a deliberate, documented dev/test default —
 * used by this workspace's own E2E suite — so it is not rejected here; only
 * production deployment is responsible for setting a real operator password.
 */
export function requireSeedPassword(name: string): string {
  const password = required(name);
  if (password.length < MIN_SEED_PASSWORD_LENGTH) {
    throw new Error(`${name} must be at least ${MIN_SEED_PASSWORD_LENGTH} characters.`);
  }
  if (password.length > MAX_SEED_PASSWORD_LENGTH) {
    throw new Error(`${name} must be at most ${MAX_SEED_PASSWORD_LENGTH} characters.`);
  }
  return password;
}

export interface SeedResult {
  email: string;
  adminUserCount: number;
}

/**
 * Seeds exactly one operator, out of band. Idempotent and create-only: seeding
 * again must never revert a rotated operator password.
 */
export async function seedOperator(
  prisma: Pick<PrismaClient, 'adminUser'>,
  email: string,
  password: string,
): Promise<SeedResult> {
  const normalisedEmail = email.trim().toLowerCase();
  const existing = await prisma.adminUser.findUnique({
    where: { email: normalisedEmail },
    select: { id: true },
  });
  if (!existing) {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    await prisma.adminUser.create({ data: { email: normalisedEmail, passwordHash } });
  }
  const adminUserCount = await prisma.adminUser.count();
  return { email: normalisedEmail, adminUserCount };
}

async function main(): Promise<void> {
  const email = required('ADMIN_SEED_EMAIL');
  const password = requireSeedPassword('ADMIN_SEED_PASSWORD');
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: required('DATABASE_URL') }),
  });

  try {
    const result = await seedOperator(prisma, email, password);
    process.stdout.write(
      `Seeded operator ${result.email}; admin_user rows: ${result.adminUserCount}\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((cause: unknown) => {
  process.stderr.write(`Seed failed: ${cause instanceof Error ? cause.message : String(cause)}\n`);
  process.exitCode = 1;
});
