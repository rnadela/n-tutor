'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { AppDialog } from '@/components/Dialog';
import { RichText } from '@/components/RichText';
import { Screen } from '@/components/Screen';
import { studentCopy } from '@/copy/student';
import { progressOf } from '@/lib/answers';
import { CLOCK_TICK_MS, WARNING_VISIBLE_MS, remainingMs, warningFor } from '@/lib/attempt-clock';
import {
  attemptStorage,
  clearAttemptState,
  readAttemptState,
  writeAttemptState,
  type AttemptStorage,
} from '@/lib/attempt-store';
import { armPending, submitDecision, takePending } from '@/lib/attempt-submit';
import {
  ParentApiError,
  parentApi,
  type AttemptView,
  type StudentPracticeTestView,
} from '@/lib/parent-api';
import { comfortableDensity, measure, rounded, typeRoles } from '@/theme/tokens';
import { deviceIsUnbound } from '../../page';
import { AnswerInput } from '../../_components/AnswerInput';
import { AttemptTimer } from '../../_components/AttemptTimer';
import { QuestionMap } from '../../_components/QuestionMap';

/**
 * Take Test: one Question at a time, with a map of the whole test beside it, a
 * countdown the server owns, and a control that hands the work in.
 *
 * **The URL names the practice test and nothing else.** Which child it belongs
 * to is the binding cookie's answer, server-side, so a child holding a sibling's
 * id learns only that there is nothing there.
 *
 * **Who holds what.** The answers are the browser's (AD-26): they live in this
 * component's state *and* in `attempt-store`, keyed to the Attempt and the Student
 * Profile, with a 72-hour TTL measured from creation. A refresh, a backgrounded
 * tab, a slept device and a dropped connection all come back to the same answers
 * and the same place in the test. The **clock is the server's**: `startedAt` and
 * `expiresAt` are written once at start, and whether the deadline had passed is
 * decided server-side at submit, against the stored column. This screen renders a
 * countdown from those instants through a fixed offset and decides nothing.
 *
 * **Nothing after the initial read needs the network until the child hands in.**
 * Typing, selecting, Back, Next and the map all work with the connection gone.
 * Handing in does not, and is refused with a plain sentence rather than retried:
 * there is no timer retry, no backoff, no queue and no loop anywhere in this file.
 * The one automatic dispatch is the single **take** of the pending-submit latch on
 * an `online` transition, which empties itself in the act of being read — so two
 * `online` events, a reload between them, or a re-render produce one submit.
 *
 * **Nothing here says anything about being right.** The view it renders carries no
 * answer key, the map states only Answered or Not answered, and handing in answers
 * with two instants and a boolean about *time* rather than about work. Grading,
 * scores and what a blank means are later stories'.
 *
 * Navigation is linear *and* random-access: Back and Next walk the test, and the
 * map is the escape hatch (UX-DR39). The map is a persistent rail from the `md`
 * breakpoint up and an overlay below it — decided in CSS, both forms rendered,
 * so the first paint agrees with the server's. This screen is one of the two
 * `Screen.tsx` names as the deliberate breakpoint exception, which is why the
 * split is written here. The Question column stays capped at the 34rem measure
 * at every width; the rail takes the surplus (UX-DR15/34).
 */
export default function TakeTestPage() {
  const router = useRouter();
  const params = useParams<{ practiceTestId: string }>();
  const practiceTestId = params.practiceTestId;

  const [test, setTest] = useState<StudentPracticeTestView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Bumped by the retry control, so a read that stopped on a failure re-issues. */
  const [reload, setReload] = useState(0);

  /**
   * What the child has answered, by Question id.
   *
   * A Question nobody has touched is **absent**, never `''` — so "never
   * answered" and "answered then cleared" are one state, because to a child they
   * are. Held here *and* mirrored into the store on every change, which is what
   * makes it survive a reload.
   */
  const [answers, setAnswers] = useState<Record<string, string>>({});
  /** Which Question is on screen, as an index into the stored order. */
  const [index, setIndex] = useState(0);
  /** Whether the overlay form of the map is open. Below `md` only. */
  const [mapOpen, setMapOpen] = useState(false);

  /**
   * Which child this device is bound to, as the session read answered.
   *
   * The store is keyed to the Attempt **and** the profile (AD-26), so this screen
   * has to know which child is working — and it learns it the only way anything
   * here learns anything about a profile: by asking the server what the binding
   * cookie says. Nothing sends a profile id anywhere.
   */
  const [profileId, setProfileId] = useState<string | null>(null);
  /** The Attempt this work belongs to, or null until the start call answers. */
  const [attempt, setAttempt] = useState<AttemptView | null>(null);
  /**
   * This browser's clock at the moment the start response arrived.
   *
   * Half of the offset the countdown is computed through; `attempt.serverNow` is
   * the other half. Without it the countdown would be this device's clock, and a
   * device running ten minutes fast would show ten minutes it never had.
   */
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  /** Which Attempt the store has already been read for, so hydration happens once. */
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);

  /** The wall clock, re-read on an interval. Never a count of this page's ticks. */
  const [now, setNow] = useState(() => Date.now());
  /** Whether this browser believes it has a connection. */
  const [online, setOnline] = useState(true);
  /** The threshold currently being warned about, or null in steady state. */
  const [warning, setWarning] = useState<number | null>(null);

  /** Where the hand-in stands. `sending` is the only state with a request out. */
  const [submitState, setSubmitState] = useState<'open' | 'sending' | 'done'>('open');
  /** What to say about the last hand-in, or null while there is nothing to say. */
  const [submitNote, setSubmitNote] = useState<string | null>(null);
  /** Whether the screen is handing in on its own, so the move is announced first. */
  const [autoSubmitting, setAutoSubmitting] = useState(false);
  /** Whether the deadline passed with no connection, so the waiting is stated. */
  const [waitingForOnline, setWaitingForOnline] = useState(false);
  /**
   * An Attempt the server reported as already handed in, whose record has still to be
   * removed.
   *
   * Held rather than cleared on the spot because the store is keyed by profile and the
   * session read settles independently of the start call — so at the moment the start
   * response lands there may be no key to remove it by yet. The effect below does it
   * as soon as there is.
   */
  const [submittedAttemptToClear, setSubmittedAttemptToClear] = useState<string | null>(null);

  // A response is applied only while it is still the most recent request, so a
  // read superseded by Retry cannot resolve afterwards and overwrite it.
  const requestId = useRef(0);

  /**
   * This page's storage: the browser's, or an in-memory stand-in for a private or
   * blocked one.
   *
   * Resolved once. A fresh stand-in per render would be a fresh set of answers per
   * render, which is the child's work lost on the next keystroke. Every access goes
   * through `attempt-store`, which wraps each one — a throwing storage degrades to
   * in-memory answers for the page's lifetime and never breaks the screen.
   */
  const storage = useRef<AttemptStorage | null>(null);
  if (storage.current === null) storage.current = attemptStorage();

  /** The previous reading, which is what makes a threshold a *crossing*. */
  const previousRemaining = useRef<number | null>(null);

  /**
   * Which Attempt's deadline has already been acted on.
   *
   * The deadline is reached **once**, and this is what makes acting on it happen once
   * too. Without it, `submitState` in the deadline effect's dependency list is a retry
   * loop: a failed auto-submit sets it back to `'open'`, which re-satisfies the effect
   * while `remaining` is still 0 and the browser is still online, which dispatches
   * again, which fails again — forever, and against the intent's "never on a timer,
   * never in a loop, never silently".
   *
   * A ref rather than state, because it has to be true *synchronously* for the very
   * next run of the effect.
   *
   * Declared up here, above the render-phase reset below, because that reset clears
   * both of these refs and a `const` read before its own declaration is a
   * `ReferenceError` rather than a `null`.
   */
  const deadlineActedFor = useRef<string | null>(null);

  /**
   * Which practice test the state below belongs to.
   *
   * Everything this screen holds — the answers, the place in the test, the Attempt,
   * the clock's offset, whether the map is open — is *about one practice test*, and
   * a client-side move to a different one has to leave all of it behind. Without
   * this, opening a shorter test from a longer one keeps an `index` past the end, so
   * a perfectly successful read renders the failure alert; the previous test's
   * answers would be held against the new test's Question ids; and the previous
   * Attempt's deadline would be counted down on a test it does not belong to.
   *
   * Keyed on the id and **not** on `reload`: a retry is the same test asked for
   * again, and discarding a child's answers because the network dropped once
   * would be this screen throwing away their work.
   *
   * React's documented "adjust state when a prop changes" pattern: it runs in
   * the render phase, so the reset is already applied on the render that moved,
   * rather than one paint later.
   */
  const [loadedTestId, setLoadedTestId] = useState(practiceTestId);
  if (loadedTestId !== practiceTestId) {
    setLoadedTestId(practiceTestId);
    setTest(null);
    setError(null);
    setAnswers({});
    setIndex(0);
    setMapOpen(false);
    setAttempt(null);
    setSyncedAt(null);
    setHydratedFor(null);
    setWarning(null);
    setSubmitState('open');
    setSubmitNote(null);
    setAutoSubmitting(false);
    setWaitingForOnline(false);
    setSubmittedAttemptToClear(null);
    // Refs are not state and the reset above does not reach them. Both are *about one
    // practice test*: a deadline already acted on, and the previous reading the
    // warning crossings are measured against.
    deadlineActedFor.current = null;
    previousRemaining.current = null;
  }

  useEffect(() => {
    const thisRequest = (requestId.current += 1);
    setLoading(true);
    setError(null);
    parentApi.studentPracticeTest(practiceTestId).then(
      (value) => {
        if (requestId.current !== thisRequest) return;
        setTest(value);
        setLoading(false);
      },
      (cause: unknown) => {
        if (requestId.current !== thisRequest) return;
        // The Student Mode guard's own refusal is the one failure that routes
        // anywhere. A 500, a 429, a 404 or a dropped connection is a bad moment,
        // not a Student Mode taken away, and routing a child away on one would
        // make a flaky network look like their practice being withdrawn.
        if (deviceIsUnbound(cause)) {
          router.replace('/auth/sign-in');
          return;
        }
        setLoading(false);
        // Cleared before the failure is stated, or a read that fails *after* one
        // succeeded would leave the previous answer on screen with nothing said
        // about it: the error branch below is reached only while there is no
        // test, so a stale one would swallow the alert entirely.
        setTest(null);
        setError(cause instanceof Error ? cause.message : studentCopy.takeTest.failed);
      },
    );
  }, [practiceTestId, reload, router]);

  /**
   * Which child is working, from the binding alone.
   *
   * Settled on its own rather than as one `Promise.all` with the test read, for the
   * reason Student Home gives: one failing read must not blank what the other
   * answered. A failure here costs the store's key and nothing else — the screen
   * still renders, and the answers still live in state for the page's lifetime.
   */
  useEffect(() => {
    let live = true;
    parentApi.studentSession().then(
      (session) => {
        if (live) setProfileId(session.profile.id);
      },
      (cause: unknown) => {
        if (deviceIsUnbound(cause)) router.replace('/auth/sign-in');
      },
    );
    return () => {
      live = false;
    };
  }, [router]);

  /**
   * Opens the Attempt, or resumes the one already open.
   *
   * After the test read, because there is nothing to open an Attempt on until the
   * test is known to be there. Idempotent on the server, so a retry, a second tab
   * and a re-entry all get the same row back with its original instants — which is
   * what keeps a reload from handing the child a fresh deadline.
   *
   * `syncedAt` is stamped from this browser's clock the moment the response lands,
   * and it is the only clock reading this screen ever trusts as a *pair* with the
   * server's.
   */
  useEffect(() => {
    if (test === null) return;
    let live = true;
    parentApi.startAttempt(practiceTestId).then(
      (value) => {
        if (!live) return;
        setAttempt(value);
        setSyncedAt(Date.now());
        setNow(Date.now());
        // An Attempt that is already in is not one to work under. It is the state
        // a child reaches by pressing Back into a test they handed in.
        if (value.submittedAt !== null) {
          setSubmitState('done');
          // And the record goes, for the same reason a successful hand-in clears it:
          // work that is in is not work this device has any reason to hold. Reaching
          // this screen after handing in on *another* device — or after the tab that
          // submitted was closed before it could clear up — would otherwise leave the
          // answers sitting there until the 72-hour TTL swept them.
          setSubmittedAttemptToClear(value.id);
        }
      },
      (cause: unknown) => {
        if (!live) return;
        if (deviceIsUnbound(cause)) {
          router.replace('/auth/sign-in');
          return;
        }
        setError(cause instanceof Error ? cause.message : studentCopy.takeTest.attemptFailed);
        setTest(null);
      },
    );
    return () => {
      live = false;
    };
  }, [test, practiceTestId, router]);

  /**
   * Reads the child's work back out of the store, once per Attempt.
   *
   * Once, and before anything is written: a persist effect that ran first would
   * overwrite the record with this render's empty state, which is the child's work
   * destroyed by the very mechanism meant to keep it. `hydratedFor` is what orders
   * the two.
   *
   * An `index` past the end of a shorter test is clamped rather than trusted: the
   * record is keyed to the Attempt, so it cannot belong to another test, but a
   * Question deleted between two sessions is still a place that no longer exists.
   */
  useEffect(() => {
    if (attempt === null || profileId === null || test === null) return;
    if (hydratedFor === attempt.id) return;
    const stored = readAttemptState(storage.current, profileId, attempt.id);
    if (stored !== null) {
      setAnswers(stored.answers);
      setIndex(Math.min(Math.max(0, stored.index), Math.max(0, test.questions.length - 1)));
      // A latch armed in a previous session: the deadline passed while offline and
      // the work has still to go up. Stated, not dispatched — the dispatch is the
      // `online` transition's.
      if (stored.pendingSubmitAt !== null) setWaitingForOnline(true);
    }
    setHydratedFor(attempt.id);
  }, [attempt, profileId, test, hydratedFor]);

  /**
   * Removes the record of an Attempt the server says is already in.
   *
   * The same rule a successful hand-in follows, reached by the other route: resuming a
   * submitted Attempt. Without it the answers of work already handed in sit on the
   * device until the TTL sweeps them, which is not what "removed on successful
   * submission" means.
   */
  useEffect(() => {
    if (submittedAttemptToClear === null || profileId === null) return;
    clearAttemptState(storage.current, profileId, submittedAttemptToClear);
    setSubmittedAttemptToClear(null);
  }, [submittedAttemptToClear, profileId]);

  /**
   * Mirrors every change into the store.
   *
   * On every change, not on a debounce: the whole point is that the keystroke
   * before a device went to sleep is the keystroke that comes back. The latch is
   * carried through untouched — this effect saves answers, never arms or disarms
   * anything.
   *
   * The TTL is not extended by any of this. `writeAttemptState` keeps the record's
   * original `createdAt`, so an actively used record still ages out at 72 hours.
   */
  useEffect(() => {
    if (attempt === null || profileId === null) return;
    if (hydratedFor !== attempt.id) return;
    if (submitState === 'done') return;
    const existing = readAttemptState(storage.current, profileId, attempt.id);
    writeAttemptState(storage.current, profileId, attempt.id, {
      answers,
      index,
      pendingSubmitAt: existing?.pendingSubmitAt ?? null,
    });
  }, [answers, index, attempt, profileId, hydratedFor, submitState]);

  /**
   * Re-reads the wall clock.
   *
   * A re-read, never a tick it counts. `setNow(Date.now())` and nothing else: the
   * remaining time is computed from the server's instants against this reading, so a
   * browser that throttled this interval in a background tab shows a *correct*
   * figure on the next reading rather than a countdown that lost the minutes it
   * slept. `performance.now()` was rejected for the same reason — it counts the
   * page's life, not the wall clock.
   */
  useEffect(() => {
    if (attempt === null || attempt.expiresAt === null) return;
    const handle = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(handle);
  }, [attempt]);

  /**
   * What the connection is doing, and what a tab coming back to the front means.
   *
   * `visibilitychange` re-reads the clock immediately rather than waiting for the
   * next interval, so a tab hidden for ten minutes shows the fallen figure on the
   * paint it returns on instead of up to a second later.
   */
  useEffect(() => {
    const readNetwork = () => setOnline(navigator.onLine);
    const readClock = () => setNow(Date.now());
    readNetwork();
    window.addEventListener('online', readNetwork);
    window.addEventListener('offline', readNetwork);
    document.addEventListener('visibilitychange', readClock);
    return () => {
      window.removeEventListener('online', readNetwork);
      window.removeEventListener('offline', readNetwork);
      document.removeEventListener('visibilitychange', readClock);
    };
  }, []);

  const questions = test?.questions ?? [];
  /**
   * How many Questions there are, counted from the Questions themselves.
   *
   * Not from the stored `questionCount` column: the counter and the Next control
   * have to be reading the same figure, and sourcing one from the column and the
   * other from the array is how a screen ends up saying "Question 3 of 5" with
   * Next already disabled.
   */
  const total = questions.length;
  /**
   * Every Question's progress state, in the order the server gave them.
   *
   * Derived on every render from the answers themselves, so the map cannot
   * disagree with the controls: there is no second copy of "is this answered"
   * for the two to drift apart on.
   */
  const progress = useMemo(() => progressOf(questions, answers), [questions, answers]);

  /**
   * How much time is left, computed from the server's instants through the offset.
   *
   * `null` for an untimed Attempt, and `null` before the start call answers: there
   * is nothing to count until the server has said what the deadline is.
   */
  const remaining =
    attempt === null || syncedAt === null
      ? null
      : remainingMs({
          expiresAt: attempt.expiresAt === null ? null : Date.parse(attempt.expiresAt),
          serverNow: Date.parse(attempt.serverNow),
          syncedAt,
          now,
        });

  useEffect(() => {
    const crossed = warningFor(previousRemaining.current, remaining);
    previousRemaining.current = remaining;
    // Only on the crossing render. A comparison instead would re-announce on every
    // later tick below the threshold, which is exactly what must not happen.
    if (crossed !== null) setWarning(crossed);
  }, [remaining]);

  /**
   * Takes the warning back down.
   *
   * A warning is an **event**, and a sentence that stayed up after its moment would
   * make it a state: the live region would never be quiet between thresholds, and at
   * zero the screen would say both that the time is up and that twenty seconds
   * remain. `WARNING_VISIBLE_MS` is shorter than the smallest threshold, so the last
   * warning has already cleared itself by the time the countdown reaches zero.
   *
   * A `setTimeout` for a *sentence*, which is not a retry of anything: nothing about
   * the Attempt, the network or the hand-in is touched here.
   */
  useEffect(() => {
    if (warning === null) return;
    const handle = setTimeout(() => setWarning(null), WARNING_VISIBLE_MS);
    return () => clearTimeout(handle);
  }, [warning]);

  // Belt and braces for the one overlap that would be worst to read: the deadline
  // reached with a warning still showing. The timeout above normally gets there
  // first; a throttled background tab that jumped from above 20 seconds straight to
  // zero would not have given it the chance.
  useEffect(() => {
    if (remaining === 0) setWarning(null);
  }, [remaining]);

  /**
   * The latest state a hand-in would send, held where a listener can reach it.
   *
   * The `online` listener is attached once, so it cannot close over this render's
   * answers. A ref is the honest way to say "whatever is current at the moment it
   * fires" — the alternative is re-attaching the listener on every keystroke.
   */
  const pending = useRef({ attempt, profileId, answers, remaining, submitState });
  pending.current = { attempt, profileId, answers, remaining, submitState };

  /** Whether a submission is out right now, known synchronously. See `send`. */
  const inFlight = useRef(false);

  /**
   * Sends the work up, once.
   *
   * Every refusal here is a **statement**, never a retry. There is no `setTimeout`,
   * no backoff and no re-arming in any branch: a failure leaves the Attempt open,
   * every answer in the store, and the control live for the child to press again.
   * The only thing that dispatches without a person is the latch's take, below.
   */
  const send = useCallback(
    (auto: boolean) => {
      const { attempt: current, profileId: profile, answers: held } = pending.current;
      // The Attempt alone. **Not the profile**: the server takes both ids off the
      // binding cookie, so a hand-in needs nothing this screen knows about a profile.
      // Gating the dispatch on `profileId` made a failed `studentSession()` — any
      // failure that is not an unbound device — into an enabled Hand in control that
      // did nothing at all and said nothing about it. The profile is the *store's*
      // key, so only the store calls below are guarded on it.
      if (current === null) return;
      if (pending.current.submitState !== 'open') return;
      // Synchronous, because `setSubmitState` is not. Two effects satisfied in one
      // commit — the deadline's and the latch's — would both read `'open'` from the
      // last render and both dispatch. This ref closes that window; the state below
      // is what the screen renders from.
      if (inFlight.current) return;
      inFlight.current = true;

      setSubmitNote(null);
      setSubmitState('sending');
      if (auto) setAutoSubmitting(true);

      parentApi
        .submitAttempt(
          current.id,
          Object.entries(held).map(([questionId, value]) => ({ questionId, value })),
        )
        .then(
          () => {
            inFlight.current = false;
            setSubmitState('done');
            setWaitingForOnline(false);
            // `autoSubmitting` is deliberately **not** cleared here. The screen is about
            // to move to the handed-in state, which renders the announcement itself: a
            // flag cleared on success would unmount the alert after the handful of
            // milliseconds the request took, and an alert that exists for 50ms is one no
            // child and no screen reader ever receives. It is cleared on failure
            // instead, where the screen stays on the test and there is nothing to
            // announce.
            // Work that has been handed in is not work this device has any reason to
            // keep. The record goes, latch and all — when there is a profile to key it
            // by. Without one nothing was ever written, so there is nothing to remove.
            if (profile !== null) clearAttemptState(storage.current, profile, current.id);
          },
          (cause: unknown) => {
            inFlight.current = false;
            setAutoSubmitting(false);
            if (deviceIsUnbound(cause)) {
              router.replace('/auth/sign-in');
              return;
            }
            // Already in. Said, and never sent again: a second dispatch would tell a
            // child their handed-in work failed.
            if (cause instanceof ParentApiError && cause.status === 409) {
              setSubmitState('done');
              setWaitingForOnline(false);
              if (profile !== null) clearAttemptState(storage.current, profile, current.id);
              setSubmitNote(studentCopy.takeTest.alreadyHandedIn);
              return;
            }
            // Back to open, which is the whole of the recovery: the child presses
            // again, or the next `online` transition takes a latch somebody armed.
            // The latch this dispatch may have been sent for was already emptied by
            // the take that triggered it, so the wait it was announcing is over —
            // leaving it set would claim an automatic hand-in is still arranged when
            // nothing will retry it again.
            setWaitingForOnline(false);
            setSubmitState('open');
            setSubmitNote(
              cause instanceof ParentApiError && cause.status === 0
                ? studentCopy.takeTest.offlineSubmit
                : studentCopy.takeTest.submitFailed,
            );
          },
        );
    },
    [router],
  );

  /**
   * What a press of Hand in does.
   *
   * The decision is `attempt-submit`'s, so "offline refuses, expired-and-offline
   * waits, online sends" is a rule with a spec rather than a branch in a handler.
   * Arming the latch here is what makes the wait survive a reload.
   */
  const handIn = useCallback(() => {
    const { attempt: current, profileId: profile, remaining: left } = pending.current;
    if (current === null) return;
    const expiredAt = left === 0 ? Date.now() : null;
    const action = submitDecision({
      online: navigator.onLine,
      expiredAt,
      submitted: pending.current.submitState === 'done',
    });
    if (action === 'send') {
      send(false);
      return;
    }
    if (action === 'already-submitted') {
      setSubmitNote(studentCopy.takeTest.alreadyHandedIn);
      return;
    }
    if (action === 'wait-for-online') {
      // A latch keyed by a profile that has not resolved yet cannot be armed —
      // and telling the child it is "already arranged" when nothing was
      // written would be a promise the reconnect-take effect can never keep.
      // The control stays live either way: pressing again once online sends
      // directly, since `send` above never gates on the profile.
      if (profile === null) {
        setSubmitNote(studentCopy.takeTest.offlineSubmit);
        return;
      }
      armPending(storage.current, profile, current.id, expiredAt!);
      setWaitingForOnline(true);
      return;
    }
    // Offline with time still on the clock. The Attempt stays open, every answer
    // stays in the store, and the control stays live — the sentence *is* the
    // handling, and nothing re-sends on its own.
    setSubmitNote(studentCopy.takeTest.offlineSubmit);
  }, [send]);

  /**
   * The deadline reached.
   *
   * Online, the work goes up on its own with a `role="alert"` announcement before
   * the screen moves. Offline, the latch is armed and the waiting is stated — and
   * that is all: nothing polls for a connection.
   *
   * **Once per Attempt, whatever comes of it.** A dispatch that fails leaves the
   * Attempt open, every answer in the store and the control live — and the recovery is
   * a person's press or the single reconnect take, never this effect running again.
   */
  useEffect(() => {
    if (remaining !== 0 || attempt === null || attempt.expiresAt === null) return;
    if (submitState !== 'open') return;
    // Not before the store has been read. Without this guard, resuming an Attempt
    // whose deadline had already passed auto-submits the *empty* answer set on the
    // first render — and the success path then clears the record, so the child's
    // stored work is destroyed by the very mechanism meant to hand it in.
    if (hydratedFor !== attempt.id) return;
    if (deadlineActedFor.current === attempt.id) return;
    // Read here rather than taken from state, and **`online` is deliberately not a
    // dependency**: the deadline is reached once, and this effect must act once. If
    // it re-ran on a reconnect it would dispatch alongside the latch below, and
    // "exactly one submit on reconnect" would be two.
    if (navigator.onLine) {
      deadlineActedFor.current = attempt.id;
      send(true);
      return;
    }
    // Offline with the profile not resolved yet: arming here would key the latch
    // to nothing, so the reconnect-take effect below would find it empty forever
    // while the screen still claimed the hand-in was arranged. Acted-once is not
    // marked, so this render is skipped rather than spent — the effect runs again
    // as soon as `profileId` settles.
    if (profileId === null) return;
    deadlineActedFor.current = attempt.id;
    armPending(storage.current, profileId, attempt.id, Date.now());
    setWaitingForOnline(true);
    // `online` is deliberately absent from this list. See above.
  }, [remaining, attempt, submitState, profileId, hydratedFor, send]);

  /**
   * The one automatic dispatch, and it happens at most once.
   *
   * `takePending` **empties the latch in the act of reading it**, so a duplicate
   * `online` event, a re-render or a reload that raced the first all take nothing
   * and dispatch nothing. A dispatch that then fails leaves the Attempt open and
   * says so; it does not re-arm itself, and nothing here loops.
   */
  useEffect(() => {
    if (!online || attempt === null || profileId === null) return;
    if (hydratedFor !== attempt.id) return;
    if (submitState !== 'open') return;
    // **Checked before the take, not after.** `send` early-returns on this same ref,
    // so taking the latch first would empty it against a dispatch that never happened:
    // the manual submit already out would finish, and if it failed the latch that was
    // supposed to cover the reconnect would be gone — while the screen still told the
    // child the hand-in was arranged. A take must never be spent on nothing.
    if (inFlight.current) return;
    if (takePending(storage.current, profileId, attempt.id) === null) return;
    send(true);
  }, [online, attempt, profileId, hydratedFor, submitState, send]);

  const jumpTo = useCallback((next: number) => {
    setIndex(next);
    setMapOpen(false);
  }, []);

  /** The handed-in heading, focused on arrival so the move is never silent. */
  const handedInHeading = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    if (submitState === 'done') handedInHeading.current?.focus();
  }, [submitState]);

  if (submitState === 'done') {
    return (
      <Screen component="section" measured>
        {/* The auto-submit announcement, carried into the state it announces.

            A move the child did not ask for has to be *said*, and saying it only
            between the dispatch and the response says it for as long as a request
            takes — which is no time at all, and no announcement. It is rendered here,
            ahead of the heading focus lands on, so the reason the screen moved is the
            first thing read out. A hand-in the child pressed for themselves needs no
            such sentence and does not get one. */}
        {autoSubmitting && (
          <Alert
            severity="info"
            role="alert"
            variant="outlined"
            data-testid="take-test-auto-submit"
          >
            {studentCopy.takeTest.autoSubmitAnnouncement}
          </Alert>
        )}
        <Typography
          component="h1"
          // Focusable only programmatically: the heading is where the child lands,
          // not a stop on the way through the page.
          tabIndex={-1}
          ref={handedInHeading}
          data-testid="take-test-handed-in-heading"
          sx={{ ...typeRoles.cardTitle }}
        >
          {studentCopy.takeTest.handedInHeading}
        </Typography>
        <Alert
          severity="success"
          role="status"
          variant="outlined"
          data-testid="take-test-handed-in"
        >
          {submitNote ?? studentCopy.takeTest.handedIn}
        </Alert>
      </Screen>
    );
  }

  if (loading || (test === null && error === null)) {
    return (
      <Screen component="section" measured>
        <Alert severity="info" role="status" variant="outlined">
          {studentCopy.takeTest.loading}
        </Alert>
      </Screen>
    );
  }

  const question = questions[index];

  if (test === null || question === undefined) {
    return (
      <Screen component="section" measured>
        <Alert
          severity="error"
          role="alert"
          variant="outlined"
          data-testid="take-test-error"
          action={
            <Button
              onClick={() => setReload((value) => value + 1)}
              sx={{ minHeight: comfortableDensity.tapTarget }}
            >
              {studentCopy.retry}
            </Button>
          }
        >
          {error ?? studentCopy.takeTest.failed}
        </Alert>
      </Screen>
    );
  }

  const promptId = `question-prompt-${question.id}`;
  const answer = answers[question.id] ?? '';
  const setAnswer = (next: string) =>
    setAnswers((previous) => ({ ...previous, [question.id]: next }));

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        gap: `${comfortableDensity.gap}px`,
      }}
    >
      <Screen component="section" measured>
        {/* Announced before the screen changes, so a move the child did not ask
            for is never silent. */}
        {autoSubmitting && (
          <Alert
            severity="info"
            role="alert"
            variant="outlined"
            data-testid="take-test-auto-submit"
          >
            {studentCopy.takeTest.autoSubmitAnnouncement}
          </Alert>
        )}

        {/* The deadline passed with no connection. It states that the time is up
            and that the handing in is already arranged, so there is nothing left
            for the child to keep pressing. */}
        {waitingForOnline && (
          <Alert
            severity="info"
            role="status"
            variant="outlined"
            data-testid="take-test-offline-expired"
          >
            {studentCopy.takeTest.offlineExpired}
          </Alert>
        )}

        {/* What the last hand-in came to: needs a connection, already in, or could
            not be done. Each one is a statement with the control still live beside
            it — nothing here re-sends on its own. */}
        {submitNote !== null && (
          <Alert
            severity="warning"
            role="alert"
            variant="outlined"
            data-testid="take-test-submit-note"
          >
            {submitNote}
          </Alert>
        )}

        {/* The one clock on the screen, and it is in the Question column rather
            than the rail: the rail is hidden below `md`, and a countdown a child
            cannot see on a phone is a countdown that does not exist. One instance,
            so no two readings of the same deadline can drift apart. */}
        <AttemptTimer remainingMs={remaining} warning={warning} />

        {/* The deadline reached, said plainly. Not shown while the offline-expired
            sentence or the auto-submit announcement is up — those already say it,
            and saying it twice is two statements about one fact. */}
        {remaining === 0 && !waitingForOnline && !autoSubmitting && (
          <Typography data-testid="take-test-time-up" sx={{ ...typeRoles.label }}>
            {studentCopy.takeTest.timeUp}
          </Typography>
        )}

        <Typography data-testid="take-test-counter" sx={{ ...typeRoles.label }}>
          {studentCopy.takeTest.counter(question.ordinal, total)}
        </Typography>
        <Typography data-testid="take-test-format" sx={{ ...typeRoles.caption }}>
          {studentCopy.takeTest.format[question.format]}
        </Typography>

        {/* The paper role: near-square radius, the generated-content type role,
            and the 34rem measure the column already carries (UX-DR12/15). */}
        <Box
          data-testid="take-test-question"
          sx={(theme) => ({
            borderRadius: `${rounded.paper}px`,
            border: `1px solid ${theme.vars.palette.divider}`,
            backgroundColor: theme.vars.palette.background.paper,
            padding: `${comfortableDensity.cardPadding}px`,
            maxWidth: measure.questionMaxWidth,
            display: 'grid',
            gap: `${comfortableDensity.gap}px`,
          })}
        >
          <Typography id={promptId} component="p" sx={{ ...typeRoles.questionBody }}>
            <RichText segments={question.prompt} />
          </Typography>
          <AnswerInput
            question={question}
            value={answer}
            onChange={setAnswer}
            labelledBy={promptId}
          />
        </Box>

        <Box sx={{ display: 'flex', gap: `${comfortableDensity.gap}px`, flexWrap: 'wrap' }}>
          <Button
            variant="outlined"
            data-testid="take-test-back"
            disabled={index === 0}
            onClick={() => jumpTo(index - 1)}
            sx={{ minHeight: comfortableDensity.tapTarget }}
          >
            {studentCopy.takeTest.back}
          </Button>
          <Button
            variant="outlined"
            data-testid="take-test-next"
            disabled={index >= questions.length - 1}
            onClick={() => jumpTo(index + 1)}
            sx={{ minHeight: comfortableDensity.tapTarget }}
          >
            {studentCopy.takeTest.next}
          </Button>
          {/* The overlay's opener. Hidden from `md` up in CSS, where the rail is
              already on screen — never by a JS media query, which would make the
              first paint disagree with the server's. */}
          <Button
            variant="outlined"
            data-testid="take-test-map-open"
            onClick={() => setMapOpen(true)}
            sx={{
              minHeight: comfortableDensity.tapTarget,
              display: { xs: 'inline-flex', md: 'none' },
            }}
          >
            {studentCopy.takeTest.openMap}
          </Button>
          {/* Disabled only while a request is actually out. Offline it stays live
              on purpose: the refusal is a sentence the child can act on by pressing
              again, and a dead control would leave them nothing to do. */}
          <Button
            variant="contained"
            data-testid="take-test-hand-in"
            disabled={submitState === 'sending' || attempt === null}
            onClick={handIn}
            sx={{ minHeight: comfortableDensity.tapTarget }}
          >
            {submitState === 'sending'
              ? studentCopy.takeTest.handingIn
              : studentCopy.takeTest.handIn}
          </Button>
        </Box>
      </Screen>

      {/* The rail: the same component the overlay holds, so the two forms can
          never drift into saying different things about the same test. And the one
          timer, rendered here alone — a second copy beside the Question column
          would be a second reading of the same deadline. */}
      <Box
        data-testid="take-test-map-rail"
        component="aside"
        sx={{
          display: { xs: 'none', md: 'block' },
          paddingBlock: `${comfortableDensity.sectionMargin}px`,
          paddingInline: `${comfortableDensity.cardPadding}px`,
        }}
      >
        <QuestionMap progress={progress} currentIndex={index} onJump={jumpTo} />
      </Box>

      <AppDialog
        open={mapOpen}
        title={studentCopy.takeTest.mapHeading}
        onClose={() => setMapOpen(false)}
        actions={
          <Button
            data-testid="take-test-map-close"
            onClick={() => setMapOpen(false)}
            sx={{ minHeight: comfortableDensity.tapTarget }}
          >
            {studentCopy.takeTest.closeMap}
          </Button>
        }
      >
        <QuestionMap progress={progress} currentIndex={index} onJump={jumpTo} />
      </AppDialog>
    </Box>
  );
}
