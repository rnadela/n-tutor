import { describe, expect, it } from 'vitest';
import {
  ATTEMPT_STATE_TTL_MS,
  attemptKey,
  clearAll,
  clearAttemptState,
  memoryAttemptStorage,
  readAttemptState,
  retainOnly,
  writeAttemptState,
  type AttemptStorage,
} from './attempt-store';

const PROFILE = 'profile-a';
const SIBLING = 'profile-b';
const ATTEMPT = 'attempt-1';

/** A storage whose every accessor throws, the way a blocked one does. */
function hostileStorage(): AttemptStorage {
  return {
    get length(): number {
      throw new Error('site data is blocked');
    },
    key: () => {
      throw new Error('site data is blocked');
    },
    getItem: () => {
      throw new Error('site data is blocked');
    },
    setItem: () => {
      throw new Error('site data is blocked');
    },
    removeItem: () => {
      throw new Error('site data is blocked');
    },
  };
}

describe('holding a child’s answers across a reload', () => {
  it('returns every answer and the place in the test, exactly as written', () => {
    const storage = memoryAttemptStorage();
    writeAttemptState(
      storage,
      PROFILE,
      ATTEMPT,
      { answers: { 'q-1': '3/4', 'q-2': 'one half' }, index: 2, pendingSubmitAt: null },
      1_000,
    );

    const read = readAttemptState(storage, PROFILE, ATTEMPT, 2_000);
    expect(read).not.toBeNull();
    expect(read!.answers).toEqual({ 'q-1': '3/4', 'q-2': 'one half' });
    expect(read!.index).toBe(2);
    expect(read!.pendingSubmitAt).toBeNull();
    // The raw string is what was typed, untouched: nothing here parses a fraction.
    expect(read!.answers['q-1']).toBe('3/4');
  });

  it('never moves the TTL’s start, however many times it is saved', () => {
    const storage = memoryAttemptStorage();
    writeAttemptState(
      storage,
      PROFILE,
      ATTEMPT,
      { answers: {}, index: 0, pendingSubmitAt: null },
      1_000,
    );
    // An hour of steady typing. A save that reset `createdAt` would turn an
    // actively used record into one no clock ever reaches.
    for (const at of [10_000, 100_000, 3_600_000]) {
      writeAttemptState(
        storage,
        PROFILE,
        ATTEMPT,
        { answers: { 'q-1': 'x' }, index: 0, pendingSubmitAt: null },
        at,
      );
    }
    expect(readAttemptState(storage, PROFILE, ATTEMPT, 3_600_000)!.createdAt).toBe(1_000);
  });

  it('is gone once the work has been handed in', () => {
    const storage = memoryAttemptStorage();
    writeAttemptState(storage, PROFILE, ATTEMPT, {
      answers: { 'q-1': 'x' },
      index: 0,
      pendingSubmitAt: null,
    });
    clearAttemptState(storage, PROFILE, ATTEMPT);
    expect(readAttemptState(storage, PROFILE, ATTEMPT)).toBeNull();
    expect(storage.getItem(attemptKey(PROFILE, ATTEMPT))).toBeNull();
  });
});

describe('one device, two children', () => {
  it('hides one profile’s record from the other, and removes it on the attempt to read', () => {
    const storage = memoryAttemptStorage();
    writeAttemptState(storage, PROFILE, ATTEMPT, {
      answers: { 'q-1': 'x' },
      index: 1,
      pendingSubmitAt: null,
    });
    // The sibling's key is a different key, so they simply have nothing.
    expect(readAttemptState(storage, SIBLING, ATTEMPT)).toBeNull();

    // And a record that somehow sits under the wrong profile's key is not read: it
    // is deleted, because being wrong here means one child reading another's work.
    storage.setItem(
      attemptKey(SIBLING, ATTEMPT),
      JSON.stringify({
        createdAt: Date.now(),
        profileId: PROFILE,
        attemptId: ATTEMPT,
        answers: { 'q-1': 'x' },
        index: 1,
        pendingSubmitAt: null,
      }),
    );
    expect(readAttemptState(storage, SIBLING, ATTEMPT)).toBeNull();
    expect(storage.getItem(attemptKey(SIBLING, ATTEMPT))).toBeNull();
  });

  it('keeps the current profile’s records and drops every other on a switch', () => {
    const storage = memoryAttemptStorage();
    writeAttemptState(storage, PROFILE, 'attempt-1', {
      answers: { a: '1' },
      index: 0,
      pendingSubmitAt: null,
    });
    writeAttemptState(storage, PROFILE, 'attempt-2', {
      answers: { b: '2' },
      index: 0,
      pendingSubmitAt: null,
    });
    writeAttemptState(storage, SIBLING, 'attempt-3', {
      answers: { c: '3' },
      index: 0,
      pendingSubmitAt: null,
    });
    storage.setItem('something.else', 'not ours');

    retainOnly(storage, PROFILE);

    expect(readAttemptState(storage, PROFILE, 'attempt-1')).not.toBeNull();
    expect(readAttemptState(storage, PROFILE, 'attempt-2')).not.toBeNull();
    expect(readAttemptState(storage, SIBLING, 'attempt-3')).toBeNull();
    // Nothing outside this module's own prefix is touched.
    expect(storage.getItem('something.else')).toBe('not ours');
  });

  it('removes the other child’s record whether or not it parses', () => {
    const storage = memoryAttemptStorage();
    // Exactly the record a payload-based sweep would leave behind: unreadable, and
    // still a sibling's work sitting on the device.
    storage.setItem(attemptKey(SIBLING, 'attempt-3'), '{ not json at all');
    writeAttemptState(storage, PROFILE, 'attempt-1', {
      answers: { a: '1' },
      index: 0,
      pendingSubmitAt: null,
    });

    retainOnly(storage, PROFILE);

    expect(storage.getItem(attemptKey(SIBLING, 'attempt-3'))).toBeNull();
    expect(readAttemptState(storage, PROFILE, 'attempt-1')).not.toBeNull();
  });

  it('clears every record it owns when no profile is the right one to keep', () => {
    const storage = memoryAttemptStorage();
    writeAttemptState(storage, PROFILE, 'attempt-1', {
      answers: { a: '1' },
      index: 0,
      pendingSubmitAt: null,
    });
    writeAttemptState(storage, SIBLING, 'attempt-3', {
      answers: { c: '3' },
      index: 0,
      pendingSubmitAt: null,
    });
    storage.setItem('something.else', 'not ours');

    clearAll(storage);

    expect(readAttemptState(storage, PROFILE, 'attempt-1')).toBeNull();
    expect(readAttemptState(storage, SIBLING, 'attempt-3')).toBeNull();
    expect(storage.getItem('something.else')).toBe('not ours');
  });
});

describe('a record that is no longer usable', () => {
  it('reads as absent once it is 72 hours old, and is gone afterwards', () => {
    const storage = memoryAttemptStorage();
    writeAttemptState(
      storage,
      PROFILE,
      ATTEMPT,
      { answers: { a: '1' }, index: 0, pendingSubmitAt: null },
      0,
    );

    // A minute before the TTL it is still there.
    expect(
      readAttemptState(storage, PROFILE, ATTEMPT, ATTEMPT_STATE_TTL_MS - 60_000),
    ).not.toBeNull();

    expect(readAttemptState(storage, PROFILE, ATTEMPT, ATTEMPT_STATE_TTL_MS)).toBeNull();
    // Deleted on read: a record this function will never return again has no
    // business sitting on a child's device.
    expect(storage.getItem(attemptKey(PROFILE, ATTEMPT))).toBeNull();
  });

  it('reads malformed JSON as absent, and deletes it', () => {
    const storage = memoryAttemptStorage();
    storage.setItem(attemptKey(PROFILE, ATTEMPT), 'not json');
    expect(readAttemptState(storage, PROFILE, ATTEMPT)).toBeNull();
    expect(storage.getItem(attemptKey(PROFILE, ATTEMPT))).toBeNull();
  });

  it('reads a record of the wrong shape as absent, and deletes it', () => {
    const storage = memoryAttemptStorage();
    storage.setItem(
      attemptKey(PROFILE, ATTEMPT),
      JSON.stringify({ profileId: PROFILE, attemptId: ATTEMPT, answers: { a: 1 }, index: 0 }),
    );
    expect(readAttemptState(storage, PROFILE, ATTEMPT)).toBeNull();
    expect(storage.getItem(attemptKey(PROFILE, ATTEMPT))).toBeNull();
  });

  /**
   * A field-by-field sweep of the values JSON can hold that a `typeof` check waves
   * through. Each one is a record the screen would then act on: the worst is a `NaN`
   * latch, which is neither `null` nor a time, so it reads as **armed** and dispatches
   * an auto-submit on the next reconnect that no deadline ever asked for.
   */
  it.each([
    ['a NaN latch', { pendingSubmitAt: Number.NaN }],
    ['an infinite latch', { pendingSubmitAt: Number.POSITIVE_INFINITY }],
    ['a NaN index', { index: Number.NaN }],
    ['a negative index', { index: -1 }],
    ['a fractional index', { index: 2.5 }],
    ['a NaN creation instant', { createdAt: Number.NaN }],
  ])('reads %s as absent, and deletes it', (_name, overrides) => {
    const storage = memoryAttemptStorage();
    storage.setItem(
      attemptKey(PROFILE, ATTEMPT),
      // `JSON.stringify` writes a non-finite number as `null`, so the value is spliced
      // into the text instead: this is a record handed to us, not one we could write.
      JSON.stringify(
        {
          createdAt: 1_000,
          profileId: PROFILE,
          attemptId: ATTEMPT,
          answers: { 'q-1': '3/4' },
          index: 0,
          pendingSubmitAt: null,
          ...overrides,
        },
        (_key, value) => (typeof value === 'number' && !Number.isFinite(value) ? '__bad__' : value),
      ).replace(/"__bad__"/gu, 'NaN'),
    );
    expect(readAttemptState(storage, PROFILE, ATTEMPT, 1_000)).toBeNull();
    expect(storage.getItem(attemptKey(PROFILE, ATTEMPT))).toBeNull();
  });

  it('keeps a zero index and a zero latch, which are both legitimate', () => {
    const storage = memoryAttemptStorage();
    writeAttemptState(storage, PROFILE, ATTEMPT, {
      answers: {},
      index: 0,
      pendingSubmitAt: 0,
    });
    const read = readAttemptState(storage, PROFILE, ATTEMPT);
    // Zero is the first Question and the epoch, not "absent". A guard written as a
    // falsiness check rather than a finiteness one would throw both away.
    expect(read?.index).toBe(0);
    expect(read?.pendingSubmitAt).toBe(0);
  });
});

describe('a storage that is not there, or will not co-operate', () => {
  it('never throws out of any function when every accessor throws', () => {
    const storage = hostileStorage();
    expect(() => readAttemptState(storage, PROFILE, ATTEMPT)).not.toThrow();
    expect(readAttemptState(storage, PROFILE, ATTEMPT)).toBeNull();
    expect(() =>
      writeAttemptState(storage, PROFILE, ATTEMPT, {
        answers: { a: '1' },
        index: 0,
        pendingSubmitAt: null,
      }),
    ).not.toThrow();
    expect(() => clearAttemptState(storage, PROFILE, ATTEMPT)).not.toThrow();
    expect(() => retainOnly(storage, PROFILE)).not.toThrow();
    expect(() => clearAll(storage)).not.toThrow();
  });

  it('still hands a write back, so a keystroke is never dropped on a failed save', () => {
    // This is what "degrades to in-memory answers" rests on: the caller holds what
    // it was given rather than reading back a store that refused to keep it.
    const state = writeAttemptState(hostileStorage(), PROFILE, ATTEMPT, {
      answers: { 'q-1': '3/4' },
      index: 3,
      pendingSubmitAt: null,
    });
    expect(state.answers).toEqual({ 'q-1': '3/4' });
    expect(state.index).toBe(3);
  });

  it('answers for a caller holding no storage at all', () => {
    expect(readAttemptState(null, PROFILE, ATTEMPT)).toBeNull();
    expect(() => clearAttemptState(null, PROFILE, ATTEMPT)).not.toThrow();
    expect(() => retainOnly(null, PROFILE)).not.toThrow();
    expect(() => clearAll(null)).not.toThrow();
    expect(
      writeAttemptState(null, PROFILE, ATTEMPT, {
        answers: { a: '1' },
        index: 0,
        pendingSubmitAt: null,
      }).answers,
    ).toEqual({ a: '1' });
  });
});

describe('what the record says about the work', () => {
  it('says nothing about being right', () => {
    const state = writeAttemptState(memoryAttemptStorage(), PROFILE, ATTEMPT, {
      answers: { 'q-1': '3/4' },
      index: 0,
      pendingSubmitAt: null,
    });
    // No grade, no score, no correctness, no verdict — not in this story and not
    // in this store. A key here would be a column two stories could disagree about.
    expect(Object.keys(state).sort()).toEqual([
      'answers',
      'attemptId',
      'createdAt',
      'index',
      'pendingSubmitAt',
      'profileId',
    ]);
  });
});
