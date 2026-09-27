import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { studentCopy } from '@/copy/student';
import { NETWORK_STATUS, ParentApiError } from '@/lib/parent-api';
import { deviceIsUnbound } from './page';

const SOURCE = readFileSync(path.resolve(import.meta.dirname, 'page.tsx'), 'utf8');

/**
 * The same file with every comment removed.
 *
 * A ban on a *word* has to be a ban on the code, not on the prose: this page is
 * required to explain why its read carries no prompt and no correct answer, and a
 * bare `not.toContain('prompt')` over the raw source would make writing that
 * explanation a test failure.
 */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('what sends a child away from Student Mode', () => {
  it('is the Student Mode guard’s own refusal, and only that', () => {
    expect(deviceIsUnbound(new ParentApiError('not set up', 401, null, false, true))).toBe(true);
  });

  it('is not a bare 401, which says nothing about the binding', () => {
    expect(deviceIsUnbound(new ParentApiError('nope', 401))).toBe(false);
  });

  it('is never a fault the reader could simply try again', () => {
    // A dropped connection is not a Student Mode that was taken away, and
    // routing a child to sign-in on one would make it look like it was.
    for (const status of [400, 404, 429, 500, 503, NETWORK_STATUS]) {
      expect(deviceIsUnbound(new ParentApiError('nope', status))).toBe(false);
    }
    expect(deviceIsUnbound(new Error('boom'))).toBe(false);
    expect(deviceIsUnbound('boom')).toBe(false);
  });
});

describe('what the page does with each outcome', () => {
  it('routes an unbound device to sign-in rather than to a broken Student Mode', () => {
    expect(SOURCE).toMatch(
      /if \(deviceIsUnbound\(cause\)\) \{\s*router\.replace\('\/auth\/sign-in'\)/u,
    );
  });

  it('renders a retryable error for anything else, instead of routing', () => {
    const handler = SOURCE.slice(SOURCE.indexOf('(cause: unknown) => {'), SOURCE.indexOf('};'));
    expect(handler).toContain('setError(');
    // Every navigation on the page is the unbound one — one per read, and each
    // guarded by that one condition. A 500, a 429 or a dropped connection is a bad
    // moment, not a Student Mode that was taken away.
    expect(CODE.match(/router\.replace/gu)).toHaveLength(2);
    expect(CODE.match(/deviceIsUnbound\(cause\)/gu)).toHaveLength(2);
    expect(SOURCE).toContain('{studentCopy.retry}');
  });

  it('reaches no parent-scoped endpoint at all', () => {
    expect(SOURCE).toContain('parentApi.studentSession()');
    expect(SOURCE).toContain('parentApi.studentPracticeTests()');
    // Exactly the two cookie-only calls, and nothing else: both answer from the
    // binding alone, and a parent-scoped call here would need a bearer this page
    // must never hold.
    expect(SOURCE).not.toMatch(/parentApi\.(?!studentSession|studentPracticeTests)/u);
    // And it never names a profile id: the binding names it, server-side.
    expect(SOURCE).not.toMatch(/studentProfileId/u);
  });

  it('settles the two reads independently, so one failure keeps the other', () => {
    // A list that could not be read must not blank a greeting that came back
    // perfectly well — the reason Pending drafts gives for the same arrangement.
    expect(SOURCE).not.toContain('Promise.all([');
    expect(SOURCE).toContain('const [tests, setTests]');
  });

  it('gives the list read its own retryable failure, so no state says nothing at all', () => {
    // Without it, a 500 or a dropped connection on the list alone leaves it
    // unanswered *and* silent: no rows, no "nothing yet" (a claim only an answered
    // read can make), and no error — so the retry control, which renders from a
    // failure, is unreachable and the child is stuck on a greeting.
    expect(SOURCE).toContain('const [testsError, setTestsError]');
    expect(SOURCE).toContain('setTestsError(cause instanceof Error ? cause.message');
    expect(SOURCE).toContain('data-testid="student-tests-error"');
    // The control re-issues both reads, and it is the list's own alert — so the
    // greeting the session answered stays on screen beside it.
    expect(SOURCE).toMatch(/testsError !== null && \(/u);
    expect(SOURCE).toMatch(/data-testid="student-tests-error"[\s\S]{0,400}onClick=\{load\}/u);
    // Cleared on every re-issue, so a stale failure cannot outlive the read that
    // replaced it.
    expect(SOURCE).toContain('setTestsError(null)');
  });

  it('says "nothing yet" only once the list has actually answered', () => {
    // A read that never came back is in no position to make a claim about this
    // child's practice tests.
    expect(SOURCE).toContain('tests !== null &&');
    expect(SOURCE).toContain('tests.length === 0');
    expect(SOURCE).toContain('studentCopy.empty');
  });

  it('hands the list component the array exactly as the server sent it', () => {
    // Matched as a pattern rather than as an exact JSX line, so a Prettier
    // reflow cannot fail a test whose subject is intact.
    expect(SOURCE).toMatch(/<PracticeTestList\s+tests=\{tests\}/u);
    // What the list *renders* — one flat list, in the order received, a
    // Subject and a state per row — is asserted where it can be rendered, in
    // `_components/PracticeTestList.spec.tsx`. It cannot be asserted here:
    // this workspace runs with `environment: 'node'` and no router, so the
    // page itself cannot be rendered at all.
  });

  it('does not reorder, filter or group what it was given', () => {
    // A rule about this *file*, which is the one kind of claim regex over
    // source is the right instrument for — and scoped to the region it is
    // about rather than the whole file, so unrelated future code cannot trip
    // it. Both anchors are asserted found: an `indexOf` returning -1 would
    // silently widen the slice to the start of the file and assert nothing.
    const opens = CODE.indexOf('tests !== null &&');
    const closes = CODE.indexOf('studentCopy.parent');
    expect(opens).toBeGreaterThanOrEqual(0);
    expect(closes).toBeGreaterThan(opens);
    const region = CODE.slice(opens, closes);
    // Reordering verbs only. A field name like `subjectName` is deliberately
    // not banned: a legitimate future `aria-label` would name it.
    for (const verb of ['.sort(', '.toSorted(', '.reverse(', '.filter(', 'groupBy']) {
      expect(region).not.toContain(verb);
    }
    expect(region).not.toContain('Object.entries(');
  });

  it('shows no generated content, because none is on the wire', () => {
    // An identifier and a count. A student-scoped read carrying prompts, options
    // and correct answers would hand a child the answer key.
    for (const forbidden of ['prompt', 'choices', 'topics', 'RichText', 'answer']) {
      expect(CODE).not.toContain(forbidden);
    }
    // And no figure about spending, on the surface the epic forbids it on.
    expect(CODE).not.toMatch(/allowance|tier|gpt-/iu);
  });

  it('spaces itself and sizes its controls from the comfortable tokens', () => {
    expect(SOURCE).toContain('comfortableDensity.tapTarget');
    expect(SOURCE).not.toMatch(/minHeight: \d/u);
  });
});

describe('Student Mode’s copy', () => {
  it('greets the bound child by name, in the second person', () => {
    const greeting = studentCopy.greeting('Ada');
    expect(greeting).toContain('Ada');
    expect(greeting).not.toContain('!');
  });

  it('addresses the child rather than describing them to someone else', () => {
    expect(studentCopy.gradeLevel('Grade 4')).toMatch(/^You are in/u);
    expect(studentCopy.empty).toMatch(/\byour\b/iu);
  });

  it('says what will appear later instead of showing an empty screen', () => {
    expect(studentCopy.empty).toMatch(/nothing to practise yet/u);
  });

  it('names the one control out of Student Mode without naming the PIN', () => {
    expect(studentCopy.parent).toBe('Parent');
  });

  it('heads the released list in the second person, like everything else here', () => {
    expect(studentCopy.practiceTestsTitle).toMatch(/^Your\b/u);
    expect(studentCopy.practiceTestsTitle).not.toContain('!');
  });

  it('states each row’s question count from the figure it was handed', () => {
    // The only figure on a row, and it arrives from the API rather than from this
    // module — no allowance, no tier, no model, and nothing about spending.
    expect(studentCopy.practiceTest(1)).toBe('A practice test with 1 question');
    expect(studentCopy.practiceTest(8)).toBe('A practice test with 8 questions');
    for (const count of [1, 8]) {
      expect(studentCopy.practiceTest(count)).not.toContain('!');
      expect(studentCopy.practiceTest(count)).not.toMatch(/allowance|tier|gpt/iu);
    }
  });

  it('names each of the three conditions in plain second-person words', () => {
    expect(studentCopy.practiceTestState('NotStarted')).toBe('Not started');
    expect(studentCopy.practiceTestState('InProgress')).toBe('In progress');
    expect(studentCopy.practiceTestState('Completed')).toBe('Completed');
    for (const state of ['NotStarted', 'InProgress', 'Completed']) {
      expect(studentCopy.practiceTestState(state)).not.toContain('!');
    }
  });

  it('says nothing at all for a state it does not recognise, and never “Completed”', () => {
    // A mapping that fell through to its last case would tell a child that a
    // test they have never touched is finished.
    for (const state of [undefined, null, '', 'completed', 'Completed ', 'Graded', 'Expired']) {
      expect(studentCopy.practiceTestState(state)).toBeNull();
    }
  });

  it('gives the front door a heading of its own, not Student Mode’s', () => {
    // A shared heading would let a test believe it had reached Student Mode
    // while it was still standing on the front door deciding.
    expect(studentCopy.frontDoorTitle).not.toBe(studentCopy.title);
  });

  it('states no figure anywhere', () => {
    for (const line of [
      studentCopy.title,
      studentCopy.frontDoorTitle,
      studentCopy.greeting('Ada'),
      studentCopy.gradeLevel('Grade 4'),
      studentCopy.empty,
      studentCopy.parent,
      studentCopy.notBound,
      studentCopy.failed,
      studentCopy.retry,
      studentCopy.practiceTestsTitle,
    ]) {
      // The Grade Level's own name is the only digit a reader ever sees, and
      // it arrives from the API rather than from this module.
      expect(line.replace('Grade 4', '')).not.toMatch(/\d/u);
      expect(line).not.toContain('!');
    }
  });
});
