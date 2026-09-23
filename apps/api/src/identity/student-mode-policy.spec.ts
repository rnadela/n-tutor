import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PARENT_SESSION_TTL_SECONDS,
  PARENT_SESSION_AUDIENCE,
  PARENT_SESSION_COOKIE,
} from './auth-policy.js';
import { PARENT_ELEVATION_AUDIENCE } from './pin-policy.js';
import {
  NOT_BOUND,
  STUDENT_MODE_AUDIENCE,
  STUDENT_MODE_COOKIE,
  STUDENT_MODE_TTL_SECONDS,
} from './student-mode-policy.js';

const SOURCE = readFileSync(path.resolve(import.meta.dirname, 'student-mode-policy.ts'), 'utf8');

describe('the Student Mode credential’s audience', () => {
  it('is its own, matching neither the session’s nor the elevation’s', () => {
    expect(STUDENT_MODE_AUDIENCE).not.toBe(PARENT_SESSION_AUDIENCE);
    expect(STUDENT_MODE_AUDIENCE).not.toBe(PARENT_ELEVATION_AUDIENCE);
    // Three credentials, three audiences: the issuer is shared on purpose, so
    // the audience is the only thing telling the guards apart.
    expect(
      new Set([STUDENT_MODE_AUDIENCE, PARENT_SESSION_AUDIENCE, PARENT_ELEVATION_AUDIENCE]).size,
    ).toBe(3);
  });

  it('is carried by its own cookie, never the session’s', () => {
    expect(STUDENT_MODE_COOKIE).not.toBe(PARENT_SESSION_COOKIE);
  });
});

describe('the binding’s lifetime', () => {
  it('is the session cookie’s ceiling', () => {
    expect(STUDENT_MODE_TTL_SECONDS).toBe(DEFAULT_PARENT_SESSION_TTL_SECONDS);
  });

  it('references that constant rather than restating the figure', () => {
    // A second literal here is how two figures that must match start drifting.
    expect(SOURCE).toContain('STUDENT_MODE_TTL_SECONDS = DEFAULT_PARENT_SESSION_TTL_SECONDS');
    expect(SOURCE).not.toMatch(/STUDENT_MODE_TTL_SECONDS\s*=\s*\d/u);
  });
});

describe('the one refusal sentence', () => {
  it('says the device is not set up, and nothing about the account behind it', () => {
    expect(NOT_BOUND).toBe('This device is not set up for a student yet.');
    expect(NOT_BOUND).not.toMatch(/archiv|delete|account|profile id/iu);
    expect(NOT_BOUND).not.toContain('!');
  });
});
