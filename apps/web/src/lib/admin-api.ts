'use client';

import { adminCopy } from '@/copy/admin';
import type { RichTextSegment } from '@/lib/parent-api';

/**
 * One Explanation an operator has to judge, exactly as the API states it.
 *
 * **The unit is the Explanation, not the flag.** A parent who originated a concern and a
 * student concern the same parent later confirmed are two records of one paragraph, and
 * the operator's job is to judge the paragraph once. So `raisedBy` lists every route that
 * raised it and `raisedAt` is the earliest of their instants, which is the entry's place
 * in the queue.
 *
 * **Only what judging a paragraph takes.** The prose and the identifiers, and no child's
 * display name, no account email, no cost, no tier, no model name, no allowance figure
 * and no grading rationale (AD-20, AD-26).
 *
 * The queue never carries a student concern nobody has decided about, or one a parent
 * dismissed: the API filters those out in the query, so there is no state here for one to
 * arrive in and nothing for this app to filter.
 */
export interface FlaggedExplanation {
  explanationId: string;
  parentAccountId: string;
  studentProfileId: string;
  attemptId: string;
  questionId: string;
  /** The stored segments, drawn by `components/RichText` and by nothing else (AD-32). */
  body: RichTextSegment[];
  /** Which routes raised it. Both, for one raised each way. */
  raisedBy: ('Parent' | 'Student')[];
  /** The earliest instant any qualifying concern was raised. The queue position. */
  raisedAt: string;
}

export interface TaxonomyItem {
  id: string;
  name: string;
  enabled: boolean;
}

export interface AvailabilityEntry {
  subjectId: string;
  gradeLevelId: string;
  enabled: boolean;
}

export interface TaxonomySnapshot {
  subjects: TaxonomyItem[];
  gradeLevels: TaxonomyItem[];
  availability: AvailabilityEntry[];
}

/** Mirrors the API's AccountTier enum. Carries no figure — only the labels. */
export const ACCOUNT_TIERS = ['Free', 'Plus', 'Family', 'Internal'] as const;
export type AccountTier = (typeof ACCOUNT_TIERS)[number];

export interface ParentAccountSummary {
  id: string;
  email: string;
  displayName: string | null;
  tier: AccountTier;
  createdAt: string;
  /** The zone in effect for this account right now. */
  timezone: string;
}

/** `limit: null` is unlimited. Every figure originates in the API's tiers table. */
export interface AllowanceReading {
  used: number;
  limit: number | null;
}

export interface AccountConsumption {
  periodStart: string;
  periodEnd: string;
  resetAt: string;
  timezone: string;
  tier: AccountTier;
  studentProfileLimit: number | null;
  allowances: {
    upload: AllowanceReading;
    generation: AllowanceReading;
    explanation: AllowanceReading;
  };
}

export interface ParentAccountDetail {
  account: ParentAccountSummary;
  consumption: AccountConsumption;
}

const TOKEN_KEY = 'n-test-reviewer.admin.token';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api').replace(
  /\/+$/,
  '',
);

/**
 * Browser storage is best-effort: absent during prerender, and throwing outright
 * in private mode or with site data blocked. Every access is guarded.
 */
function storage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readToken(): string | null {
  try {
    return storage()?.getItem(TOKEN_KEY) ?? null;
  } catch {
    return null;
  }
}

export function writeToken(token: string): void {
  try {
    storage()?.setItem(TOKEN_KEY, token);
  } catch {
    // A viewer who blocks site data simply signs in again next visit.
  }
}

export function clearToken(): void {
  try {
    storage()?.removeItem(TOKEN_KEY);
  } catch {
    // Nothing to clear.
  }
}

export class AdminApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AdminApiError';
  }
}

function messageFor(status: number): string {
  if (status === 401) return adminCopy.errors.sessionExpired;
  if (status === 404) return adminCopy.errors.notFound;
  if (status === 409) return adminCopy.errors.duplicate;
  return adminCopy.errors.generic;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = readToken();
  // Built through Headers so a caller passing a Headers instance cannot silently
  // drop the auth or content-type entries.
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  if (token) headers.set('authorization', `Bearer ${token}`);

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });

  if (!response.ok) throw new AdminApiError(messageFor(response.status), response.status);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function signIn(email: string, password: string): Promise<string> {
  const response = await fetch(`${API_BASE}/admin/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new AdminApiError(adminCopy.signIn.failed, response.status);
  const body = (await response.json()) as { token: string };
  return body.token;
}

export const adminApi = {
  loadTaxonomy: () => call<TaxonomySnapshot>('/admin/taxonomy'),
  createSubject: (name: string) =>
    call<TaxonomyItem>('/admin/taxonomy/subjects', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  renameSubject: (id: string, name: string) =>
    call<TaxonomyItem>(`/admin/taxonomy/subjects/${id}/name`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  setSubjectEnabled: (id: string, enabled: boolean) =>
    call<TaxonomyItem>(`/admin/taxonomy/subjects/${id}/enabled`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    }),
  createGradeLevel: (name: string) =>
    call<TaxonomyItem>('/admin/taxonomy/grade-levels', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  renameGradeLevel: (id: string, name: string) =>
    call<TaxonomyItem>(`/admin/taxonomy/grade-levels/${id}/name`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  setGradeLevelEnabled: (id: string, enabled: boolean) =>
    call<TaxonomyItem>(`/admin/taxonomy/grade-levels/${id}/enabled`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    }),
  setAvailability: (subjectId: string, gradeLevelId: string, enabled: boolean) =>
    call<AvailabilityEntry>('/admin/taxonomy/availability', {
      method: 'PUT',
      body: JSON.stringify({ subjectId, gradeLevelId, enabled }),
    }),
  selectableSubjects: (gradeLevelId: string) =>
    call<TaxonomyItem[]>(`/admin/taxonomy/grade-levels/${gradeLevelId}/selectable-subjects`),
  listParentAccounts: () => call<ParentAccountSummary[]>('/admin/parent-accounts'),
  loadParentAccount: (id: string) => call<ParentAccountDetail>(`/admin/parent-accounts/${id}`),
  assignTier: (id: string, tier: AccountTier) =>
    call<ParentAccountSummary>(`/admin/parent-accounts/${id}/tier`, {
      method: 'PATCH',
      body: JSON.stringify({ tier }),
    }),
  /**
   * Every Explanation an operator has to judge, oldest concern first.
   *
   * **A read that changes nothing.** Nothing here suppresses, regenerates or hides an
   * Explanation, and nothing decides anything: the parent's decision is the parent's, and
   * this app has no route to overturn one.
   *
   * An empty list is the ordinary answer and the normal case: nobody has raised a concern
   * this operator has to judge.
   */
  flaggedExplanations: () => call<FlaggedExplanation[]>('/admin/flagged-explanations'),
};
