import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { ADMIN_SIGN_IN_FAILED } from '../src/admin/admin-auth.constants.js';
import { ANONYMOUS_ACTOR } from '../src/admin/admin-audit.service.js';
import {
  adminToken,
  createHarness,
  OPERATOR_EMAIL,
  OPERATOR_PASSWORD,
  parentStyleToken,
  tokenWithClaims,
  type Harness,
} from './harness.js';

describe('admin sign-in and guard', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(async () => {
    await h.close();
  });

  it('signs the seeded operator in and reaches the taxonomy screen data', async () => {
    const login = await request(h.app.getHttpServer())
      .post('/api/admin/auth/login')
      .send({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD })
      .expect(200);

    expect(typeof login.body.token).toBe('string');

    await request(h.app.getHttpServer())
      .get('/api/admin/taxonomy')
      .set('authorization', `Bearer ${login.body.token}`)
      .expect(200);
  });

  it('gives one identical message for an unknown email and a wrong password', async () => {
    const unknown = await request(h.app.getHttpServer())
      .post('/api/admin/auth/login')
      .send({ email: 'nobody@example.test', password: OPERATOR_PASSWORD })
      .expect(401);

    const wrongPassword = await request(h.app.getHttpServer())
      .post('/api/admin/auth/login')
      .send({ email: OPERATOR_EMAIL, password: 'not-the-password' })
      .expect(401);

    expect(unknown.body.message).toBe(ADMIN_SIGN_IN_FAILED);
    expect(wrongPassword.body.message).toBe(ADMIN_SIGN_IN_FAILED);
    expect(unknown.body).toEqual(wrongPassword.body);
  });

  it('rejects a parent-style token on an admin route before the handler runs', async () => {
    const token = await parentStyleToken(h.jwt);
    await request(h.app.getHttpServer())
      .get('/api/admin/taxonomy')
      .set('authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('rejects an absent token on every admin route other than login', async () => {
    await request(h.app.getHttpServer()).get('/api/admin/taxonomy').expect(401);
    await request(h.app.getHttpServer()).post('/api/admin/taxonomy/subjects').send({}).expect(401);
    await request(h.app.getHttpServer()).get('/api/admin/auth/me').expect(401);
  });

  it('rejects a token with the right audience but a parent scope', async () => {
    const token = await tokenWithClaims(h.jwt, {
      sub: h.operatorId,
      email: OPERATOR_EMAIL,
      scope: 'parent',
    });
    await request(h.app.getHttpServer())
      .get('/api/admin/taxonomy')
      .set('authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('rejects a token with the right audience and no scope at all', async () => {
    const token = await tokenWithClaims(h.jwt, { sub: h.operatorId, email: OPERATOR_EMAIL });
    await request(h.app.getHttpServer())
      .get('/api/admin/taxonomy')
      .set('authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('rejects a token missing the claims the audit trail depends on', async () => {
    const noSubject = await tokenWithClaims(h.jwt, {
      email: OPERATOR_EMAIL,
      scope: 'admin',
    });
    const noEmail = await tokenWithClaims(h.jwt, { sub: h.operatorId, scope: 'admin' });

    for (const token of [noSubject, noEmail]) {
      await request(h.app.getHttpServer())
        .get('/api/admin/auth/me')
        .set('authorization', `Bearer ${token}`)
        .expect(401);
    }
  });

  it('rejects an expired admin token', async () => {
    const token = await tokenWithClaims(
      h.jwt,
      { sub: h.operatorId, email: OPERATOR_EMAIL, scope: 'admin' },
      { expiresIn: -10 },
    );
    await request(h.app.getHttpServer())
      .get('/api/admin/taxonomy')
      .set('authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('records a failed sign-in in the audit trail', async () => {
    await h.prisma.adminAudit.deleteMany({ where: { action: 'auth.signIn.failed' } });

    await request(h.app.getHttpServer())
      .post('/api/admin/auth/login')
      .send({ email: OPERATOR_EMAIL, password: 'not-the-password' })
      .expect(401);

    const rows = await h.prisma.adminAudit.findMany({ where: { action: 'auth.signIn.failed' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ targetType: 'AdminUser', targetId: h.operatorId });
    expect(rows[0].detail).toEqual({ reason: 'invalid_credentials' });
  });

  it('records a failed sign-in for an unknown email under the anonymous actor', async () => {
    await h.prisma.adminAudit.deleteMany({ where: { action: 'auth.signIn.failed' } });

    await request(h.app.getHttpServer())
      .post('/api/admin/auth/login')
      .send({ email: 'nobody@example.test', password: 'whatever' })
      .expect(401);

    const rows = await h.prisma.adminAudit.findMany({ where: { action: 'auth.signIn.failed' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ targetType: 'AdminUser', targetId: ANONYMOUS_ACTOR });
    expect(rows[0].detail).toEqual({ reason: 'invalid_credentials' });
  });

  it('accepts an admin-scoped token', async () => {
    const token = await adminToken(h.jwt, h.operatorId);
    const me = await request(h.app.getHttpServer())
      .get('/api/admin/auth/me')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(me.body.email).toBe(OPERATOR_EMAIL);
  });
});
