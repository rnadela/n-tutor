import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { studentCopy } from '@/copy/student';

const SOURCE = readFileSync(path.resolve(import.meta.dirname, 'page.tsx'), 'utf8');

/**
 * The same file with every comment removed.
 *
 * A ban on a *word* has to be a ban on the code, not on the prose: this screen is
 * required to explain at length why the clock is the server's, why nothing retries
 * and why it says nothing about being right, and a bare `not.toContain('score')`
 * over the raw source would make writing that explanation a test failure.
 */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');

describe('what sends a child away from Take Test', () => {
  it('is the Student Mode guard’s own refusal, and only that', () => {
    expect(CODE).toMatch(
      /if \(deviceIsUnbound\(cause\)\) \{\s*router\.replace\('\/auth\/sign-in'\)/u,
    );
    // Every navigation in the whole file is that one, and there is a guard for
    // each: a 500, a 429, a 404 or a dropped connection is a bad moment, not a
    // Student Mode taken away. Four reads now share the rule — the test, the
    // session, the Attempt start and the hand-in — and each acts on it identically.
    const replaces = CODE.match(/router\.replace\('\/auth\/sign-in'\)/gu) ?? [];
    expect(CODE.match(/router\.replace/gu)).toHaveLength(replaces.length);
    expect(CODE.match(/deviceIsUnbound\(cause\)/gu)).toHaveLength(replaces.length);
    // And nothing else in the file navigates anywhere at all.
    expect(CODE).not.toMatch(/router\.(push|back|forward)/u);
  });

  it('renders a retryable error for everything else, instead of routing', () => {
    expect(CODE).toContain('setError(');
    expect(CODE).toContain('data-testid="take-test-error"');
    expect(CODE).toContain('{studentCopy.retry}');
    // The retry re-issues the read rather than asking the child to reload.
    expect(CODE).toMatch(/setReload\(\(value\) => value \+ 1\)/u);
  });

  it('clears what is on screen before it states a failure', () => {
    // The error branch is reached only while there is no test, so a read that
    // fails *after* one succeeded has to put the screen back to nothing — or the
    // previous Question stays up and the alert is never rendered at all.
    expect(CODE).toMatch(/setTest\(null\);\s*setError\(/u);
  });
});

describe('moving from one practice test to another', () => {
  it('leaves the previous test’s state behind, all of it', () => {
    // Everything this screen holds is about one practice test. Carrying `index`
    // into a shorter one puts it past the end, so a perfectly successful read
    // renders the failure alert — and the old answers would be held against the
    // new test's Question ids.
    const reset = CODE.slice(
      CODE.indexOf('if (loadedTestId !== practiceTestId) {'),
      CODE.indexOf('useEffect(() => {'),
    );
    expect(reset).toContain('setTest(null)');
    expect(reset).toContain('setAnswers({})');
    expect(reset).toContain('setIndex(0)');
    expect(reset).toContain('setMapOpen(false)');
    // And the Attempt with them: its deadline belongs to the test it was opened
    // on, and counting it down on another one would be the wrong clock entirely.
    expect(reset).toContain('setAttempt(null)');
    expect(reset).toContain('setSyncedAt(null)');
    // The store key is the Attempt's, so dropping the Attempt drops the key — and
    // hydration has to run again for whatever Attempt the next test opens.
    expect(reset).toContain('setHydratedFor(null)');
    expect(reset).toContain("setSubmitState('open')");
  });

  it('does not discard a child’s answers because a read had to be retried', () => {
    // Keyed on the id alone. A retry is the same test asked for again.
    expect(CODE).toMatch(/if \(loadedTestId !== practiceTestId\) \{/u);
    expect(CODE).not.toMatch(/if \([^)]*reload[^)]*\) \{\s*set(Answers|Index)/u);
  });
});

describe('what the screen reaches for', () => {
  it('calls student-scoped members only, and no parent-scoped call at all', () => {
    expect(CODE).toContain('parentApi.studentPracticeTest(practiceTestId)');
    expect(CODE).toContain('parentApi.startAttempt(practiceTestId)');
    expect(CODE).toContain('parentApi.studentSession()');
    expect(CODE).toMatch(/parentApi\s*\.\s*submitAttempt\(/u);
    // Four members, every one of them student-scoped and cookie-carried. A
    // parent-scoped call here would be a child's screen holding a parent's reach.
    for (const member of CODE.match(/parentApi\s*\.?\s*\n?\s*(\w+)/gu) ?? []) {
      expect(member.replace(/parentApi\s*\.?\s*\n?\s*/u, '')).toMatch(
        /^(studentPracticeTest|studentSession|startAttempt|submitAttempt)$/u,
      );
    }
    // And it never names a profile id on the wire: the binding names which child,
    // server-side. The profile the store is keyed by is what the session answered.
    expect(CODE).not.toMatch(/studentProfileId/u);
  });

  it('holds no elevation bearer and reads no parent state', () => {
    expect(CODE).not.toMatch(/useElevation|elevation|Authorization|bearer/iu);
  });
});

describe('what this story is not', () => {
  it('holds no score, no grade and no answer key', () => {
    // Grading is Stories 5.5–5.6. Handing in states two instants and a boolean
    // about *time*; nothing on this screen claims anything about the work.
    for (const forbidden of [/score/iu, /\bcorrect/iu, /grade(?!At)/iu, /answerKey/iu]) {
      expect(CODE).not.toMatch(forbidden);
    }
  });

  it('asks nothing about blanks and assigns nothing to them', () => {
    // Story 5.4 owns the confirmation that names blank questions and the
    // `unanswered`-versus-`incorrect` decision. This story's submit records the raw
    // answers and closes the Attempt, and states nothing about what a blank means.
    expect(CODE).not.toMatch(/unanswered/iu);
    expect(CODE).not.toMatch(/blankCount|confirmBlank/iu);
  });

  it('holds no retake, no attempt list and no second open Attempt', () => {
    // Story 5.7 and Parent View. The start route resumes; nothing here starts a
    // second one.
    expect(CODE).not.toMatch(/retake|attempts\.map|attemptList/iu);
  });
});

describe('where the child’s work is kept', () => {
  it('reaches browser storage only through `attempt-store`', () => {
    // Every rule that decides whether a child's work survives — the TTL, the
    // profile keying, the throw-wrapping, the sweep — lives in that module, where
    // it is testable with no DOM. A direct `localStorage` here would be a second
    // copy of those rules that no spec runs.
    for (const forbidden of [
      /localStorage/u,
      /sessionStorage/u,
      /indexedDB/iu,
      /document\.cookie/u,
    ]) {
      expect(CODE).not.toMatch(forbidden);
    }
    expect(CODE).toContain("from '@/lib/attempt-store'");
    expect(CODE).toContain('readAttemptState(storage.current');
    expect(CODE).toContain('writeAttemptState(storage.current');
    expect(CODE).toContain('clearAttemptState(storage.current');
    expect(CODE).toContain('const [answers, setAnswers]');
  });

  it('resolves its storage once, not per render', () => {
    // A fresh in-memory stand-in per render is a fresh set of answers per render,
    // which is the child's work lost on the next keystroke.
    expect(CODE).toMatch(/const storage = useRef<AttemptStorage \| null>\(null\);/u);
    expect(CODE).toMatch(
      /if \(storage\.current === null\) storage\.current = attemptStorage\(\);/u,
    );
  });

  it('removes the record once the work is in', () => {
    expect(CODE).toMatch(/setSubmitState\('done'\);[\s\S]{0,400}?clearAttemptState\(/u);
  });
});

describe('the clock', () => {
  it('is the server’s instants through an offset, never this browser’s clock', () => {
    expect(CODE).toContain('remainingMs({');
    expect(CODE).toContain('serverNow: Date.parse(attempt.serverNow)');
    expect(CODE).toContain('syncedAt,');
    // No expiry decided here, and no clock sent up: the server compares its own
    // clock to its own column at submit.
    expect(CODE).not.toMatch(/clientNow|browserNow|expired:/u);
    expect(CODE).not.toMatch(/performance\.now/u);
  });

  it('re-reads the wall clock on its interval rather than counting its own ticks', () => {
    // A counted tick loses exactly the time a throttled or slept device was away.
    expect(CODE).toMatch(/setInterval\(\(\) => setNow\(Date\.now\(\)\), CLOCK_TICK_MS\)/u);
    expect(CODE).toContain('clearInterval(handle)');
    expect(CODE).not.toMatch(/setNow\(\(\w+\) => \w+ \+/u);
  });

  it('comes back to the front and re-reads immediately', () => {
    expect(CODE).toContain("document.addEventListener('visibilitychange', readClock)");
    expect(CODE).toContain("document.removeEventListener('visibilitychange', readClock)");
  });

  it('warns on a crossing, from the rule rather than from a comparison here', () => {
    expect(CODE).toContain('warningFor(previousRemaining.current, remaining)');
    // No threshold figure written into this file: they are `attempt-clock`'s.
    expect(CODE).not.toMatch(/300_?000|60_?000|20_?000/u);
  });
});

describe('handing in', () => {
  it('decides from the rule, and refuses offline rather than retrying', () => {
    expect(CODE).toContain('submitDecision({');
    expect(CODE).toContain('offlineSubmit');
    // Not one retry mechanism of any kind: no backoff, no queue, no service worker.
    expect(CODE).not.toMatch(/backoff|retryIn|reSend|resend/iu);
    expect(CODE).not.toMatch(/setInterval\([^)]*submit/iu);
    expect(CODE).not.toMatch(/serviceWorker|navigator\.serviceWorker/u);
    // **No timer sends anything.** The file holds exactly one `setTimeout` and it is
    // the warning taking itself back down — a sentence, not a request. Asserted as
    // "one, and it is that one" rather than as "none at all": a blanket ban on
    // `setTimeout` reads as the stronger claim while actually being the weaker one,
    // because the very next timer added for any reason has to relax it, and whoever
    // relaxes it is the person who would have to notice it now wraps a submit.
    // To the end of the line rather than to the first `)`, which an arrow-function
    // argument reaches before the call does.
    const timeouts = CODE.match(/setTimeout\(.*$/gmu) ?? [];
    expect(timeouts).toHaveLength(1);
    expect(timeouts[0]).toContain('setWarning(null)');
    for (const timeout of timeouts) {
      expect(timeout).not.toMatch(/send|submit|parentApi|takePending|armPending/iu);
    }
  });

  it('dispatches on reconnect exactly once, through a latch it empties by reading', () => {
    expect(CODE).toContain('takePending(storage.current, profileId, attempt.id) === null');
    expect(CODE).toContain('armPending(storage.current');
    // The take is the only place the screen sends without a person, and a failed
    // send never re-arms: there is no `armPending` inside a rejection handler.
    // Exactly two places arm it: the deadline reached offline, and a press of Hand
    // in that the rule says must wait. Neither is a failure handler.
    expect(CODE.match(/armPending\(/gu)).toHaveLength(2);
    // The hand-in's own rejection handler, sliced out by the one marker only it
    // carries: the synchronous in-flight release.
    const failureStart = CODE.search(/\(cause: unknown\) => \{\s*inFlight\.current = false;/u);
    expect(failureStart).toBeGreaterThan(-1);
    const rejection = CODE.slice(failureStart, CODE.indexOf('submitFailed', failureStart) + 20);
    expect(rejection).toContain('submitFailed');
    expect(rejection).not.toContain('armPending');
  });

  it('says a 409 rather than sending again', () => {
    expect(CODE).toContain('cause.status === 409');
    expect(CODE).toContain('alreadyHandedIn');
  });

  it('announces an automatic hand-in before the screen changes, and focuses the heading', () => {
    expect(CODE).toContain('autoSubmitAnnouncement');
    expect(CODE).toMatch(/role="alert"[\s\S]{0,200}take-test-auto-submit/u);
    expect(CODE).toContain('handedInHeading.current?.focus()');
    expect(CODE).toContain('tabIndex={-1}');
  });

  it('leaves the control live while offline', () => {
    // A dead control offline would leave the child nothing to act on: the sentence
    // is the handling, and pressing again is how they act on it.
    expect(CODE).toContain("disabled={submitState === 'sending' || attempt === null}");
  });
});

describe('the order the Questions are worked in', () => {
  it('is the order the server sent, with nothing reordering it in the browser', () => {
    expect(CODE).toContain('test?.questions ?? []');
    for (const verb of [/\.sort\(/u, /\.reverse\(/u, /groupBy/u, /\.filter\(/u]) {
      expect(CODE).not.toMatch(verb);
    }
  });

  it('counts the Questions and bounds the navigation from one figure', () => {
    // Sourcing the counter from the stored `questionCount` column and Next from
    // the array is how a screen says "Question 3 of 5" with Next disabled.
    expect(CODE).toContain('const total = questions.length;');
    expect(CODE).not.toContain('test?.questionCount');
  });

  it('walks the test linearly and offers the map as the escape hatch (UX-DR39)', () => {
    expect(CODE).toContain('data-testid="take-test-back"');
    expect(CODE).toContain('data-testid="take-test-next"');
    // Disabled at the ends rather than wrapping around, which would silently
    // move a child from the last Question to the first.
    expect(CODE).toContain('disabled={index === 0}');
    expect(CODE).toContain('disabled={index >= questions.length - 1}');
    expect(CODE).toContain('QuestionMap');
    expect(CODE).toContain('onJump={jumpTo}');
  });
});

describe('the rail, the overlay and the measure', () => {
  it('decides which form of the map is shown in CSS, not with a JS media query', () => {
    // Both forms render and the breakpoint decides which is visible, so the
    // first paint agrees with the server's.
    expect(CODE).toContain("display: { xs: 'none', md: 'block' }");
    expect(CODE).toContain("display: { xs: 'inline-flex', md: 'none' }");
    expect(CODE).not.toMatch(/useMediaQuery|matchMedia/u);
  });

  it('opens and closes the overlay with real controls', () => {
    expect(CODE).toContain('data-testid="take-test-map-open"');
    expect(CODE).toContain('data-testid="take-test-map-close"');
    expect(CODE).toContain('AppDialog');
  });

  it('caps the Question column at the measure, from the token', () => {
    expect(CODE).toContain('measure.questionMaxWidth');
    expect(CODE).toContain('<Screen component="section" measured>');
    // Nested inside the layout's own `main`, so the page has one landmark and
    // not two — a second `main` makes "the main region" ambiguous.
    expect(CODE).not.toMatch(/component="main"/u);
    expect(CODE).not.toMatch(/maxWidth: \d|34rem/u);
  });

  it('writes no raw pixel, colour or radius of its own', () => {
    expect(CODE).toContain('comfortableDensity.tapTarget');
    expect(CODE).toContain('rounded.paper');
    expect(CODE).not.toMatch(/#[0-9a-f]{3,6}\b/iu);
    expect(CODE).not.toMatch(/minHeight: \d/u);
  });
});

describe('Take Test’s copy', () => {
  it('counts the child’s place from figures it was handed', () => {
    expect(studentCopy.takeTest.counter(1, 1)).toBe('Question 1 of 1');
    expect(studentCopy.takeTest.counter(3, 8)).toBe('Question 3 of 8');
  });

  it('names each Format plainly, in the second person surface’s own register', () => {
    for (const label of Object.values(studentCopy.takeTest.format)) {
      expect(label).not.toContain('!');
      expect(label).not.toMatch(/\d/u);
    }
    expect(studentCopy.takeTest.format.MultipleChoice).toBe('Multiple choice');
    expect(studentCopy.takeTest.format.FillInTheBlank).toBe('Fill in the blank');
    expect(studentCopy.takeTest.format.ShortAnswer).toBe('Short answer');
  });

  it('uses exactly two progress words, and never `Unanswered`', () => {
    expect(studentCopy.takeTest.legendAnswered).toBe('Answered');
    expect(studentCopy.takeTest.legendNotAnswered).toBe('Not answered');
    const everySentence = [
      studentCopy.takeTest.legendAnswered,
      studentCopy.takeTest.legendNotAnswered,
      studentCopy.takeTest.mapSummary(2, 3),
      studentCopy.takeTest.cellState(1, true, false),
      studentCopy.takeTest.cellState(2, false, false),
      studentCopy.takeTest.cellState(3, false, true),
    ].join(' ');
    // `Unanswered` reads as a grade state, and nothing before submission grades.
    expect(everySentence).not.toMatch(/unanswered/iu);
    expect(everySentence).not.toMatch(/correct|wrong|score|right|grade/iu);
  });

  it('says where the child is, in words as well as in an attribute', () => {
    expect(studentCopy.takeTest.cellState(7, false, true)).toBe(
      'Question 7, not answered, you are here',
    );
    expect(studentCopy.takeTest.cellState(3, true, false)).toBe('Question 3, answered');
    expect(studentCopy.takeTest.cellState(4, false, false)).toBe('Question 4, not answered');
  });

  it('summarises with two counts handed in, never a figure of its own', () => {
    expect(studentCopy.takeTest.mapSummary(2, 6)).toBe('2 answered · 6 not answered');
  });

  it('addresses the child, with no exclamation mark and no error code', () => {
    for (const line of [
      studentCopy.takeTest.answerLabel,
      studentCopy.takeTest.fractionHelp,
      studentCopy.takeTest.back,
      studentCopy.takeTest.next,
      studentCopy.takeTest.mapHeading,
      studentCopy.takeTest.openMap,
      studentCopy.takeTest.closeMap,
      studentCopy.takeTest.loading,
      studentCopy.takeTest.failed,
    ]) {
      expect(line).not.toContain('!');
      expect(line).not.toMatch(/\b(4\d\d|5\d\d)\b/u);
    }
    expect(studentCopy.takeTest.answerLabel).toMatch(/^Your\b/u);
    expect(studentCopy.takeTest.mapHeading).toMatch(/^Your\b/u);
  });

  it('explains the fraction field without promising anything about the answer', () => {
    expect(studentCopy.takeTest.fractionHelp).toMatch(/3\/4/u);
    expect(studentCopy.takeTest.fractionHelp).not.toMatch(/correct|right|must|only/iu);
  });
});

describe('the deadline is acted on once, and never before the store is read', () => {
  it('latches the deadline per Attempt so a failed auto-submit cannot re-dispatch', () => {
    // `submitState` is in the deadline effect's dependency list, so without this latch
    // a failed auto-submit setting it back to `'open'` re-satisfies the effect while
    // the clock still reads 0 and the browser is still online — an unbounded loop.
    expect(CODE).toContain('deadlineActedFor.current === attempt.id');
    expect(CODE.match(/deadlineActedFor\.current = attempt\.id/gu)?.length).toBe(2);
    // Set before the dispatch or the arm in each branch, so a dispatch that throws
    // still cannot come back round — but never on the offline branch until a
    // `profileId` is in hand, since a latch keyed to nothing could never be found
    // by the reconnect-take effect, and marking this Attempt acted-once regardless
    // would spend the one chance to arm it correctly once the profile settles.
    const effect = CODE.slice(CODE.indexOf('if (remaining !== 0'), CODE.indexOf('}, [remaining,'));
    const onlineBranch = effect.slice(0, effect.indexOf('if (profileId === null) return;'));
    expect(onlineBranch.indexOf('deadlineActedFor.current = attempt.id')).toBeLessThan(
      onlineBranch.indexOf('send(true)'),
    );
    const offlineBranch = effect.slice(effect.indexOf('if (profileId === null) return;'));
    // The null-check opens this slice, so finding the arm after it here already
    // proves the ordering; a separate index comparison would be redundant.
    expect(offlineBranch.indexOf('deadlineActedFor.current = attempt.id')).toBeLessThan(
      offlineBranch.indexOf('armPending('),
    );
    expect(offlineBranch.indexOf('deadlineActedFor.current = attempt.id')).toBeGreaterThan(0);
    // And cleared when the screen moves to another test, or the next test's deadline
    // would already count as acted on.
    expect(CODE).toContain('deadlineActedFor.current = null');
  });

  it('waits for hydration before acting on a deadline, as the reconnect dispatch does', () => {
    // Both automatic dispatches carry the same guard. Without it here, resuming an
    // already-expired Attempt submits the *empty* answer set on the first render and
    // the success path then clears the record — the child's work destroyed by the
    // mechanism meant to hand it in.
    expect(CODE.match(/hydratedFor !== attempt\.id/gu)?.length).toBeGreaterThanOrEqual(3);
  });

  it('never spends the latch on a dispatch that will not happen', () => {
    // `send` early-returns while a request is out, so a take before that check would
    // empty the latch against nothing — and a manual submit that then failed would
    // leave the reconnect with no latch while the screen still said it was arranged.
    const reconnect = CODE.slice(CODE.indexOf('if (!online || attempt === null'));
    expect(reconnect.indexOf('inFlight.current')).toBeLessThan(reconnect.indexOf('takePending('));
  });
});

describe('what the screen does with a profile it never learned', () => {
  it('dispatches on the Attempt alone, and keys only the store by the profile', () => {
    // The server takes both ids off the binding cookie, so a hand-in needs nothing
    // this screen knows about a profile. Gating the dispatch on it made a failed
    // session read into an enabled control that did nothing and said nothing.
    expect(CODE).toContain('if (current === null) return;');
    expect(CODE).not.toMatch(/if \(current === null \|\| profile === null\) return;/u);
    // Every store write is guarded on the profile instead.
    for (const call of CODE.match(/clearAttemptState\(storage\.current, [^)]*\)/gu) ?? []) {
      expect(call).toContain('profile');
    }
    expect(CODE).toContain('if (profile !== null) clearAttemptState(');
  });

  it('clears the record when the server reports the Attempt already handed in', () => {
    // The other route to "handed in": resuming rather than submitting. Without this the
    // answers of work already in sit on the device until the 72-hour TTL.
    expect(CODE).toContain('setSubmittedAttemptToClear(value.id)');
    expect(CODE).toContain(
      'clearAttemptState(storage.current, profileId, submittedAttemptToClear)',
    );
  });
});
