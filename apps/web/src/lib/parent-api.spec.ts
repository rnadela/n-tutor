import { afterEach, describe, expect, it, vi } from 'vitest';
import { NETWORK_STATUS, ParentApiError, messageFor, parentApi } from './parent-api';
import { parentCopy } from '@/copy/parent';

function respondWith(status: number, body: unknown = {}): ReturnType<typeof vi.fn> {
  // A 204 carries no body at all; constructing one with a body throws.
  const fetchMock = vi.fn(
    async () => new Response(status === 204 ? null : JSON.stringify(body), { status }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('credentials', () => {
  it('sends the session cookie on every call and stores nothing itself', async () => {
    const fetchMock = respondWith(200, { passwordMinLength: 12 });

    await parentApi.policy();

    const [, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(init.credentials).toBe('include');
  });

  it('sends JSON on a write', async () => {
    const fetchMock = respondWith(200, { id: 'a', email: 'ada@example.test' });

    await parentApi.signIn('ada@example.test', 'correct-horse-battery-staple');

    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toContain('/auth/sign-in');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(init.credentials).toBe('include');
  });

  it('returns nothing for a 204 rather than parsing an empty body', async () => {
    respondWith(204);
    await expect(parentApi.signOut()).resolves.toBeUndefined();
  });

  it('does not declare a content-type on a bodyless GET', async () => {
    const fetchMock = respondWith(200, { passwordMinLength: 12 });

    await parentApi.policy();

    const [, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(new Headers(init.headers).has('content-type')).toBe(false);
  });

  it('reports a broken success body as the endpoint’s failure, not a parser error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not json at all', { status: 200 })),
    );

    await expect(parentApi.policy()).rejects.toMatchObject({
      name: 'ParentApiError',
      status: 200,
      message: parentCopy.errors.policyUnavailable,
    });
  });
});

describe('error mapping', () => {
  it('gives 429 its own copy, whatever the endpoint', () => {
    expect(messageFor(429, parentCopy.signIn.failed)).toBe(parentCopy.errors.tooManyAttempts);
  });

  it('distinguishes a failed request from a server rejection', () => {
    expect(messageFor(NETWORK_STATUS, parentCopy.signIn.failed)).toBe(parentCopy.errors.network);
    expect(messageFor(500, parentCopy.signIn.failed)).toBe(parentCopy.signIn.failed);
  });

  it('uses the endpoint’s own single message for its rejections', async () => {
    respondWith(401);
    await expect(parentApi.signIn('ada@example.test', 'nope')).rejects.toMatchObject({
      name: 'ParentApiError',
      status: 401,
      message: parentCopy.signIn.failed,
    });

    respondWith(400);
    await expect(
      parentApi.signUp({
        email: 'ada@example.test',
        password: 'correct-horse-battery-staple',
        timezone: 'UTC',
        termsVersion: 'v',
        noticeVersion: 'v',
      }),
    ).rejects.toMatchObject({ status: 400, message: parentCopy.signUp.failed });
  });

  it('reports a network failure as ParentApiError with status 0', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    const error = await parentApi.requestPasswordReset('ada@example.test').catch((c: unknown) => c);
    expect(error).toBeInstanceOf(ParentApiError);
    expect((error as ParentApiError).status).toBe(NETWORK_STATUS);
    expect((error as ParentApiError).message).toBe(parentCopy.errors.network);
  });

  it('keeps the per-endpoint messages distinct from one another', () => {
    const messages = [
      parentCopy.signIn.failed,
      parentCopy.signUp.failed,
      parentCopy.resetConfirm.failed,
      parentCopy.errors.network,
      parentCopy.errors.tooManyAttempts,
      parentCopy.errors.policyUnavailable,
    ];
    expect(new Set(messages).size).toBe(messages.length);
  });
});
