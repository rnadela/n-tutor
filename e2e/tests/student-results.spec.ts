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
    await expect(page).toHaveURL(new RegExp(`/student/tests/${newer.practiceTestId}$`, 'u'));
    await expect(page.getByRole('heading', { name: 'Your results', level: 2 })).toBeVisible();
  });
});
