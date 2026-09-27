import { expect, test, type Page } from '@playwright/test';
import { createGradeLevelFixture, createSubjectFixture, uniqueParentEmail } from '../fixtures';

/**
 * A parent reading what their child was told, and reporting one of it.
 *
 * The claims here are **device and cross-surface claims**, and they can live nowhere
 * else. `apps/web` runs its unit tests with `environment: 'node'`, so the decision a
 * row makes is a pure function with its own spec and the two screens' specs assert over
 * their own source — but nothing there can press a control, watch the wire, or show
 * that the *child's* screen still serves the same prose after a parent flagged it. So
 * this file owns: that a parent reaches a child's runs from Parent View, reads the same
 * Explanation the child was shown, flags it, sees the flagged state, finds it still
 * flagged after a reload, and that the child's own results screen is untouched by all
 * of it.
 *
 * The whole flow is driven through the real screens — sign-up, PIN, profile, upload,
 * generate, release, sit, hand in, explain — because the only route to a stored
 * Explanation is a child asking for one, and there is no shortcut to that which does
 * not also skip it.
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
 * Signs a parent up, adds one child, uploads two pages, generates one practice test and
 * releases it — then leaves the page on Student Home, bound to that child.
 *
 * The whole parent flow, for the reason the hand-in and explanation specs give: there is
 * no shortcut to a released practice test that does not also skip the release.
 */
async function releaseOneTest(page: Page, email: string): Promise<void> {
  const gradeLevel = await createGradeLevelFixture('Review Grade');
  const subject = await createSubjectFixture('Review Subject', gradeLevel.id);

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
  await page.locator('#student-name').fill('Ada');
  await page.locator('[role="combobox"]#student-grade-level').click();
  await page.getByRole('option', { name: gradeLevel.name }).click();
  await expect(page.getByRole('listbox')).toBeHidden();
  await page.getByRole('button', { name: 'Add the profile' }).click();
  await expect(page.locator('[data-testid="student-row"][data-name="Ada"]')).toBeVisible();

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
    .locator('[data-testid="generate-count-option"][data-count="1"]')
    .getByRole('radio')
    .check();
  await page.getByTestId('generate-start').click();
  await page.getByTestId('generate-confirm').click();
  await expect(page.getByTestId('generate-progress-line')).toHaveText('1 practice test is ready.', {
    timeout: 90_000,
  });

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

  await page.getByRole('button', { name: 'Back to Student Mode' }).click();
  await expect(page.getByRole('heading', { name: 'Your practice', level: 1 })).toBeVisible();
}

/** How many Questions this test holds, read off the counter the child is shown. */
async function totalOf(page: Page): Promise<number> {
  const counter = await page.getByTestId('take-test-counter').innerText();
  return Number(/of (\d+)/u.exec(counter)![1]);
}

/** Sits the released test whole and hands it in, landing on the answer key. */
async function sitAndHandIn(page: Page): Promise<number> {
  await page.locator('[data-testid="student-practice-test"]').first().getByRole('link').click();
  await expect(page.getByTestId('take-test-counter')).toBeVisible();
  const total = await totalOf(page);
  for (let at = 0; at < total; at += 1) {
    await page.getByTestId('take-test-question').getByRole('radio').first().check();
    if (at < total - 1) await page.getByTestId('take-test-next').click();
  }
  await page.getByTestId('take-test-hand-in').click();
  await expect(page.getByTestId('take-test-handed-in')).toBeVisible();
  await expect(page.getByTestId('attempt-results')).toBeVisible();
  return total;
}

/** Crosses the PIN gate again and lands inside Parent View. */
async function reenterParentView(page: Page): Promise<void> {
  await page.goto('/parent/pin');
  await page.locator('#parent-pin').fill(PIN);
  await page.getByRole('button', { name: 'Enter Parent View' }).click();
  await expect(
    page.getByRole('heading', { name: 'Parent View', level: 1, exact: true }),
  ).toBeVisible();
}

test.describe('a parent reading and reporting what their child was told', () => {
  test('reaches the child’s run, reads the same explanation, reports it, and changes nothing the child sees', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const email = uniqueParentEmail('parent-explanation-review');
    await releaseOneTest(page, email);

    // Every explanation request the browser makes, counted at the network. "A parent
    // read asked for nothing" is a claim about the wire, and a screen assertion would
    // be green with it wrong. Only the child's surface can produce one of these: it is
    // the `POST` that generates or reads the stored row, and the parent's screens make
    // no such call at all.
    const explainCalls: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/explanation')) {
        explainCalls.push(request.url());
      }
    });

    // --- The child asks about one Question, and only one --------------------
    const total = await sitAndHandIn(page);
    expect(total).toBeGreaterThan(1);
    const childRows = page.locator('[data-testid="answer-key-row"]');
    await expect(childRows).toHaveCount(total);
    await childRows.first().getByTestId('explain-control').click();
    await expect(childRows.first().getByTestId('explain-body')).toBeVisible({ timeout: 30_000 });
    const childProse = (await childRows.first().getByTestId('explain-body').innerText()).trim();
    expect(childProse.length).toBeGreaterThan(0);
    expect(explainCalls).toHaveLength(1);

    // --- The parent comes back in and finds the run -------------------------
    await reenterParentView(page);
    await page.getByRole('link', { name: 'Practice tests a student has finished' }).click();
    await expect(
      page.getByRole('heading', { name: 'Finished practice tests', level: 1 }),
    ).toBeVisible();

    const runRows = page.locator('[data-testid="parent-attempt-row"]');
    await expect(runRows).toHaveCount(1);
    await expect(runRows.first().getByTestId('parent-attempt-run')).toHaveText('Run 1');
    await runRows.first().getByRole('link', { name: 'Read it' }).click();
    await expect(
      page.getByRole('heading', { name: 'The practice test, as it was marked', level: 1 }),
    ).toBeVisible();

    // --- The whole answer key, in the parent's own words --------------------
    const parentRows = page.locator('[data-testid="answer-key-row"]');
    await expect(parentRows).toHaveCount(total);
    await expect(page.getByTestId('parent-attempt-score')).toBeVisible();
    const detail = page.locator('main');
    // Third person about the child, never addressed to them: the child's own second
    // person does not survive the crossing.
    await expect(detail).toContainText('The student answered');
    await expect(detail).not.toContainText('You answered');

    // --- The same explanation, inline beneath its own Question --------------
    const firstReview = parentRows.first().getByTestId('explanation-review');
    await expect(firstReview).toHaveAttribute('data-state', 'unflagged');
    // Byte for byte what the child read, beneath the same Question — never a dialog
    // and never a route of its own (UX-DR16). The URL did not move for it.
    await expect(firstReview.getByTestId('explanation-body')).toHaveText(childProse);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(parentRows.first().getByTestId('answer-key-prompt')).toBeVisible();

    // A Question the child never asked about says so, and offers nothing to press:
    // nothing on this surface generates, and the count at the wire says so too.
    const secondReview = parentRows.nth(1).getByTestId('explanation-review');
    await expect(secondReview).toHaveAttribute('data-state', 'absent');
    await expect(secondReview.getByTestId('explanation-not-asked')).toBeVisible();
    await expect(secondReview.getByTestId('explanation-flag')).toHaveCount(0);
    expect(explainCalls).toHaveLength(1);

    // --- It says what reporting does, before it is pressed -----------------
    await expect(firstReview.getByTestId('explanation-note')).toContainText(
      'The student still sees the same explanation.',
    );
    // And nothing about billing reaches this screen either.
    await expect(detail).not.toContainText(/allowance|tier|upgrade|gpt-|claude|\$|£/iu);

    // --- One press reports it, announced in the words on screen ------------
    const control = firstReview.getByTestId('explanation-flag');
    await expect(control).toBeVisible();
    await control.focus();
    await expect(control).toBeFocused();
    // Reached from the keyboard alone, so "a person can get here without a pointer"
    // and "the press records the concern" are one sequence rather than two setups.
    await page.keyboard.press('Enter');

    await expect(firstReview).toHaveAttribute('data-state', 'flagged');
    await expect(firstReview.getByTestId('explanation-flagged')).toBeVisible();
    // The control is gone rather than inert: there is no un-flagging.
    await expect(firstReview.getByTestId('explanation-flag')).toHaveCount(0);
    // Announced through the one live region, with the sentence the screen shows.
    await expect(page.getByTestId('parent-attempt-announcement')).toContainText(
      'The explanation for question 1 is reported. The student still sees the same explanation.',
    );

    // A second press is impossible from here — there is no control — and the record
    // survives a reload, which is the only proof it was written rather than held.
    await page.reload();
    const afterReload = page
      .locator('[data-testid="answer-key-row"]')
      .first()
      .getByTestId('explanation-review');
    await expect(afterReload).toHaveAttribute('data-state', 'flagged');
    await expect(afterReload.getByTestId('explanation-body')).toHaveText(childProse);
    // Reading it twice still generated nothing.
    expect(explainCalls).toHaveLength(1);

    // --- And the child sees exactly what they saw before -------------------
    // The whole point of the note above: a flag records a concern and changes nothing
    // that is served. So the child's own results screen is checked, not assumed.
    await page.getByRole('link', { name: 'Back to the finished practice tests' }).click();
    await expect(
      page.getByRole('heading', { name: 'Finished practice tests', level: 1 }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Back to Parent View' }).click();
    await page.getByRole('button', { name: 'Back to Student Mode' }).click();
    await expect(page.getByRole('heading', { name: 'Your practice', level: 1 })).toBeVisible();

    await page.locator('[data-testid="student-practice-test"]').first().getByRole('link').click();
    await expect(page.getByTestId('attempt-results')).toBeVisible({ timeout: 30_000 });
    const backOnChildRows = page.locator('[data-testid="answer-key-row"]');
    await backOnChildRows.first().getByTestId('explain-control').click();
    // The same prose, unchanged: the flag suppressed nothing and regenerated nothing —
    // that is Story 6.4's, and it has not happened. The second call here is the child
    // pressing again, which reads the stored row rather than writing a new one.
    await expect(backOnChildRows.first().getByTestId('explain-body')).toHaveText(childProse, {
      timeout: 30_000,
    });
    expect(explainCalls).toHaveLength(2);
    // And the child is told nothing about the report: it is not a fact about them.
    await expect(page.getByTestId('attempt-results')).not.toContainText(/report|flag/iu);
  });
});
