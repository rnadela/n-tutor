import { describe, expect, it } from 'vitest';
import {
  CHILD_DATA_CONSENT_VERSION,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  RESET_FAILED,
  RESET_TOKEN_TTL_MS,
  SIGN_IN_FAILED,
  SIGN_UP_FAILED,
  TERMS_VERSION,
  acceptsCurrentVersions,
  currentAuthPolicy,
  isAcceptablePassword,
  isResetTokenUsable,
  resetLinkFor,
  resetTokenExpiryFrom,
} from './auth-policy.js';

describe('password policy', () => {
  it('rejects one character below the minimum and accepts the minimum', () => {
    expect(isAcceptablePassword('a'.repeat(PASSWORD_MIN_LENGTH - 1))).toBe(false);
    expect(isAcceptablePassword('a'.repeat(PASSWORD_MIN_LENGTH))).toBe(true);
  });

  it('accepts the maximum and rejects one character above it', () => {
    expect(isAcceptablePassword('a'.repeat(PASSWORD_MAX_LENGTH))).toBe(true);
    expect(isAcceptablePassword('a'.repeat(PASSWORD_MAX_LENGTH + 1))).toBe(false);
  });
});

describe('consent versions', () => {
  it('accepts only the versions currently in force', () => {
    expect(
      acceptsCurrentVersions({
        termsVersion: TERMS_VERSION,
        noticeVersion: CHILD_DATA_CONSENT_VERSION,
      }),
    ).toBe(true);
    expect(
      acceptsCurrentVersions({ termsVersion: 'stale', noticeVersion: CHILD_DATA_CONSENT_VERSION }),
    ).toBe(false);
    expect(acceptsCurrentVersions({ termsVersion: TERMS_VERSION, noticeVersion: 'stale' })).toBe(
      false,
    );
  });

  it('publishes the minimum and both versions as one policy object', () => {
    const policy = currentAuthPolicy();
    expect(policy.passwordMinLength).toBe(PASSWORD_MIN_LENGTH);
    expect(policy.termsVersion).toBe(TERMS_VERSION);
    expect(policy.noticeVersion).toBe(CHILD_DATA_CONSENT_VERSION);
    expect(policy.noticeText.length).toBeGreaterThan(0);
  });
});

describe('reset token predicates', () => {
  const issued = new Date('2026-09-23T10:00:00.000Z');

  it('expires exactly one TTL after issue', () => {
    expect(resetTokenExpiryFrom(issued).getTime()).toBe(issued.getTime() + RESET_TOKEN_TTL_MS);
  });

  it('is usable while unused and unexpired, and dead at the boundary', () => {
    const expiresAt = resetTokenExpiryFrom(issued);
    expect(isResetTokenUsable({ expiresAt, usedAt: null }, issued)).toBe(true);
    expect(isResetTokenUsable({ expiresAt, usedAt: null }, new Date(expiresAt.getTime() - 1))).toBe(
      true,
    );
    expect(isResetTokenUsable({ expiresAt, usedAt: null }, expiresAt)).toBe(false);
  });

  it('is dead once used, however fresh', () => {
    expect(
      isResetTokenUsable({ expiresAt: resetTokenExpiryFrom(issued), usedAt: issued }, issued),
    ).toBe(false);
  });
});

describe('reset link construction', () => {
  it('points at the web reset-confirm screen and carries the token', () => {
    expect(resetLinkFor('https://app.example.test', 'abc-123')).toBe(
      'https://app.example.test/auth/reset/confirm?token=abc-123',
    );
  });

  it('does not double the slash when the origin carries a trailing one', () => {
    expect(resetLinkFor('https://app.example.test/', 'abc')).toBe(
      'https://app.example.test/auth/reset/confirm?token=abc',
    );
  });

  it('escapes a token that would otherwise change the query string', () => {
    expect(resetLinkFor('https://app.example.test', 'a&b=c')).toContain('token=a%26b%3Dc');
  });
});

describe('non-enumerating messages', () => {
  it('states one message per endpoint, none naming an email or a token state', () => {
    for (const message of [SIGN_UP_FAILED, SIGN_IN_FAILED, RESET_FAILED]) {
      expect(message).not.toMatch(/exist|registered|unknown|expired|used/i);
    }
  });
});
