import { expect, test, type Page } from '@playwright/test';
import { createGradeLevelFixture, createSubjectFixture, uniqueParentEmail } from '../fixtures';

/**
 * Asking why, end to end.
 *
 * The claims here are **device claims**, and they can live nowhere else.
 * `apps/web` runs its unit tests with `environment: 'node'`, so the decision a
 * press makes is a pure function with its own spec and the panel's own spec
 * asserts over its source — but nothing there can press a control, watch the wire
 * or tell an open disclosure from a closed one. So this file owns: that a press
 * opens the panel and generates once, that collapsing and re-expanding generates
 * nothing at all, that a keyboard reaches the control, and that a failed
 * explanation leaves the whole results screen working.
 *
 * The practice test is generated and released through the real parent flow and sat
 * through the real binding, because a released test is the only thing a child can
 * open and there is no shortcut to a handed-in Attempt that does not also skip the
 * hand-in.
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
 * Signs a parent up, adds one child, uploads two pages, generates one practice
 * test and releases it — then leaves the page on Student Home, bound to that child.
 *
 * The whole parent flow, for the reason the hand-in spec gives: there is no
 * shortcut to a released practice test that does not also skip the release.
 */
async function releaseOneTest(page: Page, email: string): Promise<void> {
  const gradeLevel = await createGradeLevelFixture('Explain Grade');
  const subject = await createSubjectFixture('Explain Subject', gradeLevel.id);

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

test.describe('asking why an answer is the answer', () => {
  test('explains a Question in place, once, and keeps the results usable when it cannot', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const email = uniqueParentEmail('explanations');
    await releaseOneTest(page, email);

    // Every explanation request the browser makes, counted at the network. "Nothing
    // was dispatched" and "exactly one generation went out" are claims about the
    // wire, and a screen assertion would be green with either one wrong.
    const asks: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/explanation')) asks.push(request.url());
    });

    const total = await sitAndHandIn(page);
    expect(total).toBeGreaterThan(1);

    const rows = page.locator('[data-testid="answer-key-row"]');
    await expect(rows).toHaveCount(total);
    const firstRow = rows.first();
    const secondRow = rows.nth(1);

    // --- Nothing is asked for until somebody presses -----------------------
    // The first ask bills a provider call. A screen that prefetched would bill one
    // per Question, per visit, with nobody having asked for any of them.
    await expect(firstRow.getByTestId('explain-panel')).toHaveCount(0);
    expect(asks).toHaveLength(0);

    // --- The control is a disclosure, and says so --------------------------
    const control = firstRow.getByTestId('explain-control');
    await expect(control).toBeVisible();
    await expect(control).toHaveAttribute('aria-expanded', 'false');
    // Collapsed, the panel is not in the tree, so the control names no panel:
    // `aria-controls` pointing at an absent id is read inconsistently.
    expect(await control.getAttribute('aria-controls')).toBeNull();

    // --- One press: it opens, it asks once, and the prose arrives in place --
    await control.click();
    await expect(control).toHaveAttribute('aria-expanded', 'true');
    const panelId = await control.getAttribute('aria-controls');
    expect(panelId).not.toBeNull();
    const panel = firstRow.getByTestId('explain-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('id', panelId!);
    await expect(firstRow.getByTestId('explain-body')).toBeVisible({ timeout: 30_000 });
    const prose = await firstRow.getByTestId('explain-body').innerText();
    expect(prose.trim().length).toBeGreaterThan(0);
    expect(asks).toHaveLength(1);

    // It is **beneath its own Question**, inside that row — never a dialog and never
    // a route (UX-DR16). The paper, both answers and the reason are on screen
    // together, and the URL did not move.
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(firstRow.getByTestId('answer-key-prompt')).toBeVisible();
    await expect(firstRow.getByTestId('answer-key-correct-answer')).toBeVisible();

    // And it said so out loud, with the sentence that is displayed beside it.
    await expect(firstRow.getByTestId('explain-ready')).toHaveText(/question 1/u);

    // --- Collapse and re-expand: nothing is generated a second time --------
    await control.click();
    await expect(control).toHaveAttribute('aria-expanded', 'false');
    await expect(firstRow.getByTestId('explain-panel')).toHaveCount(0);
    await control.click();
    await expect(firstRow.getByTestId('explain-body')).toHaveText(prose);
    expect(asks).toHaveLength(1);

    // --- A failure leaves the whole results screen working -----------------
    // On a Question nothing has explained yet, and reached **from the keyboard
    // alone** — so "a person can get here without a pointer" and "a bad minute
    // stays inside this panel" are one sequence rather than two setups. The fault
    // is forced at the wire rather than by breaking the server, so the case is
    // about what the screen does with it and nothing else.
    await page.route('**/explanation', (route) => route.abort());
    const secondControl = secondRow.getByTestId('explain-control');
    await secondControl.focus();
    await expect(secondControl).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(secondControl).toHaveAttribute('aria-expanded', 'true');

    const note = secondRow.getByTestId('explain-note');
    await expect(note).toBeVisible({ timeout: 30_000 });
    await expect(note).toHaveText('This explanation could not be written just now.');
    // It says what did not happen, and nothing about why: no code, no provider, no
    // model and no allowance figure.
    await expect(note).not.toContainText(/error|\d{3}|gpt|claude|allowance|tier/iu);

    // Everything else is exactly where it was. The score, the answer key, every
    // other row and the explanation already open are untouched.
    await expect(page.getByTestId('attempt-results-score')).toBeVisible();
    await expect(rows).toHaveCount(total);
    await expect(firstRow.getByTestId('explain-body')).toHaveText(prose);

    // The retry is a person pressing, and it is the only thing that asks again.
    const retry = secondRow.getByTestId('explain-retry');
    await expect(retry).toBeVisible();
    const afterFailure = asks.length;
    // Left alone for a moment, nothing re-asks on its own: no timer, no poll, no
    // backoff.
    await page.waitForTimeout(2_000);
    expect(asks).toHaveLength(afterFailure);

    await page.unroute('**/explanation');
    await retry.click();
    await expect(secondRow.getByTestId('explain-body')).toBeVisible({ timeout: 30_000 });
    expect(asks.length).toBe(afterFailure + 1);
    // Two Questions, two explanations, and each one under its own row.
    expect(await secondRow.getByTestId('explain-body').innerText()).not.toBe(prose);

    // --- And nothing about billing ever reaches the child ------------------
    const results = page.getByTestId('attempt-results');
    await expect(results).not.toContainText(/allowance|unlimited|upgrade|gpt-|claude|\$|£/iu);
  });

  test('says so plainly when the plan is spent, and when there is no connection', async ({
    page,
  }) => {
    // The two refusals the child can do nothing about, at the only tier that can
    // see them: a browser. The cap is forced at the wire rather than by spending a
    // real allowance -- the API's own spec owns the 409, this owns what the screen
    // does with it -- and the sentence asserted is the server's, because the panel
    // renders that sentence rather than restating it.
    test.setTimeout(300_000);
    const email = uniqueParentEmail('explain-refusals');
    await releaseOneTest(page, email);

    const asks: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/explanation')) asks.push(request.url());
    });

    await sitAndHandIn(page);
    const rows = page.locator('[data-testid="answer-key-row"]');
    const firstRow = rows.first();
    const secondRow = rows.nth(1);

    // --- At the cap: the plan is spent, and it is the plan that is spent ----
    const capSentence =
      'That is every explanation your plan includes for this period. It resets at the start of the next one.';
    await page.route('**/explanation', (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ message: capSentence, statusCode: 409 }),
      }),
    );
    await firstRow.getByTestId('explain-control').click();
    const capNote = firstRow.getByTestId('explain-note');
    await expect(capNote).toBeVisible({ timeout: 30_000 });
    // The server's own sentence reaches the child, wrapped rather than restated,
    // and the blame is on the plan.
    await expect(capNote).toContainText('resets at the start of the next one');
    await expect(capNote).not.toContainText(/\d|tier|upgrade|allowance|\$|£/iu);
    // Nothing was written, so nothing above the panel moved.
    await expect(page.getByTestId('attempt-results-score')).toBeVisible();
    await expect(firstRow.getByTestId('answer-key-prompt')).toBeVisible();

    // --- With no connection: nothing is even sent --------------------------
    await page.unroute('**/explanation');
    await page.context().setOffline(true);
    const before = asks.length;
    await secondRow.getByTestId('explain-control').click();
    const offlineNote = secondRow.getByTestId('explain-note');
    await expect(offlineNote).toBeVisible();
    // A different sentence from the failure and from the cap, and no request at
    // all: a press with no connection is not a failed request.
    await expect(offlineNote).not.toHaveText(await capNote.innerText());
    await expect(offlineNote).not.toHaveText('This explanation could not be written just now.');
    expect(asks).toHaveLength(before);

    // And back: the same panel, one manual press, and the prose arrives.
    await page.context().setOffline(false);
    await secondRow.getByTestId('explain-retry').click();
    await expect(secondRow.getByTestId('explain-body')).toBeVisible({ timeout: 30_000 });
    expect(asks.length).toBe(before + 1);
  });
});
