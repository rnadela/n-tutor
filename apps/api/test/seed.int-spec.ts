import * as argon2 from 'argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIN_SEED_PASSWORD_LENGTH, requireSeedPassword, seedOperator } from '../prisma/seed.js';
import { createHarness, type Harness } from './harness.js';

describe('seedOperator', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(async () => {
    await h.close();
  });

  it('never rewrites an existing operator password on re-run', async () => {
    const email = `seed-create-only-${Date.now()}@example.test`;
    const originalPassword = 'first-password-123';
    const rotatedPassword = 'rotated-password-456';

    const first = await seedOperator(h.prisma, email, originalPassword);
    expect(first.adminUserCount).toBeGreaterThan(0);

    const created = await h.prisma.adminUser.findUniqueOrThrow({ where: { email } });
    const originalHash = created.passwordHash;

    // Simulate an operator rotating their password by hand, then the seed
    // running again on the next boot with the old (now stale) env value.
    const rotatedHash = await argon2.hash(rotatedPassword, { type: argon2.argon2id });
    await h.prisma.adminUser.update({ where: { email }, data: { passwordHash: rotatedHash } });

    await seedOperator(h.prisma, email, originalPassword);

    const afterRerun = await h.prisma.adminUser.findUniqueOrThrow({ where: { email } });
    expect(afterRerun.passwordHash).toBe(rotatedHash);
    expect(afterRerun.passwordHash).not.toBe(originalHash);
  });

  it('rejects a missing password', () => {
    expect(() => requireSeedPassword('ADMIN_SEED_PASSWORD_TEST_MISSING')).toThrow(
      'Missing required environment variable',
    );
  });

  it('accepts the documented dev/test default password', () => {
    process.env.ADMIN_SEED_PASSWORD_TEST_DEFAULT = 'change-me-too';
    try {
      expect(requireSeedPassword('ADMIN_SEED_PASSWORD_TEST_DEFAULT')).toBe('change-me-too');
    } finally {
      delete process.env.ADMIN_SEED_PASSWORD_TEST_DEFAULT;
    }
  });

  it('rejects a password shorter than the minimum length', () => {
    process.env.ADMIN_SEED_PASSWORD_TEST_SHORT = 'a'.repeat(MIN_SEED_PASSWORD_LENGTH - 1);
    try {
      expect(() => requireSeedPassword('ADMIN_SEED_PASSWORD_TEST_SHORT')).toThrow(
        'must be at least',
      );
    } finally {
      delete process.env.ADMIN_SEED_PASSWORD_TEST_SHORT;
    }
  });
});
