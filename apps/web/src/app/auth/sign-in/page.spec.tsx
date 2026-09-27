import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(path.resolve(import.meta.dirname, 'page.tsx'), 'utf8');

/**
 * The same file with every comment removed, for the reason the Take Test spec gives:
 * a ban on a word has to be a ban on the code rather than on the prose explaining it.
 */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');

/**
 * Sign-in is a **mode-gate crossing**, and AD-26 says a crossing clears the answers
 * the browser is holding.
 *
 * This is the whole of what this spec is for. The screen's own behaviour — one generic
 * message for a wrong password and an unknown email alike — is the auth suite's, and
 * the form itself has no rule of its own worth a static render.
 */
describe('signing in clears what the browser was holding', () => {
  it('drops every attempt record once the sign-in succeeds', () => {
    expect(CODE).toContain('clearAll(attemptStorage())');
    // `clearAll`, not `retainOnly`: nobody is a child here, so there is no profile
    // whose work it would be right to keep — and a device signed into by a different
    // parent must not be holding the previous household's schoolwork.
    expect(CODE).not.toContain('retainOnly');
  });

  it('clears only on success, and before the screen moves on', () => {
    // Inside the `try`, after the call that could still have thrown: a failed sign-in
    // is not a crossing, and clearing on one would throw away a child's work because
    // a parent mistyped a password.
    expect(CODE).toMatch(
      /await parentApi\.signIn\(email, password\);\s*clearAll\(attemptStorage\(\)\);\s*router\.replace\(/u,
    );
  });

  it('says nothing about a child, a profile or a practice test', () => {
    // The sweep is keyed by nothing: this screen has no profile and must not name one.
    expect(CODE).not.toMatch(/profileId|studentProfile|practiceTest|attemptId/u);
  });
});
