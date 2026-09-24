import { expect, test, type Dialog, type Page } from '@playwright/test';
import { createGradeLevelFixture, uniqueParentEmail } from '../fixtures';

const PASSWORD = 'correct-horse-battery-staple';
const PIN = '4821';

const API_ORIGIN = `http://localhost:${process.env.API_PORT ?? '3001'}`;

/**
 * Two real JPEGs, small enough to live here and different enough that "the
 * bytes changed" is a thing a retake could show. Generated once with the same
 * encoder the API normalizes with; embedded rather than read off disk so the
 * suite carries no binary fixtures.
 */
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

/** Signs up, crosses the PIN, adds one child, and opens the Pages screen. */
async function openCapture(page: Page): Promise<void> {
  const email = uniqueParentEmail('capture');
  const gradeLevel = await createGradeLevelFixture('Capture Grade');

  await signUp(page, email);
  await page.getByRole('link', { name: 'Enter Parent View' }).click();
  await page.locator('#parent-pin').fill(PIN);
  await page.getByRole('button', { name: 'Save the PIN' }).click();
  await expect(
    page.getByRole('heading', { name: 'Parent View', level: 1, exact: true }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Student Profiles' }).click();
  await expect(page.getByRole('heading', { name: 'Student Profiles', level: 1 })).toBeVisible();
  await page.locator('#student-name').fill('Noah');
  // A MUI select is a listbox, not a `<select>`: open the combobox, then pick.
  await page.locator('[role="combobox"]#student-grade-level').click();
  await page.getByRole('option', { name: gradeLevel.name }).click();
  await expect(page.getByRole('listbox')).toBeHidden();
  await page.getByRole('button', { name: 'Add the profile' }).click();
  await expect(page.locator('[data-testid="student-row"][data-name="Noah"]')).toBeVisible();

  await page.getByRole('link', { name: 'Back to Parent View' }).click();
  await page.getByRole('link', { name: 'Upload a test' }).click();
  await expect(page.getByRole('heading', { name: 'Pages', level: 1 })).toBeVisible();
}

/** The strip's rows, in the order the ordered list holds them. */
function rows(page: Page) {
  return page.locator('[data-testid="page-row"]');
}

async function addPage(page: Page, file: ReturnType<typeof jpeg>): Promise<void> {
  // The control is enabled only once the draft is open, so waiting on it is
  // waiting on the Source Test the page is about to be added to.
  await expect(page.locator('#capture-add-page')).toBeEnabled();
  const before = await rows(page).count();
  await page.locator('#capture-add-page').setInputFiles(file);
  // Says what it is doing while it is doing it, so a slow ingest never reads
  // as a dead control — and gone again once the row lands.
  await expect(page.getByTestId('adding')).toBeVisible();
  // Ingest re-encodes the photo before the row leaves `Uploading`, so the first
  // upload of a run waits on a cold image pipeline as well as the round trip.
  await expect(rows(page)).toHaveCount(before + 1, { timeout: 20_000 });
  await expect(page.getByTestId('adding')).toBeHidden();
}

/** The one polite live region the surface mounts, in `ThemeRegistry`. */
function liveRegion(page: Page) {
  return page.locator('[role="status"][aria-live="polite"]');
}

/** Accepts the delete confirmation, which states what the delete does. */
function acceptConfirm(page: Page): void {
  page.once('dialog', (dialog: Dialog) => void dialog.accept());
}

test.describe('page management before submit', () => {
  test('orders, renumbers and refuses an empty submission', async ({ page }) => {
    await openCapture(page);

    // Nothing yet: the submit control is already refused, with the reason said.
    await expect(page.getByRole('button', { name: 'Check pages' })).toBeDisabled();
    await expect(page.getByTestId('submit-blocked')).toBeVisible();

    await addPage(page, jpeg('page-a.jpg', PAGE_A));
    await addPage(page, jpeg('page-b.jpg', PAGE_B));

    await expect(page.getByTestId('page-count')).toHaveText(
      'Pages are used in this order. 2 of 10 page images.',
    );
    await expect(rows(page).nth(0)).toContainText('Page 1');
    await expect(rows(page).nth(1)).toContainText('Page 2');
    await expect(page.getByRole('button', { name: 'Check pages' })).toBeEnabled();
    await expect(page.getByTestId('submit-blocked')).toHaveCount(0);

    // The ends are disabled, which is the rule stated as a control.
    await expect(page.getByRole('button', { name: 'Move page 1 up' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Move page 2 down' })).toBeDisabled();

    // Every control names the page ordinal it acts on.
    await expect(page.getByRole('button', { name: 'Move page 1 down' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Delete page 2' })).toBeEnabled();

    const firstId = await rows(page).nth(0).getAttribute('data-page-id');
    const secondId = await rows(page).nth(1).getAttribute('data-page-id');

    await page.getByRole('button', { name: 'Move page 1 down' }).click();
    // The order changed and the numbering went with it: the page that was 1 is
    // now 2, and it is the second row of the list.
    await expect(rows(page).nth(0)).toHaveAttribute('data-page-id', secondId!);
    await expect(rows(page).nth(1)).toHaveAttribute('data-page-id', firstId!);
    await expect(rows(page).nth(0)).toContainText('Page 1');
    await expect(rows(page).nth(1)).toContainText('Page 2');
    // Announced with the ordinals it is about, in the words the screen uses.
    await expect(liveRegion(page)).toContainText('Page 1 is now page 2.');

    // A retake replaces that page alone: the ordinal it already had, and the
    // same number of pages after it as before.
    await page.locator(`#capture-retake-${firstId}`).setInputFiles(jpeg('retake.jpg', PAGE_A));
    await expect(liveRegion(page)).toContainText('Page 2 was replaced.');
    await expect(rows(page)).toHaveCount(2);
    await expect(rows(page).nth(1)).toHaveAttribute('data-page-id', firstId!);
    await expect(rows(page).nth(1)).toContainText('Page 2');

    // The order shown is the order stored: leaving the screen and coming back
    // re-reads it from the API. A full reload would not do — the elevation
    // bearer lives in memory alone (AD-18), so a reload lands on the PIN gate.
    await page.getByRole('link', { name: 'Back to Parent View' }).click();
    await page.getByRole('link', { name: 'Upload a test' }).click();
    await expect(page.getByRole('heading', { name: 'Pages', level: 1 })).toBeVisible();
    await expect(rows(page).nth(0)).toHaveAttribute('data-page-id', secondId!);
    await expect(rows(page).nth(1)).toHaveAttribute('data-page-id', firstId!);

    // Down to zero, one page at a time; the survivor renumbers to Page 1.
    acceptConfirm(page);
    await page.getByRole('button', { name: 'Delete page 1' }).click();
    await expect(liveRegion(page)).toContainText(
      'Page 1 was deleted. The pages after it are renumbered.',
    );
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).nth(0)).toHaveAttribute('data-page-id', firstId!);
    await expect(rows(page).nth(0)).toContainText('Page 1');

    acceptConfirm(page);
    await page.getByRole('button', { name: 'Delete page 1' }).click();
    await expect(rows(page)).toHaveCount(0);

    await expect(page.getByRole('button', { name: 'Check pages' })).toBeDisabled();
    await expect(page.getByTestId('submit-blocked')).toBeVisible();
    await expect(page.getByTestId('submit-blocked')).toHaveText(
      'Add at least one page before submitting.',
    );
  });

  test('submits the pages and then refuses every further change to them', async ({ page }) => {
    await openCapture(page);
    await addPage(page, jpeg('page-a.jpg', PAGE_A));
    await addPage(page, jpeg('page-b.jpg', PAGE_B));
    await expect(liveRegion(page)).toContainText('Page 2 was added.');

    await page.getByRole('button', { name: 'Check pages' }).click();

    await expect(liveRegion(page)).toContainText('The pages were submitted.');
    await expect(page.getByTestId('submitted-note')).toHaveText(
      'These pages were submitted. Nothing on this upload can be changed now.',
    );
    // The work is still shown — it did not vanish — and nothing on it is live.
    await expect(rows(page)).toHaveCount(2);
    await expect(page.getByTestId('page-count')).toHaveText(
      'Pages are used in this order. 2 of 10 page images.',
    );
    await expect(page.getByRole('button', { name: 'Check pages' })).toHaveCount(0);
    await expect(page.locator('#capture-add-page')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Delete page/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Move page/ })).toHaveCount(0);
  });

  test('Retry re-issues the draft open, not only the profile list', async ({ page }) => {
    const email = uniqueParentEmail('capture-retry');
    const gradeLevel = await createGradeLevelFixture('Capture Retry Grade');

    await signUp(page, email);
    await page.getByRole('link', { name: 'Enter Parent View' }).click();
    await page.locator('#parent-pin').fill(PIN);
    await page.getByRole('button', { name: 'Save the PIN' }).click();
    await page.getByRole('link', { name: 'Student Profiles' }).click();
    await page.locator('#student-name').fill('Noah');
    await page.locator('[role="combobox"]#student-grade-level').click();
    await page.getByRole('option', { name: gradeLevel.name }).click();
    await expect(page.getByRole('listbox')).toBeHidden();
    await page.getByRole('button', { name: 'Add the profile' }).click();
    await expect(page.locator('[data-testid="student-row"][data-name="Noah"]')).toBeVisible();
    await page.getByRole('link', { name: 'Back to Parent View' }).click();

    // The draft-open call fails once — every load, then every retry, hits it —
    // so the only way through is a Retry that re-issues it, not one that only
    // refreshes the profile list.
    let draftOpenFailed = false;
    await page.route('**/api/parent/source-tests', async (route) => {
      if (!draftOpenFailed && route.request().method() === 'POST') {
        draftOpenFailed = true;
        await route.fulfill({
          status: 500,
          headers: {
            'access-control-allow-origin': 'http://localhost:3000',
            // `credentials: 'include'` on every parent-api call means the
            // browser discards a fulfilled response with no explicit
            // allow-credentials header, surfacing as a network error rather
            // than the 500 this test means to simulate.
            'access-control-allow-credentials': 'true',
          },
          body: '{}',
        });
        return;
      }
      await route.continue();
    });

    await page.getByRole('link', { name: 'Upload a test' }).click();
    await expect(page.getByRole('heading', { name: 'Pages', level: 1 })).toBeVisible();

    const retry = page.getByRole('button', { name: 'Try again' });
    await expect(retry).toBeVisible();
    await retry.click();

    // Only reachable once the retried draft-open call actually landed: the
    // profile list alone never renders the page count.
    await expect(page.getByTestId('page-count')).toHaveText(
      'Pages are used in this order. 0 of 10 page images.',
    );
    await expect(retry).toHaveCount(0);
  });

  test('refuses a submission made straight to the API, with no browser involved', async () => {
    // The elevation bearer lives in the page's memory alone (AD-18), so a
    // browser test cannot issue a parent-scoped call. This one therefore drives
    // the API itself, which is the point: the disabled button is a courtesy,
    // and the refusal has to hold for a caller that never saw it.
    const email = uniqueParentEmail('capture-api');
    const gradeLevel = await createGradeLevelFixture('Capture API Grade');

    const signUp = await fetch(`${API_ORIGIN}/api/auth/sign-up`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        password: PASSWORD,
        timezone: 'UTC',
        termsVersion: await currentVersion('termsVersion'),
        noticeVersion: await currentVersion('noticeVersion'),
      }),
    });
    expect(signUp.status).toBe(201);
    const cookie = sessionCookie(signUp);

    await expectOk(
      fetch(`${API_ORIGIN}/api/parent/pin`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ pin: PIN }),
      }),
      204,
    );
    const elevation = await fetch(`${API_ORIGIN}/api/parent/pin/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ pin: PIN }),
    });
    expect(elevation.status).toBe(200);
    const { token } = (await elevation.json()) as { token: string };
    const elevated = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

    const profile = await fetch(`${API_ORIGIN}/api/parent/students`, {
      method: 'POST',
      headers: elevated,
      body: JSON.stringify({ displayName: 'Ada', gradeLevelId: gradeLevel.id }),
    });
    expect(profile.status).toBe(201);
    const { id: studentProfileId } = (await profile.json()) as { id: string };

    const draft = await fetch(`${API_ORIGIN}/api/parent/source-tests`, {
      method: 'POST',
      headers: elevated,
      body: JSON.stringify({ studentProfileId }),
    });
    expect(draft.status).toBe(200);
    const { id: sourceTestId } = (await draft.json()) as { id: string };

    const submitted = await fetch(`${API_ORIGIN}/api/parent/source-tests/${sourceTestId}/submit`, {
      method: 'POST',
      headers: elevated,
    });
    expect(submitted.status).toBe(400);

    // And it is still a draft afterwards.
    const after = await fetch(`${API_ORIGIN}/api/parent/source-tests/${sourceTestId}`, {
      headers: elevated,
    });
    expect(((await after.json()) as { status: string }).status).toBe('Draft');
  });
});

/** The consent versions in force, read from the API rather than restated. */
async function currentVersion(field: 'termsVersion' | 'noticeVersion'): Promise<string> {
  const response = await fetch(`${API_ORIGIN}/api/auth/policy`);
  const policy = (await response.json()) as Record<string, string>;
  return policy[field]!;
}

function sessionCookie(response: Response): string {
  const raw = response.headers.getSetCookie?.() ?? [];
  const value = raw.find((entry) => entry.startsWith('parent_session='));
  if (!value) throw new Error('No parent session cookie on the sign-up response.');
  return value.split(';')[0]!;
}

async function expectOk(pending: Promise<Response>, status: number): Promise<void> {
  const response = await pending;
  expect(response.status).toBe(status);
}
