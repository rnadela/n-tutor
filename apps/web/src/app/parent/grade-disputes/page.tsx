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
import {
  ArrowLeft,
  ArrowRight,
  CircleCheck,
  FileQuestion,
  Hourglass,
  MessageSquareWarning,
  Scale,
  Users,
} from 'lucide-react';
import { parentCopy } from '@/copy/parent';
import { useElevation } from '@/lib/elevation';
import { disputeOutcomeOf } from '@/lib/grade-dispute';
import {
  parentApi,
  ParentApiError,
  type GradeDisputeView,
  type StudentProfileView,
} from '@/lib/parent-api';
import { applyIfCurrent, endsParentView, readableInstant } from '@/lib/parent-view';
import { density, rounded } from '@/theme/tokens';

/**
 * The Attempt a dispute points at, typed against the app's generated route table rather than
 * left as a bare string — exactly as the reports list does it: a detail screen reached by a
 * URL this file invented would 404 in the browser rather than at compile time.
 */
function attemptHref(attemptId: string): Route<`/parent/attempts/${string}`> {
  return `/parent/attempts/${attemptId}`;
}

/**
 * `NextLink`, pinned to the Attempt route.
 *
 * MUI's `component` prop takes a concrete component, and handing it the generic `NextLink`
 * collapses its route parameter to `unknown` — under which every *dynamic* route stops being
 * a legal href, this one included.
 */
function AttemptLink(props: LinkProps<`/parent/attempts/${string}`>) {
  return <NextLink {...props} />;
}

/** When the student said it, dated when the stored instant parses and undated when not. */
function raisedSentence(disputedAt: string): string {
  const when = readableInstant(disputedAt);
  return when === null ? parentCopy.disputes.raisedUndated : parentCopy.disputes.raised(when);
}

/**
 * What has become of one dispute, as a whole sentence.
 *
 * **Awaiting is the absence of a decision**, so it is the answer for a null instant and not a
 * value anybody wrote — and there is no third sentence, because there is no control that
 * settles a dispute the other way. A resolved entry whose instant will not parse still says
 * that the mark was set: that is the fact, and only the date is unstateable.
 *
 * The outcome itself comes from the one pure function that decides it, which reads
 * `overriddenAt` and nothing else — the same rule the API derives it by. Comparing the two
 * marks here would answer "awaiting" for a parent who set a mark and then set it back, which
 * is a decision they demonstrably made.
 */
function outcomeSentence(entry: GradeDisputeView): string {
  if (disputeOutcomeOf(entry) === 'awaiting') return parentCopy.disputes.awaiting;
  const when = entry.overriddenAt === null ? null : readableInstant(entry.overriddenAt);
  return when === null ? parentCopy.disputes.resolvedUndated : parentCopy.disputes.resolved(when);
}

/**
 * Which run and which question a dispute points at, or a sentence for a context that no
 * longer resolves.
 *
 * Both figures are the server's. Nothing here derives an ordinal from a row's position in this
 * list: the run a child sat and the number they were shown are facts about the paper, not
 * about how many disputes happen to be listed above this one.
 */
function whereSentence(entry: GradeDisputeView): string {
  if (entry.runOrdinal === null || entry.questionOrdinal === null) {
    return parentCopy.disputes.whereUnknown;
  }
  return parentCopy.disputes.where(entry.runOrdinal, entry.questionOrdinal);
}

/**
 * Which marks one student says are wrong, and what each of them is now.
 *
 * **It exists because a dispute the parent cannot find is a dispute that did not surface.**
 * The Attempt-detail row shows an objection only to somebody who already opened that Attempt;
 * this is the screen that makes a child's raised hand reachable at all, and it is where
 * "listed for their parent per Student Profile" is true.
 *
 * **One child at a time**, chosen here and defaulting to the first, exactly as the runs list
 * and the reports list do: a dispute belongs to one child, and a list spanning two would make
 * "newest first" a question about whose.
 *
 * **It outlives the decision.** An entry awaiting a decision and a resolved one are both
 * listed, each marked with what it is — a screen that dropped resolved entries would make a
 * parent's own adjustment look like the objection never happened.
 *
 * **Nothing here sets a mark.** The one remedy is taken next to the question it is about, on
 * the Attempt-detail screen, because adjusting a mark without having read the reason is the
 * one thing this feature must not make easy. So every row's way on is a link, and the write
 * this app has for an adjustment is not called from here.
 *
 * **It is a plain parent screen and not the Analytics dashboard band.** Story 7.4 may later
 * mount something like it there; no Mastery figure, Weak Area or run score is here and none
 * has a shape here to travel in. No prose either — a reason is read next to the question it is
 * about.
 *
 * A profile the API returns nothing for renders the same sentence a child with nothing
 * disputed does, and this screen does not try to tell the two apart, because the API does not
 * either.
 */
export default function ParentGradeDisputesPage() {
  const router = useRouter();
  const { elevation, clearElevation } = useElevation();
  const token = elevation?.token ?? null;

  const [profiles, setProfiles] = useState<StudentProfileView[]>([]);
  const [studentProfileId, setStudentProfileId] = useState('');
  const [disputes, setDisputes] = useState<GradeDisputeView[]>([]);
  const [loading, setLoading] = useState(true);
  /**
   * Whether the disputes read has actually answered.
   *
   * Held apart from `loading`, because "not loading" is also what a *failed* read leaves
   * behind — and "this student has not said a mark is wrong" is a claim a screen that never
   * heard back is in no position to make.
   */
  const [loaded, setLoaded] = useState(false);
  /**
   * Whether the **profiles** read has answered, for the same reason and not by the same flag:
   * "there is no student profile yet" is a claim about the account, and an empty array is also
   * what this screen starts with and what a failed read leaves behind.
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

  // The profiles: they are what the selector is, and they do not change while this screen is
  // open — so this read is re-issued only by Retry, which is why `attempt` is a dependency.
  // Without it the one control on the screen would re-issue the disputes read alone, and a
  // failed profiles read would be recoverable only by reloading the page.
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
        // whatever the platform or the server put there, and none of it is a sentence written
        // for a parent to read. It is the *profiles* sentence rather than the list's, because
        // it is the profiles read that failed.
        setError(parentCopy.disputes.profilesFailed);
      },
    );
  }, [token, attempt, leave, router]);

  // The chosen child's disputes, re-read when the choice changes. The staleness guard is what
  // keeps a superseded read — outlived by switching children — from resolving after the fact
  // and overwriting the fresher list.
  useEffect(() => {
    if (token === null || studentProfileId === '') return;
    const issued = (requestId.current += 1);
    current.current.value = issued;
    setLoading(true);
    setLoaded(false);
    setError(null);

    parentApi.gradeDisputes(token, studentProfileId).then(
      applyIfCurrent(current.current, issued, (found: GradeDisputeView[]) => {
        setDisputes(found);
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
        // and rendered rather than restated — and this screen's own otherwise.
        setError(
          cause instanceof ParentApiError && cause.reason !== null
            ? cause.reason
            : parentCopy.disputes.listFailed,
        );
      }),
    );
  }, [token, studentProfileId, attempt, leave]);

  return (
    <Box
      component="section"
      sx={{ maxWidth: 840, mx: 'auto', display: 'grid', gap: `${density.gap * 2}px` }}
    >
      <Box component="header" sx={{ display: 'grid', gap: `${density.gap / 2}px` }}>
        <Typography component="h1" sx={{ fontSize: 20, fontWeight: 700 }}>
          {parentCopy.disputes.title}
        </Typography>
        <Typography component="p" sx={{ color: 'text.secondary' }}>
          {parentCopy.disputes.intro}
        </Typography>
      </Box>

      {error !== null && (
        <Alert
          severity="error"
          role="alert"
          variant="outlined"
          data-testid="parent-disputes-error"
          action={
            <Button type="button" onClick={() => setAttempt((value) => value + 1)}>
              {parentCopy.disputes.retry}
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      {profiles.length === 0 ? (
        // Only once the read has answered: an empty array is also the first render and what a
        // failed read leaves behind, and "there is no student profile yet" beside an alert
        // saying the profiles could not be read would be two statements with one untrue.
        profilesLoaded && (
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
            <Users size={28} aria-hidden="true" />
            <Typography component="p" data-testid="parent-disputes-no-students">
              {parentCopy.disputes.noStudents}
            </Typography>
          </Box>
        )
      ) : (
        <TextField
          select
          id="parent-disputes-student"
          size="small"
          label={parentCopy.disputes.studentLabel}
          sx={{ width: { xs: 1, sm: 320 } }}
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
        <Typography
          component="p"
          data-testid="parent-disputes-loading"
          sx={{ color: 'text.secondary' }}
        >
          {parentCopy.disputes.loading}
        </Typography>
      ) : (
        // Only once the disputes read has answered. "This student has not said a mark is
        // wrong" is a claim about the child, and a screen whose read failed cannot make it.
        loaded &&
        (disputes.length === 0 ? (
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
            <Scale size={28} aria-hidden="true" />
            <Typography component="p" data-testid="parent-disputes-empty">
              {parentCopy.disputes.empty}
            </Typography>
          </Box>
        ) : (
          <Box
            component="ul"
            // `listStyle: 'none'` strips list semantics in Safari/VoiceOver, and the item
            // count with them — which is the one thing a parent scanning what their child has
            // objected to needs announced. Put back by hand, as every other list does.
            role="list"
            sx={{ display: 'grid', gap: `${density.gap}px`, p: 0, m: 0 }}
          >
            {/* The API's order, newest first, and nothing here sorts: which objection is the
                newest is the server's answer, and re-deciding it in the browser would be a
                second opinion about it. */}
            {disputes.map((entry) => (
              <Card
                // The pair is the key, because the unique index makes one dispute per
                // (Attempt, Question) and a second press the same row.
                key={`${entry.attemptId}:${entry.questionId}`}
                component="li"
                role="listitem"
                sx={{
                  listStyle: 'none',
                  transition: (theme) => theme.transitions.create('border-color'),
                  '&:hover': { borderColor: 'primary.main' },
                }}
                data-testid="parent-dispute-row"
                data-outcome={disputeOutcomeOf(entry)}
              >
                <CardContent
                  sx={{
                    display: 'grid',
                    gap: `${density.gap * 1.5}px`,
                    '&:last-child': { pb: `${density.cardPadding + density.gap}px` },
                  }}
                >
                  <Box
                    sx={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: `${density.gap}px`,
                    }}
                  >
                    {/* The Subject, or a neutral stand-in for a classification that no longer
                        resolves: the row keeps its place and loses its label. */}
                    <Typography component="h2" variant="cardTitle">
                      {entry.subjectName ?? parentCopy.disputes.unknownSubject}
                    </Typography>
                    {/* Awaiting a decision, or that the mark was set and when. Both kinds are
                        listed: leaving a mark alone is a legitimate answer, not a deletion.
                        A pill, so the rows still needing the parent stand out on a scan; the
                        words carry the state and the tone only repeats it. */}
                    <Typography
                      component="p"
                      data-testid="parent-dispute-outcome"
                      sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: `${density.gap / 2}px`,
                        px: `${density.gap * 1.25}px`,
                        py: '2px',
                        borderRadius: 999,
                        border: '1px solid',
                        fontSize: '0.8125rem',
                        fontWeight: 600,
                        ...(disputeOutcomeOf(entry) === 'awaiting'
                          ? { color: 'warning.main', borderColor: 'warning.main' }
                          : { color: 'text.secondary', borderColor: 'divider' }),
                      }}
                    >
                      {disputeOutcomeOf(entry) === 'awaiting' ? (
                        <Hourglass size={14} aria-hidden="true" />
                      ) : (
                        <CircleCheck size={14} aria-hidden="true" />
                      )}
                      {outcomeSentence(entry)}
                    </Typography>
                  </Box>
                  <Box
                    sx={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      columnGap: `${density.gap * 2}px`,
                      rowGap: `${density.gap / 2}px`,
                      color: 'text.secondary',
                      '& > p': {
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: `${density.gap / 2}px`,
                        fontSize: '0.9375rem',
                      },
                    }}
                  >
                    {/* Which run and which question, both the server's figures. */}
                    <Typography component="p" data-testid="parent-dispute-where">
                      <FileQuestion size={16} aria-hidden="true" />
                      {whereSentence(entry)}
                    </Typography>
                    <Typography component="p" data-testid="parent-dispute-raised">
                      <MessageSquareWarning size={16} aria-hidden="true" />
                      {raisedSentence(entry.disputedAt)}
                    </Typography>
                  </Box>
                  {/* What the marking recorded, which an adjustment does not erase — and what
                      the mark counts as now. Both stated, even when they agree, so nothing is
                      implied by an omission; the arrow is the order they happened in. */}
                  <Box
                    sx={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: `${density.gap}px`,
                      px: `${density.cardPadding}px`,
                      py: `${density.gap}px`,
                      bgcolor: 'action.hover',
                      borderRadius: `${rounded.control}px`,
                    }}
                  >
                    <Typography component="p" data-testid="parent-dispute-recorded">
                      {parentCopy.disputes.recorded(parentCopy.disputes.grade[entry.recordedState])}
                    </Typography>
                    <Box component="span" sx={{ display: 'inline-flex', color: 'text.secondary' }}>
                      <ArrowRight size={16} aria-hidden="true" />
                    </Box>
                    <Typography
                      component="p"
                      data-testid="parent-dispute-effective"
                      sx={{ fontWeight: 600 }}
                    >
                      {parentCopy.disputes.effective(
                        parentCopy.disputes.grade[entry.effectiveState],
                      )}
                    </Typography>
                  </Box>
                  {/* The way through to the question itself, where the reason is read and the
                      mark is set. Client-side, so the provider holding the elevation bearer
                      stays mounted across the navigation. */}
                  <Button
                    component={AttemptLink}
                    href={attemptHref(entry.attemptId)}
                    variant={disputeOutcomeOf(entry) === 'awaiting' ? 'contained' : 'outlined'}
                    endIcon={<ArrowRight size={16} aria-hidden="true" />}
                    sx={{
                      minHeight: density.tapTarget,
                      justifySelf: 'end',
                      '& .MuiButton-endIcon': {
                        transition: (theme) => theme.transitions.create('transform'),
                      },
                      '&:hover .MuiButton-endIcon, &:focus-visible .MuiButton-endIcon': {
                        transform: 'translateX(2px)',
                      },
                    }}
                  >
                    {parentCopy.disputes.open}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </Box>
        ))
      )}

      <Link
        component={NextLink}
        href="/parent"
        sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px', justifySelf: 'start' }}
      >
        <ArrowLeft size={16} aria-hidden="true" />
        {parentCopy.disputes.backToParentView}
      </Link>
    </Box>
  );
}
