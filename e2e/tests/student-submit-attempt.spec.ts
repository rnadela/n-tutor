import { expect, test, type Page } from '@playwright/test';
import {
  countAttemptsFor,
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

/** The four literal grade labels, exactly as `commonCopy.gradeState` fixes them. */
const GRADE_LABELS = ['Correct', 'Not correct', 'Unanswered', 'Not graded yet'];

/**
 * The answer key as it reaches a child, whole.
 *
 * Asserted here rather than inline because the same claims have to hold on two
 * arrivals at the same surface — the hand-in itself, and the completed row opened
 * from Student Home — and a second copy of them would be a second standard.
 */
async function assertAnswerKey(page: Page, total: number, correct: number): Promise<void> {
  const results = page.getByTestId('attempt-results');
  await expect(results).toBeVisible();
  await expect(results.getByRole('heading', { name: 'Your results', level: 2 })).toBeVisible();
  // The server's one figure, stated as a fraction and never as a percentage.
  await expect(page.getByTestId('attempt-results-score')).toHaveText(
    `You got ${correct} out of ${total} right.`,
  );
  // Nothing excluded, so no gap sentence at all.
  await expect(page.getByTestId('attempt-results-gap')).toHaveCount(0);

  // One row per presented Question, in the order the child was shown them.
  const rows = page.locator('[data-testid="answer-key-row"]');
  await expect(rows).toHaveCount(total);
  expect(
    await rows.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-ordinal'))),
  ).toEqual(Array.from({ length: total }, (_unused, at) => String(at + 1)));

  // Every row carries its state as a literal label, in real text — never colour
  // alone, and never a glyph on its own.
  const labels = await results
    .locator('[data-testid="grade-state-label"]')
    .evaluateAll((nodes) => nodes.map((node) => node.textContent));
  expect(labels).toHaveLength(total);
  for (const label of labels) expect(GRADE_LABELS).toContain(label);

  // Both answers are labelled, so the child's and the right one are never confused.
  await expect(results.getByTestId('answer-key-your-label').first()).toHaveText('You answered');
  await expect(results.getByTestId('answer-key-correct-label').first()).toHaveText(
    'Correct answer',
  );

  // **Nothing parent-scoped, and nothing from a later story.** No grading rationale
  // and no Topic label: the response has no field for either. Since Story 6.1 each
  // row does carry an explain control, but it is a closed disclosure that says
  // nothing about explanations until a child presses it — which is why neither word
  // appears here, and which is asserted properly in `student-explanations.spec.ts`.
  await expect(results.locator('[data-testid*="rationale"]')).toHaveCount(0);
  await expect(results.locator('[data-testid*="topic"]')).toHaveCount(0);
  await expect(results).not.toContainText(/explain|retake/iu);
  await expect(results).not.toContainText(/allowance|unlimited|gpt-|claude/iu);
}

test.describe('handing an Attempt in', () => {
  test('asks about the Questions that are not answered, then grades every Question of the paper', async ({
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

    // --- Every presented Question graded: one verdict, the rest `Unanswered` -----
    // Read from the table, because no screen this story builds shows a grade row —
    // and read **for a named Attempt**, so "no rows" can never stand in for "rows,
    // but on a different Attempt than the one this case is about".
    const first = await questionGradesFor(email, partlyBlankAttemptId);
    expect(first.attemptId).toBe(partlyBlankAttemptId);
    // Exactly one row per Question the paper presented, and no Question with two.
    expect(first.grades).toHaveLength(total);
    expect(new Set(first.grades.map((grade) => grade.questionId)).size).toBe(total);
    // The generated questions are Multiple Choice and the first option is the right
    // one, so checking the first radio is a right answer — judged in code, with no
    // provider asked and therefore no reason to record.
    expect(first.grades.filter((grade) => grade.state === 'Correct')).toHaveLength(1);
    expect(first.grades.filter((grade) => grade.state === 'Unanswered')).toHaveLength(total - 1);
    // Nothing `Ungraded`: an `Ungraded` row is a grading failure, and nothing here
    // needed a provider at all.
    expect(first.grades.filter((grade) => grade.state === 'Ungraded')).toEqual([]);
    // Not one rationale anywhere on this paper: every verdict on it was a
    // comparison, and a rationale is what a provider explained.
    expect(first.grades.map((grade) => grade.rationale)).toEqual(
      Array.from({ length: total }, () => null),
    );

    // --- The answer key, on screen the instant the work is in --------------
    // No further press and no navigation: the results render beneath the handed-in
    // panel, which is untouched above.
    await assertAnswerKey(page, total, 1);
    // Every row's state agrees with the table the grades were read from: one
    // `Correct` and the rest `Unanswered`, in the order the child met them.
    const statesFromTable = first.grades.map((grade) => grade.state);
    const statesOnScreen = await page
      .locator('[data-testid="answer-key-row"]')
      .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-state')));
    expect(statesOnScreen).toEqual(statesFromTable);
    // The blank rows say so on their own row, and the answered one carries its
    // verdict — each as the literal label, as real text.
    const firstRow = page.locator('[data-testid="answer-key-row"]').first();
    await expect(firstRow.getByTestId('grade-state-label')).toHaveText('Correct');
    await expect(
      page.locator('[data-testid="answer-key-row"]').nth(1).getByTestId('grade-state-label'),
    ).toHaveText('Unanswered');

    // --- Student Home reads Completed --------------------------------------
    await page.goto('/student');
    await expect(page.getByRole('heading', { name: 'Your practice', level: 1 })).toBeVisible();
    const handedIn = page
      .locator('[data-testid="student-practice-test"]')
      .filter({ has: page.locator(`a[href="/student/tests/${partlyBlankId}"]`) });
    await expect(handedIn.getByTestId('student-practice-test-state')).toHaveText('Completed');
    // Derived from the Attempt, with no status column written and nothing on this
    // row about a grade or a score. **Student Home only**: the answer key lives on
    // the test's own route, and the row that leads to it says nothing about verdicts.
    await expect(page.locator('body')).not.toContainText(/unanswered|correct|wrong|score|%/iu);

    // --- And the same answer key again, opened from history ----------------
    // The completed row leads back to the same route, the start route answers with a
    // `submittedAt`, and the screen reaches the same handed-in state — so "reachable
    // thereafter" is the same surface rather than a second one. No new Attempt is
    // started: the count is asserted below, after the second test.
    await handedIn.getByRole('link').click();
    await expect(page.getByTestId('take-test-handed-in')).toBeVisible();
    await assertAnswerKey(page, total, 1);
    expect(submits()).toHaveLength(1);

    await page.goto('/student');
    await expect(page.getByRole('heading', { name: 'Your practice', level: 1 })).toBeVisible();

    // --- The second test, answered whole: no confirmation at all -----------
    const untouched = page
      .locator('[data-testid="student-practice-test"]')
      .filter({ hasNot: page.locator(`a[href="/student/tests/${partlyBlankId}"]`) });
    await expect(untouched.getByTestId('student-practice-test-state')).toHaveText('Not started');
    await untouched.getByRole('link').click();

    await expect(page.getByTestId('take-test-counter')).toBeVisible();
    const secondId = practiceTestIdOf(page);
    const secondTotal = await totalOf(page);
    // The first Question rightly and every other one wrongly: the first option is
    // the right one, so the second option is a wrong answer the child actually gave
    // — which is what makes "a wrong answer is `Incorrect`, not `Unanswered`" a
    // claim this run can make.
    for (let at = 0; at < secondTotal; at += 1) {
      const radios = page.getByTestId('take-test-question').getByRole('radio');
      await (at === 0 ? radios.first() : radios.nth(1)).check();
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
    // Nothing blank, so nothing is `Unanswered` — every Question carries the verdict
    // its answer earned, on **this** Attempt, which is a second Attempt and not the
    // one above.
    const second = await questionGradesFor(email);
    expect(second.attemptId).not.toBe(partlyBlankAttemptId);
    expect(second.grades).toHaveLength(secondTotal);
    expect(second.grades.filter((grade) => grade.state === 'Correct')).toHaveLength(1);
    expect(second.grades.filter((grade) => grade.state === 'Incorrect')).toHaveLength(
      secondTotal - 1,
    );
    expect(second.grades.filter((grade) => grade.state === 'Unanswered')).toEqual([]);
    // The same answer graded the same way on both papers: the first option was
    // checked on Question 1 of each, and each came back `Correct`. Deterministic,
    // because no provider was involved in either.
    expect(second.grades[0]!.state).toBe('Correct');
    expect(first.grades[0]!.state).toBe('Correct');
    // And the first Attempt's rows are exactly where they were: nothing this
    // hand-in wrote landed on somebody else's Attempt.
    expect((await questionGradesFor(email, partlyBlankAttemptId)).grades).toHaveLength(total);

    // --- Practising it again: a second run at the same test ----------------
    //
    // The one thing in the product that gives a child a second Attempt at one
    // Practice Test. Pressed from the results they are already standing on: no
    // navigation, no route of its own, and the earlier run's rows untouched.
    const firstRunOfSecondTest = second.attemptId;
    const attemptsBeforeRetake = await countAttemptsFor(email);
    expect(attemptsBeforeRetake).toBe(2);
    // The order the child met the Questions in, read off the answer key that is on
    // screen right now — so "the same Questions in the same order" is a comparison
    // against what the first run actually presented.
    const orderOfFirstRun = await page
      .locator('[data-testid="answer-key-row"]')
      .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-ordinal')));

    await page.getByTestId('take-test-retake').click();

    // Back on Question 1 of the same paper, with nothing pre-filled.
    await expect(page.getByTestId('take-test-counter')).toHaveText(`Question 1 of ${secondTotal}`);
    expect(practiceTestIdOf(page)).toBe(secondId);
    expect(await page.getByTestId('take-test-question').getByRole('radio').count()).toBeGreaterThan(
      0,
    );
    await expect(
      page.getByTestId('take-test-question').getByRole('radio', { checked: true }),
    ).toHaveCount(0);
    await expect(rail.getByTestId('question-map-summary')).toHaveText(
      `0 answered · ${secondTotal} not answered`,
    );
    // Exactly one row more, and the earlier run still where it was.
    expect(await countAttemptsFor(email)).toBe(attemptsBeforeRetake + 1);
    expect((await questionGradesFor(email, firstRunOfSecondTest)).grades).toHaveLength(secondTotal);

    // Answered differently this time: the second option everywhere, which is wrong
    // everywhere — so the two runs of one test cannot be told apart by luck.
    for (let at = 0; at < secondTotal; at += 1) {
      await page.getByTestId('take-test-question').getByRole('radio').nth(1).check();
      if (at < secondTotal - 1) await page.getByTestId('take-test-next').click();
    }
    await page.getByTestId('take-test-hand-in').click();
    await expect(page.getByTestId('take-test-handed-in')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(submits()).toHaveLength(3);

    // The retake's **own** answer key: the same Questions, the same order, its own
    // verdicts.
    await assertAnswerKey(page, secondTotal, 0);
    expect(
      await page
        .locator('[data-testid="answer-key-row"]')
        .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-ordinal'))),
    ).toEqual(orderOfFirstRun);
    const retakeRun = await questionGradesFor(email);
    expect(retakeRun.attemptId).not.toBe(firstRunOfSecondTest);
    expect(retakeRun.grades.filter((grade) => grade.state === 'Correct')).toEqual([]);
    expect(retakeRun.grades.filter((grade) => grade.state === 'Incorrect')).toHaveLength(
      secondTotal,
    );
    // And the first run of this test, still exactly as it was graded.
    const firstRunAfter = await questionGradesFor(email, firstRunOfSecondTest);
    expect(firstRunAfter.grades.filter((grade) => grade.state === 'Correct')).toHaveLength(1);
    expect(firstRunAfter.grades.filter((grade) => grade.state === 'Incorrect')).toHaveLength(
      secondTotal - 1,
    );

    // --- The row on Student Home, with both figures and the run count ------
    await page.goto('/student');
    await expect(page.getByRole('heading', { name: 'Your practice', level: 1 })).toBeVisible();
    const retaken = page
      .locator('[data-testid="student-practice-test"]')
      .filter({ has: page.locator(`a[href="/student/tests/${secondId}"]`) });
    // Cross-checked against the grade table for **both** runs, so the figures on the
    // card are the figures the rows actually hold.
    const firstCorrect = firstRunAfter.grades.filter((grade) => grade.state === 'Correct').length;
    const latestCorrect = retakeRun.grades.filter((grade) => grade.state === 'Correct').length;
    await expect(retaken.getByTestId('student-practice-test-runs')).toHaveText(
      `First ${firstCorrect} out of ${secondTotal} · Latest ${latestCorrect} out of ${secondTotal} · 2 attempts`,
    );
    // Which run counts, said in the child's own plain word for it.
    await expect(retaken.getByTestId('student-practice-test-runs-note')).toHaveText(
      'Your first attempt is the one that counts toward your progress.',
    );
    // The test with one finished run states one figure, with no first/latest framing
    // and no run count at all.
    const onceOnly = page
      .locator('[data-testid="student-practice-test"]')
      .filter({ has: page.locator(`a[href="/student/tests/${partlyBlankId}"]`) });
    await expect(onceOnly.getByTestId('student-practice-test-runs')).toHaveText(
      `1 out of ${total}`,
    );
    await expect(onceOnly.getByTestId('student-practice-test-runs-note')).toHaveCount(0);
    // And an open retake reads `In progress` rather than `Completed` — derived from
    // the Attempt, with no status column written. Both rows here are finished, so
    // both still read `Completed`.
    await expect(retaken.getByTestId('student-practice-test-state')).toHaveText('Completed');
  });

  test('auto-submits on the deadline with no confirmation, and grades every blank Incorrect', async ({
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

    // **FR-37 grades the blanks of an Attempt whose time ran out `Incorrect`**, and
    // nothing on this path is `Unanswered`: `Unanswered` is a Question the child
    // *chose* to leave, and here the clock chose for them. Named against the Attempt
    // that just expired, so this is an answer about that Attempt and not about
    // whichever one happens to be newest.
    const grades = await questionGradesFor(email, attempt.id);
    expect(grades.attemptId).toBe(attempt.id);
    expect(grades.grades).toHaveLength(total);
    // The one Question that was answered still stands on its own answer: expiry
    // decides what a *blank* means, not what an answer came to.
    expect(grades.grades.filter((grade) => grade.state === 'Correct')).toHaveLength(1);
    expect(grades.grades.filter((grade) => grade.state === 'Incorrect')).toHaveLength(total - 1);
    expect(grades.grades.filter((grade) => grade.state === 'Unanswered')).toEqual([]);

    // A settle, then a final count: nothing loops and nothing sends a second time.
    await page.waitForTimeout(3_000);
    expect(submits()).toHaveLength(1);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

/**
 * The results branches a real hand-in cannot reach, driven by a crafted response.
 *
 * Four of this surface's most intent-bearing branches — the partial score, the two
 * ungraded-gap sentences, the newly-graded line with its announcement, and a failed
 * read with its retry — depend on a server state that is genuinely hard to produce on
 * demand: a provider that failed once and then succeeded, or a 500 from a route that
 * does not otherwise fail. `apps/web` runs its specs without a DOM, so the unit tier
 * can only assert over the component's own source, and a source assertion cannot say
 * what a child sees.
 *
 * So the read is intercepted and fulfilled with a body chosen to put the screen in
 * each state, exactly as `student-take-test.spec.ts` intercepts the practice-test read
 * to prove its retry control actually retries. Everything up to the interception is
 * real: the parent flow, the release, the binding, the Attempt and the hand-in.
 */
const RESULTS_ROUTE = '**/api/student/attempts/*/results';

interface CraftedRow {
  ordinal: number;
  state: 'Correct' | 'Incorrect' | 'Unanswered' | 'Ungraded';
  newlyGraded?: boolean;
}

/** A results body in the shape the API states, with the states and score given. */
function craftedResults(
  rows: CraftedRow[],
  score: { correct: number; denominator: number; excludedUngraded: number },
) {
  return {
    attemptId: '00000000-0000-4000-8000-0000000000a1',
    practiceTestId: '00000000-0000-4000-8000-0000000000b1',
    subjectName: 'Submit Subject',
    questionCount: rows.length,
    score,
    // Nothing on a crafted run was adjusted, so there is no prior figure to state.
    originalScore: null,
    questions: rows.map((row) => ({
      questionId: `00000000-0000-4000-8000-00000000000${row.ordinal}`,
      ordinal: row.ordinal,
      format: 'ShortAnswer' as const,
      prompt: [{ kind: 'text', value: `Crafted question ${row.ordinal}.` }],
      studentAnswer:
        row.state === 'Unanswered' ? null : [{ kind: 'text', value: `Answer ${row.ordinal}` }],
      correctAnswer: [{ kind: 'text', value: `Answer ${row.ordinal}` }],
      state: row.state,
      newlyGraded: row.newlyGraded ?? false,
      parentAdjusted: false,
      disputed: false,
    })),
  };
}

/**
 * A real Attempt of a real released test, handed in, with the child left on the
 * handed-in state.
 *
 * The whole parent flow every time, because a released practice test is the only
 * thing a child can open and there is no shortcut to one that does not also skip the
 * release.
 */
async function handedIn(page: Page, email: string): Promise<void> {
  await releaseTests(page, email, 1);
  await page.locator('[data-testid="student-practice-test"]').first().getByRole('link').click();
  await expect(page.getByTestId('take-test-counter')).toBeVisible();
  await page.getByTestId('take-test-question').getByRole('radio').first().check();
  await page.getByTestId('take-test-hand-in').click();
  // Blanks remain, so the press meets the confirmation and goes through it.
  await page.getByTestId('take-test-confirm-hand-in').click();
  await expect(page.getByTestId('take-test-handed-in')).toBeVisible();
}

/** The one polite live region, mounted once in `ThemeRegistry`. */
function liveRegion(page: Page) {
  return page.locator('[role="status"][aria-live="polite"]');
}

test.describe('what the results say in the states a hand-in cannot produce', () => {
  test('scores only the graded Questions and names the gap, in both its forms', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await handedIn(page, uniqueParentEmail('results-gap'));

    // --- Something graded, something not ----------------------------------
    await page.route(RESULTS_ROUTE, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          craftedResults(
            [
              { ordinal: 1, state: 'Correct' },
              { ordinal: 2, state: 'Incorrect' },
              { ordinal: 3, state: 'Ungraded' },
            ],
            { correct: 1, denominator: 2, excludedUngraded: 1 },
          ),
        ),
      });
    });
    await page.reload();
    await expect(page.getByTestId('take-test-handed-in')).toBeVisible();

    // The fraction says what it is **over**: the denominator is not the paper, it is
    // the part of the paper that has been judged.
    await expect(page.getByTestId('attempt-results-score')).toHaveText(
      'You got 1 out of 2 graded questions right.',
    );
    const gap = page.getByTestId('attempt-results-gap');
    await expect(gap).toBeVisible();
    await expect(gap).toContainText('1 question has not been graded yet');
    await expect(gap).toContainText('not counted in the figure above');
    // And why the total may go up next time: the grading finishing, not the work
    // changing.
    await expect(gap).toContainText('may go up');
    // The row says it on its own row too, so a row read alone is never silent.
    const ungradedRow = page.locator('[data-testid="answer-key-row"][data-state="Ungraded"]');
    await expect(ungradedRow).toHaveCount(1);
    await expect(ungradedRow.getByTestId('answer-key-row-ungraded')).toBeVisible();
    await expect(ungradedRow.getByTestId('grade-state-label')).toHaveText('Not graded yet');
    // Which test this is, for a child arriving from history rather than a hand-in.
    await expect(page.getByTestId('attempt-results-test')).toHaveText(
      'Submit Subject · 3 questions',
    );

    // --- Nothing graded at all: no figure, so no reference to one ----------
    await page.unroute(RESULTS_ROUTE);
    await page.route(RESULTS_ROUTE, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          craftedResults(
            [
              { ordinal: 1, state: 'Ungraded' },
              { ordinal: 2, state: 'Ungraded' },
            ],
            { correct: 0, denominator: 0, excludedUngraded: 2 },
          ),
        ),
      });
    });
    await page.reload();
    await expect(page.getByTestId('take-test-handed-in')).toBeVisible();

    // `0 out of 0` is not a sentence and dividing by it is not a thing this screen
    // does, so it says something true instead.
    await expect(page.getByTestId('attempt-results-score')).toHaveText(
      'There is nothing to score yet. Nothing on this test has been graded.',
    );
    const gapOnly = page.getByTestId('attempt-results-gap');
    await expect(gapOnly).toContainText('2 questions have not been graded yet');
    // **The variant that points at no figure**, because none was stated above it.
    await expect(gapOnly).not.toContainText('figure above');
    await expect(gapOnly).toContainText('open this again later');
    // Nothing correct and nothing blank, so the meta line is absent rather than
    // reading `0 not correct · 0 unanswered`.
    await expect(page.getByTestId('attempt-results-meta')).toHaveCount(0);
  });

  test('says a Question was just graded, and announces it in the words it shows', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await handedIn(page, uniqueParentEmail('results-newly'));

    let reads = 0;
    await page.route(RESULTS_ROUTE, async (route) => {
      reads += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          craftedResults(
            [
              { ordinal: 1, state: 'Correct' },
              { ordinal: 2, state: 'Correct', newlyGraded: true },
            ],
            { correct: 2, denominator: 2, excludedUngraded: 0 },
          ),
        ),
      });
    });
    await page.reload();
    await expect(page.getByTestId('take-test-handed-in')).toBeVisible();

    const sentence = '1 more question has just been graded. Your results have been updated.';
    // Displayed…
    await expect(page.getByTestId('attempt-results-newly-graded')).toHaveText(sentence);
    // …and announced through the one polite region, in **the same words**: there is
    // one string behind both, so what is spoken and what is shown cannot come apart.
    await expect(liveRegion(page)).toHaveText(sentence);
    // On one read. A second announcement would need a second read, and there was not
    // one — nothing polls and nothing retries on a timer.
    await page.waitForTimeout(2_000);
    await expect.poll(() => reads).toBe(1);
    await expect(liveRegion(page)).toHaveText(sentence);
    // The row itself says so too, in words rather than by a highlight.
    const newly = page.locator('[data-testid="answer-key-row"][data-ordinal="2"]');
    await expect(newly.getByTestId('answer-key-row-newly-graded')).toHaveText('Just graded.');
    await expect(
      page
        .locator('[data-testid="answer-key-row"][data-ordinal="1"]')
        .getByTestId('answer-key-row-newly-graded'),
    ).toHaveCount(0);
    // A perfect paper, so no `0 not correct · 0 unanswered` line.
    await expect(page.getByTestId('attempt-results-meta')).toHaveCount(0);
    await expect(page.getByTestId('attempt-results-score')).toHaveText('You got 2 out of 2 right.');
  });

  test('states a failed read where the child is, and tries again when asked', async ({ page }) => {
    test.setTimeout(300_000);
    await handedIn(page, uniqueParentEmail('results-failed'));

    // Counted at the network, because "there is a retry control" and "the retry
    // control retries" are different claims: gutting the wiring behind it would leave
    // a child on the error with a button that does nothing, and a presence assertion
    // alone would still be green.
    let reads = 0;
    await page.route(RESULTS_ROUTE, async (route) => {
      reads += 1;
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
    });
    await page.reload();

    // The handed-in panel is untouched: the work **is** in, and a results read that
    // failed says nothing about that.
    await expect(page.getByTestId('take-test-handed-in')).toBeVisible();
    await expect(page.getByTestId('attempt-results-error')).toHaveText(
      'Your results could not be loaded.',
    );
    await expect.poll(() => reads).toBe(1);
    // **Not routed away.** A 500 here is a bad moment, not a Student Mode taken away:
    // the only refusal that sends a child to the front door is the binding's own.
    await expect(page).toHaveURL(/\/student\/tests\//u);
    await expect(page).not.toHaveURL(/\/auth\/sign-in/u);
    // And nothing retried on its own while it sat there.
    await page.waitForTimeout(3_000);
    await expect.poll(() => reads).toBe(1);

    await page.getByTestId('attempt-results-retry').click();

    // A second read actually went out, rather than the failure being re-rendered.
    await expect.poll(() => reads).toBe(2);
    await expect(page.getByTestId('attempt-results-error')).toBeVisible();
    await expect(page).toHaveURL(/\/student\/tests\//u);
  });
});
