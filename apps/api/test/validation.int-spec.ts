import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { adminToken, createHarness, resetTaxonomy, type Harness } from './harness.js';

describe('request validation', () => {
  let h: Harness;
  let auth: { authorization: string };

  beforeAll(async () => {
    h = await createHarness();
    auth = { authorization: `Bearer ${await adminToken(h.jwt, h.operatorId)}` };
  });

  afterAll(async () => {
    await h.close();
  });

  beforeEach(async () => {
    await resetTaxonomy(h.prisma);
  });

  it.each([
    ['an empty name', { name: '' }],
    ['a whitespace-only name', { name: '   ' }],
    ['an over-length name', { name: 'x'.repeat(81) }],
    ['a missing name', {}],
    ['a non-string name', { name: 7 }],
  ])('rejects %s with 400', async (_label, body) => {
    await request(h.app.getHttpServer())
      .post('/api/admin/taxonomy/subjects')
      .set(auth)
      .send(body)
      .expect(400);
    expect(await h.prisma.subject.count()).toBe(0);
  });

  it('rejects an extra non-whitelisted property with 400', async () => {
    await request(h.app.getHttpServer())
      .post('/api/admin/taxonomy/subjects')
      .set(auth)
      .send({ name: 'Mathematics', enabled: false })
      .expect(400);
    expect(await h.prisma.subject.count()).toBe(0);
  });

  it('rejects a non-uuid path parameter with 400', async () => {
    await request(h.app.getHttpServer())
      .get('/api/admin/taxonomy/grade-levels/not-a-uuid/selectable-subjects')
      .set(auth)
      .expect(400);
  });

  it('rejects a non-boolean enabled flag with 400', async () => {
    const subject = await h.taxonomy.createSubject(h.operatorId, 'Mathematics');
    await request(h.app.getHttpServer())
      .patch(`/api/admin/taxonomy/subjects/${subject.id}/enabled`)
      .set(auth)
      .send({ enabled: 'yes' })
      .expect(400);
  });
});
