import { expect, test, type Dialog, type Page } from '@playwright/test';
import { createGradeLevelFixture, createSubjectFixture, uniqueParentEmail } from '../fixtures';

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

/**
 * Signs up, crosses the PIN, adds one child, and opens the Pages screen.
 *
 * A Subject offered for the child's Grade Level is seeded too: the submit gate
 * needs one, and the taxonomy is Admin's, so there is no parent-facing route
 * that could create it.
 */
async function openCapture(page: Page): Promise<{ gradeLevelName: string; subjectName: string }> {
  const email = uniqueParentEmail('capture');
  const gradeLevel = await createGradeLevelFixture('Capture Grade');
  const subject = await createSubjectFixture('Capture Subject', gradeLevel.id);

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
  return { gradeLevelName: gradeLevel.name, subjectName: subject.name };
}

/** Chooses the Subject from the list the server offers for the Grade Level. */
async function chooseSubject(page: Page, name: string): Promise<void> {
  await page.locator('[role="combobox"]#capture-subject').click();
  await page.getByRole('option', { name }).click();
  await expect(page.getByRole('listbox')).toBeHidden();
  await expect(liveRegion(page)).toContainText(`The subject is ${name}.`);
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
    const { subjectName } = await openCapture(page);

    // Nothing yet: the submit control is already refused, and *both* unmet
    // requirements are named rather than only the first.
    await expect(page.getByRole('button', { name: 'Check pages' })).toBeDisabled();
    await expect(page.getByTestId('submit-blocked')).toHaveText(
      'Add at least one page before submitting. Choose a subject and a grade level before submitting.',
    );

    await chooseSubject(page, subjectName);
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
    // The classification survived every page change, so the pages are now the
    // only thing left unmet.
    await expect(page.getByTestId('submit-blocked')).toHaveText(
      'Add at least one page before submitting.',
    );
  });

  test('defaults the grade level to the child’s, and gates submit on the subject', async ({
    page,
  }) => {
    const { gradeLevelName, subjectName } = await openCapture(page);

    // The child's own grade level, already chosen for this upload.
    await expect(page.locator('[role="combobox"]#capture-grade-level')).toHaveText(gradeLevelName);
    await expect(
      page.getByText('Changing it here does not change the child’s profile.', { exact: false }),
    ).toBeVisible();

    await addPage(page, jpeg('page-a.jpg', PAGE_A));

    // Pages, but no subject: refused, with the missing requirement named.
    await expect(page.getByRole('button', { name: 'Check pages' })).toBeDisabled();
    await expect(page.getByTestId('submit-blocked')).toHaveText(
      'Choose a subject and a grade level before submitting.',
    );

    // The subject list holds exactly what an administrator offers for that
    // grade level, and choosing one clears the gate.
    await page.locator('[role="combobox"]#capture-subject').click();
    await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(1);
    await page.getByRole('option', { name: subjectName }).click();
    await expect(page.getByRole('listbox')).toBeHidden();
    await expect(liveRegion(page)).toContainText(`The subject is ${subjectName}.`);

    await expect(page.getByTestId('submit-blocked')).toHaveCount(0);
    await page.getByRole('button', { name: 'Check pages' }).click();
    await expect(liveRegion(page)).toContainText('The pages were submitted.');
    await expect(page.getByTestId('submitted-note')).toBeVisible();
  });

  test('clears a subject the new grade level does not offer, and says so', async ({ page }) => {
    // A second Grade Level with a Subject of its own, and the first Grade
    // Level's Subject offered nowhere else. Moving between them is what
    // exercises the clear-and-re-offer branch end to end.
    //
    // Seeded before the screen is opened, because the Grade Level list is read
    // once on mount: a row created afterwards is simply not among the options.
    const other = await createGradeLevelFixture('Other Grade');
    const otherSubject = await createSubjectFixture('Other Subject', other.id);
    const { subjectName } = await openCapture(page);

    await chooseSubject(page, subjectName);

    await page.locator('[role="combobox"]#capture-grade-level').click();
    await page.getByRole('option', { name: other.name }).click();
    await expect(page.getByRole('listbox')).toBeHidden();

    // The server cleared the Subject the new Grade Level does not offer, and
    // the screen states that rather than leaving it to be noticed.
    await expect(liveRegion(page)).toContainText(
      `The grade level is ${other.name}. That grade level does not offer the subject that was chosen, so the subject was cleared.`,
    );
    await expect(page.getByTestId('submit-blocked')).toContainText(
      'Choose a subject and a grade level before submitting.',
    );

    // And the Subject list is the new Grade Level's, re-read rather than
    // filtered from the one already held.
    await page.locator('[role="combobox"]#capture-subject').click();
    await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(1);
    await page.getByRole('option', { name: otherSubject.name }).click();
    await expect(page.getByRole('listbox')).toBeHidden();
    await expect(liveRegion(page)).toContainText(`The subject is ${otherSubject.name}.`);

    // Re-classified against the grade level it now holds, so the only thing
    // left between the parent and submitting is a page.
    await addPage(page, jpeg('page-a.jpg', PAGE_A));
    await expect(page.getByTestId('submit-blocked')).toHaveCount(0);
  });

  test('submits the pages and then refuses every further change to them', async ({ page }) => {
    const { subjectName } = await openCapture(page);
    await chooseSubject(page, subjectName);
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
    await expect(page.locator('#capture-subject')).toHaveCount(0);
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

    // A draft has no Extraction job, and the read says so with a 404 rather
    // than an empty document.
    const beforeSubmit = await fetch(
      `${API_ORIGIN}/api/parent/source-tests/${sourceTestId}/extraction`,
      { headers: elevated },
    );
    expect(beforeSubmit.status).toBe(404);

    // Now make the same Source Test submittable and let the real worker read
    // it: full stack, real Postgres, real queue, with `ai` on its fake
    // transport (AD-22 tier 2).
    const subject = await createSubjectFixture('Capture API Subject', gradeLevel.id);
    await expectOk(
      fetch(`${API_ORIGIN}/api/parent/source-tests/${sourceTestId}/classification`, {
        method: 'PATCH',
        headers: elevated,
        body: JSON.stringify({ subjectId: subject.id }),
      }),
      200,
    );
    for (const page of [jpeg('page-a.jpg', PAGE_A), jpeg('page-b.jpg', PAGE_B)]) {
      const form = new FormData();
      form.set('file', new Blob([new Uint8Array(page.buffer)], { type: page.mimeType }), page.name);
      await expectOk(
        fetch(`${API_ORIGIN}/api/parent/source-tests/${sourceTestId}/pages`, {
          method: 'POST',
          headers: { authorization: elevated.authorization },
          body: form,
        }),
        201,
      );
    }
    await expectOk(
      fetch(`${API_ORIGIN}/api/parent/source-tests/${sourceTestId}/submit`, {
        method: 'POST',
        headers: elevated,
      }),
      200,
    );

    // The job outlives the request, so the status is polled rather than
    // awaited: that is the whole point of enqueueing it (AD-3).
    const extraction = await pollExtraction(sourceTestId, elevated);
    expect(extraction.status).toBe('Succeeded');
    expect(extraction.pageCount).toBe(2);
    expect(extraction.questionCount).toBeGreaterThan(0);
    expect(extraction.usableQuestionCount).toBeGreaterThan(0);

    // And not one word of what was read comes back: Extraction is not a
    // browsable surface in v0, so the body is counts and a status, full stop.
    const body = JSON.stringify(extraction);
    expect(body).not.toContain('prompt');
    expect(body).not.toContain('choices');
    expect(body).not.toContain('topics');
  });
});

interface ExtractionStatusBody {
  status: string;
  pageCount: number | null;
  questionCount: number | null;
  usableQuestionCount: number | null;
  uninterpretableRegionCount: number | null;
}

/**
 * Reads the Extraction status until the worker has finished with it.
 *
 * A failed job ends the wait immediately rather than burning the timeout: the
 * body already says what went wrong, and a test that times out says only that
 * something did.
 */
async function pollExtraction(
  sourceTestId: string,
  headers: Record<string, string>,
): Promise<ExtractionStatusBody> {
  const deadline = Date.now() + 30_000;
  let latest: ExtractionStatusBody = { status: 'unknown' } as ExtractionStatusBody;
  while (Date.now() < deadline) {
    const response = await fetch(
      `${API_ORIGIN}/api/parent/source-tests/${sourceTestId}/extraction`,
      { headers },
    );
    expect(response.status).toBe(200);
    latest = (await response.json()) as ExtractionStatusBody;
    if (latest.status === 'Succeeded' || latest.status === 'Failed') return latest;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return latest;
}

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
