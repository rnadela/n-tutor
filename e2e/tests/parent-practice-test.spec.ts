import { expect, test, type Page } from '@playwright/test';
import {
  chargeGenerationAllowanceFixture,
  countPracticeTestsFor,
  createGradeLevelFixture,
  createSubjectFixture,
  setParentTierFixture,
  uniqueParentEmail,
} from '../fixtures';

const PASSWORD = 'correct-horse-battery-staple';
const PIN = '4821';

/**
 * Two real JPEGs, as `parent-capture.spec.ts` carries them: small enough to
 * live here, and embedded rather than read off disk so the suite carries no
 * binary fixtures.
 */
const PAGE_A =
  '/9j/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAgABgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAUG/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AhAJzYgAAAAAP/9k=';
const PAGE_B =
  '/9j/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAgABgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAUG/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AggNOlgAAAAAP/9k=';

function jpeg(name: string, base64: string) {
  return { name, mimeType: 'image/jpeg', buffer: Buffer.from(base64, 'base64') };
}

/** The one polite live region the surface mounts. */
function liveRegion(page: Page) {
  return page.locator('[role="status"][aria-live="polite"]');
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

/**
 * Takes a parent all the way to a committed upload whose Extraction has
 * finished: signed up, past the PIN, one child, two photographed pages,
 * classified and submitted.
 *
 * Every step goes through the browser rather than the database, because what is
 * being proved here is that the Extraction the generator reads is the one the
 * real pipeline wrote.
 */
async function uploadAndRead(page: Page, email: string): Promise<void> {
  const gradeLevel = await createGradeLevelFixture('Generate Grade');
  const subject = await createSubjectFixture('Generate Subject', gradeLevel.id);

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
  // The job outlives the request that enqueued it, so this waits on the worker.
  await expect(page.getByRole('button', { name: 'Continue to practice test' })).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * Crosses the thin-Extraction gate, which the fake's density always trips.
 *
 * `expect(...).toBeVisible()` rather than `if (await warning.isVisible())`:
 * that one does not wait, so the dialog opening a frame later would be missed,
 * the continue would never be clicked, and the URL assertion below would fail
 * intermittently for a reason that has nothing to do with generation. The
 * warning is *expected* here — two pages at one usable question each is
 * exactly the case Story 3.6's threshold exists for — so it is waited for.
 */
async function enterGenerate(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Continue to practice test' }).click();
  const warning = page.getByRole('dialog');
  await expect(warning).toBeVisible();
  await warning.getByRole('button', { name: 'Continue anyway' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(/\/parent\/generate\//);
  await expect(page.getByRole('heading', { name: 'Generate practice tests' })).toBeVisible();
}

/** One count's radio row, by the count it offers. */
function countRow(page: Page, count: number) {
  return page.locator(`[data-testid="generate-count-option"][data-count="${count}"]`);
}

test.describe('generating practice tests', () => {
  test('bounds the choice, states the cost, and produces the drafts', async ({ page }) => {
    const email = uniqueParentEmail('generate');
    await uploadAndRead(page, email);
    await enterGenerate(page);

    // Free tier: two of the allowance, against a per-request ceiling of five.
    // Counts one and two are offered; three, four and five are on screen,
    // disabled, with the reason stated beside each — never trimmed away.
    await expect(page.getByTestId('generate-usage')).toHaveText('Used this period: 0 of 2.');
    await expect(page.locator('[data-testid="generate-count-option"]')).toHaveCount(5);
    for (const count of [1, 2]) {
      await expect(countRow(page, count).getByRole('radio')).toBeEnabled();
    }
    for (const count of [3, 4, 5]) {
      await expect(countRow(page, count).getByRole('radio')).toBeDisabled();
    }
    // The reason is stated once for the group, not repeated beside each of the
    // three counts, and every disabled radio is described by it — a disabled
    // control is not focusable, so a sentence merely next to it is unreachable.
    await expect(page.getByTestId('generate-count-reason')).toHaveText(
      'Only 2 practice tests are left in this period’s Generation Allowance.',
    );
    for (const count of [3, 4, 5]) {
      await expect(countRow(page, count).getByRole('radio')).toHaveAttribute(
        'aria-describedby',
        'generate-count-reason',
      );
    }

    // The cost is on screen before the confirm control is ever reached, in
    // practice tests, naming both what is spent and what is left.
    await expect(page.getByTestId('generate-cost')).toHaveText(
      'This uses 2 practice tests of the Generation Allowance. 0 will be left this period.',
    );

    await countRow(page, 1).getByRole('radio').check();
    await expect(page.getByTestId('generate-cost')).toHaveText(
      'This uses 1 practice test of the Generation Allowance. 1 will be left this period.',
    );

    // And again in the confirmation, which is the last thing read before the
    // allowance is spent.
    await page.getByTestId('generate-start').click();
    const confirm = page.getByRole('dialog');
    await expect(confirm).toBeVisible();
    await expect(page.getByTestId('generate-confirm-cost')).toHaveText(
      'This uses 1 practice test of the Generation Allowance. 1 will be left this period.',
    );
    await page.getByTestId('generate-confirm').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Progress is the job's own, read from the server — and the advice to stay
    // never claims that leaving loses anything.
    await expect(page.getByTestId('generate-progress')).toBeVisible();
    await expect(page.getByTestId('generate-progress-line')).toHaveText(
      '1 practice test is ready.',
      { timeout: 30_000 },
    );
    // Announced in exactly the words it displays.
    await expect(liveRegion(page)).toContainText('1 practice test is ready.');

    // One draft landed, charged, and the allowance now says so — on the screen
    // as well as in the database. The reading taken on arrival described the
    // account before this job spent anything; a picker still offering two
    // would be offering a count the server has just stopped accepting.
    await expect(page.getByTestId('generate-usage')).toHaveText('Used this period: 1 of 2.');
    await expect(countRow(page, 1).getByRole('radio')).toBeEnabled();
    await expect(countRow(page, 2).getByRole('radio')).toBeDisabled();
    expect(await countPracticeTestsFor(email)).toBe(1);
  });

  test('survives leaving the screen and coming back to its URL', async ({ page }) => {
    const email = uniqueParentEmail('generate-return');
    await uploadAndRead(page, email);
    await enterGenerate(page);

    const url = page.url();
    await countRow(page, 1).getByRole('radio').check();
    await page.getByTestId('generate-start').click();
    await page.getByTestId('generate-confirm').click();
    await expect(page.getByTestId('generate-progress')).toBeVisible();

    // Away, through the app's own link, and back through history. Neither is a
    // `goto`: the elevation bearer lives in the page's memory alone (AD-18), so
    // a full navigation would land on the PIN gate rather than prove anything
    // about the job. The screen unmounts on the way out and mounts again on the
    // way in, which is the whole point — whatever it then shows, it read.
    await page.getByRole('link', { name: 'Back to the upload' }).click();
    await expect(page.getByRole('heading', { name: 'Pages', level: 1 })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(url);
    await expect(page.getByRole('heading', { name: 'Generate practice tests' })).toBeVisible();

    // What comes back is the job's own state, read from the server — nothing
    // this browser was holding.
    await expect(page.getByTestId('generate-progress-line')).toHaveText(
      '1 practice test is ready.',
      { timeout: 30_000 },
    );
    expect(await countPracticeTestsFor(email)).toBe(1);
  });

  test('disables every count once the allowance is spent, and says why', async ({ page }) => {
    const email = uniqueParentEmail('generate-spent');
    await uploadAndRead(page, email);
    // Both of the Free tier's units already charged — expressed as the charged
    // rows usage is derived from, because no counter column exists.
    await chargeGenerationAllowanceFixture(email, 2);
    await enterGenerate(page);

    await expect(page.getByTestId('generate-usage')).toHaveText('Used this period: 2 of 2.');
    for (const count of [1, 2, 3, 4, 5]) {
      await expect(countRow(page, count).getByRole('radio')).toBeDisabled();
    }
    await expect(page.getByTestId('generate-count-reason')).toHaveText(
      'No Generation Allowance is left this period.',
    );
    // Nothing to spend, so nothing to confirm.
    await expect(page.getByTestId('generate-start')).toBeDisabled();
  });

  test('offers every count on an unlimited tier, with no remainder invented', async ({ page }) => {
    const email = uniqueParentEmail('generate-unlimited');
    await uploadAndRead(page, email);
    await setParentTierFixture(email, 'Internal');
    await enterGenerate(page);

    await expect(page.getByTestId('generate-usage')).toHaveText(
      'Used this period: 0 of Unlimited.',
    );
    for (const count of [1, 2, 3, 4, 5]) {
      await expect(countRow(page, count).getByRole('radio')).toBeEnabled();
    }
    // No "N will be left": there is no honest number, so none is stated.
    await expect(page.getByTestId('generate-cost')).toHaveText(
      'This uses 5 practice tests of the Generation Allowance. The allowance on this account is unlimited.',
    );
  });
});
