import { describe, expect, it, vi } from 'vitest';
import { parentCopy } from '@/copy/parent';
import { NETWORK_STATUS, ParentApiError } from '@/lib/parent-api';
import { announcedText, applyIfCurrent, canCreateStudent, endsParentView } from './page';

describe('the Students screen’s create rule', () => {
  it('refuses a create with no grade level, before anything leaves the browser', () => {
    expect(canCreateStudent('Noah', '')).toBe(false);
  });

  it('refuses a create with no name, and one that is only whitespace', () => {
    expect(canCreateStudent('', 'grade-1')).toBe(false);
    expect(canCreateStudent('   ', 'grade-1')).toBe(false);
  });

  it('allows a create only when both a name and a grade level are set', () => {
    expect(canCreateStudent('Noah', 'grade-1')).toBe(true);
  });
});

describe('the Students screen’s staleness guard', () => {
  it('applies a response that is still the most recent request', () => {
    const apply = vi.fn();
    applyIfCurrent({ value: 3 }, 3, apply)('profiles');
    expect(apply).toHaveBeenCalledWith('profiles');
  });

  it('is a no-op for a response a later request has superseded', () => {
    const current = { value: 3 };
    const apply = vi.fn();
    const land = applyIfCurrent<string>(current, 3, apply);
    // A newer request was issued while this one was still in flight.
    current.value = 4;
    land('stale profiles');
    expect(apply).not.toHaveBeenCalled();
  });
});

describe('what ends Parent View', () => {
  it('ends it when the elevation guard is the refuser', () => {
    expect(endsParentView(new ParentApiError('gone', 401, null, true))).toBe(true);
    // A bare 401 on a parent-scoped route is the same refusal, flag or not.
    expect(endsParentView(new ParentApiError('gone', 401))).toBe(true);
  });

  it('keeps the parent in place for a transient fault they could retry', () => {
    // A 400 is what the unauthenticated policy read would answer with, and a
    // 500 or a 429 is the server having a bad moment — none is a reason to
    // throw away a token that is still good.
    for (const status of [400, 404, 429, 500, 503, NETWORK_STATUS]) {
      expect(endsParentView(new ParentApiError('nope', status))).toBe(false);
    }
    expect(endsParentView(new Error('boom'))).toBe(false);
    expect(endsParentView('boom')).toBe(false);
  });
});

describe('the live region', () => {
  it('holds nothing before anything has happened', () => {
    expect(announcedText({ text: '', seq: 0 })).toBe('');
  });

  it('makes a repeat of the same sentence a change, so it announces again', () => {
    const said = parentCopy.students.archived('Noa');
    const first = announcedText({ text: said, seq: 1 });
    const again = announcedText({ text: said, seq: 3 });
    const between = announcedText({ text: said, seq: 2 });
    expect(first).not.toBe(between);
    expect(between).not.toBe(again);
    // And the sentence a reader sees is unchanged either way.
    for (const rendered of [first, between, again]) {
      expect(rendered.replace(/​/gu, '')).toBe(said);
    }
  });
});

describe('the archive copy', () => {
  it('names what archiving does, and does not read as a delete', () => {
    const confirmation = parentCopy.students.archiveConfirm('Noah');
    expect(confirmation).toContain('Noah');
    expect(confirmation).toMatch(/Student Mode/);
    expect(confirmation).toMatch(/history is kept/i);
    expect(confirmation).toMatch(/Nothing is deleted/i);

    expect(parentCopy.students.archiveNote).toMatch(/hides/i);
    expect(parentCopy.students.archiveNote).toMatch(/keeps its history/i);
    // The control itself is labelled Archive, never Delete or Remove.
    expect(parentCopy.students.archive).toBe('Archive');
    expect(parentCopy.students.archive).not.toMatch(/delete|remove/i);
  });

  it('offers a restore, so an archive is recoverable', () => {
    expect(parentCopy.students.restore).toBe('Restore');
    expect(parentCopy.students.restored('Noah')).toContain('Noah');
  });

  it('states no figure of its own: the name bound arrives as a parameter', () => {
    expect(parentCopy.students.nameMaximum(60)).toContain('60');
    expect(parentCopy.students.nameMaximum(24)).toContain('24');
  });
});
