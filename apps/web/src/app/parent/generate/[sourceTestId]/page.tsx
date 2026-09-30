'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import NextLink from 'next/link';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormLabel from '@mui/material/FormLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { ORDER_HEADING_ID, PageStrip } from '@/app/parent/capture/PageStrip';
import { PrimaryButton } from '@/components/Button';
import { AppDialog, ConfirmDestructiveDialog } from '@/components/Dialog';
import { useAnnounce } from '@/components/LiveRegion';
import { Screen } from '@/components/Screen';
import { parentCopy } from '@/copy/parent';
import { limitLabel } from '@/lib/consumption-format';
import { useElevation } from '@/lib/elevation';
import {
  parentApi,
  ParentApiError,
  type GenerationAllowanceView,
  type GenerationJobView,
  type GenerationTopicsView,
  type SourceTestView,
} from '@/lib/parent-api';
import {
  GENERATION_POLL_MS,
  countOptions,
  defaultCount,
  isSettled,
  progressSentence,
  remainingAfter,
} from '@/lib/practice-test-count';
import { applyIfCurrent, endsParentView } from '@/lib/parent-view';
import { density } from '@/theme/tokens';

/** The count fieldset's own label, named once and pointed at by the group. */
const COUNT_LEGEND_ID = 'generate-count-legend';

/**
 * The one sentence saying why some counts cannot be chosen, named once so every
 * disabled radio can point at it.
 *
 * One node, not one per count. A disabled radio is not focusable, so a reason
 * rendered beside it is unreachable by keyboard and never announced — while a
 * sighted reader sees the identical sentence repeated up to five times.
 * `aria-describedby` on each disabled control, pointing here, is what makes the
 * reason part of the group rather than decoration next to it.
 */
const COUNT_REASON_ID = 'generate-count-reason';

/** The Topic fieldset's own label, named once and pointed at by the group. */
const TOPIC_LEGEND_ID = 'generate-topic-legend';

/**
 * The one sentence saying what focusing does, named once and attached to the
 * group rather than left floating beside it — the same reasoning
 * `COUNT_REASON_ID` carries.
 */
const TOPIC_HINT_ID = 'generate-topic-hint';

/**
 * The radio value standing for "no weighting", which is the group's default.
 *
 * A sentinel rather than an empty string, because a Topic label is arbitrary
 * text read off a page and `''` is a value `RadioGroup` already uses for "no
 * selection". It never leaves this file: the request sends `null`.
 */
const ALL_TOPICS = '__all__';

/**
 * The page strip's edit callbacks, which a read-only strip never reaches.
 *
 * Declared once at module scope rather than as three inline closures, so it is
 * plain that the strip on this screen edits nothing: page management belongs to
 * the draft, on the capture screen, and every write against the committed Source
 * Test this route is reached for answers 409.
 */
const noPageEdit = (): void => {};

/**
 * The generate step: pick a count, read the cost, confirm, then watch the job.
 *
 * It is a **route** rather than a section of the capture screen, and that is
 * the whole point: generation is asynchronous and a parent may leave and come
 * back, so the state they come back to has to be addressable by a URL and read
 * from the server. A section of another screen could only ever restore what the
 * browser happened to still be holding.
 *
 * Every figure on it — the remaining allowance, the per-request ceiling, the
 * limit, the counts produced — arrives from the API. This screen holds no tier
 * table, no ceiling and no threshold of its own.
 */
export default function GeneratePage() {
  const router = useRouter();
  const params = useParams<{ sourceTestId: string }>();
  const sourceTestId = params.sourceTestId;
  const { elevation, clearElevation } = useElevation();
  const token = elevation?.token ?? null;

  const [allowance, setAllowance] = useState<GenerationAllowanceView | null>(null);
  /**
   * The upload itself, which this screen reads for its pages.
   *
   * This route is the only one in the product keyed by a Source Test id, so it
   * is the only place a parent can come back to a committed upload in a later
   * session — from the weak-area drill-down, or from their own link. Rendering
   * the page set here is what makes the removed state visible where the upload
   * actually lives, and it is where the early deletion (FR-33) has to be
   * offered for the same reason.
   */
  const [sourceTest, setSourceTest] = useState<SourceTestView | null>(null);
  /** The Extraction's own Topic labels, in the order the API gave them. */
  const [topics, setTopics] = useState<string[]>([]);
  /**
   * The Topic chosen, or `ALL_TOPICS` for the even spread — which is the
   * default, and is exactly the request this screen made before weighting
   * existed.
   */
  const [topic, setTopic] = useState<string>(ALL_TOPICS);
  const [job, setJob] = useState<GenerationJobView | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [starting, setStarting] = useState(false);
  /** The photo-deletion confirmation, and its write. */
  const [confirmingPhotoDelete, setConfirmingPhotoDelete] = useState(false);
  const [deletingPhotos, setDeletingPhotos] = useState(false);
  const [loading, setLoading] = useState(true);
  /**
   * True from the instant a job settles until its allowance re-read resolves.
   *
   * Without this, the picker would come back for one render with the pre-job
   * allowance still in state — offering a count the account can no longer
   * afford, and letting the parent tap it before the true figure has loaded.
   */
  const [refreshingAllowance, setRefreshingAllowance] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * The surface's one polite live region, mounted in `ThemeRegistry`. A second
   * status region here would make "the region on this screen" ambiguous — for a
   * screen reader as much as for a test.
   */
  const { announce } = useAnnounce();

  /** Bumped by Retry, so a load or a poll that stopped on an error re-issues. */
  const [attempt, setAttempt] = useState(0);
  const requestId = useRef(0);
  /** The same object identity across renders, so the guard reads live state. */
  const current = useRef({ value: 0 });
  current.current.value = requestId.current;

  /**
   * The photo deletion's own token, kept apart from the counter above.
   *
   * That counter is shared by the mount load and the progress poll, and bumping
   * it is how each of those invalidates the other's in-flight result. A delete
   * is a third, independent stream: sharing the counter would make confirming a
   * deletion silently discard the poll's next answer, with nothing left to
   * re-issue it — generation progress simply stops moving on screen.
   */
  const deleteRequestId = useRef(0);
  const currentDelete = useRef({ value: 0 });
  currentDelete.current.value = deleteRequestId.current;

  const leave = useCallback(() => {
    clearElevation();
    router.replace('/parent/pin');
  }, [clearElevation, router]);

  /**
   * What to show for a failure, preferring the server's own sentence.
   *
   * A 409 here is never a transport problem: it is the API refusing on a rule
   * it authored — nothing left of the allowance, nothing usable to generate
   * from, an upload that has not finished being read — and each of those
   * sentences is written once, in its policy file. Falling back to this
   * screen's generic message would tell the parent less than the server
   * already said, and restating the sentence here would be a second copy of it
   * to keep in step. Everything else keeps the screen's own wording.
   */
  const messageFor = useCallback((cause: unknown, fallback: string): string => {
    if (cause instanceof ParentApiError && cause.reason !== null) return cause.reason;
    return cause instanceof Error ? cause.message : fallback;
  }, []);

  /**
   * The screen's one load: what is left to spend, and whether a job is already
   * running for this upload.
   *
   * The job read is allowed to 404 — that is the ordinary case, and it means
   * nothing has been requested yet rather than that anything is wrong. **Only**
   * a 404: a 500, a timeout or a dropped connection is not "nothing requested
   * yet", and swallowing it would show the picker for an upload that may
   * already have a job running, which the parent would then be charged for
   * twice.
   */
  useEffect(() => {
    const issued = (requestId.current += 1);
    current.current.value = issued;
    if (token === null) {
      // No token in memory: a reload, a new tab, or a parent who has left.
      router.replace('/parent/pin');
      return;
    }
    setLoading(true);
    setError(null);
    Promise.all([
      parentApi.generationAllowance(token),
      parentApi.generationJob(token, sourceTestId).catch((cause: unknown) => {
        // 404, and 404 alone, is "nothing requested yet" — a state, not a
        // fault. Every other failure is rethrown and surfaced.
        if (cause instanceof ParentApiError && cause.status === 404) return null;
        throw cause;
      }),
      // Alongside the other two rather than after them: the Topic group is part
      // of the picker, and a picker that appeared without it would offer a
      // choice that silently grew a second control a moment later.
      //
      // A 409 is not a failure of this screen. The topics read refuses on the
      // same rules the request does — an upload still being read, one with
      // nothing usable in it — and those are states this screen already
      // renders through, with the server's own sentence surfaced when the
      // parent actually tries to generate. Collapsing the whole screen into
      // "this upload could not be opened" over an optional control would tell
      // them less, and about the wrong thing. Everything else is rethrown.
      parentApi.generationTopics(token, sourceTestId).catch((cause: unknown) => {
        if (cause instanceof ParentApiError && cause.status === 409) {
          return { topics: [] } satisfies GenerationTopicsView;
        }
        throw cause;
      }),
      // The upload itself. Read through `parentApi.sourceTest`, whose server
      // side proves ownership with `requireReadable` — so a committed upload
      // still resolves long after the 72h draft TTL on its `expiresAt` has
      // passed, which is every upload this screen is reached for in a later
      // session.
      //
      // Degraded rather than fatal, because generation needs none of it: the
      // page set is what the strip and the delete-photos control are built
      // from, and this screen loaded without either of them before they
      // existed. A transient failure here must not take down the picker and
      // the progress panel with it. A cause that ends the whole parent view —
      // an expired elevation, a revoked session — is still rethrown, so the
      // handler below can send the parent back to the PIN gate.
      parentApi.sourceTest(token, sourceTestId).catch((cause: unknown) => {
        if (endsParentView(cause)) throw cause;
        return null;
      }),
    ]).then(
      applyIfCurrent(
        current.current,
        issued,
        ([reading, existing, offered, upload]: [
          GenerationAllowanceView,
          GenerationJobView | null,
          GenerationTopicsView,
          SourceTestView | null,
        ]) => {
          setAllowance(reading);
          setJob(existing);
          setTopics(offered.topics);
          setSourceTest(upload);
          setCount(defaultCount(reading.remaining, reading.maxPerRequest));
          setLoading(false);
        },
      ),
      applyIfCurrent(current.current, issued, (cause: unknown) => {
        if (endsParentView(cause)) {
          leave();
          return;
        }
        setLoading(false);
        setError(messageFor(cause, parentCopy.generate.loadFailed));
      }),
    );
  }, [token, sourceTestId, attempt, leave, router, messageFor]);

  const jobId = job?.id ?? null;
  const jobSettled = job === null || isSettled(job.status);

  /**
   * Re-reads what is left once a job has settled.
   *
   * The reading taken on mount describes the account *before* this job spent
   * anything. Left alone, the picker would come back offering counts the
   * account can no longer afford — and stating a usage figure that is a whole
   * request out of date — until the parent reloaded. The server would refuse
   * the request anyway, but being refused for a count the screen just offered
   * is the screen's fault, not the parent's.
   */
  useEffect(() => {
    if (token === null || jobId === null || !jobSettled) return;
    const issued = (requestId.current += 1);
    current.current.value = issued;
    setRefreshingAllowance(true);
    parentApi.generationAllowance(token).then(
      applyIfCurrent(current.current, issued, (reading: GenerationAllowanceView) => {
        setAllowance(reading);
        setCount(defaultCount(reading.remaining, reading.maxPerRequest));
        setRefreshingAllowance(false);
      }),
      applyIfCurrent(current.current, issued, (cause: unknown) => {
        if (endsParentView(cause)) {
          leave();
          return;
        }
        setRefreshingAllowance(false);
        setError(messageFor(cause, parentCopy.generate.loadFailed));
      }),
    );
  }, [token, jobId, jobSettled, leave, messageFor]);

  /**
   * The progress poll, running only while a job of this screen's is unsettled.
   *
   * Read from the server on every tick rather than advanced locally, which is
   * what makes leaving and returning work: the progress shown is the job's own
   * state, and the browser holds nothing that could disagree with it.
   */
  useEffect(() => {
    if (token === null || jobId === null || jobSettled) return;
    const issued = (requestId.current += 1);
    current.current.value = issued;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const read = (): void => {
      parentApi.generationJob(token, sourceTestId).then(
        applyIfCurrent(current.current, issued, (view: GenerationJobView) => {
          setJob(view);
          if (!stopped && !isSettled(view.status)) timer = setTimeout(read, GENERATION_POLL_MS);
        }),
        applyIfCurrent(current.current, issued, (cause: unknown) => {
          if (endsParentView(cause)) {
            leave();
            return;
          }
          // Stops rather than hammers: the screen's Retry re-issues it.
          setError(messageFor(cause, parentCopy.generate.progressFailed));
        }),
      );
    };
    timer = setTimeout(read, GENERATION_POLL_MS);

    return () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      requestId.current += 1;
      current.current.value = requestId.current;
    };
  }, [token, sourceTestId, jobId, jobSettled, attempt, leave, messageFor]);

  /**
   * Announces the outcome in the same words the screen displays it in.
   *
   * Keyed on the status and the produced count together, so a partial result
   * and a full one are two different announcements rather than one sentence
   * that quietly changes its figures.
   */
  const producedCount = job?.producedCount ?? 0;
  const jobStatus = job?.status ?? null;
  const requestedCount = job?.requestedCount ?? 0;
  const jobTopic = job?.weightedTopic ?? null;
  useEffect(() => {
    if (jobStatus === null) return;
    if (jobStatus === 'Succeeded') announce(parentCopy.generate.done(producedCount, jobTopic));
    else if (jobStatus === 'PartiallyComplete') {
      announce(parentCopy.generate.partial(producedCount, requestedCount, jobTopic));
    } else if (jobStatus === 'Failed') announce(parentCopy.generate.failed);
    // The same sentence the screen shows, weighted Topic included: an
    // announcement that dropped it would be a second, quieter wording of the
    // same fact.
    else {
      announce(
        progressSentence({
          producedCount,
          requestedCount,
          weightedTopic: jobTopic,
        }),
      );
    }
  }, [jobStatus, producedCount, requestedCount, jobTopic, announce]);

  function retry(): void {
    setError(null);
    setAttempt((previous) => previous + 1);
  }

  function startGeneration(): void {
    if (token === null || count === null) return;
    setStarting(true);
    setError(null);
    const issued = (requestId.current += 1);
    current.current.value = issued;
    // `null`, never the sentinel: "all topics" is the absence of a weighting,
    // and the API's unweighted request is the one with no Topic in its body.
    parentApi.startGeneration(token, sourceTestId, count, topic === ALL_TOPICS ? null : topic).then(
      applyIfCurrent(current.current, issued, (accepted: GenerationJobView) => {
        setStarting(false);
        setConfirming(false);
        // The server's own count, which may be smaller than what was sent.
        setJob(accepted);
      }),
      applyIfCurrent(current.current, issued, (cause: unknown) => {
        if (endsParentView(cause)) {
          leave();
          return;
        }
        setStarting(false);
        setConfirming(false);
        // A 409 here is the API refusing on a rule — the allowance ran out
        // between the read and the tap, or the upload has nothing usable in it
        // — and the parent reads the reason the API stated, not a generic one.
        setError(messageFor(cause, parentCopy.generate.startFailed));
      }),
    );
  }

  /**
   * Removes the photographs of this upload, ahead of the 90-day clock (FR-33).
   *
   * The confirmation stays open until the write settles — that is what lets its
   * `busy` lock reach the controls — and the announcement is phrased from the
   * view the server answered with, never from a count this screen predicted.
   */
  function deletePhotos(): void {
    if (token === null) return;
    setDeletingPhotos(true);
    setError(null);
    const issued = (deleteRequestId.current += 1);
    currentDelete.current.value = issued;
    parentApi.deleteSourceTestPageImages(token, sourceTestId).then(
      applyIfCurrent(currentDelete.current, issued, (after: SourceTestView) => {
        setDeletingPhotos(false);
        setConfirmingPhotoDelete(false);
        setSourceTest(after);
        // Counted off the answer: on an idempotent second confirm the removed
        // pages are still removed, and "how many are gone" is a fact about the
        // upload rather than about this request. A before-minus-after figure
        // would be zero here, and there is no sentence for zero.
        const removed = after.pages.filter((page) => page.state === 'Deleted').length;
        // A 200 with nothing removed is the one success that is not one: every
        // unlink failed, the photographs are still there, and the rows the
        // server answers with say so. Announcing "0 photos have been removed"
        // would be a sentence the copy has no form for and a claim that is
        // false. The failure line is what the parent can act on — the pages are
        // left for the schedule, and trying again costs nothing.
        if (removed === 0) {
          setError(parentCopy.capture.deletePhotosFailed);
          return;
        }
        announce(parentCopy.capture.photosDeleted(removed));
      }),
      applyIfCurrent(currentDelete.current, issued, (cause: unknown) => {
        if (endsParentView(cause)) {
          leave();
          return;
        }
        setDeletingPhotos(false);
        setConfirmingPhotoDelete(false);
        // A 409 here is the API refusing on a rule it authored — the upload has
        // not been submitted, or is still being read — and the parent reads
        // that sentence rather than this screen's generic one.
        setError(messageFor(cause, parentCopy.capture.deletePhotosFailed));
      }),
    );
  }

  const pages = sourceTest?.pages ?? [];
  /**
   * The photographs that are still held. One predicate, not two: the control is
   * offered exactly when there is something for it to remove on an upload that
   * has been committed, and the count it states is the same figure.
   *
   * A draft has no such control here at all — this route is only ever reached
   * for a committed upload — and once every page is `Deleted` the control is
   * gone, because pressing it would remove nothing.
   */
  const livePhotoCount =
    sourceTest?.status === 'Submitted'
      ? pages.filter((page) => page.state !== 'Deleted').length
      : 0;

  const options =
    allowance === null ? [] : countOptions(allowance.remaining, allowance.maxPerRequest);
  const after =
    allowance === null || count === null
      ? null
      : remainingAfter(count, allowance.limit, allowance.used);
  /**
   * The cost sentence, stated before the confirm control can be pressed.
   *
   * An unlimited account gets the sentence with no remainder in it, because
   * there is no honest number to put there.
   */
  const costSentence =
    count === null
      ? null
      : after === null
        ? parentCopy.generate.costUnlimited(count)
        : parentCopy.generate.cost(count, after);

  const picking = job === null || isSettled(job.status);
  const running = job !== null && !isSettled(job.status);

  return (
    <Screen measured>
      <Typography component="h1" sx={{ fontSize: 24, fontWeight: 700 }}>
        {parentCopy.generate.title}
      </Typography>

      {error !== null && (
        <Alert
          severity="error"
          role="alert"
          variant="outlined"
          data-testid="generate-error"
          action={
            <Button type="button" onClick={retry}>
              {parentCopy.generate.retry}
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      {loading ? (
        <Typography component="p" data-testid="generate-loading">
          {parentCopy.generate.loading}
        </Typography>
      ) : (
        <Card>
          <CardContent sx={{ display: 'grid', gap: `${density.gap}px` }}>
            {running || (job !== null && isSettled(job.status)) ? (
              <Box
                component="section"
                sx={{ display: 'grid', gap: `${density.gap}px` }}
                data-testid="generate-progress"
              >
                <Typography component="h2" sx={{ fontSize: 18, fontWeight: 700 }}>
                  {parentCopy.generate.progressHeading}
                </Typography>
                {/* The figures are the job's own, read from the server. */}
                <Typography component="p" data-testid="generate-progress-line">
                  {job!.status === 'Succeeded'
                    ? parentCopy.generate.done(job!.producedCount, job!.weightedTopic)
                    : job!.status === 'PartiallyComplete'
                      ? parentCopy.generate.partial(
                          job!.producedCount,
                          job!.requestedCount,
                          job!.weightedTopic,
                        )
                      : job!.status === 'Failed'
                        ? parentCopy.generate.failed
                        : progressSentence(job!)}
                </Typography>
                {running && (
                  // Advises staying, and says plainly that leaving loses
                  // nothing — which is the truth, and the opposite of what a
                  // "don't leave or you'll lose your work" warning would say.
                  <Typography component="p" data-testid="generate-stay">
                    {parentCopy.generate.stayHere}
                  </Typography>
                )}
                {(job!.status === 'Failed' || job!.status === 'PartiallyComplete') && (
                  <Typography component="p" data-testid="generate-retry-free">
                    {parentCopy.generate.retryFree}
                  </Typography>
                )}
                {/* Drafts exist, so there is somewhere to go and read them.
                    Offered for a partially complete job too: what landed
                    landed, and it was charged for. Client-side, so the
                    provider holding the elevation bearer stays mounted. */}
                {(job!.status === 'Succeeded' || job!.status === 'PartiallyComplete') &&
                  job!.producedCount > 0 && (
                    <Link
                      component={NextLink}
                      href="/parent/drafts"
                      data-testid="generate-to-drafts"
                    >
                      {parentCopy.generate.toDrafts}
                    </Link>
                  )}
              </Box>
            ) : null}

            {picking && allowance !== null && (
              <Box
                component="section"
                sx={{ display: 'grid', gap: `${density.gap}px` }}
                data-testid="generate-picker"
              >
                <Typography component="p">{parentCopy.generate.intro}</Typography>
                <Typography component="p" data-testid="generate-usage">
                  {parentCopy.generate.usage(allowance.used, limitLabel(allowance.limit))}
                </Typography>

                <FormControl>
                  <FormLabel id={COUNT_LEGEND_ID}>{parentCopy.generate.countLegend}</FormLabel>
                  <RadioGroup
                    aria-labelledby={COUNT_LEGEND_ID}
                    value={count === null ? '' : String(count)}
                    onChange={(event) => setCount(Number(event.target.value))}
                  >
                    {options.map((option) => (
                      <Box
                        key={option.count}
                        data-testid="generate-count-option"
                        data-count={option.count}
                        data-available={option.available ? 'true' : 'false'}
                      >
                        <FormControlLabel
                          value={String(option.count)}
                          control={
                            <Radio
                              // The reason is attached to the control rather
                              // than left beside it, so it belongs to the
                              // radio for a screen reader too.
                              slotProps={
                                option.available
                                  ? undefined
                                  : { input: { 'aria-describedby': COUNT_REASON_ID } }
                              }
                            />
                          }
                          // Disabled, never removed: the count stays on screen
                          // and stays readable, and the one sentence below the
                          // group says why it cannot be chosen.
                          disabled={!option.available || starting || refreshingAllowance}
                          label={parentCopy.generate.countOption(option.count)}
                          sx={{ minHeight: density.tapTarget }}
                        />
                      </Box>
                    ))}
                  </RadioGroup>

                  {/* Once, under the group, and only when something in it is
                      actually unavailable. */}
                  {options.some((option) => !option.available) && (
                    <Typography
                      component="p"
                      id={COUNT_REASON_ID}
                      data-testid="generate-count-reason"
                      sx={{ fontSize: 13 }}
                    >
                      {/* The API's own sentence when the allowance is spent —
                          it names the Account Tier, the usage against the limit
                          and the reset date, none of which this app holds. A
                          parent at cap cannot fire the request, so this is the
                          only place they would ever read it. The screen's own
                          sentence stays for 1–4 left, where it is describing
                          disabled options rather than a block. */}
                      {allowance.exhaustedReason ??
                        parentCopy.generate.countUnavailable(allowance.remaining)}
                    </Typography>
                  )}
                </FormControl>

                {/* Below the count group and above the cost, because it is an
                    optional refinement of a choice already made — and because
                    the cost sentence must stay the last thing read before the
                    confirm control. Absent entirely when the Extraction offers
                    nothing to focus on. */}
                {topics.length > 0 && (
                  <FormControl>
                    <FormLabel id={TOPIC_LEGEND_ID}>{parentCopy.generate.topicLegend}</FormLabel>
                    <RadioGroup
                      aria-labelledby={TOPIC_LEGEND_ID}
                      aria-describedby={TOPIC_HINT_ID}
                      value={topic}
                      onChange={(event) => setTopic(event.target.value)}
                    >
                      {/* First and default: the even spread, which is the
                          request this screen made before weighting existed. */}
                      <Box data-testid="generate-topic-option" data-topic={ALL_TOPICS}>
                        <FormControlLabel
                          value={ALL_TOPICS}
                          control={<Radio />}
                          disabled={starting || refreshingAllowance}
                          label={parentCopy.generate.topicAll}
                          sx={{ minHeight: density.tapTarget }}
                        />
                      </Box>
                      {topics.map((label) => (
                        <Box key={label} data-testid="generate-topic-option" data-topic={label}>
                          <FormControlLabel
                            value={label}
                            control={<Radio />}
                            disabled={starting || refreshingAllowance}
                            // The Extraction's own words, rendered as they
                            // arrived. Nothing here retitles or truncates a
                            // label read off the parent's page.
                            label={parentCopy.generate.topicOption(label)}
                            sx={{ minHeight: density.tapTarget }}
                          />
                        </Box>
                      ))}
                    </RadioGroup>

                    <Typography
                      component="p"
                      id={TOPIC_HINT_ID}
                      data-testid="generate-topic-hint"
                      sx={{ fontSize: 13 }}
                    >
                      {parentCopy.generate.topicHint}
                    </Typography>
                  </FormControl>
                )}

                {costSentence !== null && (
                  // The cost is on screen before the confirm control is ever
                  // reachable, denominated in practice tests.
                  <Typography component="p" data-testid="generate-cost">
                    {costSentence}
                  </Typography>
                )}

                <PrimaryButton
                  sx={{ minHeight: density.tapTarget }}
                  disabled={count === null || starting || refreshingAllowance}
                  onClick={() => setConfirming(true)}
                  data-testid="generate-start"
                >
                  {parentCopy.generate.start}
                </PrimaryButton>
              </Box>
            )}
          </CardContent>
        </Card>
      )}

      {/* The upload's own pages, read-only.

          The same `PageStrip` the capture screen renders, with `editable`
          false: a second renderer of a page row would be a second version of
          the removed state, and the dated "Photo deleted" caption a page gets
          here has to be the one an expired page gets. Every write against a
          committed Source Test answers 409 anyway, so the strip's controls
          would only be a way of collecting that refusal. */}
      {sourceTest !== null && pages.length > 0 && (
        <Card>
          <CardContent sx={{ display: 'grid', gap: `${density.gap}px` }}>
            <Typography id={ORDER_HEADING_ID} component="h2" sx={{ fontSize: 18, fontWeight: 700 }}>
              {parentCopy.capture.title}
            </Typography>

            <PageStrip
              pages={pages}
              editable={false}
              busy={deletingPhotos}
              onMove={noPageEdit}
              onRetake={noPageEdit}
              onDelete={noPageEdit}
            />

            {livePhotoCount > 0 && (
              <Button
                type="button"
                variant="outlined"
                color="error"
                sx={{ minHeight: density.tapTarget, justifySelf: 'start' }}
                disabled={deletingPhotos}
                onClick={() => setConfirmingPhotoDelete(true)}
                data-testid="delete-photos"
              >
                {parentCopy.capture.deletePhotos}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* No password and no PIN: nothing built from these photographs is lost,
          so there is no loss for a re-authentication to stand in front of. The
          elevation the parent already proved is the whole authorization. */}
      <ConfirmDestructiveDialog
        open={confirmingPhotoDelete}
        title={parentCopy.capture.deletePhotosTitle}
        body={parentCopy.capture.deletePhotosBody(livePhotoCount)}
        busy={deletingPhotos}
        onCancel={() => setConfirmingPhotoDelete(false)}
        onConfirm={deletePhotos}
      />

      {/* The confirmation restates the cost rather than referring back to it:
          it is the last thing read before the allowance is spent. */}
      <AppDialog
        open={confirming}
        title={parentCopy.generate.confirmTitle}
        onClose={() => setConfirming(false)}
        actions={
          <>
            <Button type="button" onClick={() => setConfirming(false)} disabled={starting}>
              {parentCopy.generate.cancel}
            </Button>
            <PrimaryButton
              onClick={startGeneration}
              disabled={starting || count === null}
              data-testid="generate-confirm"
            >
              {parentCopy.generate.confirm}
            </PrimaryButton>
          </>
        }
      >
        {costSentence !== null && (
          <Typography component="p" data-testid="generate-confirm-cost">
            {costSentence}
          </Typography>
        )}
      </AppDialog>

      {/* A client-side link, not a reload: the elevation bearer lives in this
          browser's memory alone (AD-18), so a full navigation would land the
          parent back on the PIN gate rather than on the upload. */}
      <Link component={NextLink} href="/parent/capture">
        {parentCopy.generate.back}
      </Link>
    </Screen>
  );
}
