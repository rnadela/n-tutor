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

const {
  createGradeLevel,
  createHarness,
  createSignedInParent,
  createStudentProfile,
  elevationTokenWithClaims,
  OPERATOR_EMAIL,
} = await import('./harness.js');
const { resetParentAccounts, resetTaxonomy } = await import('./harness.js');
const { PARENT_ELEVATION_AUDIENCE } = await import('../src/identity/pin-policy.js');

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

  it('rejects a PIN-verify flood from one address with 429', async () => {
    await withHarness(async (h) => {
      await resetParentAccounts(h.prisma);
      const parent = await createSignedInParent(h);
      const verify = () =>
        request(h.app.getHttpServer())
          .post('/api/parent/pin/verify')
          .set('Cookie', parent.cookie)
          .send({ pin: '0000' });

      // No PIN is set, so each attempt is a 409 — the budget is spent by the
      // route being called, not by the answer it happens to give.
      for (let i = 0; i < LIMIT; i += 1) await verify().expect(409);
      await verify().expect(429);
    });
  });

  it('does not spend the parent budget on the PIN status read', async () => {
    await withHarness(async (h) => {
      await resetParentAccounts(h.prisma);
      const parent = await createSignedInParent(h);
      for (let i = 0; i < LIMIT * 3; i += 1) {
        await request(h.app.getHttpServer())
          .get('/api/parent/pin/status')
          .set('Cookie', parent.cookie)
          .expect(200);
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

/**
 * The Story 8.3 deletion route.
 *
 * `DELETE /api/parent/students/:id` runs argon2 on every request and skips both
 * the default and the shared `login` buckets, so `@ParentCredentialRoute()` is
 * the *only* thing standing between it and a password-guessing flood that also
 * happens to be a CPU denial of service (AD-23). Nothing else asserts that it
 * carries the marker, and a decorator silently dropped in a refactor leaves no
 * other trace.
 *
 * The elevation bearer is minted directly rather than crossed for: the PIN set
 * and the PIN verify are credential routes too, and spending two of the budget
 * on setup would leave nothing to measure the route under test with.
 */
describe('the Student Profile deletion route’s credential budget', () => {
  async function elevatedParent(h: Harness): Promise<{ token: string; profileId: string }> {
    await resetTaxonomy(h.prisma);
    await resetParentAccounts(h.prisma);
    const parent = await createSignedInParent(h);
    const gradeLevel = await createGradeLevel(h);
    const profile = await createStudentProfile(h, parent.parentAccountId, {
      gradeLevelId: gradeLevel.id,
    });
    const token = await elevationTokenWithClaims(
      h.parentJwt,
      {
        email: parent.email,
        scope: PARENT_ELEVATION_AUDIENCE,
        epoch: 0,
        sub: parent.parentAccountId,
        elevatedAt: Date.now(),
      },
      // An elevation token without an expiry is not one, and the guard says so.
      { expiresIn: 3600 },
    );
    return { token, profileId: profile.id };
  }

  it('rejects a wrong-password delete flood from one address with 429', async () => {
    await withHarness(async (h) => {
      const { token, profileId } = await elevatedParent(h);
      const attempt = () =>
        request(h.app.getHttpServer())
          .delete(`/api/parent/students/${profileId}`)
          .set('Authorization', `Bearer ${token}`)
          .send({ password: 'not-the-password' });

      // Each one is a 409 and deletes nothing — the budget is spent by the
      // route being called, not by the answer it happens to give, exactly as
      // the PIN-verify case above spends it.
      for (let i = 0; i < LIMIT; i += 1) await attempt().expect(409);
      await attempt().expect(429);
    });
  });

  it('does not spend the parent budget on the deletion preview', async () => {
    await withHarness(async (h) => {
      const { token, profileId } = await elevatedParent(h);
      for (let i = 0; i < LIMIT * 3; i += 1) {
        await request(h.app.getHttpServer())
          .get(`/api/parent/students/${profileId}/deletion-preview`)
          .set('Authorization', `Bearer ${token}`)
          .expect(200);
      }
      // The preview runs no argon2, so it is deliberately not a credential
      // route — and the budget is still whole afterwards.
      await parentSignIn(h).expect(401);
    });
  });
});

/**
 * The Story 8.4 deletion route.
 *
 * `DELETE /api/parent/account` runs argon2 on every request and skips both the
 * default and the shared `login` buckets, exactly as its per-child sibling above
 * does — so `@ParentCredentialRoute()` is again the *only* thing between it and a
 * password-guessing flood that is also a CPU denial of service (AD-23). It is the
 * more attractive target of the two: there is no id to guess first, so every
 * request is a live attempt against the account the bearer already names.
 *
 * Its own block rather than another case on the sibling's, because the budgets
 * are per route-handler in spirit and per surface in fact: a marker dropped from
 * one of the two must not be covered by a test that exercises the other.
 */
describe('the Parent Account deletion route’s credential budget', () => {
  async function elevatedParent(h: Harness): Promise<string> {
    await resetTaxonomy(h.prisma);
    await resetParentAccounts(h.prisma);
    const parent = await createSignedInParent(h);
    // Minted directly rather than crossed for: the PIN set and the PIN verify are
    // credential routes too, and spending the budget on setup would leave nothing
    // to measure the route under test with.
    return elevationTokenWithClaims(
      h.parentJwt,
      {
        email: parent.email,
        scope: PARENT_ELEVATION_AUDIENCE,
        epoch: 0,
        sub: parent.parentAccountId,
        elevatedAt: Date.now(),
      },
      { expiresIn: 3600 },
    );
  }

  it('rejects a wrong-password account-delete flood from one address with 429', async () => {
    await withHarness(async (h) => {
      const token = await elevatedParent(h);
      const attempt = () =>
        request(h.app.getHttpServer())
          .delete('/api/parent/account')
          .set('Authorization', `Bearer ${token}`)
          .send({ password: 'not-the-password' });

      // Each one is a 409 and deletes nothing — the budget is spent by the route
      // being called, not by the answer it happens to give.
      for (let i = 0; i < LIMIT; i += 1) await attempt().expect(409);
      await attempt().expect(429);
    });
  });

  it('does not spend the parent budget on the account deletion preview', async () => {
    await withHarness(async (h) => {
      const token = await elevatedParent(h);
      for (let i = 0; i < LIMIT * 3; i += 1) {
        await request(h.app.getHttpServer())
          .get('/api/parent/account/deletion-preview')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);
      }
      // The preview runs no argon2, so it is deliberately not a credential route
      // — and the budget is still whole afterwards.
      await parentSignIn(h).expect(401);
    });
  });
});
