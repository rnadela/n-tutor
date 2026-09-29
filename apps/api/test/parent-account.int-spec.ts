import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { limitsFor } from '../src/allowance/tiers.js';
import sharp from 'sharp';
import {
  adminToken,
  bearer,
  checkLegibility,
  createGradeLevel,
  createHarness,
  createParentAccount,
  createSignedInParent,
  createStudentProfile,
  createStudentProfileWithHeadroom,
  createSubject,
  elevate,
  parentStyleToken,
  resetParentAccounts,
  resetTaxonomy,
  setPinFor,
  type Harness,
} from './harness.js';

const PIN = '4821';

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

describe('parent account tier assignment and consumption', () => {
  let h: Harness;
  let actor: string;
  let token: string;

  beforeAll(async () => {
    h = await createHarness();
    actor = h.operatorId;
    token = await adminToken(h.jwt, actor);
  });

  afterAll(async () => {
    await h.close();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    // Taxonomy first, then the accounts: the Upload-count cases below open
    // real Source Tests, which need a Grade Level and a Subject, and the
    // fixture names those from a per-process counter — so rows left behind by
    // an earlier run would collide on `nameKey` rather than simply pile up.
    await resetTaxonomy(h.prisma);
    await resetParentAccounts(h.prisma);
    h.ai.reset();
  });

  const auth = () => ({ authorization: `Bearer ${token}` });
  const server = () => h.app.getHttpServer();
  const audits = () => h.prisma.adminAudit.findMany({ orderBy: { createdAt: 'asc' } });

  // --- Listing -----------------------------------------------------------

  it('lists accounts with tier, effective timezone and created-at, ordered by email', async () => {
    await createParentAccount(h.identity, {
      email: 'zoe@example.test',
      timezone: 'Asia/Manila',
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    });
    await createParentAccount(h.identity, {
      email: 'adam@example.test',
      timezone: 'America/New_York',
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    });

    const response = await request(server())
      .get('/api/admin/parent-accounts')
      .set(auth())
      .expect(200);

    expect(response.body.map((row: { email: string }) => row.email)).toEqual([
      'adam@example.test',
      'zoe@example.test',
    ]);
    expect(response.body[0]).toMatchObject({
      email: 'adam@example.test',
      tier: 'Free',
      timezone: 'America/New_York',
    });
    expect(typeof response.body[0].id).toBe('string');
    expect(typeof response.body[0].createdAt).toBe('string');
  });

  it('returns an empty list when no accounts exist', async () => {
    const response = await request(server())
      .get('/api/admin/parent-accounts')
      .set(auth())
      .expect(200);
    expect(response.body).toEqual([]);
  });

  it('reports UTC for an account with no timezone entry, never throwing', async () => {
    const account = await createParentAccount(h.identity, { email: 'nozone@example.test' });

    const list = await request(server()).get('/api/admin/parent-accounts').set(auth()).expect(200);
    expect(list.body[0]).toMatchObject({ timezone: 'UTC' });

    const detail = await request(server())
      .get(`/api/admin/parent-accounts/${account.id}`)
      .set(auth())
      .expect(200);
    expect(detail.body.consumption.timezone).toBe('UTC');
  });

  // --- Default tier ------------------------------------------------------

  it('defaults a newly created account to Free', async () => {
    const account = await createParentAccount(h.identity, { email: 'default@example.test' });
    expect(account.tier).toBe('Free');

    const detail = await request(server())
      .get(`/api/admin/parent-accounts/${account.id}`)
      .set(auth())
      .expect(200);
    expect(detail.body.account.tier).toBe('Free');
    expect(detail.body.consumption.tier).toBe('Free');
  });

  // --- Consumption -------------------------------------------------------

  it('returns three allowances at zero against the tier table, with the window and zone', async () => {
    const account = await createParentAccount(h.identity, {
      email: 'consumption@example.test',
      timezone: 'Asia/Manila',
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    });

    const response = await request(server())
      .get(`/api/admin/parent-accounts/${account.id}`)
      .set(auth())
      .expect(200);
    const { consumption } = response.body;

    // Figures are asserted against the one tiers table, never restated here.
    const free = limitsFor('Free');
    expect(consumption.allowances).toEqual({
      upload: { used: 0, limit: free.upload },
      generation: { used: 0, limit: free.generation },
      explanation: { used: 0, limit: free.explanation },
    });
    expect(consumption.studentProfileLimit).toBe(free.studentProfiles);

    expect(consumption.timezone).toBe('Asia/Manila');
    expect(consumption.resetAt).toBe(consumption.periodEnd);
    expect(new Date(consumption.periodStart).getTime()).toBeLessThan(
      new Date(consumption.periodEnd).getTime(),
    );
    // The window is the calendar month in the account's own zone.
    const local = (iso: string) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Manila',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(iso));
    expect(local(consumption.periodStart)).toMatch(/-01, 00:00$/);
    expect(local(consumption.periodEnd)).toMatch(/-01, 00:00$/);
  });

  it('renders an unlimited allowance as null, and a numeric profile limit beside it', async () => {
    const plus = await createParentAccount(h.identity, {
      email: 'plus@example.test',
      tier: 'Plus',
    });
    const family = await createParentAccount(h.identity, {
      email: 'family@example.test',
      tier: 'Family',
    });

    for (const [id, tier] of [
      [plus.id, 'Plus'],
      [family.id, 'Family'],
    ] as const) {
      const response = await request(server())
        .get(`/api/admin/parent-accounts/${id}`)
        .set(auth())
        .expect(200);
      const { consumption } = response.body;

      expect(consumption.allowances.explanation.limit).toBeNull();
      expect(typeof consumption.studentProfileLimit).toBe('number');
      expect(consumption.studentProfileLimit).toBe(limitsFor(tier).studentProfiles);
    }
  });

  it('reports the tier’s profile limit, unmoved by the live profile count (DW-282)', async () => {
    // The limit is the tier's figure, not a remainder: creating a child spends
    // no allowance and moves no limit. Nothing here restates a number.
    const account = await createParentAccount(h.identity, { email: 'profile-limit@example.test' });
    const grade = await createGradeLevel(h);
    await createStudentProfile(h, account.id, { gradeLevelId: grade.id });

    const { body } = await request(server())
      .get(`/api/admin/parent-accounts/${account.id}`)
      .set(auth())
      .expect(200);

    expect(body.consumption.studentProfileLimit).toBe(limitsFor('Free').studentProfiles);
    // And no count of profiles is published on this surface at all.
    expect(body.consumption).not.toHaveProperty('studentProfiles');
    expect(body.consumption).not.toHaveProperty('studentProfileCount');
  });

  it('gives Internal an unlimited profile limit and three unlimited allowances', async () => {
    const account = await createParentAccount(h.identity, {
      email: 'internal@example.test',
      tier: 'Internal',
    });

    const { body } = await request(server())
      .get(`/api/admin/parent-accounts/${account.id}`)
      .set(auth())
      .expect(200);

    expect(body.consumption.studentProfileLimit).toBeNull();
    expect(body.consumption.allowances.upload.limit).toBeNull();
    expect(body.consumption.allowances.generation.limit).toBeNull();
    expect(body.consumption.allowances.explanation.limit).toBeNull();
  });

  it('computes each account its own window, so two zones reset at different instants', async () => {
    const manila = await createParentAccount(h.identity, {
      email: 'manila@example.test',
      timezone: 'Asia/Manila',
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    });
    const newYork = await createParentAccount(h.identity, {
      email: 'newyork@example.test',
      timezone: 'America/New_York',
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    });

    const read = async (id: string) =>
      (await request(server()).get(`/api/admin/parent-accounts/${id}`).set(auth()).expect(200)).body
        .consumption;

    const a = await read(manila.id);
    const b = await read(newYork.id);

    expect(a.timezone).toBe('Asia/Manila');
    expect(b.timezone).toBe('America/New_York');
    expect(a.resetAt).not.toBe(b.resetAt);
    expect(a.periodStart).not.toBe(b.periodStart);
  });

  it('keeps the running period on the zone in effect at its start after a zone change', async () => {
    const account = await createParentAccount(h.identity, {
      email: 'zonechange@example.test',
      timezone: 'UTC',
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    });

    const before = await h.allowance.consumptionFor(account.id);
    await h.identity.appendTimezone(account.id, 'Pacific/Auckland', new Date());
    const after = await h.allowance.consumptionFor(account.id);

    expect(after.timezone).toBe('UTC');
    expect(after.periodStart).toBe(before.periodStart);
    expect(after.periodEnd).toBe(before.periodEnd);
  });

  // --- Tier assignment ---------------------------------------------------

  it('assigns a tier, writes exactly one audit row, and leaves the window unchanged', async () => {
    const account = await createParentAccount(h.identity, { email: 'assign@example.test' });
    const before = await h.allowance.consumptionFor(account.id);

    const response = await request(server())
      .patch(`/api/admin/parent-accounts/${account.id}/tier`)
      .set(auth())
      .send({ tier: 'Internal' })
      .expect(200);
    expect(response.body).toMatchObject({ id: account.id, tier: 'Internal' });

    const rows = await audits();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: actor,
      action: 'parentAccount.tierChange',
      targetType: 'ParentAccount',
      targetId: account.id,
    });
    expect(rows[0]!.detail).toEqual({ from: 'Free', to: 'Internal' });

    // The new limits apply to the same, unchanged current period.
    const after = await h.allowance.consumptionFor(account.id);
    expect(after.periodStart).toBe(before.periodStart);
    expect(after.periodEnd).toBe(before.periodEnd);
    expect(after.resetAt).toBe(before.resetAt);
    expect(after.tier).toBe('Internal');
    expect(after.allowances.upload.limit).toBe(limitsFor('Internal').upload);
    expect(before.allowances.upload.limit).toBe(limitsFor('Free').upload);
  });

  it('records the action even when the tier is reassigned to the value it already had', async () => {
    const account = await createParentAccount(h.identity, {
      email: 'same@example.test',
      tier: 'Plus',
    });

    const response = await request(server())
      .patch(`/api/admin/parent-accounts/${account.id}/tier`)
      .set(auth())
      .send({ tier: 'Plus' })
      .expect(200);
    expect(response.body.tier).toBe('Plus');

    const rows = await audits();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.detail).toEqual({ from: 'Plus', to: 'Plus' });
  });

  it('rejects an unrecognised tier with 400 before any write', async () => {
    const account = await createParentAccount(h.identity, { email: 'badtier@example.test' });

    await request(server())
      .patch(`/api/admin/parent-accounts/${account.id}/tier`)
      .set(auth())
      .send({ tier: 'Premium' })
      .expect(400);

    expect((await h.identity.findById(account.id)).tier).toBe('Free');
    expect(await h.prisma.adminAudit.count()).toBe(0);
  });

  it('404s assigning a tier to an unknown account, writing no audit row', async () => {
    await request(server())
      .patch(`/api/admin/parent-accounts/${UNKNOWN_ID}/tier`)
      .set(auth())
      .send({ tier: 'Plus' })
      .expect(404);

    expect(await h.prisma.adminAudit.count()).toBe(0);
    expect(await h.prisma.parentAccount.count()).toBe(0);
  });

  it('404s reading an unknown account', async () => {
    await request(server()).get(`/api/admin/parent-accounts/${UNKNOWN_ID}`).set(auth()).expect(404);
  });

  it('rolls the tier change back when the audit write fails, surfacing 500 over HTTP', async () => {
    const account = await createParentAccount(h.identity, {
      email: 'rollback@example.test',
      tier: 'Free',
    });
    vi.spyOn(h.audit, 'record').mockRejectedValue(new Error('audit unavailable'));

    await request(server())
      .patch(`/api/admin/parent-accounts/${account.id}/tier`)
      .set(auth())
      .send({ tier: 'Family' })
      .expect(500);

    expect((await h.identity.findById(account.id)).tier).toBe('Free');
    expect(await h.prisma.adminAudit.count()).toBe(0);
  });

  // --- Authorization -----------------------------------------------------

  it('rejects a parent-style token on every accounts route before the handler runs', async () => {
    const account = await createParentAccount(h.identity, { email: 'guarded@example.test' });
    const parent = `Bearer ${await parentStyleToken(h.jwt)}`;

    await request(server())
      .get('/api/admin/parent-accounts')
      .set({ authorization: parent })
      .expect(401);
    await request(server())
      .get(`/api/admin/parent-accounts/${account.id}`)
      .set({ authorization: parent })
      .expect(401);
    await request(server())
      .patch(`/api/admin/parent-accounts/${account.id}/tier`)
      .set({ authorization: parent })
      .send({ tier: 'Internal' })
      .expect(401);

    expect((await h.identity.findById(account.id)).tier).toBe('Free');
    expect(await h.prisma.adminAudit.count()).toBe(0);
  });

  it('rejects an unauthenticated request on every accounts route', async () => {
    const account = await createParentAccount(h.identity, { email: 'noauth@example.test' });

    await request(server()).get('/api/admin/parent-accounts').expect(401);
    await request(server()).get(`/api/admin/parent-accounts/${account.id}`).expect(401);
    await request(server())
      .patch(`/api/admin/parent-accounts/${account.id}/tier`)
      .send({ tier: 'Internal' })
      .expect(401);

    expect((await h.identity.findById(account.id)).tier).toBe('Free');
    expect(await h.prisma.adminAudit.count()).toBe(0);
  });

  // --- Request validation ------------------------------------------------

  it('400s a non-UUID id on both id-bearing routes', async () => {
    await request(server()).get('/api/admin/parent-accounts/not-a-uuid').set(auth()).expect(400);
    await request(server())
      .patch('/api/admin/parent-accounts/not-a-uuid/tier')
      .set(auth())
      .send({ tier: 'Plus' })
      .expect(400);
    expect(await h.prisma.adminAudit.count()).toBe(0);
  });

  it('400s a PATCH body carrying an extra key, and one carrying no tier at all', async () => {
    const account = await createParentAccount(h.identity, { email: 'whitelist@example.test' });

    await request(server())
      .patch(`/api/admin/parent-accounts/${account.id}/tier`)
      .set(auth())
      .send({ tier: 'Plus', sneakyField: 'nope' })
      .expect(400);
    await request(server())
      .patch(`/api/admin/parent-accounts/${account.id}/tier`)
      .set(auth())
      .send({})
      .expect(400);

    expect((await h.identity.findById(account.id)).tier).toBe('Free');
    expect(await h.prisma.adminAudit.count()).toBe(0);
  });

  it('returns the same summary shape from PATCH as from the list', async () => {
    const account = await createParentAccount(h.identity, {
      email: 'shape@example.test',
      timezone: 'Asia/Manila',
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    });

    const patched = await request(server())
      .patch(`/api/admin/parent-accounts/${account.id}/tier`)
      .set(auth())
      .send({ tier: 'Family' })
      .expect(200);
    const list = await request(server()).get('/api/admin/parent-accounts').set(auth()).expect(200);

    // The client has one type for both, so the keys must match exactly.
    expect(Object.keys(patched.body).sort()).toEqual(Object.keys(list.body[0]).sort());
    expect(patched.body).toMatchObject({ tier: 'Family', timezone: 'Asia/Manila' });
  });

  // --- Concurrency -------------------------------------------------------

  it('holds a real row lock, blocking a second reader until the first commits', async () => {
    const account = await createParentAccount(h.identity, { email: 'lock@example.test' });

    // Asserted directly rather than by racing two assignTier calls: those
    // happen to serialise on the pool, so they pass with or without a lock.
    // This pins the behaviour the truthful audit `from` actually depends on.
    let releaseFirst: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    let secondAcquired = false;
    const first = h.prisma.withTransaction(async (tx) => {
      await h.identity.findByIdForUpdate(tx, account.id);
      await held;
    });
    const second = h.prisma.withTransaction(async (tx) => {
      await h.identity.findByIdForUpdate(tx, account.id);
      secondAcquired = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(secondAcquired, 'second reader is blocked while the first holds the lock').toBe(false);

    releaseFirst!();
    await Promise.all([first, second]);
    expect(secondAcquired).toBe(true);
  });

  it('chains concurrent tier changes so every audited `from` is truthful', async () => {
    const account = await createParentAccount(h.identity, { email: 'race@example.test' });

    await Promise.all([
      h.parentAccounts.assignTier(actor, account.id, 'Plus'),
      h.parentAccounts.assignTier(actor, account.id, 'Family'),
    ]);

    const rows = await audits();
    expect(rows).toHaveLength(2);

    const detail = rows.map((row) => row.detail as { from: string; to: string });
    // The two rows form a chain: the second's `from` is the first's `to`, and
    // only one of them can have started from Free.
    expect(detail[0]!.from).toBe('Free');
    expect(detail[1]!.from).toBe(detail[0]!.to);
    expect(detail[1]!.to).toBe((await h.identity.findById(account.id)).tier);
    expect(detail.filter((row) => row.from === 'Free')).toHaveLength(1);
  });

  // --- Timezone integrity ------------------------------------------------

  it('rejects an unknown timezone on write, on both write paths', async () => {
    await expect(
      createParentAccount(h.identity, { email: 'badzone@example.test', timezone: 'Mars/Olympus' }),
    ).rejects.toMatchObject({ status: 400 });
    // Nothing partially persisted: the account is rejected before the write.
    expect(await h.prisma.parentAccount.count()).toBe(0);

    const account = await createParentAccount(h.identity, { email: 'goodzone@example.test' });
    await expect(
      h.identity.appendTimezone(account.id, 'Not/AZone', new Date()),
    ).rejects.toMatchObject({ status: 400 });
    expect(await h.prisma.accountTimezone.count()).toBe(0);
  });

  it('still serves a window for a row whose zone the platform does not know', async () => {
    const account = await createParentAccount(h.identity, { email: 'legacyzone@example.test' });
    // Bypasses the service deliberately: a row that predates validation.
    await h.prisma.$executeRawUnsafe(
      'INSERT INTO "account_timezone" ("id", "parentAccountId", "timezone", "effectiveFrom") VALUES ($1, $2, $3, $4)',
      crypto.randomUUID(),
      account.id,
      'Mars/Olympus',
      new Date('2026-01-01T00:00:00.000Z'),
    );

    const list = await request(server()).get('/api/admin/parent-accounts').set(auth()).expect(200);
    expect(list.body[0]).toMatchObject({ timezone: 'UTC' });

    const detail = await request(server())
      .get(`/api/admin/parent-accounts/${account.id}`)
      .set(auth())
      .expect(200);
    expect(detail.body.consumption.timezone).toBe('UTC');
    expect(detail.body.consumption.resetAt).toBe(detail.body.consumption.periodEnd);
  });

  it('refuses two timezone entries at the same instant for one account', async () => {
    const at = new Date('2026-06-01T00:00:00.000Z');
    const account = await createParentAccount(h.identity, {
      email: 'dupezone@example.test',
      timezone: 'Asia/Manila',
      effectiveFrom: at,
    });

    await expect(
      h.identity.appendTimezone(account.id, 'America/New_York', at),
    ).rejects.toMatchObject({ code: 'P2002' });

    // The surviving history is unambiguous, so the zone in force is stable.
    expect(await h.identity.effectiveTimezoneAt(account.id, new Date())).toBe('Asia/Manila');
    expect(await h.prisma.accountTimezone.count()).toBe(1);
  });

  // --- Email normalisation -----------------------------------------------

  it('normalises email on write and rejects a case-differing duplicate with 409', async () => {
    const created = await createParentAccount(h.identity, { email: '  Ada@Example.Test ' });
    expect(created.email).toBe('ada@example.test');

    await expect(
      createParentAccount(h.identity, { email: 'ADA@example.test' }),
    ).rejects.toMatchObject({ status: 409 });

    expect(await h.prisma.parentAccount.count()).toBe(1);
  });

  // --- Upload usage (derived, never decremented) -------------------------

  /**
   * Upload usage is the count of this account's Source Tests whose
   * `submittedAt` falls in the window (AD-14, FR-31). There is no counter
   * column and no charge row, so this is where "charged once, on success
   * only" is actually proved: the rows are written in the states the flow can
   * leave behind, and the count is read through the same `consumptionFor` the
   * Admin console uses.
   */
  describe('the derived Upload count', () => {
    async function sourceTestFor(
      parentAccountId: string,
      state: { status: 'Draft' | 'Submitted'; submittedAt?: Date },
    ): Promise<void> {
      const gradeLevel = await createGradeLevel(h);
      // One case commits two uploads for one account, so this needs a second
      // active child. The account's own tier must stay put — the cases above
      // assert its figures — so the profile is created under tier headroom that
      // is handed straight back.
      const profile = await createStudentProfileWithHeadroom(h, parentAccountId, {
        gradeLevelId: gradeLevel.id,
      });
      await h.prisma.sourceTest.create({
        data: {
          parentAccountId,
          studentProfileId: profile.id,
          status: state.status,
          submittedAt: state.submittedAt ?? null,
          expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
        },
      });
    }

    const uploadUsed = async (accountId: string): Promise<number> =>
      (await h.allowance.consumptionFor(accountId)).allowances.upload.used;

    it('reads one after a Source Test is committed', async () => {
      const account = await createParentAccount(h.identity, { email: 'upload-one@example.test' });
      await sourceTestFor(account.id, { status: 'Submitted', submittedAt: new Date() });
      expect(await uploadUsed(account.id)).toBe(1);
    });

    it('reads zero for a draft that was never submitted', async () => {
      // Abandoned, or expired, or a submit that was refused — all three leave
      // the row a Draft, and a Draft was never charged.
      const account = await createParentAccount(h.identity, { email: 'upload-draft@example.test' });
      await sourceTestFor(account.id, { status: 'Draft' });
      expect(await uploadUsed(account.id)).toBe(0);
    });

    it('ignores a Source Test committed before the period started', async () => {
      const account = await createParentAccount(h.identity, { email: 'upload-old@example.test' });
      const { periodStart } = await h.allowance.consumptionFor(account.id);
      await sourceTestFor(account.id, {
        status: 'Submitted',
        submittedAt: new Date(new Date(periodStart).getTime() - 1000),
      });
      expect(await uploadUsed(account.id)).toBe(0);
    });

    it('counts the instant the period starts and not the instant it ends', async () => {
      // The half-open `[start, end)` the whole module is stated in: a commit at
      // the reset instant belongs to the next period and is counted once.
      const account = await createParentAccount(h.identity, { email: 'upload-edge@example.test' });
      const { periodStart, periodEnd } = await h.allowance.consumptionFor(account.id);
      await sourceTestFor(account.id, { status: 'Submitted', submittedAt: new Date(periodStart) });
      await sourceTestFor(account.id, { status: 'Submitted', submittedAt: new Date(periodEnd) });
      expect(await uploadUsed(account.id)).toBe(1);
    });

    it('counts this account\u2019s commits and nobody else\u2019s', async () => {
      const mine = await createParentAccount(h.identity, { email: 'upload-mine@example.test' });
      const theirs = await createParentAccount(h.identity, { email: 'upload-theirs@example.test' });
      await sourceTestFor(theirs.id, { status: 'Submitted', submittedAt: new Date() });
      expect(await uploadUsed(mine.id)).toBe(0);
      expect(await uploadUsed(theirs.id)).toBe(1);
    });

    it('leaves no counter column or charge row anywhere to reconcile', async () => {
      // The design claim, asserted rather than described: usage is derived, so
      // the only evidence of a charge is the Source Test row itself.
      const account = await createParentAccount(h.identity, {
        email: 'upload-derived@example.test',
      });
      await sourceTestFor(account.id, { status: 'Submitted', submittedAt: new Date() });
      const columns = await h.prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'source_test'
      `;
      const names = columns.map((column) => column.column_name);
      expect(names).not.toContain('chargedAt');
      expect(names).not.toContain('uploadsUsed');
      expect(names).not.toContain('periodStart');
    });

    /**
     * The acceptance criterion itself, driven through the routes a parent
     * actually uses rather than asserted at the row surface.
     *
     * The rows above prove the *rule* — which rows count and which window they
     * count in. This proves the **claim**: running the check charges nothing,
     * because it produces nothing (AD-29), and committing charges exactly one,
     * because reaching `Submitted` is the charge and there is nothing else to
     * go wrong between the two.
     */
    it('charges exactly one for a commit made through the real routes, and nothing for the check', async () => {
      // A real parent, elevated, with a classified draft holding a page — the
      // whole path, because the charge is a property of the commit and not of
      // a row somebody wrote by hand.
      const parent = await createSignedInParent(h, { email: 'upload-committed@example.test' });
      await setPinFor(h, parent.cookie, PIN);
      const elevation = await elevate(h, parent.cookie, PIN);
      const gradeLevel = await createGradeLevel(h);
      const profile = await createStudentProfile(h, parent.parentAccountId, {
        gradeLevelId: gradeLevel.id,
      });
      const subject = await createSubject(h, { gradeLevelId: gradeLevel.id });

      const draft = await request(server())
        .post('/api/parent/source-tests')
        .set('Authorization', bearer(elevation))
        .send({ studentProfileId: profile.id })
        .expect(200);
      const sourceTestId: string = draft.body.id;

      await request(server())
        .patch(`/api/parent/source-tests/${sourceTestId}/classification`)
        .set('Authorization', bearer(elevation))
        .send({ subjectId: subject.id })
        .expect(200);
      await request(server())
        .post(`/api/parent/source-tests/${sourceTestId}/pages`)
        .set('Authorization', bearer(elevation))
        .attach(
          'file',
          await sharp({
            create: { width: 40, height: 60, channels: 3, background: { r: 1, g: 2, b: 3 } },
          })
            .jpeg()
            .toBuffer(),
          { filename: 'page.jpg', contentType: 'image/jpeg' },
        )
        .expect(201);

      // An open, classified, paged draft is not a commit.
      expect(await uploadUsed(parent.parentAccountId)).toBe(0);

      // Nor is the check: it produces nothing, so it charges nothing — and it
      // makes a provider call, which is exactly why this has to be stated.
      await checkLegibility(h, elevation, sourceTestId);
      expect(await uploadUsed(parent.parentAccountId)).toBe(0);

      await request(server())
        .post(`/api/parent/source-tests/${sourceTestId}/submit`)
        .set('Authorization', bearer(elevation))
        .expect(200);

      expect(await uploadUsed(parent.parentAccountId)).toBe(1);

      // And exactly once: a second submit is refused, and the count does not
      // move — there is no debit a retry could repeat.
      await request(server())
        .post(`/api/parent/source-tests/${sourceTestId}/submit`)
        .set('Authorization', bearer(elevation))
        .expect(409);
      expect(await uploadUsed(parent.parentAccountId)).toBe(1);
    });
  });
});
