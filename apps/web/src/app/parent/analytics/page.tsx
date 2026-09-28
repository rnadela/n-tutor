'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import NextLink from 'next/link';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { Addressed, AddressProvider } from '@/components/Address';
import { Screen } from '@/components/Screen';
import { parentCopy } from '@/copy/parent';
import { emptyStateProgress, filterBySubject, subjectOptions } from '@/lib/analytics-view';
import { dateOnly, limitLabel } from '@/lib/consumption-format';
import { useElevation } from '@/lib/elevation';
import {
  parentApi,
  ParentApiError,
  type ProfileAnalyticsView,
  type StudentProfileView,
} from '@/lib/parent-api';
import { applyIfCurrent, endsParentView } from '@/lib/parent-view';
import { density, typeRoles } from '@/theme/tokens';
import { MasteryTable } from './_components/MasteryTable';
import { TrendSparkline } from './_components/TrendSparkline';

/** The sentinel a `<TextField select>` needs for "no choice", which cannot be null. */
const EVERY_SUBJECT = '__every__';
/** The option value standing for the rows whose subject no longer resolves. */
const NO_SUBJECT = '__none__';

/**
 * Where one student is strong and where they are weak.
 *
 * **The epic's whole parent-facing promise, and the only place it is kept.** Every
 * figure of Stories 7.1 to 7.3 — the canonical topics, the stored mastery, the Weak
 * Area verdict — was written and read by nothing until this screen. It is reachable
 * only from Parent View and only past the PIN.
 *
 * **One read, staged behind the profiles read**, exactly as the disputes screen
 * does it: the profiles are the selector and do not change while this is open, so
 * only Retry re-issues them; the dashboard is re-read when the chosen student
 * changes, guarded by `applyIfCurrent` so a superseded read cannot resolve after
 * the fact and put one student's figures under another's name.
 *
 * **Every sentence about the student is a function of the address.** The content
 * sits inside an `AddressProvider surface="parent"`, which resolves third person by
 * name — no copy here names a child in a literal (UX-DR31).
 *
 * **Not one threshold, ceiling or window size is stated by this app.** The answered
 * floor the empty state quotes, and the window the chart states, both arrive on the
 * response; restating either here would drift the first time an operator changed
 * the environment.
 *
 * **It decides nothing and generates nothing.** There is no way from a row into a
 * question list and no control that makes more work — those are Story 7.5 — and the
 * two digest lines are links into the screens that already own those decisions.
 * Nothing on this page writes.
 *
 * A student the API returns nothing for renders the same empty state a student with
 * no finished work does, and this screen does not try to tell the two apart,
 * because the API does not either.
 */
export default function ParentAnalyticsPage() {
  const router = useRouter();
  const { elevation, clearElevation } = useElevation();
  const token = elevation?.token ?? null;

  const [profiles, setProfiles] = useState<StudentProfileView[]>([]);
  const [studentProfileId, setStudentProfileId] = useState('');
  const [analytics, setAnalytics] = useState<ProfileAnalyticsView | null>(null);
  const [subjectChoice, setSubjectChoice] = useState(EVERY_SUBJECT);
  const [loading, setLoading] = useState(true);
  /**
   * Whether the dashboard read has actually answered. Held apart from `loading`,
   * because "not loading" is also what a *failed* read leaves behind — and "there
   * is nothing to show yet" is a claim a screen that never heard back cannot make.
   */
  const [loaded, setLoaded] = useState(false);
  /** The same, for the profiles read: "there is no profile" is a different claim. */
  const [profilesLoaded, setProfilesLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Bumped by Retry, so a load that stopped on an error re-issues. */
  const [attempt, setAttempt] = useState(0);

  const requestId = useRef(0);
  /** The student the last dashboard read was issued for, so Retry alone — without
   * a student switch — does not discard the parent's Subject narrowing. */
  const lastReadFor = useRef<string | null>(null);
  /**
   * The same object identity across renders, so the guard reads live state.
   *
   * It is written **only inside the effect that issues a read**, never in the
   * render body: a render is not a commit, and React may run one and throw it
   * away — a body that mutated this could retire a request that is still the
   * live one, and the guard would then drop its response.
   */
  const current = useRef({ value: 0 });

  const leave = useCallback(() => {
    clearElevation();
    router.replace('/parent/pin');
  }, [clearElevation, router]);

  // The profiles: they are what the selector is, and they do not change while this
  // screen is open — so this read is re-issued only by Retry, which is why
  // `attempt` is a dependency. Without it the one control on the screen would
  // re-issue the dashboard read alone, and a failed profiles read would be
  // recoverable only by reloading the page.
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
        // A Retry that reaches here has succeeded — a stale profiles-read error
        // must not sit next to a screen that just proved the read now works, even
        // when the answer is zero profiles (the dashboard effect never runs to
        // clear it itself, since it early-returns on an empty `studentProfileId`).
        setError(null);
        // Keep the choice if it is still one of the answers, and fall back to the
        // first otherwise. A Retry that reloads the list after a profile was
        // archived elsewhere would otherwise leave a selected id that matches no
        // row: the picker shows nothing chosen and the body renders nothing at
        // all, with no message explaining why.
        setStudentProfileId((chosen) =>
          found.some((profile) => profile.id === chosen) ? chosen : (found[0]?.id ?? ''),
        );
        if (found.length === 0) setLoading(false);
      },
      (cause: unknown) => {
        if (endsParentView(cause)) {
          leave();
          return;
        }
        setLoading(false);
        // This screen's own sentence, and **never `cause.message`**: a rejection
        // carries whatever the platform or the server put there, and none of it is
        // written for a parent to read. The *profiles* sentence, because it is the
        // profiles read that failed.
        setError(parentCopy.analytics.profilesFailed);
      },
    );
  }, [token, attempt, leave, router]);

  // The chosen student's dashboard, re-read when the choice changes.
  useEffect(() => {
    if (token === null || studentProfileId === '') return;
    const issued = (requestId.current += 1);
    current.current.value = issued;
    setLoading(true);
    setLoaded(false);
    setError(null);
    // The narrowing belongs to the student it was made about: keeping it across a
    // switch would filter one child's table by another child's subject. Retry
    // alone re-issues this same effect (it depends on `attempt`) without the
    // student changing, and must not discard a choice that was never about a
    // different child.
    if (lastReadFor.current !== studentProfileId) setSubjectChoice(EVERY_SUBJECT);
    lastReadFor.current = studentProfileId;

    parentApi.profileAnalytics(token, studentProfileId).then(
      applyIfCurrent(current.current, issued, (found: ProfileAnalyticsView) => {
        setAnalytics(found);
        setLoaded(true);
        setLoading(false);
      }),
      applyIfCurrent(current.current, issued, (cause: unknown) => {
        if (endsParentView(cause)) {
          leave();
          return;
        }
        setLoading(false);
        // The API's own sentence when it authored one — those are written once,
        // server-side, and rendered rather than restated — and this screen's own
        // otherwise.
        setError(
          cause instanceof ParentApiError && cause.reason !== null
            ? cause.reason
            : parentCopy.analytics.loadFailed,
        );
      }),
    );
  }, [token, studentProfileId, attempt, leave]);

  const chosen = profiles.find((profile) => profile.id === studentProfileId) ?? null;
  const options = analytics === null ? [] : subjectOptions(analytics.topics);
  const visibleTopics =
    analytics === null
      ? []
      : filterBySubject(
          analytics.topics,
          subjectChoice === EVERY_SUBJECT
            ? undefined
            : subjectChoice === NO_SUBJECT
              ? null
              : subjectChoice,
        );
  const narrowedTo =
    subjectChoice === EVERY_SUBJECT
      ? null
      : (options.find((option) => (option.subjectId ?? NO_SUBJECT) === subjectChoice)
          ?.subjectName ?? parentCopy.analytics.unknownSubject);

  return (
    <Screen>
      <Typography component="h1" sx={{ fontSize: 24, fontWeight: 700 }}>
        {parentCopy.analytics.title}
      </Typography>
      <Typography component="p">{parentCopy.analytics.intro}</Typography>

      {error !== null && (
        <Alert
          severity="error"
          role="alert"
          variant="outlined"
          data-testid="parent-analytics-error"
          action={
            <Button type="button" onClick={() => setAttempt((value) => value + 1)}>
              {parentCopy.analytics.retry}
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      {profiles.length === 0 ? (
        // Only once the read has answered: an empty array is also the first render
        // and what a failed read leaves behind, and "there is no profile yet"
        // beside an alert saying the profiles could not be read would be two
        // statements with one untrue.
        profilesLoaded && (
          <Typography component="p" data-testid="parent-analytics-no-students">
            {parentCopy.analytics.noStudents}
          </Typography>
        )
      ) : (
        <TextField
          select
          id="parent-analytics-student"
          label={parentCopy.analytics.studentLabel}
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
        <Typography component="p" data-testid="parent-analytics-loading">
          {parentCopy.analytics.loading}
        </Typography>
      ) : (
        // Only once the dashboard read has answered, and only with a student to
        // name: every sentence below is about them, and `resolveAddress` refuses an
        // empty subject rather than rendering a sentence with a hole in it.
        loaded &&
        analytics !== null &&
        chosen !== null && (
          <AddressProvider surface="parent" subject={chosen.displayName}>
            <Box sx={{ display: 'grid', gap: `${density.sectionMargin}px` }}>
              {/* What is waiting and what is done, across every released test. */}
              <Box component="section" sx={{ display: 'grid', gap: `${density.gap}px` }}>
                <Typography component="h2" variant="cardTitle">
                  {parentCopy.analytics.activityTitle}
                </Typography>
                <Addressed>
                  {(address) => (
                    <Typography
                      component="p"
                      sx={{ ...typeRoles.dashboardBody }}
                      data-testid="analytics-activity"
                    >
                      {parentCopy.analytics.activity(address.Name, analytics.activity)}
                    </Typography>
                  )}
                </Addressed>
                <Typography component="p" data-testid="analytics-activity-breakdown">
                  {parentCopy.analytics.activityBreakdown(analytics.activity)}
                </Typography>
              </Box>

              {/* The one trend on the page, stating its own window and scope. */}
              <Addressed>
                {(address) => (
                  <TrendSparkline
                    points={analytics.trend.points}
                    windowSize={analytics.trend.windowSize}
                    name={address.name}
                  />
                )}
              </Addressed>

              {/* The ranked table, or the empty state that says what makes one
                  appear. */}
              <Box component="section" sx={{ display: 'grid', gap: `${density.gap}px` }}>
                {analytics.topics.length === 0 ? (
                  <Addressed>
                    {(address) => {
                      // From the **activity summary**, not from the topics: this
                      // branch only runs when there are no topic rows, so a signal
                      // read off them would be a constant — the progress sentence
                      // would be unreachable and a student who has finished work
                      // would be told they have finished none.
                      const progress = emptyStateProgress(
                        analytics.activity,
                        analytics.weakArea.answeredFloor,
                      );
                      return (
                        <Box
                          sx={{ display: 'grid', gap: `${density.gap}px` }}
                          data-testid="analytics-empty"
                        >
                          <Typography component="h2" variant="cardTitle">
                            {parentCopy.analytics.emptyTitle}
                          </Typography>
                          {/* The mechanism, with the figure the API resolved. */}
                          <Typography component="p" sx={{ ...typeRoles.dashboardBody }}>
                            {parentCopy.analytics.empty(address.Name, progress.answeredFloor)}
                          </Typography>
                          {/* And how far along it is. "Nothing started yet" reads
                              as a beginning; telling a parent who has finished two
                              tests the same thing reads as a broken product. */}
                          <Typography component="p" data-testid="analytics-empty-progress">
                            {progress.hasWork
                              ? parentCopy.analytics.emptyProgress(progress)
                              : parentCopy.analytics.emptyNoWork}
                          </Typography>
                        </Box>
                      );
                    }}
                  </Addressed>
                ) : (
                  <>
                    <Typography component="h2" variant="cardTitle" data-testid="analytics-topics">
                      {narrowedTo === null
                        ? parentCopy.analytics.masteryTitle
                        : parentCopy.analytics.subjectHeading(narrowedTo)}
                    </Typography>
                    {/* Only the subjects actually present: offering one the student
                        has no topic in would empty the table and say nothing. */}
                    {options.length > 1 && (
                      <TextField
                        select
                        id="parent-analytics-subject"
                        label={parentCopy.analytics.subjectLabel}
                        value={subjectChoice}
                        onChange={(event) => setSubjectChoice(event.target.value)}
                      >
                        <MenuItem value={EVERY_SUBJECT}>
                          {parentCopy.analytics.allSubjects}
                        </MenuItem>
                        {options.map((option) => (
                          <MenuItem
                            key={option.subjectId ?? NO_SUBJECT}
                            value={option.subjectId ?? NO_SUBJECT}
                          >
                            {option.subjectName ?? parentCopy.analytics.unknownSubject}
                          </MenuItem>
                        ))}
                      </TextField>
                    )}
                    <Addressed>
                      {(address) => (
                        <MasteryTable
                          topics={visibleTopics}
                          heading={
                            narrowedTo === null
                              ? parentCopy.analytics.masteryTitle
                              : parentCopy.analytics.subjectHeading(narrowedTo)
                          }
                          windowSize={analytics.trend.windowSize}
                          name={address.name}
                        />
                      )}
                    </Addressed>
                  </>
                )}
              </Box>

              {/* The digest: what is waiting for the parent, each with the screen
                  that already owns the decision. Nothing is decided here. */}
              <Card component="section" data-testid="analytics-digest">
                <CardContent sx={{ display: 'grid', gap: `${density.gap}px` }}>
                  <Typography component="h2" variant="cardTitle">
                    {parentCopy.analytics.digestTitle}
                  </Typography>
                  <Typography component="p" data-testid="analytics-digest-disputes">
                    {analytics.digest.disputesAwaiting === 0
                      ? parentCopy.analytics.disputesNone
                      : parentCopy.analytics.disputes(analytics.digest.disputesAwaiting)}
                  </Typography>
                  {/* Client-side, so the provider holding the elevation bearer
                      stays mounted across the navigation. */}
                  <Link
                    component={NextLink}
                    href="/parent/grade-disputes"
                    sx={{ minHeight: density.tapTarget }}
                  >
                    {parentCopy.analytics.openDisputes}
                  </Link>
                  <Typography component="p" data-testid="analytics-digest-flags">
                    {analytics.digest.explanationFlagsAwaiting === 0
                      ? parentCopy.analytics.flagsNone
                      : parentCopy.analytics.flags(analytics.digest.explanationFlagsAwaiting)}
                  </Typography>
                  <Link
                    component={NextLink}
                    href="/parent/explanation-flags"
                    sx={{ minHeight: density.tapTarget }}
                  >
                    {parentCopy.analytics.openFlags}
                  </Link>

                  {/* The Explanation counter, stated as the account's — it is
                      shared by every student on it and is not this one's budget.
                      Formatted in the account's own zone, never the device's. */}
                  <Typography component="h3" sx={{ ...typeRoles.label }}>
                    {parentCopy.analytics.allowanceTitle}
                  </Typography>
                  <Typography component="p" data-testid="analytics-allowance">
                    {analytics.explanationAllowance.limit === null
                      ? parentCopy.analytics.allowanceUnlimited(analytics.explanationAllowance.used)
                      : parentCopy.analytics.allowanceUsed(
                          analytics.explanationAllowance.used,
                          limitLabel(analytics.explanationAllowance.limit),
                        )}
                  </Typography>
                  <Typography component="p" data-testid="analytics-allowance-resets">
                    {parentCopy.analytics.allowanceResets(
                      dateOnly(
                        analytics.explanationAllowance.resetAt,
                        analytics.explanationAllowance.timezone,
                      ),
                    )}
                  </Typography>
                </CardContent>
              </Card>
            </Box>
          </AddressProvider>
        )
      )}

      <Link component={NextLink} href="/parent">
        {parentCopy.analytics.backToParentView}
      </Link>
    </Screen>
  );
}
