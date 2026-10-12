'use client';

import { Fragment } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { ChevronDown, Users } from 'lucide-react';
import { RowActions } from '@/components/RowActions';
import { CardField, CardList, TableCard, TableOnDesktop } from '@/components/TableCards';
import { adminCopy } from '@/copy/admin';
import type { AccountConsumption, AccountTier, ParentAccountSummary } from '@/lib/admin-api';
import { dateOnly, inZone, limitLabel } from '@/lib/consumption-format';
import { density, rounded, typeRoles } from '@/theme/tokens';
import { TierSelect } from './TierSelect';

/** Consumption numbers align on tabular figures, so columns line up. */
const tabular = { fontVariantNumeric: 'tabular-nums' } as const;

/**
 * The account table's column count, defined once. The expanded consumption row
 * spans the whole table, and a `colSpan` hand-synced to the header would drift
 * the moment a column is added.
 */
const ACCOUNT_COLUMNS = [
  adminCopy.accounts.emailColumn,
  adminCopy.accounts.nameColumn,
  adminCopy.accounts.tierColumn,
  adminCopy.accounts.timezoneColumn,
  adminCopy.accounts.createdColumn,
  adminCopy.accounts.actionsColumn,
] as const;

export interface ParentAccountTableProps {
  accounts: ParentAccountSummary[];
  expandedId: string | null;
  consumption: AccountConsumption | null;
  consumptionLoading: boolean;
  /** Set when the consumption read failed; the panel shows this, not a spinner. */
  consumptionError: string | null;
  pendingIds: ReadonlySet<string>;
  onToggleConsumption: (account: ParentAccountSummary) => void;
  onRetryConsumption: (account: ParentAccountSummary) => void;
  onAssignTier: (account: ParentAccountSummary, tier: AccountTier) => Promise<boolean>;
}

/** The three allowances, with the reading each one is at. */
function allowanceRows(consumption: AccountConsumption) {
  return [
    [adminCopy.accounts.uploadAllowance, consumption.allowances.upload],
    [adminCopy.accounts.generationAllowance, consumption.allowances.generation],
    [adminCopy.accounts.explanationAllowance, consumption.allowances.explanation],
  ] as const;
}

/**
 * The window the allowances are counted in, and the zone it is computed in.
 *
 * `suffix` is empty in the table's panel and `-card` in the card's, so a spec
 * counting one layout is never handed the sum.
 */
function PeriodSummary({
  consumption,
  suffix,
}: {
  consumption: AccountConsumption;
  suffix: string;
}) {
  return (
    <Box sx={{ display: 'grid', gap: `${density.gap / 2}px`, pt: `${density.gap / 2}px` }}>
      <Typography component="p" sx={tabular}>
        {`${adminCopy.accounts.studentProfileLimitLabel}: ${limitLabel(
          consumption.studentProfileLimit,
        )}`}
      </Typography>
      <Typography component="p" sx={tabular}>
        {`${adminCopy.accounts.periodStartLabel}: ${inZone(
          consumption.periodStart,
          consumption.timezone,
        )}`}
      </Typography>
      <Typography component="p" sx={tabular} data-testid={`reset-at${suffix}`}>
        {`${adminCopy.accounts.resetLabel}: ${inZone(consumption.resetAt, consumption.timezone)}`}
      </Typography>
      <Typography
        component="p"
        sx={{ color: 'text.secondary' }}
        data-testid={`consumption-zone${suffix}`}
      >
        {`${adminCopy.accounts.timezoneLabel}: ${consumption.timezone}`}
      </Typography>
    </Box>
  );
}

function ConsumptionPanel({ consumption }: { consumption: AccountConsumption }) {
  const rows = allowanceRows(consumption);

  return (
    <Box
      sx={{
        display: 'grid',
        gap: `${density.gap}px`,
        p: `${density.cardPadding}px`,
        my: `${density.gap}px`,
        bgcolor: 'action.hover',
        borderRadius: `${rounded.control}px`,
      }}
    >
      <Typography component="h3" sx={{ ...typeRoles.label, color: 'text.secondary' }}>
        {adminCopy.accounts.consumptionHeading}
      </Typography>

      {/* The allowances beside the period they are counted in, on a screen wide
          enough for both; stacked otherwise. */}
      <Box
        sx={{
          display: 'grid',
          gap: `${density.sectionMargin}px`,
          gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 3fr) minmax(0, 2fr)' },
          alignItems: 'start',
        }}
      >
        <Table size="small" data-testid="consumption-table">
          <TableHead>
            <TableRow>
              <TableCell component="th" scope="col">
                {adminCopy.accounts.allowanceColumn}
              </TableCell>
              <TableCell component="th" scope="col">
                {adminCopy.accounts.usageColumn}
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map(([label, reading]) => (
              <TableRow key={label} data-testid="allowance-row" data-allowance={label}>
                <TableCell component="th" scope="row">
                  {label}
                </TableCell>
                <TableCell sx={tabular}>
                  {adminCopy.accounts.usageOfLimit(reading.used, limitLabel(reading.limit))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <PeriodSummary consumption={consumption} suffix="" />
      </Box>
    </Box>
  );
}

/**
 * The same consumption reading inside a card, as a labeled field list.
 *
 * **Not a nested table.** A two-column table inside a card that is itself one
 * column wide at 360px is the squeeze this layout exists to end; each allowance
 * is its own labeled field instead, carrying the identical sentence.
 */
function ConsumptionCardFields({ consumption }: { consumption: AccountConsumption }) {
  return (
    <Box sx={{ display: 'grid', gap: `${density.gap}px` }}>
      <Typography component="h4" sx={{ ...typeRoles.label, color: 'text.secondary' }}>
        {adminCopy.accounts.consumptionHeading}
      </Typography>
      {allowanceRows(consumption).map(([label, reading]) => (
        <Box key={label} data-testid="allowance-field" data-allowance={label}>
          <CardField
            label={label}
            value={adminCopy.accounts.usageOfLimit(reading.used, limitLabel(reading.limit))}
            tabular
          />
        </Box>
      ))}
      <PeriodSummary consumption={consumption} suffix="-card" />
    </Box>
  );
}

export function ParentAccountTable(props: ParentAccountTableProps) {
  const { accounts, expandedId, consumption, consumptionLoading, consumptionError, pendingIds } =
    props;

  /**
   * The disclosure, in whichever layout the row is drawn in.
   *
   * One action, and a chevron says "expand" standing alone — so it is the row's
   * only icon, with the word in its tooltip rather than in the cell (UX-DR43).
   * The disclosure state and target ride on the button itself; only the target's
   * `id` differs by layout, because an `aria-controls` pointing at an `id` that
   * appears twice points at whichever came first.
   */
  function consumptionToggle(account: ParentAccountSummary, idSuffix: string) {
    const expanded = expandedId === account.id;
    return (
      <RowActions
        menuLabel={adminCopy.rowActionsLabel(account.email)}
        actions={[
          {
            key: 'consumption',
            label: expanded
              ? adminCopy.accounts.hideConsumption
              : adminCopy.accounts.showConsumption,
            ariaLabel: adminCopy.consumptionToggleLabel(account.email),
            selfEvident: true,
            expanded,
            controls: `consumption-${account.id}${idSuffix}`,
            icon: (
              <Box
                component="span"
                sx={(theme) => ({
                  display: 'inline-flex',
                  transform: expanded ? 'rotate(180deg)' : 'none',
                  transition: theme.transitions.create('transform'),
                })}
              >
                <ChevronDown size={16} aria-hidden="true" />
              </Box>
            ),
            onClick: () => props.onToggleConsumption(account),
          },
        ]}
      />
    );
  }

  /**
   * What the expanded disclosure holds: the error, the wait, or the reading.
   *
   * Error first: a failed read must not sit forever on "Loading…", which is what
   * checking `loading` alone would leave on screen.
   */
  function consumptionBody(
    account: ParentAccountSummary,
    reading: (c: AccountConsumption) => React.ReactNode,
  ) {
    if (consumptionError) {
      return (
        <Box
          sx={{
            display: 'grid',
            gap: `${density.gap}px`,
            justifyItems: 'start',
            py: `${density.gap}px`,
          }}
        >
          <Alert severity="error" variant="outlined">
            {consumptionError}
          </Alert>
          <Button
            type="button"
            variant="contained"
            onClick={() => props.onRetryConsumption(account)}
          >
            {adminCopy.accounts.retry}
          </Button>
        </Box>
      );
    }
    if (consumptionLoading || !consumption) {
      // No `role` here: the page already owns one live region, and a second
      // competes with it.
      return <Typography component="p">{adminCopy.accounts.loadingConsumption}</Typography>;
    }
    // `consumption` is non-null past the guard above, so the reading is built
    // here rather than at the two call sites: a ternary there could never yield
    // anything but the panel, and would render an empty disclosure if it did.
    return reading(consumption);
  }

  if (accounts.length === 0) {
    return (
      <Card component="section" aria-labelledby="accounts-heading">
        <CardContent>
          <Typography id="accounts-heading" component="h2" variant="cardTitle">
            {adminCopy.accounts.title}
          </Typography>
          <Box
            sx={{
              display: 'grid',
              justifyItems: 'center',
              gap: `${density.gap}px`,
              py: `${density.sectionMargin * 1.5}px`,
              px: `${density.cardPadding}px`,
              border: '1px dashed',
              borderColor: 'divider',
              borderRadius: `${rounded.control}px`,
              color: 'text.secondary',
              textAlign: 'center',
            }}
          >
            <Users size={28} aria-hidden="true" />
            <Typography component="p">{adminCopy.accounts.empty}</Typography>
          </Box>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card component="section" aria-labelledby="accounts-heading">
      <CardContent sx={{ display: 'grid', gap: `${density.gap}px` }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: `${density.gap}px` }}>
          <Typography id="accounts-heading" component="h2" variant="cardTitle">
            {adminCopy.accounts.title}
          </Typography>
          {/* How many there are, at a glance. Decorative: the table lists each one. */}
          <Box
            component="span"
            aria-hidden="true"
            sx={{
              px: `${density.gap}px`,
              borderRadius: 999,
              bgcolor: 'action.selected',
              fontSize: '0.8125rem',
              fontWeight: 600,
              ...tabular,
            }}
          >
            {accounts.length}
          </Box>
        </Box>

        <TableOnDesktop>
          <Table
            size="small"
            aria-labelledby="accounts-heading"
            sx={{
              '& thead th': {
                fontSize: '0.6875rem',
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'text.secondary',
                whiteSpace: 'nowrap',
              },
            }}
          >
            <TableHead>
              <TableRow>
                {ACCOUNT_COLUMNS.map((column) => (
                  <TableCell key={column} component="th" scope="col">
                    {column}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {accounts.map((account) => {
                const expanded = expandedId === account.id;
                return (
                  <Fragment key={account.id}>
                    <TableRow
                      data-testid="account-row"
                      data-email={account.email}
                      sx={{
                        bgcolor: expanded ? 'action.selected' : undefined,
                        '&:hover': { bgcolor: expanded ? 'action.selected' : 'action.hover' },
                      }}
                    >
                      <TableCell>{account.email}</TableCell>
                      <TableCell>{account.displayName ?? adminCopy.accounts.noName}</TableCell>
                      <TableCell>
                        <TierSelect
                          account={account}
                          disabled={pendingIds.has(account.id)}
                          onAssign={(tier) => props.onAssignTier(account, tier)}
                        />
                      </TableCell>
                      <TableCell>{account.timezone}</TableCell>
                      <TableCell sx={tabular}>
                        {dateOnly(account.createdAt, account.timezone)}
                      </TableCell>
                      <TableCell>{consumptionToggle(account, '')}</TableCell>
                    </TableRow>
                    {expanded && (
                      <TableRow>
                        <TableCell
                          colSpan={ACCOUNT_COLUMNS.length}
                          id={`consumption-${account.id}`}
                        >
                          {consumptionBody(account, (reading) => (
                            <ConsumptionPanel consumption={reading} />
                          ))}
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </TableOnDesktop>

        {/* The same accounts below the desktop breakpoint: the email is the card's
          title, every other column a labeled field, and the consumption reading
          expands inside the card rather than across six columns of nothing. */}
        <CardList label={adminCopy.accounts.title} testId="account-cards">
          {accounts.map((account) => (
            <TableCard
              key={account.id}
              title={account.email}
              actions={consumptionToggle(account, '-card')}
              testId="account-card"
              dataAttributes={{ 'data-email': account.email }}
            >
              <CardField
                label={adminCopy.accounts.nameColumn}
                value={account.displayName ?? adminCopy.accounts.noName}
              />
              {/* The select carries its own accessible name, which names the
                account: the column header alone cannot tell rows apart. */}
              <CardField
                label={adminCopy.accounts.tierColumn}
                value={
                  <TierSelect
                    account={account}
                    disabled={pendingIds.has(account.id)}
                    onAssign={(tier) => props.onAssignTier(account, tier)}
                  />
                }
              />
              <CardField label={adminCopy.accounts.timezoneColumn} value={account.timezone} />
              <CardField
                label={adminCopy.accounts.createdColumn}
                value={dateOnly(account.createdAt, account.timezone)}
                tabular
              />
              {expandedId === account.id && (
                <Box id={`consumption-${account.id}-card`}>
                  {consumptionBody(account, (reading) => (
                    <ConsumptionCardFields consumption={reading} />
                  ))}
                </Box>
              )}
            </TableCard>
          ))}
        </CardList>
      </CardContent>
    </Card>
  );
}
