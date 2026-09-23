import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

// A cool-down long enough that nothing in this file races it, and short enough
// to be obviously not the production figure. The lapse is exercised by moving
// the row into the past, which is the honest test: the lock is a column.
const COOLDOWN_MS = 60_000;
process.env.PIN_COOLDOWN_MS = String(COOLDOWN_MS);

const { PARENT_SESSION_AUDIENCE, PARENT_SESSION_COOKIE, PARENT_SESSION_ISSUER } = await import(
  '../src/identity/auth-policy.js'
);
const {
  MAX_PIN_ATTEMPTS,
  PARENT_ELEVATION_AUDIENCE,
  PIN_INCORRECT,
  PIN_LENGTH,
  elevationCeilingMs,
} = await import('../src/identity/pin-policy.js');
const {
  bearer,
  createHarness,
  createSignedInParent,
  elevate,
  elevationTokenFrom,
  elevationTokenWithClaims,
  resetParentAccounts,
  setPinFor,
} = await import('./harness.js');

type Harness = Awaited<ReturnType<typeof createHarness>>;

const PIN = '4821';
const OTHER_PIN = '1357';

describe('parent PIN and Parent View elevation', () => {
  let h: Harness;
  const server = () => request(h.app.getHttpServer());

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(async () => {
    await h.close();
  });

  beforeEach(async () => {
    await resetParentAccounts(h.prisma);
    h.mail.reset();
  });

  const pinRow = (id: string) =>
    h.prisma.parentAccount.findUniqueOrThrow({
      where: { id },
      select: { pinHash: true, pinFailedAttempts: true, pinLockedUntil: true },
    });

  // --- Published figures ---------------------------------------------------

  it('publishes the PIN shape, the attempt ceiling and the cool-down on the policy', async () => {
    const response = await server().get('/api/auth/policy').expect(200);
    // Asserted key by key rather than with toMatchObject, which passes just as
    // happily when a figure the web needs is absent from the body entirely.
    expect(response.body.pinLength).toBe(PIN_LENGTH);
    expect(response.body.pinMaxAttempts).toBe(MAX_PIN_ATTEMPTS);
    expect(response.body.pinCooldownMinutes).toBe(Math.round(COOLDOWN_MS / 60_000));
  });

  // --- Status --------------------------------------------------------------

  it('reports no PIN and no lock for an account that has never set one', async () => {
    const parent = await createSignedInParent(h);
    const response = await server()
      .get('/api/parent/pin/status')
      .set('Cookie', parent.cookie)
      .expect(200);
    expect(response.body).toEqual({ pinSet: false, lockedUntil: null });
  });

  it('refuses the status read without the session cookie', async () => {
    await server().get('/api/parent/pin/status').expect(401);
  });

  // --- Setting the first PIN ----------------------------------------------

  it('writes the hash, a zero counter and no lock when the first PIN is set', async () => {
    const parent = await createSignedInParent(h);
    await setPinFor(h, parent.cookie, PIN);

    const row = await pinRow(parent.parentAccountId);
    expect(row.pinHash).toMatch(/^\$argon2id\$/);
    expect(row.pinFailedAttempts).toBe(0);
    expect(row.pinLockedUntil).toBeNull();

    const status = await server()
      .get('/api/parent/pin/status')
      .set('Cookie', parent.cookie)
      .expect(200);
    expect(status.body).toEqual({ pinSet: true, lockedUntil: null });
  });

  it('refuses to set a second PIN: setting is not a change path', async () => {
    const parent = await createSignedInParent(h);
    await setPinFor(h, parent.cookie, PIN);

    const response = await server()
      .post('/api/parent/pin')
      .set('Cookie', parent.cookie)
      .send({ pin: OTHER_PIN })
      .expect(409);
    expect(String(response.body.message)).not.toContain(OTHER_PIN);
  });

  it('states the required shape for a PIN that is not exactly four digits', async () => {
    const parent = await createSignedInParent(h);
    for (const pin of ['123', '12345', '12a4', '']) {
      await server().post('/api/parent/pin').set('Cookie', parent.cookie).send({ pin }).expect(400);
    }
    expect((await pinRow(parent.parentAccountId)).pinHash).toBeNull();
  });

  it('refuses to set a PIN without the session cookie', async () => {
    await server().post('/api/parent/pin').send({ pin: PIN }).expect(401);
  });

  // --- Crossing the PIN ----------------------------------------------------

  it('mints an elevation token with both instants on a correct PIN', async () => {
    const parent = await createSignedInParent(h);
    await setPinFor(h, parent.cookie, PIN);

    const before = Date.now();
    const response = await server()
      .post('/api/parent/pin/verify')
      .set('Cookie', parent.cookie)
      .send({ pin: PIN })
      .expect(200);

    expect(typeof response.body.token).toBe('string');
    expect(Date.parse(response.body.expiresAt)).toBeGreaterThan(before);
    // The ceiling runs from the crossing, and is far beyond one token's life.
    expect(Date.parse(response.body.ceilingAt)).toBeGreaterThanOrEqual(
      before + elevationCeilingMs() - 1000,
    );
    expect(Date.parse(response.body.ceilingAt)).toBeGreaterThan(
      Date.parse(response.body.expiresAt),
    );
  });

  it('refuses a PIN when none is set, mirroring the set-when-exists conflict', async () => {
    const parent = await createSignedInParent(h);
    await server()
      .post('/api/parent/pin/verify')
      .set('Cookie', parent.cookie)
      .send({ pin: PIN })
      .expect(409);
  });

  it('counts the first two wrong entries in the database, with one message', async () => {
    const parent = await createSignedInParent(h);
    await setPinFor(h, parent.cookie, PIN);

    const messages: string[] = [];
    for (let attempt = 1; attempt < MAX_PIN_ATTEMPTS; attempt += 1) {
      const response = await server()
        .post('/api/parent/pin/verify')
        .set('Cookie', parent.cookie)
        .send({ pin: OTHER_PIN })
        .expect(401);
      messages.push(String(response.body.message));
      const row = await pinRow(parent.parentAccountId);
      expect(row.pinFailedAttempts).toBe(attempt);
      expect(row.pinLockedUntil).toBeNull();
    }
    // One generic line, identical every time — no counter, no code.
    expect(new Set(messages).size).toBe(1);
    expect(messages[0]).toBe(PIN_INCORRECT);
  });

  it('refuses a wrong-length PIN as a wrong PIN, not as a validation error', async () => {
    const parent = await createSignedInParent(h);
    await setPinFor(h, parent.cookie, PIN);

    const response = await server()
      .post('/api/parent/pin/verify')
      .set('Cookie', parent.cookie)
      .send({ pin: '123' })
      .expect(401);

    // The entry endpoint states no shape: a 400 naming the length would tell
    // whoever is guessing exactly how long the secret is.
    expect(String(response.body.message)).toBe(PIN_INCORRECT);
    expect(String(response.body.message)).not.toMatch(/\d/);
    // And it costs an attempt, exactly as any other wrong entry does.
    expect((await pinRow(parent.parentAccountId)).pinFailedAttempts).toBe(1);
  });

  it('reaches the lock under concurrent wrong entries, not just sequential ones', async () => {
    const parent = await createSignedInParent(h);
    await setPinFor(h, parent.cookie, PIN);

    // Fired together, so every request reads the same counter before any of
    // them writes. A counter incremented in JS would have them all write the
    // same value and the ceiling would never be reached — which is the whole
    // of the brute-force defence.
    const responses = await Promise.all(
      Array.from({ length: MAX_PIN_ATTEMPTS }, () =>
        server()
          .post('/api/parent/pin/verify')
          .set('Cookie', parent.cookie)
          .send({ pin: OTHER_PIN }),
      ),
    );
    expect(responses.every((response) => response.status === 401 || response.status === 423)).toBe(
      true,
    );

    const row = await pinRow(parent.parentAccountId);
    expect(row.pinLockedUntil).not.toBeNull();
    expect(row.pinLockedUntil!.getTime()).toBeGreaterThan(Date.now());

    // And the gate really is shut afterwards, correct PIN included.
    await server()
      .post('/api/parent/pin/verify')
      .set('Cookie', parent.cookie)
      .send({ pin: PIN })
      .expect(423);
  });

  it('never lets two concurrent first-set requests both write a PIN', async () => {
    const parent = await createSignedInParent(h);

    const [first, second] = await Promise.all([
      server().post('/api/parent/pin').set('Cookie', parent.cookie).send({ pin: PIN }),
      server().post('/api/parent/pin').set('Cookie', parent.cookie).send({ pin: OTHER_PIN }),
    ]);

    // Exactly one wins; the loser gets the same conflict a later request would.
    const statuses = [first!.status, second!.status].sort();
    expect(statuses).toEqual([204, 409]);

    // And the PIN that is stored is the winner's — whichever that was, exactly
    // one of the two opens the gate and the other does not.
    const opens = await Promise.all(
      [PIN, OTHER_PIN].map(async (pin) => {
        const response = await server()
          .post('/api/parent/pin/verify')
          .set('Cookie', parent.cookie)
          .send({ pin });
        return response.status === 200;
      }),
    );
    expect(opens.filter(Boolean)).toHaveLength(1);
  });

  it('locks on the third wrong entry and states when the lock lifts', async () => {
    const parent = await createSignedInParent(h);
    await setPinFor(h, parent.cookie, PIN);

    for (let i = 0; i < MAX_PIN_ATTEMPTS - 1; i += 1) {
      await server()
        .post('/api/parent/pin/verify')
        .set('Cookie', parent.cookie)
        .send({ pin: OTHER_PIN })
        .expect(401);
    }
    const locked = await server()
      .post('/api/parent/pin/verify')
      .set('Cookie', parent.cookie)
      .send({ pin: OTHER_PIN })
      .expect(423);

    expect(Date.parse(locked.body.lockedUntil)).toBeGreaterThan(Date.now());
    const row = await pinRow(parent.parentAccountId);
    // The counter is back at zero behind the lock: a cool-down ends with a full
    // allowance, not one entry from the next lock.
    expect(row.pinFailedAttempts).toBe(0);
    expect(row.pinLockedUntil).not.toBeNull();
  });

  it('refuses even the correct PIN while locked, and does not lift the lock', async () => {
    const parent = await createSignedInParent(h);
    await setPinFor(h, parent.cookie, PIN);
    for (let i = 0; i < MAX_PIN_ATTEMPTS; i += 1) {
      await server()
        .post('/api/parent/pin/verify')
        .set('Cookie', parent.cookie)
        .send({ pin: OTHER_PIN });
    }
    const before = await pinRow(parent.parentAccountId);

    const response = await server()
      .post('/api/parent/pin/verify')
      .set('Cookie', parent.cookie)
      .send({ pin: PIN })
      .expect(423);
    expect(response.body.lockedUntil).toBe(before.pinLockedUntil!.toISOString());

    // Nothing moved: the correct PIN neither unlocked the gate nor spent an
    // attempt, because no verification ran at all.
    const after = await pinRow(parent.parentAccountId);
    expect(after.pinLockedUntil).toEqual(before.pinLockedUntil);
    expect(after.pinFailedAttempts).toBe(before.pinFailedAttempts);
  });

  it('shows the live lock on the status read', async () => {
    const parent = await createSignedInParent(h);
    await setPinFor(h, parent.cookie, PIN);
    for (let i = 0; i < MAX_PIN_ATTEMPTS; i += 1) {
      await server()
        .post('/api/parent/pin/verify')
        .set('Cookie', parent.cookie)
        .send({ pin: OTHER_PIN });
    }
    const status = await server()
      .get('/api/parent/pin/status')
      .set('Cookie', parent.cookie)
      .expect(200);
    expect(status.body.pinSet).toBe(true);
    expect(Date.parse(status.body.lockedUntil)).toBeGreaterThan(Date.now());
  });

  it('keeps the lock across a fresh app instance against the same database', async () => {
    const parent = await createSignedInParent(h);
    await setPinFor(h, parent.cookie, PIN);
    for (let i = 0; i < MAX_PIN_ATTEMPTS; i += 1) {
      await server()
        .post('/api/parent/pin/verify')
        .set('Cookie', parent.cookie)
        .send({ pin: OTHER_PIN });
    }

    // A second app: new throttlers, new caches, nothing shared but the rows.
    const restarted = await createHarness();
    try {
      await request(restarted.app.getHttpServer())
        .post('/api/parent/pin/verify')
        .set('Cookie', parent.cookie)
        .send({ pin: PIN })
        .expect(423);
    } finally {
      await restarted.close();
    }
  });

  it('accepts the same correct PIN once the cool-down has lapsed', async () => {
    const parent = await createSignedInParent(h);
    await setPinFor(h, parent.cookie, PIN);
    for (let i = 0; i < MAX_PIN_ATTEMPTS; i += 1) {
      await server()
        .post('/api/parent/pin/verify')
        .set('Cookie', parent.cookie)
        .send({ pin: OTHER_PIN });
    }
    // The clock, moved rather than waited on: the lock is a row.
    await h.prisma.parentAccount.update({
      where: { id: parent.parentAccountId },
      data: { pinLockedUntil: new Date(Date.now() - 1000) },
    });

    // A lapsed lock is masked by the status read: showing one the next entry
    // would sail straight through would shut a form for no reason.
    const status = await server()
      .get('/api/parent/pin/status')
      .set('Cookie', parent.cookie)
      .expect(200);
    expect(status.body).toEqual({ pinSet: true, lockedUntil: null });

    await server()
      .post('/api/parent/pin/verify')
      .set('Cookie', parent.cookie)
      .send({ pin: PIN })
      .expect(200);

    const row = await pinRow(parent.parentAccountId);
    expect(row.pinFailedAttempts).toBe(0);
    expect(row.pinLockedUntil).toBeNull();
  });

  // --- The gate ------------------------------------------------------------

  it('serves the parent-scoped read to an elevation bearer', async () => {
    const parent = await createSignedInParent(h);
    await setPinFor(h, parent.cookie, PIN);
    const token = await elevate(h, parent.cookie, PIN);

    const response = await server()
      .get('/api/parent/session')
      .set('Authorization', bearer(token))
      .expect(200);
    expect(response.body).toMatchObject({ id: parent.parentAccountId, email: parent.email });
    expect(Date.parse(response.body.expiresAt)).toBeGreaterThan(Date.now());
    expect(Date.parse(response.body.ceilingAt)).toBeGreaterThan(
      Date.parse(response.body.expiresAt),
    );
  });

  it('refuses the parent-scoped read to the session cookie alone', async () => {
    const parent = await createSignedInParent(h);
    await setPinFor(h, parent.cookie, PIN);
    await elevate(h, parent.cookie, PIN);

    await server().get('/api/parent/session').set('Cookie', parent.cookie).expect(401);
  });

  it('refuses the session token presented as a bearer', async () => {
    const parent = await createSignedInParent(h);
    const sessionToken = parent.cookie.slice(`${PARENT_SESSION_COOKIE}=`.length);
    await server()
      .get('/api/parent/session')
      .set('Authorization', bearer(sessionToken))
      .expect(401);
  });

  it('refuses an elevation token presented as the session cookie', async () => {
    const parent = await createSignedInParent(h);
    await setPinFor(h, parent.cookie, PIN);
    const token = await elevate(h, parent.cookie, PIN);

    await server()
      .get('/api/auth/me')
      .set('Cookie', `${PARENT_SESSION_COOKIE}=${token}`)
      .expect(401);
  });

  it('refuses a token minted at the session audience but carrying elevation claims', async () => {
    const parent = await createSignedInParent(h);
    const token = await h.parentJwt.signAsync(
      {
        email: parent.email,
        scope: PARENT_ELEVATION_AUDIENCE,
        epoch: 0,
        elevatedAt: Date.now(),
      },
      {
        subject: parent.parentAccountId,
        audience: PARENT_SESSION_AUDIENCE,
        issuer: PARENT_SESSION_ISSUER,
      },
    );
    await server().get('/api/parent/session').set('Authorization', bearer(token)).expect(401);
  });

  it('refuses an elevation token that carries no expiry at all', async () => {
    const parent = await createSignedInParent(h);
    await setPinFor(h, parent.cookie, PIN);

    // Signed with the right secret, audience, issuer and every other claim —
    // but unexpiring. Without an `exp` check it would live until the ceiling
    // and report a 1970 `expiresAt`.
    const endless = await elevationTokenWithClaims(h.parentJwt, {
      email: parent.email,
      scope: PARENT_ELEVATION_AUDIENCE,
      epoch: 0,
      sub: parent.parentAccountId,
      elevatedAt: Date.now(),
    });

    await server().get('/api/parent/session').set('Authorization', bearer(endless)).expect(401);
    await server()
      .post('/api/parent/elevation/refresh')
      .set('Authorization', bearer(endless))
      .expect(401);
  });

  it('states an expiry in the future on the parent-scoped read, never a 1970 one', async () => {
    const parent = await createSignedInParent(h);
    await setPinFor(h, parent.cookie, PIN);
    const token = await elevate(h, parent.cookie, PIN);

    const response = await server()
      .get('/api/parent/session')
      .set('Authorization', bearer(token))
      .expect(200);
    expect(Date.parse(response.body.expiresAt)).toBeGreaterThan(Date.now());
  });

  it('names the elevation guard as the refuser, so a wrong PIN is distinguishable', async () => {
    const parent = await createSignedInParent(h);
    await setPinFor(h, parent.cookie, PIN);
    const token = await elevate(h, parent.cookie, PIN);

    // The guard's own 401 says so; a wrong credential behind it does not.
    const unelevated = await server()
      .post('/api/parent/pin/change')
      .send({ currentPin: PIN, newPin: OTHER_PIN })
      .expect(401);
    expect(unelevated.body.elevated).toBe(false);

    const wrongPin = await server()
      .post('/api/parent/pin/change')
      .set('Authorization', bearer(token))
      .send({ currentPin: OTHER_PIN, newPin: '9999' })
      .expect(401);
    expect(wrongPin.body.elevated).toBeUndefined();
  });

  // --- Refresh and the ceiling --------------------------------------------

  it('refreshes to a new token carrying the original ceiling', async () => {
    const parent = await createSignedInParent(h);
    await setPinFor(h, parent.cookie, PIN);
    const first = await server()
      .post('/api/parent/pin/verify')
      .set('Cookie', parent.cookie)
      .send({ pin: PIN })
      .expect(200);

    const refreshed = await server()
      .post('/api/parent/elevation/refresh')
      .set('Authorization', bearer(elevationTokenFrom(first)))
      .expect(200);

    expect(refreshed.body.ceilingAt).toBe(first.body.ceilingAt);
    // Refreshing twice must not walk the ceiling forward either.
    const again = await server()
      .post('/api/parent/elevation/refresh')
      .set('Authorization', bearer(elevationTokenFrom(refreshed)))
      .expect(200);
    expect(again.body.ceilingAt).toBe(first.body.ceilingAt);
  });

  it('refuses a refresh once the ceiling has passed, however live the token is', async () => {
    const parent = await createSignedInParent(h);
    await setPinFor(h, parent.cookie, PIN);

    const stale = await elevationTokenWithClaims(h.parentJwt, {
      email: parent.email,
      scope: PARENT_ELEVATION_AUDIENCE,
      epoch: 0,
      sub: parent.parentAccountId,
      // Crossed more than the whole ceiling ago; the token itself is unexpired.
      elevatedAt: Date.now() - elevationCeilingMs() - 1000,
    });

    await server()
      .post('/api/parent/elevation/refresh')
      .set('Authorization', bearer(stale))
      .expect(401);
    await server().get('/api/parent/session').set('Authorization', bearer(stale)).expect(401);
  });

  it('ends elevation when a password reset bumps the session epoch', async () => {
    const parent = await createSignedInParent(h);
    await setPinFor(h, parent.cookie, PIN);
    const token = await elevate(h, parent.cookie, PIN);
    await server().get('/api/parent/session').set('Authorization', bearer(token)).expect(200);

    await h.parentAuth.requestPasswordReset(parent.email);
    const link = h.mail.sent.at(-1)!.text;
    const resetToken = decodeURIComponent(link.split('token=')[1]!.trim());
    await h.parentAuth.confirmPasswordReset(resetToken, 'a-brand-new-password-entirely');

    await server().get('/api/parent/session').set('Authorization', bearer(token)).expect(401);
    await server()
      .post('/api/parent/elevation/refresh')
      .set('Authorization', bearer(token))
      .expect(401);
  });

  // --- Changing the PIN ----------------------------------------------------

  it('changes the PIN on the current PIN, and the old one stops working', async () => {
    const parent = await createSignedInParent(h);
    await setPinFor(h, parent.cookie, PIN);
    const token = await elevate(h, parent.cookie, PIN);

    await server()
      .post('/api/parent/pin/change')
      .set('Authorization', bearer(token))
      .send({ currentPin: PIN, newPin: OTHER_PIN })
      .expect(204);

    await server()
      .post('/api/parent/pin/verify')
      .set('Cookie', parent.cookie)
      .send({ pin: PIN })
      .expect(401);
    await server()
      .post('/api/parent/pin/verify')
      .set('Cookie', parent.cookie)
      .send({ pin: OTHER_PIN })
      .expect(200);
  });

  it('changes the PIN on the account password', async () => {
    const parent = await createSignedInParent(h);
    await setPinFor(h, parent.cookie, PIN);
    const token = await elevate(h, parent.cookie, PIN);

    await server()
      .post('/api/parent/pin/change')
      .set('Authorization', bearer(token))
      .send({ password: parent.password, newPin: OTHER_PIN })
      .expect(204);

    await server()
      .post('/api/parent/pin/verify')
      .set('Cookie', parent.cookie)
      .send({ pin: OTHER_PIN })
      .expect(200);
  });

  it('rejects a change that gives both credentials or neither', async () => {
    const parent = await createSignedInParent(h);
    await setPinFor(h, parent.cookie, PIN);
    const token = await elevate(h, parent.cookie, PIN);

    await server()
      .post('/api/parent/pin/change')
      .set('Authorization', bearer(token))
      .send({ newPin: OTHER_PIN })
      .expect(400);
    await server()
      .post('/api/parent/pin/change')
      .set('Authorization', bearer(token))
      .send({ newPin: OTHER_PIN, currentPin: PIN, password: parent.password })
      .expect(400);
  });

  it('spends an attempt on a wrong current PIN but never on a wrong password', async () => {
    const parent = await createSignedInParent(h);
    await setPinFor(h, parent.cookie, PIN);
    const token = await elevate(h, parent.cookie, PIN);

    await server()
      .post('/api/parent/pin/change')
      .set('Authorization', bearer(token))
      .send({ currentPin: OTHER_PIN, newPin: '9999' })
      .expect(401);
    expect((await pinRow(parent.parentAccountId)).pinFailedAttempts).toBe(1);

    await server()
      .post('/api/parent/pin/change')
      .set('Authorization', bearer(token))
      .send({ password: 'not-the-password-at-all', newPin: '9999' })
      .expect(401);
    // A mistyped password must not lock a parent out of the mode they are in.
    expect((await pinRow(parent.parentAccountId)).pinFailedAttempts).toBe(1);
  });

  it('clears the counter and a live lock when the PIN is changed', async () => {
    const parent = await createSignedInParent(h);
    await setPinFor(h, parent.cookie, PIN);
    const token = await elevate(h, parent.cookie, PIN);

    // A real lock, driven all the way to the ceiling: asserting the columns
    // come back clear means nothing against a row that was already clear.
    for (let i = 0; i < MAX_PIN_ATTEMPTS; i += 1) {
      await server()
        .post('/api/parent/pin/change')
        .set('Authorization', bearer(token))
        .send({ currentPin: OTHER_PIN, newPin: '9999' });
    }
    const locked = await pinRow(parent.parentAccountId);
    expect(locked.pinLockedUntil).not.toBeNull();
    expect(locked.pinLockedUntil!.getTime()).toBeGreaterThan(Date.now());

    await server()
      .post('/api/parent/pin/change')
      .set('Authorization', bearer(token))
      .send({ password: parent.password, newPin: '9999' })
      .expect(204);

    const row = await pinRow(parent.parentAccountId);
    expect(row.pinFailedAttempts).toBe(0);
    expect(row.pinLockedUntil).toBeNull();
  });

  it('refuses a change presented with the session cookie alone', async () => {
    const parent = await createSignedInParent(h);
    await setPinFor(h, parent.cookie, PIN);
    await elevate(h, parent.cookie, PIN);

    await server()
      .post('/api/parent/pin/change')
      .set('Cookie', parent.cookie)
      .send({ currentPin: PIN, newPin: OTHER_PIN })
      .expect(401);
  });

  it('states the required shape for a new PIN that is not four digits', async () => {
    const parent = await createSignedInParent(h);
    await setPinFor(h, parent.cookie, PIN);
    const token = await elevate(h, parent.cookie, PIN);

    await server()
      .post('/api/parent/pin/change')
      .set('Authorization', bearer(token))
      .send({ currentPin: PIN, newPin: '12' })
      .expect(400);
  });

  // --- Secrecy -------------------------------------------------------------

  it('never carries the PIN or its hash in any response on the surface', async () => {
    const parent = await createSignedInParent(h);
    const bodies: string[] = [];
    const record = (response: { text?: string; body?: unknown }) => {
      bodies.push(response.text ?? '', JSON.stringify(response.body ?? null));
    };

    record(await server().post('/api/parent/pin').set('Cookie', parent.cookie).send({ pin: PIN }));
    record(await server().get('/api/parent/pin/status').set('Cookie', parent.cookie));
    const verified = await server()
      .post('/api/parent/pin/verify')
      .set('Cookie', parent.cookie)
      .send({ pin: PIN });
    record(verified);
    const token = elevationTokenFrom(verified);
    record(await server().get('/api/parent/session').set('Authorization', bearer(token)));
    record(
      await server()
        .post('/api/parent/pin/verify')
        .set('Cookie', parent.cookie)
        .send({ pin: OTHER_PIN }),
    );
    record(
      await server()
        .post('/api/parent/pin/change')
        .set('Authorization', bearer(token))
        .send({ currentPin: PIN, newPin: OTHER_PIN }),
    );

    const stored = await pinRow(parent.parentAccountId);
    for (const body of bodies) {
      expect(body).not.toContain(PIN);
      expect(body).not.toContain(OTHER_PIN);
      expect(body).not.toContain('argon2');
      if (stored.pinHash) expect(body).not.toContain(stored.pinHash);
    }
  });

  it('keeps the PIN hash out of every account read path', async () => {
    const parent = await createSignedInParent(h);
    await setPinFor(h, parent.cookie, PIN);

    const me = await server().get('/api/auth/me').set('Cookie', parent.cookie).expect(200);
    expect(JSON.stringify(me.body)).not.toContain('pinHash');
    expect(me.body.pinHash).toBeUndefined();

    const account = await h.identity.findById(parent.parentAccountId);
    expect(Object.keys(account)).not.toContain('pinHash');
  });
});
