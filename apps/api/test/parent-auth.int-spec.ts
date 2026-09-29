import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { limitsFor } from '../src/allowance/tiers.js';
import {
  CHILD_DATA_CONSENT_VERSION,
  DEFAULT_PARENT_SESSION_TTL_SECONDS,
  PARENT_SESSION_AUDIENCE,
  PARENT_SESSION_COOKIE,
  PARENT_SESSION_ISSUER,
  PASSWORD_MIN_LENGTH,
  SIGN_IN_FAILED,
  TERMS_VERSION,
} from '../src/identity/auth-policy.js';
import { hashResetToken } from '../src/identity/parent-auth.service.js';
import {
  adminSecretTokenAtParentAudience,
  adminToken,
  cookieHeader,
  createCredentialedParent,
  createHarness,
  createParentAccount,
  resetParentAccounts,
  sessionCookieFrom,
  sessionTokenFrom,
  type Harness,
} from './harness.js';

const PASSWORD = 'correct-horse-battery-staple';

function signUpBody(overrides: Record<string, unknown> = {}) {
  return {
    email: 'ada@example.test',
    password: PASSWORD,
    timezone: 'Asia/Manila',
    termsVersion: TERMS_VERSION,
    noticeVersion: CHILD_DATA_CONSENT_VERSION,
    ...overrides,
  };
}

describe('parent auth', () => {
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

  // --- CORS ----------------------------------------------------------------

  it('allows credentials against the exact configured origin, never a wildcard', async () => {
    const response = await server()
      .get('/api/auth/policy')
      .set('Origin', 'http://localhost:3000')
      .expect(200);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  // --- Policy ------------------------------------------------------------

  it('publishes the password minimum and the current versions', async () => {
    const response = await server().get('/api/auth/policy').expect(200);
    expect(response.body).toMatchObject({
      passwordMinLength: PASSWORD_MIN_LENGTH,
      termsVersion: TERMS_VERSION,
      noticeVersion: CHILD_DATA_CONSENT_VERSION,
    });
    expect(String(response.body.noticeText).length).toBeGreaterThan(0);
  });

  // --- Sign-up -----------------------------------------------------------

  it('creates the account, its first timezone entry and its consent row in one go', async () => {
    const response = await server().post('/api/auth/sign-up').send(signUpBody()).expect(201);

    const account = await h.prisma.parentAccount.findUniqueOrThrow({
      where: { email: 'ada@example.test' },
      include: { timezones: true, consents: true },
    });
    expect(response.body).toMatchObject({ id: account.id, email: 'ada@example.test' });
    expect(account.passwordHash).toMatch(/^\$argon2id\$/);
    expect(account.timezones).toHaveLength(1);
    expect(account.timezones[0]!.timezone).toBe('Asia/Manila');
    expect(account.consents).toHaveLength(1);
    expect(account.consents[0]).toMatchObject({
      termsVersion: TERMS_VERSION,
      noticeVersion: CHILD_DATA_CONSENT_VERSION,
    });
    expect(account.consents[0]!.acceptedAt).toBeInstanceOf(Date);
  });

  it('sets an httpOnly, SameSite=Strict, Path=/ session cookie on sign-up', async () => {
    const response = await server().post('/api/auth/sign-up').send(signUpBody()).expect(201);
    const cookie = sessionCookieFrom(response)!;
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\//i);
  });

  it('reads Secure from COOKIE_SECURE, not from NODE_ENV', async () => {
    const saved = process.env.COOKIE_SECURE;
    try {
      // The default is on: a credential must not travel in the clear because
      // someone forgot to state a flag.
      delete process.env.COOKIE_SECURE;
      const secure = await server().post('/api/auth/sign-up').send(signUpBody()).expect(201);
      expect(sessionCookieFrom(secure)!).toMatch(/;\s*Secure/i);

      await resetParentAccounts(h.prisma);

      // And opting out is explicit, for local plain HTTP.
      process.env.COOKIE_SECURE = 'false';
      const plain = await server().post('/api/auth/sign-up').send(signUpBody()).expect(201);
      expect(sessionCookieFrom(plain)!).not.toMatch(/;\s*Secure/i);
    } finally {
      if (saved === undefined) delete process.env.COOKIE_SECURE;
      else process.env.COOKIE_SECURE = saved;
    }
  });

  it('rejects a duplicate email with the one generic message and writes nothing', async () => {
    await server().post('/api/auth/sign-up').send(signUpBody()).expect(201);
    const response = await server()
      .post('/api/auth/sign-up')
      .send(signUpBody({ timezone: 'UTC' }))
      .expect(400);

    expect(String(response.body.message)).not.toContain('ada@example.test');
    expect(await h.prisma.parentAccount.count()).toBe(1);
    expect(await h.prisma.accountConsent.count()).toBe(1);
  });

  it('rejects a stale consent version and writes nothing', async () => {
    await server()
      .post('/api/auth/sign-up')
      .send(signUpBody({ noticeVersion: '1900-01-01' }))
      .expect(400);
    expect(await h.prisma.parentAccount.count()).toBe(0);
  });

  it('rejects a password below the minimum at validation', async () => {
    await server()
      .post('/api/auth/sign-up')
      .send(signUpBody({ password: 'a'.repeat(PASSWORD_MIN_LENGTH - 1) }))
      .expect(400);
    expect(await h.prisma.parentAccount.count()).toBe(0);
  });

  it('names an unknown timezone and opens no transaction', async () => {
    const response = await server()
      .post('/api/auth/sign-up')
      .send(signUpBody({ timezone: 'Mars/Olympus' }))
      .expect(400);
    expect(String(response.body.message)).toContain('Unknown timezone: Mars/Olympus');
    expect(await h.prisma.parentAccount.count()).toBe(0);
  });

  // --- Account Tier at birth ---------------------------------------------

  it('lands a real sign-up on Free, with the Free row behind its four figures', async () => {
    await server().post('/api/auth/sign-up').send(signUpBody()).expect(201);

    const stored = await h.prisma.parentAccount.findUniqueOrThrow({
      where: { email: 'ada@example.test' },
    });
    expect(stored.tier).toBe('Free');

    const token = await adminToken(h.jwt, h.operatorId);
    const { body } = await server()
      .get(`/api/admin/parent-accounts/${stored.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // Figures are asserted against the one tiers table, never restated here.
    const free = limitsFor('Free');
    expect(body.account.tier).toBe('Free');
    expect(body.consumption.studentProfileLimit).toBe(free.studentProfiles);
    expect(body.consumption.allowances).toEqual({
      upload: { used: 0, limit: free.upload },
      generation: { used: 0, limit: free.generation },
      explanation: { used: 0, limit: free.explanation },
    });
  });

  it('refuses a sign-up body carrying a tier and writes nothing', async () => {
    const response = await server()
      .post('/api/auth/sign-up')
      .send(signUpBody({ tier: 'Internal' }))
      .expect(400);

    // The refusal has to be about `tier` — a 400 from an unrelated rule
    // (a changed password bound, a broken email check) must not pass here.
    const messages: string[] = Array.isArray(response.body.message)
      ? response.body.message
      : [String(response.body.message)];
    expect(messages.some((message) => message.includes('tier'))).toBe(true);

    // And a refused self-serve tier attempt signs nobody in.
    expect(sessionCookieFrom(response)).toBeUndefined();

    // A 400 raised after the transaction opened would still pass on status alone.
    expect(await h.prisma.parentAccount.count({ where: { email: 'ada@example.test' } })).toBe(0);
    expect(
      await h.prisma.accountTimezone.count({
        where: { parentAccount: { email: 'ada@example.test' } },
      }),
    ).toBe(0);
    expect(
      await h.prisma.accountConsent.count({
        where: { parentAccount: { email: 'ada@example.test' } },
      }),
    ).toBe(0);
  });

  // --- Sign-in -----------------------------------------------------------

  it('signs in with the right password and sets the cookie', async () => {
    const parent = await createCredentialedParent(h.parentAuth, { password: PASSWORD });
    const response = await server()
      .post('/api/auth/sign-in')
      .send({ email: parent.email, password: PASSWORD })
      .expect(200);
    expect(sessionCookieFrom(response)).toBeDefined();
    expect(response.body).toMatchObject({ email: parent.email });
  });

  it('gives one message for a wrong password and for an unknown email', async () => {
    const parent = await createCredentialedParent(h.parentAuth, { password: PASSWORD });

    const wrong = await server()
      .post('/api/auth/sign-in')
      .send({ email: parent.email, password: 'not-the-password' })
      .expect(401);
    const unknown = await server()
      .post('/api/auth/sign-in')
      .send({ email: 'nobody@example.test', password: PASSWORD })
      .expect(401);

    expect(wrong.body.message).toBe(SIGN_IN_FAILED);
    expect(unknown.body.message).toBe(SIGN_IN_FAILED);
  });

  it('treats a pre-Epic-1 account with no password hash as unknown', async () => {
    const account = await createParentAccount(h.identity, { email: 'legacy@example.test' });
    expect(
      (await h.prisma.parentAccount.findUniqueOrThrow({ where: { id: account.id } })).passwordHash,
    ).toBeNull();

    const response = await server()
      .post('/api/auth/sign-in')
      .send({ email: 'legacy@example.test', password: PASSWORD })
      .expect(401);
    expect(response.body.message).toBe(SIGN_IN_FAILED);
  });

  // --- Session -----------------------------------------------------------

  it('reads the session back from the cookie', async () => {
    const signUp = await server().post('/api/auth/sign-up').send(signUpBody()).expect(201);
    const cookie = cookieHeader(sessionCookieFrom(signUp)!);

    const me = await server().get('/api/auth/me').set('Cookie', cookie).expect(200);
    expect(me.body).toEqual({
      id: signUp.body.id,
      email: 'ada@example.test',
      timezone: 'Asia/Manila',
    });
  });

  it('is 401 without a cookie', async () => {
    await server().get('/api/auth/me').expect(401);
  });

  it('gives the session the full session TTL, not an elevation-sized window', async () => {
    const signUp = await server().post('/api/auth/sign-up').send(signUpBody()).expect(201);
    const token = cookieHeader(sessionCookieFrom(signUp)!).slice(
      `${PARENT_SESSION_COOKIE}=`.length,
    );
    const payload = await h.parentJwt.verifyAsync<{ iat: number; exp: number }>(token, {
      audience: PARENT_SESSION_AUDIENCE,
      issuer: PARENT_SESSION_ISSUER,
    });
    // 30 days by default. Emphatically not the 8-hour elevation ceiling, which
    // governs the Story 1.2 credential and nothing here.
    expect(payload.exp - payload.iat).toBe(DEFAULT_PARENT_SESSION_TTL_SECONDS);
    expect(payload.exp - payload.iat).not.toBe(8 * 60 * 60);
  });

  it('takes its lifetime and its cookie maxAge from PARENT_SESSION_TTL_SECONDS', async () => {
    const saved = process.env.PARENT_SESSION_TTL_SECONDS;
    try {
      process.env.PARENT_SESSION_TTL_SECONDS = '3600';
      const signUp = await server().post('/api/auth/sign-up').send(signUpBody()).expect(201);
      const setCookie = sessionCookieFrom(signUp)!;
      const payload = await h.parentJwt.verifyAsync<{ iat: number; exp: number }>(
        sessionTokenFrom(setCookie),
        { audience: PARENT_SESSION_AUDIENCE, issuer: PARENT_SESSION_ISSUER },
      );

      expect(payload.exp - payload.iat).toBe(3600);
      // The cookie's own lifetime matches the token's, so the browser never
      // holds a credential the API has already stopped accepting.
      expect(setCookie).toMatch(/Max-Age=3600/i);
    } finally {
      if (saved === undefined) delete process.env.PARENT_SESSION_TTL_SECONDS;
      else process.env.PARENT_SESSION_TTL_SECONDS = saved;
    }
  });

  it('re-mints the cookie for a token older than the re-mint threshold', async () => {
    const parent = await createCredentialedParent(h.parentAuth);
    // Issued two days ago: past the re-mint threshold, well inside the ceiling.
    const aged = await h.parentJwt.signAsync(
      {
        email: parent.email,
        scope: PARENT_SESSION_AUDIENCE,
        epoch: 0,
        iat: Math.floor(Date.now() / 1000) - 2 * 24 * 60 * 60,
      },
      {
        subject: parent.parentAccountId,
        audience: PARENT_SESSION_AUDIENCE,
        issuer: PARENT_SESSION_ISSUER,
        expiresIn: 30 * 24 * 60 * 60,
      },
    );

    const response = await server()
      .get('/api/auth/me')
      .set('Cookie', `${PARENT_SESSION_COOKIE}=${aged}`)
      .expect(200);
    expect(sessionCookieFrom(response)).toBeDefined();
  });

  it('does not re-mint a freshly issued cookie', async () => {
    const signUp = await server().post('/api/auth/sign-up').send(signUpBody()).expect(201);
    const response = await server()
      .get('/api/auth/me')
      .set('Cookie', cookieHeader(sessionCookieFrom(signUp)!))
      .expect(200);
    expect(sessionCookieFrom(response)).toBeUndefined();
  });

  it('clears the cookie on sign-out and answers 204', async () => {
    const response = await server().post('/api/auth/sign-out').expect(204);
    const cookie = sessionCookieFrom(response)!;
    expect(cookie).toMatch(new RegExp(`^${PARENT_SESSION_COOKIE}=;`));
  });

  // --- Credential crossover (AD-25) --------------------------------------

  it('does not accept an admin token on a parent route', async () => {
    const token = await adminToken(h.jwt, h.operatorId);
    await server().get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
    await server()
      .get('/api/auth/me')
      .set('Cookie', `${PARENT_SESSION_COOKIE}=${token}`)
      .expect(401);
  });

  it('does not accept a token minted with the admin secret at the parent audience', async () => {
    const token = await adminSecretTokenAtParentAudience(h.jwt);
    await server()
      .get('/api/auth/me')
      .set('Cookie', `${PARENT_SESSION_COOKIE}=${token}`)
      .expect(401);
  });

  it('does not accept a parent session token on an admin route', async () => {
    const parent = await createCredentialedParent(h.parentAuth);
    const session = await h.parentAuth.mintSession({
      id: parent.parentAccountId,
      email: parent.email,
      sessionEpoch: 0,
    });
    await server()
      .get('/api/admin/auth/me')
      .set('Authorization', `Bearer ${session.token}`)
      .expect(401);
  });

  // --- Password reset ----------------------------------------------------

  it('writes one token and dispatches one message for a registered email', async () => {
    const parent = await createCredentialedParent(h.parentAuth);

    await server()
      .post('/api/auth/password-reset/request')
      .send({ email: parent.email })
      .expect(204);

    expect(h.mail.sent).toHaveLength(1);
    expect(h.mail.sent[0]!.to).toBe(parent.email);
    const link = /token=([^\s&]+)/.exec(h.mail.sent[0]!.text)!;
    expect(h.mail.sent[0]!.text).toContain('/auth/reset/confirm?token=');

    const rows = await h.prisma.passwordReset.findMany();
    expect(rows).toHaveLength(1);
    // The emailed plaintext matches no stored value.
    expect(rows[0]!.tokenHash).not.toBe(decodeURIComponent(link[1]!));
    expect(rows[0]!.tokenHash).toBe(hashResetToken(decodeURIComponent(link[1]!)));
  });

  it('answers identically for an unregistered email, writing and sending nothing', async () => {
    await server()
      .post('/api/auth/password-reset/request')
      .send({ email: 'nobody@example.test' })
      .expect(204);
    expect(h.mail.sent).toHaveLength(0);
    expect(await h.prisma.passwordReset.count()).toBe(0);
  });

  it('writes and sends nothing for an account with no password hash', async () => {
    await createParentAccount(h.identity, { email: 'legacy@example.test' });
    await server()
      .post('/api/auth/password-reset/request')
      .send({ email: 'legacy@example.test' })
      .expect(204);
    expect(h.mail.sent).toHaveLength(0);
    expect(await h.prisma.passwordReset.count()).toBe(0);
  });

  it('is still 204 when the transport fails', async () => {
    const parent = await createCredentialedParent(h.parentAuth);
    h.mail.failNext();
    await server()
      .post('/api/auth/password-reset/request')
      .send({ email: parent.email })
      .expect(204);
  });

  it('retires the previous link when a new one is requested', async () => {
    const parent = await createCredentialedParent(h.parentAuth);
    await server()
      .post('/api/auth/password-reset/request')
      .send({ email: parent.email })
      .expect(204);
    await server()
      .post('/api/auth/password-reset/request')
      .send({ email: parent.email })
      .expect(204);

    const live = await h.prisma.passwordReset.findMany({ where: { usedAt: null } });
    expect(live).toHaveLength(1);
  });

  it('replaces the password, marks the token used, and rejects a replay', async () => {
    const parent = await createCredentialedParent(h.parentAuth, { password: PASSWORD });
    await server()
      .post('/api/auth/password-reset/request')
      .send({ email: parent.email })
      .expect(204);
    const token = decodeURIComponent(/token=([^\s&]+)/.exec(h.mail.sent[0]!.text)![1]!);

    await server()
      .post('/api/auth/password-reset/confirm')
      .send({ token, password: 'a-brand-new-passphrase' })
      .expect(204);

    await server()
      .post('/api/auth/sign-in')
      .send({ email: parent.email, password: PASSWORD })
      .expect(401);
    await server()
      .post('/api/auth/sign-in')
      .send({ email: parent.email, password: 'a-brand-new-passphrase' })
      .expect(200);

    await server()
      .post('/api/auth/password-reset/confirm')
      .send({ token, password: 'yet-another-passphrase' })
      .expect(400);
    expect((await h.prisma.passwordReset.findFirstOrThrow()).usedAt).not.toBeNull();
  });

  it('ends every session minted before the reset', async () => {
    const parent = await createCredentialedParent(h.parentAuth, { password: PASSWORD });
    const signIn = await server()
      .post('/api/auth/sign-in')
      .send({ email: parent.email, password: PASSWORD })
      .expect(200);
    const cookie = cookieHeader(sessionCookieFrom(signIn)!);
    await server().get('/api/auth/me').set('Cookie', cookie).expect(200);

    await server()
      .post('/api/auth/password-reset/request')
      .send({ email: parent.email })
      .expect(204);
    const token = decodeURIComponent(/token=([^\s&]+)/.exec(h.mail.sent[0]!.text)![1]!);
    await server()
      .post('/api/auth/password-reset/confirm')
      .send({ token, password: 'a-brand-new-passphrase' })
      .expect(204);

    await server().get('/api/auth/me').set('Cookie', cookie).expect(401);
  });

  it('rejects an unknown or expired token with one generic message', async () => {
    const unknown = await server()
      .post('/api/auth/password-reset/confirm')
      .send({ token: 'no-such-token', password: 'a-brand-new-passphrase' })
      .expect(400);

    const parent = await createCredentialedParent(h.parentAuth);
    await server()
      .post('/api/auth/password-reset/request')
      .send({ email: parent.email })
      .expect(204);
    const token = decodeURIComponent(/token=([^\s&]+)/.exec(h.mail.sent[0]!.text)![1]!);
    await h.prisma.passwordReset.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    const expired = await server()
      .post('/api/auth/password-reset/confirm')
      .send({ token, password: 'a-brand-new-passphrase' })
      .expect(400);

    expect(expired.body.message).toBe(unknown.body.message);
  });
});
