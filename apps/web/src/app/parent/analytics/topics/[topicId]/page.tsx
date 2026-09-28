'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import NextLink from 'next/link';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { AnswerKeyRow, type AnswerKeyRowLabels } from '@/components/AnswerKeyRow';
import { Addressed, AddressProvider } from '@/components/Address';
import { Screen } from '@/components/Screen';
import { WeakAreaMarker } from '@/components/WeakAreaMarker';
import { parentCopy } from '@/copy/parent';
import { masteryPercent } from '@/lib/analytics-view';
import { dateOnly } from '@/lib/consumption-format';
import { useElevation } from '@/lib/elevation';
import {
  parentApi,
  ParentApiError,
  type GenerationAllowanceView,
  type StudentProfileView,
  type TopicDrillDownRowView,
  type TopicDrillDownView,
} from '@/lib/parent-api';
import { applyIfCurrent, endsParentView, readableInstant } from '@/lib/parent-view';
import {
  DRILL_DOWN_GENERATION_COUNT,
  UNIDENTIFIED_ORDINAL,
  costOf,
  hasEvidence,
  targetSentence,
} from '@/lib/topic-drill-down';
import { density, typeRoles } from '@/theme/tokens';

/** The query parameter the selected student arrives in, from the Mastery table's link. */
const STUDENT_PARAM = 'student';

/**
 * The words a parent reads on every answer-key row.
 *
 * The same set the parent's Attempt detail builds, from the same `parentCopy.attempts`
 * group: the layout is shared and the **person** is a parameter, so the grade state's
 * five redundant carriers cannot come to disagree between the two parent surfaces.
 * Module-level rather than per render — it is a constant, and a fresh object per render
 * would be a new prop identity on every row.
 *
 * `question` is the one label this surface overrides. A row whose stored question could
 * not be read back carries the sentinel ordinal, and heading it "Question 0" would be a
 * claim about a number the API has just said it cannot recover — so that row is headed
 * by what is actually known instead.
 */
const PARENT_ROW_LABELS: AnswerKeyRowLabels = {
  question: (ordinal: number) =>
    ordinal === UNIDENTIFIED_ORDINAL
      ? parentCopy.topicDrillDown.unidentifiedQuestion
      : parentCopy.attempts.question(ordinal),
  format: parentCopy.attempts.format,
  studentAnswer: parentCopy.attempts.studentAnswer,
  noAnswer: parentCopy.attempts.noAnswer,
  correctAnswer: parentCopy.attempts.correctAnswer,
  answerUnavailable: parentCopy.attempts.answerUnavailable,
  rowUngraded: parentCopy.attempts.rowUngraded,
  rowNewlyGraded: parentCopy.attempts.rowNewlyGraded,
  rowParentAdjusted: parentCopy.attempts.override.rowParentAdjusted,
};

/**
 * Which run a row came off, as a whole sentence — dated when the stored instant parses
 * and undated when it does not.
 *
 * Both sentences are `parentCopy`'s; the only decision here is which applies, and it is
 * made through `readableInstant` so no parent screen renders the words "Invalid Date".
 */
function rowFromSentence(submittedAt: string): string {
  const when = readableInstant(submittedAt);
  return when === null
    ? parentCopy.topicDrillDown.rowFromUndated
    : parentCopy.topicDrillDown.rowFrom(when);
}

/** One list of evidence rows, through the shared row and never a second layout. */
function EvidenceList({
  heading,
  rows,
  empty,
  testId,
}: {
  heading: string;
  rows: readonly TopicDrillDownRowView[];
  /** What is said when the list is empty. Never an empty space. */
  empty: string;
  testId: string;
}) {
  return (
    <Box component="section" sx={{ display: 'grid', gap: `${density.gap}px` }}>
      {/* `h2`, because the topic's own name is this screen's `h1`: an `h3` here would
          skip a rank, and an outline that lies is worse than no outline. The rows'
          own headings are the `h4`s `AnswerKeyRow` renders beneath this. */}
      <Typography component="h2" variant="cardTitle">
        {heading}
      </Typography>
      {rows.length === 0 ? (
        <Typography component="p" data-testid={`${testId}-empty`}>
          {empty}
        </Typography>
      ) : (
        <Box
          component="ul"
          role="list"
          aria-label={heading}
          sx={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid' }}
          data-testid={testId}
        >
          {rows.map((row) => (
            <AnswerKeyRow
              key={`${row.attemptId}:${row.questionId}`}
              row={row}
              labels={PARENT_ROW_LABELS}
              // Which paper this Question came off, in the row's own slot: a drill-down
              // lists Questions from up to five different runs, so a row read on its own
              // still has to say which run it was.
              grade={
                <Typography
                  component="p"
                  sx={{ ...typeRoles.caption }}
                  data-testid="topic-drill-down-row-from"
                >
                  {rowFromSentence(row.submittedAt)}
                </Typography>
              }
            />
          ))}
        </Box>
      )}
    </Box>
  );
}

/**
 * One topic's evidence for one student, and the one thing a parent can do about it.
 *
 * **Reached only from the Mastery table.** The topic id is on the path and the student
 * is in the query string, because a drill-down is about one child and must not guess
 * which — the dashboard knows who is selected and says so in the link. A `?student=`
 * naming nobody on this account gets a sentence, not a blank screen.
 *
 * **Three reads, settling independently, each with its own failure and its own
 * retry.** The drill-down is the screen; the profiles read only puts a name on it; the
 * allowance read only makes the cost statable. Failing them together would blank
 * evidence that came back perfectly well because an allowance could not be looked up —
 * and a shared retry would re-fetch the evidence a parent is mid-way through reading in
 * order to recover a cost line.
 *
 * **Every sentence about the student is a function of the address.** The content sits
 * inside an `AddressProvider surface="parent"`, which resolves third person by name —
 * no copy here names a child in a literal (UX-DR31).
 *
 * **The cost is stated before the control can fire, always** (UX Q12c): what this
 * spends, what is left and what would be left after, all three in practice tests and
 * all three the API's figures through `costOf`. Nothing here computes an allowance, a
 * clamp or a charge — those stay the generation module's.
 *
 * **Not one threshold, ceiling or window size is stated by this app.** The run count the
 * scope sentence quotes is the stored figure's own; the Weak Area verdict is the API's
 * boolean and this screen compares nothing.
 *
 * **It offers exactly one action**, through Story 4.2's existing request: one practice
 * test, from the upload the API resolved, weighted on the label the API resolved. On
 * acceptance the parent is handed to the generate screen for that upload, which already
 * polls the newest job — so nothing about progress, clamping or charging is duplicated.
 *
 * No account plan is named and there is nothing offered for sale (AD-26).
 */
function TopicDrillDown() {
  const router = useRouter();
  const routeParams = useParams<{ topicId: string }>();
  const topicId = routeParams.topicId;
  const search = useSearchParams();
  const studentProfileId = search.get(STUDENT_PARAM) ?? '';
  const { elevation, clearElevation } = useElevation();
  const token = elevation?.token ?? null;

  const [profiles, setProfiles] = useState<StudentProfileView[]>([]);
  const [view, setView] = useState<TopicDrillDownView | null>(null);
  const [allowance, setAllowance] = useState<GenerationAllowanceView | null>(null);
  const [loading, setLoading] = useState(true);
  /**
   * Whether the drill-down read has actually answered. Held apart from `loading`,
   * because "not loading" is also what a *failed* read leaves behind — and "there is
   * nothing to show for this topic" is a claim a screen that never heard back cannot
   * make.
   */
  const [loaded, setLoaded] = useState(false);
  /** The same, for the profiles read: "no student matches" is a different claim. */
  const [profilesLoaded, setProfilesLoaded] = useState(false);
  /** The drill-down read's own failure. */
  const [error, setError] = useState<string | null>(null);
  /**
   * The profiles read's own failure, in its own slot.
   *
   * Separate, because the two reads fail for different reasons and a parent is owed
   * both: sharing one slot meant whichever settled last silently hid the other.
   */
  const [profilesError, setProfilesError] = useState<string | null>(null);
  /** The allowance read's own failure: the evidence still renders without it. */
  const [costError, setCostError] = useState<string | null>(null);
  /** The fire's own failure, stated beside the control that made it. */
  const [fireError, setFireError] = useState<string | null>(null);
  const [firing, setFiring] = useState(false);
  /** Bumped by the screen's Retry, so a failed evidence or profiles read re-issues. */
  const [attempt, setAttempt] = useState(0);
  /**
   * Bumped by the **cost block's** own Retry, and a dependency of that read alone.
   *
   * Its own counter because the allowance is its own read: on the shared one, retrying a
   * cost line re-issued the drill-down and blanked the evidence the parent was reading.
   */
  const [costAttempt, setCostAttempt] = useState(0);

  const requestId = useRef(0);
  /**
   * The same object identity across renders, so the guard reads live state.
   *
   * It is written **only inside the effect that issues the reads**, never in the render
   * body: a render is not a commit, and a body that mutated this could retire a request
   * that is still the live one.
   */
  const current = useRef({ value: 0 });
  /** The allowance read's own guard, since it is issued by its own effect. */
  const costRequestId = useRef(0);
  const costCurrent = useRef({ value: 0 });

  const leave = useCallback(() => {
    clearElevation();
    router.replace('/parent/pin');
  }, [clearElevation, router]);

  useEffect(() => {
    if (token === null) {
      // No token in memory: a reload, a new tab, or a parent who has left.
      router.replace('/parent/pin');
      return;
    }
    if (studentProfileId === '') {
      // No student in the URL is not a read this screen can make: the drill-down is
      // about one child, and guessing which would put one child's evidence under
      // another's name. The way back is the table that knows.
      setLoading(false);
      setError(parentCopy.topicDrillDown.unknownStudent);
      return;
    }
    const issued = (requestId.current += 1);
    current.current.value = issued;
    setLoading(true);
    setLoaded(false);
    setProfilesLoaded(false);
    setError(null);
    setProfilesError(null);
    setFireError(null);

    parentApi.topicDrillDown(token, studentProfileId, topicId).then(
      applyIfCurrent(current.current, issued, (found: TopicDrillDownView) => {
        setView(found);
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
        // server-side — and this screen's own otherwise. Never `cause.message`.
        setError(
          cause instanceof ParentApiError && cause.reason !== null
            ? cause.reason
            : parentCopy.topicDrillDown.loadFailed,
        );
      }),
    );

    // A name that could not be read is a name this screen cannot do without — every
    // sentence below is about the student — so it states its own failure and renders
    // nothing about them rather than addressing a hole.
    parentApi.students(token).then(
      applyIfCurrent(current.current, issued, (found: StudentProfileView[]) => {
        setProfiles(found);
        setProfilesLoaded(true);
      }),
      applyIfCurrent(current.current, issued, (cause: unknown) => {
        if (endsParentView(cause)) {
          leave();
          return;
        }
        setProfilesError(parentCopy.topicDrillDown.profilesFailed);
      }),
    );
  }, [token, studentProfileId, topicId, attempt, leave, router]);

  // The account's own Generation Allowance, read from the one route that states it
  // (Story 4.1) — in its own effect, with its own retry, so recovering a cost line
  // never re-issues the evidence. It is not on the drill-down response, because it is
  // not this child's figure.
  useEffect(() => {
    if (token === null) return;
    const issued = (costRequestId.current += 1);
    costCurrent.current.value = issued;
    setCostError(null);
    parentApi.generationAllowance(token).then(
      applyIfCurrent(costCurrent.current, issued, setAllowance),
      applyIfCurrent(costCurrent.current, issued, (cause: unknown) => {
        if (endsParentView(cause)) {
          leave();
          return;
        }
        // Stated where it matters and nowhere else: with no allowance in hand the cost
        // cannot be stated, so the control is not offered — a fire with no cost stated
        // is a defect.
        setCostError(parentCopy.topicDrillDown.allowanceFailed);
      }),
    );
  }, [token, costAttempt, leave]);

  const chosen = profiles.find((profile) => profile.id === studentProfileId) ?? null;
  const target = view?.target ?? null;
  const cost = allowance === null ? null : costOf(allowance);

  const fire = () => {
    if (token === null || target === null || cost === null || !cost.spendable) return;
    setFiring(true);
    setFireError(null);
    parentApi
      .startGeneration(
        token,
        target.sourceTestId,
        DRILL_DOWN_GENERATION_COUNT,
        target.weightedTopic,
      )
      .then(
        () => {
          // The existing progress screen for that upload, which already polls the
          // newest job. Nothing about progress is rebuilt here.
          router.push(`/parent/generate/${target.sourceTestId}`);
        },
        (cause: unknown) => {
          if (endsParentView(cause)) {
            leave();
            return;
          }
          setFiring(false);
          // A 409 the server authored — nothing left of the allowance, an upload that
          // stopped being generatable — is its own sentence; anything else is this
          // screen's. Either way the screen stays usable.
          setFireError(
            cause instanceof ParentApiError && cause.reason !== null
              ? cause.reason
              : parentCopy.topicDrillDown.fireFailed,
          );
        },
      );
  };

  return (
    <>
      {error !== null && (
        <Alert
          severity="error"
          role="alert"
          variant="outlined"
          data-testid="topic-drill-down-error"
          action={
            <Button type="button" onClick={() => setAttempt((value) => value + 1)}>
              {parentCopy.topicDrillDown.retry}
            </Button>
          }
        >
          {error}
        </Alert>
      )}
      {/* Its own alert beside the one above, never instead of it: two reads failed for
          two reasons and a parent is owed both. */}
      {profilesError !== null && (
        <Alert
          severity="error"
          role="alert"
          variant="outlined"
          data-testid="topic-drill-down-profiles-error"
          action={
            <Button type="button" onClick={() => setAttempt((value) => value + 1)}>
              {parentCopy.topicDrillDown.retry}
            </Button>
          }
        >
          {profilesError}
        </Alert>
      )}

      {loading ? (
        <Typography component="p" data-testid="topic-drill-down-loading">
          {parentCopy.topicDrillDown.loading}
        </Typography>
      ) : loaded && view !== null && chosen === null ? (
        // The read answered and the address names nobody on this account: a deleted
        // profile, another account's child, or an edited link. One sentence rather than
        // an empty screen — and only once the profiles read has answered, because an
        // empty list is also what a failed one leaves behind.
        profilesLoaded && (
          <Typography component="p" data-testid="topic-drill-down-unknown-student">
            {parentCopy.topicDrillDown.unknownStudent}
          </Typography>
        )
      ) : (
        // Only once the read has answered, and only with a student to name: every
        // sentence below is about them, and `resolveAddress` refuses an empty subject
        // rather than rendering a sentence with a hole in it.
        loaded &&
        view !== null &&
        chosen !== null && (
          <AddressProvider surface="parent" subject={chosen.displayName}>
            <Addressed>
              {(address) => {
                const topicName = view.topicName ?? parentCopy.topicDrillDown.unknownTopic;
                const percent = masteryPercent(view.mastery?.value ?? null);
                return (
                  <Box sx={{ display: 'grid', gap: `${density.sectionMargin}px` }}>
                    <Box component="section" sx={{ display: 'grid', gap: `${density.gap}px` }}>
                      <Typography
                        component="h1"
                        sx={{ fontSize: 24, fontWeight: 700 }}
                        data-testid="topic-drill-down-title"
                      >
                        {parentCopy.topicDrillDown.title(address.Name, topicName)}
                      </Typography>
                      {view.subjectName !== null && (
                        <Typography component="p" data-testid="topic-drill-down-subject">
                          {parentCopy.topicDrillDown.subject(view.subjectName)}
                        </Typography>
                      )}
                    </Box>

                    {!hasEvidence(view) ? (
                      <Typography component="p" data-testid="topic-drill-down-empty">
                        {parentCopy.topicDrillDown.empty(address.Name)}
                      </Typography>
                    ) : (
                      <>
                        {/* The stored figure, always with the count it is over and
                            always with the blanks beside it. */}
                        <Box
                          component="section"
                          sx={{ display: 'grid', gap: `${density.gap}px` }}
                          data-testid="topic-drill-down-mastery"
                        >
                          <Typography
                            component="p"
                            sx={{ ...typeRoles.dashboardBody, fontVariantNumeric: 'tabular-nums' }}
                            data-testid="topic-drill-down-figure"
                          >
                            {percent === null
                              ? parentCopy.topicDrillDown.figureNone
                              : parentCopy.topicDrillDown.figure(percent, view.mastery!.answered)}
                          </Typography>
                          {/* The verdict the API resolved. This screen compares no
                              figure against anything and knows no threshold. */}
                          {view.mastery!.isWeakArea && <WeakAreaMarker />}
                          <Typography component="p" data-testid="topic-drill-down-scope">
                            {parentCopy.topicDrillDown.scope(
                              address.name,
                              view.mastery!.attemptsCounted,
                            )}
                          </Typography>
                          <Typography component="p" data-testid="topic-drill-down-blanks">
                            {view.mastery!.unanswered === 0
                              ? parentCopy.topicDrillDown.blanksNone
                              : parentCopy.topicDrillDown.blanks(view.mastery!.unanswered)}
                          </Typography>
                          {/* What a blank *means*: in neither part of the figure, and
                              a blank at all only because the timer had not run out. */}
                          <Typography
                            component="p"
                            sx={{ ...typeRoles.caption }}
                            data-testid="topic-drill-down-blanks-explained"
                          >
                            {parentCopy.topicDrillDown.blanksExplained(address.name)}
                          </Typography>
                        </Box>

                        {/* The two lists, apart — a question left blank is not a
                            question got wrong, and mixing them would say it was. */}
                        <EvidenceList
                          heading={parentCopy.topicDrillDown.missedHeading(address.Name)}
                          rows={view.missed}
                          empty={parentCopy.topicDrillDown.missedNone(address.Name)}
                          testId="topic-drill-down-missed"
                        />
                        <EvidenceList
                          heading={parentCopy.topicDrillDown.unansweredHeading(address.Name)}
                          rows={view.unanswered}
                          empty={parentCopy.topicDrillDown.unansweredNone(address.Name)}
                          testId="topic-drill-down-unanswered"
                        />

                        {/* Generate more on this: the cost, then the one control. */}
                        <Card component="section" data-testid="topic-drill-down-generate">
                          <CardContent sx={{ display: 'grid', gap: `${density.gap}px` }}>
                            {/* `h2`, a sibling of the two list headings under the
                                screen's one `h1`. */}
                            <Typography component="h2" variant="cardTitle">
                              {parentCopy.topicDrillDown.generateHeading}
                            </Typography>
                            {target === null ? (
                              // No upload of this child's carries the topic, so there is
                              // nothing to aim a request at. The reason is stated rather
                              // than the control being quietly absent.
                              <Typography component="p" data-testid="topic-drill-down-no-target">
                                {parentCopy.topicDrillDown.noTarget(address.name)}
                              </Typography>
                            ) : (
                              <>
                                <Typography component="p">
                                  {parentCopy.topicDrillDown.generateIntro(topicName)}
                                </Typography>
                                {/* Which upload, through the one function that picks
                                    among the four sentences — so no branch of it is
                                    reachable only by rendering. */}
                                <Typography
                                  component="p"
                                  sx={{ ...typeRoles.caption }}
                                  data-testid="topic-drill-down-target"
                                >
                                  {targetSentence(target)}
                                </Typography>

                                {/* The cost block: three lines, all in practice tests,
                                    all above the control. Every figure is `costOf`'s. */}
                                {costError !== null && (
                                  <Alert
                                    severity="error"
                                    role="alert"
                                    variant="outlined"
                                    data-testid="topic-drill-down-cost-error"
                                    action={
                                      <Button
                                        type="button"
                                        onClick={() => setCostAttempt((value) => value + 1)}
                                      >
                                        {parentCopy.topicDrillDown.retry}
                                      </Button>
                                    }
                                  >
                                    {costError}
                                  </Alert>
                                )}
                                {cost !== null && allowance !== null && (
                                  <Box
                                    sx={{ display: 'grid', gap: `${density.gap / 2}px` }}
                                    data-testid="topic-drill-down-cost"
                                  >
                                    <Typography component="p">
                                      {parentCopy.topicDrillDown.costSpend(cost.count)}
                                    </Typography>
                                    <Typography component="p">
                                      {cost.remaining === null
                                        ? parentCopy.topicDrillDown.costRemainingUnlimited
                                        : parentCopy.topicDrillDown.costRemaining(cost.remaining)}
                                    </Typography>
                                    <Typography component="p">
                                      {cost.after === null
                                        ? parentCopy.topicDrillDown.costAfterUnlimited
                                        : parentCopy.topicDrillDown.costAfter(cost.after)}
                                    </Typography>
                                    <Typography component="p" sx={{ ...typeRoles.caption }}>
                                      {parentCopy.topicDrillDown.resets(
                                        dateOnly(allowance.resetAt, allowance.timezone),
                                      )}
                                    </Typography>
                                    {/* Nothing left: the control is dead and says so. */}
                                    {!cost.spendable && (
                                      <Typography
                                        component="p"
                                        data-testid="topic-drill-down-spent"
                                      >
                                        {parentCopy.topicDrillDown.spent}
                                      </Typography>
                                    )}
                                  </Box>
                                )}

                                {fireError !== null && (
                                  <Alert
                                    severity="error"
                                    role="alert"
                                    variant="outlined"
                                    data-testid="topic-drill-down-fire-error"
                                  >
                                    {fireError}
                                  </Alert>
                                )}

                                {/* One tap, with the topic already chosen. Disabled
                                    until a cost has actually been stated, and disabled
                                    when there is nothing left to spend. */}
                                <Button
                                  type="button"
                                  variant="contained"
                                  data-testid="topic-drill-down-fire"
                                  disabled={cost === null || !cost.spendable || firing}
                                  onClick={fire}
                                >
                                  {firing
                                    ? parentCopy.topicDrillDown.firing
                                    : parentCopy.topicDrillDown.fire}
                                </Button>
                              </>
                            )}
                          </CardContent>
                        </Card>
                      </>
                    )}
                  </Box>
                );
              }}
            </Addressed>
          </AddressProvider>
        )
      )}
    </>
  );
}

/**
 * The route's shell: the column, the way back, and the screen behind a `Suspense`.
 *
 * The body is its own component behind `Suspense` because `useSearchParams` opts a
 * route out of static prerendering otherwise — and the selected student arrives as a
 * query parameter, which is the whole reason it is read at all.
 *
 * The way back is outside it, so a parent always has one even while the reads are in
 * flight or after they failed.
 */
export default function ParentTopicDrillDownPage() {
  return (
    <Screen>
      <Suspense fallback={null}>
        <TopicDrillDown />
      </Suspense>
      <Link component={NextLink} href="/parent/analytics">
        {parentCopy.topicDrillDown.back}
      </Link>
    </Screen>
  );
}
