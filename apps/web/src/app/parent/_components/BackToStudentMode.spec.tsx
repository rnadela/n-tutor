import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parentCopy } from '@/copy/parent';
import type { StudentProfileView } from '@/lib/parent-api';
import { defaultSelection, needsProfilePrompt } from './BackToStudentMode';

const SOURCE = readFileSync(path.resolve(import.meta.dirname, 'BackToStudentMode.tsx'), 'utf8');

function profile(id: string, displayName: string): StudentProfileView {
  return {
    id,
    displayName,
    gradeLevelId: 'grade-1',
    gradeLevelName: 'Grade 1',
    gradeLevelEnabled: true,
    archived: false,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

const ADA = profile('a', 'Ada');
const BRAM = profile('b', 'Bram');

describe('when the exit asks which child the device is handed to', () => {
  it('does not ask when there is exactly one active profile', () => {
    // Nothing to choose: the exit binds straight to the only child.
    expect(needsProfilePrompt([ADA])).toBe(false);
  });

  it('does not ask when there is none: there is no Student Mode to hand to', () => {
    expect(needsProfilePrompt([])).toBe(false);
  });

  it('asks as soon as there is more than one', () => {
    expect(needsProfilePrompt([ADA, BRAM])).toBe(true);
  });

  it('is the rule the component actually runs, not merely one it exports', () => {
    expect(SOURCE).toMatch(/if \(!needsProfilePrompt\(active\)\)/u);
  });
});

describe('what the prompt opens on', () => {
  it('preselects the profile the device is already bound to', () => {
    expect(defaultSelection([ADA, BRAM], BRAM.id)).toBe(BRAM.id);
  });

  it('falls back to the first when the device is bound to nothing', () => {
    expect(defaultSelection([ADA, BRAM], null)).toBe(ADA.id);
  });

  it('falls back to the first when the binding names a profile no longer listed', () => {
    // An archived profile leaves the selectable list; the binding may still
    // name it until the next student read refuses it.
    expect(defaultSelection([ADA, BRAM], 'archived-one')).toBe(ADA.id);
  });

  it('chooses nothing when there is nothing to choose', () => {
    expect(defaultSelection([], null)).toBe('');
  });
});

describe('the exit’s own conventions', () => {
  it('applies a response only while it is still the most recent request', () => {
    // A superseded read is a no-op: the guard is checked after every await
    // that could have been outlived by a close or a newer open.
    expect(SOURCE.match(/if \(requestId\.current !== thisRequest\) return;/gu)?.length).toBe(3);
  });

  it('ignores a close while a bind is in flight', () => {
    expect(SOURCE).toMatch(/function onClose\(\) \{\s*if \(busy\) return;/u);
  });

  it('ends Parent View only on the elevation guard’s own refusal', () => {
    expect(SOURCE).toContain('endsParentView(cause)');
    expect(SOURCE).toContain("router.replace('/parent/pin')");
  });

  it('does not clear the elevation before navigating out of the route group', () => {
    // Clearing first makes every mounted Parent View screen re-run its "no
    // token" branch, whose own PIN redirect then races — and wins against —
    // the exit the parent asked for. Leaving the group unmounts the provider,
    // so the token stops existing either way.
    const bindAndLeave = SOURCE.slice(
      SOURCE.indexOf('const bindAndLeave'),
      SOURCE.indexOf('[token, router, leaveToPin]'),
    );
    expect(bindAndLeave).toContain("router.replace('/student')");
    expect(bindAndLeave).not.toContain('clearElevation()');
  });
});

describe('the exit’s copy', () => {
  it('names the child the device is being handed to, in the third person', () => {
    const said = parentCopy.parentView.boundTo('Ada');
    expect(said).toContain('Ada');
    expect(said).not.toMatch(/\byou\b/iu);
  });

  it('says plainly that the device is handed over, not that a screen is closed', () => {
    expect(parentCopy.parentView.chooseProfileIntro).toMatch(/handed to the child/u);
    expect(parentCopy.parentView.backToStudent).toBe('Back to Student Mode');
  });

  it('states there is no profile to hand the device to, rather than an empty list', () => {
    expect(parentCopy.parentView.noProfiles).toMatch(/no profile/iu);
  });

  it('states no figure of its own', () => {
    for (const line of [
      parentCopy.parentView.backToStudent,
      parentCopy.parentView.chooseProfileTitle,
      parentCopy.parentView.chooseProfileIntro,
      parentCopy.parentView.chooseProfileLabel,
      parentCopy.parentView.confirmExit,
      parentCopy.parentView.noProfiles,
    ]) {
      expect(line).not.toMatch(/\d/u);
    }
  });
});
