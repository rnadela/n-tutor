import { expect, test } from '@playwright/test';
import { createGradeLevelFixture, uniqueParentEmail } from '../fixtures';

/**
 * A parent reaching the dashboard, and what it tells them before there is
 * anything to tell.
 *
 * The claims here are **device and cross-surface claims**, and they can live
 * nowhere else. `apps/web` runs its unit tests with `environment: 'node'`, so the
 * ranking, the geometry and the presentation rules are pure functions with their
 * own specs and the screens assert over their own source — but nothing there can
 * cross the PIN, follow a link from Parent View, or show what a parent with no
 * finished work actually *reads*.
 *
 * So this file owns exactly that: that the dashboard is reachable from the Parent
 * View list and only from behind the PIN, that the student switcher is there, and
 * that the empty state states the mechanism and the progress toward it — naming no
 * account plan and offering nothing to buy.
 *
 * **Deliberately no generated work.** The empty state is the claim, and driving
 * upload-extract-generate-release-sit-hand-in to reach a populated table would
 * spend minutes of provider calls to assert what the int-spec already asserts
 * against a real database.
 */

const PASSWORD = 'correct-horse-battery-staple';
const PIN = '4821';

test('a parent reaches the dashboard from Parent View and reads why it is empty', async ({
  page,
}) => {
  const email = uniqueParentEmail('analytics');
  const gradeLevel = await createGradeLevelFixture('Analytics Grade');

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

  // Two children, so "the switcher is present" is a claim about a real choice
  // rather than about a control with one option in it.
  await page.getByRole('link', { name: 'Student Profiles' }).click();
  for (const name of ['Ada', 'Grace']) {
    await page.locator('#student-name').fill(name);
    await page.locator('[role="combobox"]#student-grade-level').click();
    await page.getByRole('option', { name: gradeLevel.name }).click();
    await expect(page.getByRole('listbox')).toBeHidden();
    await page.getByRole('button', { name: 'Add the profile' }).click();
    await expect(page.locator(`[data-testid="student-row"][data-name="${name}"]`)).toBeVisible();
  }
  await page.getByRole('link', { name: 'Back to Parent View' }).click();

  // The way in, and the only way in there is: a dashboard a parent cannot reach
  // is a dashboard that did not ship.
  await page.getByRole('link', { name: 'Where a student is strong and weak' }).click();
  await expect(
    page.getByRole('heading', { name: 'Where a student is strong and weak', level: 1 }),
  ).toBeVisible();

  // One student at a time, chosen here.
  await expect(page.locator('#parent-analytics-student')).toBeVisible();

  // The empty state: the mechanism, and how far along it is. Both, because "there
  // is nothing here" alone is what makes a parent conclude the product is broken.
  const empty = page.getByTestId('analytics-empty');
  await expect(empty).toBeVisible();
  await expect(empty).toContainText('Ada');
  await expect(empty).toContainText('answered');
  // The no-work branch, which is the truthful one for a child with nothing
  // uploaded. The other branch — work finished, no topic figure yet — is the one
  // the unit specs cover, because reaching it here would mean driving the whole
  // upload-generate-release-sit-hand-in flow to assert a sentence.
  await expect(page.getByTestId('analytics-empty-progress')).toContainText(
    'No practice test has been started yet.',
  );

  // No account plan named and nothing offered for sale: a parent with no data has
  // a waiting problem, not a purchasing one.
  await expect(page.locator('body')).not.toContainText(/tier|upgrade|free plan/iu);

  // And the whole of it is behind the PIN: a reload drops the in-memory bearer,
  // and the screen returns the parent to the gate rather than rendering empty.
  await page.reload();
  await expect(page.locator('#parent-pin')).toBeVisible();
});
