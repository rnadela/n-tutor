'use client';

import { parentCopy } from '@/copy/parent';
import { studentCopy } from '@/copy/student';

/**
 * Everything the sign-up screen needs to state a requirement, read from the API
 * so no figure and no version is ever a literal in the web app.
 */
export interface AuthPolicy {
  passwordMinLength: number;
  passwordMaxLength: number;
  termsVersion: string;
  termsText: string;
  noticeVersion: string;
  noticeText: string;
  pinLength: number;
  pinMaxAttempts: number;
  pinCooldownMinutes: number;
  studentNameMaxLength: number;
}

/** A taxonomy item as the API states it. The web never writes one. */
export interface TaxonomyItem {
  id: string;
  name: string;
  enabled: boolean;
}

/** A Student Profile, with its grade level resolved by the API on every read. */
export interface StudentProfileView {
  id: string;
  displayName: string;
  gradeLevelId: string;
  gradeLevelName: string;
  gradeLevelEnabled: boolean;
  archived: boolean;
  archivedAt: string | null;
  createdAt: string;
}

export interface PinStatus {
  pinSet: boolean;
  /** An ISO instant while the gate is shut, `null` while it is open. */
  lockedUntil: string | null;
}

export interface Elevation {
  token: string;
  expiresAt: string;
  ceilingAt: string;
}

export interface ElevatedSession extends ParentIdentity {
  expiresAt: string;
  ceilingAt: string;
}

export interface ParentIdentity {
  id: string;
  email: string;
}

export interface ParentSession extends ParentIdentity {
  timezone: string;
}

/**
 * What this device is bound to. The binding itself is an httpOnly cookie the
 * web app can neither read nor write, so this read is the only way the browser
 * learns which child the device is handed to.
 */
export interface StudentSession {
  profile: StudentProfileView;
}

/**
 * The kinds of uncommitted parent work the API declares. A closed list, not a
 * free string: a later epic adds a value here and the payload shape with it.
 */
export type UncommittedStateKind = 'DraftEdit' | 'GradeOverride' | 'PartialUpload';

/**
 * A slot of retained parent work, exactly as the API states it.
 *
 * `payload` is `unknown` on purpose: this story ships the mechanism and no
 * consumer, so nothing here knows what a draft edit, a grade override or a
 * partial upload looks like. The epic that adds a shape narrows it there.
 */
export interface UncommittedStateView {
  id: string;
  studentProfileId: string;
  kind: UncommittedStateKind;
  scope: string;
  payload: unknown;
  createdAt: string;
  updatedAt: string;
  /** Creation plus the TTL. A re-save never moves it. */
  expiresAt: string;
}

/** One page of a Source Test, exactly as the API states it.
 *
 * There is no path and no URL: stored image bytes are never served, so nothing
 * here could point at them even if a screen wanted to.
 */
export interface PageImageView {
  id: string;
  /** Contiguous `1..N`, and the number the strip shows in text. */
  ordinal: number;
  state: 'Uploading' | 'Ready';
  width: number | null;
  height: number | null;
  byteSize: number | null;
  /**
   * This page's own readability verdict from the one batch check, or null
   * while the check has not run over the current page set. Per page, never a
   * whole-test pass/fail — the screen names the page it flags.
   */
  legibility: 'Low' | 'Medium' | 'High' | null;
  createdAt: string;
}

/** A Source Test, pages in stored order. */
export interface SourceTestView {
  id: string;
  studentProfileId: string;
  status: 'Draft' | 'Submitted';
  createdAt: string;
  /** Creation plus the TTL. Activity never moves it. */
  expiresAt: string;
  submittedAt: string | null;
  /**
   * The classification. Ids with their names resolved by the API on every read
   * — the web app stores neither and never renders a label it was not handed.
   * Both are null until set; the Grade Level is seeded from the child's on
   * open, so in practice it is the Subject that starts unset.
   */
  subjectId: string | null;
  subjectName: string | null;
  gradeLevelId: string | null;
  gradeLevelName: string | null;
  /**
   * When the one batch legibility check ran, or null while it has not. It is
   * the whole of the server's third submit gate, so the screen reads it to
   * know whether to offer the commit control at all — never a verdict, which
   * blocks nothing.
   */
  legibilityCheckedAt: string | null;
  /** The page ceiling, stated by the API so the web app owns no copy of it. */
  maxPages: number;
  pages: PageImageView[];
}

/**
 * Where the Extraction of a submitted Source Test stands, exactly as the API
 * states it.
 *
 * Counts and a status, and not one word of what was read: Extraction is not a
 * browsable surface in v0 (AD-3). `thin` is the server's own verdict on whether
 * the usable-question count is low for the pages submitted — the web app holds
 * no threshold and computes nothing from these counts but the sentence it shows.
 */
export interface ExtractionStatusView {
  status: 'Queued' | 'Running' | 'Succeeded' | 'Failed';
  /** Null until the job has succeeded. */
  pageCount: number | null;
  questionCount: number | null;
  usableQuestionCount: number | null;
  uninterpretableRegionCount: number | null;
  /** `null` while there is no verdict yet; never to be read as healthy. */
  thin: boolean | null;
  completedAt: string | null;
  failureKind: 'UpstreamFault' | 'ClientFault' | null;
  failureReason: string | null;
  retryable: boolean;
}

/**
 * What the account has left of its Generation Allowance, exactly as the API
 * states it.
 *
 * Every figure here is the server's: the web app holds no limit, no tier table
 * and no per-request ceiling of its own, so recalibrating any of them is one
 * edit on the API side. `limit` is `null` for unlimited and is never a sentinel
 * number, and `remaining` is what one request may actually ask for.
 */
export interface GenerationAllowanceView {
  used: number;
  limit: number | null;
  remaining: number;
  maxPerRequest: number;
  /** When the period's counters reset, in the account's own zone. */
  resetAt: string;
  timezone: string;
}

/**
 * Where a generation job stands, exactly as the API states it.
 *
 * Counts and a status, and not one word of what was generated: draft review is
 * a later story's surface, and a progress body that carried a question would be
 * the first half of shipping it without the human quality gate.
 *
 * `PartiallyComplete` is a real outcome rather than a flavour of failure: the
 * drafts that landed are kept and were charged, and the screen says so.
 */
export interface GenerationJobView {
  id: string;
  status: 'Queued' | 'Running' | 'Succeeded' | 'PartiallyComplete' | 'Failed';
  /** Already clamped server-side. Never what this app asked for. */
  requestedCount: number;
  /**
   * The Topic this request was weighted on, in the Extraction's own spelling,
   * or null for an unweighted request. Resolved and stored by the server, so a
   * parent returning to the URL reads the request they actually made rather
   * than whatever this browser happens to still hold.
   */
  weightedTopic: string | null;
  producedCount: number;
  completedAt: string | null;
  failureKind: 'UpstreamFault' | 'ClientFault' | null;
  failureReason: string | null;
  retryable: boolean;
}

/** The Topics a generation request may be weighted on, exactly as the API states them. */
export interface GenerationTopicsView {
  topics: string[];
}

/**
 * A run of generated text, or a fraction as structure (AD-32).
 *
 * Structure and never the glyph `"1/2"`: a spoken alternative cannot be
 * recovered from a glyph, so the numerator and the denominator travel apart
 * and `RichText` is the one component that decides how they are drawn. Nothing
 * in this app builds a fraction string of its own.
 */
export type RichTextSegment =
  | { kind: 'text'; value: string }
  | { kind: 'fraction'; whole: number | null; numerator: number; denominator: number };

/**
 * One row of Pending drafts, exactly as the API states it.
 *
 * `studentProfileId` and not a name: the Practice Test module does not read an
 * identity table (AD-17), so the screen joins the child's display name from
 * the Student Profile read it already makes.
 */
export interface PracticeTestDraftSummary {
  id: string;
  sourceTestId: string;
  studentProfileId: string;
  /** Its place within the job that produced it, 1-based — the "2" of "2 of 3". */
  ordinal: number;
  /** How many drafts its job is still holding — the "3". Counted server-side. */
  siblingCount: number;
  questionCount: number;
  createdAt: string;
}

/**
 * One row of Student Home's released practice tests, exactly as the API states
 * it.
 *
 * An identifier, the Subject it is, how many questions it holds and which of
 * three conditions it is in — and nothing else exists on it: no prompt, no
 * answer, no option body, no Topic label, no `timerMinutes`, and no allowance
 * figure, tier or model name — none of those is a student-scoped fact (AD-20,
 * AD-26).
 *
 * `subjectName` is null for an upload carrying no classification, or one whose
 * stored Subject no longer resolves: the row keeps its place and loses its
 * label.
 */
export interface StudentPracticeTestSummary {
  id: string;
  subjectName: string | null;
  questionCount: number;
  state: 'NotStarted' | 'InProgress' | 'Completed';
}

/**
 * One option a child chooses between, exactly as the API states it.
 *
 * There is **no `isCorrect`** — not because this type omits it, but because the
 * student-scoped read never selects it. Nothing in Student Mode has ever held a
 * correct answer, and this type is the shape of that fact (AD-20).
 */
export interface StudentChoiceView {
  ordinal: number;
  body: RichTextSegment[];
}

/**
 * One Question as the child working through it sees it.
 *
 * A prompt, a format and — for Multiple Choice — the option bodies. No `answer`
 * field and no Topic label: neither is a student-scoped fact, and the first is
 * the answer key itself (AD-20, AD-26).
 */
export interface StudentQuestionView {
  id: string;
  ordinal: number;
  format: 'MultipleChoice' | 'FillInTheBlank' | 'ShortAnswer';
  prompt: RichTextSegment[];
  /** Empty for every format but MultipleChoice. */
  choices: StudentChoiceView[];
}

/**
 * One released practice test, whole, as the Take Test screen reads it.
 *
 * Every Question in stored ordinal order and never a page: the child walks the
 * whole test, and a second call could show half of one. No status — the only
 * status this read can reach is `Released`, by construction — and no time limit,
 * which is Story 5.3's.
 */
export interface StudentPracticeTestView {
  id: string;
  questionCount: number;
  questions: StudentQuestionView[];
}

/**
 * One Attempt, as the server states it.
 *
 * Instants only, and every one of them the server's. `serverNow` is here so the
 * countdown can be rendered against a **fixed offset** rather than against this
 * browser's unadjusted clock — a device whose clock is wrong then shifts only
 * what is displayed, because expiry is decided server-side at submit from the
 * stored column. `expiresAt` is null for an untimed Practice Test.
 *
 * Nothing on it is a grade, a score, a count or a parent-scoped figure, and
 * nothing on it names a profile.
 */
export interface AttemptView {
  id: string;
  practiceTestId: string;
  startedAt: string;
  expiresAt: string | null;
  serverNow: string;
  submittedAt: string | null;
}

/**
 * What handing in answered.
 *
 * `expired` is the server's own comparison and `gradeAt` the instant the work is
 * judged at — the deadline when it had passed, the arrival instant otherwise. A
 * submission that crossed an outage is therefore judged at the moment the time
 * ran out, and no browser can move it. `gradeAt` names *when*, never what.
 */
export interface AttemptSubmissionView {
  submittedAt: string;
  expired: boolean;
  gradeAt: string;
}

/**
 * The four states a graded Question can be in, and there is no fifth.
 *
 * `Ungraded` is "nothing has judged this yet" — not "being graded": there is no
 * state for in-flight, because nothing about grading is in flight from a browser's
 * point of view. `Unanswered` is a Question the child chose to leave blank, which
 * counts against them; `Ungraded` is excluded from the score entirely.
 */
export type GradeState = 'Correct' | 'Incorrect' | 'Unanswered' | 'Ungraded';

/**
 * What one Attempt came to, over its **presented** Questions, exactly as the API
 * states it.
 *
 * `correct` over `denominator` is the fraction a surface states, and this browser
 * computes **neither** figure: FR-37's denominator is the server's one answer, and
 * a second derivation here would be a second answer to the same question.
 *
 * `excludedUngraded` is not a footnote. While it is above zero the score is over
 * fewer Questions than the child sat, and a screen showing the fraction without
 * the count would be quietly restating the paper. `denominator` may legitimately
 * be 0 — an Attempt nothing could grade at all — and the screen has to say
 * something true about that rather than divide.
 */
export interface AttemptScore {
  correct: number;
  denominator: number;
  excludedUngraded: number;
}

/**
 * One row of an Attempt's answer key, exactly as the API states it.
 *
 * The prompt, what the child put down, what the answer was, and which state it is
 * in. Every text field is **resolved display text**: a Multiple Choice answer
 * arrives as the option's own body, never as the ordinal that was submitted, so
 * nothing here builds a sentence out of a number.
 *
 * There is **no `rationale`** — not omitted by this type, but never selected by the
 * read that composes it: a grading rationale is parent-scoped (AD-20, AD-26). There
 * is no Topic label either, and no cost, tier, allowance or model figure.
 *
 * `studentAnswer` is null for a Question left blank; `correctAnswer` is null only
 * where the stored answer key could not be read back, and the row says so rather
 * than showing nothing.
 */
export interface AnswerKeyRowView {
  questionId: string;
  ordinal: number;
  format: 'MultipleChoice' | 'FillInTheBlank' | 'ShortAnswer';
  prompt: RichTextSegment[] | null;
  studentAnswer: RichTextSegment[] | null;
  correctAnswer: RichTextSegment[] | null;
  state: GradeState;
  /** True when **this read** is what judged it. About this response, nothing else. */
  newlyGraded: boolean;
}

/**
 * One handed-in Attempt's whole results, exactly as the API states it.
 *
 * Every presented Question in the order the child met them, and never a page: the
 * screen shows the whole paper. The browser renders `questions` as it arrives — it
 * does not sort, filter or group it, and it never puts the wrong answers together,
 * because that would be re-writing the paper.
 */
export interface AttemptResultsView {
  attemptId: string;
  practiceTestId: string;
  /** Null for a test whose Subject carries no classification or no longer resolves. */
  subjectName: string | null;
  questionCount: number;
  score: AttemptScore;
  questions: AnswerKeyRowView[];
}

/** One generated option, in the order the API states it. */
export interface DraftChoiceView {
  ordinal: number;
  body: RichTextSegment[];
  isCorrect: boolean;
}

/** One generated Question, with everything a parent reviews it by. */
export interface DraftQuestionView {
  id: string;
  ordinal: number;
  format: 'MultipleChoice' | 'FillInTheBlank' | 'ShortAnswer';
  prompt: RichTextSegment[];
  /** Null for MultipleChoice, where the answer is the flagged option. */
  answer: RichTextSegment[] | null;
  /** Empty for every format but MultipleChoice. */
  choices: DraftChoiceView[];
  /** Raw as stored, rendered as they arrive. Nothing here canonicalizes a label. */
  topics: string[];
}

/**
 * One draft, whole: every Question it holds, in one answer.
 *
 * Nothing is paginated and nothing is a second call — "every Question in one
 * reviewable list" is the epic's criterion, and a screen that had to ask twice
 * could show half of one.
 */
export interface PracticeTestDraftView {
  id: string;
  sourceTestId: string;
  studentProfileId: string;
  status: 'Draft' | 'Released' | 'Discarded';
  ordinal: number;
  siblingCount: number;
  questionCount: number;
  createdAt: string;
  /**
   * The countdown the parent configured, in whole minutes, or `null` for none.
   *
   * `null` is off, and it is what a draft nobody has configured reads as.
   */
  timerMinutes: number | null;
  /**
   * The duration to pre-fill the minutes field with, from the server.
   *
   * A figure the server supplied, never one this browser computed: the screen
   * shows it and stores nothing until the parent saves.
   */
  suggestedTimerMinutes: number;
  questions: DraftQuestionView[];
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api').replace(
  /\/+$/,
  '',
);

export class ParentApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Present only on a 423: the instant the PIN gate re-opens. */
    readonly lockedUntil: string | null = null,
    /**
     * The elevation guard refused this call, as opposed to a credential on it
     * being wrong. Both are 401s on the same routes, and only the server can
     * tell them apart — so it says which, and the screens act accordingly.
     */
    readonly notElevated: boolean = false,
    /**
     * The Student Mode guard refused this call because the device is not bound
     * to a profile, as opposed to anything else that answers 401. Only the
     * server can tell the two apart, so it says which — and the front door
     * routes a child to sign-in instead of showing them an error they cannot
     * act on.
     */
    readonly notBound: boolean = false,
    /**
     * The server's own stated reason for a refusal it authored, or `null`.
     *
     * Present only for a 409, which is the status the API uses when it refuses
     * on a *rule* — nothing left of an allowance, nothing usable to generate
     * from, an upload that has not finished being read. Each of those sentences
     * is written once, in the API's policy file, and a screen that fell back to
     * its own generic message would be telling the parent less than the server
     * already said. Kept separate from `message` so only the screens that know
     * a 409 means something specific read it.
     */
    readonly reason: string | null = null,
  ) {
    super(message);
    this.name = 'ParentApiError';
  }
}

/**
 * Status 0 stands for a request that never got a response — a network failure
 * is not a server rejection, and the screens say so differently.
 */
export const NETWORK_STATUS = 0;

/** The locked status, 423, is the one rejection that is never the endpoint's own. */
export const LOCKED_STATUS = 423;

/**
 * The clock time a lock lifts, in the reader's own locale. A date is shown only
 * when the lock crosses into another day, so the common case reads as a time.
 */
export function lockLiftsAt(lockedUntil: string): string {
  const instant = new Date(lockedUntil);
  if (Number.isNaN(instant.getTime())) return lockedUntil;
  const time = instant.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const sameDay = instant.toDateString() === new Date().toDateString();
  return sameDay ? time : `${instant.toLocaleDateString()} ${time}`;
}

export function messageFor(
  status: number,
  fallback: string,
  lockedUntil: string | null = null,
): string {
  if (status === NETWORK_STATUS) return parentCopy.errors.network;
  if (status === 429) return parentCopy.errors.tooManyAttempts;
  // The lock states when it lifts; without the instant it states only the lock.
  if (status === LOCKED_STATUS) {
    return lockedUntil === null
      ? parentCopy.pin.lockedUnknown
      : parentCopy.pin.locked(lockLiftsAt(lockedUntil));
  }
  return fallback;
}

/** The status the API refuses on a rule with, carrying its own reason. */
export const CONFLICT_STATUS = 409;

interface FailureDetail {
  lockedUntil: string | null;
  notElevated: boolean;
  notBound: boolean;
  reason: string | null;
}

/** What a rejection body says beyond its status, read exactly once. */
async function failureDetailFrom(response: Response): Promise<FailureDetail> {
  const none: FailureDetail = {
    lockedUntil: null,
    notElevated: false,
    notBound: false,
    reason: null,
  };
  if (
    response.status !== LOCKED_STATUS &&
    response.status !== 401 &&
    response.status !== CONFLICT_STATUS
  ) {
    return none;
  }
  try {
    const body = (await response.json()) as {
      lockedUntil?: unknown;
      elevated?: unknown;
      bound?: unknown;
      message?: unknown;
    } | null;
    return {
      lockedUntil: typeof body?.lockedUntil === 'string' ? body.lockedUntil : null,
      // `elevated: false` is the elevation guard naming itself as the refuser.
      notElevated: body?.elevated === false,
      // `bound: false` is the Student Mode guard doing the same.
      notBound: body?.bound === false,
      // Only for a 409, where the message is a sentence the API's own policy
      // file authored for a parent to read. Nest sends an array for a
      // validation failure, which is not that, so only a string is taken.
      reason:
        response.status === CONFLICT_STATUS && typeof body?.message === 'string'
          ? body.message
          : null,
    };
  } catch {
    return none;
  }
}

async function call<T>(
  path: string,
  init: RequestInit = {},
  failureMessage: string = parentCopy.errors.generic,
): Promise<T> {
  const headers = new Headers(init.headers);
  // Declared only when there is a body to describe; a GET carrying a
  // content-type describes nothing and can force a CORS preflight.
  //
  // A `FormData` body is the exception: the browser has to set the header
  // itself, because only it knows the multipart boundary it generated. A
  // hand-set `multipart/form-data` has no boundary in it, and the upload is
  // unparseable on arrival.
  if (init.body !== undefined && !headers.has('content-type') && !isFormData(init.body)) {
    headers.set('content-type', 'application/json');
  }

  let response: Response;
  try {
    // The session is an httpOnly cookie: nothing is stored by this module, and
    // every call has to carry credentials for the cookie to travel at all.
    response = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'include' });
  } catch {
    throw new ParentApiError(messageFor(NETWORK_STATUS, failureMessage), NETWORK_STATUS);
  }

  if (!response.ok) {
    const detail = await failureDetailFrom(response);
    throw new ParentApiError(
      detail.notElevated
        ? parentCopy.pin.notElevated
        : detail.notBound
          ? studentCopy.notBound
          : messageFor(response.status, failureMessage, detail.lockedUntil),
      response.status,
      detail.lockedUntil,
      detail.notElevated,
      detail.notBound,
      detail.reason,
    );
  }
  if (response.status === 204) return undefined as T;
  try {
    return (await response.json()) as T;
  } catch {
    // A success with an empty or non-JSON body is a broken response, not
    // something a parent should read a parser error about.
    throw new ParentApiError(failureMessage, response.status);
  }
}

export const parentApi = {
  policy: () => call<AuthPolicy>('/auth/policy', {}, parentCopy.errors.policyUnavailable),
  signUp: (input: {
    email: string;
    password: string;
    timezone: string;
    termsVersion: string;
    noticeVersion: string;
  }) =>
    call<ParentIdentity>(
      '/auth/sign-up',
      { method: 'POST', body: JSON.stringify(input) },
      parentCopy.signUp.failed,
    ),
  signIn: (email: string, password: string) =>
    call<ParentIdentity>(
      '/auth/sign-in',
      { method: 'POST', body: JSON.stringify({ email, password }) },
      parentCopy.signIn.failed,
    ),
  signOut: () => call<void>('/auth/sign-out', { method: 'POST' }),
  me: () => call<ParentSession>('/auth/me'),
  requestPasswordReset: (email: string) =>
    call<void>('/auth/password-reset/request', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  confirmPasswordReset: (token: string, password: string) =>
    call<void>(
      '/auth/password-reset/confirm',
      { method: 'POST', body: JSON.stringify({ token, password }) },
      parentCopy.resetConfirm.failed,
    ),

  // --- Parent View -------------------------------------------------------
  //
  // The elevation bearer is passed in by the caller on every parent-scoped
  // call, never read from a module-level variable: a token this module could
  // reach on its own is a token it could also persist, which is exactly what
  // AD-18 forbids. It travels in a header, never as a cookie.

  pinStatus: () => call<PinStatus>('/parent/pin/status'),
  setPin: (pin: string) =>
    call<void>(
      '/parent/pin',
      { method: 'POST', body: JSON.stringify({ pin }) },
      parentCopy.pin.failed,
    ),
  verifyPin: (pin: string) =>
    call<Elevation>(
      '/parent/pin/verify',
      { method: 'POST', body: JSON.stringify({ pin }) },
      parentCopy.pin.incorrect,
    ),
  changePin: (token: string, input: { newPin: string; currentPin?: string; password?: string }) =>
    call<void>(
      '/parent/pin/change',
      { method: 'POST', headers: elevated(token), body: JSON.stringify(input) },
      parentCopy.pin.incorrect,
    ),
  refreshElevation: (token: string) =>
    call<Elevation>(
      '/parent/elevation/refresh',
      { method: 'POST', headers: elevated(token) },
      parentCopy.pin.notElevated,
    ),
  parentSession: (token: string) =>
    call<ElevatedSession>(
      '/parent/session',
      { headers: elevated(token) },
      parentCopy.pin.notElevated,
    ),

  // --- Student Profiles --------------------------------------------------

  students: (token: string) =>
    call<StudentProfileView[]>('/parent/students', { headers: elevated(token) }),
  /** What Student Mode may bind to: the active profiles only. */
  selectableStudents: (token: string) =>
    call<StudentProfileView[]>('/parent/students/selectable', { headers: elevated(token) }),
  gradeLevels: (token: string) =>
    call<TaxonomyItem[]>('/parent/grade-levels', { headers: elevated(token) }),
  createStudent: (token: string, input: { displayName: string; gradeLevelId: string }) =>
    call<StudentProfileView>(
      '/parent/students',
      { method: 'POST', headers: elevated(token), body: JSON.stringify(input) },
      parentCopy.students.failed,
    ),
  updateStudent: (
    token: string,
    id: string,
    input: { displayName?: string; gradeLevelId?: string },
  ) =>
    call<StudentProfileView>(
      `/parent/students/${encodeURIComponent(id)}`,
      { method: 'PATCH', headers: elevated(token), body: JSON.stringify(input) },
      parentCopy.students.failed,
    ),
  /**
   * Binds the device to a child. The elevation bearer is what authorises it:
   * there is no unelevated call anywhere that changes the binding.
   */
  bindStudentMode: (token: string, studentProfileId: string) =>
    call<void>(
      '/parent/student-mode',
      {
        method: 'POST',
        headers: elevated(token),
        body: JSON.stringify({ studentProfileId }),
      },
      parentCopy.parentView.exitFailed,
    ),

  archiveStudent: (token: string, id: string) =>
    call<void>(
      `/parent/students/${encodeURIComponent(id)}/archive`,
      { method: 'POST', headers: elevated(token) },
      parentCopy.students.failed,
    ),
  restoreStudent: (token: string, id: string) =>
    call<void>(
      `/parent/students/${encodeURIComponent(id)}/restore`,
      { method: 'POST', headers: elevated(token) },
      parentCopy.students.failed,
    ),

  // --- Student Mode ------------------------------------------------------

  /**
   * What this device is bound to. No bearer: the binding travels as its own
   * httpOnly cookie, which `credentials: 'include'` already carries.
   */
  studentSession: () => call<StudentSession>('/student/session', {}, studentCopy.failed),

  /**
   * The practice tests the bound child can see, in **one flat list ordered by
   * the server**: everything there is still to do first, then everything
   * finished. Band 1 is newest *made* first, which is generation time and not
   * release time — there is no `releasedAt` column for it to be anything else
   * — and band 2 is most recently submitted first.
   *
   * The browser renders the array as it arrives. It does not sort it, filter
   * it or group it by Subject: the order is a decision the server already
   * made, and a second one taken here would be a second answer to it.
   *
   * No bearer, exactly as the session read: the binding travels as its own
   * httpOnly cookie, and the profile is named by that cookie server-side rather
   * than by anything this browser holds. An empty list is the ordinary answer for
   * a child with nothing released yet — a state Student Home renders as a plain
   * sentence, never an error.
   */
  studentPracticeTests: () =>
    call<StudentPracticeTestSummary[]>('/student/practice-tests', {}, studentCopy.failed),

  /**
   * One released practice test, whole, for the child to work through.
   *
   * No bearer, exactly as the other two student reads: the binding travels as its
   * own httpOnly cookie, and **which child** is named by that cookie server-side.
   * The id in the path names only *which* test — a draft, a discarded row, a
   * sibling's test, another account's test and an id that never existed all answer
   * the same 404, so there is nothing this browser could learn by asking.
   */
  studentPracticeTest: (id: string) =>
    call<StudentPracticeTestView>(
      `/student/practice-tests/${encodeURIComponent(id)}`,
      {},
      studentCopy.takeTest.failed,
    ),

  /**
   * Opens the Attempt the bound child works under, or returns the one already
   * open.
   *
   * No bearer and **no body**: the binding names the child, and both instants are
   * the server's. There is nowhere here for this browser to state a duration, a
   * start, an expiry or a clock — not because a handler ignores one, but because
   * nothing is sent. A refresh, a second tab and a re-entry after a dropped
   * connection all get the same Attempt back with its original instants.
   */
  startAttempt: (practiceTestId: string) =>
    call<AttemptView>(
      `/student/practice-tests/${encodeURIComponent(practiceTestId)}/attempt`,
      { method: 'POST' },
      studentCopy.takeTest.attemptFailed,
    ),

  /**
   * Hands one Attempt in: the child's raw answers, and nothing else.
   *
   * No bearer, and nothing about time. **Whether the deadline had passed is the
   * server's to decide**, from its own clock against its own column, which is what
   * makes a submission that crossed an outage still judged at the instant the time
   * ran out. A claim about expiry from here would not be read if it were sent.
   *
   * A dropped connection surfaces as `ParentApiError` with `NETWORK_STATUS`, which
   * is how offline presents; a second submission surfaces as `CONFLICT_STATUS`
   * carrying the server's own stated reason. The screen says both and re-sends
   * neither.
   */
  submitAttempt: (attemptId: string, answers: readonly { questionId: string; value: string }[]) =>
    call<AttemptSubmissionView>(
      `/student/attempts/${encodeURIComponent(attemptId)}/submit`,
      { method: 'POST', body: JSON.stringify({ answers }) },
      studentCopy.takeTest.submitFailed,
    ),

  /**
   * One handed-in Attempt's results: every presented Question, what the child put
   * down, what the answer was, and the state it is in.
   *
   * **Reading it is what re-asks.** FR-22 makes viewing the trigger, so the server
   * re-asks for anything nothing has judged *before* it answers — which is why this
   * is a `GET` that legitimately writes grades, and why nothing here polls, queues
   * or retries on a timer. One call per Attempt; a second call is a second re-ask.
   *
   * The view **cannot carry** a grading rationale, a Topic label or an allowance,
   * tier, cost or model figure: none is a student-scoped fact (AD-20, AD-26), and
   * the read does not select the first at all.
   *
   * No bearer, exactly as the other student calls: the binding cookie names the
   * child server-side. The id in the path names only *which* Attempt — a sibling's,
   * another account's, one still open and one that never existed all answer the same
   * 404 sentence, so there is nothing this browser could learn by asking.
   */
  attemptResults: (attemptId: string) =>
    call<AttemptResultsView>(
      `/student/attempts/${encodeURIComponent(attemptId)}/results`,
      {},
      studentCopy.results.failed,
    ),

  // --- Uncommitted parent state ------------------------------------------
  //
  // Server-side only, and behind the elevation bearer like every other
  // parent-scoped call. Nothing here is persisted to any browser storage API —
  // the same prohibition the elevation token itself carries, and the whole
  // point of the mechanism: a device that has fallen back to Student Mode holds
  // no trace of the work.
  //
  // Story 1.6 shipped the mechanism with no caller. `DraftEdit` has one since
  // Story 4.4: a parent's typed-but-unsaved edit of a draft Question, held here
  // so an idle expiry does not eat their work.

  saveUncommittedState: (
    token: string,
    input: {
      studentProfileId: string;
      kind: UncommittedStateKind;
      scope?: string;
      payload: object;
    },
  ) =>
    call<UncommittedStateView>('/parent/uncommitted', {
      method: 'PUT',
      headers: elevated(token),
      body: JSON.stringify(input),
    }),

  uncommittedState: (token: string, studentProfileId: string) =>
    call<UncommittedStateView[]>(
      `/parent/uncommitted?studentProfileId=${encodeURIComponent(studentProfileId)}`,
      { headers: elevated(token) },
    ),

  /**
   * One retained slot, restored into the profile named here.
   *
   * The profile is a parameter rather than something read off the returned row,
   * because naming it is what lets the API refuse a mismatch: a slot saved
   * under a sibling answers 404 instead of being rebound into whichever child
   * the device is in front of now.
   */
  uncommittedStateItem: (token: string, id: string, studentProfileId: string) =>
    call<UncommittedStateView>(
      `/parent/uncommitted/${encodeURIComponent(id)}?studentProfileId=${encodeURIComponent(
        studentProfileId,
      )}`,
      { headers: elevated(token) },
    ),

  discardUncommittedState: (token: string, id: string) =>
    call<void>(`/parent/uncommitted/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: elevated(token),
    }),

  // --- Source Tests ------------------------------------------------------
  //
  // Behind the elevation bearer like every other parent-scoped call. The two
  // byte-carrying calls send `FormData` and deliberately set no content-type:
  // `call` leaves it to the browser so the multipart boundary is the real one.

  /** Opens the child's draft, or resumes the one already open. */
  openSourceTest: (token: string, studentProfileId: string) =>
    call<SourceTestView>(
      '/parent/source-tests',
      {
        method: 'POST',
        headers: elevated(token),
        body: JSON.stringify({ studentProfileId }),
      },
      parentCopy.capture.failed,
    ),

  sourceTest: (token: string, id: string) =>
    call<SourceTestView>(
      `/parent/source-tests/${encodeURIComponent(id)}`,
      { headers: elevated(token) },
      parentCopy.capture.failed,
    ),

  addSourceTestPage: (token: string, id: string, file: File) =>
    call<SourceTestView>(
      `/parent/source-tests/${encodeURIComponent(id)}/pages`,
      { method: 'POST', headers: elevated(token), body: pagePart(file) },
      parentCopy.capture.addFailed,
    ),

  retakeSourceTestPage: (token: string, id: string, pageId: string, file: File) =>
    call<SourceTestView>(
      `/parent/source-tests/${encodeURIComponent(id)}/pages/${encodeURIComponent(pageId)}`,
      { method: 'PUT', headers: elevated(token), body: pagePart(file) },
      parentCopy.capture.addFailed,
    ),

  deleteSourceTestPage: (token: string, id: string, pageId: string) =>
    call<void>(
      `/parent/source-tests/${encodeURIComponent(id)}/pages/${encodeURIComponent(pageId)}`,
      { method: 'DELETE', headers: elevated(token) },
      parentCopy.capture.failed,
    ),

  /**
   * The whole resulting order, never a direction: the server validates it as a
   * permutation of exactly the pages it holds and applies it or rejects it
   * whole.
   */
  reorderSourceTestPages: (token: string, id: string, pageIds: readonly string[]) =>
    call<SourceTestView>(
      `/parent/source-tests/${encodeURIComponent(id)}/pages/order`,
      { method: 'PUT', headers: elevated(token), body: JSON.stringify({ pageIds }) },
      parentCopy.capture.failed,
    ),

  /**
   * The Subjects offered for a Grade Level — the API's own conjunction of the
   * three `enabled` flags, never anything this app filters for itself.
   */
  sourceTestSubjects: (token: string, gradeLevelId: string) =>
    call<TaxonomyItem[]>(
      `/parent/source-tests/subjects?gradeLevelId=${encodeURIComponent(gradeLevelId)}`,
      { headers: elevated(token) },
      parentCopy.capture.classification.subjectsFailed,
    ),

  /**
   * Sets the Subject, the Grade Level, or both. The server validates the pair
   * that results and may answer with the Subject cleared, so the returned view
   * is the only account of what the Source Test now holds.
   */
  classifySourceTest: (
    token: string,
    id: string,
    input: { subjectId?: string; gradeLevelId?: string },
  ) =>
    call<SourceTestView>(
      `/parent/source-tests/${encodeURIComponent(id)}/classification`,
      { method: 'PATCH', headers: elevated(token), body: JSON.stringify(input) },
      parentCopy.capture.classification.failed,
    ),

  /**
   * Runs the one batch legibility check. No body: the page set is the request.
   *
   * It runs once — a second call answers with the stored verdicts and costs
   * nothing — so a double tap is not a double charge.
   */
  checkSourceTestLegibility: (token: string, id: string) =>
    call<SourceTestView>(
      `/parent/source-tests/${encodeURIComponent(id)}/legibility`,
      { method: 'POST', headers: elevated(token) },
      parentCopy.capture.legibility.failed,
    ),

  submitSourceTest: (token: string, id: string) =>
    call<SourceTestView>(
      `/parent/source-tests/${encodeURIComponent(id)}/submit`,
      { method: 'POST', headers: elevated(token) },
      parentCopy.capture.submitFailed,
    ),

  /**
   * How the Extraction of a submitted Source Test is going, and its verdict.
   *
   * A Draft answers 404: there is no job until the pages are committed.
   */
  extraction: (token: string, id: string) =>
    call<ExtractionStatusView>(
      `/parent/source-tests/${encodeURIComponent(id)}/extraction`,
      { headers: elevated(token) },
      parentCopy.capture.generate.readFailed,
    ),

  /** What is left of the Generation Allowance, and the per-request ceiling. */
  generationAllowance: (token: string) =>
    call<GenerationAllowanceView>(
      '/parent/allowance/generation',
      { headers: elevated(token) },
      parentCopy.generate.loadFailed,
    ),

  /**
   * Asks for `count` Practice Tests and answers with the job as it was actually
   * accepted — the clamped count included. The server clamps independently of
   * whatever this app sent, so the response is the only account of what is
   * being spent.
   */
  startGeneration: (
    token: string,
    sourceTestId: string,
    count: number,
    weightedTopic?: string | null,
  ) =>
    call<GenerationJobView>(
      `/parent/source-tests/${encodeURIComponent(sourceTestId)}/practice-tests`,
      {
        method: 'POST',
        headers: elevated(token),
        // Omitted rather than sent as null when nothing is weighted: absent is
        // the unweighted request the API already accepts, and a null would make
        // this app's body differ from the one Story 4.1 sends.
        body: JSON.stringify(
          weightedTopic === undefined || weightedTopic === null
            ? { count }
            : { count, weightedTopic },
        ),
      },
      parentCopy.generate.startFailed,
    ),

  /**
   * The Topics this upload's Extraction carries, which are the only Topics a
   * request may be weighted on.
   *
   * The labels arrive as the Extraction holds them and are rendered as they
   * arrive: they are content read off the parent's own page, and this app
   * neither rewrites nor canonicalizes them.
   */
  generationTopics: (token: string, sourceTestId: string) =>
    call<GenerationTopicsView>(
      `/parent/source-tests/${encodeURIComponent(sourceTestId)}/practice-tests/topics`,
      { headers: elevated(token) },
      parentCopy.generate.loadFailed,
    ),

  /**
   * How the newest generation job for this upload is going.
   *
   * A 404 means nothing has been requested for it yet — which is exactly what
   * a parent who navigated straight to the URL should be told.
   */
  generationJob: (token: string, sourceTestId: string) =>
    call<GenerationJobView>(
      `/parent/source-tests/${encodeURIComponent(sourceTestId)}/practice-tests/job`,
      { headers: elevated(token) },
      parentCopy.generate.progressFailed,
    ),

  /**
   * Every draft this account is still holding, newest first.
   *
   * An empty list is the ordinary answer for an account that has generated
   * nothing yet — it is a state the screen renders, never an error.
   */
  practiceTestDrafts: (token: string) =>
    call<PracticeTestDraftSummary[]>(
      '/parent/practice-tests/drafts',
      { headers: elevated(token) },
      parentCopy.drafts.listFailed,
    ),

  /**
   * One draft, whole: every Question with its correct answer, its options and
   * its Topics.
   *
   * A 404 covers an id that was never there, one belonging to another account
   * and one whose Practice Test is no longer a draft — the API states one
   * sentence for all three, and this app does not try to tell them apart.
   */
  practiceTestDraft: (token: string, practiceTestId: string) =>
    call<PracticeTestDraftView>(
      `/parent/practice-tests/${encodeURIComponent(practiceTestId)}`,
      { headers: elevated(token) },
      parentCopy.drafts.openFailed,
    ),

  /**
   * Rewrites one Question of a draft and answers with the whole draft as it now
   * stands.
   *
   * **Plain text goes up, segments come back.** A fraction is structure in the
   * column (AD-32) and the server owns the one conversion, so nothing here
   * builds a segment array — it sends what the parent typed and re-renders from
   * the view that comes back, which is the only account of what is stored.
   *
   * Every field is optional and an absent field leaves what is stored, with one
   * deliberate exception: a Multiple Choice edit must always restate
   * `correctOrdinal`, because an absent one leaves no option flagged and the
   * API refuses it. Inheriting the stored flag would leave "correct" on a body
   * that no longer says what it said when it was flagged.
   *
   * A 404 covers an unknown id, another account's, a Question of a different
   * draft, and — the released-state write barrier — a Practice Test that is no
   * longer a draft.
   */
  editDraftQuestion: (
    token: string,
    practiceTestId: string,
    questionId: string,
    input: {
      prompt?: string;
      answer?: string;
      choices?: { ordinal: number; body: string }[];
      correctOrdinal?: number;
    },
  ) =>
    call<PracticeTestDraftView>(
      `/parent/practice-tests/${encodeURIComponent(practiceTestId)}/questions/${encodeURIComponent(
        questionId,
      )}`,
      { method: 'PATCH', headers: elevated(token), body: JSON.stringify(input) },
      parentCopy.drafts.editFailed,
    ),

  /**
   * Deletes one Question of a draft and answers with the draft as it now
   * stands — renumbered from 1, with its stored count rewritten.
   *
   * Deleting the **last** Question discards the Practice Test, and the answer
   * says so: it carries `status: 'Discarded'` and no questions, which is what
   * the screen reads to go back to Pending drafts. Nothing is refunded (AD-14),
   * and the confirmation said so before this call was ever made.
   */
  deleteDraftQuestion: (token: string, practiceTestId: string, questionId: string) =>
    call<PracticeTestDraftView>(
      `/parent/practice-tests/${encodeURIComponent(practiceTestId)}/questions/${encodeURIComponent(
        questionId,
      )}`,
      { method: 'DELETE', headers: elevated(token) },
      parentCopy.drafts.deleteFailed,
    ),

  /**
   * Releases the whole draft, and answers with the view carrying its new status.
   *
   * **One-way.** A second call on the same id answers the module's ordinary 404,
   * identical to the one an unknown id gets, because the API scopes `Draft` in
   * the statement that mutates — so this app has nothing to tell apart and no
   * unrelease to offer. Nothing is refunded, and the confirmation stated both
   * consequences before this call was ever made.
   */
  releasePracticeTest: (token: string, practiceTestId: string) =>
    call<PracticeTestDraftView>(
      `/parent/practice-tests/${encodeURIComponent(practiceTestId)}/release`,
      { method: 'POST', headers: elevated(token) },
      parentCopy.drafts.releaseFailed,
    ),

  /**
   * Discards the whole draft, and answers with the view carrying its new status.
   *
   * Refused with that same 404 on an already-released id: release is terminal.
   * Nothing is given back (AD-14).
   */
  discardPracticeTest: (token: string, practiceTestId: string) =>
    call<PracticeTestDraftView>(
      `/parent/practice-tests/${encodeURIComponent(practiceTestId)}/discard`,
      { method: 'POST', headers: elevated(token) },
      parentCopy.drafts.discardFailed,
    ),

  /**
   * Sets or clears the draft's countdown, and answers with the whole view.
   *
   * `minutes: null` turns the timer off and is stated explicitly — there is one
   * duration and this restates it whole, which is why it is a `PUT` and why an
   * empty body is not an option. The bounds are the API's: a figure outside them
   * is a 400, and this app disabling a control is a courtesy on top of that.
   *
   * Refused with the module's ordinary 404 on a released or discarded id: the
   * timer is editable up to release and never after, and the API is where that
   * is decided.
   */
  setPracticeTestTimer: (token: string, practiceTestId: string, minutes: number | null) =>
    call<PracticeTestDraftView>(
      `/parent/practice-tests/${encodeURIComponent(practiceTestId)}/timer`,
      { method: 'PUT', headers: elevated(token), body: JSON.stringify({ minutes }) },
      parentCopy.drafts.timerFailed,
    ),
};

/** The one multipart field name both byte-carrying routes read. */
function pagePart(file: File): FormData {
  const form = new FormData();
  form.append('file', file);
  return form;
}

/**
 * Whether a body is multipart the browser must describe itself.
 *
 * Guarded rather than a bare `instanceof`: this module is imported by the
 * Node-side unit suite, where `FormData` exists but a body may be any of the
 * other `BodyInit` shapes, and by a server render where it may not exist at all.
 */
function isFormData(body: BodyInit | null | undefined): boolean {
  return typeof FormData !== 'undefined' && body instanceof FormData;
}

/** The elevation credential's one and only carrier. */
function elevated(token: string): HeadersInit {
  return { authorization: `Bearer ${token}` };
}

/** The device's IANA zone, as the account's first timezone entry (AD-27). */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
