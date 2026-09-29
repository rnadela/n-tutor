import { readFileSync } from 'node:fs';
import path from 'node:path';
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

const SOURCE = readFileSync(path.resolve(import.meta.dirname, 'parent-api.ts'), 'utf8');

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

describe('the generation request body', () => {
  const ID = '11111111-1111-4111-8111-111111111111';
  const bodyOf = (fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> =>
    JSON.parse(String((fetchMock.mock.calls[0]! as unknown as [string, RequestInit])[1].body));

  it('sends the count alone when nothing is weighted', async () => {
    // Byte-for-byte the request Story 4.1 makes: absent, not null.
    const fetchMock = respondWith(202, {});
    await parentApi.startGeneration('token', ID, 2);
    expect(bodyOf(fetchMock)).toEqual({ count: 2 });

    vi.unstubAllGlobals();
    const withNull = respondWith(202, {});
    await parentApi.startGeneration('token', ID, 2, null);
    expect(bodyOf(withNull)).toEqual({ count: 2 });
  });

  it('sends the topic as the Extraction spells it when one is chosen', async () => {
    const fetchMock = respondWith(202, {});
    await parentApi.startGeneration('token', ID, 2, 'Fractions');
    expect(bodyOf(fetchMock)).toEqual({ count: 2, weightedTopic: 'Fractions' });
  });

  it('reads the topic list from the route that offers it, carrying the bearer', async () => {
    const fetchMock = respondWith(200, { topics: ['Fractions'] });
    const view = await parentApi.generationTopics('token', ID);
    expect(view.topics).toEqual(['Fractions']);
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toContain(`/parent/source-tests/${ID}/practice-tests/topics`);
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer token');
  });
});

describe('the draft reads', () => {
  const ID = '22222222-2222-4222-8222-222222222222';

  it('lists the pending drafts, carrying the bearer and nothing else', async () => {
    const fetchMock = respondWith(200, []);
    const drafts = await parentApi.practiceTestDrafts('token');
    expect(drafts).toEqual([]);

    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toContain('/parent/practice-tests/drafts');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer token');
    // The elevation bearer travels in a header, never as a cookie (AD-18).
    expect(new Headers(init.headers).get('cookie')).toBeNull();
  });

  it('treats an empty list as an answer rather than an absence', async () => {
    respondWith(200, []);
    await expect(parentApi.practiceTestDrafts('token')).resolves.toEqual([]);
  });

  it('reads one draft by its id, with every question the server states', async () => {
    const fetchMock = respondWith(200, {
      id: ID,
      ordinal: 2,
      siblingCount: 3,
      questionCount: 1,
      questions: [
        {
          id: 'q1',
          ordinal: 1,
          format: 'MultipleChoice',
          // Structure on the wire, never the glyph "1/2" (AD-32).
          prompt: [
            { kind: 'text', value: 'Add ' },
            { kind: 'fraction', whole: null, numerator: 1, denominator: 2 },
          ],
          answer: null,
          choices: [{ ordinal: 1, body: [{ kind: 'text', value: 'a' }], isCorrect: true }],
          topics: ['Fractions'],
        },
      ],
    });

    const draft = await parentApi.practiceTestDraft('token', ID);
    expect(draft.ordinal).toBe(2);
    expect(draft.siblingCount).toBe(3);
    expect(draft.questions[0]!.prompt[1]).toEqual({
      kind: 'fraction',
      whole: null,
      numerator: 1,
      denominator: 2,
    });
    expect(draft.questions[0]!.choices[0]!.isCorrect).toBe(true);
    expect(draft.questions[0]!.topics).toEqual(['Fractions']);

    const [url] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toContain(`/parent/practice-tests/${ID}`);
  });

  it('edits one question with plain text, and re-reads the draft from the answer', async () => {
    const fetchMock = respondWith(200, { id: ID, status: 'Draft', questions: [] });

    await parentApi.editDraftQuestion('token', ID, 'q1', {
      prompt: 'What is 1/2 of 8?',
      choices: [{ ordinal: 1, body: 'Four' }],
      correctOrdinal: 1,
    });

    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toContain(`/parent/practice-tests/${ID}/questions/q1`);
    expect(init.method).toBe('PATCH');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer token');
    // Plain text up, segments back: the browser never builds a fraction, and
    // the server owns the one conversion (AD-32).
    expect(JSON.parse(String(init.body))).toEqual({
      prompt: 'What is 1/2 of 8?',
      choices: [{ ordinal: 1, body: 'Four' }],
      correctOrdinal: 1,
    });
  });

  it('deletes one question and reads the draft back from the answer', async () => {
    const fetchMock = respondWith(200, { id: ID, status: 'Draft', questions: [] });

    const view = await parentApi.deleteDraftQuestion('token', ID, 'q1');
    expect(view.status).toBe('Draft');

    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toContain(`/parent/practice-tests/${ID}/questions/q1`);
    expect(init.method).toBe('DELETE');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer token');
  });

  it('carries the discard back as a status rather than as a refusal', async () => {
    // Deleting the last question takes the practice test with it. The screen
    // reads the status and goes back to the pending drafts.
    respondWith(200, { id: ID, status: 'Discarded', questions: [] });
    const view = await parentApi.deleteDraftQuestion('token', ID, 'q1');
    expect(view.status).toBe('Discarded');
    expect(view.questions).toEqual([]);
  });

  it('surfaces the released-state write barrier as the 404 it is', async () => {
    respondWith(404, { message: 'That practice test could not be found.' });
    const failure = await parentApi
      .editDraftQuestion('token', ID, 'q1', { prompt: 'x' })
      .catch((cause: unknown) => cause as ParentApiError);
    expect((failure as ParentApiError).status).toBe(404);
  });

  it('releases one practice test and reads the new status off the answer', async () => {
    const fetchMock = respondWith(200, { id: ID, status: 'Released', questions: [] });

    const view = await parentApi.releasePracticeTest('token', ID);
    expect(view.status).toBe('Released');

    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toContain(`/parent/practice-tests/${ID}/release`);
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer token');
    // Nothing is sent: the id in the path is the whole request. A body would be a
    // second place a status could be asked for.
    expect(init.body ?? null).toBeNull();
  });

  it('discards one practice test and reads the new status off the answer', async () => {
    const fetchMock = respondWith(200, { id: ID, status: 'Discarded', questions: [] });

    const view = await parentApi.discardPracticeTest('token', ID);
    expect(view.status).toBe('Discarded');

    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toContain(`/parent/practice-tests/${ID}/discard`);
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer token');
  });

  it('sets a time limit with an explicit figure, and reads the view back', async () => {
    const fetchMock = respondWith(200, {
      id: ID,
      status: 'Draft',
      timerMinutes: 20,
      suggestedTimerMinutes: 20,
      questions: [],
    });

    const view = await parentApi.setPracticeTestTimer('token', ID, 20);
    expect(view.timerMinutes).toBe(20);
    expect(view.suggestedTimerMinutes).toBe(20);

    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toContain(`/parent/practice-tests/${ID}/timer`);
    // `PUT`: there is one duration and this restates it whole.
    expect(init.method).toBe('PUT');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer token');
    expect(JSON.parse(String(init.body))).toEqual({ minutes: 20 });
  });

  it('turns the timer off by stating null, never by omitting the field', async () => {
    // An absent field is a request that said nothing, and the API answers 400 for
    // it. Off is `{ minutes: null }`, explicitly.
    const fetchMock = respondWith(200, {
      id: ID,
      status: 'Draft',
      timerMinutes: null,
      suggestedTimerMinutes: 12,
      questions: [],
    });

    const view = await parentApi.setPracticeTestTimer('token', ID, null);
    expect(view.timerMinutes).toBeNull();

    const [, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({ minutes: null });
    expect('minutes' in body).toBe(true);
  });

  it('surfaces the timer’s own released-state refusal as the 404 it is', async () => {
    respondWith(404, { message: 'That practice test could not be found.' });
    const failure = await parentApi
      .setPracticeTestTimer('token', ID, 20)
      .catch((cause: unknown) => cause as ParentApiError);
    expect((failure as ParentApiError).status).toBe(404);
  });

  it('surfaces a second release as the 404 the one-way transition answers with', async () => {
    // Release is one-way in v0, and the API states one sentence for an unknown id,
    // a foreign id and an already-released one. This app has nothing to tell apart.
    respondWith(404, { message: 'That practice test could not be found.' });
    const failure = await parentApi
      .releasePracticeTest('token', ID)
      .catch((cause: unknown) => cause as ParentApiError);
    expect((failure as ParentApiError).status).toBe(404);
  });

  it('surfaces a 404 as a 404 rather than flattening it into a generic failure', async () => {
    // The screen renders a missing draft as a state and offers the way back;
    // it can only do that if the status survives the call.
    respondWith(404, { message: 'That practice test could not be found.' });
    const failure = await parentApi
      .practiceTestDraft('token', ID)
      .catch((cause: unknown) => cause as ParentApiError);
    expect((failure as ParentApiError).status).toBe(404);
  });
});

describe('the student-scoped read of released practice tests', () => {
  it('carries the binding cookie and no bearer at all', async () => {
    const fetchMock = respondWith(200, [{ id: 'p1', questionCount: 8 }]);

    const tests = await parentApi.studentPracticeTests();
    expect(tests).toEqual([{ id: 'p1', questionCount: 8 }]);

    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toContain('/student/practice-tests');
    // The binding is an httpOnly cookie `credentials: 'include'` already carries.
    // An elevation bearer here would be the wrong audience for the surface.
    expect(new Headers(init.headers).has('authorization')).toBe(false);
    expect(init.credentials).toBe('include');
    // A read, and nothing else: there is no student-scoped write of any kind.
    expect(init.method ?? 'GET').toBe('GET');
  });

  it('treats an empty list as the state it is, not as an absence', async () => {
    respondWith(200, []);
    await expect(parentApi.studentPracticeTests()).resolves.toEqual([]);
  });

  it('carries the guard’s own refusal through as an unbound device', async () => {
    // The one 401 that means "this device was never set up", rather than "something
    // went wrong" — which is what keeps a dropped connection from routing a child
    // to sign-in.
    respondWith(401, { message: 'This device is not set up for a student yet.', bound: false });
    const failure = await parentApi
      .studentPracticeTests()
      .catch((cause: unknown) => cause as ParentApiError);
    expect((failure as ParentApiError).status).toBe(401);
    expect((failure as ParentApiError).notBound).toBe(true);
  });
});

describe('a refusal the API authored', () => {
  it("carries the server's stated reason on a 409, beside the screen's fallback", async () => {
    const reason =
      'No Generation Allowance is left this period. It resets at the start of the next one.';
    respondWith(409, { message: reason });

    const failure = await parentApi
      .startGeneration('token', '11111111-1111-4111-8111-111111111111', 2)
      .catch((cause: unknown) => cause as ParentApiError);

    expect(failure).toBeInstanceOf(ParentApiError);
    expect((failure as ParentApiError).status).toBe(409);
    // The sentence is written once, in the API's policy file. A screen that
    // fell back to its own generic message would say less than the server did.
    expect((failure as ParentApiError).reason).toBe(reason);
    // `message` stays the caller's fallback, so screens that do not know what
    // a 409 means on their route are unchanged.
    expect((failure as ParentApiError).message).toBe(parentCopy.generate.startFailed);
  });

  it('carries no reason on a status that is not a refusal on a rule', async () => {
    respondWith(500, { message: 'Internal server error' });

    const failure = await parentApi
      .generationJob('token', '11111111-1111-4111-8111-111111111111')
      .catch((cause: unknown) => cause as ParentApiError);

    // A 500's message is not a sentence anybody wrote for a parent to read.
    expect((failure as ParentApiError).reason).toBeNull();
  });

  it('ignores a validation array, which is not a sentence for a parent', async () => {
    respondWith(409, { message: ['count must be an integer'] });

    const failure = await parentApi
      .startGeneration('token', '11111111-1111-4111-8111-111111111111', 2)
      .catch((cause: unknown) => cause as ParentApiError);

    expect((failure as ParentApiError).reason).toBeNull();
  });
});

describe('uncommitted parent state', () => {
  const TOKEN = 'elevation-bearer';
  const PROFILE = '11111111-2222-3333-4444-555555555555';

  const initOf = (fetchMock: ReturnType<typeof vi.fn>): [string, RequestInit] =>
    fetchMock.mock.calls[0]! as unknown as [string, RequestInit];

  it('saves through a PUT on the slot, carrying the bearer and nothing else', async () => {
    const fetchMock = respondWith(200, { id: 'row-1' });

    await parentApi.saveUncommittedState(TOKEN, {
      studentProfileId: PROFILE,
      kind: 'DraftEdit',
      payload: { a: 1 },
    });

    const [url, init] = initOf(fetchMock);
    expect(url).toContain('/parent/uncommitted');
    expect(init.method).toBe('PUT');
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(String(init.body))).toEqual({
      studentProfileId: PROFILE,
      kind: 'DraftEdit',
      payload: { a: 1 },
    });
  });

  it('reads by naming the profile, because a row is keyed to one', async () => {
    const fetchMock = respondWith(200, []);

    await parentApi.uncommittedState(TOKEN, PROFILE);

    const [url, init] = initOf(fetchMock);
    expect(url).toContain(`/parent/uncommitted?studentProfileId=${PROFILE}`);
    expect(init.method).toBeUndefined();
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
  });

  it('discards by id, and reads nothing back from a 204', async () => {
    const fetchMock = respondWith(204);

    await expect(parentApi.discardUncommittedState(TOKEN, 'row-1')).resolves.toBeUndefined();

    const [url, init] = initOf(fetchMock);
    expect(url).toContain('/parent/uncommitted/row-1');
    expect(init.method).toBe('DELETE');
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
  });

  it('carries the bearer in a header, never as a cookie', async () => {
    const fetchMock = respondWith(200, []);
    await parentApi.uncommittedState(TOKEN, PROFILE);
    const [, init] = initOf(fetchMock);
    expect(String(new Headers(init.headers).get('cookie') ?? '')).not.toContain(TOKEN);
  });

  it('surfaces the elevation guard’s 401 as notElevated on every one of them', async () => {
    const notElevated = () =>
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

    const calls = [
      () =>
        parentApi.saveUncommittedState(TOKEN, {
          studentProfileId: PROFILE,
          kind: 'DraftEdit',
          payload: { a: 1 },
        }),
      () => parentApi.uncommittedState(TOKEN, PROFILE),
      () => parentApi.uncommittedStateItem(TOKEN, 'row-1', PROFILE),
      () => parentApi.discardUncommittedState(TOKEN, 'row-1'),
    ];

    for (const call of calls) {
      notElevated();
      const error = await call().catch((cause: unknown) => cause);
      expect(error).toBeInstanceOf(ParentApiError);
      // A device sent back to Student Mode has to be told to cross the PIN
      // again, not that something generic went wrong.
      expect((error as ParentApiError).notElevated).toBe(true);
      expect((error as ParentApiError).message).toBe(parentCopy.pin.notElevated);
    }
  });

  it('reads by id while naming the profile, so a mismatch can be refused', async () => {
    const fetchMock = respondWith(200, { id: 'row-1' });

    await parentApi.uncommittedStateItem(TOKEN, 'row-1', PROFILE);

    const [url, init] = initOf(fetchMock);
    expect(url).toContain(`/parent/uncommitted/row-1?studentProfileId=${PROFILE}`);
    expect(init.method).toBeUndefined();
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
  });

  it('touches no storage API while it saves, reads or discards', async () => {
    // The source scan below catches a persistence path on any code path at all;
    // this catches one on the paths these calls actually take. The repo pins the
    // elevation token the same way, and server-side-only is the same constraint.
    const localStorage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    const sessionStorage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    const cookie = vi.fn();
    const indexedDB = { open: vi.fn(), databases: vi.fn() };
    vi.stubGlobal('localStorage', localStorage);
    vi.stubGlobal('sessionStorage', sessionStorage);
    vi.stubGlobal('indexedDB', indexedDB);
    vi.stubGlobal('document', {
      get cookie() {
        return cookie();
      },
      set cookie(_value: string) {
        cookie();
      },
    });
    respondWith(200, { id: 'row-1' });

    await parentApi.saveUncommittedState(TOKEN, {
      studentProfileId: PROFILE,
      kind: 'DraftEdit',
      payload: { note: 'half a thought' },
    });
    await parentApi.uncommittedState(TOKEN, PROFILE);
    await parentApi.uncommittedStateItem(TOKEN, 'row-1', PROFILE);
    respondWith(204);
    await parentApi.discardUncommittedState(TOKEN, 'row-1');

    for (const spy of [
      localStorage.getItem,
      localStorage.setItem,
      localStorage.removeItem,
      sessionStorage.getItem,
      sessionStorage.setItem,
      sessionStorage.removeItem,
      indexedDB.open,
      indexedDB.databases,
      cookie,
    ]) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it('names no storage API anywhere in the module’s source', () => {
    // Server-side-only is this story's central constraint, and the spies in a
    // unit test only catch what a call happens to reach. This catches a
    // persistence path added on any code path at all.
    const code = SOURCE.split('\n')
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join('\n');
    for (const forbidden of [
      'localStorage',
      'sessionStorage',
      'indexedDB',
      'document.cookie',
      'window.name',
    ]) {
      expect(code).not.toContain(forbidden);
    }
  });
});

describe('Source Test calls', () => {
  it('resolves a 204 delete without trying to parse an empty body', async () => {
    const fetchMock = respondWith(204);
    // `undefined`, and no throw: a `response.json()` on an empty body rejects,
    // and the catch around it would report the generic failure copy for a
    // delete that in fact succeeded.
    await expect(parentApi.deleteSourceTestPage('t', 'st-1', 'p-1')).resolves.toBeUndefined();
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).method).toBe('DELETE');
  });

  it('removes every photograph of an upload with one elevated DELETE on its pages', async () => {
    // A client wired to a path the server does not serve fails only in front of
    // a parent, so the verb, the path and the header are all stated here.
    const fetchMock = respondWith(200, { id: 'st-1', status: 'Submitted', pages: [] });

    await expect(parentApi.deleteSourceTestPageImages('t', 'st-1')).resolves.toMatchObject({
      id: 'st-1',
    });

    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toContain('/parent/source-tests/st-1/pages');
    // The whole page set, never one page: no page id in the path.
    expect(url).not.toMatch(/\/pages\/.+/u);
    expect(init.method).toBe('DELETE');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer t');
  });

  it('answers a refused early deletion with the sentence the API wrote', async () => {
    // A 409 is the API refusing on a rule it authored — the upload has not been
    // submitted, or is still being read. It is carried on `reason`, which is
    // what the screen shows instead of `deletePhotosFailed`: a parent handed
    // this module's generic line is told less than the server already said, and
    // nothing they can act on.
    respondWith(409, { message: 'Submit this upload before removing its photos.' });

    await expect(parentApi.deleteSourceTestPageImages('t', 'st-1')).rejects.toMatchObject({
      status: 409,
      reason: 'Submit this upload before removing its photos.',
    });
  });

  it('still reports a failed delete as a rejection', async () => {
    respondWith(404, { message: 'gone' });
    await expect(parentApi.deleteSourceTestPage('t', 'st-1', 'p-1')).rejects.toBeInstanceOf(
      ParentApiError,
    );
  });

  it('lets the browser describe a multipart body, boundary included', async () => {
    const fetchMock = respondWith(201, { id: 'st-1', pages: [] });
    const file = new File([new Uint8Array([1, 2, 3])], 'page.jpg', { type: 'image/jpeg' });
    await parentApi.addSourceTestPage('t', 'st-1', file);

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers((init as RequestInit).headers);
    // A hand-set `multipart/form-data` carries no boundary, and the upload is
    // unparseable on arrival.
    expect(headers.get('content-type')).toBeNull();
    expect((init as RequestInit).body).toBeInstanceOf(FormData);
    expect(((init as RequestInit).body as FormData).get('file')).toBe(file);
  });

  it('still declares JSON on the calls that send it', async () => {
    const fetchMock = respondWith(200, { id: 'st-1', pages: [] });
    await parentApi.reorderSourceTestPages('t', 'st-1', ['p-2', 'p-1']);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(new Headers((init as RequestInit).headers).get('content-type')).toBe('application/json');
    expect((init as RequestInit).body).toBe(JSON.stringify({ pageIds: ['p-2', 'p-1'] }));
  });

  it('carries the elevation bearer on every Source Test call', async () => {
    for (const call of [
      () => parentApi.openSourceTest('tok', 'profile-1'),
      () => parentApi.sourceTest('tok', 'st-1'),
      () => parentApi.submitSourceTest('tok', 'st-1'),
      () => parentApi.reorderSourceTestPages('tok', 'st-1', ['p-1']),
      () => parentApi.extraction('tok', 'st-1'),
    ]) {
      const fetchMock = respondWith(200, { id: 'st-1', pages: [] });
      await call();
      const [, init] = fetchMock.mock.calls[0]!;
      expect(new Headers((init as RequestInit).headers).get('authorization')).toBe('Bearer tok');
      vi.unstubAllGlobals();
    }
  });
});

describe('the analytics dashboard call', () => {
  it('reads one route, carries the elevation bearer and writes nothing', async () => {
    // One call and not four: three reads would let the table, the trend and the
    // digest be taken at three instants and be read as one picture.
    const fetchMock = respondWith(200, { studentProfileId: 'p-1', topics: [] });
    await parentApi.profileAnalytics('tok', 'p-1');

    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toContain('/parent/students/p-1/analytics');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer tok');
    expect(init.method).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it('escapes the profile id it is given rather than pasting it into the path', async () => {
    const fetchMock = respondWith(200, { topics: [] });
    await parentApi.profileAnalytics('tok', 'a/b?c');
    const [url] = fetchMock.mock.calls[0]! as unknown as [string];
    expect(url).toContain('/parent/students/a%2Fb%3Fc/analytics');
  });

  it('reports a failure with the dashboard’s own sentence', async () => {
    respondWith(500, {});
    await expect(parentApi.profileAnalytics('tok', 'p-1')).rejects.toMatchObject({
      message: parentCopy.analytics.loadFailed,
    });
  });

  it('states no threshold, ceiling or window of its own in the view types', () => {
    // Every tunable arrives on the response: `weakArea` and `trend.windowSize`
    // are fields, never figures this module knows.
    expect(SOURCE).toContain('export interface WeakAreaPolicyView');
    expect(SOURCE).toContain('windowSize: number');
    // The forms that would actually indicate a hardcoded tunable: a value
    // assigned to one of these names, or a default supplied for one. A
    // `name: number` declaration and a property read are neither, which is why
    // the shapes are spelled out rather than matched on the bare identifier.
    expect(SOURCE).not.toMatch(
      /\b(ceilingPercent|answeredFloor|windowSize)\b\s*(=\s*\{?\s*\d|\?\?\s*\d|:\s*\d)/u,
    );
  });

  it('keeps the skipped count on the Mastery view, not optional', () => {
    // A percentage without it is a percentage over an unstated denominator.
    expect(SOURCE).toContain('unanswered: number;');
    expect(SOURCE).not.toContain('unanswered?: number');
  });
});

describe('the topic drill-down call', () => {
  it('reads one route, carries the elevation bearer and writes nothing', async () => {
    // One call, because the drill-down is one answer: split across reads a screen
    // could state a percentage taken at one instant beside rows taken at another.
    const fetchMock = respondWith(200, { topicId: 't-1', mastery: null });
    await parentApi.topicDrillDown('tok', 'p-1', 't-1');

    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toContain('/parent/students/p-1/analytics/topics/t-1');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer tok');
    expect(init.method).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it('escapes both ids rather than pasting them into the path', async () => {
    const fetchMock = respondWith(200, { mastery: null });
    await parentApi.topicDrillDown('tok', 'a/b', 'c?d');
    const [url] = fetchMock.mock.calls[0]! as unknown as [string];
    expect(url).toContain('/parent/students/a%2Fb/analytics/topics/c%3Fd');
  });

  it('reports a failure with the drill-down’s own sentence', async () => {
    respondWith(500, {});
    await expect(parentApi.topicDrillDown('tok', 'p-1', 't-1')).rejects.toMatchObject({
      message: parentCopy.topicDrillDown.loadFailed,
    });
  });

  it('carries no allowance, cost, plan or price on the drill-down view', () => {
    // The allowance the screen states is the account's own `generationAllowance`
    // read; nothing about what a generation costs is a field on this response.
    expect(SOURCE).toContain('export interface TopicDrillDownView');
    const view = SOURCE.slice(
      SOURCE.indexOf('export interface TopicDrillDownView'),
      SOURCE.indexOf('}', SOURCE.indexOf('export interface TopicDrillDownView')),
    );
    expect(view).not.toMatch(/allowance|cost|price|tier|remaining/iu);
  });

  it('keeps the weighted label a field the server resolved, never one composed here', () => {
    // `request()` refuses a label the upload does not carry, and what counts as
    // carrying it is a comparison only the server makes.
    expect(SOURCE).toContain('export interface WeightedTargetView');
    expect(SOURCE).toContain('weightedTopic: string;');
  });
});
