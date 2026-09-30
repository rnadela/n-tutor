import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { TIER_LIMITS, limitsFor } from '../src/allowance/tiers.js';
import type { AccountTier } from '../src/generated/prisma/enums.js';
import {
  adminToken,
  bearer,
  bindDevice,
  createGradeLevel,
  createHarness,
  createParentAccount,
  createSignedInParent,
  createStudentProfile,
  createSubject,
  elevate,
  resetParentAccounts,
  resetTaxonomy,
  setPinFor,
  studentTokenWithClaims,
  type Harness,
} from './harness.js';

const PIN = '4821';

/**
 * `GET /api/parent/allowances` — the parent's own readout of all three counters,
 * through the real app and the real database.
 *
 * **The stateful claims live here and can live nowhere else**: that the payload is
 * byte-identical to the one the Admin console reads, that an account at cap on all
 * three is answered rather than refused, that an unlimited tier states `null`, that
 * neither an unelevated nor a student-scoped caller reaches it at all, and — the
 * ones this story exists to close — that usage charged in one period reads 0 for
 * **all three** counters in the next while the earlier period still states its own
 * figures, that an artifact charged exactly at a window's exclusive end is counted
 * in the next period and in neither twice, and that two accounts in different
 * stored zones get different reset instants at one instant. The derivation's shape
 * — one window resolved, three counts over it — is `src/allowance/
 * allowance.service.spec.ts`'s, asserted with no database.
 *
 * The charged rows are written straight to the tables, exactly as
 * `analytics.int-spec.ts` writes its papers: these cases are about what a read
 * comes to, and there is no production path that will produce a Source Test
 * committed last month or an Explanation charged at a chosen instant.
 *
 * Not one tier figure, tier name or reset date is a literal below. Every expected
 * figure is read from `TIER_LIMITS` or off the response itself.
 */
describe('Parent allowances: three counters, one window, behind the PIN', () => {
  let h: Harness;
  let admin: string;

  beforeAll(async () => {
    h = await createHarness();
    admin = await adminToken(h.jwt, h.operatorId);
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
    cookie: string;
    /** The elevation bearer every parent-scoped route takes. */
    token: string;
    studentProfileId: string;
    gradeLevelId: string;
    subjectId: string;
  }

  /** One account past the PIN, with one child and a Subject to hang uploads on. */
  async function account(
    overrides: { email?: string; tier?: AccountTier; timezone?: string } = {},
  ): Promise<Account> {
    const gradeLevel = await createGradeLevel(h);
    const subject = await createSubject(h, { gradeLevelId: gradeLevel.id });
    const parent = await createSignedInParent(h, overrides);
    await setPinFor(h, parent.cookie, PIN);
    const token = await elevate(h, parent.cookie, PIN);
    const profile = await createStudentProfile(h, parent.parentAccountId, {
      gradeLevelId: gradeLevel.id,
    });
    return {
      parentAccountId: parent.parentAccountId,
      cookie: parent.cookie,
      token,
      studentProfileId: profile.id,
      gradeLevelId: gradeLevel.id,
      subjectId: subject.id,
    };
  }

  /** The allowances, read exactly as the web app reads them. */
  async function allowances(a: Account) {
    const response = await server()
      .get('/api/parent/allowances')
      .set('Authorization', bearer(a.token))
      .expect(200);
    return response.body;
  }

  /** How many of each class to charge, and when. */
  interface Charge {
    uploads?: number;
    generations?: number;
    explanations?: number;
  }

  /**
   * Charges artifacts of the three classes at one instant.
   *
   * The carriers — a Draft Source Test and an uncharged Practice Test — are
   * deliberately *not* counted by anything: the Upload count reads `Submitted`
   * rows and the Generation count reads a non-null `chargedAt`, so a row that
   * exists only to hang a foreign key off cannot move a figure this suite is
   * asserting.
   */
  async function charge(a: Account, counts: Charge, at: Date): Promise<void> {
    const uploads = counts.uploads ?? 0;
    const generations = counts.generations ?? 0;
    const explanations = counts.explanations ?? 0;
    const expiresAt = new Date(at.getTime() + 86_400_000);

    const carrier = await h.prisma.sourceTest.create({
      data: {
        parentAccountId: a.parentAccountId,
        studentProfileId: a.studentProfileId,
        // Draft, so it is never an Upload: the Upload count reads Submitted rows.
        status: 'Draft',
        expiresAt,
        subjectId: a.subjectId,
        gradeLevelId: a.gradeLevelId,
      },
      select: { id: true },
    });

    for (let index = 0; index < uploads; index += 1) {
      await h.prisma.sourceTest.create({
        data: {
          parentAccountId: a.parentAccountId,
          studentProfileId: a.studentProfileId,
          status: 'Submitted',
          expiresAt,
          submittedAt: at,
          subjectId: a.subjectId,
          gradeLevelId: a.gradeLevelId,
        },
        select: { id: true },
      });
    }

    const job = await h.prisma.generationJob.create({
      data: {
        parentAccountId: a.parentAccountId,
        sourceTestId: carrier.id,
        studentProfileId: a.studentProfileId,
        requestedCount: generations + 1,
        status: 'Succeeded',
      },
      select: { id: true },
    });

    for (let index = 0; index < generations; index += 1) {
      await h.prisma.practiceTest.create({
        data: {
          parentAccountId: a.parentAccountId,
          sourceTestId: carrier.id,
          studentProfileId: a.studentProfileId,
          generationJobId: job.id,
          status: 'Released',
          ordinal: index + 1,
          questionCount: 1,
          chargedAt: at,
        },
        select: { id: true },
      });
    }

    if (explanations === 0) return;

    // The Explanations need a run to hang off. This Practice Test carries no
    // `chargedAt`, so it is not a Generation.
    const paper = await h.prisma.practiceTest.create({
      data: {
        parentAccountId: a.parentAccountId,
        sourceTestId: carrier.id,
        studentProfileId: a.studentProfileId,
        generationJobId: job.id,
        status: 'Released',
        ordinal: generations + 1,
        questionCount: explanations,
      },
      select: { id: true },
    });
    const attempt = await h.prisma.attempt.create({
      data: {
        practiceTestId: paper.id,
        parentAccountId: a.parentAccountId,
        studentProfileId: a.studentProfileId,
        ordinal: 1,
        startedAt: at,
        expiresAt: null,
      },
      select: { id: true },
    });
    // One Question per Explanation: `explanation` is unique on the attempt, the
    // question, the profile and the generation.
    for (let index = 0; index < explanations; index += 1) {
      const question = await h.prisma.practiceTestQuestion.create({
        data: {
          practiceTestId: paper.id,
          ordinal: index + 1,
          format: 'ShortAnswer',
          prompt: [{ kind: 'text', value: `Question ${index + 1}` }],
          answer: [{ kind: 'text', value: `${index + 1}` }],
          topics: { create: [{ label: 'fractions' }] },
        },
        select: { id: true },
      });
      await h.prisma.explanation.create({
        data: {
          parentAccountId: a.parentAccountId,
          studentProfileId: a.studentProfileId,
          attemptId: attempt.id,
          questionId: question.id,
          body: [{ kind: 'text', value: 'Because of the denominator.' }],
          chargedAt: at,
        },
        select: { id: true },
      });
    }
  }

  /** An instant inside the period before this account's current one. */
  async function insidePreviousPeriod(a: Account): Promise<Date> {
    const current = await h.allowance.consumptionFor(a.parentAccountId);
    const previous = await h.allowance.consumptionFor(
      a.parentAccountId,
      new Date(new Date(current.periodStart).getTime() - 1),
    );
    const start = new Date(previous.periodStart).getTime();
    const end = new Date(previous.periodEnd).getTime();
    return new Date(Math.floor((start + end) / 2));
  }

  // --- The payload -------------------------------------------------------

  it('states the tier, the three counters against their limits, and the reset', async () => {
    const a = await account();
    const tier = (await h.identity.findById(a.parentAccountId)).tier;
    await charge(a, { uploads: 1, generations: 1, explanations: 1 }, new Date());

    const body = await allowances(a);

    const limits = limitsFor(tier);
    expect(body.tier).toBe(tier);
    expect(body.studentProfileLimit).toBe(limits.studentProfiles);
    expect(body.allowances).toEqual({
      upload: { used: 1, limit: limits.upload },
      generation: { used: 1, limit: limits.generation },
      explanation: { used: 1, limit: limits.explanation },
    });
    // The reset is the window's exclusive end, and the window is the account's.
    expect(body.resetAt).toBe(body.periodEnd);
    expect(new Date(body.periodStart).getTime()).toBeLessThan(new Date(body.periodEnd).getTime());
    expect(typeof body.timezone).toBe('string');
    expect(body.timezone.length).toBeGreaterThan(0);
  });

  it('answers the same payload the Admin account detail does, field for field', async () => {
    // Both are the same `consumptionFor` call, which is why this can be asserted
    // at all rather than two compositions being compared for today's agreement.
    const a = await account();
    await charge(a, { uploads: 1, generations: 2, explanations: 3 }, new Date());

    const parent = await allowances(a);
    const detail = await server()
      .get(`/api/admin/parent-accounts/${a.parentAccountId}`)
      .set('Authorization', bearer(admin))
      .expect(200);

    expect(parent).toEqual(detail.body.consumption);
  });

  it('answers 200 at cap on all three, refusing nothing and charging nothing', async () => {
    const a = await account();
    const tier = (await h.identity.findById(a.parentAccountId)).tier;
    const limits = limitsFor(tier);
    // A tier with a figure on all three, so "at cap" is a state that exists.
    expect(limits.upload).not.toBeNull();
    expect(limits.generation).not.toBeNull();
    expect(limits.explanation).not.toBeNull();
    await charge(
      a,
      {
        uploads: limits.upload ?? 0,
        generations: limits.generation ?? 0,
        explanations: limits.explanation ?? 0,
      },
      new Date(),
    );
    const aiCallsBefore = await h.prisma.aiCall.count();

    const body = await allowances(a);

    expect(body.allowances.upload.used).toBe(limits.upload);
    expect(body.allowances.generation.used).toBe(limits.generation);
    expect(body.allowances.explanation.used).toBe(limits.explanation);
    // Reading is free: no artifact was produced and no provider call was made.
    expect(await h.prisma.aiCall.count()).toBe(aiCallsBefore);
    expect(h.ai.sent).toHaveLength(0);

    // And it is still readable a second time, which a cap would have stopped.
    expect((await allowances(a)).allowances).toEqual(body.allowances);
  });

  it('states an unlimited tier as null on every figure, never as a number', async () => {
    const tier = (Object.keys(TIER_LIMITS) as AccountTier[]).find(
      (candidate) =>
        TIER_LIMITS[candidate].upload === null &&
        TIER_LIMITS[candidate].generation === null &&
        TIER_LIMITS[candidate].explanation === null &&
        TIER_LIMITS[candidate].studentProfiles === null,
    );
    if (!tier) throw new Error('No Account Tier is unlimited on all four figures.');
    const a = await account({ tier });
    await charge(a, { uploads: 1, generations: 1, explanations: 1 }, new Date());

    const body = await allowances(a);

    expect(body.tier).toBe(tier);
    expect(body.studentProfileLimit).toBeNull();
    expect(body.allowances.upload.limit).toBeNull();
    expect(body.allowances.generation.limit).toBeNull();
    expect(body.allowances.explanation.limit).toBeNull();
    // Usage is still a fact on an unlimited tier; it is the remainder that is not.
    expect(body.allowances.upload.used).toBe(1);
    expect(body.allowances.generation.used).toBe(1);
    expect(body.allowances.explanation.used).toBe(1);
  });

  it('answers each bearer its own account’s figures, and never another’s', async () => {
    // The account comes off the verified elevation and off nothing else (AD-18).
    // A future change that took it from a header, a query or a body would leave
    // every other case here green and this one crossed.
    const first = await account({ email: 'first@example.test' });
    const second = await account({ email: 'second@example.test' });
    await charge(first, { uploads: 1, generations: 1, explanations: 1 }, new Date());
    await charge(second, { uploads: 2, generations: 2, explanations: 2 }, new Date());

    const firstRead = await allowances(first);
    const secondRead = await allowances(second);

    expect(firstRead.allowances.upload.used).toBe(1);
    expect(firstRead.allowances.generation.used).toBe(1);
    expect(firstRead.allowances.explanation.used).toBe(1);
    expect(secondRead.allowances.upload.used).toBe(2);
    expect(secondRead.allowances.generation.used).toBe(2);
    expect(secondRead.allowances.explanation.used).toBe(2);
    // Neither read saw the other's rows: the figures are not the sum.
    expect(firstRead.allowances.upload.used).not.toBe(3);
    expect(secondRead.allowances.upload.used).not.toBe(3);
  });

  it('counts a deleted artifact’s tombstone in its own period, and in no other', async () => {
    // Usage is derived and nothing is refunded (AD-14): a deleted artifact keeps
    // being counted through `usage_tombstone`. That half of the composition is
    // asserted over the real table here, not only over the unit spec's double.
    const a = await account();
    const then = await insidePreviousPeriod(a);
    const previous = await h.allowance.consumptionFor(a.parentAccountId, then);
    for (const usageClass of ['Upload', 'Generation', 'Explanation'] as const) {
      await h.prisma.usageTombstone.create({
        data: {
          parentAccountId: a.parentAccountId,
          usageClass,
          // The window start the erased artifact's charge fell in, which is what
          // makes a tombstone stable after the fact.
          periodStart: new Date(previous.periodStart),
          count: 4,
        },
        select: { id: true },
      });
    }

    const earlier = await h.allowance.consumptionFor(a.parentAccountId, then);
    const now = await allowances(a);

    expect(earlier.allowances.upload.used).toBe(4);
    expect(earlier.allowances.generation.used).toBe(4);
    expect(earlier.allowances.explanation.used).toBe(4);
    // And absent from the next period, together with the live counts: a tombstone
    // counted twice would be a silent double-charge in the month after.
    expect(now.allowances.upload.used).toBe(0);
    expect(now.allowances.generation.used).toBe(0);
    expect(now.allowances.explanation.used).toBe(0);
  });

  // --- Who may read it ---------------------------------------------------

  /** No tier, counter, limit or cost figure may be in a refusal's body. */
  function expectNoAccountFigures(body: Record<string, unknown>): void {
    expect(body.tier).toBeUndefined();
    expect(body.allowances).toBeUndefined();
    expect(body.studentProfileLimit).toBeUndefined();
    expect(body.resetAt).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/Free|Plus|Family|Internal/u);
  }

  it('refuses a session cookie with 401 and `elevated: false`', async () => {
    const a = await account();

    const refused = await server()
      .get('/api/parent/allowances')
      .set('Cookie', a.cookie)
      .expect(401);

    expect(refused.body.elevated).toBe(false);
    expectNoAccountFigures(refused.body);
  });

  it('is not reachable from a student-scoped credential', async () => {
    const a = await account();
    const studentCookie = await bindDevice(h, a.token, a.studentProfileId);

    // The binding cookie: the guard reads `Authorization` only, so the student
    // credential cannot even be presented to it.
    const byCookie = await server()
      .get('/api/parent/allowances')
      .set('Cookie', studentCookie)
      .expect(401);
    expectNoAccountFigures(byCookie.body);

    // And the binding-audience token as a bearer: same secret, wrong audience.
    const studentToken = await studentTokenWithClaims(h.parentJwt, {
      sub: a.parentAccountId,
      studentProfileId: a.studentProfileId,
    });
    const byBearer = await server()
      .get('/api/parent/allowances')
      .set('Authorization', bearer(studentToken))
      .expect(401);
    expectNoAccountFigures(byBearer.body);
  });

  // --- The atomic reset, observed ----------------------------------------

  it('reads 0 on all three in the next period while the earlier one keeps its figures', async () => {
    const a = await account();
    const then = await insidePreviousPeriod(a);
    await charge(a, { uploads: 1, generations: 2, explanations: 3 }, then);

    // The live read, whose `now` is inside the current period.
    const now = await allowances(a);
    expect(now.allowances.upload.used).toBe(0);
    expect(now.allowances.generation.used).toBe(0);
    expect(now.allowances.explanation.used).toBe(0);

    // The same rows, read from inside the period they were charged in. Nothing
    // was moved, deleted or reset — only the window the counts are measured over.
    const earlier = await h.allowance.consumptionFor(a.parentAccountId, then);
    expect(earlier.allowances.upload.used).toBe(1);
    expect(earlier.allowances.generation.used).toBe(2);
    expect(earlier.allowances.explanation.used).toBe(3);
    // Two different windows, and the earlier one ends where the current begins.
    expect(earlier.periodEnd).toBe(now.periodStart);
    expect(earlier.resetAt).toBe(earlier.periodEnd);
  });

  it('counts an artifact charged exactly at a window’s end in the next period only', async () => {
    const a = await account();
    const then = await insidePreviousPeriod(a);
    const previous = await h.allowance.consumptionFor(a.parentAccountId, then);
    // Half-open `[start, end)`: this instant is the previous period's exclusive
    // end and the next one's inclusive start, for all three counters at once.
    const boundary = new Date(previous.periodEnd);
    await charge(a, { uploads: 1, generations: 1, explanations: 1 }, boundary);

    const before = await h.allowance.consumptionFor(a.parentAccountId, then);
    const after = await h.allowance.consumptionFor(a.parentAccountId, boundary);

    expect(before.allowances.upload.used).toBe(0);
    expect(before.allowances.generation.used).toBe(0);
    expect(before.allowances.explanation.used).toBe(0);
    expect(after.allowances.upload.used).toBe(1);
    expect(after.allowances.generation.used).toBe(1);
    expect(after.allowances.explanation.used).toBe(1);
    // Counted once, not in both: the two windows are the two sides of one instant.
    expect(after.periodStart).toBe(previous.periodEnd);
  });

  it('gives two accounts in different stored zones different reset instants', async () => {
    // Two zones a whole calendar day apart at some instants, so a window cut in
    // one cannot be the window cut in the other.
    //
    // Created through `identity` with a back-dated `effectiveFrom`, not through
    // sign-up: the window's own start decides the zone it was cut in (AD-27), so a
    // zone whose entry begins after this month's start is not the zone this month
    // is measured in. That rule is `period.spec.ts`'s; what is asserted here is
    // that two accounts reading at one instant each get **their own** zone's reset.
    const backDated = new Date('2020-01-01T00:00:00.000Z');
    const east = await createParentAccount(h.identity, {
      email: 'east@example.test',
      timezone: 'Asia/Manila',
      effectiveFrom: backDated,
    });
    const west = await createParentAccount(h.identity, {
      email: 'west@example.test',
      timezone: 'America/New_York',
      effectiveFrom: backDated,
    });
    const at = new Date();

    const eastRead = await h.allowance.consumptionFor(east.id, at);
    const westRead = await h.allowance.consumptionFor(west.id, at);

    expect(eastRead.timezone).toBe('Asia/Manila');
    expect(westRead.timezone).toBe('America/New_York');
    expect(eastRead.resetAt).not.toBe(westRead.resetAt);
    // Each is its own window's exclusive end, and each window is one window: the
    // three counters of each account were measured over their own account's.
    expect(eastRead.resetAt).toBe(eastRead.periodEnd);
    expect(westRead.resetAt).toBe(westRead.periodEnd);
  });

  it('keeps a zone change out of the running period, so the reset does not move', async () => {
    const a = await account({ timezone: 'UTC' });

    const before = await allowances(a);
    await h.identity.appendTimezone(a.parentAccountId, 'Pacific/Auckland', new Date());
    const after = await allowances(a);

    // The window's own start decides the zone it was cut in (AD-27), so a zone
    // change mid-period cannot re-slice the running period — and therefore cannot
    // move the instant the three counters reset at.
    expect(after.timezone).toBe(before.timezone);
    expect(after.resetAt).toBe(before.resetAt);
  });
});
