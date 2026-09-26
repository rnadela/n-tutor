import { describe, expect, it } from 'vitest';
import {
  classificationAnnouncement,
  isClassified,
  optionsWithStored,
  submitBlockedReasons,
} from './classification';

const SUBJECT = 'subject-1';
const GRADE_LEVEL = 'grade-level-1';

const BOTH = { subjectId: SUBJECT, gradeLevelId: GRADE_LEVEL };
const NEITHER = { subjectId: null, gradeLevelId: null };

/** The instant the batch check ran. Its value is never read, only its presence. */
const CHECKED = '2026-01-01T00:00:00.000Z';
/** A classified, checked upload: the state every gate is satisfied in. */
const READY = { ...BOTH, legibilityCheckedAt: CHECKED };

describe('isClassified', () => {
  it('holds only when both references are set', () => {
    expect(isClassified(BOTH)).toBe(true);
    expect(isClassified({ subjectId: SUBJECT, gradeLevelId: null })).toBe(false);
    expect(isClassified({ subjectId: null, gradeLevelId: GRADE_LEVEL })).toBe(false);
    expect(isClassified(NEITHER)).toBe(false);
  });
});

describe('submitBlockedReasons', () => {
  it('is empty when a classified, checked upload holds a page that landed', () => {
    expect(submitBlockedReasons(READY, 1)).toEqual([]);
  });

  it('names the pages alone when only they are missing', () => {
    expect(submitBlockedReasons(READY, 0)).toEqual(['pages']);
  });

  it('names the classification alone when only it is missing', () => {
    expect(
      submitBlockedReasons(
        { subjectId: null, gradeLevelId: GRADE_LEVEL, legibilityCheckedAt: CHECKED },
        2,
      ),
    ).toEqual(['classification']);
  });

  it('names the check alone when only it has not run', () => {
    expect(submitBlockedReasons({ ...BOTH, legibilityCheckedAt: null }, 2)).toEqual(['legibility']);
  });

  it('names all three, in reading order, when none is met', () => {
    // A parent told only about the pages would fix them and be refused again
    // for a requirement nothing had mentioned.
    expect(submitBlockedReasons({ ...NEITHER, legibilityCheckedAt: null }, 0)).toEqual([
      'pages',
      'classification',
      'legibility',
    ]);
  });

  it('counts only the pages that landed, as the server’s gate does', () => {
    // The screen passes the `Ready` count; zero of those is zero pages
    // however many rows are still uploading.
    expect(submitBlockedReasons(READY, 0)).toContain('pages');
    expect(submitBlockedReasons(READY, 1)).not.toContain('pages');
  });
});

describe('optionsWithStored', () => {
  const OFFERED = [
    { id: 'a', name: 'Maths', enabled: true },
    { id: 'b', name: 'Science', enabled: true },
  ];

  it('is the offered list when nothing is stored', () => {
    expect(optionsWithStored(OFFERED, null, null)).toEqual(OFFERED);
  });

  it('is the offered list when what is stored is still offered', () => {
    expect(optionsWithStored(OFFERED, 'a', 'Maths')).toEqual(OFFERED);
  });

  it('appends what is stored when an administrator has withdrawn it', () => {
    // The stored reference still resolves and the upload is still submittable,
    // so a blank control would say "nothing chosen" about a classified upload.
    expect(optionsWithStored(OFFERED, 'c', 'History')).toEqual([
      ...OFFERED,
      { id: 'c', name: 'History', enabled: false },
    ]);
  });

  it('is the stored row alone when nothing at all is offered any more', () => {
    expect(optionsWithStored([], 'c', 'History')).toEqual([
      { id: 'c', name: 'History', enabled: false },
    ]);
  });

  it('adds nothing it cannot name, since a nameless option renders blank anyway', () => {
    expect(optionsWithStored(OFFERED, 'c', null)).toEqual(OFFERED);
  });

  it('never mutates the offered list it was handed', () => {
    const offered = [...OFFERED];
    optionsWithStored(offered, 'c', 'History');
    expect(offered).toEqual(OFFERED);
  });
});

describe('classificationAnnouncement', () => {
  it('announces the Subject when the patch carries only a Subject', () => {
    expect(
      classificationAnnouncement(
        BOTH,
        { subjectId: 'x' },
        { subjectId: 'x', subjectName: 'History', gradeLevelName: 'Grade 5' },
      ),
    ).toEqual({ kind: 'subjectSet', subjectName: 'History' });
  });

  it('announces the Grade Level, unqualified, when the stored Subject is still offered', () => {
    expect(
      classificationAnnouncement(
        BOTH,
        { gradeLevelId: 'g2' },
        { subjectId: SUBJECT, subjectName: 'Maths', gradeLevelName: 'Grade 6' },
      ),
    ).toEqual({ kind: 'gradeLevelSet', gradeLevelName: 'Grade 6' });
  });

  it('announces that the Grade Level change cleared the stored Subject', () => {
    expect(
      classificationAnnouncement(
        BOTH,
        { gradeLevelId: 'g2' },
        { subjectId: null, subjectName: null, gradeLevelName: 'Grade 6' },
      ),
    ).toEqual({ kind: 'gradeLevelSetSubjectCleared', gradeLevelName: 'Grade 6' });
  });

  it('never claims a clear when there was no stored Subject to clear', () => {
    // A Grade Level set on a draft that never held a Subject answers
    // `subjectId: null` too, but nothing was cleared — the "before" state is
    // what tells the two apart.
    expect(
      classificationAnnouncement(
        { subjectId: null, gradeLevelId: GRADE_LEVEL },
        { gradeLevelId: 'g2' },
        { subjectId: null, subjectName: null, gradeLevelName: 'Grade 6' },
      ),
    ).toEqual({ kind: 'gradeLevelSet', gradeLevelName: 'Grade 6' });
  });
});
