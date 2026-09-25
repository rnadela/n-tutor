import { expect, test, type Page } from '@playwright/test';
import {
  createGradeLevelFixture,
  createSubjectFixture,
  spreadPracticeTestFormatsFixture,
  uniqueParentEmail,
} from '../fixtures';

/**
 * Taking a practice test, end to end.
 *
 * Every interaction claim in this story lives here and nowhere else: `apps/web`
 * runs its unit tests with `environment: 'node'`, so a component spec there can
 * assert markup but never a click, a keystroke or a navigation. Selecting an
 * option, typing a fraction, walking Back and Next and jumping from the map are
 * exactly those, so this is the layer that can state them.
 *
 * The practice test is generated and released through the real parent flow, and
 * read back through the real binding — nothing about the student path is
 * stubbed.
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

async function signUp(page: Page, email: string): Promise<void> {
  await page.goto('/auth/sign-up');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByLabel('I accept the terms of use.').check();
  await page.getByLabel('I accept the notice on children’s data.').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Signed in' })).toBeVisible();
}

/** Signed up, past the PIN, one child, two pages captured and read. */
async function uploadAndRead(page: Page, email: string): Promise<void> {
  const gradeLevel = await createGradeLevelFixture('Take Grade');
  const subject = await createSubjectFixture('Take Subject', gradeLevel.id);

  await signUp(page, email);
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
  await expect(page.getByTestId('submitted-note')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue to practice test' })).toBeVisible({
    timeout: 30_000,
  });
}

/** Crosses the thin-Extraction warning, which the fake's density always trips. */
async function enterGenerate(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Continue to practice test' }).click();
  const warning = page.getByRole('dialog');
  await expect(warning).toBeVisible();
  await warning.getByRole('button', { name: 'Continue anyway' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Generate practice tests' })).toBeVisible();
}

test.describe('taking a released practice test', () => {
  test('walks every Format, holds each answer, and never says anything about being right', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const email = uniqueParentEmail('take-test');
    await uploadAndRead(page, email);
    await enterGenerate(page);

    await page
      .locator('[data-testid="generate-count-option"][data-count="1"]')
      .getByRole('radio')
      .check();
    await page.getByTestId('generate-start').click();
    await page.getByTestId('generate-confirm').click();
    await expect(page.getByTestId('generate-progress-line')).toHaveText(
      '1 practice test is ready.',
      { timeout: 60_000 },
    );

    // The fake Extraction reads only Multiple Choice off a page, so the draft is
    // spread across all three Formats before it is released — the row is stored
    // exactly as generation stores one, and everything below goes through the
    // real release, the real binding and the real student read.
    const questionCount = await spreadPracticeTestFormatsFixture(email);
    expect(questionCount).toBe(3);

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
    // Selected by the sentence the child actually reads: that sentence is the
    // link's accessible name, with nothing labelled over the top of it.
    await page.getByRole('link', { name: 'A practice test with 3 questions' }).click();

    await expect(page.getByTestId('take-test-counter')).toHaveText('Question 1 of 3');
    await expect(page.getByTestId('take-test-format')).toHaveText('Multiple choice');
    // Back is disabled on the first Question rather than wrapping to the last.
    await expect(page.getByTestId('take-test-back')).toBeDisabled();

    // --- Multiple Choice ---------------------------------------------------
    const options = page.getByTestId('take-test-question').getByRole('radio');
    await expect(options).toHaveCount(3);
    await options.first().check();
    await expect(options.first()).toBeChecked();
    // Exactly one option is selectable at a time.
    await expect(
      page.getByTestId('take-test-question').getByRole('radio', { checked: true }),
    ).toHaveCount(1);

    // --- Fill in the Blank -------------------------------------------------
    await page.getByTestId('take-test-next').click();
    await expect(page.getByTestId('take-test-counter')).toHaveText('Question 2 of 3');
    await expect(page.getByTestId('take-test-format')).toHaveText('Fill in the blank');
    const blank = page.getByTestId('answer-fraction-input');
    await blank.fill('3/4');
    // The raw string is the value, untouched, and the stacked form is a sibling
    // beside it rather than anything that could have rewritten what was typed.
    await expect(blank).toHaveValue('3/4');
    await expect(page.getByTestId('answer-fraction-preview')).toBeVisible();
    // Prose is accepted exactly as typed, with no sibling and no refusal.
    await blank.fill('one half');
    await expect(blank).toHaveValue('one half');
    await expect(page.getByTestId('answer-fraction-preview')).toHaveCount(0);
    await blank.fill('3/4');

    // --- Short Answer ------------------------------------------------------
    await page.getByTestId('take-test-next').click();
    await expect(page.getByTestId('take-test-counter')).toHaveText('Question 3 of 3');
    await expect(page.getByTestId('take-test-format')).toHaveText('Short answer');
    // Next is disabled on the last Question: there is nothing past it, and no
    // control here hands anything in.
    await expect(page.getByTestId('take-test-next')).toBeDisabled();
    const short = page.getByTestId('answer-short-input');
    await expect(short).toHaveJSProperty('tagName', 'TEXTAREA');
    await short.fill('Three of the four parts are shaded.');

    // --- The map, as the rail ----------------------------------------------
    const rail = page.getByTestId('take-test-map-rail');
    await expect(rail).toBeVisible();
    // At this width the overlay's opener is not on screen: the map already is.
    await expect(page.getByTestId('take-test-map-open')).toBeHidden();
    await expect(rail.getByTestId('question-map-summary')).toHaveText(
      '3 answered · 0 not answered',
    );
    await expect(rail.getByTestId('question-map-cell')).toHaveCount(3);
    // Every cell announces itself whole, and the current one says so in words.
    await expect(rail.getByRole('button', { name: 'Question 1, answered' })).toBeVisible();
    await expect(
      rail.getByRole('button', { name: 'Question 3, answered, you are here' }),
    ).toBeVisible();

    // Nothing anywhere on the screen claims a verdict.
    await expect(page.getByRole('main')).not.toContainText(/correct|wrong|score|%/iu);
    await expect(page.locator('body')).not.toContainText('Unanswered');

    // --- Clearing an answer returns the cell to Not answered ---------------
    await short.fill('   ');
    await expect(
      rail.getByRole('button', { name: 'Question 3, not answered, you are here' }),
    ).toBeVisible();
    await expect(rail.getByTestId('question-map-summary')).toHaveText(
      '2 answered · 1 not answered',
    );
    await short.fill('Three of the four parts are shaded.');

    // --- The map, as the overlay -------------------------------------------
    await page.setViewportSize({ width: 600, height: 900 });
    await expect(rail).toBeHidden();
    const open = page.getByTestId('take-test-map-open');
    await expect(open).toBeVisible();
    await open.click();
    const overlay = page.getByRole('dialog');
    await expect(overlay).toBeVisible();
    // The same component in both forms, so the two can never disagree.
    await expect(overlay.getByTestId('question-map-cell')).toHaveCount(3);
    await overlay.getByRole('button', { name: 'Question 1, answered' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // --- The earlier answers are still there, and still changeable ---------
    await expect(page.getByTestId('take-test-counter')).toHaveText('Question 1 of 3');
    await expect(page.getByTestId('take-test-question').getByRole('radio').first()).toBeChecked();
    await page.getByTestId('take-test-question').getByRole('radio').nth(1).check();
    await expect(page.getByTestId('take-test-question').getByRole('radio').nth(1)).toBeChecked();

    await page.getByTestId('take-test-next').click();
    await expect(page.getByTestId('answer-fraction-input')).toHaveValue('3/4');
    await page.getByTestId('take-test-next').click();
    await expect(page.getByTestId('answer-short-input')).toHaveValue(
      'Three of the four parts are shaded.',
    );

    // Nothing was written anywhere the browser can see: the answers are this
    // page's state, and Story 5.3 owns keeping them.
    const residue = await page.evaluate(() => ({
      local: Object.entries({ ...window.localStorage }),
      session: Object.entries({ ...window.sessionStorage }),
      cookie: document.cookie,
    }));
    expect(residue.local).toEqual([]);
    expect(residue.session).toEqual([]);
    expect(residue.cookie).toBe('');
  });

  test('refuses a practice test that is not this child’s, without saying which', async ({
    page,
  }) => {
    const grade = await createGradeLevelFixture('Take Grade');
    const email = uniqueParentEmail('take-test-missing');
    await signUp(page, email);
    await page.getByRole('link', { name: 'Enter Parent View' }).click();
    await page.locator('#parent-pin').fill(PIN);
    await page.getByRole('button', { name: 'Save the PIN' }).click();
    await page.getByRole('link', { name: 'Student Profiles' }).click();
    await page.locator('#student-name').fill('Noah');
    await page.locator('[role="combobox"]#student-grade-level').click();
    await page.getByRole('option', { name: grade.name }).click();
    await expect(page.getByRole('listbox')).toBeHidden();
    await page.getByRole('button', { name: 'Add the profile' }).click();
    await expect(page.locator('[data-testid="student-row"][data-name="Noah"]')).toBeVisible();

    await page.getByRole('button', { name: 'Back to Student Mode' }).click();
    await expect(page.getByRole('heading', { name: 'Your practice', level: 1 })).toBeVisible();

    // Counted at the network, because "there is a retry control" and "the retry
    // control retries" are different claims: gutting the wiring behind it would
    // leave a child stuck on the error screen forever with a button that does
    // nothing, and a presence assertion alone would still be green.
    let reads = 0;
    await page.route('**/api/student/practice-tests/*', async (route) => {
      reads += 1;
      await route.continue();
    });

    // A perfectly well-formed id for a practice test that is not there. The child
    // is left on the screen with something to try again, and is not routed away:
    // this is a bad moment, not a Student Mode taken away from them.
    await page.goto('/student/tests/00000000-0000-4000-8000-000000000000');
    await expect(page.getByTestId('take-test-error')).toBeVisible();
    await expect(page).toHaveURL(/\/student\/tests\//u);
    await expect.poll(() => reads).toBe(1);

    await page.getByRole('button', { name: 'Try again' }).click();
    // A second read actually went out: the control re-issues the request rather
    // than only re-rendering the failure it is sitting on.
    await expect.poll(() => reads).toBe(2);
    await expect(page.getByTestId('take-test-error')).toBeVisible();
    await expect(page).toHaveURL(/\/student\/tests\//u);
  });
});
