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
import { PrimaryButton } from '@/components/Button';
import { AppDialog } from '@/components/Dialog';
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
} from '@/lib/parent-api';
import {
  GENERATION_POLL_MS,
  countOptions,
  defaultCount,
  isSettled,
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
  const [job, setJob] = useState<GenerationJobView | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [starting, setStarting] = useState(false);
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
    ]).then(
      applyIfCurrent(
        current.current,
        issued,
        ([reading, existing]: [GenerationAllowanceView, GenerationJobView | null]) => {
          setAllowance(reading);
          setJob(existing);
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
  useEffect(() => {
    if (jobStatus === null) return;
    if (jobStatus === 'Succeeded') announce(parentCopy.generate.done(producedCount));
    else if (jobStatus === 'PartiallyComplete') {
      announce(parentCopy.generate.partial(producedCount, requestedCount));
    } else if (jobStatus === 'Failed') announce(parentCopy.generate.failed);
    else announce(parentCopy.generate.progress(producedCount, requestedCount));
  }, [jobStatus, producedCount, requestedCount, announce]);

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
    parentApi.startGeneration(token, sourceTestId, count).then(
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
                    ? parentCopy.generate.done(job!.producedCount)
                    : job!.status === 'PartiallyComplete'
                      ? parentCopy.generate.partial(job!.producedCount, job!.requestedCount)
                      : job!.status === 'Failed'
                        ? parentCopy.generate.failed
                        : parentCopy.generate.progress(job!.producedCount, job!.requestedCount)}
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
                      {parentCopy.generate.countUnavailable(allowance.remaining)}
                    </Typography>
                  )}
                </FormControl>

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
