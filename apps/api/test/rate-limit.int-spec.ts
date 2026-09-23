import { describe, it } from 'vitest';
import request from 'supertest';

// argon2 makes a credential flood a CPU denial of service, so both credential
// paths carry the tightest limits in the app (AD-23) — and they carry their own
// budgets, so one surface cannot exhaust the other's.
const LIMIT = 2;
process.env.AUTH_RATE_LIMIT = String(LIMIT);
process.env.AUTH_RATE_TTL_MS = '60000';
process.env.PARENT_AUTH_RATE_LIMIT = String(LIMIT);
process.env.PARENT_AUTH_RATE_TTL_MS = '60000';

const { createHarness, OPERATOR_EMAIL } = await import('./harness.js');

type Harness = Awaited<ReturnType<typeof createHarness>>;

/**
 * Every budget test gets a harness of its own.
 *
 * The throttler's counters live in the app instance, so sharing one across
 * tests would make each test's result depend on how many requests the previous
 * ones happened to spend — exactly the hidden coupling a rate-limit suite must
 * not have.
 */
async function withHarness(run: (h: Harness) => Promise<void>): Promise<void> {
  const h = await createHarness();
  try {
    await run(h);
  } finally {
    await h.close();
  }
}

const adminLogin = (h: Harness) =>
  request(h.app.getHttpServer())
    .post('/api/admin/auth/login')
    .send({ email: OPERATOR_EMAIL, password: 'not-the-password' });

const parentSignIn = (h: Harness) =>
  request(h.app.getHttpServer())
    .post('/api/auth/sign-in')
    .send({ email: 'nobody@example.test', password: 'not-the-password' });

describe('credential rate limiting', () => {
  it('rejects an admin login flood from one address with 429', async () => {
    await withHarness(async (h) => {
      for (let i = 0; i < LIMIT; i += 1) await adminLogin(h).expect(401);
      await adminLogin(h).expect(429);
    });
  });

  it('rejects a parent sign-in flood from one address with 429', async () => {
    await withHarness(async (h) => {
      for (let i = 0; i < LIMIT; i += 1) await parentSignIn(h).expect(401);
      await parentSignIn(h).expect(429);
    });
  });

  it('spends the two budgets independently of one another', async () => {
    await withHarness(async (h) => {
      // Exhaust the parent budget outright.
      for (let i = 0; i < LIMIT; i += 1) await parentSignIn(h).expect(401);
      await parentSignIn(h).expect(429);

      // The admin budget is untouched by it: its full allowance is still there.
      for (let i = 0; i < LIMIT; i += 1) await adminLogin(h).expect(401);
      await adminLogin(h).expect(429);
    });
  });

  it('does not spend the parent budget on the policy route', async () => {
    await withHarness(async (h) => {
      for (let i = 0; i < LIMIT * 3; i += 1) {
        await request(h.app.getHttpServer()).get('/api/auth/policy').expect(200);
      }
      // The credential budget is still whole afterwards.
      await parentSignIn(h).expect(401);
    });
  });

  it('does not spend the login budget on other admin routes', async () => {
    await withHarness(async (h) => {
      for (let i = 0; i < LIMIT * 3; i += 1) {
        await request(h.app.getHttpServer()).get('/api/admin/taxonomy').expect(401);
      }
      await request(h.app.getHttpServer()).get('/api/health').expect(200);
      await adminLogin(h).expect(401);
    });
  });
});
