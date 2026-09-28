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
  type StudentExplanationFlagView,
  type StudentProfileView,
} from '@/lib/parent-api';
import { applyIfCurrent, endsParentView, readableInstant } from '@/lib/parent-view';
import { density } from '@/theme/tokens';

/**
 * The Attempt a report points at, typed against the app's generated route table rather
 * than left as a bare string — exactly as the runs list does it: a detail screen reached
 * by a URL this file invented would 404 in the browser rather than at compile time.
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

/** When the child reported it, dated when the stored instant parses and undated when not. */
function reportedSentence(flaggedAt: string): string {
  const when = readableInstant(flaggedAt);
  return when === null ? parentCopy.flags.reportedUndated : parentCopy.flags.reported(when);
}

/**
 * What has been decided about one report, as a whole sentence.
 *
 * Awaiting is the **absence** of a decision, so it is the answer for a null disposition
 * and not a value anybody wrote. A decided entry whose instant will not parse still says
 * which decision was made — that is the fact, and only the date is unstateable.
 */
function decisionSentence(entry: StudentExplanationFlagView): string {
  if (entry.disposition === null) return parentCopy.flags.awaiting;
  const when = entry.dispositionAt === null ? null : readableInstant(entry.dispositionAt);
  if (entry.disposition === 'Confirmed') {
    return when === null ? parentCopy.flags.confirmedUndated : parentCopy.flags.confirmed(when);
  }
  return when === null ? parentCopy.flags.dismissedUndated : parentCopy.flags.dismissed(when);
}

/**
 * Which run and which question a report points at, or a sentence for a context that no
 * longer resolves.
 *
 * Both figures are the server's. Nothing here derives an ordinal from a row's position in
 * this list: the run a child sat and the number they were shown are facts about the paper,
 * not about how many reports happen to be listed above this one.
 */
function whereSentence(entry: StudentExplanationFlagView): string {
  if (entry.runOrdinal === null || entry.questionOrdinal === null) {
    return parentCopy.flags.whereUnknown;
  }
  return parentCopy.flags.where(entry.runOrdinal, entry.questionOrdinal);
}

/**
 * What one child has reported, and what has been decided about each of it.
 *
 * **It exists because a report the parent cannot find is a report that did not surface.**
 * The Attempt-detail region shows a concern only to somebody who already opened that
 * Attempt; this is the screen that makes a child's report reachable at all, and it is
 * where "listed for that child as awaiting a decision" is true.
 *
 * **One child at a time**, chosen here and defaulting to the first, exactly as the runs
 * list does: a report belongs to one child, and a list spanning two would make "newest
 * first" a question about whose.
 *
 * **It outlives the decision.** An awaiting report and a decided one are both listed, each
 * marked with what it is — a screen that dropped decided entries would make a parent's own
 * dismissal look like the concern never happened.
 *
 * **Nothing here decides anything and nothing here generates.** The two decisions are made
 * next to the prose they are about, on the Attempt-detail screen, because deciding without
 * having read the explanation is the one thing this feature must not make easy. So every
 * row's way on is a link, and the one `parentApi.` write this app has for a disposition is
 * not called from here.
 *
 * **It is a plain parent screen and not the Analytics dashboard band.** Story 7.4 may later
 * mount something like it there; 6.5's dispute flags, grade overrides and Mastery figures
 * are not here and have no shape here to travel in.
 *
 * A profile the API returns nothing for renders the same sentence a child with no reports
 * does, and this screen does not try to tell the two apart, because the API does not either.
 */
export default function ParentExplanationFlagsPage() {
  const router = useRouter();
  const { elevation, clearElevation } = useElevation();
  const token = elevation?.token ?? null;

  const [profiles, setProfiles] = useState<StudentProfileView[]>([]);
  const [studentProfileId, setStudentProfileId] = useState('');
  const [flags, setFlags] = useState<StudentExplanationFlagView[]>([]);
  const [loading, setLoading] = useState(true);
  /**
   * Whether the flags read has actually answered.
   *
   * Held apart from `loading`, because "not loading" is also what a *failed* read leaves
   * behind — and "this student has reported nothing" is a claim a screen that never heard
   * back is in no position to make.
   */
  const [loaded, setLoaded] = useState(false);
  /**
   * Whether the **profiles** read has answered, for the same reason and not by the same
   * flag: "there is no student profile yet" is a claim about the account, and an empty
   * array is also what this screen starts with and what a failed read leaves behind.
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

  // The profiles: they are what the selector is, and they do not change while this screen
  // is open — so this read is re-issued only by Retry, which is why `attempt` is a
  // dependency. Without it the one control on the screen would re-issue the flags read
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
        setStudentProfileId((chosen) => (chosen === '' ? (found[0]?.id ?? '') : chosen));
        if (found.length === 0) setLoading(false);
      },
      (cause: unknown) => {
        if (endsParentView(cause)) {
          leave();
          return;
        }
        setLoading(false);
        // This screen's own sentence, and **never `cause.message`**: a rejection carries
        // whatever the platform or the server put there — "Failed to fetch", a stack-shaped
        // string, an upstream's own wording — and none of it is a sentence written for a
        // parent to read (AD-32). It is the *profiles* sentence rather than the list's,
        // because it is the profiles read that failed: saying the reports could not be
        // listed would name the wrong thing beside a selector that is empty for a reason
        // the sentence does not give.
        setError(parentCopy.flags.profilesFailed);
      },
    );
  }, [token, attempt, leave, router]);

  // The chosen child's reports, re-read when the choice changes. The staleness guard is
  // what keeps a superseded read — outlived by switching children — from resolving after
  // the fact and overwriting the fresher list.
  useEffect(() => {
    if (token === null || studentProfileId === '') return;
    const issued = (requestId.current += 1);
    current.current.value = issued;
    setLoading(true);
    setLoaded(false);
    setError(null);

    parentApi.studentExplanationFlags(token, studentProfileId).then(
      applyIfCurrent(current.current, issued, (found: StudentExplanationFlagView[]) => {
        setFlags(found);
        setLoaded(true);
        setLoading(false);
      }),
      applyIfCurrent(current.current, issued, (cause: unknown) => {
        if (endsParentView(cause)) {
          leave();
          return;
        }
        setLoading(false);
        // The API's own sentence when it authored one — those are written once, server-side,
        // and rendered rather than restated — and this screen's own otherwise. Never
        // `cause.message`: a platform or upstream string is not a sentence written for a
        // parent to read (AD-32).
        setError(
          cause instanceof ParentApiError && cause.reason !== null
            ? cause.reason
            : parentCopy.flags.listFailed,
        );
      }),
    );
  }, [token, studentProfileId, attempt, leave]);

  return (
    <Screen>
      <Typography component="h1" sx={{ fontSize: 24, fontWeight: 700 }}>
        {parentCopy.flags.title}
      </Typography>
      <Typography component="p">{parentCopy.flags.intro}</Typography>

      {error !== null && (
        <Alert
          severity="error"
          role="alert"
          variant="outlined"
          data-testid="parent-flags-error"
          action={
            <Button type="button" onClick={() => setAttempt((value) => value + 1)}>
              {parentCopy.flags.retry}
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      {profiles.length === 0 ? (
        // Only once the read has answered: an empty array is also the first render and
        // what a failed read leaves behind, and "there is no student profile yet" beside
        // an alert saying the profiles could not be read would be two statements with one
        // of them untrue.
        profilesLoaded && (
          <Typography component="p" data-testid="parent-flags-no-students">
            {parentCopy.flags.noStudents}
          </Typography>
        )
      ) : (
        <TextField
          select
          id="parent-flags-student"
          label={parentCopy.flags.studentLabel}
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
        <Typography component="p" data-testid="parent-flags-loading">
          {parentCopy.flags.loading}
        </Typography>
      ) : (
        // Only once the flags read has answered. "This student has reported nothing" is a
        // claim about the child, and a screen whose read failed cannot make it.
        loaded &&
        (flags.length === 0 ? (
          <Typography component="p" data-testid="parent-flags-empty">
            {parentCopy.flags.empty}
          </Typography>
        ) : (
          <Box
            component="ul"
            // `listStyle: 'none'` strips list semantics in Safari/VoiceOver, and the item
            // count with them — which is the one thing a parent scanning what their child
            // has reported needs announced. Put back by hand, as every other list does.
            role="list"
            sx={{ display: 'grid', gap: `${density.gap}px`, p: 0, m: 0 }}
          >
            {/* The API's order, newest first, and nothing here sorts: which report is the
                newest is the server's answer and re-deciding it in the browser would be a
                second opinion about it. */}
            {flags.map((entry) => (
              <Card
                key={`${entry.attemptId}:${entry.questionId}`}
                component="li"
                role="listitem"
                sx={{ listStyle: 'none' }}
                data-testid="parent-flag-row"
                data-disposition={entry.disposition ?? 'awaiting'}
              >
                <CardContent sx={{ display: 'grid', gap: `${density.gap}px` }}>
                  {/* The Subject, or a neutral stand-in for a classification that no
                      longer resolves: the row keeps its place and loses its label. */}
                  <Typography component="h2" variant="cardTitle">
                    {entry.subjectName ?? parentCopy.flags.unknownSubject}
                  </Typography>
                  {/* Which run and which question, both the server's figures. */}
                  <Typography component="p" data-testid="parent-flag-where">
                    {whereSentence(entry)}
                  </Typography>
                  <Typography component="p" data-testid="parent-flag-reported">
                    {reportedSentence(entry.flaggedAt)}
                  </Typography>
                  {/* Awaiting a decision, or which one was made and when. Both kinds are
                      listed: a dismissal is not a deletion. */}
                  <Typography component="p" data-testid="parent-flag-decision">
                    {decisionSentence(entry)}
                  </Typography>
                  {/* The way through to the explanation itself, which is read beside the
                      Question it is about — and where the decision is made. Client-side,
                      so the provider holding the elevation bearer stays mounted across
                      the navigation. */}
                  <Link
                    component={AttemptLink}
                    href={attemptHref(entry.attemptId)}
                    sx={{ minHeight: density.tapTarget }}
                  >
                    {parentCopy.flags.open}
                  </Link>
                </CardContent>
              </Card>
            ))}
          </Box>
        ))
      )}

      <Link component={NextLink} href="/parent">
        {parentCopy.flags.backToParentView}
      </Link>
    </Screen>
  );
}
