import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { limitsFor } from '../src/allowance/tiers.js';
import {
  adminToken,
  createHarness,
  createParentAccount,
  parentStyleToken,
  resetParentAccounts,
  type Harness,
} from './harness.js';

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
    await resetParentAccounts(h.prisma);
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
});
