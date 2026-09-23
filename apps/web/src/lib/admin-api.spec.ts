import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminApiError, adminApi } from './admin-api';
import { adminCopy } from '@/copy/admin';

function respondWith(status: number): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({}), { status })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('admin API error mapping', () => {
  it.each([
    [401, adminCopy.errors.sessionExpired],
    [404, adminCopy.errors.notFound],
    [409, adminCopy.errors.duplicate],
    [500, adminCopy.errors.generic],
    [418, adminCopy.errors.generic],
  ])('maps %i to its own copy', async (status, message) => {
    respondWith(status);

    await expect(adminApi.loadTaxonomy()).rejects.toMatchObject({
      name: 'AdminApiError',
      status,
      message,
    });
  });

  it('keeps 404, 409 and the generic message distinct', () => {
    const messages = [
      adminCopy.errors.notFound,
      adminCopy.errors.duplicate,
      adminCopy.errors.sessionExpired,
      adminCopy.errors.generic,
    ];
    expect(new Set(messages).size).toBe(messages.length);
  });

  it('sends JSON and survives a caller passing a Headers instance', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ subjects: [] })));
    vi.stubGlobal('fetch', fetchMock);

    await adminApi.createSubject('Mathematics');

    const [, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('exposes AdminApiError with its status', async () => {
    respondWith(409);
    const error = await adminApi.loadTaxonomy().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(AdminApiError);
    expect((error as AdminApiError).status).toBe(409);
  });
});
