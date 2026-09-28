import { expect, test, type Page } from '@playwright/test';
import { createGradeLevelFixture, createSubjectFixture, uniqueParentEmail } from '../fixtures';

/**
 * A child raising a hand about an explanation, a parent deciding about it, and an operator
 * reading what the parent agreed with.
 *
 * The claims here are **device and cross-surface claims**, and they can live nowhere else.
 * `apps/web` runs its unit tests with `environment: 'node'`, so each press rule is a pure
 * function with its own spec and each screen's spec asserts over its own source — but
 * nothing there can press a control, watch prose stay put across three surfaces, or show
 * that a dismissed report never reaches an operator while a confirmed one does. So this
 * file owns: that the child's report leaves the prose and the open panel untouched and
 * survives a reload; that the parent finds it listed for that child as awaiting a decision
 * and readable in full on the Attempt; that confirming and dismissing each record once;
 * that the child is served both explanations unchanged and told nothing about either
 * decision; and that the operator's queue holds the confirmed one and not the dismissed one.
 *
 * The whole flow is driven through the real screens — sign-up, PIN, profile, upload,
 * generate, release, sit, hand in, explain — because the only route to a stored Explanation
 * is a child asking for one, and there is no shortcut to that which does not also skip it.
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
 * The whole parent flow, for the reason the hand-in and explanation specs give: there is no
 * shortcut to a released practice test that does not also skip the release.
 */
async function releaseOneTest(page: Page, email: string): Promise<void> {
  const gradeLevel = await createGradeLevelFixture('Flagging Grade');
  const subject = await createSubjectFixture('Flagging Subject', gradeLevel.id);

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

test.describe('a child saying an explanation is wrong, and what a parent does about it', () => {
  test('reports it without disturbing the prose, surfaces to the parent, and only a confirmed one reaches the operator', async ({
    page,
  }) => {
    test.setTimeout(360_000);
    const email = uniqueParentEmail('student-explanation-flagging');
    await releaseOneTest(page, email);

    // Every report the browser sends, counted at the network. "A repeat press sends
    // nothing" and "the parent's screens never report as the child" are claims about the
    // wire, and a screen assertion would be green with either one wrong.
    const studentFlagCalls: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/student/')) {
        if (request.url().endsWith('/explanation-flag')) studentFlagCalls.push(request.url());
      }
    });

    // --- The child reads two explanations and reports both ------------------
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

    const first = childRows.first();
    // What reporting does, said before it is pressed: a grown-up will read it, and nothing
    // on this screen changes.
    await expect(first.getByTestId('explain-flag-note')).toContainText(
      'A grown-up will read this explanation. Nothing here changes, so you can keep reading it.',
    );

    const flagControl = first.getByTestId('explain-flag');
    await flagControl.focus();
    await expect(flagControl).toBeFocused();
    // Reached from the keyboard alone, so "a child can get here without a pointer" and
    // "the press records the concern" are one sequence rather than two setups.
    await page.keyboard.press('Enter');

    await expect(first.getByTestId('explain-flagged')).toBeVisible();
    // **The prose stayed, and the panel stayed open.** This is the whole constraint:
    // reporting an explanation is not a retraction of it.
    await expect(first.getByTestId('explain-body')).toHaveText(prose[0]!);
    await expect(first.getByTestId('explain-panel')).toHaveAttribute('data-state', 'loaded');
    // The control is gone rather than inert: there is no un-reporting.
    await expect(first.getByTestId('explain-flag')).toHaveCount(0);
    // Announced through the surface's one live region, in the words on screen. Located by
    // `aria-atomic`, which is what tells the surface's single region from the inline
    // `role="status"` alerts a panel also draws.
    await expect(page.locator('[role="status"][aria-atomic="true"]')).toContainText(
      'A grown-up will read the explanation for question 1. Nothing here changes.',
    );
    expect(studentFlagCalls).toHaveLength(1);

    // The second Question's explanation, reported the same way — this is the one the parent
    // will dismiss, so that "confirmed reaches the operator" and "dismissed does not" are
    // told apart by the decision and not by which Question it was.
    await childRows.nth(1).getByTestId('explain-flag').click();
    await expect(childRows.nth(1).getByTestId('explain-flagged')).toBeVisible();
    await expect(childRows.nth(1).getByTestId('explain-body')).toHaveText(prose[1]!);
    expect(studentFlagCalls).toHaveLength(2);

    // --- And it survives a reload, which is the only proof it was written ---
    await page.reload();
    await expect(page.getByTestId('attempt-results')).toBeVisible({ timeout: 30_000 });
    const afterReload = page.locator('[data-testid="answer-key-row"]').first();
    await afterReload.getByTestId('explain-control').click();
    await expect(afterReload.getByTestId('explain-flagged')).toBeVisible({ timeout: 30_000 });
    await expect(afterReload.getByTestId('explain-body')).toHaveText(prose[0]!);
    // Re-opening the panel sent no second report: the state rode back on the explanation
    // response rather than on a request of its own.
    expect(studentFlagCalls).toHaveLength(2);
    // And the child is told nothing about a decision, an operator or a queue.
    await expect(page.getByTestId('attempt-results')).not.toContainText(
      /operator|queue|confirm|dismiss|agreed/iu,
    );

    // --- The parent finds both reports listed for that child ----------------
    await reenterParentView(page);
    await page.getByRole('link', { name: 'Explanations a student has reported' }).click();
    await expect(
      page.getByRole('heading', { name: 'What a student has reported', level: 1 }),
    ).toBeVisible();

    const flagRows = page.locator('[data-testid="parent-flag-row"]');
    await expect(flagRows).toHaveCount(2);
    // Both awaiting a decision, which is the absence of one.
    for (const at of [0, 1]) {
      await expect(flagRows.nth(at)).toHaveAttribute('data-disposition', 'awaiting');
      await expect(flagRows.nth(at).getByTestId('parent-flag-decision')).toHaveText(
        'Waiting for a decision',
      );
      await expect(flagRows.nth(at).getByTestId('parent-flag-where')).toContainText('Run 1');
    }
    // Newest first: the second Question was reported last.
    await expect(flagRows.first().getByTestId('parent-flag-where')).toContainText('question 2');
    // Third person about the child, and no billing fact anywhere.
    await expect(page.locator('main')).not.toContainText(/allowance|tier|upgrade|\$|£/iu);

    // --- And it is readable in full on the Attempt, where it is decided -----
    await flagRows.last().getByRole('link', { name: 'Read the explanation' }).click();
    await expect(
      page.getByRole('heading', { name: 'The practice test, as it was marked', level: 1 }),
    ).toBeVisible();
    const attemptUrl = page.url();

    const parentRows = page.locator('[data-testid="answer-key-row"]');
    const firstReview = parentRows.first().getByTestId('explanation-review');
    await expect(firstReview).toHaveAttribute('data-student-state', 'awaiting');
    // The same paragraph the child read, beneath the same Question, never a dialog and
    // never a route of its own (UX-DR16).
    await expect(firstReview.getByTestId('explanation-body')).toHaveText(prose[0]!);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(firstReview.getByTestId('explanation-student-flagged')).toContainText(
      'The student reported this explanation',
    );
    // What each decision does, said before either is pressed — including that agreeing does
    // not take the explanation away from the child.
    await expect(firstReview.getByTestId('explanation-disposition-note')).toContainText(
      'It does not remove the explanation',
    );

    // --- Confirm the first -------------------------------------------------
    const confirm = firstReview.getByTestId('explanation-confirm');
    await confirm.focus();
    await expect(confirm).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(firstReview).toHaveAttribute('data-student-state', 'confirmed');
    await expect(firstReview.getByTestId('explanation-decided')).toContainText(
      'Agreed and sent on for review',
    );
    // No control once decided: the first decision stands.
    await expect(firstReview.getByTestId('explanation-confirm')).toHaveCount(0);
    await expect(firstReview.getByTestId('explanation-dismiss')).toHaveCount(0);
    // Focus moved to the sentence that replaced the two controls, rather than dropping to
    // the body and out of the paper.
    await expect(firstReview.getByTestId('explanation-decided')).toBeFocused();
    await expect(page.getByTestId('parent-attempt-announcement')).toContainText(
      'The report about question 1 is sent on for review. The student still sees the same explanation.',
    );
    // And the prose is still there: confirming sends the report on, it does not suppress.
    await expect(firstReview.getByTestId('explanation-body')).toHaveText(prose[0]!);

    // --- Dismiss the second ------------------------------------------------
    const secondReview = parentRows.nth(1).getByTestId('explanation-review');
    await expect(secondReview).toHaveAttribute('data-student-state', 'awaiting');
    await secondReview.getByTestId('explanation-dismiss').click();
    await expect(secondReview).toHaveAttribute('data-student-state', 'dismissed');
    await expect(secondReview.getByTestId('explanation-decided')).toContainText(
      'Decided the explanation is fine',
    );
    await expect(page.getByTestId('parent-attempt-announcement')).toContainText(
      'The explanation for question 2 is decided to be fine. The student is not told.',
    );

    // Both decisions survive a reload, which is the only proof they were written.
    await page.reload();
    const reloaded = page.locator('[data-testid="answer-key-row"]');
    await expect(reloaded.first().getByTestId('explanation-review')).toHaveAttribute(
      'data-student-state',
      'confirmed',
    );
    await expect(reloaded.nth(1).getByTestId('explanation-review')).toHaveAttribute(
      'data-student-state',
      'dismissed',
    );

    // --- Both stay listed, each marked with its decision -------------------
    await page.goto('/parent/explanation-flags');
    const decided = page.locator('[data-testid="parent-flag-row"]');
    await expect(decided).toHaveCount(2);
    // A dismissal is not a deletion: it stays listed, marked dismissed.
    await expect(decided.filter({ hasText: 'Decided to be fine' })).toHaveCount(1);
    await expect(decided.filter({ hasText: 'Sent on for review' })).toHaveCount(1);

    // --- The child is served both explanations, unchanged ------------------
    await page.getByRole('link', { name: 'Back to Parent View' }).click();
    await page.getByRole('button', { name: 'Back to Student Mode' }).click();
    await expect(page.getByRole('heading', { name: 'Your practice', level: 1 })).toBeVisible();
    await openChildResults(page);

    const backOnChild = page.locator('[data-testid="answer-key-row"]');
    for (const at of [0, 1]) {
      const row = backOnChild.nth(at);
      await row.getByTestId('explain-control').click();
      // Byte for byte what they read before either decision: confirming suppressed nothing
      // and dismissing changed nothing. Story 6.4 owns suppression and it has not happened.
      await expect(row.getByTestId('explain-body')).toHaveText(prose[at]!, { timeout: 30_000 });
      await expect(row.getByTestId('explain-flagged')).toBeVisible();
    }
    // And no decision reached the child on any surface — a dismissal in particular is
    // recorded and relayed to nobody.
    await expect(page.getByTestId('attempt-results')).not.toContainText(
      /agreed|dismiss|decided|confirm/iu,
    );
    // No report left this device for any of it.
    expect(studentFlagCalls).toHaveLength(2);

    // --- The operator sees the confirmed one, and not the dismissed one -----
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
    // their own reports, so this asserts on its own two rather than on the table's size.
    const attemptId = /\/parent\/attempts\/([0-9a-f-]+)/u.exec(attemptUrl)![1]!;
    const queueRows = page.locator('[data-testid="flagged-row"]').filter({ hasText: attemptId });
    await expect(queueRows).toHaveCount(1);
    // The confirmed one, raised by the student route — which is the fact that says a child
    // was involved.
    await expect(queueRows.first().getByTestId('flagged-body')).toHaveText(prose[0]!);
    await expect(queueRows.first().getByTestId('flagged-raised-by')).toHaveText('Student');
    await expect(queueRows.first().getByTestId('flagged-raised-at')).toContainText('First raised');
    // And the dismissed one is nowhere in the queue at all: the parent read the same prose
    // and judged it fine, so it never reaches an operator.
    await expect(page.locator('main')).not.toContainText(prose[1]!);
    // No child's name, no account email and no billing fact on this surface either.
    await expect(page.locator('main')).not.toContainText('Ada');
    await expect(page.locator('main')).not.toContainText(email);
    await expect(page.locator('main')).not.toContainText(/allowance|tier|gpt-|claude|\$|£/iu);
  });
});
