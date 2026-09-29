import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const {
  FLAG_ALREADY_DISPOSED,
  NOTHING_TO_REGENERATE,
  SUPPRESSION_NEEDS_A_FLAG,
  EXPLANATION_FAILED,
} = await import('../src/explanation/explanation-policy.js');
const { PRACTICE_TEST_NOT_FOUND } = await import('../src/practicetest/practice-test-policy.js');
const { TIER_LIMITS } = await import('../src/allowance/tiers.js');
const {
  adminToken,
  bearer,
  bindDevice,
  createGradeLevel,
  createHarness,
  createSignedInParent,
  createStudentProfile,
  createStudentProfileWithHeadroom,
  createSubject,
  elevate,
  resetParentAccounts,
  resetTaxonomy,
  setPinFor,
} = await import('./harness.js');

type Harness = Awaited<ReturnType<typeof createHarness>>;

const PIN = '4821';
const UNKNOWN_UUID = '11111111-2222-4333-8444-555555555555';

/**
 * A parent taking one Explanation away from their child and getting a free replacement —
 * end to end through the real app and the real database.
 *
 * The **stateful** rows of the story's I/O matrix live here and can live nowhere else:
 * that a suppressed read makes **no** provider call, reads no allowance and writes no
 * row; that a regeneration on a Free account already at its cap still answers 201 and
 * leaves the `used` figure unmoved; that the suppressed row survives with its body and is
 * still returned to the parent and to the operator; that a replacement carries
 * `replacement: true` and no parent-scoped fact of any kind; that suppression leaves every
 * grade state, the score and every other Question's Explanation byte-identical; and that
 * two concurrent regenerations leave exactly one new row. The pure rows — the unlock
 * predicate, which generation counts, the refusal sentences — are unit specs beside the
 * code.
 *
 * The Attempt and everything under it are written straight to the tables, for the reason
 * every other Explanation spec gives: these cases are about a finished run's
 * Explanations, not about producing one, and driving the whole
 * upload-extract-generate-release-sit-hand-in flow per case would spend the setup's
 * provider calls in the middle of counting this story's.
 *
 * **The fake provider is deterministic per ordinal**, so a regenerated body is
 * byte-identical to the one it replaced. "A different Explanation" is therefore asserted
 * as a **new row and a second provider call**, never as different prose.
 */
describe('Explanation suppression and free regeneration: removed once, replaced for nothing', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(async () => {
    await h.close();
  });

  beforeEach(async () => {
    await resetParentAccounts(h.prisma);
    await resetTaxonomy(h.prisma);
    h.ai.reset();
  });

  function server() {
    return request(h.app.getHttpServer());
  }

  interface Account {
    parentAccountId: string;
    token: string;
    cookie: string;
    studentProfileId: string;
    siblingProfileId: string;
    practiceTestId: string;
    attemptId: string;
    questionIds: string[];
  }

  /** One account, two children, and one handed-in, fully graded Attempt of two Questions. */
  async function sat(): Promise<Account> {
    const gradeLevel = await createGradeLevel(h);
    const subject = await createSubject(h, { gradeLevelId: gradeLevel.id });

    // The account keeps its sign-up tier, whose Explanation figure the cases
    // below assert; the sibling is created under tier headroom handed back after.
    const parent = await createSignedInParent(h);
    await setPinFor(h, parent.cookie, PIN);
    const token = await elevate(h, parent.cookie, PIN);
    const profile = await createStudentProfile(h, parent.parentAccountId, {
      gradeLevelId: gradeLevel.id,
    });
    const sibling = await createStudentProfileWithHeadroom(h, parent.parentAccountId, {
      gradeLevelId: gradeLevel.id,
    });
    const cookie = await bindDevice(h, token, profile.id);

    const sourceTest = await h.prisma.sourceTest.create({
      data: {
        parentAccountId: parent.parentAccountId,
        studentProfileId: profile.id,
        status: 'Submitted',
        expiresAt: new Date(Date.now() + 86_400_000),
        submittedAt: new Date(),
        subjectId: subject.id,
        gradeLevelId: gradeLevel.id,
      },
      select: { id: true },
    });
    const job = await h.prisma.generationJob.create({
      data: {
        parentAccountId: parent.parentAccountId,
        sourceTestId: sourceTest.id,
        studentProfileId: profile.id,
        requestedCount: 1,
        status: 'Succeeded',
      },
      select: { id: true },
    });
    const practiceTest = await h.prisma.practiceTest.create({
      data: {
        parentAccountId: parent.parentAccountId,
        sourceTestId: sourceTest.id,
        studentProfileId: profile.id,
        generationJobId: job.id,
        status: 'Released',
        ordinal: 1,
        questionCount: 2,
        chargedAt: new Date(),
      },
      select: { id: true },
    });

    const questionIds: string[] = [];
    for (let ordinal = 1; ordinal <= 2; ordinal += 1) {
      const question = await h.prisma.practiceTestQuestion.create({
        data: {
          practiceTestId: practiceTest.id,
          ordinal,
          format: 'ShortAnswer',
          prompt: [{ kind: 'text', value: `What is half of ${ordinal * 6}?` }],
          answer: [{ kind: 'text', value: `${ordinal * 3}` }],
        },
        select: { id: true },
      });
      questionIds.push(question.id);
    }

    const attempt = await h.prisma.attempt.create({
      data: {
        practiceTestId: practiceTest.id,
        parentAccountId: parent.parentAccountId,
        studentProfileId: profile.id,
        ordinal: 1,
        startedAt: new Date(Date.now() - 600_000),
        submittedAt: new Date(Date.now() - 300_000),
      },
      select: { id: true },
    });
    await h.prisma.answer.create({
      data: { attemptId: attempt.id, questionId: questionIds[0]!, value: 'three' },
    });
    // Both Questions judged, so the results read has nothing outstanding to re-ask for: a
    // provider call made by the *grading* retry would otherwise be counted by the "nothing
    // was generated" cases below and mistaken for an explanation.
    for (const questionId of questionIds) {
      await h.prisma.questionGrade.create({
        data: { attemptId: attempt.id, questionId, state: 'Correct' },
      });
    }

    h.ai.reset();
    return {
      parentAccountId: parent.parentAccountId,
      token,
      cookie,
      studentProfileId: profile.id,
      siblingProfileId: sibling.id,
      practiceTestId: practiceTest.id,
      attemptId: attempt.id,
      questionIds,
    };
  }

  /** One stored Explanation at a given generation, written straight to the table. */
  async function storeExplanation(
    account: Account,
    questionId: string,
    overrides: {
      studentProfileId?: string;
      value?: string;
      generation?: number;
      suppressedAt?: Date | null;
      chargedAt?: Date | null;
    } = {},
  ): Promise<string> {
    const stored = await h.prisma.explanation.create({
      data: {
        parentAccountId: account.parentAccountId,
        studentProfileId: overrides.studentProfileId ?? account.studentProfileId,
        attemptId: account.attemptId,
        questionId,
        body: [{ kind: 'text', value: overrides.value ?? 'Half of six is three.' }],
        generation: overrides.generation ?? 1,
        suppressedAt: overrides.suppressedAt ?? null,
        chargedAt: overrides.chargedAt === undefined ? new Date() : overrides.chargedAt,
      },
      select: { id: true },
    });
    return stored.id;
  }

  // --- The routes, spelled once -------------------------------------------

  function explain(cookie: string, attemptId: string, questionId: string) {
    return server()
      .post(`/api/student/attempts/${attemptId}/questions/${questionId}/explanation`)
      .set('Cookie', cookie);
  }

  function suppressedList(cookie: string, attemptId: string) {
    return server()
      .get(`/api/student/attempts/${attemptId}/suppressed-explanations`)
      .set('Cookie', cookie);
  }

  function explanations(token: string, attemptId: string) {
    return server()
      .get(`/api/parent/attempts/${attemptId}/explanations`)
      .set('Authorization', bearer(token));
  }

  function parentFlag(token: string, attemptId: string, questionId: string) {
    return server()
      .post(`/api/parent/attempts/${attemptId}/questions/${questionId}/explanation-flag`)
      .set('Authorization', bearer(token));
  }

  function studentFlag(cookie: string, attemptId: string, questionId: string) {
    return server()
      .post(`/api/student/attempts/${attemptId}/questions/${questionId}/explanation-flag`)
      .set('Cookie', cookie);
  }

  function dispose(token: string, attemptId: string, questionId: string, disposition: string) {
    return server()
      .post(
        `/api/parent/attempts/${attemptId}/questions/${questionId}/explanation-flag/disposition`,
      )
      .set('Authorization', bearer(token))
      .send({ disposition });
  }

  function suppress(token: string, attemptId: string, questionId: string) {
    return server()
      .post(`/api/parent/attempts/${attemptId}/questions/${questionId}/explanation-suppression`)
      .set('Authorization', bearer(token));
  }

  function regenerate(token: string, attemptId: string, questionId: string) {
    return server()
      .post(`/api/parent/attempts/${attemptId}/questions/${questionId}/explanation-regeneration`)
      .set('Authorization', bearer(token));
  }

  function queue(token: string) {
    return server().get('/api/admin/flagged-explanations').set('Authorization', bearer(token));
  }

  function flagList(token: string, studentProfileId: string) {
    return server()
      .get(`/api/parent/students/${studentProfileId}/explanation-flags`)
      .set('Authorization', bearer(token));
  }

  function providerCalls(): number {
    return h.ai.sent.length;
  }

  async function chargedRows(parentAccountId: string): Promise<number> {
    return h.prisma.explanation.count({ where: { parentAccountId, chargedAt: { not: null } } });
  }

  /** An Explanation with a parent-origin flag on it: suppression unlocked, the short way. */
  async function flagged(account: Account, questionId: string): Promise<void> {
    await storeExplanation(account, questionId);
    await parentFlag(account.token, account.attemptId, questionId).expect(200);
  }

  // --- Suppressing ---------------------------------------------------------

  it('suppresses a flagged Explanation, and answers every generation of that Question', async () => {
    const account = await sat();
    await flagged(account, account.questionIds[0]!);

    const response = await suppress(
      account.token,
      account.attemptId,
      account.questionIds[0]!,
    ).expect(200);

    expect(response.body).toHaveLength(1);
    const [entry] = response.body;
    expect(entry.generation).toBe(1);
    expect(typeof entry.suppressedAt).toBe('string');
    // Not reversible, so the control is not offered again: the server's answer and not a
    // rule the browser re-derives.
    expect(entry.canSuppress).toBe(false);
    // Retained, with its body: the parent who decided stays able to read what they
    // decided about.
    expect(entry.body).toEqual([{ kind: 'text', value: 'Half of six is three.' }]);
    // Nothing was generated and nothing was charged by a removal.
    expect(providerCalls()).toBe(0);
    expect(await h.prisma.explanation.count()).toBe(1);
  });

  it('suppresses after the parent confirms the child’s own report', async () => {
    const account = await sat();
    await storeExplanation(account, account.questionIds[0]!);
    await studentFlag(account.cookie, account.attemptId, account.questionIds[0]!).expect(200);
    await dispose(account.token, account.attemptId, account.questionIds[0]!, 'Confirmed').expect(
      200,
    );

    const response = await suppress(
      account.token,
      account.attemptId,
      account.questionIds[0]!,
    ).expect(200);
    expect(typeof response.body[0].suppressedAt).toBe('string');
  });

  it('refuses a suppression with no qualifying concern, and writes nothing', async () => {
    const account = await sat();
    await storeExplanation(account, account.questionIds[0]!);

    const refused = await suppress(
      account.token,
      account.attemptId,
      account.questionIds[0]!,
    ).expect(409);
    expect(refused.body.message).toBe(SUPPRESSION_NEEDS_A_FLAG);
    expect(await h.prisma.explanation.count({ where: { suppressedAt: { not: null } } })).toBe(0);
  });

  it('refuses a suppression while the child’s report is awaiting a decision', async () => {
    const account = await sat();
    await storeExplanation(account, account.questionIds[0]!);
    await studentFlag(account.cookie, account.attemptId, account.questionIds[0]!).expect(200);

    await suppress(account.token, account.attemptId, account.questionIds[0]!)
      .expect(409)
      .expect((response) => {
        expect(response.body.message).toBe(SUPPRESSION_NEEDS_A_FLAG);
      });
    expect(await h.prisma.explanation.count({ where: { suppressedAt: { not: null } } })).toBe(0);
  });

  it('refuses a suppression where the parent dismissed the child’s report', async () => {
    // The case that matters most: a dismissal is the parent having read the same prose and
    // judged it fine, so it must not unlock the very act that says otherwise.
    const account = await sat();
    await storeExplanation(account, account.questionIds[0]!);
    await studentFlag(account.cookie, account.attemptId, account.questionIds[0]!).expect(200);
    await dispose(account.token, account.attemptId, account.questionIds[0]!, 'Dismissed').expect(
      200,
    );

    await suppress(account.token, account.attemptId, account.questionIds[0]!).expect(409);
    expect(await h.prisma.explanation.count({ where: { suppressedAt: { not: null } } })).toBe(0);
  });

  it('answers a repeat suppression with the first instant, and rewrites nothing', async () => {
    const account = await sat();
    await flagged(account, account.questionIds[0]!);

    const first = await suppress(account.token, account.attemptId, account.questionIds[0]!).expect(
      200,
    );
    const again = await suppress(account.token, account.attemptId, account.questionIds[0]!).expect(
      200,
    );

    // A double-tap is one decision. 200 with the *first* instant, and no 409: telling a
    // parent they already did it would be a refusal for nothing.
    expect(again.body[0].suppressedAt).toBe(first.body[0].suppressedAt);
  });

  it('refuses a suppression of a Question with no Explanation, and of a foreign or open Attempt', async () => {
    const account = await sat();
    const other = await sat();

    // No Explanation at all on a Question of the parent's own Attempt.
    await suppress(account.token, account.attemptId, account.questionIds[1]!)
      .expect(404)
      .expect((response) => {
        expect(response.body.message).toBe(PRACTICE_TEST_NOT_FOUND);
      });
    // Another account's Attempt, and one that never existed. One sentence for all of it,
    // so nothing outside can read which ids exist (AD-18).
    await suppress(account.token, other.attemptId, other.questionIds[0]!).expect(404);
    await suppress(account.token, UNKNOWN_UUID, account.questionIds[0]!).expect(404);

    const open = await h.prisma.attempt.create({
      data: {
        practiceTestId: account.practiceTestId,
        parentAccountId: account.parentAccountId,
        studentProfileId: account.studentProfileId,
        ordinal: 2,
        startedAt: new Date(),
      },
      select: { id: true },
    });
    await suppress(account.token, open.id, account.questionIds[0]!).expect(404);
    expect(await h.prisma.explanation.count({ where: { suppressedAt: { not: null } } })).toBe(0);
  });

  it('never returns a sibling’s Explanation to a suppression, however the ids are paired', async () => {
    const account = await sat();
    // The sibling's own row against the same Attempt id — which cannot happen through any
    // route, and is written here precisely so the scoping is proved rather than assumed.
    await storeExplanation(account, account.questionIds[0]!, {
      studentProfileId: account.siblingProfileId,
    });

    await suppress(account.token, account.attemptId, account.questionIds[0]!).expect(404);
    expect(await h.prisma.explanation.count({ where: { suppressedAt: { not: null } } })).toBe(0);
  });

  // --- What the child is served -------------------------------------------

  it('answers a suppressed Question with no body, no provider call and no charge', async () => {
    const account = await sat();
    await flagged(account, account.questionIds[0]!);
    await suppress(account.token, account.attemptId, account.questionIds[0]!).expect(200);
    const before = await h.allowance.consumptionFor(account.parentAccountId);
    h.ai.reset();

    const response = await explain(
      account.cookie,
      account.attemptId,
      account.questionIds[0]!,
    ).expect(200);

    // 200 and not a refusal: nothing failed, and a child is not handed an error for a
    // decision a grown-up made.
    expect(response.body).toEqual({
      attemptId: account.attemptId,
      questionId: account.questionIds[0],
      suppressed: true,
    });
    // The whole point: not one provider call, not one new row, not one allowance unit.
    expect(providerCalls()).toBe(0);
    expect(await h.prisma.explanation.count()).toBe(1);
    const after = await h.allowance.consumptionFor(account.parentAccountId);
    expect(after.allowances.explanation.used).toBe(before.allowances.explanation.used);
  });

  it('lists a suppressed Question for the child, and answers `[]` for a foreign Attempt', async () => {
    const account = await sat();
    const other = await sat();
    await flagged(account, account.questionIds[0]!);
    await storeExplanation(account, account.questionIds[1]!);

    await suppressedList(account.cookie, account.attemptId).expect(200).expect([]);
    await suppress(account.token, account.attemptId, account.questionIds[0]!).expect(200);

    // Only the suppressed one, and only the ids. Never a body, an instant or a reason.
    await suppressedList(account.cookie, account.attemptId)
      .expect(200)
      .expect([account.questionIds[0]]);
    // Another account's Attempt and an unknown id answer the same empty list a child with
    // nothing suppressed gets — never a 404 that would confirm an id (AD-18).
    await suppressedList(account.cookie, other.attemptId).expect(200).expect([]);
    await suppressedList(account.cookie, UNKNOWN_UUID).expect(200).expect([]);
  });

  it('refuses a student report against a suppressed Explanation without leaking the prose', async () => {
    // Only a stale tab reaches this: the screen does not draw the control. It is the same
    // 200 the read gives, with nothing written and — the point — no body on the way out.
    const account = await sat();
    await flagged(account, account.questionIds[0]!);
    await suppress(account.token, account.attemptId, account.questionIds[0]!).expect(200);
    const flagsBefore = await h.prisma.explanationFlag.count();

    const response = await studentFlag(
      account.cookie,
      account.attemptId,
      account.questionIds[0]!,
    ).expect(200);
    expect(response.body).toEqual({
      attemptId: account.attemptId,
      questionId: account.questionIds[0],
      suppressed: true,
    });
    expect(await h.prisma.explanationFlag.count()).toBe(flagsBefore);
  });

  it('changes nothing it is not about: no grade, no score, no other Question’s Explanation', async () => {
    const account = await sat();
    await flagged(account, account.questionIds[0]!);
    const untouched = await storeExplanation(account, account.questionIds[1]!, {
      value: 'Half of twelve is six.',
    });
    const gradesBefore = await h.prisma.questionGrade.findMany({
      where: { attemptId: account.attemptId },
      orderBy: { questionId: 'asc' },
      select: { questionId: true, state: true },
    });
    const otherBefore = await h.prisma.explanation.findUniqueOrThrow({
      where: { id: untouched },
      select: {
        body: true,
        chargedAt: true,
        suppressedAt: true,
        generation: true,
        updatedAt: true,
      },
    });
    const scoreBefore = await server()
      .get(`/api/parent/attempts/${account.attemptId}/results`)
      .set('Authorization', bearer(account.token))
      .expect(200);

    await suppress(account.token, account.attemptId, account.questionIds[0]!).expect(200);

    expect(
      await h.prisma.questionGrade.findMany({
        where: { attemptId: account.attemptId },
        orderBy: { questionId: 'asc' },
        select: { questionId: true, state: true },
      }),
    ).toEqual(gradesBefore);
    // The other Question's row, byte for byte — down to `updatedAt`.
    expect(
      await h.prisma.explanation.findUniqueOrThrow({
        where: { id: untouched },
        select: {
          body: true,
          chargedAt: true,
          suppressedAt: true,
          generation: true,
          updatedAt: true,
        },
      }),
    ).toEqual(otherBefore);
    const scoreAfter = await server()
      .get(`/api/parent/attempts/${account.attemptId}/results`)
      .set('Authorization', bearer(account.token))
      .expect(200);
    expect(scoreAfter.body.score).toEqual(scoreBefore.body.score);
    // And the other Question is still explained, and still free to re-read.
    await explain(account.cookie, account.attemptId, account.questionIds[1]!).expect(200);
  });

  // --- Regenerating --------------------------------------------------------

  it('writes a replacement as a further generation, charging nothing', async () => {
    const account = await sat();
    await flagged(account, account.questionIds[0]!);
    await suppress(account.token, account.attemptId, account.questionIds[0]!).expect(200);
    const chargedBefore = await chargedRows(account.parentAccountId);
    h.ai.reset();

    const response = await regenerate(
      account.token,
      account.attemptId,
      account.questionIds[0]!,
    ).expect(201);

    // Both generations, oldest first: the removed one and its replacement.
    expect(response.body).toHaveLength(2);
    expect(response.body.map((entry: { generation: number }) => entry.generation)).toEqual([1, 2]);
    expect(typeof response.body[0].suppressedAt).toBe('string');
    expect(response.body[1].suppressedAt).toBeNull();
    // Nothing is recorded against the replacement yet, so it cannot be removed either.
    expect(response.body[1].canSuppress).toBe(false);
    // A different Explanation is a **new row and a second provider call**, never different
    // prose: the fake provider is deterministic per ordinal.
    expect(providerCalls()).toBe(1);
    expect(await h.prisma.explanation.count()).toBe(2);
    // The row is free, and the count that measures the allowance did not move.
    const written = await h.prisma.explanation.findFirstOrThrow({
      where: { attemptId: account.attemptId, questionId: account.questionIds[0]!, generation: 2 },
      select: { chargedAt: true, suppressedAt: true },
    });
    expect(written.chargedAt).toBeNull();
    expect(written.suppressedAt).toBeNull();
    expect(await chargedRows(account.parentAccountId)).toBe(chargedBefore);
  });

  it('refuses to regenerate a live Explanation, and writes nothing', async () => {
    const account = await sat();
    await flagged(account, account.questionIds[0]!);

    const refused = await regenerate(
      account.token,
      account.attemptId,
      account.questionIds[0]!,
    ).expect(409);
    expect(refused.body.message).toBe(NOTHING_TO_REGENERATE);
    expect(providerCalls()).toBe(0);
    expect(await h.prisma.explanation.count()).toBe(1);
  });

  it('regenerates on a Free account already at its cap, and the used figure does not move', async () => {
    // The claim the whole design turns on: **no allowance is read on this path**, so there
    // is nothing that could refuse it and nothing to debit.
    const limit = TIER_LIMITS.Free.explanation!;
    const account = await sat();
    await flagged(account, account.questionIds[0]!);
    await suppress(account.token, account.attemptId, account.questionIds[0]!).expect(200);

    // The rest of the period's charge, written directly: driving `limit` real presses would
    // need `limit` distinct Questions and would assert nothing this case is about.
    for (let index = 1; index < limit; index += 1) {
      const question = await h.prisma.practiceTestQuestion.create({
        data: {
          practiceTestId: account.practiceTestId,
          ordinal: 100 + index,
          format: 'ShortAnswer',
          prompt: [{ kind: 'text', value: 'Filler.' }],
          answer: [{ kind: 'text', value: 'Filler.' }],
        },
        select: { id: true },
      });
      await storeExplanation(account, question.id);
    }
    const before = await h.allowance.consumptionFor(account.parentAccountId);
    expect(before.allowances.explanation.limit).toBe(TIER_LIMITS.Free.explanation);
    expect(before.allowances.explanation.used).toBe(limit);
    h.ai.reset();

    await regenerate(account.token, account.attemptId, account.questionIds[0]!).expect(201);

    const after = await h.allowance.consumptionFor(account.parentAccountId);
    expect(after.allowances.explanation.used).toBe(before.allowances.explanation.used);
    expect(await chargedRows(account.parentAccountId)).toBe(limit);
  });

  it('serves the replacement to the child, marked as a new explanation and nothing more', async () => {
    const account = await sat();
    await flagged(account, account.questionIds[0]!);
    await suppress(account.token, account.attemptId, account.questionIds[0]!).expect(200);
    await regenerate(account.token, account.attemptId, account.questionIds[0]!).expect(201);
    h.ai.reset();

    const response = await explain(
      account.cookie,
      account.attemptId,
      account.questionIds[0]!,
    ).expect(200);

    expect(response.body.suppressed).toBe(false);
    expect(response.body.replacement).toBe(true);
    expect(Array.isArray(response.body.body)).toBe(true);
    // The child's own flag and **nothing else**: exactly the keys the type allows.
    expect(Object.keys(response.body).sort()).toEqual([
      'attemptId',
      'body',
      'questionId',
      'replacement',
      'studentFlaggedAt',
      'suppressed',
    ]);
    // And not one parent-scoped word anywhere in the serialized body: no parent flag, no
    // disposition, no reason, no cost, no tier, no model name, no allowance figure.
    const serialized = JSON.stringify(response.body);
    for (const forbidden of [
      /parentFlag/iu,
      /disposition/iu,
      /suppressedAt/iu,
      /canSuppress/iu,
      /generation/iu,
      /chargedAt/iu,
      /allowance/iu,
      /\btier\b/iu,
      /model/iu,
      /rationale/iu,
    ]) {
      expect(serialized).not.toMatch(forbidden);
    }
    // Re-reading is still free.
    expect(providerCalls()).toBe(0);
    // The replacement is no longer in the suppression list: the child is being served it.
    await suppressedList(account.cookie, account.attemptId).expect(200).expect([]);
  });

  it('answers a provider fault with the module’s one 503 and writes nothing', async () => {
    const account = await sat();
    await flagged(account, account.questionIds[0]!);
    await suppress(account.token, account.attemptId, account.questionIds[0]!).expect(200);
    h.ai.reset();
    h.ai.failNext('transport');

    const failed = await regenerate(
      account.token,
      account.attemptId,
      account.questionIds[0]!,
    ).expect(503);
    expect(failed.body.message).toBe(EXPLANATION_FAILED);
    // No second row, and the suppressed one is untouched.
    expect(await h.prisma.explanation.count()).toBe(1);
  });

  it('leaves exactly one new row when two regenerations land together', async () => {
    const account = await sat();
    await flagged(account, account.questionIds[0]!);
    await suppress(account.token, account.attemptId, account.questionIds[0]!).expect(200);
    h.ai.reset();

    const [first, second] = await Promise.all([
      regenerate(account.token, account.attemptId, account.questionIds[0]!),
      regenerate(account.token, account.attemptId, account.questionIds[0]!),
    ]);

    // Neither is a 500: the unique key refuses the loser and the loser answers with the
    // winner's generations.
    for (const response of [first, second]) {
      expect([200, 201]).toContain(response.status);
      expect(response.body).toHaveLength(2);
    }
    expect(await h.prisma.explanation.count()).toBe(2);
    expect(
      await h.prisma.explanation.count({
        where: { attemptId: account.attemptId, questionId: account.questionIds[0]!, generation: 2 },
      }),
    ).toBe(1);
  });

  it('lets each generation be reported, decided about and removed on its own terms', async () => {
    const account = await sat();
    await flagged(account, account.questionIds[0]!);
    await suppress(account.token, account.attemptId, account.questionIds[0]!).expect(200);
    await regenerate(account.token, account.attemptId, account.questionIds[0]!).expect(201);

    // The child reports the replacement. The flag lands on the **latest** generation.
    await studentFlag(account.cookie, account.attemptId, account.questionIds[0]!).expect(200);
    // A disposition targets the oldest *undecided* student flag, which is the one nobody
    // has read — here the replacement's.
    await dispose(account.token, account.attemptId, account.questionIds[0]!, 'Confirmed').expect(
      200,
    );
    await suppress(account.token, account.attemptId, account.questionIds[0]!).expect(200);

    const both = await explanations(account.token, account.attemptId).expect(200);
    expect(both.body).toHaveLength(2);
    expect(both.body.map((entry: { generation: number }) => entry.generation)).toEqual([1, 2]);
    // Two removal instants, one per generation, and each keeps its own flag facts.
    expect(typeof both.body[0].suppressedAt).toBe('string');
    expect(typeof both.body[1].suppressedAt).toBe('string');
    expect(both.body[0].parentFlaggedAt).not.toBeNull();
    expect(both.body[0].studentFlaggedAt).toBeNull();
    expect(both.body[1].parentFlaggedAt).toBeNull();
    expect(both.body[1].studentFlaggedAt).not.toBeNull();
    expect(both.body[1].studentFlagDisposition).toBe('Confirmed');
    // No ceiling: the child's read is the suppressed answer again, and still free.
    await explain(account.cookie, account.attemptId, account.questionIds[0]!)
      .expect(200)
      .expect((response) => {
        expect(response.body.suppressed).toBe(true);
      });
  });

  // --- Deciding a report when the Question holds several generations -------

  it('decides the oldest undecided report across generations, and answers with that one', async () => {
    const account = await sat();
    await flagged(account, account.questionIds[0]!);
    await suppress(account.token, account.attemptId, account.questionIds[0]!).expect(200);
    await regenerate(account.token, account.attemptId, account.questionIds[0]!).expect(201);

    // The child reports the replacement. Their earlier report is written straight to the table
    // against generation 1, so this case has an *older* undecided report to decide — which a
    // route driven only through the screens cannot produce, because the removed generation has
    // no report control on it any more.
    const first = await h.prisma.explanation.findFirstOrThrow({
      where: { attemptId: account.attemptId, questionId: account.questionIds[0]!, generation: 1 },
      select: { id: true, parentAccountId: true, studentProfileId: true },
    });
    await h.prisma.explanationFlag.create({
      data: {
        explanationId: first.id,
        parentAccountId: first.parentAccountId,
        studentProfileId: first.studentProfileId,
        origin: 'Student',
      },
    });
    await studentFlag(account.cookie, account.attemptId, account.questionIds[0]!).expect(200);

    // The decision lands on **generation 1** — the one nobody has read — and the response says
    // so, which is what lets the screen put the controls on the row the API will act on.
    const decided = await dispose(
      account.token,
      account.attemptId,
      account.questionIds[0]!,
      'Confirmed',
    ).expect(200);
    expect(decided.body.generation).toBe(1);
    expect(decided.body.studentFlagDisposition).toBe('Confirmed');

    // Generation 2's report is untouched and still awaiting: a decision is owed on each.
    const both = await explanations(account.token, account.attemptId).expect(200);
    expect(both.body[0].studentFlagDisposition).toBe('Confirmed');
    expect(both.body[1].studentFlaggedAt).not.toBeNull();
    expect(both.body[1].studentFlagDisposition).toBeNull();

    // And the next press moves on to generation 2, the other way — each report is its own
    // decision, with no carry-over from the generation it replaced.
    const second = await dispose(
      account.token,
      account.attemptId,
      account.questionIds[0]!,
      'Dismissed',
    ).expect(200);
    expect(second.body.generation).toBe(2);
    expect(second.body.studentFlagDisposition).toBe('Dismissed');
  });

  it('answers a repeat against the newest decided report, and refuses a reversal of it', async () => {
    // **The fallback arm**: with every report decided there is no undecided one to find, so the
    // 200 and 409 arms read against the *newest* decided report rather than the oldest. A
    // fallback that took the oldest would answer a parent pressing again with a decision they
    // made two generations ago — and would refuse the repeat of the one actually on screen.
    const account = await sat();
    await flagged(account, account.questionIds[0]!);
    await suppress(account.token, account.attemptId, account.questionIds[0]!).expect(200);
    await regenerate(account.token, account.attemptId, account.questionIds[0]!).expect(201);

    const first = await h.prisma.explanation.findFirstOrThrow({
      where: { attemptId: account.attemptId, questionId: account.questionIds[0]!, generation: 1 },
      select: { id: true, parentAccountId: true, studentProfileId: true },
    });
    await h.prisma.explanationFlag.create({
      data: {
        explanationId: first.id,
        parentAccountId: first.parentAccountId,
        studentProfileId: first.studentProfileId,
        origin: 'Student',
      },
    });
    await studentFlag(account.cookie, account.attemptId, account.questionIds[0]!).expect(200);

    // Generation 1 decided one way, generation 2 the other — so the two arms below cannot both
    // be satisfied by whichever row the fallback happens to pick.
    await dispose(account.token, account.attemptId, account.questionIds[0]!, 'Confirmed').expect(
      200,
    );
    const second = await dispose(
      account.token,
      account.attemptId,
      account.questionIds[0]!,
      'Dismissed',
    ).expect(200);
    expect(second.body.generation).toBe(2);

    // A repeat of generation 2's decision is 200 with its own state: a double-tap is one
    // decision, and it is answered by the report the parent is actually looking at.
    const repeat = await dispose(
      account.token,
      account.attemptId,
      account.questionIds[0]!,
      'Dismissed',
    ).expect(200);
    expect(repeat.body.generation).toBe(2);
    expect(repeat.body.studentFlagDisposition).toBe('Dismissed');
    expect(repeat.body.studentFlagDispositionAt).toBe(second.body.studentFlagDispositionAt);

    // And the opposite value is the one 409, with nothing rewritten — the first decision stands.
    const refused = await dispose(
      account.token,
      account.attemptId,
      account.questionIds[0]!,
      'Confirmed',
    ).expect(409);
    expect(refused.body.message).toBe(FLAG_ALREADY_DISPOSED);
    const after = await explanations(account.token, account.attemptId).expect(200);
    expect(after.body[0].studentFlagDisposition).toBe('Confirmed');
    expect(after.body[1].studentFlagDisposition).toBe('Dismissed');
    expect(after.body[1].studentFlagDispositionAt).toBe(second.body.studentFlagDispositionAt);
  });

  // --- What the parent and the operator still see --------------------------

  it('keeps the suppressed Explanation readable by the parent, with its body and its flags', async () => {
    const account = await sat();
    await flagged(account, account.questionIds[0]!);
    await suppress(account.token, account.attemptId, account.questionIds[0]!).expect(200);

    const response = await explanations(account.token, account.attemptId).expect(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].body).toEqual([{ kind: 'text', value: 'Half of six is three.' }]);
    expect(typeof response.body[0].suppressedAt).toBe('string');
    expect(response.body[0].parentFlaggedAt).not.toBeNull();
    // And nothing about cost travels on a parent's read either, free row or not.
    const serialized = JSON.stringify(response.body);
    for (const forbidden of [/chargedAt/iu, /allowance/iu, /\btier\b/iu, /rationale/iu]) {
      expect(serialized).not.toMatch(forbidden);
    }
  });

  it('keeps a suppressed Explanation in front of an operator, and gives a flagged replacement its own entry', async () => {
    const account = await sat();
    await flagged(account, account.questionIds[0]!);
    await suppress(account.token, account.attemptId, account.questionIds[0]!).expect(200);
    const token = await adminToken(h.jwt, h.operatorId);

    // Still exactly one entry for it: the parent has already judged it bad enough to take
    // away from their child, which is precisely the case an operator has to see.
    const afterSuppression = await queue(token).expect(200);
    expect(afterSuppression.body).toHaveLength(1);
    expect(afterSuppression.body[0].questionId).toBe(account.questionIds[0]);

    // A flagged replacement is a **different Explanation**, so it arrives as an entry of
    // its own with no fold and no grouping.
    await regenerate(account.token, account.attemptId, account.questionIds[0]!).expect(201);
    await parentFlag(account.token, account.attemptId, account.questionIds[0]!).expect(200);
    const afterReplacement = await queue(token).expect(200);
    expect(afterReplacement.body).toHaveLength(2);
  });

  // --- The guards ----------------------------------------------------------

  it('offers neither write without elevation, and neither to a child', async () => {
    const account = await sat();
    await flagged(account, account.questionIds[0]!);

    await server()
      .post(
        `/api/parent/attempts/${account.attemptId}/questions/${account.questionIds[0]}/explanation-suppression`,
      )
      .expect(401);
    await server()
      .post(
        `/api/parent/attempts/${account.attemptId}/questions/${account.questionIds[0]}/explanation-regeneration`,
      )
      .expect(401);
    // And there is no student route that reaches either: suppression is never available in
    // Student Mode. The child's binding cookie is not an elevation bearer, and the parent
    // routes are the only ones that exist.
    await server()
      .post(
        `/api/student/attempts/${account.attemptId}/questions/${account.questionIds[0]}/explanation-suppression`,
      )
      .set('Cookie', account.cookie)
      .expect(404);
    await server()
      .post(
        `/api/student/attempts/${account.attemptId}/questions/${account.questionIds[0]}/explanation-regeneration`,
      )
      .set('Cookie', account.cookie)
      .expect(404);
    expect(await h.prisma.explanation.count({ where: { suppressedAt: { not: null } } })).toBe(0);
  });

  it('refuses a malformed id on the parent routes with a 400, and on the student read with an empty list', async () => {
    const account = await sat();
    await suppress(account.token, 'not-a-uuid', account.questionIds[0]!).expect(400);
    await regenerate(account.token, account.attemptId, 'not-a-uuid').expect(400);
    // The child's surface answers every refusal with one shape, so a malformed id simply
    // matches nothing.
    await suppressedList(account.cookie, 'not-a-uuid').expect(200).expect([]);
  });

  it('takes no body on either write', async () => {
    // There is no reason field, no scope option and no "also confirm the flag": a body
    // field with no column behind it is a promise the next reader believes. Anything sent
    // is simply not read.
    const account = await sat();
    await flagged(account, account.questionIds[0]!);

    await suppress(account.token, account.attemptId, account.questionIds[0]!)
      .send({ reason: 'it was wrong', scope: 'everyone' })
      .expect(200);
    const stored = await h.prisma.explanation.findFirstOrThrow({
      where: { attemptId: account.attemptId },
      select: { suppressedAt: true },
    });
    expect(stored.suppressedAt).not.toBeNull();
  });

  it('lists a report against each generation of one Question as its own entry', async () => {
    // A suppression and a regeneration are what let one Question carry more than one
    // report now: the child can flag the removed generation and, later, its replacement.
    // The two are different concerns about different rows, and the parent's list of
    // reported explanations has to keep them apart rather than collapse them onto one
    // (attemptId, questionId) pair that stopped being unique the day the key widened.
    const account = await sat();
    await flagged(account, account.questionIds[0]!);
    await studentFlag(account.cookie, account.attemptId, account.questionIds[0]!).expect(200);
    await suppress(account.token, account.attemptId, account.questionIds[0]!).expect(200);
    await regenerate(account.token, account.attemptId, account.questionIds[0]!).expect(201);
    await studentFlag(account.cookie, account.attemptId, account.questionIds[0]!).expect(200);

    const response = await flagList(account.token, account.studentProfileId).expect(200);
    expect(response.body).toHaveLength(2);
    expect(response.body.map((entry: { generation: number }) => entry.generation).sort()).toEqual([
      1, 2,
    ]);
    for (const entry of response.body) {
      expect(entry.questionId).toBe(account.questionIds[0]);
    }
  });
});
