'use client';

import { useState } from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { CardList, TableCard, TableOnDesktop } from '@/components/TableCards';
import { adminCopy } from '@/copy/admin';
import type { AvailabilityEntry, TaxonomyItem } from '@/lib/admin-api';
import { density } from '@/theme/tokens';

export interface AvailabilityMatrixProps {
  subjects: TaxonomyItem[];
  gradeLevels: TaxonomyItem[];
  availability: AvailabilityEntry[];
  /** Resolves `true` only when the write succeeded. */
  onToggle: (subject: TaxonomyItem, gradeLevel: TaxonomyItem, enabled: boolean) => Promise<boolean>;
}

/**
 * The subject × grade-level grid, at two widths (UX-DR44).
 *
 * From the desktop breakpoint it is the matrix it has always been. Below it the
 * matrix is the worst offender on the whole console — a dozen Grade Levels across
 * 360px is a dozen columns of one checkbox each, reached only by scrolling
 * sideways — so each Subject becomes a card listing its Grade Levels as labeled
 * checkboxes. Both layouts bind to the one `toggle` and the one `pendingPairs`:
 * there is no second write path and no second copy of the server snapshot.
 */
export function AvailabilityMatrix(props: AvailabilityMatrixProps) {
  const { subjects, gradeLevels, availability } = props;
  const enabledPairs = new Set(
    availability.filter((entry) => entry.enabled).map((e) => `${e.subjectId}:${e.gradeLevelId}`),
  );
  // `checked` is derived from the server snapshot, so a pairing must accept one
  // write at a time: a second click would race the first and could leave the
  // control disagreeing with the server.
  const [pendingPairs, setPendingPairs] = useState<ReadonlySet<string>>(new Set());

  async function toggle(
    key: string,
    subject: TaxonomyItem,
    gradeLevel: TaxonomyItem,
    enabled: boolean,
  ): Promise<void> {
    if (pendingPairs.has(key)) return;
    setPendingPairs((current) => new Set(current).add(key));
    try {
      await props.onToggle(subject, gradeLevel, enabled);
    } finally {
      setPendingPairs((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }

  return (
    <Card component="section" aria-labelledby="availability-heading">
      <CardContent sx={{ display: 'grid', gap: `${density.gap}px` }}>
        <Typography id="availability-heading" component="h2" variant="cardTitle">
          {adminCopy.taxonomy.availabilityHeading}
        </Typography>
        <Typography component="p" sx={{ color: 'text.secondary' }}>
          {adminCopy.taxonomy.availabilityIntro}
        </Typography>

        {subjects.length === 0 || gradeLevels.length === 0 ? (
          <Typography component="p" sx={{ color: 'text.secondary' }}>
            {adminCopy.taxonomy.availabilityNeedsBoth}
          </Typography>
        ) : (
          <>
            {/* Wider than the card once there are a dozen Grade Levels: it scrolls
              sideways with the Subject column pinned, so every tick still says
              which Subject it belongs to. */}
            <TableOnDesktop>
              <TableContainer sx={{ overflowX: 'auto' }}>
                <Table
                  size="small"
                  aria-labelledby="availability-heading"
                  sx={{
                    '& thead th': {
                      color: 'text.secondary',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    },
                  }}
                >
                  <TableHead>
                    <TableRow>
                      <TableCell
                        component="th"
                        scope="col"
                        sx={{
                          position: 'sticky',
                          left: 0,
                          zIndex: 1,
                          bgcolor: 'background.paper',
                          borderRight: '1px solid',
                          borderColor: 'divider',
                        }}
                      >
                        {adminCopy.taxonomy.subjectsHeading}
                      </TableCell>
                      {gradeLevels.map((gradeLevel) => (
                        <TableCell key={gradeLevel.id} component="th" scope="col" align="center">
                          {gradeLevel.name}
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {subjects.map((subject) => (
                      <TableRow key={subject.id} sx={{ '&:hover': { bgcolor: 'action.hover' } }}>
                        <TableCell
                          component="th"
                          scope="row"
                          sx={{
                            ...{
                              position: 'sticky',
                              left: 0,
                              zIndex: 1,
                              bgcolor: 'background.paper',
                              borderRight: '1px solid',
                              borderColor: 'divider',
                            },
                            fontWeight: 600,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {subject.name}
                        </TableCell>
                        {gradeLevels.map((gradeLevel) => {
                          const key = `${subject.id}:${gradeLevel.id}`;
                          const checked = enabledPairs.has(key);
                          return (
                            <TableCell key={gradeLevel.id} align="center">
                              <Checkbox
                                checked={checked}
                                disabled={pendingPairs.has(key)}
                                onChange={(event) =>
                                  toggle(key, subject, gradeLevel, event.target.checked)
                                }
                                slotProps={{
                                  input: {
                                    'aria-label': adminCopy.availabilityCheckboxLabel(
                                      subject.name,
                                      gradeLevel.name,
                                    ),
                                  },
                                }}
                              />
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </TableOnDesktop>

            {/* One card per Subject, its Grade Levels as labeled checkboxes bound
              to the same handler and the same pending set. */}
            <CardList label={adminCopy.taxonomy.availabilityHeading} testId="availability-cards">
              {subjects.map((subject) => (
                <TableCard
                  key={subject.id}
                  title={subject.name}
                  testId="availability-card"
                  dataAttributes={{ 'data-subject': subject.name }}
                >
                  <Box sx={{ display: 'grid', gap: `${density.gap / 2}px` }}>
                    {gradeLevels.map((gradeLevel) => {
                      const key = `${subject.id}:${gradeLevel.id}`;
                      return (
                        <FormControlLabel
                          key={gradeLevel.id}
                          label={gradeLevel.name}
                          control={
                            <Checkbox
                              checked={enabledPairs.has(key)}
                              disabled={pendingPairs.has(key)}
                              onChange={(event) =>
                                toggle(key, subject, gradeLevel, event.target.checked)
                              }
                              slotProps={{
                                input: {
                                  // The visible word is the Grade Level; the
                                  // accessible name names the pairing, because a
                                  // tick called "Year 5" is one of a dozen
                                  // identical ticks away from the card's title.
                                  'aria-label': adminCopy.availabilityCheckboxLabel(
                                    subject.name,
                                    gradeLevel.name,
                                  ),
                                },
                              }}
                            />
                          }
                        />
                      );
                    })}
                  </Box>
                </TableCard>
              ))}
            </CardList>
          </>
        )}
      </CardContent>
    </Card>
  );
}
