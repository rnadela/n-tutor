'use client';

import { parentCopy } from '@/copy/parent';

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
}

export interface ParentIdentity {
  id: string;
  email: string;
}

export interface ParentSession extends ParentIdentity {
  timezone: string;
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api').replace(
  /\/+$/,
  '',
);

export class ParentApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
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

export function messageFor(status: number, fallback: string): string {
  if (status === NETWORK_STATUS) return parentCopy.errors.network;
  if (status === 429) return parentCopy.errors.tooManyAttempts;
  return fallback;
}

async function call<T>(
  path: string,
  init: RequestInit = {},
  failureMessage: string = parentCopy.errors.generic,
): Promise<T> {
  const headers = new Headers(init.headers);
  // Declared only when there is a body to describe; a GET carrying a
  // content-type describes nothing and can force a CORS preflight.
  if (init.body !== undefined && !headers.has('content-type')) {
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
    throw new ParentApiError(messageFor(response.status, failureMessage), response.status);
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
};

/** The device's IANA zone, as the account's first timezone entry (AD-27). */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
