'use client';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import { CalendarClock, Users } from 'lucide-react';
import { parentCopy } from '@/copy/parent';
import {
  dateOnly,
  limitLabel,
  tierLabel,
  type AccountConsumption,
  type AllowanceReading,
} from '@/lib/consumption-format';
import { density, rounded, typeRoles } from '@/theme/tokens';

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
    <Card component="section" aria-labelledby={allowancesHeadingId}>
      <CardContent sx={{ display: 'grid', gap: `${density.gap * 1.5}px` }}>
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: `${density.gap}px`,
          }}
        >
          <Typography id={allowancesHeadingId} component="h2" variant="cardTitle">
            {parentCopy.settings.allowancesHeading}
          </Typography>
          <Typography
            component="p"
            data-testid="account-tier"
            sx={{
              px: `${density.gap * 1.25}px`,
              py: '2px',
              borderRadius: 999,
              border: '1px solid',
              borderColor: 'primary.main',
              color: 'primary.main',
              fontSize: '0.8125rem',
              fontWeight: 600,
            }}
          >
            {parentCopy.settings.tierLine(tierLabel(consumption.tier))}
          </Typography>
        </Box>
        <Typography sx={{ color: 'text.secondary' }}>
          {parentCopy.settings.allowancesIntro}
        </Typography>

        <Box
          component="dl"
          sx={{
            display: 'grid',
            gap: `${density.gap}px`,
            m: 0,
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' },
          }}
        >
          {rows.map(([label, reading, unit]) => (
            <Box
              key={label}
              data-testid="allowance-row"
              data-allowance={label}
              sx={{
                display: 'grid',
                gap: `${density.gap / 2}px`,
                alignContent: 'start',
                p: `${density.cardPadding}px`,
                bgcolor: 'action.hover',
                borderRadius: `${rounded.control}px`,
              }}
            >
              <Typography component="dt" sx={{ ...typeRoles.label, color: 'text.secondary' }}>
                {label}
              </Typography>
              <Typography component="dd" sx={{ ...tabular, m: 0, fontWeight: 600 }}>
                {reading.limit === null
                  ? parentCopy.settings.allowanceUnlimited(reading.used, unit)
                  : parentCopy.settings.allowanceUsed(
                      reading.used,
                      limitLabel(reading.limit),
                      unit,
                    )}
              </Typography>
            </Box>
          ))}
        </Box>

        <Typography
          component="p"
          sx={{ ...tabular, display: 'flex', alignItems: 'center', gap: `${density.gap}px` }}
        >
          <Users size={16} aria-hidden="true" />
          {`${parentCopy.settings.studentProfileLimitLabel}: ${limitLabel(
            consumption.studentProfileLimit,
          )}`}
        </Typography>
        <Typography
          component="p"
          sx={{
            ...tabular,
            display: 'flex',
            alignItems: 'center',
            gap: `${density.gap}px`,
            color: 'text.secondary',
          }}
          data-testid="allowances-reset"
        >
          <CalendarClock size={16} aria-hidden="true" />
          {parentCopy.settings.allowanceResets(dateOnly(consumption.resetAt, consumption.timezone))}
        </Typography>
      </CardContent>
    </Card>
  );
}
