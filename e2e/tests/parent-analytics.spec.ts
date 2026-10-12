import { expect, test, type Page } from '@playwright/test';
import {
  countGenerationJobsFor,
  createGradeLevelFixture,
  createSubjectFixture,
  requestedCountOfNewestJobFor,
  seedGradedTopicFixture,
  setParentTierFixture,
  uniqueParentEmail,
  weightedTopicOfNewestJobFor,
  worstSidewaysOverflow,
} from '../fixtures';

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
 *
 * The second test below owns the drill-down's device claims for the same reason: that
 * it is reachable from the Mastery table, that it is behind the PIN, and that it names
 * no account plan and offers nothing to buy. What it *states* about a populated topic —
 * the figure, the two lists, the cost block's three lines — is asserted over the
 * screen's own source and over the real database, because reaching a populated row here
 * would mean driving the whole pipeline to read a sentence.
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
  await page.getByLabel(/^Password/).fill(PASSWORD);
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
  // rather than about a control with one option in it. Two active children need
  // a tier above Free, which allows one.
  await setParentTierFixture(email, 'Family');
  await page
    .getByRole('navigation', { name: 'Parent View' })
    .getByRole('link', { name: 'Student Profiles' })
    .click();
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
  await page
    .getByRole('navigation', { name: 'Parent View' })
    .getByRole('link', { name: 'Where a student is strong and weak' })
    .click();
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

/**
 * A parent standing on the Mastery dashboard with exactly one graded topic on it.
 *
 * Shared by the drill-down test and the layout-swap test below, because the two ask
 * different questions of the same screen and neither should have to resize a viewport
 * the other depends on.
 */
async function openMasteryWithOneTopic(
  page: Page,
): Promise<{ email: string; seeded: Awaited<ReturnType<typeof seedGradedTopicFixture>> }> {
  const email = uniqueParentEmail('drill-down');
  const gradeLevel = await createGradeLevelFixture('Drill-Down Grade');
  const subject = await createSubjectFixture('Drill-Down Maths', gradeLevel.id);

  await page.goto('/auth/sign-up');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByLabel('I accept the terms of use.').check();
  await page.getByLabel('I accept the notice on children\u2019s data.').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Signed in' })).toBeVisible();

  await page.getByRole('link', { name: 'Enter Parent View' }).click();
  await page.locator('#parent-pin').fill(PIN);
  await page.getByRole('button', { name: 'Save the PIN' }).click();
  await expect(
    page.getByRole('heading', { name: 'Parent View', level: 1, exact: true }),
  ).toBeVisible();

  await page
    .getByRole('navigation', { name: 'Parent View' })
    .getByRole('link', { name: 'Student Profiles' })
    .click();
  await page.locator('#student-name').fill('Ada');
  await page.locator('[role="combobox"]#student-grade-level').click();
  await page.getByRole('option', { name: gradeLevel.name }).click();
  await expect(page.getByRole('listbox')).toBeHidden();
  await page.getByRole('button', { name: 'Add the profile' }).click();
  await expect(page.locator('[data-testid="student-row"][data-name="Ada"]')).toBeVisible();

  // One finished, graded paper on one topic — the least work that makes a row exist to
  // open. Seeded rather than driven through the pipeline, for the reason the test above
  // states.
  const seeded = await seedGradedTopicFixture(email, 'Ada', subject.id, {
    name: 'division with remainders',
    rawLabel: 'Division With Remainders',
  });

  await page.getByRole('link', { name: 'Back to Parent View' }).click();
  await page
    .getByRole('navigation', { name: 'Parent View' })
    .getByRole('link', { name: 'Where a student is strong and weak' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Where a student is strong and weak', level: 1 }),
  ).toBeVisible();

  return { email, seeded };
}

test('a parent opens a weak topic from the table and reads the cost before anything fires', async ({
  page,
}) => {
  const { email, seeded } = await openMasteryWithOneTopic(page);

  // The row, and the link on it: a row that cannot be opened is a dashboard that still
  // dead-ends, which is the whole gap this story closes.
  await expect(page.getByTestId('mastery-row')).toHaveCount(1);
  await page.getByRole('link', { name: 'division with remainders' }).click();

  // The drill-down states which topic, about which child.
  const title = page.getByTestId('topic-drill-down-title');
  await expect(title).toContainText('division with remainders');
  await expect(title).toContainText('Ada');

  // The figure, never without the count it is over — and the blanks beside it, with
  // what a blank means said in words.
  await expect(page.getByTestId('topic-drill-down-figure')).toContainText('answered');
  await expect(page.getByTestId('topic-drill-down-blanks')).toContainText('left blank');
  await expect(page.getByTestId('topic-drill-down-blanks-explained')).toContainText('neither');

  // The two lists, apart: the wrong answer in one, the blank in the other.
  await expect(page.getByTestId('topic-drill-down-missed')).toBeVisible();
  await expect(page.getByTestId('topic-drill-down-unanswered')).toBeVisible();
  await expect(page.getByTestId('topic-drill-down-missed')).toContainText('Question 1');
  await expect(page.getByTestId('topic-drill-down-unanswered')).toContainText('Question 2');

  // **The cost, stated in practice tests, before the control can fire.** Three lines:
  // what this spends, what is left, and what would be left afterwards.
  const cost = page.getByTestId('topic-drill-down-cost');
  await expect(cost).toBeVisible();
  await expect(cost).toContainText('This uses 1 practice test');
  await expect(cost).toContainText('left in the Generation Allowance');
  await expect(cost).toContainText('left afterwards');

  // Nothing has fired yet: reading the evidence spends no allowance, and the parent is
  // still on the drill-down.
  const fire = page.getByTestId('topic-drill-down-fire');
  await expect(fire).toBeEnabled();
  await expect(page).toHaveURL(/\/parent\/analytics\/topics\//u);
  expect(await countGenerationJobsFor(email)).toBe(1);

  // No account plan named and nothing offered for sale.
  await expect(page.locator('body')).not.toContainText(/tier|upgrade|free plan/iu);

  // **The story's one action.** One tap, the topic already chosen, and the parent is
  // handed to the existing progress screen for the upload the API resolved.
  await fire.click();
  await expect(page).toHaveURL(new RegExp(`/parent/generate/${seeded.sourceTestId}$`, 'u'));

  // And what was actually enqueued: one more job, weighted on the Extraction's own
  // spelling of the topic. This is the only place the argument order of
  // `startGeneration(token, sourceTestId, count, weightedTopic)` is pinned by
  // consequence rather than by a substring a swap would survive — a swapped count and
  // topic could not produce this row at all.
  await expect.poll(() => countGenerationJobsFor(email), { timeout: 10_000 }).toBe(2);
  expect(await weightedTopicOfNewestJobFor(email)).toBe('Division With Remainders');
  expect(await requestedCountOfNewestJobFor(email)).toBe(1);

  // And the whole of it is behind the PIN: a reload drops the in-memory bearer and the
  // screen returns the parent to the gate rather than rendering a child\u2019s work.
  await page.reload();
  await expect(page.locator('#parent-pin')).toBeVisible();
});

/**
 * The layout swap, in its own test.
 *
 * Kept apart from the drill-down above on purpose: a test that resized mid-way and
 * resized back made a responsive regression fail a *navigation* test, which is a
 * failure pointing at the wrong thing.
 */
test('the mastery table becomes a ranked card list below the desktop breakpoint', async ({
  page,
}) => {
  await openMasteryWithOneTopic(page);

  // **Below `lg` the six-column table is `display: none`** and every topic is a card
  // carrying the same six facts, each under the column's own header as its label —
  // which is what replaced hiding four of the columns from the eye and leaving the
  // figure with no counts beside it.
  await page.setViewportSize({ width: 390, height: 844 });
  const masteryCard = page.getByTestId('mastery-card');
  await expect(masteryCard).toHaveCount(1);
  await expect(masteryCard).toBeVisible();
  await expect(masteryCard).toHaveJSProperty('tagName', 'LI');
  await expect(page.getByTestId('mastery-table')).toBeHidden();
  for (const label of ['How much is right', 'Questions answered', 'Left blank', 'Practice tests']) {
    await expect(masteryCard).toContainText(label);
  }
  // The topic is still a real link, and the card is still named by it.
  await expect(masteryCard.getByRole('link', { name: 'division with remainders' })).toBeVisible();
  await expect(masteryCard).toHaveAttribute('aria-label', 'division with remainders');
  expect(await worstSidewaysOverflow(page)).toBeLessThanOrEqual(0);

  // **Ranked, so one column at every width below the cutoff.** Weakest-first is the
  // answer this list gives, and the tablet band must not turn it into two columns.
  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(masteryCard).toBeVisible();
  await expect(page.getByTestId('mastery-table')).toBeHidden();
  const tracks = await page
    .getByTestId('mastery-cards')
    .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(/\s+/u).length);
  expect(tracks).toBe(1);

  // And the table is the layout again from 1200px up.
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.getByTestId('mastery-table')).toBeVisible();
  await expect(masteryCard).toBeHidden();
  await expect(page.getByTestId('mastery-row')).toHaveCount(1);
});
