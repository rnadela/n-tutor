import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parentCopy } from '@/copy/parent';

const DIR = import.meta.dirname;

/**
 * The screen's own source.
 *
 * `apps/web` runs its unit tests without a DOM, so a screen's behavioural rules
 * — that it polls, that it reads the server rather than advancing a counter of
 * its own, that it never removes an unaffordable count — are asserted on the
 * source it states them in, exactly as `capture/page.spec.tsx` does. The rules
 * that *can* be stated as pure functions are in `practice-test-count.ts` and
 * are tested as functions there; this file covers only what a rendered control
 * would otherwise be the sole home of.
 */
const PAGE_SOURCE = readFileSync(path.resolve(DIR, 'page.tsx'), 'utf8');

describe('the count picker', () => {
  it('renders every count and disables the ones that cannot be afforded', () => {
    // Never trimmed: a list that silently shrinks tells a parent five was never
    // offered, rather than that five costs more than they have left.
    expect(PAGE_SOURCE).toContain('countOptions(allowance.remaining, allowance.maxPerRequest)');
    expect(PAGE_SOURCE).toContain(
      'disabled={!option.available || starting || refreshingAllowance}',
    );
    expect(PAGE_SOURCE).not.toContain('options.filter');
  });

  it('states the reason once for the group, and ties every disabled radio to it', () => {
    // A disabled radio is not focusable, so a reason rendered beside it is
    // unreachable by keyboard and never announced — while a sighted reader
    // sees the same sentence repeated up to five times.
    expect(PAGE_SOURCE).toContain('parentCopy.generate.countUnavailable(allowance.remaining)');
    expect(PAGE_SOURCE).toContain('id={COUNT_REASON_ID}');
    expect(PAGE_SOURCE).toContain("'aria-describedby': COUNT_REASON_ID");
    expect(PAGE_SOURCE).toContain('options.some((option) => !option.available)');
  });

  it('re-reads what is left once a job settles', () => {
    // The reading taken on mount describes the account before the job spent
    // anything; left alone the picker would offer counts it can no longer
    // afford.
    expect(PAGE_SOURCE).toContain('if (token === null || jobId === null || !jobSettled) return;');
    expect(PAGE_SOURCE).toContain('parentApi.generationAllowance(token).then(');
  });

  it('locks the picker while the post-settle allowance re-read is in flight', () => {
    // Between a job settling and the re-read resolving, the picker would
    // otherwise still reflect the pre-charge allowance for one render — this
    // is what keeps it from being tapped during that window.
    expect(PAGE_SOURCE).toContain('setRefreshingAllowance(true);');
    expect(PAGE_SOURCE).toContain('setRefreshingAllowance(false);');
    expect(PAGE_SOURCE).toContain('disabled={count === null || starting || refreshingAllowance}');
  });

  it('holds no ceiling, limit or tier figure of its own', () => {
    // Every figure is the API's. A number literal used as a count here would be
    // a second place to recalibrate.
    expect(PAGE_SOURCE).toContain('allowance.maxPerRequest');
    expect(PAGE_SOURCE).not.toMatch(/maxPerRequest\s*=\s*\d/);
    expect(PAGE_SOURCE).not.toContain("'Free'");
    expect(PAGE_SOURCE).not.toContain('gpt-');
  });

  it('meets the parent tap-target floor from the density token', () => {
    expect(PAGE_SOURCE).toContain('minHeight: density.tapTarget');
  });
});

describe('the cost statement', () => {
  it('is on screen before the confirm control is reachable', () => {
    // The picker's cost line is rendered from the same sentence the dialog
    // restates, so the figure cannot differ between the two.
    expect(PAGE_SOURCE).toContain('data-testid="generate-cost"');
    expect(PAGE_SOURCE).toContain('data-testid="generate-confirm-cost"');
    expect(PAGE_SOURCE).toContain('{costSentence}');
  });

  it('names what the action spends and what is left', () => {
    const sentence = parentCopy.generate.cost(2, 3);
    expect(sentence).toContain('2 practice tests');
    expect(sentence).toContain('3 will be left');
    // Denominated in practice tests, never in credits or an abstract unit.
    expect(sentence).not.toMatch(/credit|token|unit/i);
  });

  it('states no remainder at all on an unlimited tier', () => {
    const sentence = parentCopy.generate.costUnlimited(2);
    expect(sentence).toContain('unlimited');
    expect(sentence).not.toMatch(/\d+ will be left/);
  });

  it('is the unlimited sentence exactly when there is no remainder to state', () => {
    expect(PAGE_SOURCE).toContain('after === null');
    expect(PAGE_SOURCE).toContain('parentCopy.generate.costUnlimited(count)');
  });
});

describe('the progress view', () => {
  it('reads the job from the server on every tick rather than counting locally', () => {
    expect(PAGE_SOURCE).toContain('parentApi.generationJob(token, sourceTestId)');
    expect(PAGE_SOURCE).toContain('setTimeout(read, GENERATION_POLL_MS)');
    // No local increment anywhere: the produced count is the job's own.
    expect(PAGE_SOURCE).not.toMatch(/producedCount\s*\+\s*1/);
  });

  it('guards every applied response with the request-id rule', () => {
    // A superseded read resolving late must not overwrite fresher state.
    expect(PAGE_SOURCE).toContain('applyIfCurrent(current.current, issued');
    expect(PAGE_SOURCE).toContain('requestId.current += 1');
  });

  it('stops polling on an error and offers a retry rather than hammering', () => {
    expect(PAGE_SOURCE).toContain('parentCopy.generate.progressFailed');
    expect(PAGE_SOURCE).toContain('onClick={retry}');
  });

  it('treats only a 404 as "nothing requested yet"', () => {
    // A 500, a timeout or a dropped connection is not that, and swallowing it
    // would show the picker for an upload that may already have a job running.
    expect(PAGE_SOURCE).toContain(
      'if (cause instanceof ParentApiError && cause.status === 404) return null;',
    );
    expect(PAGE_SOURCE).toContain('throw cause;');
  });

  it('stops polling once the job has settled, partial success included', () => {
    expect(PAGE_SOURCE).toContain('!isSettled(view.status)');
    expect(PAGE_SOURCE).toContain('jobSettled');
  });

  it('advises staying without ever claiming work would be lost', () => {
    const stay = parentCopy.generate.stayHere;
    expect(stay).toContain('Leaving does not stop the work');
    // The sentence that would be false, and would contradict both
    // retry-without-re-upload and charge-on-land.
    expect(stay).not.toMatch(/lose|lost/i);
  });

  it('says a partial result kept and charged only what was made', () => {
    const partial = parentCopy.generate.partial(3, 5);
    expect(partial).toContain('3 of 5');
    expect(partial).toContain('Only the ones that were made used the Generation Allowance.');
  });

  it('says a total failure charged nothing and needs no new photos', () => {
    expect(parentCopy.generate.failed).toContain('nothing was used');
    expect(parentCopy.generate.retryFree).toContain('no new photos');
  });
});

describe('announcements', () => {
  it('announces each outcome in exactly the words it displays', () => {
    // The same copy function feeds the live region and the visible line, so
    // the two cannot drift apart (UX-DR33).
    expect(PAGE_SOURCE).toContain('announce(parentCopy.generate.done(producedCount))');
    expect(PAGE_SOURCE).toContain(
      'announce(parentCopy.generate.partial(producedCount, requestedCount))',
    );
    expect(PAGE_SOURCE).toContain('announce(parentCopy.generate.failed)');
    // Through the surface's one region rather than a second one of its own:
    // two status regions make "the region on this screen" ambiguous.
    expect(PAGE_SOURCE).toContain('useAnnounce()');
    expect(PAGE_SOURCE).not.toContain('role="status"');
  });
});

describe('refusals the API authored', () => {
  it("shows the server's own reason rather than this screen's generic one", () => {
    // Each 409 sentence — nothing left of the allowance, nothing usable to
    // generate from, an upload not finished being read — is written once, in
    // the API's policy file. Restating them here would be a second copy.
    expect(PAGE_SOURCE).toContain('cause instanceof ParentApiError && cause.reason !== null');
    expect(PAGE_SOURCE).toContain('return cause.reason;');
    expect(PAGE_SOURCE).toContain('messageFor(cause, parentCopy.generate.startFailed)');
  });
});

describe('the parent-view rules', () => {
  it('ends Parent View only on the elevation guard own refusal', () => {
    expect(PAGE_SOURCE).toContain('endsParentView(cause)');
    expect(PAGE_SOURCE).toContain("router.replace('/parent/pin')");
  });
});

describe('every word comes from the copy module', () => {
  it('states every one of its own words through parentCopy', () => {
    const code = PAGE_SOURCE.split('\n')
      // Comments carry prose by design; only code is checked.
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join('\n');
    for (const marker of [
      'title',
      'intro',
      'loading',
      'countLegend',
      'countOption',
      'countUnavailable',
      'usage',
      'start',
      'confirmTitle',
      'confirm',
      'cancel',
      'progressHeading',
      'stayHere',
      'retryFree',
      'retry',
    ]) {
      expect(code).toContain(`parentCopy.generate.${marker}`);
    }
    // No accessible name written as a literal: every one of them is copy.
    expect(code).not.toMatch(/(aria-label|children)=["']/);
  });
});
