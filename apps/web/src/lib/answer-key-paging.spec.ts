import { describe, expect, it } from 'vitest';
import {
  attemptHref,
  CLAIMED_SELECTOR,
  MODAL_SELECTOR,
  modalHasTheScreen,
  ordinalFromQuery,
  shouldPageOnKey,
  stepOrdinal,
  type PagingKeyPress,
} from './answer-key-paging';

/** A twelve-Question paper, which is the matrix's own example. */
const TWELVE = Array.from({ length: 12 }, (_unused, index) => index + 1);

describe('the Attempt link a Grade dispute or Explanation flag entry writes', () => {
  it('appends `?q=<ordinal>` when the Question is known', () => {
    expect(attemptHref('attempt-1', 7)).toBe('/parent/attempts/attempt-1?q=7');
  });

  it('omits the parameter entirely rather than writing `q=null`', () => {
    expect(attemptHref('attempt-1', null)).toBe('/parent/attempts/attempt-1');
    expect(attemptHref('attempt-1', null)).not.toContain('q=null');
  });
});

describe('which Question a `?q=` names', () => {
  it('opens on the first Question when there is no `q` at all', () => {
    expect(ordinalFromQuery(null, TWELVE)).toBe(1);
  });

  it('opens the Question a deep link names', () => {
    expect(ordinalFromQuery('7', TWELVE)).toBe(7);
    expect(ordinalFromQuery('12', TWELVE)).toBe(12);
  });

  it('clamps an out-of-range figure to the first Question, silently', () => {
    expect(ordinalFromQuery('99', TWELVE)).toBe(1);
    expect(ordinalFromQuery('13', TWELVE)).toBe(1);
  });

  it('clamps an empty, non-numeric or fractional `q` to the first Question', () => {
    for (const raw of ['', '   ', 'abc', '7px', '1.5', '١٢', 'NaN', 'Infinity']) {
      expect(ordinalFromQuery(raw, TWELVE)).toBe(1);
    }
  });

  it('clamps zero and a negative figure, which no ordinal ever is', () => {
    expect(ordinalFromQuery('0', TWELVE)).toBe(1);
    expect(ordinalFromQuery('-3', TWELVE)).toBe(1);
  });

  it('matches the ordinal and never the position in the array', () => {
    // A row whose stored Question could no longer be read carries `ordinal: 0` and
    // keeps its place, so positions and ordinals genuinely disagree.
    const gappy = [3, 5, 9];
    expect(ordinalFromQuery('5', gappy)).toBe(5);
    // `1` is a legal *position* and not an ordinal here, so it is clamped.
    expect(ordinalFromQuery('1', gappy)).toBe(3);
  });

  it('answers 0 for a run with no rows at all, which the caller guards', () => {
    expect(ordinalFromQuery('4', [])).toBe(0);
    expect(ordinalFromQuery(null, [])).toBe(0);
  });
});

describe('where Previous and Next stop', () => {
  it('steps one Question each way through the stored order', () => {
    expect(stepOrdinal(TWELVE, 6, 1)).toBe(7);
    expect(stepOrdinal(TWELVE, 6, -1)).toBe(5);
  });

  it('answers null at each end rather than clamping to the same Question', () => {
    // A control that stayed enabled and did nothing is a control that lies about
    // there being more paper.
    expect(stepOrdinal(TWELVE, 1, -1)).toBeNull();
    expect(stepOrdinal(TWELVE, 12, 1)).toBeNull();
  });

  it('answers null at both ends of a one-Question run', () => {
    expect(stepOrdinal([1], 1, -1)).toBeNull();
    expect(stepOrdinal([1], 1, 1)).toBeNull();
  });

  it('steps by ordinal across a gap, never by position', () => {
    const gappy = [3, 5, 9];
    expect(stepOrdinal(gappy, 3, 1)).toBe(5);
    expect(stepOrdinal(gappy, 5, 1)).toBe(9);
    expect(stepOrdinal(gappy, 9, 1)).toBeNull();
  });

  it('answers null for a Question that is not in the run', () => {
    expect(stepOrdinal(TWELVE, 99, 1)).toBeNull();
    expect(stepOrdinal([], 1, 1)).toBeNull();
  });
});

/** A plain ArrowRight on the pager itself, which every case below varies from. */
function press(overrides: Partial<PagingKeyPress> = {}): PagingKeyPress {
  return {
    key: 'ArrowRight',
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    targetTag: 'BUTTON',
    targetIsContentEditable: false,
    targetRole: '',
    ...overrides,
  };
}

describe('which key presses turn the page', () => {
  it('pages forward on ArrowRight and back on ArrowLeft', () => {
    expect(shouldPageOnKey(press(), false)).toBe(1);
    expect(shouldPageOnKey(press({ key: 'ArrowLeft' }), false)).toBe(-1);
  });

  it('ignores every other key', () => {
    for (const key of ['ArrowUp', 'ArrowDown', 'Enter', ' ', 'j', 'PageDown', 'Home', 'Tab']) {
      expect(shouldPageOnKey(press({ key }), false)).toBeNull();
    }
  });

  it('leaves the caret alone in every kind of text entry', () => {
    // A parent part-way through typing a reason must not lose what they were typing.
    for (const targetTag of ['input', 'INPUT', 'textarea', 'TextArea', 'select', 'SELECT']) {
      expect(shouldPageOnKey(press({ targetTag }), false)).toBeNull();
      expect(shouldPageOnKey(press({ key: 'ArrowLeft', targetTag }), false)).toBeNull();
    }
    expect(shouldPageOnKey(press({ targetIsContentEditable: true }), false)).toBeNull();
  });

  it('still pages when the press is aimed at something that is not text entry', () => {
    for (const targetTag of ['BUTTON', 'BODY', 'DIV', 'LI', '']) {
      expect(shouldPageOnKey(press({ targetTag }), false)).toBe(1);
    }
  });

  it('yields every held modifier to the browser', () => {
    for (const held of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey'] as const) {
      expect(shouldPageOnKey(press({ [held]: true }), false)).toBeNull();
      expect(shouldPageOnKey(press({ key: 'ArrowLeft', [held]: true }), false)).toBeNull();
    }
  });

  it('leaves the arrow keys to a widget whose own interaction they are', () => {
    // A composite control is assembled from `div`s and `li`s, where the tag name says
    // nothing: a MUI Select's open menu is a `ul role="listbox"` of `li role="option"`,
    // and one press would otherwise move the highlighted option **and** turn the paper.
    for (const targetRole of [
      'combobox',
      'listbox',
      'menu',
      'menubar',
      'menuitem',
      'menuitemcheckbox',
      'menuitemradio',
      'option',
      'radio',
      'radiogroup',
      'slider',
      'spinbutton',
      'tab',
      'tablist',
      'textbox',
      'tree',
      'treeitem',
    ]) {
      expect(shouldPageOnKey(press({ targetRole }), false), targetRole).toBeNull();
      expect(
        shouldPageOnKey(press({ key: 'ArrowLeft', targetRole }), false),
        targetRole,
      ).toBeNull();
      // And in any case, because `role` is an author-written attribute.
      expect(
        shouldPageOnKey(press({ targetRole: targetRole.toUpperCase() }), false),
        targetRole,
      ).toBeNull();
    }
  });

  it('still pages inside the roles the pager’s own markup uses', () => {
    // The rows are a `role="list"` of `role="listitem"`, each map cell sits in one, and
    // the surfaces' live regions are `role="status"`. None of those is a widget an arrow
    // key does anything inside, so a press there is still a page turn.
    for (const targetRole of ['list', 'listitem', 'status', 'alert', 'dialog', 'group', '']) {
      expect(shouldPageOnKey(press({ targetRole }), false), targetRole).toBe(1);
    }
  });

  it('does nothing at all while the overlay map is open', () => {
    // Its cells are the way to a Question while it is up, and a page turning behind
    // a modal would move the thing being chosen from.
    expect(shouldPageOnKey(press(), true)).toBeNull();
    expect(shouldPageOnKey(press({ key: 'ArrowLeft' }), true)).toBeNull();
  });
});

describe('whether something modal has the screen', () => {
  /** An element-shaped stub: it records what it was asked and answers for one selector. */
  function target(matching: string | null): {
    closest(selectors: string): unknown;
    asked: string[];
  } {
    const asked: string[] = [];
    return {
      asked,
      closest(selectors: string) {
        asked.push(selectors);
        return selectors === matching ? {} : null;
      },
    };
  }

  it('answers false for a press that is in neither a dialog nor anything hidden', () => {
    expect(modalHasTheScreen(target(null))).toBe(false);
    expect(modalHasTheScreen(null)).toBe(false);
  });

  it('answers true for a press delivered inside a modal dialog', () => {
    // A dialog that is really up traps focus, so the press lands inside it — which
    // covers the grade-override confirmation, the hand-in confirmation and the PIN
    // prompt alike, including dialogs this module has never heard of.
    expect(modalHasTheScreen(target(MODAL_SELECTOR))).toBe(true);
  });

  it('answers true for a press on a paper something else has claimed', () => {
    // `aria-hidden` or `inert` over the paper is how "something else has the screen" is
    // said in markup, and it covers an overlay that traps no focus at all.
    expect(modalHasTheScreen(target(CLAIMED_SELECTOR))).toBe(true);
  });

  it('asks about the press and never about the whole document', () => {
    // **The reason this is not a document-wide query.** Parent View's sidebar is a
    // permanently mounted MUI `Drawer` whose paper carries `role="dialog"
    // aria-modal="true"` as page furniture, so asking the document whether any modal
    // exists answers "always" on every parent screen — and arrow-key paging would be
    // dead on the whole surface.
    const asked = target(null);
    modalHasTheScreen(asked);
    expect(asked.asked).toEqual([MODAL_SELECTOR, CLAIMED_SELECTOR]);
    expect(MODAL_SELECTOR).toBe('[role="dialog"][aria-modal="true"]');
    expect(CLAIMED_SELECTOR).toBe('[aria-hidden="true"],[inert]');
  });
});
