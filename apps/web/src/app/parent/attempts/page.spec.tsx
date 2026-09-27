import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parentCopy } from '@/copy/parent';

const PAGE_SOURCE = readFileSync(path.resolve(import.meta.dirname, 'page.tsx'), 'utf8');

/**
 * The list of a child's finished practice tests.
 *
 * `apps/web` runs its unit tests without a DOM, so a screen's behavioural rules are
 * asserted on the source that states them, exactly as the drafts list's spec does.
 * What the rendered list actually says, and what a click does, is proved in the browser
 * by `e2e/tests/parent-explanation-review.spec.ts`.
 */
describe('the list of a child’s finished practice tests', () => {
  it('lists one child’s runs, chosen here, from the read that only knows the account', () => {
    // A run belongs to one child, so a list spanning two would make "newest first" a
    // question about whose.
    expect(PAGE_SOURCE).toContain('parentApi.students(token)');
    expect(PAGE_SOURCE).toContain('parentApi.studentAttempts(token, studentProfileId)');
    expect(PAGE_SOURCE).toContain('id="parent-attempts-student"');
  });

  it('arrives having already chosen the first child', () => {
    // A screen that showed nothing until a parent picked would make an account with one
    // child answer a question it already knows.
    expect(PAGE_SOURCE).toContain(
      "setStudentProfileId((chosen) => (chosen === '' ? (found[0]?.id ?? '') : chosen))",
    );
  });

  it('re-reads on a change of child, and applies only the freshest answer', () => {
    // A superseded read — outlived by switching children — could otherwise resolve
    // after the fact and overwrite the newer list.
    expect(PAGE_SOURCE).toContain('applyIfCurrent(current.current, issued');
    expect(PAGE_SOURCE).toContain('[token, studentProfileId, attempt, leave]');
  });

  it('renders an empty list as a sentence, not as a failure', () => {
    // A child who has handed nothing in is a state. So is a profile the API answers
    // nothing for — and this screen does not try to tell the two apart, because the
    // API deliberately does not either.
    expect(PAGE_SOURCE).toContain('runs.length === 0');
    expect(PAGE_SOURCE).toContain('parentCopy.attempts.empty');
    expect(parentCopy.attempts.empty).not.toMatch(/error|fail/iu);
  });

  it('never claims a child handed nothing in when the read did not answer', () => {
    // "Not loading" is also what a failed read leaves behind. Without a separate flag
    // the error alert and the empty sentence would render together, one of them untrue.
    expect(PAGE_SOURCE).toContain('const [loaded, setLoaded] = useState(false)');
    expect(PAGE_SOURCE).toContain('setLoaded(false)');
    expect(PAGE_SOURCE).toContain('setLoaded(true)');
    expect(PAGE_SOURCE).toContain('loaded &&');
  });

  it('says so when the account has no profile to choose from', () => {
    expect(PAGE_SOURCE).toContain('profiles.length === 0');
    expect(PAGE_SOURCE).toContain('parentCopy.attempts.noStudents');
  });

  it('never claims there is no child when the profiles read did not answer', () => {
    // An empty array is also the first render and what a failed read leaves behind, so
    // "there is no student profile yet" would render beside an alert saying the read did
    // not happen — the same class of bug the runs list's own flag already guards for.
    expect(PAGE_SOURCE).toContain('const [profilesLoaded, setProfilesLoaded] = useState(false)');
    expect(PAGE_SOURCE).toContain('setProfilesLoaded(false)');
    expect(PAGE_SOURCE).toContain('setProfilesLoaded(true)');
    expect(PAGE_SOURCE).toContain('profilesLoaded && (');
  });

  it('lets Retry re-issue the profiles read as well as the runs read', () => {
    // The one control on the screen. Without `attempt` in this effect's deps a failed
    // profiles read would be recoverable only by reloading the page.
    expect(PAGE_SOURCE).toContain('[token, attempt, leave, router]');
  });

  it('states a run’s instant without a date rather than the words “Invalid Date”', () => {
    // The run was handed in either way — that is why it is in this list — so the
    // sentence drops only the part that cannot be stated. "Handed in Invalid Date" reads
    // as a fault in the practice test rather than in a string, and a screen reader says
    // those words out loud.
    expect(PAGE_SOURCE).toContain('readableInstant(submittedAt)');
    expect(PAGE_SOURCE).toContain('parentCopy.attempts.submittedUndated');
    expect(PAGE_SOURCE).not.toMatch(/new Date\([^)]*\)\.toLocaleString/u);
  });

  it('puts list semantics back where the style strips them', () => {
    // `listStyle: 'none'` drops list semantics in Safari/VoiceOver and the item count
    // with them — which is what a parent scanning what their child finished needs.
    expect(PAGE_SOURCE).toContain('role="list"');
    expect(PAGE_SOURCE).toContain('role="listitem"');
  });

  it('states the run ordinal the server gave, never the row’s position', () => {
    expect(PAGE_SOURCE).toContain('parentCopy.attempts.run(run.ordinal)');
    expect(PAGE_SOURCE).not.toMatch(/runs\.length\s*-/u);
    expect(PAGE_SOURCE).not.toMatch(/\.map\(\(run, index\)/u);
  });

  it('keeps the newest-first order the API answered with, and sorts nothing', () => {
    // The order is a claim about `submittedAt` across rows the server compared. A
    // second sort here would be a second answer to it.
    expect(PAGE_SOURCE).not.toMatch(/\.sort\(/u);
  });

  it('links each run by its own id, and stores nothing', () => {
    // The address bar is where a returning parent, a reload and an idle expiry all
    // resume from.
    expect(PAGE_SOURCE).toContain('function attemptHref(attemptId: string)');
    expect(PAGE_SOURCE).toContain('href={attemptHref(run.attemptId)}');
    expect(PAGE_SOURCE).not.toContain('localStorage');
    expect(PAGE_SOURCE).not.toContain('sessionStorage');
  });

  it('degrades a Subject that no longer resolves without costing the row', () => {
    expect(PAGE_SOURCE).toContain('run.subjectName ?? parentCopy.attempts.unknownSubject');
  });

  it('ends Parent View only on the guard’s own refusal', () => {
    expect(PAGE_SOURCE).toContain('endsParentView(cause)');
    expect(PAGE_SOURCE).toContain('parentCopy.attempts.retry');
  });

  it('reads no Explanation and generates nothing: this screen is a list of runs', () => {
    expect(PAGE_SOURCE).not.toMatch(/attemptExplanations|flagExplanation|explainQuestion/u);
  });

  it('names no score, cost, tier, model or allowance', () => {
    // The score is the detail screen's one figure (FR-37); the rest is never a parent
    // string on this surface (AD-20, AD-26).
    for (const forbidden of [/score/iu, /allowance/iu, /\btier\b/iu, /costMicros/iu]) {
      expect(PAGE_SOURCE).not.toMatch(forbidden);
    }
  });
});
