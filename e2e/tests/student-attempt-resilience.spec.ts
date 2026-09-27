import { expect, test, type Page } from '@playwright/test';
import {
  countAttemptsFor,
  createGradeLevelFixture,
  createSubjectFixture,
  newestAttemptFixture,
  setNewestDraftTimerFixture,
  uniqueParentEmail,
} from '../fixtures';

/**
 * An Attempt that survives an interruption, end to end.
 *
 * Every claim this story makes that needs a *device* lives here and nowhere else.
 * `apps/web` runs its unit tests with `environment: 'node'`: the storage rule, the
 * clock rule and the latch are pure functions with their own specs, and the timer's
 * markup has a static render — but reloading a page, going offline, watching a
 * countdown fall across a gap and counting how many requests actually left the
 * browser are none of those. A claim in the wrong layer is a claim that never runs.
 *
 * The practice test is generated and released through the real parent flow and read
 * back through the real binding. The Attempt's instants are the server's throughout;
 * nothing about the student path is stubbed.
 */

const PASSWORD = 'correct-horse-battery-staple';
const PIN = '4821';

const PAGE_A =
  '/9j/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAgABgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAUG/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AhAJzYgAAAAAP/9k=';
const PAGE_B =
  '/9j/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAgABgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAUG/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AggNOlgAAAAAP/9k=';

function jpeg(name: string, base64: string) {
  return { name, mimeType: 'image/jpeg', buffer: Buffer.from(base64, 'base64') };
}

/** `m:ss` back to seconds, so "the countdown fell" is a comparison of numbers. */
function secondsOf(display: string): number {
  const [minutes, seconds] = display.split(':');
  return Number(minutes) * 60 + Number(seconds);
}

/**
 * Generates and releases one practice test with the given countdown, and leaves the
 * page on Take Test with the Attempt open.
 *
 * The whole parent flow, because a released practice test is the only thing a child
 * can open and there is no shortcut to one that does not also skip the release.
 */
async function openTimedTest(page: Page, email: string, timerMinutes: number): Promise<number> {
  const gradeLevel = await createGradeLevelFixture('Resilience Grade');
  const subject = await createSubjectFixture('Resilience Subject', gradeLevel.id);

  await page.goto('/auth/sign-up');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByLabel('I accept the terms of use.').check();
  await page.getByLabel('I accept the notice on children’s data.').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Signed in' })).toBeVisible();

  await page.getByRole('link', { name: 'Enter Parent View' }).click();
  await page.locator('#parent-pin').fill(PIN);
  await page.getByRole('button', { name: 'Save the PIN' }).click();
  await expect(
    page.getByRole('heading', { name: 'Parent View', level: 1, exact: true }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Student Profiles' }).click();
  await page.locator('#student-name').fill('Noah');
  await page.locator('[role="combobox"]#student-grade-level').click();
  await page.getByRole('option', { name: gradeLevel.name }).click();
  await expect(page.getByRole('listbox')).toBeHidden();
  await page.getByRole('button', { name: 'Add the profile' }).click();
  await expect(page.locator('[data-testid="student-row"][data-name="Noah"]')).toBeVisible();

  await page.getByRole('link', { name: 'Back to Parent View' }).click();
  await page.getByRole('link', { name: 'Upload a test' }).click();
  await expect(page.getByRole('heading', { name: 'Pages', level: 1 })).toBeVisible();

  await page.locator('[role="combobox"]#capture-subject').click();
  await page.getByRole('option', { name: subject.name }).click();
  await expect(page.getByRole('listbox')).toBeHidden();

  for (const file of [jpeg('page-a.jpg', PAGE_A), jpeg('page-b.jpg', PAGE_B)]) {
    const before = await page.locator('[data-testid="page-row"]').count();
    await expect(page.locator('#capture-add-page')).toBeEnabled();
    await page.locator('#capture-add-page').setInputFiles(file);
    await expect(page.locator('[data-testid="page-row"]')).toHaveCount(before + 1, {
      timeout: 20_000,
    });
  }

  // Two controls, not one: the batch legibility check charges nothing, and the
  // commit it gates spends an Upload Allowance. A fixture that wants a submitted
  // upload passes through both, exactly as `student-take-test` does.
  await page.getByRole('button', { name: 'Check pages' }).click();
  const commit = page.getByTestId('legibility-continue');
  await expect(commit).toBeVisible({ timeout: 20_000 });
  await commit.click();
  await expect(page.getByTestId('submitted-note')).toBeVisible();
  // The Extraction job outlives the request that enqueued it, so this waits on
  // the worker rather than on the response.
  await expect(page.getByRole('button', { name: 'Continue to practice test' })).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole('button', { name: 'Continue to practice test' }).click();
  const warning = page.getByRole('dialog');
  await expect(warning).toBeVisible();
  await warning.getByRole('button', { name: 'Continue anyway' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page
    .locator('[data-testid="generate-count-option"][data-count="1"]')
    .getByRole('radio')
    .check();
  await page.getByTestId('generate-start').click();
  await page.getByTestId('generate-confirm').click();
  await expect(page.getByTestId('generate-progress-line')).toHaveText('1 practice test is ready.', {
    timeout: 60_000,
  });

  // The duration the Attempt will snapshot at start. Written to the stored column,
  // which is what an Attempt reads — the screen that configures it is Story 4.6's.
  await setNewestDraftTimerFixture(email, timerMinutes);

  await page.getByTestId('generate-to-drafts').click();
  await page
    .locator('[data-testid="draft-row"]')
    .first()
    .getByRole('link', { name: 'Read it' })
    .click();
  await expect(page.getByRole('heading', { name: 'Read the practice test' })).toBeVisible();
  await page.getByTestId('draft-release-open').click();
  await page.getByTestId('draft-release-confirm').click();
  await expect(page.getByTestId('drafts-released')).toHaveText('The practice test was released.');

  // --- Over to the child -------------------------------------------------
  await page.getByRole('button', { name: 'Back to Student Mode' }).click();
  await expect(page.getByRole('heading', { name: 'Your practice', level: 1 })).toBeVisible();
  const link = page.getByRole('link', { name: /A practice test with \d+ questions?/u });
  const questionCount = Number(/(\d+)/u.exec((await link.innerText()) ?? '')![1]);
  await link.click();

  await expect(page.getByTestId('take-test-counter')).toBeVisible();
  // The Attempt opened, which is what the countdown is rendered from.
  await expect(page.getByTestId('attempt-timer')).toBeVisible();
  return questionCount;
}

test.describe('an Attempt that survives an interruption', () => {
  test('keeps the answers across a reload, works offline, and hands in exactly once', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const email = uniqueParentEmail('attempt-resilience');
    const questionCount = await openTimedTest(page, email, 20);

    // Every request the browser makes, counted at the network. "No request is
    // issued" and "exactly one submit went out" are claims about the wire, and a
    // screen assertion would be green with either one wrong.
    const requests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/')) requests.push(`${request.method()} ${request.url()}`);
    });
    const submits = () => requests.filter((line) => line.includes('/submit'));
    const apiCalls = () => requests.length;

    // --- Two answers, then a reload ---------------------------------------
    const options = page.getByTestId('take-test-question').getByRole('radio');
    await options.first().check();
    await page.getByTestId('take-test-next').click();
    await expect(page.getByTestId('take-test-counter')).toHaveText(
      `Question 2 of ${questionCount}`,
    );
    await page.getByTestId('take-test-question').getByRole('radio').nth(1).check();

    const rail = page.getByTestId('take-test-map-rail');
    await expect(rail.getByTestId('question-map-summary')).toHaveText(
      `2 answered · ${questionCount - 2} not answered`,
    );
    const before = secondsOf(await page.getByTestId('attempt-timer-value').innerText());

    // Long enough that the countdown must have moved, and a genuine reload rather
    // than a client-side navigation.
    await page.waitForTimeout(3_000);
    await page.reload();

    await expect(page.getByTestId('attempt-timer')).toBeVisible();
    // Both answers back, and the place in the test with them.
    await expect(page.getByTestId('take-test-counter')).toHaveText(
      `Question 2 of ${questionCount}`,
    );
    await expect(page.getByTestId('take-test-question').getByRole('radio').nth(1)).toBeChecked();
    await expect(rail.getByTestId('question-map-summary')).toHaveText(
      `2 answered · ${questionCount - 2} not answered`,
    );
    // The countdown read the elapsed wall clock rather than the value it held: it
    // fell, and it did not reset to the full duration.
    const after = secondsOf(await page.getByTestId('attempt-timer-value').innerText());
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThan(0);
    // And one Attempt exists, not two: the reload resumed rather than started.
    expect(await countAttemptsFor(email)).toBe(1);

    // --- Offline: everything but handing in --------------------------------
    await page.context().setOffline(true);
    const quietFrom = apiCalls();

    await page.getByTestId('take-test-back').click();
    await expect(page.getByTestId('take-test-counter')).toHaveText(
      `Question 1 of ${questionCount}`,
    );
    await page.getByTestId('take-test-question').getByRole('radio').nth(1).check();
    await page.getByTestId('take-test-next').click();
    await page.setViewportSize({ width: 600, height: 900 });
    await page.getByTestId('take-test-map-open').click();
    const overlay = page.getByRole('dialog');
    await expect(overlay).toBeVisible();
    await overlay.getByRole('button', { name: 'Question 1, answered' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('take-test-counter')).toHaveText(
      `Question 1 of ${questionCount}`,
    );
    await page.setViewportSize({ width: 1280, height: 900 });
    // Not one request left the browser: after the initial read nothing on this
    // screen needs the network until the child hands in.
    expect(apiCalls()).toBe(quietFrom);

    // --- Handing in while offline -----------------------------------------
    await page.getByTestId('take-test-hand-in').click();
    await expect(page.getByTestId('take-test-submit-note')).toContainText('needs a connection');
    // The Attempt is still open, every answer is still there, and the control is
    // still live for the child to press again.
    await expect(page.getByTestId('take-test-hand-in')).toBeEnabled();
    await expect(rail.getByTestId('question-map-summary')).toHaveText(
      `2 answered · ${questionCount - 2} not answered`,
    );
    expect((await newestAttemptFixture(email)).submittedAt).toBeNull();

    // --- Back online, and nothing re-sent on its own ----------------------
    await page.context().setOffline(false);
    await page.waitForTimeout(3_000);
    // No latch was armed — the deadline had not passed — so the reconnect takes
    // nothing and dispatches nothing. Never silently retried.
    expect(submits()).toHaveLength(0);
    expect((await newestAttemptFixture(email)).submittedAt).toBeNull();

    // --- The child presses again -------------------------------------------
    await page.getByTestId('take-test-hand-in').click();
    await expect(page.getByTestId('take-test-handed-in')).toBeVisible();
    // Focus landed on the heading of the state the screen moved to.
    await expect(page.getByTestId('take-test-handed-in-heading')).toBeFocused();
    // Exactly one submit on the wire.
    expect(submits()).toHaveLength(1);

    const attempt = await newestAttemptFixture(email);
    expect(attempt.submittedAt).not.toBeNull();
    // Not expired: twenty minutes were not spent.
    expect(attempt.expired).toBe(false);
    expect(attempt.answerCount).toBe(2);

    // The record is gone: work that has been handed in is not work the device has
    // any reason to keep.
    const residue = await page.evaluate(() =>
      Object.keys({ ...window.localStorage }).filter((key) => key.startsWith('ntr.attempt.')),
    );
    expect(residue).toEqual([]);

    // And nothing anywhere on the screen claims a verdict.
    await expect(page.locator('body')).not.toContainText(/correct|wrong|score|grade|%/iu);

    // --- A second press sends nothing -------------------------------------
    await page.reload();
    await expect(page.getByTestId('take-test-handed-in')).toBeVisible();
    // The start route resumed a submitted Attempt, the screen states it is in, and
    // there is no control to press: one submit for the whole run.
    expect(submits()).toHaveLength(1);
    expect(await countAttemptsFor(email)).toBe(1);
  });

  test('dispatches exactly one submit on reconnect when the deadline passed offline', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const email = uniqueParentEmail('attempt-expiry');
    // One minute, which is the shortest duration a parent may configure — short
    // enough that a browser test can sit through it offline.
    await openTimedTest(page, email, 1);

    const requests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/')) requests.push(`${request.method()} ${request.url()}`);
    });
    const submits = () => requests.filter((line) => line.includes('/submit'));

    await page.getByTestId('take-test-question').getByRole('radio').first().check();

    // --- The warning, on a real device -------------------------------------
    // A one-minute Attempt crosses the 20-second threshold on the way down, so this is
    // the cheapest place the *page's* wiring of `warningFor` is actually executed:
    // `attempt-clock.spec.ts` proves the rule, and only a device proves the sentence
    // reaches the screen. Delete the `setWarning` call and this is what fails.
    const warningSentence = page.getByTestId('attempt-timer-warning');
    await expect(warningSentence).toBeVisible({ timeout: 50_000 });
    // A visible sentence, not colour or motion alone, and it carries the figure in
    // words rather than as a bare number.
    await expect(warningSentence).toContainText(/left/u);
    // The live region is raised only while a warning is showing.
    await expect(warningSentence).toHaveAttribute('aria-live', 'polite');

    // Offline straight away, while there is still time on the clock: waiting for the
    // warning to clear first would spend the margin before the deadline, and the
    // clock keeps falling offline anyway.
    await page.context().setOffline(true);

    // The warning is an **event**, not a state: it takes itself back down, so the live
    // region is quiet between thresholds and the time-up sentence never shares the
    // screen with a stale "20 seconds left".
    await expect(warningSentence).toBeHidden({ timeout: 30_000 });

    // The deadline passes with no connection. The screen states that the time is up
    // and that the handing in is already arranged — and dispatches nothing.
    await expect(page.getByTestId('take-test-offline-expired')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId('take-test-offline-expired')).toContainText(
      'as soon as you are back online',
    );
    expect(submits()).toHaveLength(0);
    expect((await newestAttemptFixture(email)).submittedAt).toBeNull();

    // --- The connection returns -------------------------------------------
    await page.context().setOffline(false);
    await expect(page.getByTestId('take-test-handed-in')).toBeVisible({ timeout: 30_000 });
    // Exactly one, and it was the latch's single take that sent it: a duplicate
    // `online` event, a re-render or a reload that raced it would all take nothing.
    expect(submits()).toHaveLength(1);

    const attempt = await newestAttemptFixture(email);
    expect(attempt.submittedAt).not.toBeNull();
    // Judged at the deadline the server stored, not at the instant the submission
    // arrived — the comparison is the server's, on its own clock and its own column.
    expect(attempt.expired).toBe(true);
    expect(attempt.submittedAt!.getTime()).toBeGreaterThan(attempt.expiresAt!.getTime());
    // And the answer entered before the outage is in the persisted set.
    expect(attempt.answerCount).toBe(1);

    // Nothing was left on the device, and nothing on screen says anything about
    // being right.
    const residue = await page.evaluate(() =>
      Object.keys({ ...window.localStorage }).filter((key) => key.startsWith('ntr.attempt.')),
    );
    expect(residue).toEqual([]);
    await expect(page.locator('body')).not.toContainText(/correct|wrong|score|grade|%/iu);

    // A settle, then a final count: nothing loops, and nothing sends a second time.
    await page.waitForTimeout(3_000);
    expect(submits()).toHaveLength(1);
  });

  test('hands in on its own, once, when the deadline passes with a connection', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const email = uniqueParentEmail('attempt-online-expiry');
    await openTimedTest(page, email, 1);

    const requests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/')) requests.push(`${request.method()} ${request.url()}`);
    });
    const submits = () => requests.filter((line) => line.includes('/submit'));

    await page.getByTestId('take-test-question').getByRole('radio').first().check();

    // The branch the offline case never reaches, because it goes offline before the
    // deadline: the clock runs out **with** a connection, so the work goes up on its
    // own. Nothing in the suite executed this path before.
    //
    // Announced before the screen changes, with `role="alert"`, so a move the child did
    // not ask for is never silent.
    const announcement = page.getByTestId('take-test-auto-submit');
    await expect(announcement).toBeVisible({ timeout: 120_000 });
    await expect(announcement).toHaveAttribute('role', 'alert');

    await expect(page.getByTestId('take-test-handed-in')).toBeVisible({ timeout: 30_000 });
    // Focus landed on the heading of the state the screen moved to.
    await expect(page.getByTestId('take-test-handed-in-heading')).toBeFocused();

    const attempt = await newestAttemptFixture(email);
    expect(attempt.submittedAt).not.toBeNull();
    expect(attempt.expired).toBe(true);
    expect(attempt.answerCount).toBe(1);

    // **Exactly one**, and this is the case that would catch a retry loop: a failed
    // auto-submit used to set the state back to `open`, which re-satisfied the deadline
    // effect and dispatched again without end. A settle long enough for several ticks,
    // then a count.
    await page.waitForTimeout(5_000);
    expect(submits()).toHaveLength(1);

    const residue = await page.evaluate(() =>
      Object.keys({ ...window.localStorage }).filter((key) => key.startsWith('ntr.attempt.')),
    );
    expect(residue).toEqual([]);
    await expect(page.locator('body')).not.toContainText(/correct|wrong|score|grade|%/iu);
  });

  test('states a hand-in the server already has, and keeps nothing on the device', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const email = uniqueParentEmail('attempt-conflict');
    await openTimedTest(page, email, 20);
    const url = page.url();

    await page.getByTestId('take-test-question').getByRole('radio').first().check();

    // A second tab on the same Attempt, sharing the binding cookie through the context.
    // This is the only way a browser genuinely reaches the 409: one tab hands in, and
    // the other still believes the Attempt is open.
    const second = await page.context().newPage();
    const submits: string[] = [];
    second.on('request', (request) => {
      if (request.url().includes('/submit')) submits.push(request.url());
    });
    await second.goto(url);
    await expect(second.getByTestId('attempt-timer')).toBeVisible();

    // The first tab hands in.
    await page.getByTestId('take-test-hand-in').click();
    await expect(page.getByTestId('take-test-handed-in')).toBeVisible();

    // The second tab tries, and the server answers 409.
    await second.getByTestId('take-test-hand-in').click();

    // It lands on the handed-in state rather than on the generic failure: a 404 or a
    // generic message would make work that is safely in look lost, and would invite
    // the child to keep pressing.
    await expect(second.getByTestId('take-test-handed-in')).toBeVisible();
    await expect(second.getByTestId('take-test-handed-in')).toContainText('already handed in');
    await expect(second.getByTestId('take-test-handed-in-heading')).toBeFocused();
    // One try, and no re-send after the refusal.
    await second.waitForTimeout(2_000);
    expect(submits).toHaveLength(1);

    // And the record is gone, on the 409 path as much as on the success one.
    const residue = await second.evaluate(() =>
      Object.keys({ ...window.localStorage }).filter((key) => key.startsWith('ntr.attempt.')),
    );
    expect(residue).toEqual([]);
    await expect(second.locator('body')).not.toContainText(/correct|wrong|score|grade|%/iu);
    await second.close();
  });
});
