import { expect, test, type Page } from '@playwright/test';
import { createGradeLevelFixture, createSubjectFixture, uniqueParentEmail } from '../fixtures';

/**
 * A child saying a mark is wrong, and a parent setting it.
 *
 * The claims here are **device and cross-surface claims**, and they can live nowhere else.
 * `apps/web` runs its unit tests with `environment: 'node'`, so each press rule is a pure
 * function with its own spec and each screen's spec asserts over its own source — but nothing
 * there can press a control, watch a score change on two surfaces at once, or show that the
 * reason a parent reads never appears on the child's screen. So this file owns: that the
 * child's objection changes no mark and survives a reload; that the parent finds it listed for
 * that child as awaiting a decision and readable on the run; that the recorded mark and its
 * reason are still there after an adjustment; that the mark and the score move together and
 * are stated as a change rather than one figure replacing another; that the child sees the new
 * mark and one plain line and never the reason or the workings; and that the dispute stays
 * listed, marked resolved.
 *
 * The whole flow is driven through the real screens — sign-up, PIN, profile, upload, generate,
 * release, sit, hand in — because the only route to a graded Attempt is a child sitting one,
 * and there is no shortcut to that which does not also skip the grading.
 */

const PASSWORD = 'correct-horse-battery-staple';
const PIN = '4821';

/**
 * The idle window, read from the same expression `playwright.config.ts` reads — and
 * `PAST_THE_WINDOW` is comfortably more than one of them and comfortably less than two.
 *
 * Only the **browser's** clock is ever moved with these. The server's runs at real speed,
 * which is exactly the case FR-35 is about: a parent whose Parent View ended while the
 * decision they had picked and not saved is perfectly alive server-side.
 *
 * Both are `parent-uncommitted-state.spec.ts`'s, deliberately: this suite drives the same
 * real expiry, and the two must not drift into asserting against different journeys.
 */
const WINDOW_MS = Number(process.env.ELEVATION_TTL_SECONDS ?? '900') * 1000;
const PAST_THE_WINDOW = Math.ceil(WINDOW_MS * 1.1);

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
 * The whole parent flow, for the reason the hand-in and flagging specs give: there is no
 * shortcut to a released practice test that does not also skip the release.
 */
async function releaseOneTest(page: Page, email: string): Promise<void> {
  const gradeLevel = await createGradeLevelFixture('Dispute Grade');
  const subject = await createSubjectFixture('Dispute Subject', gradeLevel.id);

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

function parentViewHeading(page: Page) {
  return page.getByRole('heading', { name: 'Parent View', level: 1, exact: true });
}

/** Crosses the PIN gate from Student Mode and lands inside Parent View. */
async function crossThePin(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Parent' }).click();
  await expect(page.getByRole('heading', { name: 'Enter your PIN' })).toBeVisible();
  await page.locator('#parent-pin').fill(PIN);
  await page.getByRole('button', { name: 'Enter Parent View' }).click();
  await expect(parentViewHeading(page)).toBeVisible();
}

/**
 * Installs the browser's own clock, lands on Student Home and crosses the PIN.
 *
 * **The clock goes in before the crossing, not after**, because the idle window is a
 * timer the elevation provider schedules when it mounts: one installed afterwards would
 * leave that timer on the real clock, and `fastForward` would move a clock nothing was
 * watching. `parent-uncommitted-state.spec.ts` does it in this order for this reason.
 *
 * The `goto` here is the one this file makes on purpose. Everything after the crossing is
 * a click, because the elevation token lives in memory (AD-18) — a full navigation
 * unmounts the provider holding it and lands back on the PIN, which would make a
 * navigation look like an expiry.
 */
async function enterParentViewOnAFakeClock(page: Page): Promise<void> {
  await page.clock.install();
  // **Installed, then let run.** `install` leaves the clock paused, and a frozen clock
  // stalls the MUI transitions this leg clicks through — which is why
  // `parent-uncommitted-state.spec.ts` does its whole setup before installing one. This
  // suite cannot: the pick has to be made *inside* Parent View. So the clock is faked from
  // the mount, which is what makes the idle timer a fake timer, and then resumed so it
  // ticks at real speed until the one moment this test moves it.
  await page.clock.resume();
  await page.goto('/student');
  await expect(page.getByRole('heading', { name: 'Your practice', level: 1 })).toBeVisible();
  await crossThePin(page);
}

/** Parent View → the disputes list → the run one dispute points at. */
async function openTheDisputedRun(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Marks a student says are wrong' }).click();
  await expect(
    page.getByRole('heading', { name: 'Marks a student says are wrong', level: 1 }),
  ).toBeVisible();
  await page
    .locator('[data-testid="parent-dispute-row"]')
    .first()
    .getByRole('link', { name: 'Read the question' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'The practice test, as it was marked', level: 1 }),
  ).toBeVisible();
}

test.describe('a child saying a mark is wrong, and the parent who sets it', () => {
  test('records the objection, surfaces it, and moves the mark and the score together', async ({
    page,
  }) => {
    test.setTimeout(360_000);
    const email = uniqueParentEmail('student-grade-dispute');
    await releaseOneTest(page, email);

    // Every objection the browser sends, counted at the network. "A repeat press sends
    // nothing" and "re-opening sends nothing" are claims about the wire, and a screen
    // assertion would be green with either one wrong.
    const disputeCalls: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/grade-dispute')) {
        disputeCalls.push(request.url());
      }
    });

    // --- The child hands in and objects to one mark -------------------------
    const total = await sitAndHandIn(page);
    expect(total).toBeGreaterThan(1);
    const childRows = page.locator('[data-testid="answer-key-row"]');
    await expect(childRows).toHaveCount(total);

    // The score before anything is adjusted, and no change line: null prior score is the
    // whole of "nothing was adjusted", so the sentence is simply not there.
    const scoreBefore = (await page.getByTestId('attempt-results-score').innerText()).trim();
    await expect(page.getByTestId('attempt-results-score-change')).toHaveCount(0);

    const first = childRows.first();
    // The first row is one the marking judged, which is what makes it adjustable at all.
    const firstState = await first.getAttribute('data-state');
    expect(['Correct', 'Incorrect']).toContain(firstState);

    // What the press does, said before it is pressed: a grown-up will look, and nothing here
    // changes until they do.
    await expect(first.getByTestId('dispute-note')).toHaveText(
      'A grown-up will look at this question. Nothing changes here until they do.',
    );

    const control = first.getByTestId('dispute-control');
    await control.focus();
    await expect(control).toBeFocused();
    // Reached from the keyboard alone, so "a child can get here without a pointer" and "the
    // press records the objection" are one sequence rather than two setups.
    await page.keyboard.press('Enter');

    await expect(first.getByTestId('dispute-reported')).toBeVisible();
    // **The mark and the score stayed exactly where they were.** This is the whole
    // constraint: an objection is a record, and only a grown-up can set a mark.
    await expect(first).toHaveAttribute('data-state', firstState!);
    await expect(page.getByTestId('attempt-results-score')).toHaveText(scoreBefore);
    await expect(page.getByTestId('attempt-results-score-change')).toHaveCount(0);
    // The control is gone rather than inert: there is no un-saying.
    await expect(first.getByTestId('dispute-control')).toHaveCount(0);
    // Announced through the surface's one live region, in the words on screen. Located by
    // `aria-atomic`, which tells the surface's single region from the inline `role="status"`
    // notices a panel also draws.
    await expect(page.locator('[role="status"][aria-atomic="true"]')).toContainText(
      'A grown-up will look at question 1. Nothing changes here until they do.',
    );
    expect(disputeCalls).toHaveLength(1);

    // --- And it survives a reload, which is the only proof it was written ---
    await page.reload();
    await expect(page.getByTestId('attempt-results')).toBeVisible({ timeout: 30_000 });
    await expect(
      page.locator('[data-testid="answer-key-row"]').first().getByTestId('dispute-reported'),
    ).toBeVisible();
    // The reported state rode back on the results read rather than on a request of its own.
    expect(disputeCalls).toHaveLength(1);
    // And the child is told nothing about the workings on any of it.
    await expect(page.getByTestId('attempt-results')).not.toContainText(
      /rationale|reason it was marked|override|\bAI\b/iu,
    );

    // --- The parent finds it listed for that child --------------------------
    // On a fake clock from here, because the retained-pick round trip below drives the real
    // idle expiry and the timer that ends Parent View is scheduled when the provider mounts.
    await enterParentViewOnAFakeClock(page);
    await page.getByRole('link', { name: 'Marks a student says are wrong' }).click();
    await expect(
      page.getByRole('heading', { name: 'Marks a student says are wrong', level: 1 }),
    ).toBeVisible();

    const disputeRows = page.locator('[data-testid="parent-dispute-row"]');
    await expect(disputeRows).toHaveCount(1);
    // Awaiting, which is the absence of a decision rather than a value somebody wrote.
    await expect(disputeRows.first()).toHaveAttribute('data-outcome', 'awaiting');
    await expect(disputeRows.first().getByTestId('parent-dispute-outcome')).toHaveText(
      'Waiting for you to decide',
    );
    // Where it was, both figures the server's.
    await expect(disputeRows.first().getByTestId('parent-dispute-where')).toContainText(
      'Run 1, question 1',
    );
    // What the marking recorded, which is what the child objected to.
    await expect(disputeRows.first().getByTestId('parent-dispute-recorded')).toContainText(
      'Recorded as',
    );
    // No billing fact and no Mastery figure on a plain list screen. `.first()` because
    // Parent View's layout is itself a `main` and every screen nests its own column
    // inside it — the outer one contains the inner, so this is the wider claim.
    await expect(page.locator('main').first()).not.toContainText(
      /allowance|tier|upgrade|mastery|\$|£/iu,
    );

    // --- And the reason is read on the run, where the mark is set -----------
    await disputeRows.first().getByRole('link', { name: 'Read the question' }).click();
    await expect(
      page.getByRole('heading', { name: 'The practice test, as it was marked', level: 1 }),
    ).toBeVisible();

    const parentRows = page.locator('[data-testid="answer-key-row"]');
    const review = parentRows.first().getByTestId('grade-review');
    await expect(review).toHaveAttribute('data-disputed', 'true');
    await expect(review).toHaveAttribute('data-adjusted', 'false');
    await expect(review.getByTestId('grade-review-disputed')).toContainText(
      'The student said this is marked wrong',
    );
    // Leaving the mark alone is a legitimate answer, and the screen says so rather than
    // pressing the parent.
    await expect(review.getByTestId('grade-review-dispute-awaiting')).toContainText(
      'leave it as it is',
    );
    // The reason is collapsed until it is asked for — a paragraph per question, and twenty
    // open at once is a screen a parent cannot scan.
    await expect(review.getByTestId('grade-review-reason')).toHaveCount(0);
    await review.getByTestId('grade-review-reason-control').click();
    await expect(review.getByTestId('grade-review-reason')).toBeVisible();
    const reason = (await review.getByTestId('grade-review-reason').innerText()).trim();
    expect(reason.length).toBeGreaterThan(0);
    // Inline, beneath the Question it is about — never a dialog and never a route of its own.
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // Every consequence, before the mark is set.
    await expect(review.getByTestId('grade-review-note')).toContainText('recalculates the score');
    await expect(review.getByTestId('grade-review-note')).toContainText('never the reason');
    const parentScoreBefore = (await page.getByTestId('parent-attempt-score').innerText()).trim();
    const attemptUrl = page.url();

    // --- The parent picks the other mark ------------------------------------
    // A picked mark is not a saved one: the control picks, and an explicit save commits.
    await review.getByTestId('grade-review-control').click();
    await expect(review.getByTestId('grade-review-save')).toBeVisible();
    // And it is reversible, because a pick is a step and not a decision: a mis-press must
    // not be escapable only by saving the wrong mark.
    await expect(review.getByTestId('grade-review-cancel')).toBeVisible();
    await expect(review).toHaveAttribute('data-adjusted', 'false');
    await expect(page.getByTestId('parent-attempt-score')).toHaveText(parentScoreBefore);

    // --- Parent View expires with the pick unsaved, and the pick survives ---
    // FR-35, end to end. Nothing is touched: no pointer, no key, no scroll. The window
    // lapses and the device goes back to the child it was already bound to.
    await page.clock.fastForward(PAST_THE_WINDOW);
    await expect(page.getByRole('heading', { name: 'Your practice', level: 1 })).toBeVisible();

    // The browser's clock was run ahead of the server's; they go back in step before the
    // PIN gate, whose figures are the server's.
    await page.clock.setSystemTime(new Date());
    await page.clock.resume();

    await crossThePin(page);
    await openTheDisputedRun(page);

    const returned = page
      .locator('[data-testid="answer-key-row"]')
      .first()
      .getByTestId('grade-review');
    // **The picked mark is still offered, and still unsaved.** The Save control is what
    // says the pick came back; `data-adjusted` is what says it was never committed.
    await expect(returned.getByTestId('grade-review-save')).toBeVisible({ timeout: 30_000 });
    await expect(returned).toHaveAttribute('data-adjusted', 'false');
    // Named as what it is, so a parent is not left wondering why a control is already
    // chosen after crossing a PIN.
    await expect(returned.getByTestId('grade-review-restored')).toBeVisible();
    // And the score has not moved: nothing was written by any of this.
    await expect(page.getByTestId('parent-attempt-score')).toHaveText(parentScoreBefore);

    // **The reason was re-read from the run, not retained.** The region is a fresh mount,
    // so the disclosure is closed again — which is the only state a component that kept no
    // copy of the prose could be in — and opening it shows the same words the server sent.
    await expect(returned.getByTestId('grade-review-reason')).toHaveCount(0);
    await returned.getByTestId('grade-review-reason-control').click();
    await expect(returned.getByTestId('grade-review-reason')).toHaveText(reason);

    // --- And now it is saved ------------------------------------------------
    const save = returned.getByTestId('grade-review-save');
    await save.focus();
    await expect(save).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(returned).toHaveAttribute('data-adjusted', 'true');
    // **The recorded mark and its reason are still there.** This is the requirement: the
    // adjustment is a column beside the verdict and never an edit of it.
    await expect(returned.getByTestId('grade-review-recorded')).toContainText('Recorded as');
    // No second press: the disclosure is component state and the save re-rendered the row
    // around it, so the reason a parent was reading is still open and still the same words.
    await expect(returned.getByTestId('grade-review-reason')).toHaveText(reason);
    await expect(returned.getByTestId('grade-review-adjusted')).toContainText('You set this mark');
    // Focus moved to the sentence that replaced the control, rather than dropping to the body
    // and out of the paper.
    await expect(returned.getByTestId('grade-review-adjusted')).toBeFocused();
    // The pick is committed, so there is nothing left to put back.
    await expect(returned.getByTestId('grade-review-cancel')).toHaveCount(0);
    // The row reads parent-adjusted, in words.
    await expect(parentRows.first().getByTestId('answer-key-row-parent-adjusted')).toHaveText(
      'A parent set this mark.',
    );
    // **The mark and the score moved together**, and the score is stated as a change rather
    // than one figure replacing another.
    const parentScoreAfter = (await page.getByTestId('parent-attempt-score').innerText()).trim();
    expect(parentScoreAfter).not.toBe(parentScoreBefore);
    expect(parentScoreAfter).toContain('adjusted by parent to');
    await expect(page.getByTestId('parent-attempt-announcement')).toContainText(
      'the score is recalculated',
    );

    // --- The dispute stays listed, marked resolved, and the mark stayed set -
    // **Every step from here is a click.** The elevation token lives in memory (AD-18), so a
    // `goto` or a reload would unmount the provider holding it and land back on the PIN —
    // which would make a navigation indistinguishable from an expiry. Leaving the run and
    // coming back to it through the list is a fresh read of both screens either way, which
    // is the whole of what "it outlived the screen it was made on" needs.
    await page.getByRole('link', { name: 'Back to the finished practice tests' }).click();
    await page.getByRole('link', { name: 'Back to Parent View' }).click();
    await expect(parentViewHeading(page)).toBeVisible();
    await page.getByRole('link', { name: 'Marks a student says are wrong' }).click();
    const resolved = page.locator('[data-testid="parent-dispute-row"]');
    await expect(resolved).toHaveCount(1);
    // Still listed: a resolved objection is not a deleted one.
    await expect(resolved.first()).toHaveAttribute('data-outcome', 'resolved');
    await expect(resolved.first().getByTestId('parent-dispute-outcome')).toContainText(
      'You set this mark',
    );
    // The record of what was objected to, beside what counts now. The *resolution* is the
    // override existing at all — which is why `data-outcome` above reads off
    // `overriddenAt` and not off these two states: a parent who set a mark and set it back
    // decided twice and would leave the pair equal. These two say what the decision came
    // to, not whether one was made.
    await expect(resolved.first().getByTestId('parent-dispute-recorded')).toContainText(
      'Recorded as',
    );
    await expect(resolved.first().getByTestId('parent-dispute-effective')).toContainText('Marked');

    // Back on the run itself, reached from the entry: the adjustment outlived the screen it
    // was made on, which is the only proof it was written.
    await resolved.first().getByRole('link', { name: 'Read the question' }).click();
    await expect(page).toHaveURL(attemptUrl);
    await expect(page.getByTestId('parent-attempt-score')).toContainText('adjusted by parent to', {
      timeout: 30_000,
    });
    await expect(
      page.locator('[data-testid="answer-key-row"]').first().getByTestId('grade-review'),
    ).toHaveAttribute('data-adjusted', 'true');

    // --- Back in Student Mode: the new mark, one plain line, and no workings
    // The way out is in the Parent View layout, so it is reachable from the run itself.
    await page.getByRole('button', { name: 'Back to Student Mode' }).click();
    await expect(page.getByRole('heading', { name: 'Your practice', level: 1 })).toBeVisible();
    await openChildResults(page);

    const backOnChild = page.locator('[data-testid="answer-key-row"]').first();
    // The effective mark is the child's mark: a results screen still showing the marking's
    // own verdict would be telling a child their parent's decision did not happen.
    const adjustedState = firstState === 'Correct' ? 'Incorrect' : 'Correct';
    await expect(backOnChild).toHaveAttribute('data-state', adjustedState);
    // One plain line, and it does not say which way the mark moved.
    await expect(backOnChild.getByTestId('answer-key-row-parent-adjusted')).toHaveText(
      'A grown-up looked at this question and set the mark.',
    );
    // The score as a change, so a figure that moved between two visits is legible rather
    // than alarming.
    const childScoreAfter = (await page.getByTestId('attempt-results-score').innerText()).trim();
    expect(childScoreAfter).not.toBe(scoreBefore);
    await expect(page.getByTestId('attempt-results-score-change')).toContainText(
      'after a grown-up looked at it',
    );
    // The objection is still shown as theirs.
    await expect(backOnChild.getByTestId('dispute-reported')).toBeVisible();
    // **And nothing of the parent's side reached them.** Not the reason, not the recorded
    // mark, not who decided, not when, and no billing fact.
    const childText = await page.getByTestId('attempt-results').innerText();
    expect(childText).not.toContain(reason);
    await expect(page.getByTestId('attempt-results')).not.toContainText(
      /recorded as|override|\bAI\b|allowance|tier|upgrade/iu,
    );
    // No objection left this device for any of it.
    expect(disputeCalls).toHaveLength(1);

    // The run is still reachable by its own address, unchanged by any of the above.
    expect(attemptUrl).toContain('/parent/attempts/');
  });
});
