import * as argon2 from 'argon2';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { DUMMY_HASH } from './auth-policy.js';
import { ParentAccountService } from './parent-account.service.js';

const ACCOUNT_ID = '99999999-8888-7777-6666-555555555555';
const PASSWORD = 'correct-horse-battery-staple';

/**
 * A Prisma stand-in whose only read is the credential one. Nothing else on the
 * service is exercised here, and a delegate that is not stubbed is a delegate
 * `verifyPassword` must not be reaching for.
 */
function prismaWithCredential(passwordHash: string | null | 'missing'): {
  prisma: PrismaService;
  reads: () => number;
} {
  let reads = 0;
  const prisma = {
    parentAccount: {
      findUnique: vi.fn(async () => {
        reads += 1;
        if (passwordHash === 'missing') return null;
        return { id: ACCOUNT_ID, email: 'ada@example.test', passwordHash };
      }),
    },
  } as unknown as PrismaService;
  return { prisma, reads: () => reads };
}

function serviceOver(prisma: PrismaService): ParentAccountService {
  return new ParentAccountService(prisma);
}

describe('verifying the account password for a destructive action', () => {
  it('accepts the account’s own password', async () => {
    const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    const { prisma } = prismaWithCredential(hash);

    await expect(serviceOver(prisma).verifyPassword(ACCOUNT_ID, PASSWORD)).resolves.toBe(true);
  });

  it('refuses a wrong one', async () => {
    const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    const { prisma } = prismaWithCredential(hash);

    await expect(serviceOver(prisma).verifyPassword(ACCOUNT_ID, 'hunter2')).resolves.toBe(false);
    // An empty field is a wrong password and not a different kind of refusal:
    // the caller answers both with one sentence and one status.
    await expect(serviceOver(prisma).verifyPassword(ACCOUNT_ID, '')).resolves.toBe(false);
  });

  it('answers false — never a throw — for an account carrying no credential', async () => {
    const { prisma } = prismaWithCredential(null);
    const service = serviceOver(prisma);

    // A pre-Epic-1 account has no `passwordHash` at all. A throw here would be a
    // 500 on a route a parent reached legitimately, and would also tell them
    // something about the account that a wrong password does not.
    await expect(service.verifyPassword(ACCOUNT_ID, PASSWORD)).resolves.toBe(false);
    await expect(service.verifyPassword(ACCOUNT_ID, '')).resolves.toBe(false);
  });

  it('refuses even the dummy hash’s own pre-image, because the stored credential decides', async () => {
    // The dummy is a real argon2id hash, so a caller who somehow knew its
    // pre-image would `verify` against it. The presence of a stored credential
    // is part of the answer and not only part of the cost.
    const { prisma } = prismaWithCredential(null);
    expect(DUMMY_HASH.startsWith('$argon2id$')).toBe(true);

    await expect(serviceOver(prisma).verifyPassword(ACCOUNT_ID, DUMMY_HASH)).resolves.toBe(false);
  });

  it('answers false for a stored hash argon2 cannot parse', async () => {
    // A verification that could not be made is not a verification that
    // succeeded, and it must not surface as a 500 either.
    const { prisma } = prismaWithCredential('not a hash at all');

    await expect(serviceOver(prisma).verifyPassword(ACCOUNT_ID, PASSWORD)).resolves.toBe(false);
  });

  it('resolves the credential by account id, and reads it exactly once', async () => {
    const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    const { prisma, reads } = prismaWithCredential(hash);

    await serviceOver(prisma).verifyPassword(ACCOUNT_ID, PASSWORD);

    expect(reads()).toBe(1);
    expect(prisma.parentAccount.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ACCOUNT_ID } }),
    );
  });

  it('answers false for an account that does not exist', async () => {
    const { prisma } = prismaWithCredential('missing');

    await expect(serviceOver(prisma).verifyPassword(ACCOUNT_ID, PASSWORD)).resolves.toBe(false);
  });
});
