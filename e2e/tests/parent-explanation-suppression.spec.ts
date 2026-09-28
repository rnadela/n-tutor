import { expect, test, type Page } from '@playwright/test';
import { createGradeLevelFixture, createSubjectFixture, uniqueParentEmail } from '../fixtures';

/**
 * A parent taking one explanation away from their child, and getting a replacement that
 * costs nothing.
 *
 * The claims here are **device and cross-surface claims**, and they can live nowhere else.
 * `apps/web` runs its unit tests with `environment: 'node'`, so each press rule is a pure
 * function with its own spec and each screen's spec asserts over its own source — but
 * nothing there can press through a confirmation, watch a control disappear from a *child's*
 * screen as a result, or show that an operator still sees what a parent removed. So this
 * file owns: that the removal is offered only once a concern is recorded; that the
 * confirmation states every consequence including the irreversibility *before* it fires and
 * sends nothing until it is confirmed; that there is no un-removal anywhere; that the child
 * reloads and finds the statement in place of the control, with the question, both answers,
 * the grade state, the score and every other explanation untouched; that the replacement's
 * cost is stated as nothing before it is asked for; that the child reads the replacement,
 * plainly marked as a new one; and that the operator still sees the removed explanation.
 *
 * The whole flow is driven through the real screens — sign-up, PIN, profile, upload,
 * generate, release, sit, hand in, explain, report — because the only route to a stored
 * Explanation is a child asking for one, and there is no shortcut to that which does not
 * also skip it.
 *
 * **The fake provider is deterministic per ordinal**, so the replacement's prose is
 * byte-identical to the one it replaced. "A different explanation" is therefore asserted as
 * a second entry the parent can see and the child's own "this is a new explanation" line —
 * never as different words.
 */

const PASSWORD = 'correct-horse-battery-staple';
const PIN = '4821';
const OPERATOR_EMAIL = process.env.ADMIN_SEED_EMAIL ?? 'operator@example.test';
const OPERATOR_PASSWORD = process.env.ADMIN_SEED_PASSWORD ?? 'change-me-too';

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
 * The whole parent flow, for the reason every other Explanation spec gives: there is no
 * shortcut to a released practice test that does not also skip the release.
 */
async function releaseOneTest(page: Page, email: string): Promise<void> {
  const gradeLevel = await createGradeLevelFixture('Suppression Grade');
  const subject = await createSubjectFixture('Suppression Subject', gradeLevel.id);

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

/** Opens the child's own results screen from Student Home. */
async function openChildResults(page: Page): Promise<void> {
  await page.locator('[data-testid="student-practice-test"]').first().getByRole('link').click();
  await expect(page.getByTestId('attempt-results')).toBeVisible({ timeout: 30_000 });
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

test.describe('a parent removing an explanation from their child, and replacing it for nothing', () => {
  test('removes it only after a recorded concern and a stated consequence, withholds it from the child, replaces it free, and keeps it in front of the operator', async ({
    page,
  }) => {
    test.setTimeout(420_000);
    const email = uniqueParentEmail('parent-explanation-suppression');
    await releaseOneTest(page, email);

    // Every write the browser sends, counted at the network. "Nothing is sent until the
    // confirmation is confirmed" and "one press is one call" are claims about the wire, and
    // a screen assertion would be green with either one wrong.
    const suppressionCalls: string[] = [];
    const regenerationCalls: string[] = [];
    page.on('request', (request) => {
      if (request.method() !== 'POST') return;
      if (request.url().endsWith('/explanation-suppression')) suppressionCalls.push(request.url());
      if (request.url().endsWith('/explanation-regeneration'))
        regenerationCalls.push(request.url());
    });

    // --- The child reads two explanations and reports the first -------------
    const total = await sitAndHandIn(page);
    expect(total).toBeGreaterThan(1);
    const childRows = page.locator('[data-testid="answer-key-row"]');
    await expect(childRows).toHaveCount(total);

    const prose: string[] = [];
    for (const at of [0, 1]) {
      const row = childRows.nth(at);
      await row.getByTestId('explain-control').click();
      await expect(row.getByTestId('explain-body')).toBeVisible({ timeout: 30_000 });
      prose.push((await row.getByTestId('explain-body').innerText()).trim());
      expect(prose[at]!.length).toBeGreaterThan(0);
    }
    // The first explanation was not a replacement of anything, and the child is told so by
    // the absence of a line rather than by one.
    await expect(childRows.first().getByTestId('explain-replacement')).toHaveCount(0);
    await childRows.first().getByTestId('explain-flag').click();
    await expect(childRows.first().getByTestId('explain-flagged')).toBeVisible();

    // What the child scored and what the grade states were, before a parent touches
    // anything. Read here so "nothing else changed" is a comparison and not an impression.
    const scoreBefore = await page.getByTestId('attempt-results-score').innerText();
    const gradeBefore = await childRows.first().getAttribute('data-state');
    const answerBefore = await childRows.first().getByTestId('answer-key-your-answer').innerText();
    const correctBefore = await childRows
      .first()
      .getByTestId('answer-key-correct-answer')
      .innerText();

    // --- The parent reads it, and is offered nothing until they agree -------
    await reenterParentView(page);
    await page.getByRole('link', { name: 'Explanations a student has reported' }).click();
    const flagRows = page.locator('[data-testid="parent-flag-row"]');
    await expect(flagRows).toHaveCount(1);
    await flagRows.first().getByRole('link', { name: 'Read the explanation' }).click();
    await expect(
      page.getByRole('heading', { name: 'The practice test, as it was marked', level: 1 }),
    ).toBeVisible();
    const attemptUrl = page.url();

    const parentRows = page.locator('[data-testid="answer-key-row"]');
    const review = parentRows.first().getByTestId('explanation-review');
    await expect(review).toHaveAttribute('data-student-state', 'awaiting');
    // **Locked while the child's report is awaiting a decision**, and nothing at all is
    // rendered for it: a disabled control would invite a parent to wonder what they did
    // wrong, and there is nothing they did.
    await expect(review).toHaveAttribute('data-suppression-state', 'locked');
    await expect(review.getByTestId('explanation-suppress')).toHaveCount(0);
    await expect(review.getByTestId('explanation-regenerate')).toHaveCount(0);
    // The second Question, which nobody reported, is locked too — and stays that way for
    // the whole of this test, which is what says the removal is scoped to one explanation.
    const other = parentRows.nth(1).getByTestId('explanation-review');
    await expect(other).toHaveAttribute('data-suppression-state', 'locked');

    // --- Agreeing with the child unlocks it, and does not perform it --------
    await review.getByTestId('explanation-confirm').click();
    await expect(review).toHaveAttribute('data-student-state', 'confirmed');
    await expect(review).toHaveAttribute('data-suppression-state', 'available');
    // Agreeing did not remove anything: the prose is still there, and nothing was sent.
    await expect(review.getByTestId('explanation-body')).toHaveText(prose[0]!);
    expect(suppressionCalls).toHaveLength(0);

    // --- The confirmation states every consequence before it fires ---------
    const suppress = review.getByTestId('explanation-suppress');
    await expect(suppress).toHaveText('Remove this explanation from the student');
    await suppress.focus();
    await expect(suppress).toBeFocused();
    // Reached from the keyboard alone, so "a parent can get here without a pointer" and
    // "the press opens the confirmation" are one sequence rather than two setups.
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const body = dialog.getByTestId('explanation-suppress-body');
    // Six consequences in one breath, and each is one a parent would otherwise assume the
    // other way — the irreversibility last, because it is the one that decides the press.
    await expect(body).toContainText('stops being shown to this student');
    await expect(body).toContainText('It is not deleted');
    await expect(body).toContainText('stays here for you to read');
    await expect(body).toContainText('still visible to the people reviewing');
    await expect(body).toContainText('score and the student’s progress are all unchanged');
    await expect(body).toContainText('cannot be undone');
    // **Nothing is sent by opening it**, which is the whole point of a confirmation.
    expect(suppressionCalls).toHaveLength(0);

    // Cancel leaves the explanation exactly as it was, and still sends nothing.
    await dialog.getByTestId('explanation-suppress-cancel').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(suppressionCalls).toHaveLength(0);
    await expect(review).toHaveAttribute('data-suppression-state', 'available');

    // --- And then it is confirmed ------------------------------------------
    await review.getByTestId('explanation-suppress').click();
    await page.getByRole('dialog').getByTestId('explanation-suppress-confirm').click();

    await expect(review).toHaveAttribute('data-suppression-state', 'suppressed');
    await expect(review.getByTestId('explanation-removed')).toContainText(
      'Removed from the student',
    );
    // Focus moved to the sentence that replaced the control, rather than dropping to the
    // body and out of the paper mid-list.
    await expect(review.getByTestId('explanation-removed')).toBeFocused();
    await expect(page.getByTestId('parent-attempt-announcement')).toContainText(
      'The explanation for question 1 is no longer shown to the student. This cannot be undone.',
    );
    expect(suppressionCalls).toHaveLength(1);
    // **Retained and still readable here**: it is not a deletion, and the parent who decided
    // stays able to read what they decided about.
    await expect(review.getByTestId('explanation-body')).toHaveText(prose[0]!);
    // **And there is no un-removal anywhere on the screen**, in any spelling.
    await expect(review.getByTestId('explanation-suppress')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText(/restore|undo|bring back|put back/iu);

    // --- The child reloads and finds the statement in place of the control --
    await page.getByRole('link', { name: 'Back to Parent View' }).click();
    await page.getByRole('button', { name: 'Back to Student Mode' }).click();
    await expect(page.getByRole('heading', { name: 'Your practice', level: 1 })).toBeVisible();
    await openChildResults(page);

    const afterRemoval = page.locator('[data-testid="answer-key-row"]');
    const removedRow = afterRemoval.first();
    // **The late-arrival ordering, forced.** The results screen makes two independent reads, and
    // the rows mount as soon as the answer key lands — so by the time the answer key is on
    // screen the suppression read may or may not have resolved. Asserting the key is already
    // visible *first* means the panel has certainly mounted, and what follows is therefore a
    // claim that it adopts the fact when it arrives rather than only at mount. With the prop
    // read once, in the initializer, this is exactly where `Explain this` would be drawn for a
    // Question the parent removed.
    await expect(afterRemoval).toHaveCount(total);
    await expect(removedRow.getByTestId('answer-key-prompt')).toBeVisible();
    // The statement, in the product's own words — and **no control**: no expand, no retry,
    // no report and nothing the child is told to do about it.
    await expect(removedRow.getByTestId('explain-suppressed')).toBeVisible({ timeout: 30_000 });
    await expect(removedRow.getByTestId('explain-suppressed-note')).toHaveText(
      'A parent removed this explanation. It wasn’t a good enough explanation of this question.',
    );
    // Zero, and not merely "eventually zero": if the control were drawn on mount and only
    // replaced later, this is the assertion that would catch the window in between.
    await expect(removedRow.getByTestId('explain-control')).toHaveCount(0);
    await expect(removedRow.getByTestId('explain-retry')).toHaveCount(0);
    await expect(removedRow.getByTestId('explain-flag')).toHaveCount(0);
    await expect(removedRow.getByTestId('explain-body')).toHaveCount(0);
    // And nothing parent-scoped reached the child: no reason of theirs, no decision, no
    // operator, no queue and no cost.
    await expect(page.getByTestId('attempt-results')).not.toContainText(
      /operator|queue|agreed|dismiss|confirm|allowance|tier|\$|£/iu,
    );

    // **The question, both answers, the grade state and the score are untouched**, which is
    // the claim that says a removal is one explanation and nothing else.
    await expect(removedRow).toHaveAttribute('data-state', gradeBefore!);
    await expect(removedRow.getByTestId('answer-key-your-answer')).toHaveText(answerBefore);
    await expect(removedRow.getByTestId('answer-key-correct-answer')).toHaveText(correctBefore);
    await expect(page.getByTestId('attempt-results-score')).toHaveText(scoreBefore);
    // And the other Question's explanation is exactly where it was, still readable.
    const untouched = afterRemoval.nth(1);
    await untouched.getByTestId('explain-control').click();
    await expect(untouched.getByTestId('explain-body')).toHaveText(prose[1]!, { timeout: 30_000 });

    // --- The parent replaces it, having been told the cost first ------------
    await reenterParentView(page);
    await page.goto(attemptUrl);
    const afterReload = page
      .locator('[data-testid="answer-key-row"]')
      .first()
      .getByTestId('explanation-review');
    // The removal survived a reload, which is the only proof it was written.
    await expect(afterReload).toHaveAttribute('data-suppression-state', 'suppressed', {
      timeout: 30_000,
    });

    // The cost, stated **before** the press, and stated as what it is: nothing, at every
    // plan. No figure, no tier and no number of units left.
    await expect(afterReload.getByTestId('explanation-regenerate-note')).toHaveText(
      'Writing a new explanation costs nothing. It is free on every plan, and it does not count against anything.',
    );
    await expect(page.locator('main')).not.toContainText(/allowance|tier|upgrade|\$|£/iu);
    expect(regenerationCalls).toHaveLength(0);

    await afterReload.getByTestId('explanation-regenerate').click();
    // Two entries where there was one: the removed explanation and its replacement, each
    // labelled. The fake provider is deterministic per ordinal, so "a different explanation"
    // is this second entry and not different words.
    await expect(afterReload.locator('[data-testid="explanation-generation"]')).toHaveCount(2, {
      timeout: 60_000,
    });
    expect(regenerationCalls).toHaveLength(1);
    await expect(page.getByTestId('parent-attempt-announcement')).toContainText(
      'A new explanation for question 1 is written, and the student can read it',
    );
    const generations = afterReload.locator('[data-testid="explanation-generation"]');
    // The removed one keeps its place, its prose and its removal instant; the replacement is
    // live beside it.
    await expect(generations.nth(0)).toHaveAttribute('data-removed', 'yes');
    await expect(generations.nth(0).getByTestId('explanation-removed')).toBeVisible();
    await expect(generations.nth(1)).toHaveAttribute('data-removed', 'no');
    await expect(generations.nth(1).getByTestId('explanation-generation-label')).toHaveText(
      'Explanation 2',
    );
    // And the replacement has nothing recorded against it, so it cannot be removed: a
    // concern has to be raised first, on every generation, with no carry-over.
    await expect(afterReload).toHaveAttribute('data-suppression-state', 'locked');
    await expect(afterReload.getByTestId('explanation-suppress')).toHaveCount(0);

    // --- The child reads the replacement, plainly marked as a new one -------
    await page.getByRole('link', { name: 'Back to Parent View' }).click();
    await page.getByRole('button', { name: 'Back to Student Mode' }).click();
    await expect(page.getByRole('heading', { name: 'Your practice', level: 1 })).toBeVisible();
    await openChildResults(page);

    const replaced = page.locator('[data-testid="answer-key-row"]').first();
    // The statement is gone and the control is back: the child is being served again.
    await expect(replaced.getByTestId('explain-suppressed')).toHaveCount(0);
    await replaced.getByTestId('explain-control').click();
    await expect(replaced.getByTestId('explain-body')).toBeVisible({ timeout: 30_000 });
    await expect(replaced.getByTestId('explain-replacement')).toHaveText(
      'This is a new explanation of this question.',
    );
    // And still nothing about who asked for it, why, or what it replaced.
    await expect(page.getByTestId('attempt-results')).not.toContainText(
      /parent removed|operator|queue|allowance|tier/iu,
    );
    // The score and the grade state are still exactly where they were.
    await expect(page.getByTestId('attempt-results-score')).toHaveText(scoreBefore);
    await expect(replaced).toHaveAttribute('data-state', gradeBefore!);

    // --- The operator still sees the removed explanation -------------------
    await page.goto('/admin/login');
    await page.getByLabel('Email').fill(OPERATOR_EMAIL);
    await page.getByLabel('Password').fill(OPERATOR_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Subjects & Grade Levels' })).toBeVisible();

    await page.getByRole('link', { name: 'Flagged Explanations' }).click();
    await expect(
      page.getByRole('heading', { name: 'Flagged Explanations', level: 1 }),
    ).toBeVisible();

    // Scoped to this Attempt's own rows: the queue spans every family, and other specs seed
    // their own reports, so this asserts on its own rather than on the table's size.
    const attemptId = /\/parent\/attempts\/([0-9a-f-]+)/u.exec(attemptUrl)![1]!;
    const queueRows = page.locator('[data-testid="flagged-row"]').filter({ hasText: attemptId });
    // **Still exactly one entry for it.** The parent judged it bad enough to take away from
    // their child, which is precisely the case an operator has to see — a queue that dropped
    // it would lose the strongest signal it gets.
    await expect(queueRows).toHaveCount(1);
    await expect(queueRows.first().getByTestId('flagged-body')).toHaveText(prose[0]!);
    // No child's name, no account email and no billing fact on this surface either.
    await expect(page.locator('main')).not.toContainText('Ada');
    await expect(page.locator('main')).not.toContainText(email);
    await expect(page.locator('main')).not.toContainText(/allowance|tier|gpt-|claude|\$|£/iu);
  });
});
