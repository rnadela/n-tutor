import { expect, test, type Page } from '@playwright/test';
import {
  createGradeLevelFixture,
  createSubjectFixture,
  seedGradedTopicFixture,
  seedReleasedPracticeTestFixture,
  uniqueParentEmail,
} from '../fixtures';

const PASSWORD = 'correct-horse-battery-staple';
const PIN = '4821';
/** A phone, in portrait: the width Student Mode's bar is stated at. */
const PHONE = { width: 390, height: 844 };

/**
 * The Results screen, with finished work actually on it.
 *
 * `bottom-nav.spec.ts` already walks the three tabs and the empty state; what it
 * cannot say is what the screen *lists*, because the child it signs up has
 * finished nothing. The whole claim of Story 10.5 — only `Completed` practice
 * tests, in the order the server stated them, each row opening that test's own
 * results — is a claim about rows, so it is made here against rows.
 *
 * The papers are seeded rather than generated: driving upload → extract →
 * generate → release → sit → hand in through the browser, twice, would spend
 * minutes of provider calls to make two rows exist, and this file asserts
 * nothing about that pipeline.
 */

async function signUp(page: Page, email: string): Promise<void> {
  await page.goto('/auth/sign-up');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByLabel('I accept the terms of use.').check();
  await page.getByLabel('I accept the notice on children’s data.').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Signed in' })).toBeVisible();
}

/** Signs up, sets the PIN, adds one child, and ends on the Students screen. */
async function signUpWithOneChild(page: Page, gradeLevelName: string): Promise<string> {
  const email = uniqueParentEmail('student-results');
  await signUp(page, email);
  await page.getByRole('link', { name: 'Enter Parent View' }).click();
  await expect(page.getByRole('heading', { name: 'Set a PIN for Parent View' })).toBeVisible();
  await page.locator('#parent-pin').fill(PIN);
  await page.getByRole('button', { name: 'Save the PIN' }).click();
  await expect(
    page.getByRole('heading', { name: 'Parent View', level: 1, exact: true }),
  ).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Parent View' })
    .getByRole('link', { name: 'Student Profiles' })
    .click();
  await expect(page.getByRole('heading', { name: 'Student Profiles', level: 1 })).toBeVisible();
  await page.locator('#student-name').fill('Noah');
  await page.locator('[role="combobox"]#student-grade-level').click();
  await page.getByRole('option', { name: gradeLevelName }).click();
  await expect(page.getByRole('listbox')).toBeHidden();
  await page.getByRole('button', { name: 'Add the profile' }).click();
  await expect(page.locator('main').getByRole('status')).toContainText('Noah');
  return email;
}

test.describe('the Results screen', () => {
  test('lists the finished tests newest first, and opens one', async ({ page }) => {
    const grade = await createGradeLevelFixture('Results Grade');
    const [newerSubject, olderSubject, unfinishedSubject] = await Promise.all([
      createSubjectFixture('Results Newer', grade.id),
      createSubjectFixture('Results Older', grade.id),
      createSubjectFixture('Results Unfinished', grade.id),
    ]);

    const email = await signUpWithOneChild(page, grade.name);

    // Two handed-in papers, staggered, so "most recently submitted first" is a
    // claim two rows can actually disagree about — and one released paper
    // nobody has sat, which must not appear here at all.
    const older = await seedGradedTopicFixture(
      email,
      'Noah',
      olderSubject.id,
      { name: 'long division', rawLabel: 'Long Division' },
      { submittedMinutesAgo: 240 },
    );
    const newer = await seedGradedTopicFixture(
      email,
      'Noah',
      newerSubject.id,
      { name: 'fractions of amounts', rawLabel: 'Fractions Of Amounts' },
      { submittedMinutesAgo: 5 },
    );
    await seedReleasedPracticeTestFixture(email, 'Noah', unfinishedSubject.id);

    await page.setViewportSize(PHONE);
    // One child is no choice at all, so the exit hands the device straight over.
    await page.getByRole('button', { name: 'Back to Student Mode' }).click();
    await expect(page.getByRole('heading', { name: 'Your practice', level: 1 })).toBeVisible();

    // Home is still one flat list with everything on it (FR-16): all three
    // papers, finished and not.
    await expect(page.getByTestId('student-practice-test')).toHaveCount(3);

    const studentBar = page.getByRole('navigation', { name: 'Student sections' });
    await studentBar.getByRole('link', { name: 'Results' }).click();
    await expect(
      page.getByRole('heading', { name: 'Your finished tests', level: 1 }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/student\/results$/u);

    // Exactly the finished papers, in the order the server stated them: band 2
    // is most recently submitted first, and the screen only filters.
    await expect(page.getByTestId('student-practice-test')).toHaveCount(2);
    await expect(page.getByTestId('student-practice-test-subject')).toHaveText([
      newerSubject.name,
      olderSubject.name,
    ]);
    await expect(page.getByTestId('student-practice-test-state')).toHaveText([
      'Completed',
      'Completed',
    ]);
    // The paper nobody has sat is not here, by its Subject and by its id.
    await expect(page.getByText(unfinishedSubject.name)).toHaveCount(0);
    await expect(page.getByTestId('student-results-empty')).toHaveCount(0);

    const firstRow = page.getByTestId('student-practice-test').first();
    await expect(firstRow.getByRole('link')).toHaveAttribute(
      'href',
      `/student/tests/${newer.practiceTestId}`,
    );
    await expect(
      page.getByTestId('student-practice-test').nth(1).getByRole('link'),
    ).toHaveAttribute('href', `/student/tests/${older.practiceTestId}`);

    // And a row opens that test's own results, which is where a finished test's
    // results already lived.
    await firstRow.getByRole('link').click();
    // The answer key's own `?q=` is written by a replace as the results land, so the
    // route is the test's with the shown Question named on it.
    await expect(page).toHaveURL(new RegExp(`/student/tests/${newer.practiceTestId}\\?q=1$`, 'u'));
    await expect(page.getByRole('heading', { name: 'Your results', level: 2 })).toBeVisible();
  });

  test('pages the answer key one Question at a time, at both viewports', async ({ page }) => {
    const grade = await createGradeLevelFixture('Results Paging Grade');
    const subject = await createSubjectFixture('Results Paging', grade.id);
    const email = await signUpWithOneChild(page, grade.name);
    // Three Questions, graded wrong, blank and right — so the results map has three of
    // the four grade states on it and no state is vacuously satisfied.
    const seeded = await seedGradedTopicFixture(email, 'Noah', subject.id, {
      name: 'paged fractions',
      rawLabel: 'Paged Fractions',
    });

    await page.getByRole('button', { name: 'Back to Student Mode' }).click();
    await expect(page.getByRole('heading', { name: 'Your practice', level: 1 })).toBeVisible();

    // Every call the browser makes, counted at the wire: "a page turn fires nothing" is
    // a claim about the network, and a screen assertion would be green either way.
    const calls: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/')) calls.push(request.url());
    });

    // --- From `md` up: the map is a persistent rail ------------------------
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/student/tests/${seeded.practiceTestId}`);
    await expect(page.getByTestId('attempt-results')).toBeVisible({ timeout: 30_000 });

    // No `q` on arrival, so the clamp names the first Question — written by a replace.
    await expect(page).toHaveURL(/\?q=1$/u);
    const rows = page.locator('[data-testid="answer-key-row"]');
    await expect(rows).toHaveCount(3);
    // **Every row is mounted and all but one are hidden.** That is what preserves an
    // open panel across a turn, and `hidden` is what keeps the other two out of the
    // assistive-technology tree meanwhile.
    const visibleRows = page.locator('[data-testid="answer-key-row"]:not([hidden])');
    await expect(visibleRows).toHaveCount(1);
    await expect(visibleRows).toHaveAttribute('data-ordinal', '1');
    await expect(page.getByTestId('answer-key-position')).toHaveText('Question 1 of 3');
    // The score header is above the pager, stated once.
    await expect(page.getByTestId('attempt-results-score')).toBeVisible();
    await expect(page.getByTestId('attempt-results-score')).toHaveCount(1);
    // The retake control is below the pager, under every Question.
    await expect(page.getByTestId('take-test-retake')).toBeVisible();

    // The rail is on screen and the overlay's opener is not — decided by CSS at the
    // breakpoint, never by a JS media query.
    const rail = page.getByTestId('answer-key-map-rail');
    await expect(rail).toBeVisible();
    await expect(page.getByTestId('answer-key-map-open')).toBeHidden();

    // The map: one real button per Question, in order, the current one marked, each
    // carrying its grade state — and a legend of exactly the states that are present.
    const cells = rail.locator('[data-testid="answer-key-map-cell"]');
    await expect(cells).toHaveCount(3);
    expect(
      await cells.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-ordinal'))),
    ).toEqual(['1', '2', '3']);
    await expect(rail.locator('[aria-current="true"]')).toHaveCount(1);
    const states = await cells.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-state')),
    );
    const legend = rail.locator('[data-testid="answer-key-map-legend-entry"]');
    await expect(legend).toHaveCount(new Set(states).size);
    // Grade vocabulary only: not one word of the progress map's, and no percentage.
    await expect(rail).not.toContainText(/\bAnswered\b|Not answered|%/u);

    // --- Previous and Next, and where they stop ----------------------------
    await expect(page.getByTestId('answer-key-previous')).toBeDisabled();
    await expect(page.getByTestId('answer-key-next')).toBeEnabled();

    const beforeTurns = calls.length;
    await page.getByTestId('answer-key-next').click();
    await expect(page).toHaveURL(/\?q=2$/u);
    await expect(page.getByTestId('answer-key-position')).toHaveText('Question 2 of 3');
    await expect(visibleRows).toHaveAttribute('data-ordinal', '2');
    // Focus lands on that Question's own heading, and the position is announced in the
    // very words the line displays.
    await expect(page.locator('[data-testid="answer-key-row"][data-ordinal="2"] h4')).toBeFocused();
    await expect(page.locator('[role="status"][aria-atomic="true"]')).toHaveText('Question 2 of 3');
    await expect(page.getByTestId('answer-key-previous')).toBeEnabled();

    // --- Arrow keys, outside a text field ----------------------------------
    // There is no text entry anywhere on this surface, so "the caret moves and the page
    // does not turn" is asserted where it can be: `shouldPageOnKey` in
    // `apps/web/src/lib/answer-key-paging.spec.ts`, over every excluded tag.
    await page.keyboard.press('ArrowRight');
    await expect(page).toHaveURL(/\?q=3$/u);
    await expect(page.getByTestId('answer-key-next')).toBeDisabled();
    // At the end it does nothing, and a held modifier is the browser's.
    await page.keyboard.press('ArrowRight');
    await expect(page).toHaveURL(/\?q=3$/u);
    await page.keyboard.press('Shift+ArrowLeft');
    await expect(page).toHaveURL(/\?q=3$/u);
    await page.keyboard.press('ArrowLeft');
    await expect(page).toHaveURL(/\?q=2$/u);

    // **Not one of those turns asked the server for anything.** Paging is a state
    // change over the one read, so it can never bill a provider call.
    expect(calls).toHaveLength(beforeTurns);

    // --- The address bar is the carrier, and it survives a reload ----------
    await page.reload();
    await expect(page.getByTestId('attempt-results')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('answer-key-position')).toHaveText('Question 2 of 3');
    await expect(visibleRows).toHaveAttribute('data-ordinal', '2');

    // A junk or out-of-range `q` opens the first Question and is replaced, silently:
    // no alert, no error line.
    for (const raw of ['99', 'abc', '0', '-2', '']) {
      await page.goto(`/student/tests/${seeded.practiceTestId}?q=${raw}`);
      await expect(page.getByTestId('attempt-results')).toBeVisible({ timeout: 30_000 });
      await expect(page).toHaveURL(/\?q=1$/u);
      await expect(page.getByTestId('answer-key-position')).toHaveText('Question 1 of 3');
      await expect(page.getByTestId('attempt-results-error')).toHaveCount(0);
    }

    // Back is a way off the screen rather than a walk back through the paper: every
    // position was written with a replace, so however many Questions were turned, one
    // press returns to where the child came from.
    await page.goto('/student');
    await expect(page.getByRole('heading', { name: 'Your practice', level: 1 })).toBeVisible();
    await page.goto(`/student/tests/${seeded.practiceTestId}`);
    await expect(page.getByTestId('attempt-results')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('answer-key-next').click();
    await expect(page).toHaveURL(/\?q=2$/u);
    await page.getByTestId('answer-key-next').click();
    await expect(page).toHaveURL(/\?q=3$/u);
    await page.goBack();
    await expect(page).toHaveURL(/\/student$/u);

    // --- Below `md`: the map is an overlay, closed on a jump ---------------
    await page.goto(`/student/tests/${seeded.practiceTestId}`);
    await expect(page.getByTestId('attempt-results')).toBeVisible({ timeout: 30_000 });
    await page.setViewportSize(PHONE);
    await expect(page.getByTestId('answer-key-map-rail')).toBeHidden();
    const opener = page.getByTestId('answer-key-map-open');
    await expect(opener).toBeVisible();
    await opener.click();

    const overlay = page.getByRole('dialog');
    await expect(overlay).toBeVisible();
    // While it is up, an arrow key moves nothing: its cells are the way to a Question,
    // and a page turning behind a modal would move the thing being chosen from.
    await page.keyboard.press('ArrowRight');
    await expect(page).toHaveURL(/\?q=1$/u);
    await overlay.locator('[data-testid="answer-key-map-cell"][data-ordinal="3"]').click();
    // The jump closed it and the Question changed, with focus on its heading.
    await expect(overlay).toHaveCount(0);
    await expect(page).toHaveURL(/\?q=3$/u);
    await expect(page.getByTestId('answer-key-position')).toHaveText('Question 3 of 3');
    await expect(page.locator('[data-testid="answer-key-row"][data-ordinal="3"] h4')).toBeFocused();
    // And the retake control is still there, under the last Question as under the first.
    await expect(page.getByTestId('take-test-retake')).toBeVisible();
  });
});
