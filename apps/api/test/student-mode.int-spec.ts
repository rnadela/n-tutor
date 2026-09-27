import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const { PARENT_SESSION_COOKIE, PARENT_SESSION_ISSUER } = await import(
  '../src/identity/auth-policy.js'
);
const {
  BINDING_FAILED,
  NOT_BOUND,
  STUDENT_MODE_AUDIENCE,
  STUDENT_MODE_COOKIE,
  STUDENT_MODE_TTL_SECONDS,
} = await import('../src/identity/student-mode-policy.js');
const { PROFILE_NOT_FOUND } = await import('../src/identity/student-profile.service.js');
const { StudentModeService } = await import('../src/identity/student-mode.service.js');
const { optionalBoolEnv } = await import('../src/common/env.js');
const {
  bearer,
  bindDevice,
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
  studentTokenWithClaims,
} = await import('./harness.js');

type Harness = Awaited<ReturnType<typeof createHarness>>;

const PIN = '4821';
const PASSWORD = 'correct-horse-battery-staple';

describe('Student Mode and the device binding', () => {
  let h: Harness;
  const server = () => request(h.app.getHttpServer());

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(async () => {
    await h.close();
  });

  beforeEach(async () => {
    // Profiles first, then their parents: the FKs are `Restrict`.
    await resetTaxonomy(h.prisma);
    await resetParentAccounts(h.prisma);
    h.mail.reset();
    vi.restoreAllMocks();
  });

  /** A parent standing inside Parent View, with the bearer its routes take. */
  async function elevatedParent(): Promise<{
    parentAccountId: string;
    email: string;
    cookie: string;
    token: string;
  }> {
    const parent = await createSignedInParent(h, { password: PASSWORD });
    await setPinFor(h, parent.cookie, PIN);
    const token = await elevate(h, parent.cookie, PIN);
    return { ...parent, token };
  }

  /** The profile a `student_mode` cookie names, read back over HTTP. */
  function readStudentSession(cookie: string): request.Test {
    return server().get('/api/student/session').set('Cookie', cookie);
  }

  // --- The first creation binds -------------------------------------------

  it('binds the device to the first profile as it is created', async () => {
    const parent = await elevatedParent();
    const grade = await createGradeLevel(h, { name: 'Grade 3' });

    const response = await server()
      .post('/api/parent/students')
      .set('Authorization', bearer(parent.token))
      .send({ displayName: 'Noah', gradeLevelId: grade.id })
      .expect(201);

    const setCookie = studentCookieFrom(response);
    expect(setCookie).not.toBeNull();

    const session = await readStudentSession(cookieHeader(setCookie!)).expect(200);
    expect(session.body.profile.id).toBe(response.body.id);
    expect(session.body.profile.displayName).toBe('Noah');
    expect(session.body.profile.gradeLevelName).toBe(grade.name);
  });

  it('leaves the binding on the first profile when a second is created', async () => {
    const parent = await elevatedParent();
    const grade = await createGradeLevel(h);

    const first = await server()
      .post('/api/parent/students')
      .set('Authorization', bearer(parent.token))
      .send({ displayName: 'Ada', gradeLevelId: grade.id })
      .expect(201);
    const bound = cookieHeader(studentCookieFrom(first)!);

    const second = await server()
      .post('/api/parent/students')
      .set('Authorization', bearer(parent.token))
      .send({ displayName: 'Bram', gradeLevelId: grade.id })
      .expect(201);
    // The second creation names no binding at all: rebinding is the exit's job.
    expect(studentCookieFrom(second)).toBeNull();

    const session = await readStudentSession(bound).expect(200);
    expect(session.body.profile.id).toBe(first.body.id);
    expect(session.body.profile.id).not.toBe(second.body.id);
  });

  it('binds a replacement created after the only profile was archived', async () => {
    const parent = await elevatedParent();
    const grade = await createGradeLevel(h);
    const only = await createStudentProfile(h, parent.parentAccountId, {
      displayName: 'Ada',
      gradeLevelId: grade.id,
    });
    await server()
      .post(`/api/parent/students/${only.id}/archive`)
      .set('Authorization', bearer(parent.token))
      .expect(204);

    // The account has a profile, but no *active* one, so the replacement is
    // again the first thing the device can be handed to.
    const replacement = await server()
      .post('/api/parent/students')
      .set('Authorization', bearer(parent.token))
      .send({ displayName: 'Bram', gradeLevelId: grade.id })
      .expect(201);
    expect(studentCookieFrom(replacement)).not.toBeNull();
  });

  it('keeps the 201 when the binding cannot be minted', async () => {
    const parent = await elevatedParent();
    const grade = await createGradeLevel(h);
    const mode = h.moduleRef.get(StudentModeService);
    vi.spyOn(mode, 'mintBinding').mockRejectedValue(new Error('Injected mint failure.'));

    const response = await server()
      .post('/api/parent/students')
      .set('Authorization', bearer(parent.token))
      .send({ displayName: 'Noah', gradeLevelId: grade.id })
      .expect(201);

    // The profile exists; only the convenience of an automatic binding is lost.
    expect(response.body.displayName).toBe('Noah');
    expect(studentCookieFrom(response)).toBeNull();
    expect(await h.prisma.studentProfile.count()).toBe(1);
  });

  // --- The deliberate exit -------------------------------------------------

  it('binds to the named profile on the deliberate exit', async () => {
    const parent = await elevatedParent();
    const grade = await createGradeLevel(h);
    const a = await createStudentProfile(h, parent.parentAccountId, {
      displayName: 'Ada',
      gradeLevelId: grade.id,
    });
    const b = await createStudentProfile(h, parent.parentAccountId, {
      displayName: 'Bram',
      gradeLevelId: grade.id,
    });

    const boundToB = await bindDevice(h, parent.token, b.id);
    let session = await readStudentSession(boundToB).expect(200);
    expect(session.body.profile.id).toBe(b.id);

    // And a rebind replaces the binding rather than adding a second cookie.
    const boundToA = await bindDevice(h, parent.token, a.id);
    session = await readStudentSession(boundToA).expect(200);
    expect(session.body.profile.id).toBe(a.id);
  });

  it('sets exactly one binding cookie, on the constants it publishes', async () => {
    const parent = await elevatedParent();
    const grade = await createGradeLevel(h);
    const profile = await createStudentProfile(h, parent.parentAccountId, {
      gradeLevelId: grade.id,
    });

    const response = await server()
      .post('/api/parent/student-mode')
      .set('Authorization', bearer(parent.token))
      .send({ studentProfileId: profile.id })
      .expect(204);

    const raw = response.headers['set-cookie'] as unknown as string[];
    const bindings = raw.filter((value) => value.startsWith(`${STUDENT_MODE_COOKIE}=`));
    expect(bindings).toHaveLength(1);

    const setCookie = bindings[0]!;
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toContain(`Max-Age=${STUDENT_MODE_TTL_SECONDS}`);
    // Secure is an explicit setting, never inferred from a build mode.
    expect(setCookie.includes('Secure')).toBe(optionalBoolEnv('COOKIE_SECURE', true));
  });

  it('refuses to bind to an archived profile, leaving the binding untouched', async () => {
    const parent = await elevatedParent();
    const grade = await createGradeLevel(h);
    const bound = await createStudentProfile(h, parent.parentAccountId, {
      displayName: 'Ada',
      gradeLevelId: grade.id,
    });
    const gone = await createStudentProfile(h, parent.parentAccountId, {
      displayName: 'Bram',
      gradeLevelId: grade.id,
    });
    const cookie = await bindDevice(h, parent.token, bound.id);
    await server()
      .post(`/api/parent/students/${gone.id}/archive`)
      .set('Authorization', bearer(parent.token))
      .expect(204);

    const refusal = await server()
      .post('/api/parent/student-mode')
      .set('Authorization', bearer(parent.token))
      .send({ studentProfileId: gone.id })
      .expect(404);
    expect(String(refusal.body.message)).toBe(PROFILE_NOT_FOUND);
    expect(studentCookieFrom(refusal)).toBeNull();

    // The device is still handed to the child it was handed to before.
    const session = await readStudentSession(cookie).expect(200);
    expect(session.body.profile.id).toBe(bound.id);
  });

  it('refuses to bind to another account’s profile with a 404, never a 403', async () => {
    const parentA = await elevatedParent();
    const parentB = await elevatedParent();
    const grade = await createGradeLevel(h);
    const theirs = await createStudentProfile(h, parentA.parentAccountId, {
      displayName: 'Ada',
      gradeLevelId: grade.id,
    });

    const refusal = await server()
      .post('/api/parent/student-mode')
      .set('Authorization', bearer(parentB.token))
      .send({ studentProfileId: theirs.id })
      .expect(404);

    // A 403 would confirm the row exists somewhere; nothing of it is read back.
    expect(String(refusal.body.message)).toBe(PROFILE_NOT_FOUND);
    expect(JSON.stringify(refusal.body)).not.toContain('Ada');
    expect(studentCookieFrom(refusal)).toBeNull();
  });

  it('refuses an unknown id, and a malformed one before the handler', async () => {
    const parent = await elevatedParent();

    await server()
      .post('/api/parent/student-mode')
      .set('Authorization', bearer(parent.token))
      .send({ studentProfileId: randomUUID() })
      .expect(404);

    await server()
      .post('/api/parent/student-mode')
      .set('Authorization', bearer(parent.token))
      .send({ studentProfileId: 'not-a-uuid' })
      .expect(400);
  });

  it('answers a 500, not the profile’s 404, when the account cannot be read', async () => {
    const parent = await elevatedParent();
    const grade = await createGradeLevel(h);
    const profile = await createStudentProfile(h, parent.parentAccountId, {
      gradeLevelId: grade.id,
    });
    // Only the controller's own lookup fails: the elevation guard makes the
    // same call first, and stubbing both would refuse at the guard instead and
    // never exercise the branch under test.
    const real = h.identity.findSessionSubject.bind(h.identity);
    let calls = 0;
    vi.spyOn(h.identity, 'findSessionSubject').mockImplementation(async (id: string) => {
      calls += 1;
      return calls === 1 ? real(id) : null;
    });

    const refusal = await server()
      .post('/api/parent/student-mode')
      .set('Authorization', bearer(parent.token))
      .send({ studentProfileId: profile.id })
      .expect(500);
    expect(String(refusal.body.message)).toBe(BINDING_FAILED);
  });

  it('refuses a bind that carries no elevation bearer', async () => {
    const parent = await elevatedParent();
    const grade = await createGradeLevel(h);
    const profile = await createStudentProfile(h, parent.parentAccountId, {
      gradeLevelId: grade.id,
    });

    const refusal = await server()
      .post('/api/parent/student-mode')
      .set('Cookie', parent.cookie)
      .send({ studentProfileId: profile.id })
      .expect(401);
    expect(refusal.body.elevated).toBe(false);
    expect(studentCookieFrom(refusal)).toBeNull();
  });

  // --- The student session read --------------------------------------------

  it('refuses a read from a device that was never bound', async () => {
    const refusal = await server().get('/api/student/session').expect(401);
    expect(String(refusal.body.message)).toBe(NOT_BOUND);
    expect(refusal.body.bound).toBe(false);
  });

  it('refuses the read once the bound profile is archived, clearing the cookie', async () => {
    const parent = await elevatedParent();
    const grade = await createGradeLevel(h);
    const profile = await createStudentProfile(h, parent.parentAccountId, {
      displayName: 'Ada',
      gradeLevelId: grade.id,
    });
    const cookie = await bindDevice(h, parent.token, profile.id);
    await readStudentSession(cookie).expect(200);

    await server()
      .post(`/api/parent/students/${profile.id}/archive`)
      .set('Authorization', bearer(parent.token))
      .expect(204);

    const refusal = await readStudentSession(cookie).expect(401);
    expect(refusal.body.bound).toBe(false);
    expect(JSON.stringify(refusal.body)).not.toContain('Ada');
    // The stale binding does not survive the read that rejected it.
    const cleared = studentCookieFrom(refusal);
    expect(cleared).not.toBeNull();
    expect(cleared).toMatch(/student_mode=;/u);
  });

  it('refuses the read after a password reset moves the account’s epoch', async () => {
    const parent = await elevatedParent();
    const grade = await createGradeLevel(h);
    const profile = await createStudentProfile(h, parent.parentAccountId, {
      gradeLevelId: grade.id,
    });
    const cookie = await bindDevice(h, parent.token, profile.id);

    await h.prisma.parentAccount.update({
      where: { id: parent.parentAccountId },
      data: { sessionEpoch: { increment: 1 } },
    });

    const refusal = await readStudentSession(cookie).expect(401);
    expect(refusal.body.bound).toBe(false);
    expect(studentCookieFrom(refusal)).not.toBeNull();
  });

  it('checks the binding claim by claim, not the audience alone', async () => {
    const parent = await elevatedParent();
    const grade = await createGradeLevel(h);
    const profile = await createStudentProfile(h, parent.parentAccountId, {
      gradeLevelId: grade.id,
    });
    const sound = {
      scope: STUDENT_MODE_AUDIENCE,
      sub: parent.parentAccountId,
      profile: profile.id,
      epoch: 0,
    };

    // The sound token is accepted, so each variation below isolates one claim.
    const good = await studentTokenWithClaims(h.parentJwt, sound, { expiresIn: 60 });
    await readStudentSession(`${STUDENT_MODE_COOKIE}=${good}`).expect(200);

    const variations: Array<Record<string, unknown>> = [
      { ...sound, scope: 'parent-session' },
      { ...sound, sub: '' },
      { ...sound, sub: randomUUID() },
      { ...sound, profile: '' },
      { ...sound, profile: randomUUID() },
      { ...sound, epoch: 1 },
      { ...sound, epoch: 'zero' },
    ];
    for (const claims of variations) {
      const token = await studentTokenWithClaims(h.parentJwt, claims, { expiresIn: 60 });
      const refusal = await readStudentSession(`${STUDENT_MODE_COOKIE}=${token}`).expect(401);
      expect(refusal.body.bound).toBe(false);
    }

    // And an expired binding is refused like any other dead credential.
    const expired = await h.parentJwt.signAsync(sound, {
      audience: STUDENT_MODE_AUDIENCE,
      issuer: PARENT_SESSION_ISSUER,
      expiresIn: -1,
    });
    await readStudentSession(`${STUDENT_MODE_COOKIE}=${expired}`).expect(401);
  });

  // --- The mode boundary ---------------------------------------------------

  it('refuses every parent route to a device holding only the binding', async () => {
    const parent = await elevatedParent();
    const grade = await createGradeLevel(h);
    const profile = await createStudentProfile(h, parent.parentAccountId, {
      displayName: 'Ada',
      gradeLevelId: grade.id,
    });
    const cookie = await bindDevice(h, parent.token, profile.id);

    const calls: Array<() => request.Test> = [
      () => server().get('/api/parent/students'),
      () => server().get('/api/parent/students/selectable'),
      () => server().get('/api/parent/grade-levels'),
      () => server().get('/api/parent/session'),
      () =>
        server().post('/api/parent/students').send({ displayName: 'Bram', gradeLevelId: grade.id }),
      () => server().post('/api/parent/student-mode').send({ studentProfileId: profile.id }),
      () => server().patch(`/api/parent/students/${profile.id}`).send({ displayName: 'Bram' }),
      () => server().post(`/api/parent/students/${profile.id}/archive`),
      () => server().post(`/api/parent/students/${profile.id}/restore`),
    ];
    for (const call of calls) {
      const refusal = await call().set('Cookie', cookie).expect(401);
      expect(refusal.body.elevated).toBe(false);
      // No profile, account or taxonomy data leaks past the guard.
      const body = JSON.stringify(refusal.body);
      expect(body).not.toContain('Ada');
      expect(body).not.toContain(grade.name);
      expect(body).not.toContain(parent.email);
    }
  });

  it('refuses the student read to an elevation bearer: the wrong audience', async () => {
    const parent = await elevatedParent();
    const grade = await createGradeLevel(h);
    const profile = await createStudentProfile(h, parent.parentAccountId, {
      gradeLevelId: grade.id,
    });
    await bindDevice(h, parent.token, profile.id);

    // The guard never reads `Authorization`, and the audiences differ anyway.
    const refusal = await server()
      .get('/api/student/session')
      .set('Authorization', bearer(parent.token))
      .expect(401);
    expect(refusal.body.bound).toBe(false);

    // Nor does the session cookie stand in for a binding.
    const withSession = await server()
      .get('/api/student/session')
      .set('Cookie', parent.cookie)
      .expect(401);
    expect(withSession.body.bound).toBe(false);
  });

  // --- The credential's lifetime -------------------------------------------

  it('clears both cookies on sign-out', async () => {
    const parent = await elevatedParent();
    const grade = await createGradeLevel(h);
    const profile = await createStudentProfile(h, parent.parentAccountId, {
      gradeLevelId: grade.id,
    });
    const cookie = await bindDevice(h, parent.token, profile.id);

    const response = await server()
      .post('/api/auth/sign-out')
      .set('Cookie', [parent.cookie, cookie].join('; '))
      .expect(204);

    const raw = response.headers['set-cookie'] as unknown as string[];
    expect(raw.some((value) => value.startsWith(`${PARENT_SESSION_COOKIE}=;`))).toBe(true);
    expect(raw.some((value) => value.startsWith(`${STUDENT_MODE_COOKIE}=;`))).toBe(true);
  });

  it('clears a binding left behind when another account signs in', async () => {
    const parent = await elevatedParent();
    const grade = await createGradeLevel(h);
    const profile = await createStudentProfile(h, parent.parentAccountId, {
      gradeLevelId: grade.id,
    });
    const cookie = await bindDevice(h, parent.token, profile.id);

    const other = await createSignedInParent(h, { password: PASSWORD });
    const signIn = await server()
      .post('/api/auth/sign-in')
      .set('Cookie', cookie)
      .send({ email: other.email, password: PASSWORD })
      .expect(200);

    const cleared = studentCookieFrom(signIn);
    expect(cleared).toMatch(/student_mode=;/u);
  });

  it('clears a binding left behind when a new account signs up', async () => {
    const parent = await elevatedParent();
    const grade = await createGradeLevel(h);
    const profile = await createStudentProfile(h, parent.parentAccountId, {
      gradeLevelId: grade.id,
    });
    const cookie = await bindDevice(h, parent.token, profile.id);

    const { CHILD_DATA_CONSENT_VERSION, TERMS_VERSION } = await import(
      '../src/identity/auth-policy.js'
    );
    const signUp = await server()
      .post('/api/auth/sign-up')
      .set('Cookie', cookie)
      .send({
        email: `zz-fresh-${randomUUID().slice(0, 8)}@example.test`,
        password: PASSWORD,
        timezone: 'UTC',
        termsVersion: TERMS_VERSION,
        noticeVersion: CHILD_DATA_CONSENT_VERSION,
      })
      .expect(201);

    expect(studentCookieFrom(signUp)).toMatch(/student_mode=;/u);
  });

  // --- A draft never reaches a child ---------------------------------------
  //
  // The acceptance criterion is a negative, and a negative nothing asserts is
  // a negative that quietly stops being true the first time somebody adds a
  // convenience route.

  it('exposes no practice-test path to a bound device, and still answers one read', async () => {
    const parent = await elevatedParent();
    const grade = await createGradeLevel(h);
    const profile = await createStudentProfile(h, parent.parentAccountId, {
      gradeLevelId: grade.id,
    });
    const cookie = await bindDevice(h, parent.token, profile.id);

    // A real draft in this very account, so the refusals below are about a row
    // that actually exists. A random UUID would answer 404 whether the route
    // were absent or merely unmatched, which is the one failure this case is
    // here to rule out. Written directly rather than generated: what is under
    // test is the reach of the student surface, not how the row got there.
    const sourceTest = await h.prisma.sourceTest.create({
      data: {
        parentAccountId: parent.parentAccountId,
        studentProfileId: profile.id,
        status: 'Submitted',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
      select: { id: true },
    });
    const job = await h.prisma.generationJob.create({
      data: {
        parentAccountId: parent.parentAccountId,
        sourceTestId: sourceTest.id,
        studentProfileId: profile.id,
        requestedCount: 1,
        producedCount: 1,
        status: 'Succeeded',
      },
      select: { id: true },
    });
    const draft = await h.prisma.practiceTest.create({
      data: {
        parentAccountId: parent.parentAccountId,
        sourceTestId: sourceTest.id,
        studentProfileId: profile.id,
        generationJobId: job.id,
        ordinal: 1,
        questionCount: 1,
        chargedAt: new Date(),
        questions: {
          create: [
            {
              ordinal: 1,
              format: 'ShortAnswer',
              prompt: [{ kind: 'text', value: 'What is half of four?' }],
              answer: [{ kind: 'text', value: 'two' }],
              topics: { create: [{ label: 'Fractions' }] },
            },
          ],
        },
      },
      select: { id: true, questions: { select: { id: true } } },
    });
    const questionId = draft.questions[0]!.id;

    // Every shape that draft could be reached by from the student side — by
    // its own id, not a guess. The student-scoped API is the bound profile's own
    // reads, and nothing beyond them.
    for (const path of [
      '/api/student/practice-tests/drafts',
      `/api/student/practice-tests/${draft.id}`,
      `/api/student/session/practice-tests/${draft.id}`,
      '/api/student/session/practice-tests',
      // And a shape nothing serves, so the case still says something if the
      // real paths above ever start answering.
      `/api/student/practice-tests/${randomUUID()}`,
    ]) {
      await server().get(path).set('Cookie', cookie).expect(404);
    }

    // The parent-scoped reads are not reachable with a student credential
    // either — the list **or** the read of that draft's real id. They take an
    // elevation bearer, and a cookie is not one.
    await server().get('/api/parent/practice-tests/drafts').set('Cookie', cookie).expect(401);
    await server().get(`/api/parent/practice-tests/${draft.id}`).set('Cookie', cookie).expect(401);

    // And neither of the two **writes** Story 4.4 added. A student credential
    // reaching an edit or a delete would not merely leak a draft, it would let
    // the device change what it is graded against — so both are probed against
    // that draft's real question id rather than a guess, and the row is checked
    // to be exactly where it was afterwards.
    await server()
      .patch(`/api/parent/practice-tests/${draft.id}/questions/${questionId}`)
      .set('Cookie', cookie)
      .send({ prompt: 'A rewritten prompt.' })
      .expect(401);
    await server()
      .delete(`/api/parent/practice-tests/${draft.id}/questions/${questionId}`)
      .set('Cookie', cookie)
      .expect(401);
    const untouched = await h.prisma.practiceTestQuestion.findUniqueOrThrow({
      where: { id: questionId },
      select: { prompt: true },
    });
    expect(untouched.prompt).toEqual([{ kind: 'text', value: 'What is half of four?' }]);

    // The one student-scoped practice-test path that *does* exist since Story 4.5
    // serves released tests only. It is probed against a real `Draft` in this very
    // account rather than an empty one: an empty list from an empty account would
    // pass with the `status: 'Released'` scoping deleted, which is the one failure
    // this case exists to rule out.
    const released = await server().get('/api/student/practice-tests').set('Cookie', cookie);
    expect(released.status).toBe(200);
    expect(released.body).toEqual([]);
    const releasedBody = JSON.stringify(released.body);
    // Not the draft, and not a word of what it holds.
    expect(releasedBody).not.toContain(draft.id);
    expect(releasedBody).not.toContain('half of four');
    expect(releasedBody).not.toContain('Fractions');

    // And a **timed** released test carries no minute figure onto this surface.
    // The timer is a parent-only configuration (FR-15, Story 4.6): a child is
    // shown the time they have by Epic 5's own Attempt surface, and this list is
    // exactly `{ id, subjectName, questionCount, state }` whether a timer was
    // configured or not. Asserted with `toEqual` on the whole body rather than a
    // substring search, so a `timerMinutes` field appearing here is a failure by
    // construction.
    const timed = await h.prisma.practiceTest.create({
      data: {
        parentAccountId: parent.parentAccountId,
        sourceTestId: sourceTest.id,
        studentProfileId: profile.id,
        generationJobId: job.id,
        ordinal: 2,
        questionCount: 3,
        timerMinutes: 25,
        status: 'Released',
        chargedAt: new Date(),
      },
      select: { id: true },
    });
    const withTimer = await server()
      .get('/api/student/practice-tests')
      .set('Cookie', cookie)
      .expect(200);
    // The upload behind it carries no classification, so the row's Subject is
    // null — a state the payload states rather than hides. And never sat, so
    // the condition is `NotStarted`: derived from Attempts, of which there are
    // none, and not from a status column.
    expect(withTimer.body).toEqual([
      { id: timed.id, subjectName: null, questionCount: 3, state: 'NotStarted' },
    ]);
    expect(Object.keys(withTimer.body[0] as object).sort()).toEqual([
      'id',
      'questionCount',
      'state',
      'subjectName',
    ]);

    const session = await readStudentSession(cookie).expect(200);
    // One read, the bound profile, and nothing else on it.
    expect(Object.keys(session.body)).toEqual(['profile']);
    expect(session.body.profile.id).toBe(profile.id);
    const serialized = JSON.stringify(session.body);
    expect(serialized).not.toContain('practiceTest');
    // Not the draft, and not a word of what it holds.
    expect(serialized).not.toContain(draft.id);
    expect(serialized).not.toContain('half of four');
  });
});
