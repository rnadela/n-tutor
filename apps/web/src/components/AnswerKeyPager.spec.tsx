import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { studentCopy } from '@/copy/student';
import { parentTheme, studentTheme } from '@/theme/theme';
import type { AnswerKeyMapLabels } from './AnswerKeyMap';
import {
  AnswerKeyPager,
  type AnswerKeyPagerItem,
  type AnswerKeyPagerLabels,
} from './AnswerKeyPager';

const LABELS: AnswerKeyPagerLabels = {
  position: studentCopy.results.pager.position,
  previous: studentCopy.results.pager.previous,
  next: studentCopy.results.pager.next,
  openMap: studentCopy.results.pager.openMap,
  closeMap: studentCopy.results.pager.closeMap,
  positionAnnouncement: studentCopy.results.pager.positionAnnouncement,
};

const MAP_LABELS: AnswerKeyMapLabels = {
  heading: studentCopy.results.pager.mapHeading,
  cellState: studentCopy.results.pager.cellState,
  cellNewlyGraded: studentCopy.results.pager.cellNewlyGraded,
  legendEntry: studentCopy.results.pager.legendEntry,
};

/** Four Questions, each rendered as a probe `li` that reports what it was handed. */
function items(count = 4): AnswerKeyPagerItem[] {
  return Array.from({ length: count }, (_unused, index) => ({
    key: `q-${index + 1}`,
    questionId: `q-${index + 1}`,
    ordinal: index + 1,
    state: 'Correct' as const,
    newlyGraded: false,
    render: ({ hidden }) =>
      createElement(
        'li',
        {
          'data-testid': 'probe-row',
          'data-ordinal': String(index + 1),
          hidden: hidden || undefined,
        },
        `row ${index + 1}`,
      ),
  }));
}

function render(
  overrides: Partial<Parameters<typeof AnswerKeyPager>[0]> = {},
  theme = studentTheme,
): string {
  return renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme },
      createElement(AnswerKeyPager, {
        items: items(),
        currentOrdinal: 2,
        onNavigate: () => {},
        announce: () => {},
        labels: LABELS,
        mapLabels: MAP_LABELS,
        ...overrides,
      }),
    ),
  );
}

/** One rendered element's opening tag, by its test id. Attributes land in MUI's order. */
function tagOf(markup: string, testId: string): string {
  const found = new RegExp(`<[a-z]+[^>]*data-testid="${testId}"[^>]*>`, 'u').exec(markup);
  expect(found, testId).not.toBeNull();
  return found![0];
}

const SOURCE = readFileSync(path.resolve(import.meta.dirname, 'AnswerKeyPager.tsx'), 'utf8');
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');

describe('one Question at a time, with every row still mounted', () => {
  it('renders every row and hides all but the one on screen', () => {
    // Slicing the array would unmount the panels, and a parent who paged away
    // mid-decision would lose it silently — including a failure message they had not
    // read yet. So all of them are mounted and all but one carry `hidden`.
    const markup = render();
    expect(markup.match(/data-testid="probe-row"/gu)).toHaveLength(4);
    expect(markup.match(/hidden=""|\shidden>/gu)).toHaveLength(3);
    const shown = markup.slice(markup.indexOf('data-ordinal="2"'));
    expect(shown.slice(0, 40)).not.toContain('hidden');
    expect(CODE).toContain('items.map(');
    expect(CODE).not.toMatch(/\.slice\(|\.filter\(|\.sort\(|toSorted/u);
  });

  it('unhides exactly one row when two of them share an ordinal', () => {
    // `AnswerKeyRowView` promises neither that the ordinals are dense nor that they are
    // distinct. Deriving `hidden` from the ordinal would unhide both, hand both one
    // heading ref, and leave the map with two current cells.
    const twins: AnswerKeyPagerItem[] = ['a', 'b'].map((key) => ({
      key,
      questionId: key,
      ordinal: 0,
      state: 'Ungraded' as const,
      newlyGraded: false,
      render: ({ hidden }) =>
        createElement('li', {
          'data-testid': 'twin-row',
          'data-key': key,
          hidden: hidden || undefined,
        }),
    }));
    const markup = render({ items: twins, currentOrdinal: 0 });
    expect(markup.match(/data-testid="twin-row"/gu)).toHaveLength(2);
    expect(markup.match(/hidden=""|\shidden>/gu)).toHaveLength(1);
    // The **first** of them, which is the one the ordinal in the URL can name.
    expect(markup).toContain('data-testid="twin-row" data-key="a"');
    expect(markup).toContain('data-testid="twin-row" data-key="b" hidden');
    // And the map marks one cell, not two.
    expect(markup.match(/aria-current="true"/gu)).toHaveLength(1);
    // The source derives it from the index and resolves the index once.
    expect(CODE).toContain('const currentIndex = items.findIndex(');
    expect(CODE).toContain('hidden: index !== currentIndex');
    expect(CODE).not.toContain('item.ordinal !== currentOrdinal');
  });

  it('hides every row and disables both controls for an ordinal no row has', () => {
    // The honest rendering of a clamp the caller has not written back yet.
    const markup = render({ currentOrdinal: 99 });
    expect(markup.match(/hidden=""|\shidden>/gu)).toHaveLength(4);
    expect(tagOf(markup, 'answer-key-previous')).toContain('disabled=""');
    expect(tagOf(markup, 'answer-key-next')).toContain('disabled=""');
    expect(markup).not.toContain('aria-current="true"');
  });

  it('gives each row its own heading ref, keyed by the row and pruned with it', () => {
    // Keyed by the row's own React key rather than by its ordinal, because two rows
    // sharing a number would otherwise share one stored heading — and a page turn would
    // focus whichever of them mounted last. Built in a memo over the keys rather than
    // cached during render, so there is no render-phase mutation and nothing to leak.
    expect(CODE).toContain('const headingRefs = useMemo(');
    expect(CODE).toContain('headingRefs.get(item.key)');
    expect(CODE).toContain('headings.current.delete(key)');
    expect(CODE).toMatch(/if \(!alive\.has\(key\)\) headings\.current\.delete\(key\);/u);
    expect(CODE).not.toMatch(/headingRefs\.current\.set/u);
  });

  it('finds the current Question by matching the ordinal, never by array position', () => {
    // A row whose stored Question could no longer be read carries `ordinal: 0`.
    const gappy: AnswerKeyPagerItem[] = [
      {
        key: 'a',
        questionId: 'a',
        ordinal: 0,
        state: 'Ungraded',
        newlyGraded: false,
        render: ({ hidden }) =>
          createElement('li', { 'data-testid': 'gap-row', hidden: hidden || undefined }),
      },
      {
        key: 'b',
        questionId: 'b',
        ordinal: 9,
        state: 'Correct',
        newlyGraded: false,
        render: ({ hidden }) =>
          createElement('li', { 'data-testid': 'real-row', hidden: hidden || undefined }),
      },
    ];
    const markup = render({ items: gappy, currentOrdinal: 9 });
    expect(markup).toContain('data-testid="gap-row" hidden');
    expect(markup).toContain(studentCopy.results.pager.position(9, 2));
    expect(CODE).toContain('items.findIndex((item) => item.ordinal === currentOrdinal)');
  });

  it('says where the reader is, from the two figures it was handed', () => {
    expect(render()).toContain(studentCopy.results.pager.position(2, 4));
    expect(render({ currentOrdinal: 4 })).toContain(studentCopy.results.pager.position(4, 4));
  });

  it('disables Previous on the first Question and Next on the last', () => {
    expect(tagOf(render({ currentOrdinal: 1 }), 'answer-key-previous')).toContain('disabled=""');
    expect(tagOf(render({ currentOrdinal: 1 }), 'answer-key-next')).not.toContain('disabled=""');
    expect(tagOf(render({ currentOrdinal: 4 }), 'answer-key-next')).toContain('disabled=""');
    expect(tagOf(render({ currentOrdinal: 4 }), 'answer-key-previous')).not.toContain(
      'disabled=""',
    );

    // And both ends are disabled on a one-Question paper.
    const only = render({ items: items(1), currentOrdinal: 1 });
    expect(only.match(/disabled=""/gu)).toHaveLength(2);
  });

  it('leaves both controls live in the middle of the paper', () => {
    const markup = render({ currentOrdinal: 2 });
    expect(tagOf(markup, 'answer-key-previous')).not.toContain('disabled=""');
    expect(tagOf(markup, 'answer-key-next')).not.toContain('disabled=""');
  });

  it('takes its tap target from the mounted surface’s density', () => {
    expect(render({}, studentTheme)).toContain('48px');
    expect(render({}, parentTheme)).toContain('44px');
    expect(CODE).toContain('theme.density.tapTarget');
  });

  it('renders the footer, visible on every Question', () => {
    const footer = createElement('p', { 'data-testid': 'footer-probe' }, 'retake');
    expect(render({ footer, currentOrdinal: 1 })).toContain('data-testid="footer-probe"');
    expect(render({ footer, currentOrdinal: 4 })).toContain('data-testid="footer-probe"');
  });

  it('restores the list semantics `listStyle: none` strips in Safari', () => {
    expect(render()).toContain('role="list"');
  });
});

describe('the rail, the overlay and what decides between them', () => {
  it('decides which form of the map is shown in CSS, never with a JS media query', () => {
    expect(CODE).toContain("display: { xs: 'none', md: 'block' }");
    expect(CODE).toContain("display: { xs: 'inline-flex', md: 'none' }");
    expect(CODE).not.toMatch(/useMediaQuery|matchMedia/u);
  });

  it('renders the rail with the results map in it, and an opener for the overlay', () => {
    const markup = render();
    expect(markup).toContain('data-testid="answer-key-map-rail"');
    expect(markup).toContain('data-testid="answer-key-map"');
    expect(markup).toContain('data-testid="answer-key-map-open"');
    expect(markup).toContain(studentCopy.results.pager.openMap);
  });

  it('builds the rail and the overlay from one map, so they cannot drift', () => {
    expect(CODE).toContain('const mapFor = (headingProvided: boolean) => (');
    expect(CODE.match(/<AnswerKeyMap/gu)).toHaveLength(1);
    expect(CODE).toContain('{mapFor(false)}');
    expect(CODE).toContain('{mapFor(true)}');
  });

  it('states the overlay’s heading once, not twice before the first cell', () => {
    // The dialog's own title is the heading; a second `h3` under it saying the identical
    // words would make a reader hear the same line twice. The rail keeps its `h3`,
    // because it has no title of its own and the row's `h4` must nest under something.
    // Exactly one heading element in the rail — the opener beside it carries the same
    // words on purpose, as Take Test's does, and a button is not a heading.
    const rail = render();
    expect(rail.match(/data-testid="answer-key-map-heading"/gu)).toHaveLength(1);
    // And the overlay is handed `headingProvided`, which is what drops the second one.
    expect(CODE).toContain('title={mapLabels.heading}');
    expect(CODE).toContain('headingProvided={headingProvided}');
    const overlay = CODE.slice(CODE.indexOf('<AppDialog'));
    expect(overlay).toContain('{mapFor(true)}');
    const railSource = CODE.slice(
      CODE.indexOf('data-testid="answer-key-map-rail"'),
      CODE.indexOf('<AppDialog'),
    );
    expect(railSource).toContain('{mapFor(false)}');
  });

  it('closes the overlay as it jumps, so the Question is not left behind a modal', () => {
    expect(CODE).toMatch(/const jumpTo = useCallback\(\s*\(index: number\) => \{/u);
    expect(CODE).toMatch(/if \(row === undefined\) return;\s*setMapOpen\(false\);/u);
    expect(CODE).toContain('onJump={jumpTo}');
    // The map hands back an index and this is the one place it becomes the ordinal the
    // URL carries, against the same list the pager pages.
    expect(CODE).toContain('onNavigate(row.ordinal)');
  });

  it('keeps the overlay closed until its own control is pressed', () => {
    // Above `md` the rail is already on screen, so raising this there would be a modal
    // duplicate of a map the reader can already see.
    expect(render()).not.toContain('data-testid="answer-key-map-close"');
    expect(CODE.match(/setMapOpen\(true\)/gu)).toHaveLength(1);
  });
});

describe('what the pager is not', () => {
  it('makes no request and holds no read', () => {
    // A page turn is a state change over data the surface already has, so the
    // one-read-per-Attempt invariant and FR-22's view-triggered retry are untouched.
    expect(CODE).not.toMatch(/parentApi|fetch\(|axios/u);
  });

  it('is not a router: the URL is the caller’s', () => {
    // `replace` rather than `push` is the caller's decision about what Back should
    // mean, and a pager with a router dependency could not be mounted in this spec.
    expect(CODE).not.toMatch(/useRouter|useSearchParams|router\./u);
    expect(CODE).toContain('onNavigate(');
  });

  it('takes `announce` rather than reaching for a live region of its own', () => {
    // The student surface announces through the app-wide provider; the parent surface
    // owns its own `role="status"` region, already shared with outcome sentences. A
    // pager that hooked one would break the other surface or clobber an outcome.
    expect(CODE).toContain('announce(labels.positionAnnouncement(currentOrdinal, total))');
    expect(CODE).not.toMatch(/useAnnounce|aria-live|role="status"/u);
    expect(render()).not.toContain('aria-live');
  });

  it('announces the same words it displays, and not on arrival', () => {
    // A screen that announced on load would narrate its own appearance, and one that
    // moved focus on load would take it off whatever the navigation pointed at.
    expect(CODE).toContain('if (arriving) return;');
    expect(CODE).toContain('settledOn.current = currentOrdinal;');
    expect(studentCopy.results.pager.positionAnnouncement(2, 4)).toBe(
      studentCopy.results.pager.position(2, 4),
    );
  });

  it('moves focus to the Question’s own heading on a turn', () => {
    expect(CODE).toContain(
      'const heading = currentKey === null ? undefined : headings.current.get(currentKey);',
    );
    expect(CODE).toContain('headingRefs.get(item.key)');
  });

  it('claims the key press only once a turn is actually taken', () => {
    // The arrow keys scroll the document by default, which would undo the caller's
    // `scroll: false` and move the Question out from under the reader. Claimed after
    // the step, so a press the rule refused — or one at either end — still does
    // whatever the browser does with it.
    expect(CODE).toMatch(
      /if \(next === null\) return;\s*event\.preventDefault\(\);\s*live\.current\.onNavigate\(next\);/u,
    );
    expect(CODE.match(/preventDefault\(\)/gu)).toHaveLength(1);
    // Not before either refusal, and not before the end-of-range check.
    const listener = CODE.slice(CODE.indexOf('function onKeyDown('));
    expect(listener.indexOf('preventDefault')).toBeGreaterThan(listener.indexOf('shouldPageOnKey'));
    expect(listener.indexOf('preventDefault')).toBeGreaterThan(listener.indexOf('stepOrdinal'));
  });

  it('refuses the key while anything modal is open, not only its own overlay', () => {
    // A grade-override confirmation, a hand-in confirmation and the PIN prompt are all
    // somebody else's dialog, and the paper must not move behind one of them.
    expect(CODE).toContain('live.current.mapOpen || modalHasTheScreen(element)');
    expect(CODE).toContain("from '@/lib/answer-key-paging'");
    // Judged from where the press landed, never by asking the document whether any
    // dialog exists: Parent View's sidebar is a permanently mounted Drawer carrying
    // `role="dialog" aria-modal="true"`, so the global question answers "always" there.
    expect(CODE).not.toMatch(/document\.querySelector/u);
  });

  it('hands the rule the role the press landed inside, not only the tag', () => {
    // A composite widget is assembled from `div`s and `li`s, where the tag name says
    // nothing: `closest('[role]')` is what catches an arrow key aimed at a listbox,
    // a menu, a radio group or a slider.
    expect(CODE).toContain("targetRole: element?.closest('[role]')?.getAttribute('role') ?? ''");
  });

  it('writes the listener’s live values in an effect, never during render', () => {
    // A render-phase mutation is what React's double-invocation warns about. The ref is
    // still the channel — the listener is attached once, because a dependency array
    // would re-subscribe it on every render.
    expect(CODE).toMatch(
      /useEffect\(\(\) => \{\s*live\.current = \{ ordinals, currentOrdinal, mapOpen, onNavigate \};\s*\}\);/u,
    );
    // Once, and only inside that effect.
    expect(CODE.match(/live\.current = \{/gu)).toHaveLength(1);
  });

  it('lands focus on a real control when the Question’s heading cannot take it', () => {
    // The row being hidden is the row focus was on, so a failed move would drop focus
    // to `<body>` and the reader's next Tab would start the page over. A real control
    // rather than a focusable region of this component's own, which `components/` is
    // swept for.
    expect(CODE).toContain(
      'const fallback = nextOrdinal !== null ? nextControl.current : previousControl.current;',
    );
    expect(CODE).toContain('(heading ?? fallback)?.focus()');
    expect(CODE).toContain('ref={previousControl}');
    expect(CODE).toContain('ref={nextControl}');
  });

  it('pages on an arrow key through the one pure function that decides it', () => {
    expect(CODE).toContain("from '@/lib/answer-key-paging'");
    expect(CODE).toContain('shouldPageOnKey(');
    expect(CODE).toContain('stepOrdinal(');
    expect(CODE).toContain("window.addEventListener('keydown', onKeyDown)");
    expect(CODE).toContain("window.removeEventListener('keydown', onKeyDown)");
    // The refusals are the pure function's, so none of them is re-decided here.
    expect(CODE).not.toMatch(/ArrowLeft'|ArrowRight'/u);
  });

  it('persists nothing: the URL is the only carrier of where the reader is', () => {
    expect(CODE).not.toMatch(/localStorage|sessionStorage|document\.cookie/u);
  });

  it('nothing animates and nothing celebrates', () => {
    expect(CODE).not.toMatch(/Confetti|celebrat|animate|Fade|Grow|Collapse|Zoom|transition/iu);
  });
});
