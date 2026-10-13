import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { studentCopy } from '@/copy/student';
import { completedTests } from '@/lib/student-results';
import { bottomNavShown } from '@/lib/bottom-nav';

const SOURCE = readFileSync(path.resolve(import.meta.dirname, 'page.tsx'), 'utf8');

/**
 * The same file with every comment removed.
 *
 * The page is required to explain why it takes no sort and why its run read says
 * nothing when it fails, and a bare `not.toContain` over the raw source would
 * make writing those explanations a test failure. This workspace also runs with
 * `environment: 'node'` and no router, so the page cannot be rendered at all —
 * what it renders from is asserted here, and what the list and the row render is
 * asserted in their own specs.
 */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');

describe('what the Results screen reads', () => {
  it('reaches exactly the two student reads Home already makes', () => {
    expect(CODE).toContain('parentApi.studentPracticeTests()');
    expect(CODE).toContain('parentApi.practiceTestRuns()');
    // No session read, no new endpoint and no parent-scoped call: both reads
    // answer from the binding cookie alone.
    expect(CODE).not.toMatch(/parentApi\.(?!studentPracticeTests|practiceTestRuns)/u);
    expect(CODE).not.toContain('fetch(');
    // And it never names a profile id: the binding names it, server-side.
    expect(CODE).not.toMatch(/studentProfileId|profile\.id/u);
  });

  it('settles the two reads independently, so one failure keeps the other', () => {
    expect(CODE).not.toContain('Promise.all([');
    expect(CODE).toContain('const [tests, setTests]');
    expect(CODE).toContain('const [runs, setRuns]');
  });

  it('guards every response behind the stale-request check', () => {
    // A read superseded by Retry must not resolve afterwards and overwrite what
    // replaced it.
    expect(CODE).toContain('const thisRequest = (requestId.current += 1)');
    expect(CODE.match(/if \(requestId\.current !== thisRequest\) return/gu)).toHaveLength(4);
  });
});

describe('what the Results screen does with each outcome', () => {
  it('routes only an unbound device, and routes it to sign-in', () => {
    expect(SOURCE).toMatch(
      /if \(deviceIsUnbound\(cause\)\) \{\s*router\.replace\('\/auth\/sign-in'\)/u,
    );
    // One per read, each guarded by that one condition. A 500, a 429 or a
    // dropped connection is a bad moment, not a Student Mode taken away.
    expect(CODE.match(/router\.replace/gu)).toHaveLength(2);
    expect(CODE.match(/deviceIsUnbound\(cause\)/gu)).toHaveLength(2);
    // The rule is Home's own, imported rather than restated.
    expect(CODE).toContain("import { deviceIsUnbound } from '../page'");
  });

  it('gives the list read a retryable alert that re-issues both reads', () => {
    expect(CODE).toContain('const [testsError, setTestsError]');
    expect(CODE).toContain('setTestsError(cause instanceof Error ? cause.message');
    expect(CODE).toContain('data-testid="student-results-error"');
    expect(CODE).toMatch(/data-testid="student-results-error"[\s\S]{0,400}onClick=\{load\}/u);
    // Cleared on every re-issue, so a stale failure cannot outlive the read
    // that replaced it.
    expect(CODE).toContain('setTestsError(null)');
    // And the heading is outside every branch, so a failure never takes it away.
    expect(CODE.indexOf('studentCopy.resultsList.heading')).toBeLessThan(
      CODE.indexOf('testsError !== null &&'),
    );
  });

  it('says nothing at all when the run read fails, and never re-issues it alone', () => {
    const handler = CODE.slice(
      CODE.indexOf('parentApi.practiceTestRuns()'),
      CODE.indexOf('}, [router]);'),
    );
    expect(handler).toContain('deviceIsUnbound(cause)');
    expect(handler).not.toContain('setRunsError');
    expect(handler).not.toContain('setTimeout');
    expect(CODE).not.toContain('runsError');
    // Absent figures are simply absent rows' lines: the list takes the map or
    // nothing at all.
    expect(CODE).toContain('runs={runs ?? undefined}');
    expect(CODE).toContain('setRuns(runsById(value))');
    expect(CODE).toContain('setRuns(null)');
  });

  it('holds an unanswered read apart from an answered empty one', () => {
    // "You have not finished one yet" is a claim only an answered read may make.
    expect(CODE).toContain('const finished = tests === null ? null : completedTests(tests);');
    expect(CODE).toContain('finished === null && testsError === null');
    expect(CODE).toContain('finished !== null &&');
    expect(CODE).toContain('finished.length === 0');
    expect(CODE).toContain('data-testid="student-results-empty"');
    // The empty sentence sits inside the answered branch, never beside the
    // loading status.
    const answered = CODE.indexOf('finished !== null &&');
    expect(CODE.indexOf('studentCopy.resultsList.empty')).toBeGreaterThan(answered);
  });
});

describe('what the Results screen renders', () => {
  it('filters through the exported rule rather than inline', () => {
    expect(CODE).toContain("import { completedTests } from '@/lib/student-results'");
    expect(CODE).toContain('completedTests(tests)');
    expect(CODE).not.toContain("state === 'Completed'");
  });

  it('takes no order of its own anywhere', () => {
    // Newest-first is the server's band-2 order, preserved by the filter. A
    // sort here would key off a run figure that is allowed to be missing.
    expect(CODE).not.toMatch(/\.sort\(|\.toSorted\(|\.reverse\(|toSorted|submittedAt|groupBy/u);
  });

  it('uses Home’s own list and row, un-forked', () => {
    expect(CODE).toContain("import { PracticeTestList } from '../_components/PracticeTestList'");
    expect(CODE).toMatch(/<PracticeTestList\s+tests=\{finished\}/u);
    expect(CODE).not.toContain('PracticeTestRow');
  });

  it('computes no figure of its own', () => {
    for (const forbidden of ['percent', 'denominator', 'Math.round', 'correct /', 'rank']) {
      expect(CODE).not.toContain(forbidden);
    }
    // And carries no generated content: a student-scoped read never holds one.
    for (const forbidden of ['prompt', 'choices', 'answer']) {
      expect(CODE).not.toContain(forbidden);
    }
  });

  it('writes no sentence of its own: every word comes from the copy module', () => {
    expect(CODE).toContain("import { studentCopy } from '@/copy/student'");
    // No string literal in this file reads as a sentence addressed to a child.
    expect(CODE).not.toMatch(/'[A-Z][a-z]+ [^']{10,}'/u);
  });

  it('heads the page with an `h1` and sizes its controls from the tokens', () => {
    expect(CODE).toMatch(
      /<Typography component="h1"[^>]*>\s*\{studentCopy\.resultsList\.heading\}/u,
    );
    expect(CODE).toContain('comfortableDensity.tapTarget');
    expect(CODE).not.toMatch(/minHeight: \d/u);
    // No colour and no spacing written as a bare figure here.
    expect(CODE).not.toMatch(/#[0-9a-fA-F]{3,8}/u);
  });

  it('shows the way back only where there is no bar to carry it', () => {
    expect(CODE).toContain("display: { xs: 'none', lg: 'inline-flex' }");
    expect(CODE).toContain('studentCopy.resultsList.backToPractice');
    // Which layout is drawn is a breakpoint, never a width read in JavaScript
    // (UX-DR44).
    expect(CODE).not.toMatch(/useMediaQuery|matchMedia|window\./u);
  });
});

describe('where the Results screen sits in Student Mode', () => {
  it('is an ordinary Student Mode route, so it carries the bar', () => {
    expect(bottomNavShown('/student/results')).toBe(true);
  });
});

describe('the Results screen’s copy', () => {
  it('is its own block, not the one Attempt’s answer key', () => {
    expect(studentCopy.resultsList.heading).not.toBe(studentCopy.results.heading);
  });

  it('addresses the child, with no exclamation mark and no figure', () => {
    for (const line of [
      studentCopy.resultsList.heading,
      studentCopy.resultsList.empty,
      studentCopy.resultsList.failed,
      studentCopy.resultsList.link,
      studentCopy.resultsList.backToPractice,
    ]) {
      expect(line).not.toContain('!');
      expect(line).not.toMatch(/\d/u);
    }
    expect(studentCopy.resultsList.heading).toMatch(/^Your\b/u);
    expect(studentCopy.resultsList.empty).toMatch(/\byou\b/iu);
  });

  it('says what will appear here and how to make it appear', () => {
    expect(studentCopy.resultsList.empty).toMatch(/show up here/u);
    expect(studentCopy.resultsList.empty).toMatch(/finish/iu);
  });
});

describe('the rule the screen is built on, driven directly', () => {
  it('lists only finished tests, in the order they arrived', () => {
    const rows = [
      { id: 'a', subjectName: null, questionCount: 2, state: 'NotStarted' as const },
      { id: 'b', subjectName: null, questionCount: 2, state: 'Completed' as const },
      { id: 'c', subjectName: null, questionCount: 2, state: 'Completed' as const },
    ];
    expect(completedTests(rows).map((row) => row.id)).toEqual(['b', 'c']);
  });
});
