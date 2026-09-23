import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LOCKED_STATUS,
  NETWORK_STATUS,
  ParentApiError,
  lockLiftsAt,
  messageFor,
  parentApi,
} from './parent-api';
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

describe('the elevation bearer', () => {
  it('is attached to the parent-scoped calls, and to those only', async () => {
    const fetchMock = respondWith(200, { id: 'a', email: 'ada@example.test' });
    await parentApi.parentSession('elevation-token');
    const [, elevatedInit] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(new Headers(elevatedInit.headers).get('authorization')).toBe('Bearer elevation-token');

    // The gate-crossing calls take the session cookie alone: there is no token
    // to attach yet, and the cookie must never satisfy the elevation guard.
    const statusMock = respondWith(200, { pinSet: true, lockedUntil: null });
    await parentApi.pinStatus();
    const [, statusInit] = statusMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(new Headers(statusInit.headers).has('authorization')).toBe(false);

    const verifyMock = respondWith(200, { token: 't', expiresAt: 'x', ceilingAt: 'y' });
    await parentApi.verifyPin('1234');
    const [, verifyInit] = verifyMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(new Headers(verifyInit.headers).has('authorization')).toBe(false);
  });

  it('is taken from the caller, never from state this module holds', async () => {
    const fetchMock = respondWith(200, { id: 'a', email: 'ada@example.test' });
    await parentApi.parentSession('first');
    await parentApi.refreshElevation('second');

    const headers = fetchMock.mock.calls.map(([, init]) =>
      new Headers((init as RequestInit).headers).get('authorization'),
    );
    expect(headers).toEqual(['Bearer first', 'Bearer second']);
  });

  it('sends the PIN in the body and never in the URL', async () => {
    const fetchMock = respondWith(204);
    await parentApi.setPin('1234');
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).not.toContain('1234');
    expect(init.body).toBe(JSON.stringify({ pin: '1234' }));
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

  it('maps a 423 to the lock, stating when it lifts', () => {
    const until = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    expect(messageFor(LOCKED_STATUS, parentCopy.pin.incorrect, until)).toBe(
      parentCopy.pin.locked(lockLiftsAt(until)),
    );
    // No instant to state: the lock is still stated, the time is not invented.
    expect(messageFor(LOCKED_STATUS, parentCopy.pin.incorrect)).toBe(parentCopy.pin.lockedUnknown);
  });

  it('never frames a lock as a count of attempts', () => {
    const message = messageFor(LOCKED_STATUS, parentCopy.pin.incorrect, new Date().toISOString());
    expect(message).not.toMatch(/attempt|tries|remaining|!/i);
  });

  it('surfaces lockedUntil on the error so the screen can render the lock', async () => {
    const lockedUntil = new Date(Date.now() + 60_000).toISOString();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ statusCode: 423, message: 'locked', lockedUntil }), {
            status: LOCKED_STATUS,
          }),
      ),
    );

    const error = await parentApi.verifyPin('0000').catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ParentApiError);
    expect((error as ParentApiError).status).toBe(LOCKED_STATUS);
    expect((error as ParentApiError).lockedUntil).toBe(lockedUntil);
  });

  it('distinguishes the elevation guard’s 401 from a wrong-credential 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ statusCode: 401, message: 'Not in Parent View.', elevated: false }),
            { status: 401 },
          ),
      ),
    );

    const error = await parentApi
      .changePin('stale-token', { newPin: '1234', currentPin: '4321' })
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ParentApiError);
    // Without this a parent whose Parent View had ended would be told their
    // PIN was wrong, and would never be sent back to the gate.
    expect((error as ParentApiError).notElevated).toBe(true);
    expect((error as ParentApiError).message).toBe(parentCopy.pin.notElevated);
  });

  it('treats a 401 with no such marker as a wrong credential', async () => {
    respondWith(401, { statusCode: 401, message: 'That PIN is not correct.' });
    const error = await parentApi
      .changePin('good-token', { newPin: '1234', currentPin: '4321' })
      .catch((cause: unknown) => cause);
    expect((error as ParentApiError).notElevated).toBe(false);
    expect((error as ParentApiError).message).toBe(parentCopy.pin.incorrect);
  });

  it('leaves lockedUntil null for every other rejection', async () => {
    respondWith(401);
    const error = await parentApi.verifyPin('0000').catch((cause: unknown) => cause);
    expect((error as ParentApiError).lockedUntil).toBeNull();
    expect((error as ParentApiError).message).toBe(parentCopy.pin.incorrect);
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
