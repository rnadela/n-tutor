import { expect, test, type Page } from '@playwright/test';
import {
  createGradeLevelFixture,
  createSubjectFixture,
  newestAttemptFixture,
  seedGradedTopicFixture,
  uniqueParentEmail,
} from '../fixtures';

/**
 * The parent's Attempt detail, paged one Question at a time.
 *
 * The claims here are **device claims** and they can live nowhere else. `apps/web`
 * runs its unit tests with `environment: 'node'`, so the clamp, the step and the
 * key-press rule are pure functions with their own spec and the screens assert over
 * their own source — but nothing there can measure a viewport, tell a persistent rail
 * from a modal, move focus, or watch the wire stay silent while a page turns.
 *
 * So this file owns exactly that, on the parent surface: that the map is a rail from
 * `md` up and an overlay below it, that Previous and Next stop where the paper does,
 * that `?q=` round-trips through a reload, that a turn fires no request at all, that
 * the way back is under every Question — and that the **analytics drill-down still
 * stacks every row**, because it is a filtered subset of evidence across runs rather
 * than one paper read in order.
 *
 * The paper is seeded rather than generated: driving upload → extract → generate →
 * release → sit → hand in through the browser would spend minutes of provider calls to
 * make three rows exist, and nothing here asserts anything about that pipeline.
 *
 * The second test owns the **deep link**, and it intercepts the Grade disputes read to
 * own it properly. Every other suite that follows an entry into a run follows one about
 * Question 1 — which is also exactly what the clamp produces for a junk `?q=`, so
 * "opens on that entry's Question" and "always opens on Question 1" are indistinguishable
 * there and the one behaviour those two lists gained could regress and ship green. A
 * crafted list is how a Question that is **not** the first, and an entry with no Question
 * at all, both become states a browser can actually be put in — the same reason
 * `student-submit-attempt.spec.ts` crafts the results read.
 */

const PASSWORD = 'correct-horse-battery-staple';
const PIN = '4821';
/** A phone, in portrait: the width the overlay form of the map is stated at. */
const PHONE = { width: 390, height: 844 };

/** Signs up, sets the PIN, adds one child, seeds one graded paper, ends in Parent View. */
async function parentWithOneGradedRun(page: Page): Promise<{
  email: string;
  topicId: string;
}> {
  const email = uniqueParentEmail('attempt-paging');
  const gradeLevel = await createGradeLevelFixture('Attempt Paging Grade');
  const subject = await createSubjectFixture('Attempt Paging Maths', gradeLevel.id);

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

  // Three Questions, graded wrong, blank and right — so the results map carries three
  // of the four grade states and no state is vacuously satisfied.
  const seeded = await seedGradedTopicFixture(email, 'Ada', subject.id, {
    name: 'division with remainders',
    rawLabel: 'Division With Remainders',
  });

  await page.getByRole('link', { name: 'Back to Parent View' }).click();
  return { email, topicId: seeded.topicId };
}

test('a parent reads one Question at a time, at both viewports', async ({ page }) => {
  test.setTimeout(180_000);
  const { topicId } = await parentWithOneGradedRun(page);

  // Every call the browser makes, counted at the wire: "a page turn fires nothing" is a
  // claim about the network, and a screen assertion would be green either way.
  const calls: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/')) calls.push(request.url());
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page
    .getByRole('navigation', { name: 'Parent View' })
    .getByRole('link', { name: 'Practice tests a student has finished' })
    .click();
  await page
    .locator('[data-testid="parent-attempt-row"]')
    .first()
    .getByRole('link', { name: 'Read it' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'The practice test, as it was marked', level: 1 }),
  ).toBeVisible();

  // --- No `q` on arrival: the clamp names the first Question, by a replace ----
  await expect(page).toHaveURL(/\/parent\/attempts\/[^?]+\?q=1$/u);
  const rows = page.locator('[data-testid="answer-key-row"]');
  await expect(rows).toHaveCount(3);
  // **Every row is mounted and all but one are hidden.** That is what preserves a
  // half-made decision across a turn, and `hidden` is what keeps the other two out of
  // the assistive-technology tree meanwhile.
  const visibleRows = page.locator('[data-testid="answer-key-row"]:not([hidden])');
  await expect(visibleRows).toHaveCount(1);
  await expect(visibleRows).toHaveAttribute('data-ordinal', '1');
  await expect(page.getByTestId('answer-key-position')).toHaveText('Question 1 of 3');
  // The score header is above the pager, stated once, and does not repeat per Question.
  await expect(page.getByTestId('parent-attempt-score')).toHaveCount(1);
  // The way back is below the pager, so it is there under every Question.
  const wayBack = page.getByRole('link', { name: 'Back to the finished practice tests' });
  await expect(wayBack).toBeVisible();

  // --- From `md` up: the map is a persistent rail ----------------------------
  const rail = page.getByTestId('answer-key-map-rail');
  await expect(rail).toBeVisible();
  await expect(page.getByTestId('answer-key-map-open')).toBeHidden();
  const cells = rail.locator('[data-testid="answer-key-map-cell"]');
  await expect(cells).toHaveCount(3);
  expect(
    await cells.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-ordinal'))),
  ).toEqual(['1', '2', '3']);
  await expect(rail.locator('[aria-current="true"]')).toHaveCount(1);
  // A legend of exactly the grade states present, and not one word of the progress
  // map's vocabulary — nor a percentage.
  const states = await cells.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-state')),
  );
  await expect(rail.locator('[data-testid="answer-key-map-legend-entry"]')).toHaveCount(
    new Set(states).size,
  );
  await expect(rail).not.toContainText(/\bAnswered\b|Not answered|%/u);
  // Every cell is a real button, so it is keyboard reachable by construction.
  expect(await cells.evaluateAll((nodes) => nodes.map((node) => node.tagName))).toEqual([
    'BUTTON',
    'BUTTON',
    'BUTTON',
  ]);

  // --- Previous and Next, and where they stop --------------------------------
  await expect(page.getByTestId('answer-key-previous')).toBeDisabled();
  await expect(page.getByTestId('answer-key-next')).toBeEnabled();

  const beforeTurns = calls.length;
  await page.getByTestId('answer-key-next').click();
  await expect(page).toHaveURL(/\?q=2$/u);
  await expect(page.getByTestId('answer-key-position')).toHaveText('Question 2 of 3');
  await expect(visibleRows).toHaveAttribute('data-ordinal', '2');
  // Focus lands on that Question's own heading, and the position is announced through
  // the surface's existing region in the very words the line displays.
  await expect(page.locator('[data-testid="answer-key-row"][data-ordinal="2"] h4')).toBeFocused();
  await expect(page.getByTestId('parent-attempt-announcement')).toHaveText('Question 2 of 3');

  // Arrow keys page, outside text entry. There is no text field anywhere on this
  // surface, so "the caret moves and the page does not turn" is asserted where it can
  // be: `shouldPageOnKey` in `apps/web/src/lib/answer-key-paging.spec.ts`, over every
  // excluded tag and every modifier.
  // **And they page on this surface at all**, which is not a given: Parent View's
  // sidebar is a permanently mounted Drawer carrying `role="dialog" aria-modal="true"`,
  // so a rule that asked the document whether any modal was open would answer "always"
  // here and leave the arrow keys dead on every parent screen.
  await expect(
    page.locator('[role="dialog"][aria-modal="true"]'),
    'the sidebar Drawer, permanently mounted',
  ).not.toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/\?q=3$/u);
  await expect(page.getByTestId('answer-key-next')).toBeDisabled();
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/\?q=3$/u);
  await page.keyboard.press('Control+ArrowLeft');
  await expect(page).toHaveURL(/\?q=3$/u);
  await page.keyboard.press('ArrowLeft');
  await expect(page).toHaveURL(/\?q=2$/u);
  await expect(wayBack).toBeVisible();

  // **Not one of those turns asked the server for anything**: the rows all arrived in
  // the read this screen already made.
  expect(calls).toHaveLength(beforeTurns);

  // --- The address bar is the carrier ---------------------------------------
  // A reload drops Parent View to the PIN gate — elevation is never persisted — so the
  // `q` is read back by paging rather than by reloading here. What a reload does to the
  // parameter is asserted on the child's surface, which has no gate.
  const attemptUrl = page.url();
  expect(attemptUrl).toContain('?q=2');

  // Back leaves the paper rather than walking it: every position was written with a
  // replace, so one press returns to the list the parent came from.
  await page.goBack();
  await expect(
    page.getByRole('heading', { name: 'Practice tests a student has finished', level: 1 }),
  ).toBeVisible();

  // --- Below `md`: the map is an overlay, closed on a jump ------------------
  await page
    .locator('[data-testid="parent-attempt-row"]')
    .first()
    .getByRole('link', { name: 'Read it' })
    .click();
  await expect(page.getByTestId('answer-key-position')).toHaveText('Question 1 of 3');
  await page.setViewportSize(PHONE);
  await expect(page.getByTestId('answer-key-map-rail')).toBeHidden();
  const opener = page.getByTestId('answer-key-map-open');
  await expect(opener).toBeVisible();
  await opener.click();

  const overlay = page.getByRole('dialog');
  await expect(overlay).toBeVisible();
  // While it is up an arrow key moves nothing: its cells are the way to a Question, and
  // a page turning behind a modal would move the thing being chosen from.
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/\?q=1$/u);
  await overlay.locator('[data-testid="answer-key-map-cell"][data-ordinal="3"]').click();
  await expect(overlay).toHaveCount(0);
  await expect(page).toHaveURL(/\?q=3$/u);
  await expect(page.getByTestId('answer-key-position')).toHaveText('Question 3 of 3');
  await expect(page.locator('[data-testid="answer-key-row"][data-ordinal="3"] h4')).toBeFocused();
  await expect(wayBack).toBeVisible();

  // --- And the analytics drill-down still stacks every row -----------------
  // It is a filtered subset of evidence across runs, which is a list rather than a
  // paper to page: no pager, no map, and every row visible at once.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('link', { name: 'Back to the finished practice tests' }).click();
  await page.getByRole('link', { name: 'Back to Parent View' }).click();
  await page
    .getByRole('navigation', { name: 'Parent View' })
    .getByRole('link', { name: 'Where a student is strong and weak' })
    .click();
  await page.getByRole('link', { name: 'division with remainders' }).click();
  await expect(page).toHaveURL(new RegExp(`/parent/analytics/topics/${topicId}`, 'u'));
  const drillRows = page.locator('[data-testid="answer-key-row"]');
  await expect(drillRows.first()).toBeVisible();
  const drillCount = await drillRows.count();
  expect(drillCount).toBeGreaterThan(0);
  await expect(page.locator('[data-testid="answer-key-row"]:not([hidden])')).toHaveCount(
    drillCount,
  );
  await expect(page.getByTestId('answer-key-pager')).toHaveCount(0);
  await expect(page.getByTestId('answer-key-map')).toHaveCount(0);
  await expect(page.getByTestId('answer-key-position')).toHaveCount(0);
});

/** The route the Grade disputes list reads, which the test below answers itself. */
const DISPUTES_ROUTE = '**/grade-disputes';

/** One dispute entry in the shape the API states, with the one field under test given. */
function craftedDispute(attemptId: string, questionOrdinal: number | null) {
  return {
    attemptId,
    questionId: `00000000-0000-4000-8000-${String(questionOrdinal ?? 9).padStart(12, '0')}`,
    disputedAt: new Date('2026-10-01T09:00:00.000Z').toISOString(),
    recordedState: 'Incorrect' as const,
    effectiveState: 'Incorrect' as const,
    overriddenAt: null,
    practiceTestId: questionOrdinal === null ? null : '00000000-0000-4000-8000-0000000000b1',
    runOrdinal: questionOrdinal === null ? null : 1,
    questionOrdinal,
    subjectName: questionOrdinal === null ? null : 'Attempt Paging Maths',
    submittedAt:
      questionOrdinal === null ? null : new Date('2026-10-01T08:00:00.000Z').toISOString(),
  };
}

test('a parent following a dispute lands on that entry’s Question', async ({ page }) => {
  test.setTimeout(180_000);
  const { email } = await parentWithOneGradedRun(page);
  const attempt = await newestAttemptFixture(email);

  // Two entries about the same run: one whose Question the API could still name, and one
  // whose context no longer resolves. The read is answered here because neither state is
  // reachable through the product in a few seconds — and the first is the one that
  // matters, because every other suite's entry is about Question 1, which is also what a
  // junk `?q=` clamps to.
  await page.route(DISPUTES_ROUTE, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([craftedDispute(attempt.id, 3), craftedDispute(attempt.id, null)]),
    });
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page
    .getByRole('navigation', { name: 'Parent View' })
    .getByRole('link', { name: 'Marks a student says are wrong' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Marks a student says are wrong', level: 1 }),
  ).toBeVisible();

  const rows = page.locator('[data-testid="parent-dispute-row"]');
  await expect(rows).toHaveCount(2);
  const known = rows.filter({ hasText: 'Run 1, question 3' });
  const unknown = rows.filter({ hasText: 'no longer available' });
  await expect(known).toHaveCount(1);
  await expect(unknown).toHaveCount(1);

  // The ordinal rides on the link, and is **absent entirely** where there is none —
  // never written as the word `null`.
  await expect(known.getByRole('link', { name: 'Read the question' })).toHaveAttribute(
    'href',
    `/parent/attempts/${attempt.id}?q=3`,
  );
  await expect(unknown.getByRole('link', { name: 'Read the question' })).toHaveAttribute(
    'href',
    `/parent/attempts/${attempt.id}`,
  );

  // --- The known ordinal: detail opens on **that** Question ----------------
  await known.getByRole('link', { name: 'Read the question' }).click();
  await expect(
    page.getByRole('heading', { name: 'The practice test, as it was marked', level: 1 }),
  ).toBeVisible();
  // Parent elevation intact: no PIN gate between the list and the run, because the
  // link is client-side and the provider holding the bearer stayed mounted (AD-18).
  await expect(page.getByRole('heading', { name: 'Enter your PIN' })).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/parent/attempts/${attempt.id}\\?q=3$`, 'u'));
  // **Question 3 and not Question 1**, which is the whole of what the link gained.
  await expect(page.getByTestId('answer-key-position')).toHaveText('Question 3 of 3');
  await expect(page.locator('[data-testid="answer-key-row"]:not([hidden])')).toHaveAttribute(
    'data-ordinal',
    '3',
  );

  // --- The null ordinal: detail opens on Question 1, and says no `null` ----
  await page.goBack();
  await expect(
    page.getByRole('heading', { name: 'Marks a student says are wrong', level: 1 }),
  ).toBeVisible();
  await unknown.getByRole('link', { name: 'Read the question' }).click();
  await expect(
    page.getByRole('heading', { name: 'The practice test, as it was marked', level: 1 }),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/parent/attempts/${attempt.id}\\?q=1$`, 'u'));
  expect(page.url()).not.toContain('q=null');
  await expect(page.getByTestId('answer-key-position')).toHaveText('Question 1 of 3');
  await expect(page.locator('[data-testid="answer-key-row"]:not([hidden])')).toHaveAttribute(
    'data-ordinal',
    '1',
  );
});
