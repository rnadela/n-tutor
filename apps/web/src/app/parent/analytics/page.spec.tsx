import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parentCopy } from '@/copy/parent';

/**
 * The dashboard screen, asserted over its own source.
 *
 * `apps/web` runs vitest with `environment: 'node'`, so a screen holding two
 * staged reads, a selector, a filter and a staleness guard is pinned by reading
 * what it says — exactly as the disputes screen it is modelled on is. The rules it
 * delegates (ranking, percentages, geometry) are pure functions with their own
 * specs.
 */
const SOURCE = readFileSync(path.resolve(import.meta.dirname, 'page.tsx'), 'utf8');
/** Comments stripped, so a rule is never satisfied by a sentence about it. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');

describe('what the dashboard screen does', () => {
  it('makes exactly two reads and no write', () => {
    // The profiles are the selector; the dashboard is one read, because the
    // dashboard is one answer. Nothing here generates, decides or adjusts.
    expect(new Set(CODE.match(/parentApi\.\w+/gu))).toEqual(
      new Set(['parentApi.students', 'parentApi.profileAnalytics']),
    );
    expect(CODE).not.toMatch(/method: 'POST'|method: 'PUT'|method: 'DELETE'/u);
  });

  it('never mutates the staleness ref during render', () => {
    // A render is not a commit: React may run one and throw it away, and a body
    // that retired a request id could drop the response of the read still in
    // flight. The one write lives inside the effect that issues the read.
    expect(CODE).toContain('const issued = (requestId.current += 1)');
    expect(CODE.match(/current\.current\.value = /gu)).toHaveLength(1);
    expect(CODE).not.toMatch(/current\.current\.value = requestId\.current/u);
  });

  it('keeps a still-present selection across a Retry, and falls back when it is gone', () => {
    // A reloaded list that no longer holds the chosen id would otherwise leave
    // the picker showing nothing and the body rendering nothing, with no message.
    expect(CODE).toContain('found.some((profile) => profile.id === chosen)');
  });

  it('shows one student at a time, defaulting to the first', () => {
    expect(CODE).toContain('setStudentProfileId((chosen) =>');
    expect(CODE).toContain("found[0]?.id ?? ''");
    expect(CODE).toContain('id="parent-analytics-student"');
  });

  it('guards a superseded read from overwriting fresher figures', () => {
    // Switching students outlives a read in flight; without the guard it could
    // resolve after the fact and put one child's figures under another's name.
    expect(CODE.match(/applyIfCurrent/gu)).toHaveLength(3);
    expect(CODE).toContain('const issued = (requestId.current += 1)');
  });

  it('drops the subject narrowing when the student changes', () => {
    // A filter kept across a switch would narrow one child's table by another
    // child's subject.
    expect(CODE).toContain('setSubjectChoice(EVERY_SUBJECT)');
  });

  it('holds "answered" apart from "not loading", for both reads', () => {
    expect(CODE).toContain('const [loaded, setLoaded] = useState(false)');
    expect(CODE).toContain('const [profilesLoaded, setProfilesLoaded] = useState(false)');
    expect(CODE).toContain('loaded &&');
    expect(CODE).toContain('profilesLoaded && (');
  });

  it('states the two read failures separately, and never a platform string', () => {
    expect(CODE).toContain('parentCopy.analytics.profilesFailed');
    expect(CODE).toContain('parentCopy.analytics.loadFailed');
    expect(CODE).toContain('cause instanceof ParentApiError && cause.reason !== null');
    expect(CODE).not.toMatch(/cause\.message/u);
  });

  it('sends the parent back to the PIN only on the guard’s own refusal', () => {
    expect(CODE).toContain('endsParentView(cause)');
    expect(CODE).toContain("router.replace('/parent/pin')");
  });
});

describe('what the dashboard screen says', () => {
  it('wraps the content in the parent address, so no copy names a child', () => {
    // Parent View is third person by name (UX-DR31), and `resolveAddress` throws
    // on an empty subject rather than rendering a sentence with a hole in it.
    expect(CODE).toContain('<AddressProvider surface="parent"');
    expect(CODE).toContain('subject={chosen.displayName}');
    expect(CODE).toContain('<Addressed>');
    expect(CODE).toContain('chosen !== null');
  });

  it('states no threshold, ceiling or window of its own', () => {
    // Every tunable arrives on the response. A figure restated here would drift
    // the first time an operator changed the environment.
    expect(CODE).toContain('progress.answeredFloor');
    expect(CODE).toContain('analytics.trend.windowSize');
    // A hardcoded tunable is one of these names with a **number** on the other
    // side of it — an assignment, a default, or a literal prop. A property read
    // and a JSX pass-through are neither, which is why the number is what the
    // pattern is anchored on rather than the name alone.
    expect(CODE).not.toMatch(
      /\b(ceilingPercent|answeredFloor|windowSize)\b\s*(=\s*\{?\s*\d|\?\?\s*\d|:\s*\d)/u,
    );
    // And the numbers themselves appear nowhere: the only literals on this page
    // are layout divisors.
    expect(CODE).not.toMatch(/\b(60|0\.6)\b/u);
  });

  it('puts the mechanism and the progress in the empty state', () => {
    expect(CODE).toContain('parentCopy.analytics.empty(');
    expect(CODE).toContain('emptyStateProgress(');
    expect(CODE).toContain('parentCopy.analytics.emptyProgress');
    expect(CODE).toContain('parentCopy.analytics.emptyNoWork');
  });

  it('derives the empty state\u2019s work signal from a value that branch can reach', () => {
    // Fed the topics, `hasWork` would be structurally false — the progress
    // sentence unreachable, and a student who *has* finished work told they have
    // finished none. The activity counts are what is still true here.
    expect(CODE).toMatch(/emptyStateProgress\(\s*analytics\.activity,/u);
    expect(CODE).not.toMatch(/emptyStateProgress\(\s*analytics\.topics/u);
  });

  it('names no account plan and offers nothing to buy, anywhere on the page', () => {
    expect(SOURCE).not.toMatch(/tier|upgrade|free plan|subscribe|buy|pricing/iu);
  });

  it('states the Explanation counter as the account’s, in the account’s own zone', () => {
    expect(CODE).toContain('parentCopy.analytics.allowanceTitle');
    expect(CODE).toContain('analytics.explanationAllowance.limit === null');
    expect(CODE).toContain('parentCopy.analytics.allowanceUnlimited');
    // The account's zone, never the device's.
    expect(CODE).toContain('analytics.explanationAllowance.timezone');
    expect(CODE).toContain('dateOnly(');
    expect(CODE).not.toMatch(/toLocaleDateString|toLocaleString/u);
  });

  it('renders one trend and one table, each stating its own scope', () => {
    expect(CODE.match(/<TrendSparkline/gu)).toHaveLength(1);
    expect(CODE.match(/<MasteryTable/gu)).toHaveLength(1);
  });

  it('links the digest to the screens that already own those decisions', () => {
    expect(CODE).toContain('href="/parent/grade-disputes"');
    expect(CODE).toContain('href="/parent/explanation-flags"');
    // And decides nothing itself.
    expect(CODE).not.toMatch(/overrideGrade|disposeFlag|generate/u);
  });

  it('builds the drill-down link, carrying the student it is about', () => {
    // The one fact the drill-down refuses to guess: which child. The table knows the
    // topic and nothing else, so the selected profile has to travel in the address the
    // dashboard composes — and nothing else in the codebase asserts that it does.
    expect(CODE).toContain('const hrefForTopic = useCallback(');
    expect(CODE).toContain('hrefFor={hrefForTopic}');
    expect(CODE).toContain('/parent/analytics/topics/');
    expect(CODE).toContain('student=${encodeURIComponent(studentProfileId)}');
    // Both ids escaped, never pasted into a path.
    expect(CODE).toContain('encodeURIComponent(topicId)');
    // And the href is recomputed when the chosen student changes, so a switch cannot
    // leave rows pointing at the previous child.
    expect(CODE).toMatch(/\[studentProfileId\],\s*\)/u);
  });

  it('still decides nothing and generates nothing itself', () => {
    // The drill-down owns the evidence and the one control (UX Q12c: no duplicate entry
    // point at the dashboard), so this screen gains a link and no cost, count or fire.
    expect(CODE).not.toMatch(/startGeneration|costOf|remainingAfter|generationAllowance/u);
  });

  it('narrows by subject through the one pure module', () => {
    expect(CODE).toContain('subjectOptions(analytics.topics)');
    expect(CODE).toContain('filterBySubject(');
    expect(CODE).toContain('parentCopy.analytics.subjectHeading');
  });

  it('re-sorts nothing: the ranking is the API answer', () => {
    expect(CODE).not.toMatch(/\.sort\(/u);
  });
});

describe('how the dashboard is reached', () => {
  it('is linked from Parent View, client-side like its neighbours', () => {
    const PARENT = readFileSync(path.resolve(import.meta.dirname, '..', 'page.tsx'), 'utf8');
    expect(PARENT).toContain('href="/parent/analytics"');
    expect(PARENT).toContain('parentCopy.parentView.analytics');
    expect(parentCopy.parentView.analytics.length).toBeGreaterThan(0);
  });
});
