'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import NextLink, { type LinkProps } from 'next/link';
import type { Route } from 'next';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { Screen } from '@/components/Screen';
import { parentCopy } from '@/copy/parent';
import { useElevation } from '@/lib/elevation';
import {
  parentApi,
  ParentApiError,
  type ParentAttemptSummary,
  type StudentProfileView,
} from '@/lib/parent-api';
import { applyIfCurrent, endsParentView, readableInstant } from '@/lib/parent-view';
import { density } from '@/theme/tokens';

/**
 * One run's own address, which is the whole of the parent's position in this review.
 *
 * Spelled once and typed against the app's generated route table rather than left as
 * a bare string, exactly as `drafts/page.tsx` does it: a detail screen reached by a
 * URL this file invented would 404 in the browser rather than at compile time.
 */
function attemptHref(attemptId: string): Route<`/parent/attempts/${string}`> {
  return `/parent/attempts/${attemptId}`;
}

/**
 * `NextLink`, pinned to the Attempt route.
 *
 * MUI's `component` prop takes a concrete component, and handing it the generic
 * `NextLink` collapses its route parameter to `unknown` — under which every *dynamic*
 * route stops being a legal href, this one included.
 */
function AttemptLink(props: LinkProps<`/parent/attempts/${string}`>) {
  return <NextLink {...props} />;
}

/**
 * When a run went in, as a whole sentence — dated when the stored instant parses and
 * undated when it does not.
 *
 * Both sentences are `parentCopy`'s; the only decision here is which of them applies,
 * and it is made through `readableInstant` so no parent screen renders the words
 * "Invalid Date" at a parent.
 */
function submittedSentence(submittedAt: string): string {
  const when = readableInstant(submittedAt);
  return when === null ? parentCopy.attempts.submittedUndated : parentCopy.attempts.submitted(when);
}

/**
 * A child's finished practice tests: the way in to reading what they were told.
 *
 * **One child at a time**, chosen here, because a run belongs to one child and a list
 * spanning two would make "newest first" a question about whose. The selector defaults
 * to the first profile, so the screen arrives having already answered something rather
 * than asking a parent to pick before it shows anything.
 *
 * A profile with nothing handed in renders a sentence, not an error — and so does a
 * profile the API returns nothing for, which is the same answer. This screen does not
 * try to tell those apart, because the API does not either.
 *
 * Nothing here reads an Explanation and nothing here generates one: this is a list of
 * runs, and the prose is one run's detail screen.
 */
export default function ParentAttemptsPage() {
  const router = useRouter();
  const { elevation, clearElevation } = useElevation();
  const token = elevation?.token ?? null;

  const [profiles, setProfiles] = useState<StudentProfileView[]>([]);
  const [studentProfileId, setStudentProfileId] = useState('');
  const [runs, setRuns] = useState<ParentAttemptSummary[]>([]);
  const [loading, setLoading] = useState(true);
  /**
   * Whether the runs read has actually answered.
   *
   * Held apart from `loading`, because "not loading" is also what a *failed* read
   * leaves behind — and "this student has handed nothing in" is a claim a screen that
   * never heard back is in no position to make.
   */
  const [loaded, setLoaded] = useState(false);
  /**
   * Whether the **profiles** read has answered, for the same reason and not by the same
   * flag.
   *
   * "There is no student profile yet" is a claim about the account, and an empty array
   * is also what this screen starts with and what a failed read leaves behind — so
   * without this a parent whose read failed would be told they have no child, directly
   * beside an error alert saying the read did not happen.
   */
  const [profilesLoaded, setProfilesLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Bumped by Retry, so a load that stopped on an error re-issues. */
  const [attempt, setAttempt] = useState(0);

  const requestId = useRef(0);
  /** The same object identity across renders, so the guard reads live state. */
  const current = useRef({ value: 0 });
  current.current.value = requestId.current;

  const leave = useCallback(() => {
    clearElevation();
    router.replace('/parent/pin');
  }, [clearElevation, router]);

  // The profiles: they are what the selector is, and they do not change while this
  // screen is open — so this read is re-issued only by Retry, which is why `attempt` is
  // a dependency. Without it the one control on the screen would re-issue the runs read
  // alone, and a failed profiles read would be recoverable only by reloading the page.
  useEffect(() => {
    if (token === null) {
      // No token in memory: a reload, a new tab, or a parent who has left.
      router.replace('/parent/pin');
      return;
    }
    setProfilesLoaded(false);
    parentApi.students(token).then(
      (found: StudentProfileView[]) => {
        setProfiles(found);
        setProfilesLoaded(true);
        // The first child, so the screen arrives having answered something. A parent
        // who wants another one changes it; a parent with one child never has to.
        setStudentProfileId((chosen) => (chosen === '' ? (found[0]?.id ?? '') : chosen));
        if (found.length === 0) setLoading(false);
      },
      (cause: unknown) => {
        if (endsParentView(cause)) {
          leave();
          return;
        }
        setLoading(false);
        setError(cause instanceof Error ? cause.message : parentCopy.attempts.listFailed);
      },
    );
  }, [token, attempt, leave, router]);

  // The chosen child's runs, re-read when the choice changes. The staleness guard is
  // what keeps a superseded read — outlived by switching children — from resolving
  // after the fact and overwriting the fresher list.
  useEffect(() => {
    if (token === null || studentProfileId === '') return;
    const issued = (requestId.current += 1);
    current.current.value = issued;
    setLoading(true);
    setLoaded(false);
    setError(null);

    parentApi.studentAttempts(token, studentProfileId).then(
      applyIfCurrent(current.current, issued, (found: ParentAttemptSummary[]) => {
        setRuns(found);
        setLoaded(true);
        setLoading(false);
      }),
      applyIfCurrent(current.current, issued, (cause: unknown) => {
        if (endsParentView(cause)) {
          leave();
          return;
        }
        setLoading(false);
        setError(
          cause instanceof ParentApiError && cause.reason !== null
            ? cause.reason
            : cause instanceof Error
              ? cause.message
              : parentCopy.attempts.listFailed,
        );
      }),
    );
  }, [token, studentProfileId, attempt, leave]);

  return (
    <Screen>
      <Typography component="h1" sx={{ fontSize: 24, fontWeight: 700 }}>
        {parentCopy.attempts.listTitle}
      </Typography>
      <Typography component="p">{parentCopy.attempts.listIntro}</Typography>

      {error !== null && (
        <Alert
          severity="error"
          role="alert"
          variant="outlined"
          data-testid="parent-attempts-error"
          action={
            <Button type="button" onClick={() => setAttempt((value) => value + 1)}>
              {parentCopy.attempts.retry}
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      {profiles.length === 0 ? (
        // An account with no child has no runs to list and no selector to offer. The
        // way on is the Students screen, and the link below is the way to it.
        //
        // Only once the read has answered: an empty array is also the first render and
        // what a failed read leaves behind, and "there is no student profile yet" beside
        // an alert saying the profiles could not be read would be two statements with
        // one of them untrue.
        profilesLoaded && (
          <Typography component="p" data-testid="parent-attempts-no-students">
            {parentCopy.attempts.noStudents}
          </Typography>
        )
      ) : (
        <TextField
          select
          id="parent-attempts-student"
          label={parentCopy.attempts.studentLabel}
          value={studentProfileId}
          onChange={(event) => setStudentProfileId(event.target.value)}
        >
          {profiles.map((profile) => (
            <MenuItem key={profile.id} value={profile.id}>
              {profile.displayName}
            </MenuItem>
          ))}
        </TextField>
      )}

      {loading ? (
        <Typography component="p" data-testid="parent-attempts-loading">
          {parentCopy.attempts.loading}
        </Typography>
      ) : (
        // Only once the runs read has answered. "This student has handed nothing in"
        // is a claim about the child, and a screen whose read failed cannot make it.
        loaded &&
        (runs.length === 0 ? (
          <Typography component="p" data-testid="parent-attempts-empty">
            {parentCopy.attempts.empty}
          </Typography>
        ) : (
          <Box
            component="ul"
            // `listStyle: 'none'` strips list semantics in Safari/VoiceOver, and the
            // item count with them — which is the one thing a parent scanning what
            // their child has finished needs announced. Put back by hand, exactly as
            // the drafts list does.
            role="list"
            sx={{ display: 'grid', gap: `${density.gap}px`, p: 0, m: 0 }}
          >
            {runs.map((run) => (
              <Card
                key={run.attemptId}
                component="li"
                role="listitem"
                sx={{ listStyle: 'none' }}
                data-testid="parent-attempt-row"
                data-attempt-id={run.attemptId}
              >
                <CardContent sx={{ display: 'grid', gap: `${density.gap}px` }}>
                  {/* The Subject, or a neutral stand-in for a classification that no
                      longer resolves: the row keeps its place and loses its label. */}
                  <Typography component="h2" variant="cardTitle">
                    {run.subjectName ?? parentCopy.attempts.unknownSubject}
                  </Typography>
                  {/* The server's ordinal, which is which run of that test this is.
                      Never this row's position in the list. */}
                  <Typography component="p" data-testid="parent-attempt-run">
                    {parentCopy.attempts.run(run.ordinal)}
                  </Typography>
                  {/* The instant, in the device's own formatting — and the same fact
                      without one if the stored string will not parse. The run was handed
                      in either way, which is why it is in this list at all; "Handed in
                      Invalid Date" would read as a fault in the practice test rather
                      than in a string, and a screen reader would say those words. */}
                  <Typography component="p" data-testid="parent-attempt-submitted">
                    {submittedSentence(run.submittedAt)}
                  </Typography>
                  {/* Client-side, so the provider holding the elevation bearer stays
                      mounted across the navigation. */}
                  <Link
                    component={AttemptLink}
                    href={attemptHref(run.attemptId)}
                    sx={{ minHeight: density.tapTarget }}
                  >
                    {parentCopy.attempts.open}
                  </Link>
                </CardContent>
              </Card>
            ))}
          </Box>
        ))
      )}

      <Link component={NextLink} href="/parent">
        {parentCopy.attempts.backToParentView}
      </Link>
    </Screen>
  );
}
