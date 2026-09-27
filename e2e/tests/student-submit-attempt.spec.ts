import { expect, test, type Page } from '@playwright/test';
import {
  createGradeLevelFixture,
  createSubjectFixture,
  newestAttemptFixture,
  questionGradesFor,
  setNewestDraftTimerFixture,
  uniqueParentEmail,
} from '../fixtures';

/**
 * Handing an Attempt in, end to end.
 *
 * Two kinds of claim live here and can live nowhere else. **Pressing, dismissing,
 * jumping and counting dispatches** are device claims: `apps/web` runs its unit
 * tests with `environment: 'node'`, so the blank-count and first-blank rules are
 * pure functions with their own spec and the page spec asserts over its own source,
 * but nothing there can press a control or watch the wire. And **grade rows** are
 * facts no screen this story builds will ever show — the student surface states two
 * progress words and never a grade — so they are read straight from the table
 * through a fixture, exactly as `newestAttemptFixture` reads `expired`.
 *
 * The practice tests are generated and released through the real parent flow and
 * read back through the real binding. The Attempt's instants are the server's
 * throughout, and whether it expired is the server's own comparison.
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

/**
 * Signs a parent up, adds one child, uploads and reads two pages, generates
 * `count` practice tests and releases every one of them — then leaves the page on
 * Student Home, bound to that child.
 *
 * The whole parent flow, because a released practice test is the only thing a child
 * can open and there is no shortcut to one that does not also skip the release.
 * `timerMinutes` is written to the newest draft's stored column when it is given,
 * which is what an Attempt snapshots at start; the screen that configures a timer is
 * Story 4.6's and has its own end-to-end.
 */
async function releaseTests(
  page: Page,
  email: string,
  count: number,
  timerMinutes?: number,
): Promise<void> {
  const gradeLevel = await createGradeLevelFixture('Submit Grade');
  const subject = await createSubjectFixture('Submit Subject', gradeLevel.id);

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

  await page.getByRole('button', { name: 'Check pages' }).click();
  const commit = page.getByTestId('legibility-continue');
  await expect(commit).toBeVisible({ timeout: 20_000 });
  await commit.click();
  await expect(page.getByTestId('submitted-note')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue to practice test' })).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole('button', { name: 'Continue to practice test' }).click();
  const warning = page.getByRole('dialog');
  await expect(warning).toBeVisible();
  await warning.getByRole('button', { name: 'Continue anyway' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page
    .locator(`[data-testid="generate-count-option"][data-count="${count}"]`)
    .getByRole('radio')
    .check();
  await page.getByTestId('generate-start').click();
  await page.getByTestId('generate-confirm').click();
  await expect(page.getByTestId('generate-progress-line')).toHaveText(
    count === 1 ? '1 practice test is ready.' : `${count} practice tests are ready.`,
    { timeout: 90_000 },
  );

  if (timerMinutes !== undefined) await setNewestDraftTimerFixture(email, timerMinutes);

  await page.getByTestId('generate-to-drafts').click();
  // Released one at a time: the release control lives on the draft's own read
  // screen, and each release lands back on this list with one fewer draft on it.
  for (let released = 0; released < count; released += 1) {
    await page
      .locator('[data-testid="draft-row"]')
      .first()
      .getByRole('link', { name: 'Read it' })
      .click();
    await expect(page.getByRole('heading', { name: 'Read the practice test' })).toBeVisible();
    await page.getByTestId('draft-release-open').click();
    await page.getByTestId('draft-release-confirm').click();
    await expect(page.getByTestId('drafts-released')).toHaveText('The practice test was released.');
  }

  await page.getByRole('button', { name: 'Back to Student Mode' }).click();
  await expect(page.getByRole('heading', { name: 'Your practice', level: 1 })).toBeVisible();
}

/** Which practice test the Take Test screen is on, from the URL alone. */
function practiceTestIdOf(page: Page): string {
  return /\/student\/tests\/([^/?#]+)/u.exec(page.url())![1]!;
}

/** How many Questions this test holds, read off the counter the child is shown. */
async function totalOf(page: Page): Promise<number> {
  const counter = await page.getByTestId('take-test-counter').innerText();
  return Number(/of (\d+)/u.exec(counter)![1]);
}

test.describe('handing an Attempt in', () => {
  test('asks about the Questions that are not answered, then records one Unanswered for each', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const email = uniqueParentEmail('submit-attempt');
    // Two released tests: one to leave partly blank, and one to answer whole — so
    // "a confirmation appears" and "no confirmation appears" are both stated
    // against the same child, the same binding and the same control.
    await releaseTests(page, email, 2);

    // Every request the browser makes, counted at the network. "Nothing was
    // dispatched" and "exactly one submit went out" are claims about the wire, and
    // a screen assertion would be green with either one wrong.
    const requests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/')) requests.push(`${request.method()} ${request.url()}`);
    });
    const submits = () => requests.filter((line) => line.includes('/submit'));

    const rows = page.locator('[data-testid="student-practice-test"]');
    await expect(rows).toHaveCount(2);
    await rows.first().getByRole('link').click();

    await expect(page.getByTestId('take-test-counter')).toBeVisible();
    const partlyBlankId = practiceTestIdOf(page);
    const total = await totalOf(page);
    expect(total).toBeGreaterThan(1);

    // --- Some answered, and deliberately not all ---------------------------
    // The first Question only, so every other one is a blank the child chose to
    // leave while there was still time — which is exactly what `Unanswered` means.
    await page.getByTestId('take-test-question').getByRole('radio').first().check();
    const rail = page.getByTestId('take-test-map-rail');
    await expect(rail.getByTestId('question-map-summary')).toHaveText(
      `1 answered · ${total - 1} not answered`,
    );

    // --- The press is held, and the count is named -------------------------
    await page.getByTestId('take-test-hand-in').click();
    const confirmation = page.getByRole('dialog');
    await expect(confirmation).toBeVisible();
    await expect(confirmation.getByRole('heading', { name: 'Hand in now?' })).toBeVisible();
    await expect(page.getByTestId('take-test-confirm-note')).toContainText(
      total - 1 === 1
        ? '1 question that is not answered'
        : `${total - 1} questions that are not answered`,
    );
    // The progress vocabulary and nothing else: `Unanswered` is a grade state, and
    // nothing has graded anything at this point.
    await expect(page.locator('body')).not.toContainText(/unanswered|correct|wrong|score|%/iu);
    // Nothing left the browser. The Attempt is still open.
    expect(submits()).toHaveLength(0);
    expect((await newestAttemptFixture(email)).submittedAt).toBeNull();

    // --- Dismissing hands nothing in ---------------------------------------
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(submits()).toHaveLength(0);
    // Every answer intact, and the control still live.
    await expect(rail.getByTestId('question-map-summary')).toHaveText(
      `1 answered · ${total - 1} not answered`,
    );
    await expect(page.getByTestId('take-test-hand-in')).toBeEnabled();

    // --- The way back: the map, on the first Question that is not answered --
    await page.getByTestId('take-test-hand-in').click();
    await expect(page.getByTestId('take-test-confirm-note')).toBeVisible();
    await page.getByTestId('take-test-confirm-back').click();

    // **No modal is left over the questions.** At this width the map is the rail,
    // already permanently on screen, so the way back raises nothing the child would
    // have to dismiss before they could type — and it raises nothing below `md`
    // either, where the map's own control is one press away.
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(rail.getByTestId('question-map-cell')).toHaveCount(total);
    // The screen moved to Question 2, which is the first one not answered — and it is
    // the rail's current cell, so the dialog and the map agreed about which Question
    // that is.
    await expect(page.getByTestId('take-test-counter')).toHaveText(`Question 2 of ${total}`);
    await expect(rail.getByTestId('question-map-cell').nth(1)).toHaveAttribute(
      'aria-current',
      'true',
    );
    // And it says so in words, not only in an attribute.
    await expect(
      rail.getByRole('button', { name: 'Question 2, not answered, you are here' }),
    ).toBeVisible();
    // And still nothing was sent: the way back is navigation, not a hand-in.
    expect(submits()).toHaveLength(0);

    // --- Hand in anyway -----------------------------------------------------
    await page.getByTestId('take-test-hand-in').click();
    await expect(page.getByTestId('take-test-confirm-note')).toBeVisible();
    await page.getByTestId('take-test-confirm-hand-in').click();

    await expect(page.getByTestId('take-test-handed-in')).toBeVisible();
    await expect(page.getByTestId('take-test-handed-in-heading')).toBeFocused();
    // Exactly one submit for the whole sequence: three presses, two of them held.
    expect(submits()).toHaveLength(1);

    const attempt = await newestAttemptFixture(email);
    expect(attempt.submittedAt).not.toBeNull();
    // Untimed, so the server judged it unexpired however long the child took.
    expect(attempt.expired).toBe(false);
    expect(attempt.answerCount).toBe(1);
    const partlyBlankAttemptId = attempt.id;

    // --- One `Unanswered` per blank, and none for the answered Question -----
    // Read from the table, because no screen this story builds shows a grade row —
    // and read **for a named Attempt**, so "no rows" can never stand in for "rows,
    // but on a different Attempt than the one this case is about".
    const first = await questionGradesFor(email, partlyBlankAttemptId);
    expect(first.attemptId).toBe(partlyBlankAttemptId);
    expect(first.grades).toHaveLength(total - 1);
    expect(first.grades.map((grade) => grade.state)).toEqual(
      Array.from({ length: total - 1 }, () => 'Unanswered'),
    );
    // Not one `Incorrect`, and not one row for the Question that was answered:
    // there are exactly as many rows as there were blanks.
    expect(new Set(first.grades.map((grade) => grade.questionId)).size).toBe(total - 1);

    // --- Student Home reads Completed --------------------------------------
    await page.goto('/student');
    await expect(page.getByRole('heading', { name: 'Your practice', level: 1 })).toBeVisible();
    const handedIn = page
      .locator('[data-testid="student-practice-test"]')
      .filter({ has: page.locator(`a[href="/student/tests/${partlyBlankId}"]`) });
    await expect(handedIn.getByTestId('student-practice-test-state')).toHaveText('Completed');
    // Derived from the Attempt, with no status column written and nothing on this
    // row about a grade or a score.
    await expect(page.locator('body')).not.toContainText(/unanswered|correct|wrong|score|%/iu);

    // --- The second test, answered whole: no confirmation at all -----------
    const untouched = page
      .locator('[data-testid="student-practice-test"]')
      .filter({ hasNot: page.locator(`a[href="/student/tests/${partlyBlankId}"]`) });
    await expect(untouched.getByTestId('student-practice-test-state')).toHaveText('Not started');
    await untouched.getByRole('link').click();

    await expect(page.getByTestId('take-test-counter')).toBeVisible();
    const secondTotal = await totalOf(page);
    for (let at = 0; at < secondTotal; at += 1) {
      await page.getByTestId('take-test-question').getByRole('radio').first().check();
      if (at < secondTotal - 1) await page.getByTestId('take-test-next').click();
    }
    await expect(rail.getByTestId('question-map-summary')).toHaveText(
      `${secondTotal} answered · 0 not answered`,
    );

    await page.getByTestId('take-test-hand-in').click();
    // Straight through: there is no blank to ask about, so a finished paper still
    // goes up on one press.
    await expect(page.getByTestId('take-test-handed-in')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(submits()).toHaveLength(2);
    // Nothing blank, so nothing to record: no grade row at all on **this** Attempt,
    // which is a second Attempt and not the one above.
    const second = await questionGradesFor(email);
    expect(second.attemptId).not.toBe(partlyBlankAttemptId);
    expect(second.grades).toEqual([]);
    // And the first Attempt's rows are exactly where they were: nothing this
    // hand-in wrote landed on somebody else's Attempt.
    expect((await questionGradesFor(email, partlyBlankAttemptId)).grades).toHaveLength(total - 1);
  });

  test('auto-submits on the deadline with no confirmation, and records no grade row', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const email = uniqueParentEmail('submit-expiry');
    // One minute, the shortest a parent may configure, so a browser test can sit
    // through it.
    await releaseTests(page, email, 1, 1);

    const requests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/')) requests.push(`${request.method()} ${request.url()}`);
    });
    const submits = () => requests.filter((line) => line.includes('/submit'));

    await page.locator('[data-testid="student-practice-test"]').first().getByRole('link').click();
    await expect(page.getByTestId('attempt-timer')).toBeVisible();
    const total = await totalOf(page);

    // One answered and the rest left blank, so this Attempt has blanks to record —
    // and records none, because the deadline decided first.
    await page.getByTestId('take-test-question').getByRole('radio').first().check();

    // The deadline passes with a connection, so the work goes up on its own. **No
    // confirmation anywhere on that path**: there is nobody there to answer one, and
    // a dialog here would hold a child's work back past a deadline the server has
    // already judged.
    const announcement = page.getByTestId('take-test-auto-submit');
    await expect(announcement).toBeVisible({ timeout: 120_000 });
    await expect(announcement).toHaveAttribute('role', 'alert');
    await expect(page.getByTestId('take-test-handed-in')).toBeVisible({ timeout: 30_000 });
    // Never a dialog, and never a second press: exactly the dispatch count this
    // path had before Story 5.4.
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(submits()).toHaveLength(1);

    const attempt = await newestAttemptFixture(email);
    expect(attempt.expired).toBe(true);
    expect(attempt.answerCount).toBe(1);
    expect(total).toBeGreaterThan(1);

    // **No grade row of any kind.** FR-37 grades the blanks of an Attempt whose time
    // ran out `Incorrect`, and that verdict is Story 5.5's to make — so this story
    // writes nothing here rather than something a later one would have to correct.
    // Named against the Attempt that just expired, so an empty answer is an answer
    // about that Attempt and not about whichever one happens to be newest.
    const grades = await questionGradesFor(email, attempt.id);
    expect(grades.attemptId).toBe(attempt.id);
    expect(grades.grades).toEqual([]);

    // A settle, then a final count: nothing loops and nothing sends a second time.
    await page.waitForTimeout(3_000);
    expect(submits()).toHaveLength(1);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
