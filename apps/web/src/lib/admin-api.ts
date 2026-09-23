'use client';

import { adminCopy } from '@/copy/admin';

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
};
