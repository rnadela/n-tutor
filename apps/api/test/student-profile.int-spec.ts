import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';

const { DISPLAY_NAME_MAX_LENGTH, NAME_SHAPE, NOTHING_TO_CHANGE } = await import(
  '../src/identity/student-profile-policy.js'
);
const { CHANGES_IS_NOT_A_FIELD } = await import('../src/identity/dto/student-profile.dto.js');
const { GRADE_LEVEL_NOT_SELECTABLE, PROFILE_NOT_FOUND } = await import(
  '../src/identity/student-profile.service.js'
);
const {
  bearer,
  createGradeLevel,
  createHarness,
  createSignedInParent,
  createStudentProfile,
  elevate,
  resetParentAccounts,
  resetTaxonomy,
  setPinFor,
} = await import('./harness.js');

type Harness = Awaited<ReturnType<typeof createHarness>>;

const PIN = '4821';

describe('Student Profiles', () => {
  let h: Harness;
  const server = () => request(h.app.getHttpServer());

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(async () => {
    await h.close();
  });

  beforeEach(async () => {
    // Profiles first, then their two parents: the FKs are `Restrict`.
    await resetTaxonomy(h.prisma);
    await resetParentAccounts(h.prisma);
    h.mail.reset();
  });

  /** A parent standing inside Parent View, with the bearer its routes take. */
  async function elevatedParent(): Promise<{ parentAccountId: string; token: string }> {
    const parent = await createSignedInParent(h);
    await setPinFor(h, parent.cookie, PIN);
    const token = await elevate(h, parent.cookie, PIN);
    return { parentAccountId: parent.parentAccountId, token };
  }

  /**
   * A rejection's messages, however it was raised: the validation pipe answers
   * with an array, a service exception with one string. Both are compared
   * against the exported constant, never a regex — a reworded message has to
   * fail something.
   */
  const messagesOf = (response: { body: { message?: unknown } }): string[] => {
    const message = response.body.message;
    return Array.isArray(message) ? (message as string[]) : [String(message)];
  };

  const profileRow = (id: string) =>
    h.prisma.studentProfile.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        displayName: true,
        gradeLevelId: true,
        archivedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

  // --- The published figure ------------------------------------------------

  it('publishes the display-name bound on the policy, so the web restates none', async () => {
    const response = await server().get('/api/auth/policy').expect(200);
    expect(response.body.studentNameMaxLength).toBe(DISPLAY_NAME_MAX_LENGTH);
  });

  // --- The gate ------------------------------------------------------------

  it('refuses every route to a session cookie with no elevation bearer', async () => {
    const parent = await createSignedInParent(h);
    await setPinFor(h, parent.cookie, PIN);
    const grade = await createGradeLevel(h);

    // Built one at a time, and sent before the next is built: supertest binds
    // the server on construction, so a pre-built batch races itself.
    const calls: Array<() => request.Test> = [
      () => server().get('/api/parent/students'),
      () => server().get('/api/parent/students/selectable'),
      () => server().get('/api/parent/grade-levels'),
      () =>
        server().post('/api/parent/students').send({ displayName: 'Noah', gradeLevelId: grade.id }),
      () => server().patch(`/api/parent/students/${randomUUID()}`).send({ displayName: 'Noa' }),
      () => server().post(`/api/parent/students/${randomUUID()}/archive`),
      () => server().post(`/api/parent/students/${randomUUID()}/restore`),
    ];
    for (const call of calls) {
      const response = await call().set('Cookie', parent.cookie).expect(401);
      expect(response.body.elevated).toBe(false);
    }

    // And nothing was written on the way past the guard.
    expect(await h.prisma.studentProfile.count()).toBe(0);
  });

  // --- Create --------------------------------------------------------------

  it('creates a profile against the account, reading back the Grade Level name', async () => {
    const { parentAccountId, token } = await elevatedParent();
    const grade = await createGradeLevel(h, { name: 'Grade 4' });

    const response = await server()
      .post('/api/parent/students')
      .set('Authorization', bearer(token))
      .send({ displayName: 'Noah', gradeLevelId: grade.id })
      .expect(201);

    expect(response.body.displayName).toBe('Noah');
    expect(response.body.gradeLevelId).toBe(grade.id);
    expect(response.body.gradeLevelName).toBe('Grade 4');
    expect(response.body.archived).toBe(false);
    expect(response.body.archivedAt).toBeNull();

    const row = await profileRow(response.body.id);
    expect(row.displayName).toBe('Noah');
    expect(row.archivedAt).toBeNull();
    await expect(
      h.prisma.studentProfile.findFirstOrThrow({
        where: { id: row.id, parentAccountId },
        select: { id: true },
      }),
    ).resolves.toBeDefined();
  });

  it('normalises the stored name rather than keeping the keystrokes', async () => {
    const { token } = await elevatedParent();
    const grade = await createGradeLevel(h);

    const response = await server()
      .post('/api/parent/students')
      .set('Authorization', bearer(token))
      .send({ displayName: '  Noah   Smith  ', gradeLevelId: grade.id })
      .expect(201);
    expect(response.body.displayName).toBe('Noah Smith');
  });

  it('writes no row for a blank name, a missing name, or a name past the bound', async () => {
    const { token } = await elevatedParent();
    const grade = await createGradeLevel(h);

    for (const body of [
      { displayName: '   ', gradeLevelId: grade.id },
      { gradeLevelId: grade.id },
      { displayName: 'n'.repeat(DISPLAY_NAME_MAX_LENGTH + 1), gradeLevelId: grade.id },
    ]) {
      const response = await server()
        .post('/api/parent/students')
        .set('Authorization', bearer(token))
        .send(body)
        .expect(400);
      // One rule, one sentence, whichever way the name is wrong.
      expect(messagesOf(response)).toContain(NAME_SHAPE);
    }
    expect(await h.prisma.studentProfile.count()).toBe(0);
  });

  it('accepts a name of exactly the bound', async () => {
    const { token } = await elevatedParent();
    const grade = await createGradeLevel(h);
    await server()
      .post('/api/parent/students')
      .set('Authorization', bearer(token))
      .send({ displayName: 'n'.repeat(DISPLAY_NAME_MAX_LENGTH), gradeLevelId: grade.id })
      .expect(201);
  });

  it('writes no row without a Grade Level — exactly one is required', async () => {
    const { token } = await elevatedParent();
    await server()
      .post('/api/parent/students')
      .set('Authorization', bearer(token))
      .send({ displayName: 'Noah' })
      .expect(400);
    expect(await h.prisma.studentProfile.count()).toBe(0);
  });

  it('answers 404 for a Grade Level that does not exist, and writes nothing', async () => {
    const { token } = await elevatedParent();
    await server()
      .post('/api/parent/students')
      .set('Authorization', bearer(token))
      .send({ displayName: 'Noah', gradeLevelId: randomUUID() })
      .expect(404);
    expect(await h.prisma.studentProfile.count()).toBe(0);
  });

  it('refuses a disabled Grade Level as not selectable, and writes nothing', async () => {
    const { token } = await elevatedParent();
    const grade = await createGradeLevel(h, { enabled: false });

    const response = await server()
      .post('/api/parent/students')
      .set('Authorization', bearer(token))
      .send({ displayName: 'Noah', gradeLevelId: grade.id })
      .expect(400);
    expect(messagesOf(response)).toContain(GRADE_LEVEL_NOT_SELECTABLE);
    expect(await h.prisma.studentProfile.count()).toBe(0);
  });

  it('offers only enabled Grade Levels for the choice', async () => {
    const { token } = await elevatedParent();
    const enabled = await createGradeLevel(h, { name: 'Grade 1' });
    const disabled = await createGradeLevel(h, { name: 'Grade 2', enabled: false });

    const response = await server()
      .get('/api/parent/grade-levels')
      .set('Authorization', bearer(token))
      .expect(200);
    const ids = response.body.map((item: { id: string }) => item.id);
    expect(ids).toContain(enabled.id);
    expect(ids).not.toContain(disabled.id);
  });

  it('creates past any Account Tier figure — the cap is Epic 9, not this story', async () => {
    const { parentAccountId, token } = await elevatedParent();
    const grade = await createGradeLevel(h);
    // The account is `Free` by schema default; no figure is restated here.
    await expect(
      h.prisma.parentAccount.findUniqueOrThrow({
        where: { id: parentAccountId },
        select: { tier: true },
      }),
    ).resolves.toEqual({ tier: 'Free' });

    for (let index = 0; index < 6; index += 1) {
      await server()
        .post('/api/parent/students')
        .set('Authorization', bearer(token))
        .send({ displayName: `Child ${index}`, gradeLevelId: grade.id })
        .expect(201);
    }
    expect(await h.prisma.studentProfile.count({ where: { parentAccountId } })).toBe(6);
  });

  // --- Rename and Grade-Level change ---------------------------------------

  it('renames without touching the id, the createdAt or the Grade Level', async () => {
    const { parentAccountId, token } = await elevatedParent();
    const grade = await createGradeLevel(h);
    const created = await createStudentProfile(h, parentAccountId, {
      displayName: 'Noah',
      gradeLevelId: grade.id,
    });
    const before = await profileRow(created.id);

    const response = await server()
      .patch(`/api/parent/students/${created.id}`)
      .set('Authorization', bearer(token))
      .send({ displayName: 'Noa' })
      .expect(200);

    expect(response.body.id).toBe(created.id);
    expect(response.body.displayName).toBe('Noa');
    expect(response.body.gradeLevelId).toBe(created.gradeLevelId);
    expect(response.body.createdAt).toBe(created.createdAt);
    expect(await h.prisma.studentProfile.count()).toBe(1);
    // A genuine write, unlike the no-op cases above: `updatedAt` must advance.
    expect((await profileRow(created.id)).updatedAt).not.toEqual(before.updatedAt);
  });

  it('changes the Grade Level without touching the name', async () => {
    const { parentAccountId, token } = await elevatedParent();
    const first = await createGradeLevel(h, { name: 'Grade 1' });
    const second = await createGradeLevel(h, { name: 'Grade 2' });
    const created = await createStudentProfile(h, parentAccountId, {
      displayName: 'Noah',
      gradeLevelId: first.id,
    });
    const before = await profileRow(created.id);

    const response = await server()
      .patch(`/api/parent/students/${created.id}`)
      .set('Authorization', bearer(token))
      .send({ gradeLevelId: second.id })
      .expect(200);

    expect(response.body.id).toBe(created.id);
    expect(response.body.displayName).toBe('Noah');
    expect(response.body.gradeLevelId).toBe(second.id);
    expect(response.body.gradeLevelName).toBe('Grade 2');
    expect(response.body.createdAt).toBe(created.createdAt);
    // A genuine write, unlike the no-op cases above: `updatedAt` must advance.
    expect((await profileRow(created.id)).updatedAt).not.toEqual(before.updatedAt);
  });

  it('re-normalises a renamed name rather than storing the keystrokes', async () => {
    const { parentAccountId, token } = await elevatedParent();
    const grade = await createGradeLevel(h);
    const created = await createStudentProfile(h, parentAccountId, { gradeLevelId: grade.id });

    const response = await server()
      .patch(`/api/parent/students/${created.id}`)
      .set('Authorization', bearer(token))
      .send({ displayName: '  Noah   Smith  ' })
      .expect(200);

    expect(response.body.displayName).toBe('Noah Smith');
    expect((await profileRow(created.id)).displayName).toBe('Noah Smith');
  });

  it('rejects a patch that names nothing to change', async () => {
    const { parentAccountId, token } = await elevatedParent();
    const grade = await createGradeLevel(h);
    const created = await createStudentProfile(h, parentAccountId, { gradeLevelId: grade.id });
    const before = await profileRow(created.id);

    const response = await server()
      .patch(`/api/parent/students/${created.id}`)
      .set('Authorization', bearer(token))
      .send({})
      .expect(400);
    expect(messagesOf(response)).toContain(NOTHING_TO_CHANGE);

    expect((await profileRow(created.id)).updatedAt).toEqual(before.updatedAt);
  });

  it('refuses a body naming `changes` — the rule’s carrier is not a field', async () => {
    const { parentAccountId, token } = await elevatedParent();
    const grade = await createGradeLevel(h);
    const created = await createStudentProfile(h, parentAccountId, { gradeLevelId: grade.id });
    const before = await profileRow(created.id);

    const response = await server()
      .patch(`/api/parent/students/${created.id}`)
      .set('Authorization', bearer(token))
      .send({ displayName: 'Noa', changes: 'anything' })
      .expect(400);
    expect(messagesOf(response)).toContain(CHANGES_IS_NOT_A_FIELD);

    expect((await profileRow(created.id)).updatedAt).toEqual(before.updatedAt);
  });

  it('answers 404 for a patch naming a Grade Level that does not exist', async () => {
    const { parentAccountId, token } = await elevatedParent();
    const grade = await createGradeLevel(h);
    const created = await createStudentProfile(h, parentAccountId, { gradeLevelId: grade.id });
    const before = await profileRow(created.id);

    await server()
      .patch(`/api/parent/students/${created.id}`)
      .set('Authorization', bearer(token))
      .send({ gradeLevelId: randomUUID() })
      .expect(404);

    expect(await profileRow(created.id)).toEqual(before);
  });

  it('rejects an id that is not a UUID at the pipe, with 400 rather than 404', async () => {
    const { token } = await elevatedParent();
    // The path never reaches a handler, so nothing is looked up and the answer
    // says the id is malformed — not that some profile was not found.
    for (const path of [
      '/api/parent/students/not-a-uuid',
      '/api/parent/students/not-a-uuid/archive',
      '/api/parent/students/not-a-uuid/restore',
    ]) {
      const response = await (
        path.endsWith('uuid')
          ? server().patch(path).send({ displayName: 'Noah' })
          : server().post(path)
      )
        .set('Authorization', bearer(token))
        .expect(400);
      expect(messagesOf(response).join(' ')).not.toContain(PROFILE_NOT_FOUND);
    }
  });

  it('refuses a change onto a disabled Grade Level, leaving the stored one', async () => {
    const { parentAccountId, token } = await elevatedParent();
    const grade = await createGradeLevel(h);
    const disabled = await createGradeLevel(h, { enabled: false });
    const created = await createStudentProfile(h, parentAccountId, { gradeLevelId: grade.id });

    await server()
      .patch(`/api/parent/students/${created.id}`)
      .set('Authorization', bearer(token))
      .send({ gradeLevelId: disabled.id })
      .expect(400);

    expect((await profileRow(created.id)).gradeLevelId).toBe(grade.id);
  });

  // --- The reference survives Admin changes --------------------------------

  it('reads the Grade Level’s new name after an Admin rename, without writing the row', async () => {
    const { parentAccountId, token } = await elevatedParent();
    const grade = await createGradeLevel(h, { name: 'Grade 4' });
    const created = await createStudentProfile(h, parentAccountId, { gradeLevelId: grade.id });
    const before = await profileRow(created.id);

    await h.taxonomy.renameGradeLevel(h.operatorId, grade.id, 'Year 4');

    const response = await server()
      .get('/api/parent/students')
      .set('Authorization', bearer(token))
      .expect(200);
    expect(response.body[0].gradeLevelId).toBe(grade.id);
    expect(response.body[0].gradeLevelName).toBe('Year 4');

    // No consumer holds a copied label, so the profile row was never written.
    const after = await profileRow(created.id);
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(after.displayName).toBe(before.displayName);
  });

  it('keeps resolving and keeps listing after the Grade Level is disabled', async () => {
    const { parentAccountId, token } = await elevatedParent();
    const grade = await createGradeLevel(h, { name: 'Grade 4' });
    const created = await createStudentProfile(h, parentAccountId, { gradeLevelId: grade.id });
    const before = await profileRow(created.id);

    await h.taxonomy.setGradeLevelEnabled(h.operatorId, grade.id, false);

    const list = await server()
      .get('/api/parent/students')
      .set('Authorization', bearer(token))
      .expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].gradeLevelName).toBe('Grade 4');
    // Stated on the read, so the screen can say the stored choice is no longer
    // offered without inventing the fact.
    expect(list.body[0].gradeLevelEnabled).toBe(false);

    const selectable = await server()
      .get('/api/parent/students/selectable')
      .set('Authorization', bearer(token))
      .expect(200);
    expect(selectable.body).toHaveLength(1);

    expect((await profileRow(created.id)).updatedAt).toEqual(before.updatedAt);
  });

  // --- Archive and restore -------------------------------------------------

  it('archives without destroying anything, and drops out of the selectable list', async () => {
    const { parentAccountId, token } = await elevatedParent();
    const grade = await createGradeLevel(h);
    const created = await createStudentProfile(h, parentAccountId, {
      displayName: 'Noah',
      gradeLevelId: grade.id,
    });
    const before = await profileRow(created.id);

    await server()
      .post(`/api/parent/students/${created.id}/archive`)
      .set('Authorization', bearer(token))
      .expect(204);

    const after = await profileRow(created.id);
    expect(after.id).toBe(before.id);
    expect(after.createdAt).toEqual(before.createdAt);
    expect(after.displayName).toBe(before.displayName);
    expect(after.gradeLevelId).toBe(before.gradeLevelId);
    expect(after.archivedAt).not.toBeNull();

    const selectable = await server()
      .get('/api/parent/students/selectable')
      .set('Authorization', bearer(token))
      .expect(200);
    expect(selectable.body).toEqual([]);

    const list = await server()
      .get('/api/parent/students')
      .set('Authorization', bearer(token))
      .expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].archived).toBe(true);
    expect(list.body[0].archivedAt).not.toBeNull();
  });

  it('is idempotent: archiving twice leaves the original instant in place', async () => {
    const { parentAccountId, token } = await elevatedParent();
    const grade = await createGradeLevel(h);
    const created = await createStudentProfile(h, parentAccountId, { gradeLevelId: grade.id });

    await server()
      .post(`/api/parent/students/${created.id}/archive`)
      .set('Authorization', bearer(token))
      .expect(204);
    const first = await profileRow(created.id);

    await server()
      .post(`/api/parent/students/${created.id}/archive`)
      .set('Authorization', bearer(token))
      .expect(204);
    const second = await profileRow(created.id);

    expect(second.archivedAt).toEqual(first.archivedAt);
    expect(second.updatedAt).toEqual(first.updatedAt);
  });

  it('restores an already-active profile as a no-op, writing nothing', async () => {
    const { parentAccountId, token } = await elevatedParent();
    const grade = await createGradeLevel(h);
    const created = await createStudentProfile(h, parentAccountId, { gradeLevelId: grade.id });
    const before = await profileRow(created.id);

    await server()
      .post(`/api/parent/students/${created.id}/restore`)
      .set('Authorization', bearer(token))
      .expect(204);

    expect(await profileRow(created.id)).toEqual(before);
  });

  it('restores an archived profile back into the selectable list, unchanged', async () => {
    const { parentAccountId, token } = await elevatedParent();
    const grade = await createGradeLevel(h);
    const created = await createStudentProfile(h, parentAccountId, {
      displayName: 'Noah',
      gradeLevelId: grade.id,
    });

    await server()
      .post(`/api/parent/students/${created.id}/archive`)
      .set('Authorization', bearer(token))
      .expect(204);
    await server()
      .post(`/api/parent/students/${created.id}/restore`)
      .set('Authorization', bearer(token))
      .expect(204);

    const row = await profileRow(created.id);
    expect(row.archivedAt).toBeNull();
    expect(row.displayName).toBe('Noah');
    expect(row.createdAt).toEqual(new Date(created.createdAt));

    const selectable = await server()
      .get('/api/parent/students/selectable')
      .set('Authorization', bearer(token))
      .expect(200);
    expect(selectable.body.map((item: { id: string }) => item.id)).toEqual([created.id]);
  });

  // --- Another account's profile -------------------------------------------

  it('answers 404 — never 403 — for an id belonging to another account', async () => {
    const grade = await createGradeLevel(h);
    const accountA = await elevatedParent();
    const accountB = await elevatedParent();
    const owned = await createStudentProfile(h, accountA.parentAccountId, {
      displayName: 'Noah',
      gradeLevelId: grade.id,
    });
    const before = await profileRow(owned.id);

    const asB = bearer(accountB.token);
    await server()
      .patch(`/api/parent/students/${owned.id}`)
      .set('Authorization', asB)
      .send({ displayName: 'Taken' })
      .expect(404);
    await server()
      .post(`/api/parent/students/${owned.id}/archive`)
      .set('Authorization', asB)
      .expect(404);
    await server()
      .post(`/api/parent/students/${owned.id}/restore`)
      .set('Authorization', asB)
      .expect(404);

    // Nothing of account A's leaked into B's reads, and nothing was written.
    const list = await server().get('/api/parent/students').set('Authorization', asB).expect(200);
    expect(list.body).toEqual([]);
    const selectable = await server()
      .get('/api/parent/students/selectable')
      .set('Authorization', asB)
      .expect(200);
    expect(selectable.body).toEqual([]);

    expect(await profileRow(owned.id)).toEqual(before);
  });

  it('scopes the write itself, so another account’s row is not touched', async () => {
    const grade = await createGradeLevel(h, { name: 'Grade 1' });
    const other = await createGradeLevel(h, { name: 'Grade 2' });
    const accountA = await elevatedParent();
    const accountB = await elevatedParent();
    const owned = await createStudentProfile(h, accountA.parentAccountId, {
      displayName: 'Noah',
      gradeLevelId: grade.id,
    });
    const before = await profileRow(owned.id);

    // Every write shape, each one valid on its own terms: only the account is
    // wrong, and the row must be identical afterwards — `updatedAt` included.
    const asB = bearer(accountB.token);
    await server()
      .patch(`/api/parent/students/${owned.id}`)
      .set('Authorization', asB)
      .send({ gradeLevelId: other.id })
      .expect(404);
    await server()
      .patch(`/api/parent/students/${owned.id}`)
      .set('Authorization', asB)
      .send({ displayName: 'Taken', gradeLevelId: other.id })
      .expect(404);
    await server()
      .post(`/api/parent/students/${owned.id}/archive`)
      .set('Authorization', asB)
      .expect(404);

    expect(await profileRow(owned.id)).toEqual(before);
  });

  // --- Ordering ------------------------------------------------------------

  it('orders both lists by name, and lists only the active ones as selectable', async () => {
    const { parentAccountId, token } = await elevatedParent();
    const grade = await createGradeLevel(h);
    for (const displayName of ['Zoe', 'Ada', 'Noah']) {
      await createStudentProfile(h, parentAccountId, { displayName, gradeLevelId: grade.id });
    }
    const archived = await createStudentProfile(h, parentAccountId, {
      displayName: 'Beth',
      gradeLevelId: grade.id,
    });
    await server()
      .post(`/api/parent/students/${archived.id}/archive`)
      .set('Authorization', bearer(token))
      .expect(204);

    const names = (body: Array<{ displayName: string }>) => body.map((item) => item.displayName);

    const list = await server()
      .get('/api/parent/students')
      .set('Authorization', bearer(token))
      .expect(200);
    expect(names(list.body)).toEqual(['Ada', 'Beth', 'Noah', 'Zoe']);

    const selectable = await server()
      .get('/api/parent/students/selectable')
      .set('Authorization', bearer(token))
      .expect(200);
    expect(names(selectable.body)).toEqual(['Ada', 'Noah', 'Zoe']);
  });

  it('answers 404 for an id that exists nowhere at all', async () => {
    const { token } = await elevatedParent();
    await server()
      .patch(`/api/parent/students/${randomUUID()}`)
      .set('Authorization', bearer(token))
      .send({ displayName: 'Noah' })
      .expect(404);
  });
});
