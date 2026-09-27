import { describe, expect, it } from 'vitest';
import { memoryAttemptStorage, readAttemptState, writeAttemptState } from './attempt-store';
import { armPending, submitDecision, takePending } from './attempt-submit';

const PROFILE = 'profile-a';
const ATTEMPT = 'attempt-1';

describe('what a press of Hand in should do', () => {
  it('sends while there is a connection', () => {
    expect(submitDecision({ online: true, expiredAt: null, submitted: false })).toBe('send');
  });

  it('refuses plainly while offline with time still on the clock', () => {
    // The Attempt stays open and the control stays live: the child presses again.
    expect(submitDecision({ online: false, expiredAt: null, submitted: false })).toBe(
      'refuse-offline',
    );
  });

  it('waits for the connection once the deadline has passed offline', () => {
    expect(submitDecision({ online: false, expiredAt: 1_000, submitted: false })).toBe(
      'wait-for-online',
    );
  });

  it('sends on the next connection after an expiry', () => {
    expect(submitDecision({ online: true, expiredAt: 1_000, submitted: false })).toBe('send');
  });

  it('sends nothing at all once the work is in, whatever the network says', () => {
    // A second dispatch answers 409 and would tell a child their handed-in work
    // failed. Being in is being in.
    for (const online of [true, false]) {
      for (const expiredAt of [null, 1_000]) {
        expect(submitDecision({ online, expiredAt, submitted: true })).toBe('already-submitted');
      }
    }
  });
});

describe('the pending-submit latch', () => {
  it('survives a reload, because it lives in the Attempt’s own record', () => {
    const storage = memoryAttemptStorage();
    writeAttemptState(storage, PROFILE, ATTEMPT, {
      answers: { 'q-1': '3/4' },
      index: 1,
      pendingSubmitAt: null,
    });
    armPending(storage, PROFILE, ATTEMPT, 5_000);

    // Read back the way a fresh page load reads it.
    const reloaded = readAttemptState(storage, PROFILE, ATTEMPT);
    expect(reloaded!.pendingSubmitAt).toBe(5_000);
    // And arming did not cost the child their answers or their place.
    expect(reloaded!.answers).toEqual({ 'q-1': '3/4' });
    expect(reloaded!.index).toBe(1);
  });

  it('empties itself in the act of being read, so two online events dispatch once', () => {
    const storage = memoryAttemptStorage();
    armPending(storage, PROFILE, ATTEMPT, 5_000);

    expect(takePending(storage, PROFILE, ATTEMPT)).toBe(5_000);
    // The second `online` event, the re-render, the reload that raced the first:
    // all of them get nothing, so all of them dispatch nothing.
    expect(takePending(storage, PROFILE, ATTEMPT)).toBeNull();
    expect(takePending(storage, PROFILE, ATTEMPT)).toBeNull();
  });

  it('keeps the answers when the latch is taken', () => {
    const storage = memoryAttemptStorage();
    writeAttemptState(storage, PROFILE, ATTEMPT, {
      answers: { 'q-1': '3/4', 'q-2': 'one half' },
      index: 2,
      pendingSubmitAt: null,
    });
    armPending(storage, PROFILE, ATTEMPT, 5_000);
    takePending(storage, PROFILE, ATTEMPT);

    // Every answer entered before the outage is still there to be sent.
    const after = readAttemptState(storage, PROFILE, ATTEMPT);
    expect(after!.answers).toEqual({ 'q-1': '3/4', 'q-2': 'one half' });
    expect(after!.index).toBe(2);
  });

  it('is empty when nothing armed it', () => {
    const storage = memoryAttemptStorage();
    expect(takePending(storage, PROFILE, ATTEMPT)).toBeNull();
    writeAttemptState(storage, PROFILE, ATTEMPT, { answers: {}, index: 0, pendingSubmitAt: null });
    expect(takePending(storage, PROFILE, ATTEMPT)).toBeNull();
  });

  it('arms once however many times it is armed', () => {
    const storage = memoryAttemptStorage();
    armPending(storage, PROFILE, ATTEMPT, 5_000);
    armPending(storage, PROFILE, ATTEMPT, 6_000);
    // Overwritten, never queued: one latch means one dispatch.
    expect(takePending(storage, PROFILE, ATTEMPT)).toBe(6_000);
    expect(takePending(storage, PROFILE, ATTEMPT)).toBeNull();
  });

  it('never throws on a storage that will not co-operate', () => {
    expect(() => armPending(null, PROFILE, ATTEMPT, 5_000)).not.toThrow();
    expect(takePending(null, PROFILE, ATTEMPT)).toBeNull();
  });

  it('does not re-arm itself after a take', () => {
    // A dispatch that fails leaves the Attempt open and says so. The next attempt
    // is a person's press or the next `online` transition — never this module's own
    // doing, which is what "never silently retried" means.
    const storage = memoryAttemptStorage();
    armPending(storage, PROFILE, ATTEMPT, 5_000);
    takePending(storage, PROFILE, ATTEMPT);
    expect(readAttemptState(storage, PROFILE, ATTEMPT)!.pendingSubmitAt).toBeNull();
  });
});
