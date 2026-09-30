'use client';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { parentCopy } from '@/copy/parent';
import {
  dateOnly,
  limitLabel,
  tierLabel,
  type AccountConsumption,
  type AllowanceReading,
} from '@/lib/consumption-format';
import { density } from '@/theme/tokens';

/** Usage numbers align on tabular figures, as the Admin consumption panel does. */
const tabular = { fontVariantNumeric: 'tabular-nums' } as const;

export const allowancesHeadingId = 'allowances-heading';

/**
 * What this account has used this period — the Account Tier, the three counters
 * against their limits, the Student Profile limit and the one reset date.
 *
 * **Nothing here is composed.** Every number is the API's, every limit renders
 * through `limitLabel`, the tier through `tierLabel` and the reset through
 * `dateOnly` in `consumption.timezone` — the account's own zone, never the
 * viewer's and never UTC. This file holds no tier name, no limit figure and no
 * date of its own, which is what makes "the admin and parent views can never
 * disagree" a property of the payload rather than of two screens agreeing today.
 *
 * `limit: null` is unlimited and is **said in words**: the sentence drops the
 * "of N" rather than inventing a ceiling or claiming "0 left".
 *
 * Each row names its own unit, because "2 of 2 used" says nothing about what was
 * used. The Generation row is denominated in **practice tests** and in nothing
 * else — the same denomination the generate screen's cost sentence carries.
 *
 * Presentational, and exported for the reason `DataAndDeletionNote` is: the node
 * test environment cannot mount the screen, its router or its elevation, and what
 * this section states is exactly the thing that has to be assertable.
 */
export function AllowancesPanel({ consumption }: { consumption: AccountConsumption }) {
  const rows: readonly (readonly [string, AllowanceReading, string])[] = [
    [
      parentCopy.settings.uploadAllowance,
      consumption.allowances.upload,
      parentCopy.settings.uploadUnit,
    ],
    [
      parentCopy.settings.generationAllowance,
      consumption.allowances.generation,
      parentCopy.settings.generationUnit,
    ],
    [
      parentCopy.settings.explanationAllowance,
      consumption.allowances.explanation,
      parentCopy.settings.explanationUnit,
    ],
  ];

  return (
    <Box
      component="section"
      aria-labelledby={allowancesHeadingId}
      sx={{ display: 'grid', gap: `${density.gap}px` }}
    >
      <Typography id={allowancesHeadingId} component="h2" sx={{ fontSize: 18, fontWeight: 700 }}>
        {parentCopy.settings.allowancesHeading}
      </Typography>
      <Typography sx={{ color: 'text.secondary' }}>
        {parentCopy.settings.allowancesIntro}
      </Typography>

      <Typography component="p" data-testid="account-tier">
        {parentCopy.settings.tierLine(tierLabel(consumption.tier))}
      </Typography>

      <Box component="dl" sx={{ display: 'grid', gap: `${density.gap / 2}px`, m: 0 }}>
        {rows.map(([label, reading, unit]) => (
          <Box key={label} data-testid="allowance-row" data-allowance={label}>
            <Typography component="dt" sx={{ fontWeight: 700 }}>
              {label}
            </Typography>
            <Typography component="dd" sx={{ ...tabular, m: 0 }}>
              {reading.limit === null
                ? parentCopy.settings.allowanceUnlimited(reading.used, unit)
                : parentCopy.settings.allowanceUsed(reading.used, limitLabel(reading.limit), unit)}
            </Typography>
          </Box>
        ))}
      </Box>

      <Typography component="p" sx={tabular}>
        {`${parentCopy.settings.studentProfileLimitLabel}: ${limitLabel(
          consumption.studentProfileLimit,
        )}`}
      </Typography>
      <Typography component="p" sx={tabular} data-testid="allowances-reset">
        {parentCopy.settings.allowanceResets(dateOnly(consumption.resetAt, consumption.timezone))}
      </Typography>
    </Box>
  );
}
