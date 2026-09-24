import { describe, expect, it } from 'vitest';
import { canAddPage, canMoveDown, canMoveUp, canSubmitPages, movedOrder } from './page-order';

const IDS = ['a', 'b', 'c'];

describe('movedOrder', () => {
  it('moves a middle page up by one place', () => {
    expect(movedOrder(IDS, 'b', 'up')).toEqual(['b', 'a', 'c']);
  });

  it('moves a middle page down by one place', () => {
    expect(movedOrder(IDS, 'b', 'down')).toEqual(['a', 'c', 'b']);
  });

  it('is a no-op moving the first page up', () => {
    expect(movedOrder(IDS, 'a', 'up')).toEqual(IDS);
  });

  it('is a no-op moving the last page down', () => {
    expect(movedOrder(IDS, 'c', 'down')).toEqual(IDS);
  });

  it('is a no-op for an id that is not on the strip', () => {
    expect(movedOrder(IDS, 'z', 'up')).toEqual(IDS);
    expect(movedOrder(IDS, 'z', 'down')).toEqual(IDS);
  });

  it('is a no-op on a single page, in either direction', () => {
    expect(movedOrder(['only'], 'only', 'up')).toEqual(['only']);
    expect(movedOrder(['only'], 'only', 'down')).toEqual(['only']);
  });

  it('never mutates the order it was handed', () => {
    const ids = [...IDS];
    movedOrder(ids, 'b', 'up');
    expect(ids).toEqual(IDS);
  });

  it('returns a permutation of exactly the ids given, every time', () => {
    for (const id of IDS) {
      for (const direction of ['up', 'down'] as const) {
        expect([...movedOrder(IDS, id, direction)].sort()).toEqual([...IDS].sort());
      }
    }
  });

  it('walks a page from the end to the front one move at a time', () => {
    let order = [...IDS];
    order = movedOrder(order, 'c', 'up');
    expect(order).toEqual(['a', 'c', 'b']);
    order = movedOrder(order, 'c', 'up');
    expect(order).toEqual(['c', 'a', 'b']);
    // And stops there rather than wrapping around.
    expect(movedOrder(order, 'c', 'up')).toEqual(['c', 'a', 'b']);
  });
});

describe('the controls at the ends', () => {
  it('disables move-up on the first page and move-down on the last', () => {
    expect(canMoveUp(0)).toBe(false);
    expect(canMoveUp(1)).toBe(true);
    expect(canMoveDown(IDS.length - 1, IDS.length)).toBe(false);
    expect(canMoveDown(0, IDS.length)).toBe(true);
  });

  it('disables both on a strip of one', () => {
    expect(canMoveUp(0)).toBe(false);
    expect(canMoveDown(0, 1)).toBe(false);
  });
});

describe('canSubmitPages', () => {
  it('refuses zero pages and admits one', () => {
    expect(canSubmitPages(0)).toBe(false);
    expect(canSubmitPages(1)).toBe(true);
  });
});

describe('canAddPage', () => {
  it('admits pages below the ceiling the API states, and refuses at it', () => {
    expect(canAddPage(0, 10)).toBe(true);
    expect(canAddPage(9, 10)).toBe(true);
    expect(canAddPage(10, 10)).toBe(false);
    // The ceiling is a parameter, never a figure this module owns.
    expect(canAddPage(3, 3)).toBe(false);
  });
});
