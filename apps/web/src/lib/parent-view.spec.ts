import { describe, expect, it } from 'vitest';
import { readableInstant } from '@/lib/parent-view';

/**
 * The shared parent-screen rules.
 *
 * `announcedText`, `applyIfCurrent` and `endsParentView` are asserted through
 * `app/parent/students/page.spec.tsx`, which is where this module's rules were first
 * addressed and where they stayed when they moved here. `readableInstant` is asserted
 * here, because what it answers for a string that is not a date is the whole reason it
 * exists and no screen's spec is the place to say so.
 */
describe('stating a stored instant on a parent screen', () => {
  it('formats a real instant in the device’s own formatting', () => {
    const shown = readableInstant('2026-09-28T10:15:00.000Z');
    expect(shown).not.toBeNull();
    // Not the exact string: the formatting is the device's, and pinning it here would
    // be this spec asserting a locale rather than a rule. What matters is that it is
    // text about that instant and not the words a failed parse produces.
    expect(shown).not.toContain('Invalid Date');
    expect(shown).toContain('2026');
  });

  it('answers null for a string that is not an instant at all', () => {
    // `new Date('')` and `new Date('later')` are both `Invalid Date`, whose
    // `toLocaleString()` is the literal words "Invalid Date" — words that read as a
    // fault in the thing being described rather than in the string, and that a screen
    // reader says out loud.
    for (const value of ['', 'later', 'not-a-date', '2026-13-45T99:99:99Z']) {
      expect(readableInstant(value)).toBeNull();
    }
  });

  it('never answers the words a failed parse produces', () => {
    // The property, over both arms: there is no input for which this returns them.
    for (const value of ['', 'nonsense', '2026-09-28T10:15:00.000Z']) {
      expect(readableInstant(value) ?? '').not.toContain('Invalid');
    }
  });
});
