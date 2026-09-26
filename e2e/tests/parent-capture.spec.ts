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

/**
 * A page the legibility check calls readable.
 *
 * The `fake` transport decides a page's verdict from its **stored** byte size
 * (AD-22), so a flagged page is arranged by uploading a deliberately tiny
 * image and a readable one by uploading a larger one — no env toggle and no
 * per-test script anywhere. `PAGE_A` and `PAGE_B` above are both well under
 * the threshold and both come back flagged; this one is noise at 64x64, which
 * re-encodes to several kilobytes and comes back readable.
 */
const PAGE_LEGIBLE =
  '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';

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

/**
 * The two steps a commit now takes: the batch check, then the commit it gates.
 *
 * They are deliberately separate controls — the check charges nothing and the
 * commit charges an Upload Allowance, and the screen states that between them
 * — so a fixture that wants a submitted upload has to pass through both.
 */
async function checkThenContinue(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Check pages' }).click();
  const commit = page.getByTestId('legibility-continue');
  await expect(commit).toBeVisible({ timeout: 20_000 });
  await commit.click();
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
    await checkThenContinue(page);
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
    // One `write` per parent action, so each single-file add announces one
    // page rather than the running total.
    await expect(liveRegion(page)).toContainText('One page was added.');

    await checkThenContinue(page);

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

  test('checks the pages once, names the blurry one, states the cost, then commits', async ({
    page,
  }) => {
    const { subjectName } = await openCapture(page);
    await chooseSubject(page, subjectName);
    // One page the check will flag and one it will not, arranged by the bytes
    // alone: the fake transport reads a stored page under its byte threshold
    // as Low (AD-22), so nothing in this test touches the seam.
    await addPage(page, jpeg('page-legible.jpg', PAGE_LEGIBLE));
    await addPage(page, jpeg('page-tiny.jpg', PAGE_A));

    // Before the check, the commit control does not exist at all.
    await expect(page.getByTestId('legibility-continue')).toHaveCount(0);

    await page.getByRole('button', { name: 'Check pages' }).click();
    const panel = page.getByTestId('legibility-result');
    await expect(panel).toBeVisible({ timeout: 20_000 });

    // Per page, never a whole-test verdict — and each badge is a word, not a
    // colour.
    await expect(page.getByTestId('legibility-badge-1')).toHaveText('✓ Page 1: Readable');
    await expect(page.getByTestId('legibility-badge-2')).toHaveText('! Page 2: Blurry');
    await expect(page.getByTestId('legibility-summary')).toHaveText(
      'Page 2 may be too blurry to read.',
    );
    await expect(liveRegion(page)).toContainText('One page may be too blurry to read.');

    // The retake is offered for the flagged page alone.
    await expect(page.getByTestId('legibility-retake-2')).toHaveText('Retake page 2');
    await expect(page.getByTestId('legibility-retake-1')).toHaveCount(0);

    // Proceeding is allowed and the screen says so, and the cost is stated
    // before the control that spends it.
    await expect(page.getByTestId('legibility-advisory')).toHaveText(
      'This is a warning, not a block. Continuing is allowed.',
    );
    await expect(page.getByTestId('legibility-cost')).toHaveText(
      'Continuing commits this upload and uses one upload allowance.',
    );
    await expect(page.getByTestId('legibility-no-cost')).toHaveText(
      'Nothing is used if you leave without continuing.',
    );

    const commit = page.getByTestId('legibility-continue');
    await expect(commit).toHaveText('Continue with all 2 pages');
    // Never disabled for a flagged page.
    await expect(commit).toBeEnabled();

    // Retaking page 2 clears the check, because the bytes under a verdict
    // moved — so the panel goes and the check control comes back.
    await page.getByTestId('legibility-retake-2').click();
    await page
      .locator('input[type="file"][aria-label="Retake page 2"]')
      .setInputFiles(jpeg('page-retake.jpg', PAGE_LEGIBLE));
    await expect(liveRegion(page)).toContainText('Page 2 was replaced.');
    await expect(page.getByTestId('legibility-result')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Check pages' })).toBeEnabled();

    // Checked again, both pages now read clearly, and the commit stands.
    await page.getByRole('button', { name: 'Check pages' }).click();
    await expect(page.getByTestId('legibility-summary')).toHaveText('Every page reads clearly.', {
      timeout: 20_000,
    });
    await page.getByTestId('legibility-continue').click();
    await expect(liveRegion(page)).toContainText('The pages were submitted.');
    await expect(page.getByTestId('submitted-note')).toBeVisible();
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

  test('warns before generating when the reading came back thin, and never blocks', async ({
    page,
  }) => {
    const { subjectName } = await openCapture(page);

    await chooseSubject(page, subjectName);
    await addPage(page, jpeg('page-a.jpg', PAGE_A));
    await addPage(page, jpeg('page-b.jpg', PAGE_B));
    await checkThenContinue(page);
    await expect(page.getByTestId('submitted-note')).toBeVisible();

    // The job outlives the request, so the step says what it is doing and then
    // polls until the worker has finished — no reload anywhere in between.
    await expect(page.getByRole('heading', { name: 'Generate a practice test' })).toBeVisible();
    const proceed = page.getByRole('button', { name: 'Continue to practice test' });
    await expect(proceed).toBeVisible({ timeout: 30_000 });

    // The fake reads one usable question off each page, against a threshold of
    // two — so two pages is exactly the case the warning exists for, with no
    // environment manipulation anywhere in this test.
    await proceed.click();
    const warning = page.getByRole('dialog');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('Fewer questions than expected');
    // Both counts, in the same sentence, and the no-charge guarantee.
    await expect(page.getByTestId('thin-counts')).toHaveText(
      '2 usable questions were found across 2 pages.',
    );
    await expect(page.getByTestId('thin-no-charge')).toHaveText(
      'Retaking the pages uses no Generation Allowance.',
    );
    // And the proceed is offered, not withheld: the warning informs.
    await expect(warning.getByRole('button', { name: 'Continue anyway' })).toBeEnabled();

    // Retake: a fresh upload for the same child, back at an empty strip.
    await warning.getByRole('button', { name: 'Retake the pages' }).click();
    await expect(liveRegion(page)).toContainText('A new upload was started.');
    await expect(page.getByTestId('page-count')).toHaveText(
      'Pages are used in this order. 0 of 10 page images.',
    );
    await expect(rows(page)).toHaveCount(0);
    await expect(page.getByTestId('submitted-note')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // Nothing was generated on the way through, and the step is gone with the
    // upload it was about.
    await expect(page.getByRole('heading', { name: 'Generate a practice test' })).toHaveCount(0);

    // The same path again, taken to the end this time.
    await chooseSubject(page, subjectName);
    await addPage(page, jpeg('page-a.jpg', PAGE_A));
    await addPage(page, jpeg('page-b.jpg', PAGE_B));
    await checkThenContinue(page);
    const proceedAgain = page.getByRole('button', { name: 'Continue to practice test' });
    await expect(proceedAgain).toBeVisible({ timeout: 30_000 });
    await proceedAgain.click();
    await page.getByRole('dialog').getByRole('button', { name: 'Continue anyway' }).click();
    // Past the gate is a *navigation*, because the generate flow is
    // asynchronous and has to survive leaving the screen — which only a
    // URL-addressable route does. The gate ends here; what the route does is
    // `parent-practice-test.spec.ts`'s.
    await expect(page).toHaveURL(/\/parent\/generate\//);
    await expect(page.getByRole('heading', { name: 'Generate practice tests' })).toBeVisible();
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

    // Pages and a classification, but the check has not run: refused, with
    // the reason stated, and the Source Test stays a draft. The disabled
    // control on the screen is a courtesy; this is the control.
    const beforeCheck = await fetch(
      `${API_ORIGIN}/api/parent/source-tests/${sourceTestId}/submit`,
      { method: 'POST', headers: elevated },
    );
    expect(beforeCheck.status).toBe(400);
    expect(JSON.stringify(await beforeCheck.json())).toContain(
      'Check the pages before submitting.',
    );
    const stillDraft = await fetch(`${API_ORIGIN}/api/parent/source-tests/${sourceTestId}`, {
      headers: elevated,
    });
    const draftBody = (await stillDraft.json()) as {
      status: string;
      legibilityCheckedAt: string | null;
    };
    expect(draftBody.status).toBe('Draft');
    expect(draftBody.legibilityCheckedAt).toBeNull();

    // The check itself, over the whole page set, in one call.
    const checked = await fetch(
      `${API_ORIGIN}/api/parent/source-tests/${sourceTestId}/legibility`,
      { method: 'POST', headers: elevated },
    );
    expect(checked.status).toBe(200);
    const checkedBody = (await checked.json()) as {
      legibilityCheckedAt: string | null;
      pages: { ordinal: number; legibility: string | null }[];
    };
    expect(checkedBody.legibilityCheckedAt).not.toBeNull();
    // Per page, and both of these are deliberately tiny, so both are flagged
    // — which the submit below is then accepted over.
    expect(checkedBody.pages.map((image) => image.legibility)).toEqual(['Low', 'Low']);

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
