'use client';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import { density, typeRoles } from '@/theme/tokens';

/**
 * One table, two layouts: the table itself from the desktop breakpoint, a list of
 * cards below it (UX-DR44).
 *
 * **Both layouts are in the DOM and the choice is CSS.** Every screen here renders
 * its rows twice from one piece of state and lets `display` decide which one is
 * drawn. A `useMediaQuery` would render the phone layout first on every device and
 * then swap, which is a visible reflow on the slowest device the product runs on —
 * and a hook that reads the viewport is a second source of truth about the width
 * the stylesheet already knows.
 *
 * **The hidden layout is `display: none`, not visually hidden.** The two layouts
 * are the same rows, so the one that is not drawn has to leave the accessibility
 * tree entirely: a duplicate that is merely invisible is every row announced
 * twice. That is the opposite of hiding a *column* whose header the remaining
 * cells still need, which is why the `MasteryTable` trick this pattern replaced
 * went the other way.
 *
 * **Row-scoped ids are the table's; the card suffixes `-card`.** An `id` an
 * `aria-controls`, an `aria-describedby` or a `<label>` points at must be unique
 * across both layouts, and suffixing the card side alone leaves every query
 * written against the table valid exactly as it stands.
 *
 * The cutoff is MUI's own `lg` (1200px) and `sm` (600px). Neither figure is
 * written here: a breakpoint key is the name of a figure the theme owns.
 *
 * Nothing in this file states a colour, a spacing figure or a tap target of its
 * own — every one comes from `theme.density` and `typeRoles`.
 */

/**
 * Today's `<Table>`, drawn from the desktop breakpoint and gone below it.
 *
 * It keeps the sideways scroller it had: at `lg` and above a table with a dozen
 * Grade Levels in it is still wider than the card that holds it.
 */
export function TableOnDesktop({ children }: { children: React.ReactNode }) {
  return <Box sx={{ display: { xs: 'none', lg: 'block' }, overflowX: 'auto' }}>{children}</Box>;
}

/**
 * The card layout: a real `ul`, one column on a phone and two from `sm`.
 *
 * `ranked` opts out of the second column. A list whose order is the answer —
 * weakest topic first — reads top-to-bottom, and two columns turn that into a
 * reading order a parent has to reconstruct.
 */
export function CardList({
  children,
  label,
  ranked = false,
  testId,
}: {
  children: React.ReactNode;
  /**
   * The list's accessible name — the table's own, so both layouts are named
   * alike. Required: the table this replaces always has one, and a list of rows
   * with no name is a region a screen-reader user cannot tell from the next.
   */
  label: string;
  /** One column at every width, because the order carries meaning. */
  ranked?: boolean;
  testId?: string;
}) {
  return (
    <Box
      component="ul"
      // `listStyle: none` strips list semantics in Safari/VoiceOver, which is
      // exactly the announcement — "list, 6 items" — that tells a reader how
      // much there is. The role puts it back; the element is still a real `ul`.
      role="list"
      aria-label={label}
      data-testid={testId}
      sx={(theme) => {
        // `theme.density` is optional on `ThemeOptions`, so a theme not built by
        // `buildTheme` would otherwise resolve the gap to `undefinedpx`.
        const d = theme.density ?? density;
        return {
          display: { xs: 'grid', lg: 'none' },
          gridTemplateColumns: ranked ? '1fr' : { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
          gap: `${d.gap}px`,
          alignItems: 'start',
          listStyle: 'none',
          margin: 0,
          padding: 0,
        };
      }}
    >
      {children}
    </Box>
  );
}

export interface TableCardProps {
  /**
   * The row's identifying value — the name, the topic, the email.
   *
   * It is both the card's visible title and its accessible name, carried as an
   * `aria-label` rather than through an `aria-labelledby` pointing at a second
   * per-row `id` that would then have to be unique across both layouts.
   */
  title: string;
  /**
   * Drawn in place of the title. The rename form goes here, so an inline rename
   * replaces the name where the name was rather than appearing under it.
   */
  titleContent?: React.ReactNode;
  /** The row's `RowActions`, at the card's top-right. */
  actions?: React.ReactNode;
  children?: React.ReactNode;
  /** The card's own testid, distinct from the table row's. */
  testId?: string;
  /**
   * Extra `data-*` attributes, for the facts a spec reads off the row.
   *
   * Keyed to `data-*` alone, so a caller cannot reach the card's `id`, `role` or
   * `className` through it, and spread *before* the card's own attributes so it
   * cannot silently clobber `data-testid` either.
   */
  dataAttributes?: Readonly<Record<`data-${string}`, string>>;
}

/**
 * One row, as a card: a flat `background.paper` surface on the 1px divider border
 * the theme already gives every `Card`, titled by the row and with the row's
 * actions at the top-right.
 */
export function TableCard({
  title,
  titleContent,
  actions,
  children,
  testId,
  dataAttributes,
}: TableCardProps) {
  return (
    <Card
      component="li"
      {...dataAttributes}
      role="listitem"
      aria-label={title}
      data-testid={testId}
    >
      <CardContent
        sx={(theme) => {
          const d = theme.density ?? density;
          return { display: 'grid', gap: `${d.gap}px` };
        }}
      >
        <Box
          sx={(theme) => {
            const d = theme.density ?? density;
            return {
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: `${d.gap}px`,
            };
          }}
        >
          {/* Deliberately not a heading. `titleContent` replaces the title while a
            row is being renamed, and a heading that comes and goes with a rename
            is a page whose outline changes shape as a row is edited — so no card
            contributes one, on any screen. The card is named by its `aria-label`.
            `anywhere` so an unbreakable value — an account's email — wraps inside
            the card instead of pushing past its edge at phone width. */}
          {titleContent ?? (
            <Typography
              component="p"
              sx={{ ...typeRoles.cardTitle, minWidth: 0, overflowWrap: 'anywhere' }}
            >
              {title}
            </Typography>
          )}
          {actions !== undefined && (
            <Box data-testid="card-actions" sx={{ flexShrink: 0 }}>
              {actions}
            </Box>
          )}
        </Box>
        {children}
      </CardContent>
    </Card>
  );
}

/**
 * One column's value on a card, under the column's own header as its label.
 *
 * The label is the `*Column` string the table head already uses, so the two
 * layouts cannot drift into two names for one fact. `tabular` opts the value into
 * the tabular figures the table cell has, for the values that are numbers.
 *
 * The value is a `div` and not a `span`: a column whose cell holds a control —
 * a select, a checkbox — would otherwise nest block content inside inline.
 */
export function CardField({
  label,
  value,
  tabular = false,
  testId,
}: {
  label: string;
  value: React.ReactNode;
  /** Opts the value into tabular figures, for a column that holds numbers. */
  tabular?: boolean;
  testId?: string;
}) {
  return (
    <Box
      // The table associated a cell with its column through `<th scope="col">`.
      // A card has no column, so the field is a named group instead: without it
      // the label and the value are two adjacent strings and nothing says the
      // first names the second. A group named by `aria-label` rather than by
      // `aria-labelledby` keeps the pattern free of per-row ids, which would
      // otherwise have to be unique across both layouts.
      role="group"
      aria-label={label}
      data-testid={testId}
      sx={(theme) => {
        const d = theme.density ?? density;
        return { display: 'grid', gap: `${d.gap / 2}px`, minWidth: 0 };
      }}
    >
      <Typography component="span" sx={{ ...typeRoles.caption, color: 'text.secondary' }}>
        {label}
      </Typography>
      <Box
        sx={{
          ...typeRoles.tableCell,
          ...(tabular ? { fontVariantNumeric: 'tabular-nums' } : {}),
        }}
      >
        {value}
      </Box>
    </Box>
  );
}
