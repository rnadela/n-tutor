import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parentCopy } from '@/copy/parent';

const DIR = import.meta.dirname;

/**
 * The screen's own source.
 *
 * `apps/web` runs its unit tests without a DOM, so a screen's behavioural rules
 * are asserted on the source that states them, exactly as the generate and
 * capture screens' specs do. What the rendered list actually says is proved in
 * the browser, by `e2e/tests/parent-practice-test.spec.ts`.
 */
const PAGE_SOURCE = readFileSync(path.resolve(DIR, 'page.tsx'), 'utf8');

describe('the pending drafts list', () => {
  it('joins the child name here, from the read every Parent View surface makes', () => {
    // `practicetest` does not read an identity table (AD-17), so its rows carry
    // a profile id and the name is joined from the Student Profile read.
    expect(PAGE_SOURCE).toContain('parentApi.practiceTestDrafts(token)');
    expect(PAGE_SOURCE).toContain('parentApi.students(token)');
    expect(PAGE_SOURCE).toContain('profiles.find((profile) => profile.id === studentProfileId)');
    expect(PAGE_SOURCE).toContain('parentCopy.drafts.unknownStudent');
  });

  it('settles the two reads independently, so a failed name join keeps the list', () => {
    // The drafts read is the screen; the profile read only puts a name on each
    // row. One `Promise.all` would blank a list that came back perfectly well
    // because a name could not be looked up — and would make the neutral
    // stand-in unreachable, since drafts-without-profiles would also be an
    // error.
    expect(PAGE_SOURCE).not.toContain('Promise.all([');
    // Only the drafts read sets the screen's error.
    expect(PAGE_SOURCE).toContain('parentCopy.drafts.listFailed');
    expect(PAGE_SOURCE).toContain('applyIfCurrent(current.current, issued, setProfiles)');
    // An expiry is the one failure the profile read still acts on.
    expect(PAGE_SOURCE).toContain('if (endsParentView(cause)) leave();');
  });

  it('never claims there are none waiting when the read did not answer', () => {
    // "Not loading" is also what a failed read leaves behind. Without a
    // separate flag the error alert and "there are none waiting" would render
    // together, one of them untrue.
    expect(PAGE_SOURCE).toContain('const [loaded, setLoaded] = useState(false)');
    expect(PAGE_SOURCE).toContain('setLoaded(false)');
    expect(PAGE_SOURCE).toContain('setLoaded(true)');
    expect(PAGE_SOURCE).toContain('loaded && (');
  });

  it('puts list semantics back where the style strips them', () => {
    // `listStyle: 'none'` drops list semantics in Safari/VoiceOver, and the
    // item count with them — exactly what a parent scanning what is waiting
    // needs announced. `PageStrip.tsx` does the same by hand.
    expect(PAGE_SOURCE).toContain('role="list"');
    expect(PAGE_SOURCE).toContain('role="listitem"');
  });

  it('states "draft N of M" from the server figures rather than counting rows', () => {
    // The browser holds this page of drafts, not the job. Counting here would
    // be a different number the moment a sibling is discarded.
    expect(PAGE_SOURCE).toContain('parentCopy.drafts.position(draft.ordinal, draft.siblingCount)');
    expect(PAGE_SOURCE).not.toContain('drafts.length,');
  });

  it('renders an empty list as a sentence, not as a failure', () => {
    expect(PAGE_SOURCE).toContain('drafts.length === 0');
    expect(PAGE_SOURCE).toContain('parentCopy.drafts.empty');
  });

  it('links each draft by its own id, which is the whole review position', () => {
    // Nothing is stored: the address bar is where a returning parent, a reload
    // and an idle expiry all resume from.
    expect(PAGE_SOURCE).toContain('function draftHref(practiceTestId: string)');
    expect(PAGE_SOURCE).toContain('href={draftHref(draft.id)}');
    expect(PAGE_SOURCE).not.toContain('localStorage');
    expect(PAGE_SOURCE).not.toContain('sessionStorage');
  });

  it('navigates client-side, so the in-memory elevation bearer survives', () => {
    expect(PAGE_SOURCE).toContain("'use client'");
    expect(PAGE_SOURCE).toContain('component={DraftLink}');
    expect(PAGE_SOURCE).toContain('component={NextLink}');
  });

  it('sends a parent with no token in memory back to the PIN', () => {
    expect(PAGE_SOURCE).toContain("router.replace('/parent/pin')");
    expect(PAGE_SOURCE).toContain('endsParentView(cause)');
  });

  it('applies only the newest response', () => {
    // A stale in-flight read superseded by Retry must not resolve afterwards
    // and overwrite fresher state.
    expect(PAGE_SOURCE).toContain('applyIfCurrent(');
    expect(PAGE_SOURCE).toContain('requestId.current += 1');
  });

  it('names no allowance, cost, tier or model', () => {
    // Nothing is being spent on this screen, so no figure about spending
    // belongs on it.
    expect(PAGE_SOURCE).not.toContain('allowance');
    expect(PAGE_SOURCE).not.toContain('Allowance');
    expect(PAGE_SOURCE).not.toContain('gpt-');
  });

  it('offers no control that changes a draft', () => {
    // Editing is Story 4.4's, release and discard 4.5's, the timer 4.6's. The
    // list reads and links, and does nothing else.
    for (const forbidden of ['TextField', 'onSubmit', 'Checkbox', 'method:']) {
      expect(PAGE_SOURCE).not.toContain(forbidden);
    }
    expect(PAGE_SOURCE.match(/parentApi\.\w+/g)).toEqual([
      'parentApi.practiceTestDrafts',
      'parentApi.students',
    ]);
  });
});

describe('its copy', () => {
  it('is parameterized, with no literal in the component', () => {
    expect(PAGE_SOURCE).toContain('parentCopy.drafts.listTitle');
    expect(PAGE_SOURCE).toContain('parentCopy.drafts.listIntro');
    // The stored column here, and rightly: this screen renders no questions,
    // so it has nothing of its own to count.
    expect(PAGE_SOURCE).toContain('parentCopy.drafts.questionTotal(draft.questionCount)');
  });

  it('states the position with both figures it was handed', () => {
    expect(parentCopy.drafts.position(2, 3)).toBe('Draft 2 of 3');
  });

  it('speaks in the third person about the student', () => {
    expect(parentCopy.drafts.forStudent('Noah')).toBe('For Noah');
    expect(parentCopy.drafts.listIntro).not.toContain('your');
  });
});
