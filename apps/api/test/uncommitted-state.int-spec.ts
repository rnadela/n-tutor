import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { AccountTier } from '../src/generated/prisma/enums.js';

const { PROFILE_NOT_FOUND } = await import('../src/identity/student-profile.service.js');
const {
  SCOPE_MAX_LENGTH,
  UNCOMMITTED_PAYLOAD_MAX_BYTES,
  UNCOMMITTED_STATE_NOT_FOUND,
  payloadByteLength,
} = await import('../src/identity/uncommitted-state-policy.js');
const {
  bearer,
  cookieHeader,
  createGradeLevel,
  createHarness,
  createSignedInParent,
  createStudentProfile,
  elevate,
  resetParentAccounts,
  resetTaxonomy,
  setPinFor,
  studentCookieFrom,
} = await import('./harness.js');

type Harness = Awaited<ReturnType<typeof createHarness>>;

const PIN = '4821';

/**
 * The one payload shape this suite uses. It is the suite's own invention, not
 * the product's: Story 1.6 declares no payload for any kind, and an epic that
 * later adds one adds it with its consumer.
 */
const DRAFT = { title: 'Half a thought', body: 'Noah got 7 of 10, but question 4 was —', at: 3 };

describe('Uncommitted parent state', () => {
  let h: Harness;
  const server = () => request(h.app.getHttpServer());

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(async () => {
    await h.close();
  });

  beforeEach(async () => {
    await resetTaxonomy(h.prisma);
    await resetParentAccounts(h.prisma);
    h.mail.reset();
  });

  /**
   * A parent inside Parent View, with one child and the bearer its routes take.
   *
   * `tier` is how a case that goes on to add siblings states the headroom it
   * needs: an account asking for more active Student Profiles is opting into a
   * tier that allows them, never out of the Account-Tier cap. Left unset, the
   * account is `Free` and the cap applies as it does in production.
   */
  async function elevatedParentWithChild(tier?: AccountTier): Promise<{
    parentAccountId: string;
    cookie: string;
    token: string;
    profileId: string;
  }> {
    const parent = await createSignedInParent(h, tier ? { tier } : {});
    await setPinFor(h, parent.cookie, PIN);
    const token = await elevate(h, parent.cookie, PIN);
    const grade = await createGradeLevel(h);
    const profile = await createStudentProfile(h, parent.parentAccountId, {
      gradeLevelId: grade.id,
    });
    return {
      parentAccountId: parent.parentAccountId,
      cookie: parent.cookie,
      token,
      profileId: profile.id,
    };
  }

  const save = (token: string, body: Record<string, unknown>) =>
    server().put('/api/parent/uncommitted').set('Authorization', bearer(token)).send(body);

  const read = (token: string, studentProfileId: string) =>
    server()
      .get('/api/parent/uncommitted')
      .query({ studentProfileId })
      .set('Authorization', bearer(token));

  /** The by-id read: a slot restored into the profile it is named with. */
  const readItem = (token: string, id: string, studentProfileId: string) =>
    server()
      .get(`/api/parent/uncommitted/${id}`)
      .query({ studentProfileId })
      .set('Authorization', bearer(token));

  const messagesOf = (response: { body: { message?: unknown } }): string[] => {
    const message = response.body.message;
    return Array.isArray(message) ? (message as string[]) : [String(message)];
  };

  /** Drags a slot's window into the past, as three real days would. */
  const expireSlot = (id: string) =>
    h.prisma.uncommittedState.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

  // --- The round trip -------------------------------------------------------

  it('holds a draft across an expired Parent View and returns it byte-identical', async () => {
    const parent = await elevatedParentWithChild();

    const saved = await save(parent.token, {
      studentProfileId: parent.profileId,
      kind: 'DraftEdit',
      payload: DRAFT,
    }).expect(200);

    // Parent View ends: the token is gone, and a reload would have destroyed it
    // anyway (AD-18). The PIN is crossed again, minting an unrelated bearer.
    const reElevated = await elevate(h, parent.cookie, PIN);
    expect(reElevated).not.toBe(parent.token);

    const restored = await read(reElevated, parent.profileId).expect(200);
    expect(restored.body).toHaveLength(1);
    expect(restored.body[0].payload).toEqual(DRAFT);
    // The original window, not one measured from the re-entry.
    expect(restored.body[0].createdAt).toBe(saved.body.createdAt);
    expect(restored.body[0].expiresAt).toBe(saved.body.expiresAt);
  });

  it('measures the expiry from creation, at the TTL the policy states', async () => {
    const parent = await elevatedParentWithChild();
    const saved = await save(parent.token, {
      studentProfileId: parent.profileId,
      kind: 'DraftEdit',
      payload: DRAFT,
    }).expect(200);

    const { UNCOMMITTED_STATE_TTL_MS, uncommittedStateTtlMs } = await import(
      '../src/identity/uncommitted-state-policy.js'
    );
    expect(UNCOMMITTED_STATE_TTL_MS).toBe(72 * 60 * 60 * 1000);
    expect(Date.parse(saved.body.expiresAt) - Date.parse(saved.body.createdAt)).toBe(
      uncommittedStateTtlMs(),
    );
  });

  it('keeps one row per slot, and never moves the window on a re-save', async () => {
    const parent = await elevatedParentWithChild();
    const first = await save(parent.token, {
      studentProfileId: parent.profileId,
      kind: 'DraftEdit',
      payload: DRAFT,
    }).expect(200);

    const second = await save(parent.token, {
      studentProfileId: parent.profileId,
      kind: 'DraftEdit',
      payload: { ...DRAFT, at: 9 },
    }).expect(200);

    expect(second.body.id).toBe(first.body.id);
    expect(second.body.payload).toEqual({ ...DRAFT, at: 9 });
    // Re-saving is not a way to buy another 72 hours.
    expect(second.body.createdAt).toBe(first.body.createdAt);
    expect(second.body.expiresAt).toBe(first.body.expiresAt);
    // `updatedAt` is the one instant that does move: it is what says the slot
    // was touched at all, while `createdAt` is what the window hangs off.
    expect(Date.parse(second.body.updatedAt)).toBeGreaterThanOrEqual(
      Date.parse(first.body.updatedAt),
    );
    expect(Date.parse(second.body.updatedAt)).toBeGreaterThanOrEqual(
      Date.parse(second.body.createdAt),
    );
    expect(await h.prisma.uncommittedState.count()).toBe(1);
  });

  it('survives two saves racing into one empty slot', async () => {
    const parent = await elevatedParentWithChild();

    // Both find the slot empty and both try to create it. One loses the unique
    // index — and a 500 on the write whose whole purpose is not losing work is
    // exactly what must not happen.
    const [first, second] = await Promise.all([
      save(parent.token, {
        studentProfileId: parent.profileId,
        kind: 'DraftEdit',
        payload: { ...DRAFT, at: 1 },
      }),
      save(parent.token, {
        studentProfileId: parent.profileId,
        kind: 'DraftEdit',
        payload: { ...DRAFT, at: 2 },
      }),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    // One slot, one row, and both callers were handed the same one.
    expect(await h.prisma.uncommittedState.count()).toBe(1);
    expect(first.body.id).toBe(second.body.id);
    // Whichever won, the surviving payload is one of the two that were sent.
    const row = await h.prisma.uncommittedState.findFirstOrThrow();
    expect([1, 2]).toContain((row.payload as { at: number }).at);
  });

  it('separates slots by kind and by scope', async () => {
    const parent = await elevatedParentWithChild();
    for (const body of [
      { kind: 'DraftEdit', scope: 'test-1', payload: { a: 1 } },
      { kind: 'DraftEdit', scope: 'test-2', payload: { a: 2 } },
      { kind: 'GradeOverride', scope: 'test-1', payload: { a: 3 } },
      // No scope at all is the `''` slot, distinct from every named one.
      { kind: 'PartialUpload', payload: { a: 4 } },
    ]) {
      await save(parent.token, { ...body, studentProfileId: parent.profileId }).expect(200);
    }

    const restored = await read(parent.token, parent.profileId).expect(200);
    expect(restored.body).toHaveLength(4);
    expect(restored.body.map((row: { scope: string }) => row.scope)).toContain('');

    // Newest first, stated in the service and asserted here: an order-insensitive
    // check would let `desc` flip to `asc` and still ship green.
    const created = restored.body.map((row: { createdAt: string }) => Date.parse(row.createdAt));
    expect(created).toEqual([...created].sort((a, b) => b - a));
    // The last slot saved is the one at the front.
    expect(restored.body[0].kind).toBe('PartialUpload');
  });

  it('trims the scope, so one slot cannot be addressed by two spellings', async () => {
    const parent = await elevatedParentWithChild();
    const first = await save(parent.token, {
      studentProfileId: parent.profileId,
      kind: 'DraftEdit',
      scope: 's',
      payload: { a: 1 },
    }).expect(200);

    const second = await save(parent.token, {
      studentProfileId: parent.profileId,
      kind: 'DraftEdit',
      scope: '  s  ',
      payload: { a: 2 },
    }).expect(200);

    expect(second.body.id).toBe(first.body.id);
    expect(second.body.scope).toBe('s');
    expect(await h.prisma.uncommittedState.count()).toBe(1);
  });

  it('refuses a scope one character over the cap', async () => {
    const parent = await elevatedParentWithChild();
    await save(parent.token, {
      studentProfileId: parent.profileId,
      kind: 'DraftEdit',
      scope: 'x'.repeat(SCOPE_MAX_LENGTH),
      payload: { a: 1 },
    }).expect(200);

    await save(parent.token, {
      studentProfileId: parent.profileId,
      kind: 'DraftEdit',
      scope: 'x'.repeat(SCOPE_MAX_LENGTH + 1),
      payload: { a: 1 },
    }).expect(400);
    expect(await h.prisma.uncommittedState.count()).toBe(1);
  });

  // --- The gate -------------------------------------------------------------

  it('refuses every route to anything but an elevation bearer', async () => {
    const parent = await elevatedParentWithChild();

    // A device actually sitting in Student Mode, bound through the real route.
    const bind = await server()
      .post('/api/parent/student-mode')
      .set('Authorization', bearer(parent.token))
      .send({ studentProfileId: parent.profileId })
      .expect(204);
    const studentCookie = cookieHeader(studentCookieFrom(bind)!);

    await save(parent.token, {
      studentProfileId: parent.profileId,
      kind: 'DraftEdit',
      payload: DRAFT,
    }).expect(200);
    const rowId = (await h.prisma.uncommittedState.findFirstOrThrow()).id;

    const calls: Array<() => request.Test> = [
      () =>
        server()
          .put('/api/parent/uncommitted')
          .send({ studentProfileId: parent.profileId, kind: 'DraftEdit', payload: { a: 1 } }),
      () => server().get('/api/parent/uncommitted').query({ studentProfileId: parent.profileId }),
      () =>
        server()
          .get(`/api/parent/uncommitted/${rowId}`)
          .query({ studentProfileId: parent.profileId }),
      () => server().delete(`/api/parent/uncommitted/${rowId}`),
    ];

    // The elevation guard is the only door: no credential, the session cookie
    // alone, and the Student Mode cookie are all refused identically.
    for (const credential of [
      null,
      parent.cookie,
      studentCookie,
      `${parent.cookie}; ${studentCookie}`,
    ]) {
      for (const call of calls) {
        const pending = call();
        if (credential !== null) pending.set('Cookie', credential);
        const response = await pending.expect(401);
        expect(response.body.elevated).toBe(false);
      }
    }

    // And nothing on the way past the guard changed the row that was there.
    const row = await h.prisma.uncommittedState.findUniqueOrThrow({ where: { id: rowId } });
    expect(row.payload).toEqual(DRAFT);
  });

  // --- The profile key ------------------------------------------------------

  it('keeps a sibling’s list empty, and refuses a save naming an unknown profile', async () => {
    const parent = await elevatedParentWithChild('Plus');
    const grade = await createGradeLevel(h);
    const sibling = await createStudentProfile(h, parent.parentAccountId, {
      gradeLevelId: grade.id,
    });

    await save(parent.token, {
      studentProfileId: parent.profileId,
      kind: 'DraftEdit',
      payload: DRAFT,
    }).expect(200);

    // Same account, different child: nothing of the first child's work is here.
    const sibs = await read(parent.token, sibling.id).expect(200);
    expect(sibs.body).toEqual([]);

    // And a save naming an unknown profile is a 404, not a row bound to nothing.
    const unknown = await save(parent.token, {
      studentProfileId: randomUUID(),
      kind: 'DraftEdit',
      payload: DRAFT,
    }).expect(404);
    expect(messagesOf(unknown)).toContain(PROFILE_NOT_FOUND);
    expect(await h.prisma.uncommittedState.count()).toBe(1);
  });

  it('refuses a row read into a different profile rather than rebinding it', async () => {
    const parent = await elevatedParentWithChild('Plus');
    const grade = await createGradeLevel(h);
    const sibling = await createStudentProfile(h, parent.parentAccountId, {
      gradeLevelId: grade.id,
    });

    const saved = await save(parent.token, {
      studentProfileId: parent.profileId,
      kind: 'DraftEdit',
      payload: DRAFT,
    }).expect(200);

    // Named with the profile it was saved under, it comes back.
    const own = await readItem(parent.token, saved.body.id, parent.profileId).expect(200);
    expect(own.body.payload).toEqual(DRAFT);

    // Named with a sibling's, it is refused — AD-33: refused, never silently
    // rebound into whichever child the device is in front of now.
    const crossed = await readItem(parent.token, saved.body.id, sibling.id).expect(404);
    expect(messagesOf(crossed)).toContain(UNCOMMITTED_STATE_NOT_FOUND);

    // And the row is exactly as it was: nothing was moved, nothing rewritten.
    const row = await h.prisma.uncommittedState.findUniqueOrThrow({ where: { id: saved.body.id } });
    expect(row.studentProfileId).toBe(parent.profileId);
    expect(row.payload).toEqual(DRAFT);
    expect(row.createdAt.toISOString()).toBe(saved.body.createdAt);
    expect(row.expiresAt.toISOString()).toBe(saved.body.expiresAt);
  });

  it('answers the by-id read’s every failure identically, leaking no existence', async () => {
    const parent = await elevatedParentWithChild('Family');
    const other = await elevatedParentWithChild();
    const grade = await createGradeLevel(h);
    const sibling = await createStudentProfile(h, parent.parentAccountId, {
      gradeLevelId: grade.id,
    });
    const archived = await createStudentProfile(h, parent.parentAccountId, {
      gradeLevelId: grade.id,
    });
    await server()
      .post(`/api/parent/students/${archived.id}/archive`)
      .set('Authorization', bearer(parent.token))
      .expect(204);

    const saved = await save(parent.token, {
      studentProfileId: parent.profileId,
      kind: 'DraftEdit',
      payload: DRAFT,
    }).expect(200);
    const expired = await save(parent.token, {
      studentProfileId: parent.profileId,
      kind: 'GradeOverride',
      payload: DRAFT,
    }).expect(200);
    await expireSlot(expired.body.id);

    // Row under a sibling, unknown row, expired row, archived profile, another
    // account's profile, unknown profile — one answer for all six.
    const refusals = [
      [saved.body.id, sibling.id],
      [randomUUID(), parent.profileId],
      [expired.body.id, parent.profileId],
      [saved.body.id, archived.id],
      [saved.body.id, other.profileId],
      [saved.body.id, randomUUID()],
    ] as const;

    for (const [id, profileId] of refusals) {
      const refused = await readItem(parent.token, id, profileId).expect(404);
      expect(messagesOf(refused)).toEqual([UNCOMMITTED_STATE_NOT_FOUND]);
    }
  });

  it('refuses a by-id read that names no profile, rather than inferring one', async () => {
    const parent = await elevatedParentWithChild();
    const saved = await save(parent.token, {
      studentProfileId: parent.profileId,
      kind: 'DraftEdit',
      payload: DRAFT,
    }).expect(200);

    // Naming the profile is the whole of the refusal mechanism: a read allowed
    // to omit it would be a read that rebinds by default.
    await server()
      .get(`/api/parent/uncommitted/${saved.body.id}`)
      .set('Authorization', bearer(parent.token))
      .expect(400);
  });

  it('answers 404 once the profile is archived, and leaves the row alone', async () => {
    const parent = await elevatedParentWithChild();
    const saved = await save(parent.token, {
      studentProfileId: parent.profileId,
      kind: 'DraftEdit',
      payload: DRAFT,
    }).expect(200);

    await server()
      .post(`/api/parent/students/${parent.profileId}/archive`)
      .set('Authorization', bearer(parent.token))
      .expect(204);

    const refused = await read(parent.token, parent.profileId).expect(404);
    expect(messagesOf(refused)).toContain(PROFILE_NOT_FOUND);
    // Archiving's whole effect is that the profile leaves the list a read may
    // name. The row itself is untouched.
    const row = await h.prisma.uncommittedState.findUniqueOrThrow({ where: { id: saved.body.id } });
    expect(row.payload).toEqual(DRAFT);
  });

  it('answers 404 for another account’s profile id, indistinguishably from an unknown one', async () => {
    const parent = await elevatedParentWithChild();
    const other = await elevatedParentWithChild();

    const foreign = await read(parent.token, other.profileId).expect(404);
    const unknown = await read(parent.token, randomUUID()).expect(404);
    // No cross-account existence signal: the two rejections are the same.
    expect(messagesOf(foreign)).toEqual(messagesOf(unknown));
    expect(foreign.status).toBe(unknown.status);
  });

  // --- The TTL --------------------------------------------------------------

  it('never returns an expired row, and sweeps it on the next save', async () => {
    const parent = await elevatedParentWithChild();
    const dead = await save(parent.token, {
      studentProfileId: parent.profileId,
      kind: 'DraftEdit',
      scope: 'old',
      payload: DRAFT,
    }).expect(200);
    await expireSlot(dead.body.id);

    // Invisible the instant the clock passes, whether or not a sweep has run.
    expect((await read(parent.token, parent.profileId).expect(200)).body).toEqual([]);

    // A save is what runs the sweep here; the bytes go with it.
    await save(parent.token, {
      studentProfileId: parent.profileId,
      kind: 'GradeOverride',
      payload: { a: 1 },
    }).expect(200);
    expect(await h.prisma.uncommittedState.findUnique({ where: { id: dead.body.id } })).toBeNull();
  });

  it('gives a save onto an expired slot a fresh window rather than resurrecting it', async () => {
    const parent = await elevatedParentWithChild();
    const first = await save(parent.token, {
      studentProfileId: parent.profileId,
      kind: 'DraftEdit',
      payload: DRAFT,
    }).expect(200);
    await expireSlot(first.body.id);

    const replacement = await save(parent.token, {
      studentProfileId: parent.profileId,
      kind: 'DraftEdit',
      payload: { ...DRAFT, at: 11 },
    }).expect(200);

    expect(replacement.body.id).not.toBe(first.body.id);
    expect(Date.parse(replacement.body.expiresAt)).toBeGreaterThan(Date.now());
    expect(replacement.body.payload).toEqual({ ...DRAFT, at: 11 });
    // One row in the slot: the dead one did not come back beside it.
    expect(await h.prisma.uncommittedState.count()).toBe(1);
  });

  // --- The input contract ---------------------------------------------------

  it('refuses a payload over the ceiling, quoting the limit and no content', async () => {
    const parent = await elevatedParentWithChild();
    const secret = 'Noah-got-question-4-wrong';
    const filler = 'x'.repeat(UNCOMMITTED_PAYLOAD_MAX_BYTES);
    const payload = { secret, filler };
    expect(payloadByteLength(payload)).toBeGreaterThan(UNCOMMITTED_PAYLOAD_MAX_BYTES);

    const refused = await save(parent.token, {
      studentProfileId: parent.profileId,
      kind: 'DraftEdit',
      payload,
    }).expect(400);

    const messages = messagesOf(refused).join(' ');
    expect(messages).toContain(String(UNCOMMITTED_PAYLOAD_MAX_BYTES));
    // AD-20: no payload content reaches an error message.
    expect(messages).not.toContain(secret);
    expect(messages).not.toContain('xxx');
    expect(await h.prisma.uncommittedState.count()).toBe(0);
  });

  it('refuses a kind outside the declared list', async () => {
    const parent = await elevatedParentWithChild();
    await save(parent.token, {
      studentProfileId: parent.profileId,
      kind: 'SomethingEpicSevenInvented',
      payload: DRAFT,
    }).expect(400);
    expect(await h.prisma.uncommittedState.count()).toBe(0);
  });

  it('refuses a body that names a field the contract does not declare', async () => {
    const parent = await elevatedParentWithChild();
    await save(parent.token, {
      studentProfileId: parent.profileId,
      kind: 'DraftEdit',
      payload: DRAFT,
      parentAccountId: randomUUID(),
    }).expect(400);
  });

  it('refuses a payload that is not a JSON object', async () => {
    const parent = await elevatedParentWithChild();
    for (const payload of ['just a string', 42, null, ['a', 'list']]) {
      await save(parent.token, {
        studentProfileId: parent.profileId,
        kind: 'DraftEdit',
        payload,
      }).expect(400);
    }
    expect(await h.prisma.uncommittedState.count()).toBe(0);
  });

  it('refuses a read that names no profile', async () => {
    const parent = await elevatedParentWithChild();
    await server()
      .get('/api/parent/uncommitted')
      .set('Authorization', bearer(parent.token))
      .expect(400);
  });

  // --- Discard --------------------------------------------------------------

  it('discards idempotently, and only within the account', async () => {
    const parent = await elevatedParentWithChild();
    const other = await elevatedParentWithChild();
    const saved = await save(parent.token, {
      studentProfileId: parent.profileId,
      kind: 'DraftEdit',
      payload: DRAFT,
    }).expect(200);

    // Another account's bearer deletes nothing and says nothing about the row.
    await server()
      .delete(`/api/parent/uncommitted/${saved.body.id}`)
      .set('Authorization', bearer(other.token))
      .expect(204);
    expect(await h.prisma.uncommittedState.count()).toBe(1);

    await server()
      .delete(`/api/parent/uncommitted/${saved.body.id}`)
      .set('Authorization', bearer(parent.token))
      .expect(204);
    // And again: idempotent.
    await server()
      .delete(`/api/parent/uncommitted/${saved.body.id}`)
      .set('Authorization', bearer(parent.token))
      .expect(204);
    expect(await h.prisma.uncommittedState.count()).toBe(0);
  });

  it('refuses an id that is not a UUID rather than scanning for it', async () => {
    const parent = await elevatedParentWithChild();
    await server()
      .delete('/api/parent/uncommitted/not-a-uuid')
      .set('Authorization', bearer(parent.token))
      .expect(400);
  });

  // --- Cascades -------------------------------------------------------------

  it('takes the rows with the profile, leaving no tombstone', async () => {
    const parent = await elevatedParentWithChild();
    await save(parent.token, {
      studentProfileId: parent.profileId,
      kind: 'DraftEdit',
      payload: DRAFT,
    }).expect(200);

    await h.prisma.studentProfile.delete({ where: { id: parent.profileId } });
    expect(await h.prisma.uncommittedState.count()).toBe(0);
  });

  it('takes the rows with the account too', async () => {
    const parent = await elevatedParentWithChild();
    await save(parent.token, {
      studentProfileId: parent.profileId,
      kind: 'DraftEdit',
      payload: DRAFT,
    }).expect(200);

    await h.prisma.studentProfile.deleteMany({
      where: { parentAccountId: parent.parentAccountId },
    });
    await h.prisma.parentAccount.delete({ where: { id: parent.parentAccountId } });
    expect(await h.prisma.uncommittedState.count()).toBe(0);
  });
});
