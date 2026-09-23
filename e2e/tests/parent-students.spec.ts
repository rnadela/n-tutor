import { expect, test, type Dialog, type Page } from '@playwright/test';
import {
  createGradeLevelFixture,
  disableGradeLevelFixture,
  readStudentProfile,
  uniqueParentEmail,
} from '../fixtures';

const PASSWORD = 'correct-horse-battery-staple';
const PIN = '4821';

async function signUp(page: Page, email: string): Promise<void> {
  await page.goto('/auth/sign-up');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByLabel('I accept the terms of use.').check();
  await page.getByLabel('I accept the notice on children’s data.').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Signed in' })).toBeVisible();
}

/** Signs up, sets the PIN, and ends standing on the Students screen. */
async function openStudents(page: Page): Promise<string> {
  const email = uniqueParentEmail('students');
  await signUp(page, email);
  await page.getByRole('link', { name: 'Enter Parent View' }).click();
  await expect(page.getByRole('heading', { name: 'Set a PIN for Parent View' })).toBeVisible();
  await page.locator('#parent-pin').fill(PIN);
  await page.getByRole('button', { name: 'Save the PIN' }).click();
  await expect(page.getByRole('heading', { name: 'Parent View', level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'Student Profiles' }).click();
  await expect(page.getByRole('heading', { name: 'Student Profiles', level: 1 })).toBeVisible();
  return email;
}

/**
 * A MUI select is a listbox, not a `<select>`: open the combobox, then pick the
 * option. The combobox is addressed by role, not by id alone — MUI gives the
 * field's label an id with the same prefix, and clicking a label only focuses.
 */
async function chooseGradeLevel(page: Page, selectId: string, name: string): Promise<void> {
  await page.locator(`[role="combobox"]#${selectId}`).click();
  await page.getByRole('option', { name }).click();
  await expect(page.getByRole('listbox')).toBeHidden();
}

/**
 * The row for exactly this child.
 *
 * Matched on the row's own `data-name`, not on its text: `getByText` matches
 * substrings, so a row still reading "Noah" would satisfy a lookup for "Noa"
 * and a rename that never happened would pass unnoticed.
 */
function row(page: Page, name: string) {
  return page.locator(`[data-testid="student-row"][data-name="${name}"]`);
}

/** The profile's id, which its row states outright. */
async function profileId(page: Page, name: string): Promise<string> {
  const id = await row(page, name).getAttribute('data-profile-id');
  if (id === null) throw new Error(`No profile id on the row for ${name}.`);
  return id;
}

/**
 * Runs `act`, capturing the confirmation it raises. The dialog is returned so
 * the assertion happens in the test body — inside the handler, a dialog that
 * never fires would leave the expectation unrun and the test green.
 */
async function acceptingDialog(page: Page, act: () => Promise<void>): Promise<Dialog> {
  let seen: Dialog | null = null;
  const captured = new Promise<Dialog>((resolve) => {
    page.once('dialog', (dialog) => {
      seen = dialog;
      void dialog.accept().then(() => resolve(dialog));
    });
  });
  await act();
  await captured;
  if (seen === null) throw new Error('No confirmation was raised.');
  return seen;
}

test.describe('Student Profiles in Parent View', () => {
  test('creates, renames, re-grades, archives and restores a profile', async ({ page }) => {
    const first = await createGradeLevelFixture('E2E Grade A');
    const second = await createGradeLevelFixture('E2E Grade B');
    const email = await openStudents(page);

    await expect(
      page.getByText('There are no profiles yet. Add the first one below.'),
    ).toBeVisible();

    // --- Create -----------------------------------------------------------
    const add = page.getByRole('button', { name: 'Add the profile' });
    // Both are required, so the control is not offered until both are set.
    await expect(add).toBeDisabled();
    await page.locator('#student-name').fill('Noah');
    await expect(add).toBeDisabled();
    await chooseGradeLevel(page, 'student-grade-level', first.name);
    await expect(add).toBeEnabled();
    await add.click();

    await expect(row(page, 'Noah')).toBeVisible();
    await expect(row(page, 'Noah').getByText(first.name).first()).toBeVisible();
    await expect(row(page, 'Noah').getByText('Active')).toBeVisible();
    await expect(page.locator('main').getByRole('status')).toContainText('Noah was added.');

    const created = await readStudentProfile(email, 'Noah');

    // --- Rename -----------------------------------------------------------
    await page.getByRole('button', { name: 'Rename Noah' }).click();
    await page.getByLabel('New name').fill('Noa');
    await page.getByRole('button', { name: 'Save the name' }).click();
    await expect(row(page, 'Noa')).toBeVisible();
    // The old name is gone from the screen, not merely contained in the new one.
    await expect(row(page, 'Noah')).toHaveCount(0);

    // The same row: the id and the creation instant are untouched by a rename.
    const renamed = await readStudentProfile(email, 'Noa');
    expect(renamed.id).toBe(created.id);
    expect(renamed.createdAt.getTime()).toBe(created.createdAt.getTime());

    // --- Change the grade level -------------------------------------------
    const id = await profileId(page, 'Noa');
    await chooseGradeLevel(page, `student-grade-level-${id}`, second.name);
    await expect(row(page, 'Noa').getByText(second.name).first()).toBeVisible();
    // The name is untouched by a grade-level change.
    await expect(row(page, 'Noa')).toBeVisible();

    // --- Archive ------------------------------------------------------------
    const dialog = await acceptingDialog(page, async () => {
      await page.getByRole('button', { name: 'Archive Noa' }).click();
    });
    // Archiving says plainly that it is not a delete.
    expect(dialog.message()).toContain('hidden from Student Mode');
    expect(dialog.message()).toContain('Nothing is deleted.');

    // It is still on the screen, plainly marked — nothing was removed.
    await expect(row(page, 'Noa').getByText('Archived')).toBeVisible();
    const archived = await readStudentProfile(email, 'Noa');
    expect(archived.id).toBe(created.id);
    expect(archived.createdAt.getTime()).toBe(created.createdAt.getTime());
    // Out of what Student Mode may bind to: `archivedAt` is what that list
    // filters on, and the API-level list is asserted in the integration suite.
    expect(archived.archivedAt).not.toBeNull();

    // --- Restore ------------------------------------------------------------
    await page.getByRole('button', { name: 'Restore Noa' }).click();
    await expect(row(page, 'Noa').getByText('Active')).toBeVisible();
    const restored = await readStudentProfile(email, 'Noa');
    expect(restored.archivedAt).toBeNull();
    expect(restored.id).toBe(created.id);

    // --- The same action twice, announced twice -----------------------------
    const secondArchive = await acceptingDialog(page, async () => {
      await page.getByRole('button', { name: 'Archive Noa' }).click();
    });
    expect(secondArchive.message()).toContain('Nothing is deleted.');
    // The identical sentence is still a change in the live region, so a repeat
    // is still announced.
    await expect(page.locator('main').getByRole('status')).toContainText('Noa is archived');
  });

  test('says the stored grade level is no longer offered once Admin withdraws it', async ({
    page,
  }) => {
    const withdrawn = await createGradeLevelFixture('E2E Grade Withdrawn');
    await createGradeLevelFixture('E2E Grade Replacement');
    const email = await openStudents(page);

    await page.locator('#student-name').fill('Mira');
    await chooseGradeLevel(page, 'student-grade-level', withdrawn.name);
    await page.getByRole('button', { name: 'Add the profile' }).click();
    await expect(row(page, 'Mira')).toBeVisible();
    // The ordinary note, while the grade level is still offered.
    await expect(row(page, 'Mira')).toContainText('does not change any practice test already made');

    // Admin withdraws it: the flag alone, nothing deleted.
    await disableGradeLevelFixture(withdrawn.id);
    await page.reload();
    await page.locator('#parent-pin').fill(PIN);
    await page.getByRole('button', { name: 'Enter Parent View' }).click();
    await page.getByRole('link', { name: 'Student Profiles' }).click();

    // The profile still reads, still names its grade level, and now says the
    // choice is no longer on offer.
    await expect(row(page, 'Mira')).toBeVisible();
    await expect(row(page, 'Mira')).toContainText(withdrawn.name);
    await expect(row(page, 'Mira')).toContainText('This grade level is no longer offered.');
    await expect(row(page, 'Mira')).not.toContainText(
      'does not change any practice test already made',
    );

    // And the row survived untouched.
    const stored = await readStudentProfile(email, 'Mira');
    expect(stored.archivedAt).toBeNull();
  });

  test('sends a reloaded Students screen back to the PIN gate', async ({ page }) => {
    await createGradeLevelFixture('E2E Grade Reload');
    await openStudents(page);

    // The elevation token lives in memory alone, so a reload destroys it and
    // the gate goes back up in front of the Students screen too.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Enter your PIN' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Student Profiles', level: 1 })).toBeHidden();
  });
});
