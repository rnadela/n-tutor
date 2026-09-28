import { describe, expect, it } from 'vitest';
import { explainDecision, flagDecision, flaggedAtOf, type ExplainState } from './explain-panel';

/**
 * What a press means, pinned as a function.
 *
 * It is a function precisely so it can be pinned: `apps/web` runs its unit tests
 * with `environment: 'node'`, so a rule living inside an event handler could only
 * be asserted end to end, one browser round trip at a time. The rules here are the
 * ones that cost money or refuse a child when they go wrong.
 */
const LOADED: ExplainState = {
  kind: 'loaded',
  body: [{ kind: 'text', value: 'Halving six gives three.' }],
  studentFlaggedAt: null,
  replacement: false,
};

/** The same prose, already reported by this child. */
const REPORTED: ExplainState = { ...LOADED, studentFlaggedAt: '2026-09-28T10:00:00.000Z' };

/** A grown-up removed this one. The state carries nothing at all — that is the point. */
const REMOVED: ExplainState = { kind: 'suppressed' };

describe('what pressing the explain control decides', () => {
  it('asks, on a first press with a connection', () => {
    expect(explainDecision({ online: true, state: { kind: 'idle' } })).toBe('request');
  });

  it('never asks twice for prose it already holds', () => {
    // The API would answer 200 from its stored row, so a second request costs
    // nothing — but it is still a round trip nobody needs, and the guarantee that
    // re-opening is free should hold in the browser too.
    expect(explainDecision({ online: true, state: LOADED })).toBe('stored');
  });

  it('keeps showing prose it already holds when the connection drops', () => {
    // An Explanation on the page does not stop being readable offline.
    expect(explainDecision({ online: false, state: LOADED })).toBe('stored');
  });

  it('swallows a second press while a request is out', () => {
    // Two concurrent generations for one Question race the unique index, and the
    // loser would be a refusal the child did nothing to earn.
    expect(explainDecision({ online: true, state: { kind: 'loading' } })).toBe('busy');
    expect(explainDecision({ online: false, state: { kind: 'loading' } })).toBe('busy');
  });

  it('sends nothing at all with no connection', () => {
    // Distinct from a failure: "you are not connected" is a thing a child can act
    // on, and a request that cannot leave the device should not be made to.
    expect(explainDecision({ online: false, state: { kind: 'idle' } })).toBe('offline');
    expect(explainDecision({ online: false, state: { kind: 'failed' } })).toBe('offline');
  });

  it('lets a person ask again after a failure', () => {
    // The retry is a person pressing. Nothing in here ever decides to ask on its
    // own, which is why there is no `retry` arm and no attempt count.
    expect(explainDecision({ online: true, state: { kind: 'failed' } })).toBe('request');
  });

  it('lets a person ask again after a refusal at the cap', () => {
    // The period may have turned over since, and the server is the only thing that
    // can say so. A panel that latched shut would stay shut into the next period.
    expect(
      explainDecision({ online: true, state: { kind: 'atCap', limitSentence: 'No more.' } }),
    ).toBe('request');
    expect(explainDecision({ online: true, state: { kind: 'atCap', limitSentence: null } })).toBe(
      'request',
    );
  });

  it('sends nothing for a Question a grown-up has settled, whatever the connection', () => {
    // The rule this story turns on, held where it is assertable with no DOM: a press must
    // never leave the device for an explanation a parent removed. It is not a state a press
    // could improve — there is no retry that would help and no connection that would change
    // it — and the API's serve-time check is what catches the press this misses.
    expect(explainDecision({ online: true, state: REMOVED })).toBe('removed');
    expect(explainDecision({ online: false, state: REMOVED })).toBe('removed');
  });

  it('re-asks after an offline press once the connection is back', () => {
    expect(explainDecision({ online: true, state: { kind: 'offline' } })).toBe('request');
  });
});

describe('what pressing the report control decides', () => {
  it('sends it, on a first press with prose on screen and a connection', () => {
    expect(flagDecision({ online: true, state: LOADED, sending: false })).toBe('request');
  });

  it('sends nothing when there is no prose to report', () => {
    // A panel with nothing in it has nothing to be wrong. The control is only rendered
    // inside the `loaded` branch; this states the rule once instead of leaving it resting
    // on where a control happens to be drawn.
    for (const state of [
      { kind: 'idle' } as const,
      { kind: 'loading' } as const,
      { kind: 'failed' } as const,
      { kind: 'offline' } as const,
      { kind: 'suppressed' } as const,
      { kind: 'atCap', limitSentence: null } as const,
    ]) {
      expect(flagDecision({ online: true, state, sending: false })).toBe('noProse');
    }
  });

  it('sends nothing for a concern already recorded', () => {
    // **There is no un-reporting.** A record of a concern is not a toggle, and the API
    // would answer the first instant anyway — which makes the round trip one nobody needs.
    expect(flagDecision({ online: true, state: REPORTED, sending: false })).toBe('already');
  });

  it('prefers an existing report over a request still in flight', () => {
    // If nothing needs sending, nothing needs sending whatever else is out.
    expect(flagDecision({ online: true, state: REPORTED, sending: true })).toBe('already');
  });

  it('swallows a double-tap rather than starting a second request', () => {
    // Two responses landing in either order would tell a child twice that something
    // happened once.
    expect(flagDecision({ online: true, state: LOADED, sending: true })).toBe('busy');
  });

  it('sends nothing at all with no connection, and says so as its own outcome', () => {
    // Distinct from a failure, because "you are not connected" is a thing a child can
    // act on.
    expect(flagDecision({ online: false, state: LOADED, sending: false })).toBe('offline');
  });

  it('swallows a double-tap before the connection is consulted', () => {
    expect(flagDecision({ online: false, state: LOADED, sending: true })).toBe('busy');
  });
});

describe('what the removed state carries', () => {
  it('carries nothing beyond its own kind', () => {
    // Not a body, not an instant, not a reason and not a sentence of the API's: the whole of
    // what the child is told is `studentCopy`'s own two lines, and a field for anything else
    // would be somewhere a grown-up's words could arrive (AD-20, AD-26).
    expect(Object.keys(REMOVED)).toEqual(['kind']);
  });
});

describe('whether a panel is holding a replacement', () => {
  it('is a fact about prose that is on screen, and only there', () => {
    // On the `loaded` state and nowhere else, because it is a fact about what is being read.
    // A boolean and not the ordinal: "which of four" is a history the child has no use for.
    const replacement: ExplainState = { ...LOADED, replacement: true };
    expect(replacement.kind === 'loaded' && replacement.replacement).toBe(true);
    expect(LOADED.kind === 'loaded' && LOADED.replacement).toBe(false);
    expect(Object.keys(REMOVED)).not.toContain('replacement');
  });
});

describe('the report a panel is holding', () => {
  it('is the instant on the loaded state, or null', () => {
    expect(flaggedAtOf(REPORTED)).toBe('2026-09-28T10:00:00.000Z');
    expect(flaggedAtOf(LOADED)).toBeNull();
  });

  it('is null for every state that has no prose, because there is nothing to report', () => {
    for (const state of [
      { kind: 'idle' } as const,
      { kind: 'loading' } as const,
      { kind: 'failed' } as const,
      { kind: 'offline' } as const,
      { kind: 'suppressed' } as const,
      { kind: 'atCap', limitSentence: 'No allowance.' } as const,
    ]) {
      expect(flaggedAtOf(state)).toBeNull();
    }
  });
});
