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
import { adminCopy } from '@/copy/admin';
import type { AccountConsumption, AccountTier, ParentAccountSummary } from '@/lib/admin-api';
import { dateOnly, inZone, limitLabel } from '@/lib/consumption-format';
import { density } from '@/theme/tokens';
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

function ConsumptionPanel({ consumption }: { consumption: AccountConsumption }) {
  const rows = [
    [adminCopy.accounts.uploadAllowance, consumption.allowances.upload],
    [adminCopy.accounts.generationAllowance, consumption.allowances.generation],
    [adminCopy.accounts.explanationAllowance, consumption.allowances.explanation],
  ] as const;

  return (
    <Box sx={{ display: 'grid', gap: `${density.gap}px`, py: `${density.gap}px` }}>
      <Typography component="h3" sx={{ fontSize: 16, fontWeight: 700 }}>
        {adminCopy.accounts.consumptionHeading}
      </Typography>

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

      <Box sx={{ display: 'grid', gap: `${density.gap / 2}px` }}>
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
        <Typography component="p" sx={tabular} data-testid="reset-at">
          {`${adminCopy.accounts.resetLabel}: ${inZone(consumption.resetAt, consumption.timezone)}`}
        </Typography>
        <Typography component="p" sx={{ color: 'text.secondary' }}>
          {`${adminCopy.accounts.timezoneLabel}: ${consumption.timezone}`}
        </Typography>
      </Box>
    </Box>
  );
}

export function ParentAccountTable(props: ParentAccountTableProps) {
  const { accounts, expandedId, consumption, consumptionLoading, consumptionError, pendingIds } =
    props;

  if (accounts.length === 0) {
    return (
      <Card component="section" aria-labelledby="accounts-heading">
        <CardContent>
          <Typography id="accounts-heading" component="h2" sx={{ fontSize: 18, fontWeight: 700 }}>
            {adminCopy.accounts.title}
          </Typography>
          <Typography component="p" sx={{ color: 'text.secondary' }}>
            {adminCopy.accounts.empty}
          </Typography>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card component="section" aria-labelledby="accounts-heading">
      <CardContent sx={{ display: 'grid', gap: `${density.gap}px` }}>
        <Typography id="accounts-heading" component="h2" sx={{ fontSize: 18, fontWeight: 700 }}>
          {adminCopy.accounts.title}
        </Typography>

        <Table size="small" aria-labelledby="accounts-heading">
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
                  <TableRow data-testid="account-row" data-email={account.email}>
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
                    <TableCell>
                      <Button
                        type="button"
                        aria-expanded={expanded}
                        aria-controls={`consumption-${account.id}`}
                        aria-label={adminCopy.consumptionToggleLabel(account.email)}
                        onClick={() => props.onToggleConsumption(account)}
                      >
                        {expanded
                          ? adminCopy.accounts.hideConsumption
                          : adminCopy.accounts.showConsumption}
                      </Button>
                    </TableCell>
                  </TableRow>
                  {expanded && (
                    <TableRow>
                      <TableCell colSpan={ACCOUNT_COLUMNS.length} id={`consumption-${account.id}`}>
                        {/* Error first: a failed read must not sit forever on
                            "Loading…", which is what checking `loading` alone
                            would leave on screen. */}
                        {consumptionError ? (
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
                        ) : consumptionLoading || !consumption ? (
                          // No `role` here: the page already owns one live
                          // region, and a second competes with it.
                          <Typography component="p">
                            {adminCopy.accounts.loadingConsumption}
                          </Typography>
                        ) : (
                          <ConsumptionPanel consumption={consumption} />
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
