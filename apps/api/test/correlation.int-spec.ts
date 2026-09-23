import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { CORRELATION_HEADER } from '../src/common/correlation.js';
import { createHarness, type Harness } from './harness.js';

describe('correlation id', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(async () => {
    await h.close();
  });

  it('mints one and returns it on every response', async () => {
    const response = await request(h.app.getHttpServer()).get('/api/health').expect(200);
    expect(response.headers[CORRELATION_HEADER]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('echoes a caller-supplied id unchanged when it is safe', async () => {
    const response = await request(h.app.getHttpServer())
      .get('/api/health')
      .set(CORRELATION_HEADER, 'abc-123_XYZ.1')
      .expect(200);
    expect(response.headers[CORRELATION_HEADER]).toBe('abc-123_XYZ.1');
  });

  it.each([
    ['a space', 'not a safe id'],
    ['an over-long value', 'a'.repeat(129)],
  ])('replaces %s rather than reflecting it or failing', async (_label, value) => {
    const response = await request(h.app.getHttpServer())
      .get('/api/health')
      .set(CORRELATION_HEADER, value)
      .expect(200);
    expect(response.headers[CORRELATION_HEADER]).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers[CORRELATION_HEADER]).not.toBe(value);
  });
});
