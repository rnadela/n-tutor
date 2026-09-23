import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

// The equal-cost defence is only observable by watching argon2 itself, so the
// module is wrapped — the real implementation still runs.
vi.mock('argon2', async () => {
  const actual = await vi.importActual<typeof import('argon2')>('argon2');
  const verify = vi.fn(actual.verify);
  return { ...actual, default: { ...actual, verify }, verify };
});

const argon2 = await import('argon2');

const { createHarness, OPERATOR_EMAIL, OPERATOR_PASSWORD } = await import('./harness.js');
const { DUMMY_HASH } = await import('../src/admin/admin-auth.service.js');

type Harness = Awaited<ReturnType<typeof createHarness>>;

describe('sign-in cost is the same for an unknown operator', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(async () => {
    await h.close();
  });

  it('verifies a dummy hash when the email is unknown', async () => {
    vi.mocked(argon2.verify).mockClear();

    await request(h.app.getHttpServer())
      .post('/api/admin/auth/login')
      .send({ email: 'nobody@example.test', password: OPERATOR_PASSWORD })
      .expect(401);

    expect(argon2.verify).toHaveBeenCalledWith(DUMMY_HASH, OPERATOR_PASSWORD);
  });

  it('verifies the stored hash when the operator exists', async () => {
    vi.mocked(argon2.verify).mockClear();

    await request(h.app.getHttpServer())
      .post('/api/admin/auth/login')
      .send({ email: OPERATOR_EMAIL, password: 'not-the-password' })
      .expect(401);

    const [hash] = vi.mocked(argon2.verify).mock.calls[0]!;
    expect(hash).not.toBe(DUMMY_HASH);
  });
});
