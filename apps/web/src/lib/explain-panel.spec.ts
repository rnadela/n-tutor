import { describe, expect, it } from 'vitest';
import { explainDecision, type ExplainState } from './explain-panel';

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
};

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

  it('re-asks after an offline press once the connection is back', () => {
    expect(explainDecision({ online: true, state: { kind: 'offline' } })).toBe('request');
  });
});
