'use client';

import { useState } from 'react';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Checkbox from '@mui/material/Checkbox';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
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
        <Typography id="availability-heading" component="h2" sx={{ fontSize: 18, fontWeight: 700 }}>
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
          <Table size="small" aria-labelledby="availability-heading">
            <TableHead>
              <TableRow>
                <TableCell component="th" scope="col">
                  {adminCopy.taxonomy.subjectsHeading}
                </TableCell>
                {gradeLevels.map((gradeLevel) => (
                  <TableCell key={gradeLevel.id} component="th" scope="col">
                    {gradeLevel.name}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {subjects.map((subject) => (
                <TableRow key={subject.id}>
                  <TableCell component="th" scope="row">
                    {subject.name}
                  </TableCell>
                  {gradeLevels.map((gradeLevel) => {
                    const key = `${subject.id}:${gradeLevel.id}`;
                    const checked = enabledPairs.has(key);
                    return (
                      <TableCell key={gradeLevel.id}>
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
        )}
      </CardContent>
    </Card>
  );
}
