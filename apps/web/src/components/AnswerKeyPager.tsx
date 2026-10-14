'use client';

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefCallback,
} from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { ArrowLeft, ArrowRight, LayoutGrid } from 'lucide-react';
import {
  AnswerKeyMap,
  type AnswerKeyMapLabels,
  type AnswerKeyMapRow,
} from '@/components/AnswerKeyMap';
import { AppDialog } from '@/components/Dialog';
import { modalHasTheScreen, shouldPageOnKey, stepOrdinal } from '@/lib/answer-key-paging';
import { rounded, typeRoles } from '@/theme/tokens';

/** Every word the pager says, as a parameter. Required, so neither surface inherits the other's. */
export interface AnswerKeyPagerLabels {
  /** Where the reader is. Both figures are handed in. */
  position: (ordinal: number, total: number) => string;
  previous: string;
  next: string;
  openMap: string;
  closeMap: string;
  /** The same words the position line shows, announced on every turn. */
  positionAnnouncement: (ordinal: number, total: number) => string;
}

/**
 * One Question of the paged answer key.
 *
 * `render` is a callback rather than a node so the pager can hand each row the two
 * things only it knows — whether this is the Question on screen, and where the heading
 * focus has to land — without knowing anything about what a row is or what is inside it.
 * The pager never reads `state` or `newlyGraded` for itself: they are passed straight
 * through to the map.
 */
export interface AnswerKeyPagerItem extends AnswerKeyMapRow {
  /** React's key for this item's subtree. */
  key: string;
  render(props: { hidden: boolean; headingRef: RefCallback<HTMLElement> }): ReactNode;
}

/**
 * The paged answer key: the score above, one Question at a time, and a results map to
 * jump from. The one pager both surfaces use.
 *
 * **Every row stays mounted; all but one carry the `hidden` attribute.** Nothing here
 * slices the array, and that is the whole design rather than an optimisation.
 * `ExplanationReview` holds nine pieces of purely local state with no persistence —
 * four of them failure strings a parent may not have read yet — and `ExplainPanel` and
 * `DisputePanel` hold loaded prose and typed input. Slicing would unmount them, so a
 * parent who paged away mid-decision would lose it silently. Mounting everything and
 * hiding all but one costs nothing — the rows are already in the one response — and
 * makes "the panel was still open when I came back" true by construction rather than by
 * careful handling. The attribute is also what keeps the other nineteen Questions out of
 * the assistive-technology tree.
 *
 * **It makes no request and holds no read.** A page turn is a state change over data the
 * surface already has, so the one-read-per-Attempt invariant and FR-22's view-triggered
 * retry are untouched by paging. There is no `parentApi` here and no fetch of any kind.
 *
 * **`announce` is injected rather than hooked.** The student surface announces through
 * the app-wide `useAnnounce()` provider; the parent surface owns its own `role="status"`
 * region, already shared with grade-override and flag outcome sentences. A pager that
 * reached for one of them would either break the other surface or clobber an outcome the
 * parent had not finished reading. Taking a callback also keeps this component free of
 * any surface's context, which is what lets it be mounted in a spec at all.
 *
 * **The URL is the caller's.** `?q=` is written by the page with `router.replace`, not
 * here: a pager with a router dependency could not be tested without a Next.js harness,
 * and `replace` rather than `push` is the caller's decision about what Back should mean.
 * This component only ever reports an ordinal through `onNavigate`.
 *
 * **The current Question is found by matching `ordinal`, never by array position.** The
 * stored ordinal is the only unit the URL can carry and the only one that means the same
 * thing to a reader, to a deep link from a Grade dispute and to the row's own heading; a
 * position is a fact about one response's shape. `AnswerKeyRowView` is shared across the
 * three surfaces that render a row and promises neither that the ordinals are dense nor
 * that they are distinct: the paged surfaces are fed by `grading-results.ts`, which emits
 * the stored ordinal of every presented Question, while the analytics drill-down's own
 * view writes `ordinal: 0` for a row it could no longer name. So the match is resolved to
 * a **single index** and everything else is derived from that index — two rows sharing a
 * number would otherwise be unhidden together, share one heading ref, and give the map
 * two current cells.
 *
 * **Nothing animates.** No transition, no reveal, no count-up: a page turn is a change
 * of what is on the paper, not an event.
 *
 * The rail and the overlay are split by responsive `sx` on `display` at the `md` key,
 * with both forms always rendered. Never a JS media query — that would make the first
 * paint disagree with the server's.
 */
export function AnswerKeyPager({
  items,
  currentOrdinal,
  onNavigate,
  announce,
  labels,
  mapLabels,
  footer,
}: {
  /** Every row, in the order the server gave them. Never re-sorted here. */
  items: readonly AnswerKeyPagerItem[];
  currentOrdinal: number;
  onNavigate(ordinal: number): void;
  /** The surface's own live region, as a callback. See above. */
  announce(message: string): void;
  labels: AnswerKeyPagerLabels;
  mapLabels: AnswerKeyMapLabels;
  /**
   * Rendered after the pager and visible on every Question.
   *
   * A slot and not a prop with a meaning, exactly as `AnswerKeyRow`'s two are: the
   * child's Retake control and the parent's way back belong to their pages, and this
   * component neither knows what is in here nor can act on it.
   */
  footer?: ReactNode;
}) {
  const [mapOpen, setMapOpen] = useState(false);

  const ordinals = items.map((item) => item.ordinal);
  const total = items.length;
  /**
   * The one row on screen, as a **single index**.
   *
   * `findIndex` and not a filter: two rows may carry the same ordinal, and exactly one
   * Question is shown whatever the response did. `-1` for an ordinal that matches no row
   * — a clamp the caller has not written back yet — which leaves Previous and Next
   * disabled, the map with no current cell and every row hidden, because that is the
   * honest rendering of "the address bar names a Question this paper has not got".
   */
  const currentIndex = items.findIndex((item) => item.ordinal === currentOrdinal);
  const currentKey = items[currentIndex]?.key ?? null;

  /**
   * One `ref` callback per row, keyed by the row's own React key.
   *
   * **Keyed by `key` and not by ordinal**, because the ordinals are not promised to be
   * distinct and two rows sharing one would then share one stored heading — so a page
   * turn would focus whichever of them mounted last.
   *
   * Built in a `useMemo` over the keys rather than cached in a ref during render: a
   * render-phase mutation is what React's double-invocation warns about, and a map
   * grown lazily is a map nothing ever prunes — a long-lived screen refreshing its
   * results would accumulate one dead entry per row per read. Rebuilding only when the
   * **set of keys** changes keeps the callbacks stable across ordinary re-renders, which
   * is what stops React detaching and reattaching twenty refs on every keystroke.
   */
  const headings = useRef(new Map<string, HTMLElement>());
  const keySignature = items.map((item) => item.key).join('\u0000');
  const headingRefs = useMemo(() => {
    const made = new Map<string, RefCallback<HTMLElement>>();
    for (const key of keySignature === '' ? [] : keySignature.split('\u0000')) {
      made.set(key, (node) => {
        if (node === null) headings.current.delete(key);
        else headings.current.set(key, node);
      });
    }
    return made;
  }, [keySignature]);

  /** Nothing stays behind for a row this read no longer has. */
  useEffect(() => {
    const alive = new Set(headingRefs.keys());
    for (const key of [...headings.current.keys()]) {
      if (!alive.has(key)) headings.current.delete(key);
    }
  }, [headingRefs]);

  /**
   * What the key listener needs, written in an **effect** rather than during render.
   *
   * The listener is attached once, because reading these out of a dependency array
   * would re-subscribe a window listener on every render — `ordinals` is derived and has
   * a new identity each time. The ref is the channel; assigning it in an effect keeps the
   * render body free of the mutation React's double-invocation warns about, and the
   * initial value covers the window before the first effect runs.
   */
  const live = useRef({ ordinals, currentOrdinal, mapOpen, onNavigate });
  useEffect(() => {
    live.current = { ordinals, currentOrdinal, mapOpen, onNavigate };
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const element = event.target instanceof Element ? event.target : null;
      const delta = shouldPageOnKey(
        {
          key: event.key,
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
          targetTag: element?.tagName ?? '',
          targetIsContentEditable:
            element instanceof HTMLElement ? element.isContentEditable : false,
          // The role the press landed *inside*, not only the one it landed on: a MUI
          // Select's open menu puts the press on an `li role="option"` whose list is the
          // `role="listbox"`, and either one is reason enough to leave the key alone.
          targetRole: element?.closest('[role]')?.getAttribute('role') ?? '',
        },
        // The map's own overlay, plus **anything else modal** — a grade-override
        // confirmation, a hand-in confirmation, the PIN prompt — judged from where the
        // press landed rather than by asking the document whether any dialog exists.
        // Parent View's sidebar is a permanently mounted Drawer carrying
        // `role="dialog" aria-modal="true"`, so the global question answers "always" on
        // every parent screen and would leave the arrow keys dead there.
        live.current.mapOpen || modalHasTheScreen(element),
      );
      if (delta === null) return;
      const next = stepOrdinal(live.current.ordinals, live.current.currentOrdinal, delta);
      if (next === null) return;
      // **Only once a turn is actually taken.** The arrow keys scroll the document by
      // default, which would undo the `scroll: false` the caller writes the position
      // with and move the Question out from under the reader. Claimed here and nowhere
      // earlier, so a press this rule refused — or one at either end of the paper —
      // still does whatever the browser does with it.
      event.preventDefault();
      live.current.onNavigate(next);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  /** Where Previous and Next lead, or `null` at each end of the paper. */
  const previousOrdinal = stepOrdinal(ordinals, currentOrdinal, -1);
  const nextOrdinal = stepOrdinal(ordinals, currentOrdinal, 1);

  /**
   * The two controls, held so one of them can catch focus the heading could not.
   *
   * Real controls rather than a programmatically-focusable region of this component's
   * own: `components/` is swept for exactly that, and the sweep is right — what a reader
   * lands on should be something they can then act on. Whenever a turn has actually
   * happened at least one of these is enabled, because the turn came from somewhere.
   */
  const previousControl = useRef<HTMLButtonElement | null>(null);
  const nextControl = useRef<HTMLButtonElement | null>(null);

  /**
   * On every turn and never on arrival: focus the Question's heading and say where we
   * are, in the words the position line already shows.
   *
   * The first render is latched out deliberately — a screen that moved focus on load
   * would take it off whatever the reader was pointed at by the navigation, and a
   * screen that announced on load would narrate its own appearance. The latch is keyed
   * on the **ordinal**, so this announcement and the surface's own outcome sentences
   * cannot suppress each other: each is a distinct state in the live region's count.
   */
  const settledOn = useRef<number | null>(null);
  useEffect(() => {
    if (settledOn.current === currentOrdinal) return;
    const arriving = settledOn.current === null;
    settledOn.current = currentOrdinal;
    if (arriving) return;
    const heading = currentKey === null ? undefined : headings.current.get(currentKey);
    // **A fallback, because focus has to land somewhere.** The row being hidden is the
    // row focus was on, so if the Question's heading has not mounted — a row rendered
    // without one, a key the caller changed in the same commit — letting the move fail
    // would drop focus to `<body>`, and the reader's next Tab would start the page over.
    const fallback = nextOrdinal !== null ? nextControl.current : previousControl.current;
    (heading ?? fallback)?.focus();
    announce(labels.positionAnnouncement(currentOrdinal, total));
  }, [currentOrdinal, currentKey, nextOrdinal, total, announce, labels]);

  /**
   * A jump from either form of the map. It closes the overlay, which the rail ignores.
   *
   * The map hands back the cell's **index** and this is the one place it becomes an
   * ordinal, because the ordinal is what the URL carries. Two cells sharing a number
   * therefore both lead to the first of them — which is not a rounding error but the
   * truth about a URL whose unit is the stored number.
   */
  const jumpTo = useCallback(
    (index: number) => {
      const row = items[index];
      if (row === undefined) return;
      setMapOpen(false);
      onNavigate(row.ordinal);
    },
    [items, onNavigate],
  );

  /**
   * The rail's map and the overlay's, from one call, so the persistent form and the
   * opened one can never drift into saying different things about one paper.
   *
   * `headingProvided` is the one thing they differ on: the dialog's own title already
   * states the heading, and a second `h3` saying the identical words under it would make
   * a reader hear the same line twice before the first cell.
   */
  const mapFor = (headingProvided: boolean) => (
    <AnswerKeyMap
      rows={items}
      currentIndex={currentIndex}
      onJump={jumpTo}
      labels={mapLabels}
      headingProvided={headingProvided}
    />
  );

  return (
    <Box
      sx={(theme) => ({
        // One unit: the Question column and the map beside it, rather than the two
        // pushed to opposite edges of a wide screen.
        display: 'grid',
        gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) minmax(0, 18rem)' },
        alignItems: 'start',
        columnGap: `${theme.density.sectionMargin}px`,
        rowGap: `${theme.density.gap}px`,
      })}
      data-testid="answer-key-pager"
    >
      <Box sx={(theme) => ({ display: 'grid', gap: `${theme.density.gap}px`, minWidth: 0 })}>
        {/* Where the reader is, above the paper. The score header stays where the
            surface put it and is neither repeated nor re-announced per Question. */}
        <Typography sx={{ ...typeRoles.label }} data-testid="answer-key-position">
          {labels.position(currentOrdinal, total)}
        </Typography>

        {/* Every row, all of them mounted. See the note above: this is what preserves
            an open panel, its loaded prose and a half-typed decision across a turn. */}
        <Box
          component="ul"
          role="list"
          sx={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid' }}
        >
          {items.map((item, index) => (
            <Fragment key={item.key}>
              {item.render({
                // By **index**, so two rows sharing an ordinal are not unhidden together.
                hidden: index !== currentIndex,
                headingRef: headingRefs.get(item.key)!,
              })}
            </Fragment>
          ))}
        </Box>

        <Box sx={(theme) => ({ display: 'flex', gap: `${theme.density.gap}px`, flexWrap: 'wrap' })}>
          <Button
            variant="outlined"
            data-testid="answer-key-previous"
            ref={previousControl}
            startIcon={<ArrowLeft size={18} aria-hidden="true" />}
            disabled={previousOrdinal === null}
            onClick={() => previousOrdinal !== null && onNavigate(previousOrdinal)}
            sx={(theme) => ({ minHeight: theme.density.tapTarget })}
          >
            {labels.previous}
          </Button>
          <Button
            variant="outlined"
            data-testid="answer-key-next"
            ref={nextControl}
            endIcon={<ArrowRight size={18} aria-hidden="true" />}
            disabled={nextOrdinal === null}
            onClick={() => nextOrdinal !== null && onNavigate(nextOrdinal)}
            sx={(theme) => ({ minHeight: theme.density.tapTarget })}
          >
            {labels.next}
          </Button>
          {/* The overlay's opener. Hidden from `md` up in CSS, where the rail is
              already on screen — never by a JS media query, which would make the
              first paint disagree with the server's. */}
          <Button
            variant="outlined"
            data-testid="answer-key-map-open"
            startIcon={<LayoutGrid size={18} aria-hidden="true" />}
            onClick={() => setMapOpen(true)}
            sx={(theme) => ({
              minHeight: theme.density.tapTarget,
              display: { xs: 'inline-flex', md: 'none' },
            })}
          >
            {labels.openMap}
          </Button>
        </Box>

        {/* Whatever the page put here, visible on every Question: the child's Retake
            control, the parent's way back to the list. */}
        {footer}
      </Box>

      {/* The rail: the same component the overlay holds, so the persistent and the
          opened form can never drift into saying different things about one paper. */}
      <Box
        component="aside"
        data-testid="answer-key-map-rail"
        sx={(theme) => ({
          display: { xs: 'none', md: 'block' },
          // Stays in view down a long Question, so the map is never a scroll away.
          position: 'sticky',
          top: 0,
          p: `${theme.density.cardPadding}px`,
          bgcolor: 'background.paper',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: `${rounded.control}px`,
        })}
      >
        {mapFor(false)}
      </Box>

      {/* The overlay form, opened by its own control and by nothing else. Above `md`
          the rail is already permanently on screen, so raising this there would be a
          modal duplicate of a map the reader can already see. Hiding it with CSS
          instead would be worse: an open MUI dialog marks the rest of the app
          `aria-hidden` and traps focus whatever its `display` says. CSS already decides
          where the opener exists, and the opener is the one thing that opens it. */}
      <AppDialog
        open={mapOpen}
        title={mapLabels.heading}
        onClose={() => setMapOpen(false)}
        // A jump closes this dialog and moves focus to the new Question's heading in
        // the same commit (see `settledOn` above). MUI's default restores focus to
        // whatever opened the dialog — "answer-key-map-open" — once the exit
        // transition finishes, which lands *after* that focus move and would steal
        // it back. The caller already decided where focus goes; this dialog does not
        // get a second vote.
        disableRestoreFocus
        actions={
          <Button
            data-testid="answer-key-map-close"
            onClick={() => setMapOpen(false)}
            sx={(theme) => ({ minHeight: theme.density.tapTarget })}
          >
            {labels.closeMap}
          </Button>
        }
      >
        {mapFor(true)}
      </AppDialog>
    </Box>
  );
}
