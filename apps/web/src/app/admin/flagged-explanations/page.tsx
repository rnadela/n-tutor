'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import { CircleCheck, Flag } from 'lucide-react';
import { RichText } from '@/components/RichText';
import { adminCopy } from '@/copy/admin';
import {
  AdminApiError,
  adminApi,
  clearToken,
  readToken,
  type FlaggedExplanation,
} from '@/lib/admin-api';
import { density, rounded, typeRoles } from '@/theme/tokens';

/**
 * When a concern was first raised, or the same fact with no date.
 *
 * It was raised either way — that is why it is in the queue at all — so only the part that
 * cannot be stated is dropped. `new Date('').toLocaleString()` is the literal words
 * "Invalid Date", which read as a fault in the report rather than in a string.
 */
function raisedSentence(raisedAt: string): string {
  const when = new Date(raisedAt);
  if (Number.isNaN(when.getTime())) return adminCopy.flaggedExplanations.raisedAtUndated;
  return adminCopy.flaggedExplanations.raisedAt(when.toLocaleString());
}

/** One identifier row: what it is, and the id itself. */
function Identifier({ label, value }: { label: string; value: string }) {
  return (
    <Typography
      component="p"
      data-testid="flagged-identifier"
      sx={{
        fontSize: '0.8125rem',
        color: 'text.secondary',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        overflowWrap: 'anywhere',
      }}
    >
      {label}: {value}
    </Typography>
  );
}

/**
 * The Flagged Explanations queue: every Explanation an operator has to judge.
 *
 * **One row per Explanation, not per report.** A parent who originated a concern and a
 * student concern the same parent later confirmed are two records of one paragraph, and
 * the operator's job is to judge the paragraph once. The row names every route that raised
 * it, because which route it was is what says whether a child was involved — and it is
 * ordered by the earliest of their instants, which the API decided and this screen does not
 * re-derive.
 *
 * **Nothing here is an action.** This screen opens the queue; it does not suppress, edit,
 * regenerate or hide an Explanation, and it cannot overturn a parent's decision. Those are
 * other stories' and other people's, and there is no control here that pretends otherwise.
 *
 * **The filter is the API's.** A student concern nobody has decided about, and one a parent
 * dismissed, never arrive — the query excludes them — so this screen holds no filter of its
 * own and no state one could arrive in. A browser-side filter would be the guarantee held
 * in the one place it cannot be enforced.
 *
 * **What it shows about a family is the prose and the ids.** No child's display name, no
 * account email, no cost, no tier, no model name and no allowance figure (AD-20, AD-26).
 *
 * An empty queue is a stated sentence and the normal case, never an error.
 */
export default function FlaggedExplanationsPage() {
  const router = useRouter();
  /** `null` until the read answers, so "the queue is empty" is never the first render. */
  const [entries, setEntries] = useState<FlaggedExplanation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toLogin = useCallback(() => {
    // Clear first, so the login screen's already-signed-in check cannot bounce straight
    // back here on a token the server has already rejected.
    clearToken();
    router.replace('/admin/login');
  }, [router]);

  const load = useCallback(() => {
    if (!readToken()) {
      router.replace('/admin/login');
      return;
    }
    setError(null);
    adminApi.flaggedExplanations().then(
      (found) => setEntries(found),
      (cause: unknown) => {
        if (cause instanceof AdminApiError && cause.status === 401) {
          toLogin();
          return;
        }
        setError(adminCopy.flaggedExplanations.loadFailed);
      },
    );
  }, [router, toLogin]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Box sx={{ display: 'grid', gap: `${density.gap * 2}px` }}>
      <Box component="header" sx={{ display: 'grid', gap: `${density.gap / 2}px` }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: `${density.gap}px` }}>
          <Typography component="h1" sx={{ fontSize: 20, fontWeight: 700 }}>
            {adminCopy.flaggedExplanations.title}
          </Typography>
          {/* The queue's length, at a glance. Decorative: the list announces its own count. */}
          {entries !== null && entries.length > 0 && (
            <Box
              component="span"
              aria-hidden="true"
              sx={{
                px: `${density.gap}px`,
                borderRadius: 999,
                bgcolor: 'action.selected',
                fontSize: '0.8125rem',
                fontWeight: 600,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {entries.length}
            </Box>
          )}
        </Box>
        <Typography component="p" sx={{ color: 'text.secondary' }}>
          {adminCopy.flaggedExplanations.intro}
        </Typography>
      </Box>

      {error !== null && (
        <Alert
          severity="error"
          role="alert"
          variant="outlined"
          data-testid="flagged-error"
          action={
            <Button type="button" onClick={load}>
              {adminCopy.flaggedExplanations.retry}
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      {entries === null ? (
        error === null && (
          <Typography component="p" data-testid="flagged-loading" sx={{ color: 'text.secondary' }}>
            {adminCopy.flaggedExplanations.loading}
          </Typography>
        )
      ) : // An empty queue is the normal case, stated rather than left blank — and it is a
      // claim only a read that answered can make, which is what `null` above is for.
      entries.length === 0 ? (
        <Box
          sx={{
            display: 'grid',
            justifyItems: 'center',
            gap: `${density.gap}px`,
            py: `${density.sectionMargin * 2}px`,
            px: `${density.cardPadding}px`,
            border: '1px dashed',
            borderColor: 'divider',
            borderRadius: `${rounded.control}px`,
            color: 'text.secondary',
            textAlign: 'center',
          }}
        >
          <CircleCheck size={28} aria-hidden="true" />
          <Typography component="p" data-testid="flagged-empty">
            {adminCopy.flaggedExplanations.empty}
          </Typography>
        </Box>
      ) : (
        <Box
          component="ul"
          // `listStyle: 'none'` strips list semantics, and the item count with them —
          // which for a work queue is the one figure worth announcing. Put back by hand.
          role="list"
          sx={{ display: 'grid', gap: `${density.gap * 1.5}px`, p: 0, m: 0 }}
        >
          {/* The API's order, oldest concern first, and nothing here sorts: the queue
                  position is the earliest instant either route raised it, which the server
                  folded and this browser does not recompute. */}
          {entries.map((entry) => (
            <Card
              key={entry.explanationId}
              component="li"
              role="listitem"
              sx={{ listStyle: 'none' }}
              data-testid="flagged-row"
              data-explanation-id={entry.explanationId}
            >
              <CardContent sx={{ display: 'grid', gap: `${density.gap * 1.5}px` }}>
                {/* The card's own heading, and the only `h2` in it. Without one, a
                    screen-reader user navigating by heading hears the same three in-card
                    labels N times over with nothing to tell one entry from another — an
                    outline that repeats is no more usable than none. The Question is what
                    is being judged, so its id is what names the entry. */}
                <Box
                  sx={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    gap: `${density.gap}px`,
                  }}
                >
                  <Typography component="h2" variant="cardTitle" data-testid="flagged-entry">
                    {adminCopy.flaggedExplanations.entryHeading(entry.questionId)}
                  </Typography>
                  <Typography
                    component="p"
                    data-testid="flagged-raised-at"
                    sx={{ color: 'text.secondary', fontSize: '0.9375rem' }}
                  >
                    {raisedSentence(entry.raisedAt)}
                  </Typography>
                </Box>

                {/* Which routes raised it. Every member of the list, so an Explanation
                        raised both ways says so — that is the fact that tells an operator a
                        child was involved, and a row that named one route would lose it. */}
                <Box sx={{ display: 'grid', gap: `${density.gap / 2}px` }}>
                  <Typography component="h3" sx={{ ...typeRoles.label, color: 'text.secondary' }}>
                    {adminCopy.flaggedExplanations.raisedByHeading}
                  </Typography>
                  <Typography
                    component="p"
                    data-testid="flagged-raised-by"
                    sx={{ display: 'flex', alignItems: 'center', gap: `${density.gap}px` }}
                  >
                    <Flag size={16} aria-hidden="true" />
                    {entry.raisedBy
                      // `?? route` so a route this copy does not map yet renders as itself
                      // rather than as an empty string. Which route raised an entry is the
                      // fact that says whether a child was involved, and a silently blank
                      // one would read as an entry nobody raised.
                      .map((route) => adminCopy.flaggedExplanations.raisedBy[route] ?? route)
                      .join(', ')}
                  </Typography>
                </Box>

                {/* The prose, drawn by the one renderer of stored segments (AD-32): a
                        fraction an operator has to judge arrives as structure rather than as
                        a glyph. This is the thing being judged. */}
                <Box sx={{ display: 'grid', gap: `${density.gap / 2}px` }}>
                  <Typography component="h3" sx={{ ...typeRoles.label, color: 'text.secondary' }}>
                    {adminCopy.flaggedExplanations.explanationHeading}
                  </Typography>
                  {/* The paper role: generated content is drawn in the serif
                    Explanation type on a near-square sheet, the same as everywhere
                    else it is read. */}
                  <Typography
                    component="p"
                    data-testid="flagged-body"
                    sx={{
                      ...typeRoles.explanationBody,
                      p: `${density.cardPadding}px`,
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: `${rounded.paper}px`,
                      bgcolor: 'background.default',
                    }}
                  >
                    <RichText segments={entry.body} />
                  </Typography>
                </Box>

                {/* The identifiers, and only the identifiers: an operator has to be able
                        to name what they are judging, and no name, email, cost or tier is
                        part of that (AD-20, AD-26). */}
                <Box sx={{ display: 'grid', gap: `${density.gap / 2}px` }}>
                  <Typography component="h3" sx={{ ...typeRoles.label, color: 'text.secondary' }}>
                    {adminCopy.flaggedExplanations.identifiersHeading}
                  </Typography>
                  <Box
                    sx={{
                      display: 'grid',
                      columnGap: `${density.sectionMargin}px`,
                      rowGap: '2px',
                      gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
                    }}
                  >
                    <Identifier
                      label={adminCopy.flaggedExplanations.explanationIdLabel}
                      value={entry.explanationId}
                    />
                    <Identifier
                      label={adminCopy.flaggedExplanations.attemptIdLabel}
                      value={entry.attemptId}
                    />
                    <Identifier
                      label={adminCopy.flaggedExplanations.questionIdLabel}
                      value={entry.questionId}
                    />
                    <Identifier
                      label={adminCopy.flaggedExplanations.accountIdLabel}
                      value={entry.parentAccountId}
                    />
                    <Identifier
                      label={adminCopy.flaggedExplanations.studentIdLabel}
                      value={entry.studentProfileId}
                    />
                  </Box>
                </Box>
              </CardContent>
            </Card>
          ))}
        </Box>
      )}
    </Box>
  );
}
