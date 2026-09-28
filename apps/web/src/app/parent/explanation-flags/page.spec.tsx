import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parentCopy } from '@/copy/parent';

const PAGE_SOURCE = readFileSync(path.resolve(import.meta.dirname, 'page.tsx'), 'utf8');
/**
 * The same file with every comment removed.
 *
 * A ban on a *word* has to be a ban on the code, not on the prose: this screen is required
 * to explain at length that it is not the Analytics dashboard band and carries no Mastery
 * figure — and a bare `not.toMatch(/mastery/i)` over the raw source would make writing
 * that explanation a test failure.
 */
const CODE = PAGE_SOURCE.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');

/**
 * The list of what one child has reported.
 *
 * `apps/web` runs its unit tests without a DOM, so a screen's behavioural rules are
 * asserted on the source that states them, exactly as the runs list's spec does. What the
 * rendered list actually says, and what a click does, is proved in the browser by
 * `e2e/tests/student-explanation-flagging.spec.ts`.
 */
describe('the list of what a child has reported', () => {
  it('lists one child’s reports, chosen here, from the read that only knows the account', () => {
    // A report belongs to one child, so a list spanning two would make "newest first" a
    // question about whose.
    expect(PAGE_SOURCE).toContain('parentApi.students(token)');
    expect(PAGE_SOURCE).toContain('parentApi.studentExplanationFlags(token, studentProfileId)');
    expect(PAGE_SOURCE).toContain('id="parent-flags-student"');
  });

  it('arrives having already chosen the first child', () => {
    // A screen that showed nothing until a parent picked would make an account with one
    // child answer a question it already knows.
    expect(PAGE_SOURCE).toContain(
      "setStudentProfileId((chosen) => (chosen === '' ? (found[0]?.id ?? '') : chosen))",
    );
  });

  it('re-reads on a change of child, and applies only the freshest answer', () => {
    // A superseded read — outlived by switching children — could otherwise resolve after
    // the fact and overwrite the newer list.
    expect(PAGE_SOURCE).toContain('applyIfCurrent(current.current, issued');
    expect(PAGE_SOURCE).toContain('[token, studentProfileId, attempt, leave]');
  });

  it('lists an awaiting report and a decided one alike', () => {
    // A report outlives the decision: a list that dropped decided entries would make a
    // parent's own dismissal look like the concern never happened. So the disposition is
    // rendered and never filtered on.
    expect(PAGE_SOURCE).toContain('parentCopy.flags.awaiting');
    expect(PAGE_SOURCE).toContain('parentCopy.flags.confirmed(');
    expect(PAGE_SOURCE).toContain('parentCopy.flags.dismissed(');
    // Nothing here drops a row for what was decided about it.
    expect(CODE).not.toMatch(/\.filter\(/u);
  });

  it('marks awaiting as the absence of a decision, not as a value somebody wrote', () => {
    expect(PAGE_SOURCE).toContain(
      'if (entry.disposition === null) return parentCopy.flags.awaiting;',
    );
    expect(CODE).not.toMatch(/'Pending'|Awaiting'/u);
  });

  it('renders an empty list as a sentence, not as a failure', () => {
    // A child who has reported nothing is a state, and the common one. So is a profile the
    // API answers nothing for — and this screen does not try to tell the two apart,
    // because the API deliberately does not either.
    expect(PAGE_SOURCE).toContain('flags.length === 0');
    expect(PAGE_SOURCE).toContain('parentCopy.flags.empty');
    expect(parentCopy.flags.empty).not.toMatch(/error|fail/iu);
  });

  it('never claims a child reported nothing when the read did not answer', () => {
    // "Not loading" is also what a failed read leaves behind. Without a separate flag the
    // error alert and the empty sentence would render together, one of them untrue.
    expect(PAGE_SOURCE).toContain('const [loaded, setLoaded] = useState(false)');
    expect(PAGE_SOURCE).toContain('loaded &&');
  });

  it('never claims there is no child when the profiles read did not answer', () => {
    expect(PAGE_SOURCE).toContain('const [profilesLoaded, setProfilesLoaded] = useState(false)');
    expect(PAGE_SOURCE).toContain('profilesLoaded &&');
    expect(PAGE_SOURCE).toContain('parentCopy.flags.noStudents');
  });

  it('never renders an internal error message at a parent', () => {
    // A rejection carries whatever the platform or the server put there — "Failed to
    // fetch", a stack-shaped string, an upstream's own wording — and none of it is a
    // sentence written for a parent to read (AD-32). A `cause.message` fallback would also
    // make every `parentCopy.flags.*` failure sentence dead code, because a rejected fetch
    // is an `Error` before it is anything else.
    expect(CODE).not.toMatch(/cause\.message/u);
    expect(CODE).not.toMatch(/instanceof Error/u);
    // The API's own sentence is still rendered where it authored one: those are written
    // once, server-side, rather than restated here.
    expect(CODE).toContain('cause instanceof ParentApiError && cause.reason !== null');
  });

  it('names the read that actually failed, which is two sentences and not one', () => {
    // Saying "what the student has reported could not be listed" when it was the list of
    // students that could not be read names the wrong thing, beside a selector that is
    // empty for a reason the sentence does not give.
    expect(CODE).toContain('setError(parentCopy.flags.profilesFailed)');
    expect(CODE).toContain('parentCopy.flags.listFailed');
    expect(parentCopy.flags.profilesFailed).not.toBe(parentCopy.flags.listFailed);
  });

  it('lets Retry re-issue the profiles read as well as the reports read', () => {
    // An instruction to try again that can only recover one of two reads is a dead end.
    expect(PAGE_SOURCE).toContain('[token, attempt, leave, router]');
    expect(PAGE_SOURCE).toContain('setAttempt((value) => value + 1)');
  });

  it('states every instant without a date rather than the words “Invalid Date”', () => {
    // Those words on a parent's screen read as a fault in the report rather than in a
    // string, and a screen reader says them out loud.
    expect(PAGE_SOURCE).toContain('readableInstant(');
    expect(PAGE_SOURCE).toContain('parentCopy.flags.reportedUndated');
    expect(PAGE_SOURCE).toContain('parentCopy.flags.confirmedUndated');
    expect(PAGE_SOURCE).toContain('parentCopy.flags.dismissedUndated');
    expect(CODE).not.toMatch(/new Date\([^)]*\)\.toLocaleString/u);
  });

  it('puts list semantics back where the style strips them', () => {
    // `listStyle: 'none'` strips the item count in Safari/VoiceOver, which is the one
    // thing a parent scanning this needs announced.
    expect(PAGE_SOURCE).toContain('role="list"');
    expect(PAGE_SOURCE).toContain('role="listitem"');
  });

  it('states the run and question ordinals the server gave, never a row’s position', () => {
    // Which run the child sat and the number they were shown are facts about the paper,
    // not about how many reports happen to be listed above this one.
    expect(PAGE_SOURCE).toContain(
      'parentCopy.flags.where(entry.runOrdinal, entry.questionOrdinal)',
    );
    expect(CODE).not.toMatch(/\.map\(\(\w+, index\)/u);
  });

  it('keeps the newest-first order the API answered with, and sorts nothing', () => {
    expect(CODE).not.toMatch(/\.sort\(/u);
    expect(CODE).not.toMatch(/\.reverse\(\)/u);
  });

  it('degrades a context that no longer resolves without costing the row its place', () => {
    // The report was still made, which is why it is in this list at all.
    expect(PAGE_SOURCE).toContain('parentCopy.flags.whereUnknown');
    expect(PAGE_SOURCE).toContain('parentCopy.flags.unknownSubject');
    expect(PAGE_SOURCE).toContain('entry.runOrdinal === null || entry.questionOrdinal === null');
  });

  it('links each report to the Attempt that carries the explanation, by its own id', () => {
    // The decision is made next to the prose it is about, and deciding without having read
    // the explanation is the one thing this feature must not make easy.
    expect(PAGE_SOURCE).toContain('attemptHref(entry.attemptId)');
    expect(PAGE_SOURCE).toContain('parentCopy.flags.open');
    // And nothing is persisted to a browser storage API on the way there.
    expect(CODE).not.toMatch(/localStorage|sessionStorage/u);
  });

  it('decides nothing and generates nothing: this screen is a list', () => {
    // The two decisions live beside the prose, on the Attempt-detail screen.
    expect(CODE).not.toMatch(/disposeExplanationFlag|explainQuestion|flagExplanation/u);
    const calls = CODE.match(/parentApi\.\w+/gu) ?? [];
    expect(calls).toEqual(['parentApi.students', 'parentApi.studentExplanationFlags']);
  });

  it('ends Parent View only on the guard’s own refusal', () => {
    // A 500, a 429 or a 400 is a fault to show with a Retry, not a reason to throw away a
    // token that is still perfectly good.
    expect(PAGE_SOURCE).toContain('endsParentView(cause)');
    expect(PAGE_SOURCE).toContain('clearElevation()');
  });

  it('names no score, grade, Mastery figure, cost, tier, model or allowance', () => {
    // A plain parent screen, not the Analytics dashboard band and not a grade surface
    // (AD-20, AD-26): Story 7.4's band and Story 6.5's overrides are not here and have no
    // shape here to travel in.
    for (const forbidden of [
      /\bscore\b/iu,
      /mastery/iu,
      /gradeState/u,
      /allowance/iu,
      /\btier\b/iu,
      /costMicros/iu,
      /rationale/iu,
      /suppress/iu,
    ]) {
      expect(CODE).not.toMatch(forbidden);
    }
  });

  it('writes no sentence of its own: every one is a member of `parentCopy.flags`', () => {
    expect(CODE).not.toMatch(/studentCopy/u);
    const literals = CODE.match(/>\s*[A-Z][a-z]+ [a-z]/gu) ?? [];
    expect(literals).toEqual([]);
  });
});

describe('what the reported-list copy is allowed to say', () => {
  const copy = parentCopy.flags;
  const sentences = [
    copy.title,
    copy.intro,
    copy.studentLabel,
    copy.empty,
    copy.noStudents,
    copy.listFailed,
    copy.profilesFailed,
    copy.awaiting,
    copy.whereUnknown,
    copy.reportedUndated,
    copy.confirmedUndated,
    copy.dismissedUndated,
    copy.open,
  ];

  it('speaks about the child in the third person, never to them', () => {
    for (const sentence of sentences) {
      expect(sentence).not.toMatch(/\byou\b|\byour\b/iu);
    }
  });

  it('names no operator, queue, cost, tier, model or allowance', () => {
    for (const sentence of sentences) {
      expect(sentence).not.toMatch(/operator|admin|queue|\btier\b|cost|\$|£|allowance|model/iu);
    }
  });

  it('keeps every figure a parameter, and writes none into a sentence', () => {
    expect(copy.where(2, 7)).toContain('2');
    expect(copy.where(2, 7)).toContain('7');
    expect(copy.where(2, 7)).not.toBe(copy.where(3, 7));
    expect(copy.reported('LATER')).toContain('LATER');
    expect(copy.confirmed('LATER')).toContain('LATER');
    expect(copy.dismissed('LATER')).toContain('LATER');
    for (const sentence of sentences) {
      expect(sentence).not.toMatch(/\d/u);
    }
  });

  it('keeps the three states of a report three different sentences', () => {
    // Awaiting, sent on, and decided to be fine are three facts a parent acts on
    // differently; collapsing any two would make the list unreadable at a glance.
    expect(new Set([copy.awaiting, copy.confirmedUndated, copy.dismissedUndated]).size).toBe(3);
  });

  it('never blames the parent for a report nobody has decided about', () => {
    expect(copy.awaiting).not.toMatch(/must|should|overdue|urgent|!/iu);
  });
});
