import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { studentCopy } from '@/copy/student';

const SOURCE = readFileSync(path.resolve(import.meta.dirname, 'page.tsx'), 'utf8');

/**
 * The same file with every comment removed.
 *
 * A ban on a *word* has to be a ban on the code, not on the prose: this screen is
 * required to explain at length why it holds no time limit, writes nothing and
 * says nothing about being right, and a bare `not.toContain('timer')` over the
 * raw source would make writing that explanation a test failure.
 */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');

describe('what sends a child away from Take Test', () => {
  it('is the Student Mode guard’s own refusal, and only that', () => {
    expect(CODE).toMatch(
      /if \(deviceIsUnbound\(cause\)\) \{\s*router\.replace\('\/auth\/sign-in'\)/u,
    );
    // One navigation in the whole file, and it is that one. A 500, a 429, a 404
    // or a dropped connection is a bad moment, not a Student Mode taken away.
    expect(CODE.match(/router\.replace/gu)).toHaveLength(1);
    expect(CODE.match(/deviceIsUnbound\(cause\)/gu)).toHaveLength(1);
  });

  it('renders a retryable error for everything else, instead of routing', () => {
    expect(CODE).toContain('setError(');
    expect(CODE).toContain('data-testid="take-test-error"');
    expect(CODE).toContain('{studentCopy.retry}');
    // The retry re-issues the read rather than asking the child to reload.
    expect(CODE).toMatch(/setAttempt\(\(value\) => value \+ 1\)/u);
  });

  it('clears what is on screen before it states a failure', () => {
    // The error branch is reached only while there is no test, so a read that
    // fails *after* one succeeded has to put the screen back to nothing — or the
    // previous Question stays up and the alert is never rendered at all.
    expect(CODE).toMatch(/setTest\(null\);\s*setError\(/u);
  });
});

describe('moving from one practice test to another', () => {
  it('leaves the previous test’s state behind, all of it', () => {
    // Everything this screen holds is about one practice test. Carrying `index`
    // into a shorter one puts it past the end, so a perfectly successful read
    // renders the failure alert — and the old answers would be held against the
    // new test's Question ids.
    const reset = CODE.slice(
      CODE.indexOf('if (loadedTestId !== practiceTestId) {'),
      CODE.indexOf('useEffect(() => {'),
    );
    expect(reset).toContain('setTest(null)');
    expect(reset).toContain('setAnswers({})');
    expect(reset).toContain('setIndex(0)');
    expect(reset).toContain('setMapOpen(false)');
  });

  it('does not discard a child’s answers because a read had to be retried', () => {
    // Keyed on the id alone. A retry is the same test asked for again.
    expect(CODE).toMatch(/if \(loadedTestId !== practiceTestId\) \{/u);
    expect(CODE).not.toMatch(/if \([^)]*attempt[^)]*\) \{\s*set(Answers|Index)/u);
  });
});

describe('what the screen reaches for', () => {
  it('calls the student-scoped read, and no parent-scoped call at all', () => {
    expect(CODE).toContain('parentApi.studentPracticeTest(practiceTestId)');
    expect(CODE).not.toMatch(/parentApi\.(?!studentPracticeTest\b)/u);
    // And it never names a profile id: the binding names it, server-side.
    expect(CODE).not.toMatch(/studentProfileId/u);
  });

  it('holds no elevation bearer and reads no parent state', () => {
    expect(CODE).not.toMatch(/useElevation|elevation|Authorization|bearer/iu);
  });
});

describe('what this story is not', () => {
  it('holds no time limit, no submission, no score and no answer key', () => {
    // Each of these belongs to a later story, and a half-built version of any of
    // them is worse than none: a countdown that does not end anything, or a
    // control that hands in work nothing receives.
    for (const forbidden of [/timer/iu, /submit/iu, /score/iu, /correct/iu, /grade/iu]) {
      expect(CODE).not.toMatch(forbidden);
    }
  });

  it('writes the child’s answers to no browser storage of any kind', () => {
    // Persistence is Story 5.3's, with its TTL and its profile-switch clearing.
    // Answers live in this component's state and nowhere else.
    for (const forbidden of [
      /localStorage/u,
      /sessionStorage/u,
      /indexedDB/iu,
      /document\.cookie/u,
    ]) {
      expect(CODE).not.toMatch(forbidden);
    }
    expect(CODE).toContain('const [answers, setAnswers]');
  });

  it('issues no request after the read', () => {
    // No write endpoint exists for a child's answers, and this screen calls none.
    expect(CODE).not.toMatch(/method: '(POST|PUT|PATCH|DELETE)'/u);
    expect(CODE.match(/parentApi\./gu)).toHaveLength(1);
  });
});

describe('the order the Questions are worked in', () => {
  it('is the order the server sent, with nothing reordering it in the browser', () => {
    expect(CODE).toContain('test?.questions ?? []');
    for (const verb of [/\.sort\(/u, /\.reverse\(/u, /groupBy/u, /\.filter\(/u]) {
      expect(CODE).not.toMatch(verb);
    }
  });

  it('counts the Questions and bounds the navigation from one figure', () => {
    // Sourcing the counter from the stored `questionCount` column and Next from
    // the array is how a screen says "Question 3 of 5" with Next disabled.
    expect(CODE).toContain('const total = questions.length;');
    expect(CODE).not.toContain('test?.questionCount');
  });

  it('walks the test linearly and offers the map as the escape hatch (UX-DR39)', () => {
    expect(CODE).toContain('data-testid="take-test-back"');
    expect(CODE).toContain('data-testid="take-test-next"');
    // Disabled at the ends rather than wrapping around, which would silently
    // move a child from the last Question to the first.
    expect(CODE).toContain('disabled={index === 0}');
    expect(CODE).toContain('disabled={index >= questions.length - 1}');
    expect(CODE).toContain('QuestionMap');
    expect(CODE).toContain('onJump={jumpTo}');
  });
});

describe('the rail, the overlay and the measure', () => {
  it('decides which form of the map is shown in CSS, not with a JS media query', () => {
    // Both forms render and the breakpoint decides which is visible, so the
    // first paint agrees with the server's.
    expect(CODE).toContain("display: { xs: 'none', md: 'block' }");
    expect(CODE).toContain("display: { xs: 'inline-flex', md: 'none' }");
    expect(CODE).not.toMatch(/useMediaQuery|matchMedia/u);
  });

  it('opens and closes the overlay with real controls', () => {
    expect(CODE).toContain('data-testid="take-test-map-open"');
    expect(CODE).toContain('data-testid="take-test-map-close"');
    expect(CODE).toContain('AppDialog');
  });

  it('caps the Question column at the measure, from the token', () => {
    expect(CODE).toContain('measure.questionMaxWidth');
    expect(CODE).toContain('<Screen component="section" measured>');
    // Nested inside the layout's own `main`, so the page has one landmark and
    // not two — a second `main` makes "the main region" ambiguous.
    expect(CODE).not.toMatch(/component="main"/u);
    expect(CODE).not.toMatch(/maxWidth: \d|34rem/u);
  });

  it('writes no raw pixel, colour or radius of its own', () => {
    expect(CODE).toContain('comfortableDensity.tapTarget');
    expect(CODE).toContain('rounded.paper');
    expect(CODE).not.toMatch(/#[0-9a-f]{3,6}\b/iu);
    expect(CODE).not.toMatch(/minHeight: \d/u);
  });
});

describe('Take Test’s copy', () => {
  it('counts the child’s place from figures it was handed', () => {
    expect(studentCopy.takeTest.counter(1, 1)).toBe('Question 1 of 1');
    expect(studentCopy.takeTest.counter(3, 8)).toBe('Question 3 of 8');
  });

  it('names each Format plainly, in the second person surface’s own register', () => {
    for (const label of Object.values(studentCopy.takeTest.format)) {
      expect(label).not.toContain('!');
      expect(label).not.toMatch(/\d/u);
    }
    expect(studentCopy.takeTest.format.MultipleChoice).toBe('Multiple choice');
    expect(studentCopy.takeTest.format.FillInTheBlank).toBe('Fill in the blank');
    expect(studentCopy.takeTest.format.ShortAnswer).toBe('Short answer');
  });

  it('uses exactly two progress words, and never `Unanswered`', () => {
    expect(studentCopy.takeTest.legendAnswered).toBe('Answered');
    expect(studentCopy.takeTest.legendNotAnswered).toBe('Not answered');
    const everySentence = [
      studentCopy.takeTest.legendAnswered,
      studentCopy.takeTest.legendNotAnswered,
      studentCopy.takeTest.mapSummary(2, 3),
      studentCopy.takeTest.cellState(1, true, false),
      studentCopy.takeTest.cellState(2, false, false),
      studentCopy.takeTest.cellState(3, false, true),
    ].join(' ');
    // `Unanswered` reads as a grade state, and nothing before submission grades.
    expect(everySentence).not.toMatch(/unanswered/iu);
    expect(everySentence).not.toMatch(/correct|wrong|score|right|grade/iu);
  });

  it('says where the child is, in words as well as in an attribute', () => {
    expect(studentCopy.takeTest.cellState(7, false, true)).toBe(
      'Question 7, not answered, you are here',
    );
    expect(studentCopy.takeTest.cellState(3, true, false)).toBe('Question 3, answered');
    expect(studentCopy.takeTest.cellState(4, false, false)).toBe('Question 4, not answered');
  });

  it('summarises with two counts handed in, never a figure of its own', () => {
    expect(studentCopy.takeTest.mapSummary(2, 6)).toBe('2 answered · 6 not answered');
  });

  it('addresses the child, with no exclamation mark and no error code', () => {
    for (const line of [
      studentCopy.takeTest.answerLabel,
      studentCopy.takeTest.fractionHelp,
      studentCopy.takeTest.back,
      studentCopy.takeTest.next,
      studentCopy.takeTest.mapHeading,
      studentCopy.takeTest.openMap,
      studentCopy.takeTest.closeMap,
      studentCopy.takeTest.loading,
      studentCopy.takeTest.failed,
    ]) {
      expect(line).not.toContain('!');
      expect(line).not.toMatch(/\b(4\d\d|5\d\d)\b/u);
    }
    expect(studentCopy.takeTest.answerLabel).toMatch(/^Your\b/u);
    expect(studentCopy.takeTest.mapHeading).toMatch(/^Your\b/u);
  });

  it('explains the fraction field without promising anything about the answer', () => {
    expect(studentCopy.takeTest.fractionHelp).toMatch(/3\/4/u);
    expect(studentCopy.takeTest.fractionHelp).not.toMatch(/correct|right|must|only/iu);
  });
});
