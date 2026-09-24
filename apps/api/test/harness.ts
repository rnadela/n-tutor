import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app-setup.js';
import { AdminAuditService } from '../src/admin/admin-audit.service.js';
import {
  ADMIN_JWT,
  ADMIN_JWT_AUDIENCE,
  ADMIN_JWT_ISSUER,
} from '../src/admin/admin-auth.constants.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { TaxonomyService } from '../src/admin/taxonomy.service.js';
import { AllowanceService } from '../src/allowance/allowance.service.js';
import { ParentAccountAdminService } from '../src/admin/parent-account-admin.service.js';
import {
  ParentAccountService,
  type ParentAccount,
} from '../src/identity/parent-account.service.js';
import { ParentAuthService } from '../src/identity/parent-auth.service.js';
import {
  StudentProfileService,
  type StudentProfileView,
} from '../src/identity/student-profile.service.js';
import {
  CHILD_DATA_CONSENT_VERSION,
  PARENT_JWT,
  PARENT_SESSION_AUDIENCE,
  PARENT_SESSION_COOKIE,
  PARENT_SESSION_ISSUER,
  TERMS_VERSION,
} from '../src/identity/auth-policy.js';
import { PARENT_ELEVATION_AUDIENCE } from '../src/identity/pin-policy.js';
import { STUDENT_MODE_AUDIENCE, STUDENT_MODE_COOKIE } from '../src/identity/student-mode-policy.js';
import { MailDispatchError, MailService } from '../src/mail/mail.service.js';
import { AiService } from '../src/ai/ai.service.js';
import { ExtractionRunner } from '../src/extraction/extraction.runner.js';
import { PracticeTestRunner } from '../src/practicetest/practice-test.runner.js';
import type { AiFakeFailure } from '../src/ai/ai-config.js';
import type { AccountTier } from '../src/generated/prisma/enums.js';

export const OPERATOR_EMAIL = 'test-operator@example.test';
export const OPERATOR_PASSWORD = 'correct-horse-battery-staple';

export interface Harness {
  app: INestApplication;
  moduleRef: TestingModule;
  prisma: PrismaService;
  taxonomy: TaxonomyService;
  identity: ParentAccountService;
  allowance: AllowanceService;
  parentAccounts: ParentAccountAdminService;
  audit: AdminAuditService;
  /** The admin module's own JwtService — resolved from the module that signs
   * with `ADMIN_JWT_SECRET`, never rebuilt from raw env, so the test surface
   * cannot drift from production signing options. */
  jwt: JwtService;
  /** The identity module's JwtService, signing with `PARENT_JWT_SECRET`. */
  parentJwt: JwtService;
  parentAuth: ParentAuthService;
  /** `identity`'s sole writer of StudentProfile. */
  students: StudentProfileService;
  mail: MailCapture;
  /** The captured `ai` seam: what was asked for, and the failure latch. */
  ai: AiCapture;
  /**
   * The extraction worker, so a spec drives exactly one pass rather than
   * waiting on a poll timer. The timer itself is off in the test tier.
   */
  extractionRunner: ExtractionRunner;
  /**
   * The generation worker, exposed for the same reason the extraction one is:
   * a spec drives exactly one pass rather than waiting on a poll timer. The
   * timer itself is off in the test tier.
   */
  practiceTestRunner: PracticeTestRunner;
  operatorId: string;
  close(): Promise<void>;
}

export async function createHarness(): Promise<Harness> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = configureApp(moduleRef.createNestApplication({ logger: false }));
  await app.init();

  const prisma = moduleRef.get(PrismaService);
  const harness: Harness = {
    app,
    moduleRef,
    prisma,
    taxonomy: moduleRef.get(TaxonomyService),
    identity: moduleRef.get(ParentAccountService),
    allowance: moduleRef.get(AllowanceService),
    parentAccounts: moduleRef.get(ParentAccountAdminService),
    audit: moduleRef.get(AdminAuditService),
    jwt: moduleRef.get<JwtService>(ADMIN_JWT),
    parentJwt: moduleRef.get<JwtService>(PARENT_JWT),
    parentAuth: moduleRef.get(ParentAuthService),
    students: moduleRef.get(StudentProfileService),
    mail: captureMail(moduleRef.get(MailService)),
    ai: captureAi(moduleRef.get(AiService)),
    extractionRunner: moduleRef.get(ExtractionRunner),
    practiceTestRunner: moduleRef.get(PracticeTestRunner),
    operatorId: '',
    close: async () => {
      harness.mail.restore();
      harness.ai.restore();
      await app.close();
    },
  };

  const operator = await prisma.adminUser.upsert({
    where: { email: OPERATOR_EMAIL },
    update: { passwordHash: await argon2.hash(OPERATOR_PASSWORD, { type: argon2.argon2id }) },
    create: {
      email: OPERATOR_EMAIL,
      passwordHash: await argon2.hash(OPERATOR_PASSWORD, { type: argon2.argon2id }),
    },
  });
  harness.operatorId = operator.id;
  return harness;
}

/**
 * Wipes taxonomy and audit state between tests; the operator row survives.
 *
 * `student_profile` is listed explicitly rather than left to the CASCADE from
 * `grade_level`: a Student Profile holds its Grade Level with `onDelete:
 * Restrict`, so the truncate has to name it or the statement fails.
 *
 * `source_test` and `page_image` are listed for the same reason
 * `student_profile` is: a Source Test holds its Parent Account and its Student
 * Profile with `onDelete: Restrict`, so the truncate has to name it. `page_image`
 * is named beside it rather than left to the Cascade, because the two tables are
 * one story's substrate and a reader looking for "are the pages wiped too?"
 * should find the answer in the list itself.
 *
 * `uncommitted_state` is deliberately *not* named: its FK to `student_profile`
 * is `onDelete: Cascade`, so `TRUNCATE ... CASCADE` reaches it through the
 * profile. Naming it would be harmless but would suggest the cascade does not
 * cover it, which is the thing a reader most needs to be sure of here.
 */
export async function resetTaxonomy(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${EXTRACTION_TABLES}, "page_image", "source_test", "student_profile", "subject_grade_level", "subject", "grade_level", "admin_audit" CASCADE`,
  );
}

/**
 * Wipes Parent Accounts, their timezone history, credentials and audit state.
 *
 * `uncommitted_state` is reached by the CASCADE — it hangs off both
 * `parent_account` and `student_profile` with `onDelete: Cascade` — so, like
 * `account_consent`'s own dependents, it needs no entry of its own here.
 */
export async function resetParentAccounts(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${EXTRACTION_TABLES}, "page_image", "source_test", "student_profile", "password_reset", "account_consent", "account_timezone", "parent_account", "admin_audit" CASCADE`,
  );
}

/**
 * The extraction cluster and the cost table, child before parent.
 *
 * Named in full rather than left to the CASCADE for the reason the two lists
 * below already name `page_image`: a reader asking "is the Extraction wiped
 * too?" should find the answer in the list itself. `ai_call` holds its Parent
 * Account with `onDelete: Restrict`, so that one is not optional — the truncate
 * fails without it.
 */
const EXTRACTION_TABLES = [
  // The Practice Test cluster first: it holds its Parent Account and its
  // Student Profile with `onDelete: Restrict`, so the truncate has to name
  // every one of these or the statement fails. Named in full rather than left
  // to the CASCADE for the reason the list already names `page_image`: a reader
  // asking "are the generated drafts wiped too?" should find the answer here.
  '"practice_test_question_topic"',
  '"practice_test_choice"',
  '"practice_test_question"',
  '"practice_test"',
  '"generation_job"',
  '"extracted_topic_label"',
  '"extracted_choice"',
  '"extracted_question"',
  '"extracted_context"',
  '"uninterpretable_region"',
  '"extraction"',
  '"extraction_job"',
  '"ai_call"',
].join(', ');

/** Every message the captured transport was handed, oldest first. */
export interface CapturedMail {
  to: string;
  subject: string;
  text: string;
}

export interface MailCapture {
  sent: CapturedMail[];
  /** Makes the next send throw as a transport failure would. */
  failNext(): void;
  /** Clears what was captured; the stub stays in place for the next test. */
  reset(): void;
  /** Puts the real `send` back. Called when the harness closes. */
  restore(): void;
}

/**
 * Stubs `MailService.send` outright, so nothing is dispatched and the caller's
 * handling of a dispatch failure is observable through `failNext`. The service
 * itself — transport resolution, the log line, the HTTP post — is exercised by
 * `mail.service.spec.ts`, not here.
 */
function captureMail(mail: MailService): MailCapture {
  const sent: CapturedMail[] = [];
  const original = mail.send.bind(mail);
  let failOnce = false;
  mail.send = async (message: CapturedMail): Promise<void> => {
    if (failOnce) {
      failOnce = false;
      throw new MailDispatchError('Injected transport failure.');
    }
    sent.push(message);
  };
  return {
    sent,
    failNext: () => {
      failOnce = true;
    },
    reset: () => {
      sent.length = 0;
      failOnce = false;
    },
    restore: () => {
      mail.send = original;
    },
  };
}

/** One call as the seam recorded it. No bytes, and nothing the model said. */
export interface CapturedAiCall {
  callClass: string;
  /** Stated by the caller; what an assertion about a text call reads. */
  modality: string;
  imageCount: number;
  /**
   * The prompt as the caller built it.
   *
   * Captured so a test can assert on the *instruction*, not only on what came
   * back — the generation prompt and the post-hoc pass are two halves of one
   * rule, and a rule stated in only one of them is a rule that drifts.
   */
  prompt: string;
}

export interface AiCapture {
  sent: CapturedAiCall[];
  /** Drives the fake transport's failure mode for the next call alone. */
  failNext(kind: AiFakeFailure): void;
  reset(): void;
  restore(): void;
}

/**
 * Wraps `AiService.run` rather than replacing it, which is the difference that
 * matters: the real config, the real retry loop, the real schema parse and the
 * real cost row all still run, and the fake transport underneath is the seam
 * every test tier is supposed to exercise (AD-22).
 *
 * `failNext` drives `AI_FAKE_FAILURE` for exactly one call, restoring whatever
 * was there afterwards — the variable is read per call, so it has to stay set
 * across the retries that one `run` makes internally.
 *
 * What is recorded is the call class and how many images went with it. Never a
 * buffer, never a prompt, never a payload (AD-20).
 */
function captureAi(ai: AiService): AiCapture {
  const sent: CapturedAiCall[] = [];
  const original = ai.run.bind(ai);
  let failOnce: AiFakeFailure | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ai.run = async (request: any): Promise<any> => {
    sent.push({
      callClass: request.callClass,
      modality: request.modality,
      imageCount: request.images.length,
      prompt: request.prompt,
    });
    if (failOnce === null) return original(request);
    const kind = failOnce;
    failOnce = null;
    const saved = process.env.AI_FAKE_FAILURE;
    process.env.AI_FAKE_FAILURE = kind;
    try {
      return await original(request);
    } finally {
      if (saved === undefined) delete process.env.AI_FAKE_FAILURE;
      else process.env.AI_FAKE_FAILURE = saved;
    }
  };
  return {
    sent,
    failNext: (kind) => {
      failOnce = kind;
    },
    reset: () => {
      sent.length = 0;
      failOnce = null;
    },
    restore: () => {
      ai.run = original;
    },
  };
}

/** The `Set-Cookie` value for the parent session, or `undefined`. */
export function sessionCookieFrom(response: {
  headers: Record<string, unknown>;
}): string | undefined {
  const raw = response.headers['set-cookie'];
  const values = Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : [];
  return values.find((value) => value.startsWith(`${PARENT_SESSION_COOKIE}=`));
}

/** The cookie header a browser would send back, from a `Set-Cookie` value. */
export function cookieHeader(setCookie: string): string {
  return setCookie.split(';')[0]!;
}

/** The session cookie's value alone — the token, for inspection. */
export function sessionTokenFrom(setCookie: string): string {
  return cookieHeader(setCookie).slice(`${PARENT_SESSION_COOKIE}=`.length);
}

let fixtureCounter = 0;

/**
 * Creates a Parent Account through `identity` — never through a raw delegate —
 * so the fixture exercises the same write path production uses. `tier` is left
 * unset by default, which is how the schema default (`Free`) gets asserted.
 */
export function createParentAccount(
  identity: ParentAccountService,
  overrides: {
    email?: string;
    displayName?: string | null;
    tier?: AccountTier;
    timezone?: string;
    effectiveFrom?: Date;
  } = {},
): Promise<ParentAccount> {
  fixtureCounter += 1;
  return identity.create({
    email: overrides.email ?? `parent-${fixtureCounter}@example.test`,
    displayName: overrides.displayName ?? `Parent ${fixtureCounter}`,
    ...(overrides.tier ? { tier: overrides.tier } : {}),
    ...(overrides.timezone ? { timezone: overrides.timezone } : {}),
    ...(overrides.effectiveFrom ? { effectiveFrom: overrides.effectiveFrom } : {}),
  });
}

/**
 * A Grade Level created through `TaxonomyService` — never a raw delegate — so
 * the fixture exercises the same write path the Admin console uses, `nameKey`
 * included. `enabled: false` disables it afterwards, again through the service.
 */
export async function createGradeLevel(
  h: Pick<Harness, 'taxonomy' | 'operatorId'>,
  overrides: { name?: string; enabled?: boolean } = {},
): Promise<{ id: string; name: string; enabled: boolean }> {
  fixtureCounter += 1;
  const created = await h.taxonomy.createGradeLevel(
    h.operatorId,
    overrides.name ?? `Grade ${fixtureCounter}`,
  );
  if (overrides.enabled === false) {
    return h.taxonomy.setGradeLevelEnabled(h.operatorId, created.id, false);
  }
  return created;
}

/**
 * A Subject created through `TaxonomyService` — never a raw delegate — so the
 * fixture exercises the same write path the Admin console uses, `nameKey` and
 * the audit row included.
 *
 * `gradeLevelId` sets the join row's own flag through `setAvailability`, which
 * is the third of the three independent `enabled` columns selectability is the
 * conjunction of; `available: false` creates the join row *disabled*, which is
 * the state that makes "the Subject and the Grade Level are both enabled and it
 * still is not offered" observable. `enabled: false` disables the Subject
 * itself, again through the service.
 */
export async function createSubject(
  h: Pick<Harness, 'taxonomy' | 'operatorId'>,
  overrides: {
    name?: string;
    gradeLevelId?: string;
    enabled?: boolean;
    available?: boolean;
  } = {},
): Promise<{ id: string; name: string; enabled: boolean }> {
  fixtureCounter += 1;
  const created = await h.taxonomy.createSubject(
    h.operatorId,
    overrides.name ?? `Subject ${fixtureCounter}`,
  );
  if (overrides.gradeLevelId !== undefined) {
    // Enabling upserts the join row; a disabled one has to be created enabled
    // first, because `setAvailability` answers 404 for a row that is not there.
    await h.taxonomy.setAvailability(h.operatorId, created.id, overrides.gradeLevelId, true);
    if (overrides.available === false) {
      await h.taxonomy.setAvailability(h.operatorId, created.id, overrides.gradeLevelId, false);
    }
  }
  if (overrides.enabled === false) {
    return h.taxonomy.setSubjectEnabled(h.operatorId, created.id, false);
  }
  return created;
}

/** A Student Profile created through `identity`'s sole writer. */
export async function createStudentProfile(
  h: Pick<Harness, 'students'>,
  parentAccountId: string,
  input: { displayName?: string; gradeLevelId: string },
): Promise<StudentProfileView> {
  fixtureCounter += 1;
  const { profile } = await h.students.create(parentAccountId, {
    displayName: input.displayName ?? `Child ${fixtureCounter}`,
    gradeLevelId: input.gradeLevelId,
  });
  return profile;
}

/** A token shaped like a parent-scoped credential: same secret, wrong audience. */
export function parentStyleToken(jwt: JwtService, subjectId = 'parent-1'): Promise<string> {
  return jwt.signAsync(
    { email: 'parent@example.test', scope: 'parent' },
    { subject: subjectId, audience: 'parent', issuer: ADMIN_JWT_ISSUER },
  );
}

export function adminToken(jwt: JwtService, operatorId: string): Promise<string> {
  return jwt.signAsync(
    { email: OPERATOR_EMAIL, scope: ADMIN_JWT_AUDIENCE },
    { subject: operatorId, audience: ADMIN_JWT_AUDIENCE, issuer: ADMIN_JWT_ISSUER },
  );
}

/**
 * A token the admin audience and issuer accept, varied one claim at a time, so
 * each individual check in the guard is observable.
 */
export function tokenWithClaims(
  jwt: JwtService,
  claims: Record<string, unknown>,
  options: { expiresIn?: number } = {},
): Promise<string> {
  return jwt.signAsync(claims, {
    audience: ADMIN_JWT_AUDIENCE,
    issuer: ADMIN_JWT_ISSUER,
    ...(options.expiresIn === undefined ? {} : { expiresIn: options.expiresIn }),
  });
}

/**
 * A token minted with the **admin** secret but wearing the parent audience and
 * claims. The parent guard must still reject it: the separation rests on two
 * secrets, not on a claim check (AD-25).
 */
export function adminSecretTokenAtParentAudience(jwt: JwtService): Promise<string> {
  return jwt.signAsync(
    { email: 'parent@example.test', scope: PARENT_SESSION_AUDIENCE, epoch: 0 },
    {
      subject: 'parent-1',
      audience: PARENT_SESSION_AUDIENCE,
      issuer: PARENT_SESSION_ISSUER,
    },
  );
}

/** A Parent Account with a credential, created through the sign-up path. */
export async function createCredentialedParent(
  parentAuth: ParentAuthService,
  overrides: { email?: string; password?: string; timezone?: string } = {},
): Promise<{ email: string; password: string; parentAccountId: string }> {
  fixtureCounter += 1;
  const email = overrides.email ?? `credentialed-${fixtureCounter}@example.test`;
  const password = overrides.password ?? 'correct-horse-battery-staple';
  const session = await parentAuth.signUp({
    email,
    password,
    timezone: overrides.timezone ?? 'UTC',
    termsVersion: TERMS_VERSION,
    noticeVersion: CHILD_DATA_CONSENT_VERSION,
  });
  return { email, password, parentAccountId: session.parentAccountId };
}

/**
 * A credentialed parent plus the cookie header a browser would send back.
 *
 * The session is minted through `ParentAuthService` rather than over HTTP, so a
 * fixture never spends the credential rate-limit budget a test may be asserting
 * on.
 */
export async function createSignedInParent(
  h: Pick<Harness, 'parentAuth'>,
  overrides: { email?: string; password?: string; timezone?: string } = {},
): Promise<{ email: string; password: string; parentAccountId: string; cookie: string }> {
  const parent = await createCredentialedParent(h.parentAuth, overrides);
  const session = await h.parentAuth.mintSession({
    id: parent.parentAccountId,
    email: parent.email,
    sessionEpoch: 0,
  });
  return { ...parent, cookie: `${PARENT_SESSION_COOKIE}=${session.token}` };
}

/** The `Authorization` value for an elevation bearer. */
export function bearer(token: string): string {
  return `Bearer ${token}`;
}

/** The elevation token out of a `POST /api/parent/pin/verify` response. */
export function elevationTokenFrom(response: { body: { token?: unknown } }): string {
  const token = response.body.token;
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('No elevation token in the response body.');
  }
  return token;
}

/** Sets the first PIN over HTTP, exactly as the web app does. */
export async function setPinFor(h: Harness, cookie: string, pin: string): Promise<void> {
  await request(h.app.getHttpServer())
    .post('/api/parent/pin')
    .set('Cookie', cookie)
    .send({ pin })
    .expect(204);
}

/** Crosses the PIN and returns the bearer the parent-scoped routes take. */
export async function elevate(h: Harness, cookie: string, pin: string): Promise<string> {
  const response = await request(h.app.getHttpServer())
    .post('/api/parent/pin/verify')
    .set('Cookie', cookie)
    .send({ pin })
    .expect(200);
  return elevationTokenFrom(response);
}

/**
 * An elevation-audience token with claims varied one at a time, so each check
 * in the elevation guard — and the ceiling in particular — is observable
 * without waiting eight hours for it.
 */
export function elevationTokenWithClaims(
  parentJwt: JwtService,
  claims: Record<string, unknown>,
  options: { expiresIn?: number } = {},
): Promise<string> {
  return parentJwt.signAsync(claims, {
    audience: PARENT_ELEVATION_AUDIENCE,
    issuer: PARENT_SESSION_ISSUER,
    ...(options.expiresIn === undefined ? {} : { expiresIn: options.expiresIn }),
  });
}

/**
 * The `Set-Cookie` value for the Student Mode binding, or `null` when the
 * response set none.
 *
 * `null` rather than `undefined` so "no cookie was set" is a value a test
 * asserts on outright, instead of an absent property that a typo would also
 * produce.
 */
export function studentCookieFrom(response: { headers: Record<string, unknown> }): string | null {
  const raw = response.headers['set-cookie'];
  const values = Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : [];
  return values.find((value) => value.startsWith(`${STUDENT_MODE_COOKIE}=`)) ?? null;
}

/**
 * Binds the device through the deliberate-exit route, exactly as the web app
 * does, and hands back the cookie header a browser would send back.
 */
export async function bindDevice(
  h: Harness,
  bearerToken: string,
  studentProfileId: string,
): Promise<string> {
  const response = await request(h.app.getHttpServer())
    .post('/api/parent/student-mode')
    .set('Authorization', bearer(bearerToken))
    .send({ studentProfileId })
    .expect(204);
  const cookie = studentCookieFrom(response);
  if (cookie === null) throw new Error('No student_mode cookie in the bind response.');
  return cookieHeader(cookie);
}

/**
 * A binding-audience token with claims varied one at a time, so each individual
 * check in the Student Mode guard is observable rather than only the audience.
 */
export function studentTokenWithClaims(
  parentJwt: JwtService,
  claims: Record<string, unknown>,
  options: { expiresIn?: number } = {},
): Promise<string> {
  return parentJwt.signAsync(claims, {
    audience: STUDENT_MODE_AUDIENCE,
    issuer: PARENT_SESSION_ISSUER,
    ...(options.expiresIn === undefined ? {} : { expiresIn: options.expiresIn }),
  });
}
