import { describe, expect, it } from 'vitest';
import { EXTRACTION_POLL_MS, isSettled, warningNeeded } from './extraction-status';
import type { ExtractionStatusView } from './parent-api';

function view(overrides: Partial<ExtractionStatusView> = {}): ExtractionStatusView {
  return {
    status: 'Succeeded',
    pageCount: 3,
    questionCount: 4,
    usableQuestionCount: 3,
    uninterpretableRegionCount: 1,
    thin: true,
    completedAt: '2026-01-01T00:00:00.000Z',
    failureKind: null,
    failureReason: null,
    retryable: false,
    ...overrides,
  };
}

describe('isSettled', () => {
  it('is false while the job is still to run or running', () => {
    expect(isSettled('Queued')).toBe(false);
    expect(isSettled('Running')).toBe(false);
  });

  it('is true once the job has finished, either way', () => {
    expect(isSettled('Succeeded')).toBe(true);
    // A failure settles it too: polling a job that will never move again is a
    // request issued forever.
    expect(isSettled('Failed')).toBe(true);
  });
});

describe('warningNeeded', () => {
  it('gates the proceed when a succeeded Extraction is thin', () => {
    expect(warningNeeded(view({ thin: true }))).toBe(true);
  });

  it('lets a healthy Extraction through with no warning at all', () => {
    expect(warningNeeded(view({ thin: false }))).toBe(false);
  });

  it('refuses to read no-verdict-yet as thin', () => {
    // `null` is "nothing to say". Warning on it would show the counts sentence
    // with no counts behind it.
    expect(warningNeeded(view({ status: 'Queued', thin: null }))).toBe(false);
    expect(warningNeeded(view({ status: 'Running', thin: null }))).toBe(false);
  });

  it('refuses to read no-verdict-yet as healthy either, once the job settles thin', () => {
    // The same view, before and after: the gate follows the verdict, not the
    // absence of one.
    expect(warningNeeded(view({ status: 'Queued', thin: null }))).toBe(false);
    expect(warningNeeded(view({ status: 'Succeeded', thin: true }))).toBe(true);
  });

  it('never warns over a failed job, which has its own sentence to show', () => {
    expect(warningNeeded(view({ status: 'Failed', thin: null, failureReason: 'Something.' }))).toBe(
      false,
    );
  });

  it('is false before anything has been read at all', () => {
    expect(warningNeeded(null)).toBe(false);
  });
});

describe('the poll interval', () => {
  it('is a real interval rather than a busy loop', () => {
    expect(EXTRACTION_POLL_MS).toBeGreaterThanOrEqual(500);
  });
});
