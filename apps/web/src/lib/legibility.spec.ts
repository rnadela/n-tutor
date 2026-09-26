import { describe, expect, it } from 'vitest';
import { isChecked, isPageReadable, unreadablePages } from './legibility';

const CHECKED = '2026-01-01T00:00:00.000Z';

function page(ordinal: number, legibility: 'Low' | 'Medium' | 'High' | null) {
  return { ordinal, legibility };
}

describe('isChecked', () => {
  it('reads the instant alone, never a verdict', () => {
    // The whole of the third submit gate. A checked upload full of flagged
    // pages is still submittable, so nothing here may consult one.
    expect(isChecked({ legibilityCheckedAt: CHECKED })).toBe(true);
    expect(isChecked({ legibilityCheckedAt: null })).toBe(false);
  });
});

describe('isPageReadable', () => {
  it('flags Low and nothing else', () => {
    expect(isPageReadable(page(1, 'Low'))).toBe(false);
    expect(isPageReadable(page(1, 'Medium'))).toBe(true);
    expect(isPageReadable(page(1, 'High'))).toBe(true);
  });

  it('reads an unchecked page as readable rather than flagged', () => {
    // Before the check has run every page is null, and a strip that showed
    // them all as blurry would be inventing a verdict nothing produced.
    expect(isPageReadable(page(1, null))).toBe(true);
  });
});

describe('unreadablePages', () => {
  it('names the flagged ordinals in page order', () => {
    expect(
      unreadablePages([page(1, 'High'), page(2, 'Low'), page(3, 'Medium'), page(4, 'Low')]),
    ).toEqual([2, 4]);
  });

  it('is empty when every page reads clearly', () => {
    expect(unreadablePages([page(1, 'High'), page(2, 'Medium')])).toEqual([]);
  });

  it('is empty before the check has run', () => {
    expect(unreadablePages([page(1, null), page(2, null)])).toEqual([]);
  });

  it('is empty for an upload with no pages', () => {
    expect(unreadablePages([])).toEqual([]);
  });
});
