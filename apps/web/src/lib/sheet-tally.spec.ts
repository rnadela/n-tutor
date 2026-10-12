import { describe, expect, it } from 'vitest';
import { isSettled } from './practice-test-count';
import { sheetStates } from './sheet-tally';

describe('which sheet is which, while a job runs', () => {
  it('puts the first sheet in hand the moment the job starts', () => {
    expect(sheetStates({ producedCount: 0, requestedCount: 5, status: 'Running' })).toEqual([
      'making',
      'waiting',
      'waiting',
      'waiting',
      'waiting',
    ]);
  });

  it('marks what landed, what is in hand and what is still to come', () => {
    // The likeliest defect in this module is an off-by-one on the `making`
    // index, so the boundary is pinned on both sides of it.
    expect(sheetStates({ producedCount: 3, requestedCount: 5, status: 'Running' })).toEqual([
      'ready',
      'ready',
      'ready',
      'making',
      'waiting',
    ]);
  });

  it('treats a queued job exactly as a running one', () => {
    // Queued is not settled, and a parent who has just confirmed has no way to
    // tell the two apart — nor any reason to.
    expect(sheetStates({ producedCount: 0, requestedCount: 2, status: 'Queued' })).toEqual([
      'making',
      'waiting',
    ]);
  });
});

describe('what the tally says once the job is over', () => {
  it('shows every sheet ready when the job succeeded in full', () => {
    expect(sheetStates({ producedCount: 5, requestedCount: 5, status: 'Succeeded' })).toEqual([
      'ready',
      'ready',
      'ready',
      'ready',
      'ready',
    ]);
  });

  it('shows the shortfall as not made when the job partially completed', () => {
    expect(
      sheetStates({ producedCount: 3, requestedCount: 5, status: 'PartiallyComplete' }),
    ).toEqual(['ready', 'ready', 'ready', 'notMade', 'notMade']);
  });

  it('shows nothing made when the job failed with nothing landed', () => {
    expect(sheetStates({ producedCount: 0, requestedCount: 3, status: 'Failed' })).toEqual([
      'notMade',
      'notMade',
      'notMade',
    ]);
  });

  it('never leaves a sheet waiting on a job that has finished', () => {
    // A `Succeeded` job short of its request is the trap: the status says the
    // run is over, so the remaining sheets are not still coming.
    const states = sheetStates({ producedCount: 1, requestedCount: 3, status: 'Succeeded' });
    expect(states).toEqual(['ready', 'notMade', 'notMade']);
    expect(states).not.toContain('waiting');
    expect(states).not.toContain('making');
  });

  it('settles on the generation rule rather than a list of its own', () => {
    // The predicate this module agrees with, named here so a second list of
    // statuses cannot drift away from it — `PartiallyComplete` is the one that
    // the extraction-side predicate does not know.
    expect(isSettled('PartiallyComplete')).toBe(true);
    expect(isSettled('Running')).toBe(false);
  });
});

describe('the figures this browser cannot reconcile', () => {
  it('renders no row at all for a request of none', () => {
    expect(sheetStates({ producedCount: 0, requestedCount: 0, status: 'Running' })).toEqual([]);
  });

  it('clamps the row to what was requested, however many were produced', () => {
    // Four sheets for a request of two is a row that contradicts the sentence
    // beneath it.
    expect(sheetStates({ producedCount: 4, requestedCount: 2, status: 'Succeeded' })).toEqual([
      'ready',
      'ready',
    ]);
  });

  it('survives negative and fractional figures without inventing sheets', () => {
    expect(sheetStates({ producedCount: -3, requestedCount: 2, status: 'Running' })).toEqual([
      'making',
      'waiting',
    ]);
    expect(sheetStates({ producedCount: 0, requestedCount: -1, status: 'Running' })).toEqual([]);
    expect(sheetStates({ producedCount: 1.9, requestedCount: 3.9, status: 'Running' })).toEqual([
      'ready',
      'making',
      'waiting',
    ]);
  });

  it('draws no row at all for an infinite request, rather than throwing', () => {
    // `Array.from({ length: Infinity })` is a `RangeError`, and an exception
    // thrown here takes the whole progress panel down — the sentence, the
    // advice to stay and the way on to the drafts with it.
    expect(() =>
      sheetStates({ producedCount: 0, requestedCount: Infinity, status: 'Running' }),
    ).not.toThrow();
    expect(sheetStates({ producedCount: 0, requestedCount: Infinity, status: 'Running' })).toEqual(
      [],
    );
  });

  it('treats a produced count that is not a number as none produced', () => {
    // Both index comparisons lose against `NaN`, so an unguarded rule would
    // draw a running job as every sheet still to come — and put the spinner on
    // none of them, which is the one thing this story exists to prevent.
    const states = sheetStates({ producedCount: NaN, requestedCount: 3, status: 'Running' });
    expect(states).toEqual(['making', 'waiting', 'waiting']);
    expect(states.filter((state) => state === 'making')).toHaveLength(1);
  });
});
