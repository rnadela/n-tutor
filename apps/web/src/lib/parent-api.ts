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
  /** The page ceiling, stated by the API so the web app owns no copy of it. */
  maxPages: number;
  pages: PageImageView[];
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

interface FailureDetail {
  lockedUntil: string | null;
  notElevated: boolean;
  notBound: boolean;
}

/** What a rejection body says beyond its status, read exactly once. */
async function failureDetailFrom(response: Response): Promise<FailureDetail> {
  const none: FailureDetail = { lockedUntil: null, notElevated: false, notBound: false };
  if (response.status !== LOCKED_STATUS && response.status !== 401) return none;
  try {
    const body = (await response.json()) as {
      lockedUntil?: unknown;
      elevated?: unknown;
      bound?: unknown;
    } | null;
    return {
      lockedUntil: typeof body?.lockedUntil === 'string' ? body.lockedUntil : null,
      // `elevated: false` is the elevation guard naming itself as the refuser.
      notElevated: body?.elevated === false,
      // `bound: false` is the Student Mode guard doing the same.
      notBound: body?.bound === false,
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

  // --- Uncommitted parent state ------------------------------------------
  //
  // Server-side only, and behind the elevation bearer like every other
  // parent-scoped call. Nothing here is persisted to any browser storage API —
  // the same prohibition the elevation token itself carries, and the whole
  // point of the mechanism: a device that has fallen back to Student Mode holds
  // no trace of the work.
  //
  // No screen calls these yet. Story 1.6 is the mechanism; the epics that add a
  // `kind` add the callers.

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

  submitSourceTest: (token: string, id: string) =>
    call<SourceTestView>(
      `/parent/source-tests/${encodeURIComponent(id)}/submit`,
      { method: 'POST', headers: elevated(token) },
      parentCopy.capture.submitFailed,
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
