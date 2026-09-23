import { afterAll, beforeAll, describe, it } from 'vitest';
import request from 'supertest';

// argon2 makes a login flood a CPU denial of service, so the credential path
// carries the tightest limit in the app (AD-23).
process.env.AUTH_RATE_LIMIT = '2';
process.env.AUTH_RATE_TTL_MS = '60000';

const { createHarness, OPERATOR_EMAIL } = await import('./harness.js');

type Harness = Awaited<ReturnType<typeof createHarness>>;

describe('login rate limiting', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(async () => {
    await h.close();
  });

  it('rejects a login flood from one address with 429', async () => {
    const attempt = () =>
      request(h.app.getHttpServer())
        .post('/api/admin/auth/login')
        .send({ email: OPERATOR_EMAIL, password: 'not-the-password' });

    await attempt().expect(401);
    await attempt().expect(401);
    await attempt().expect(429);
  });

  it('does not spend the login budget on other admin routes', async () => {
    await request(h.app.getHttpServer()).get('/api/admin/taxonomy').expect(401);
    await request(h.app.getHttpServer()).get('/api/admin/taxonomy').expect(401);
    await request(h.app.getHttpServer()).get('/api/health').expect(200);
  });
});
