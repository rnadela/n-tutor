import { expect, test, type Page } from '@playwright/test';
import { createGradeLevelFixture, uniqueParentEmail } from '../fixtures';

const PASSWORD = 'correct-horse-battery-staple';
const PIN = '4821';

/**
 * There is deliberately no fixture reading the binding out of the database:
 * the binding is not a row. It lives only in an httpOnly cookie, so everything
 * asserted here is asserted through the browser's own cookie jar and the screen
 * the device actually lands on.
 */

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
  const email = uniqueParentEmail('student-mode');
  await signUp(page, email);
  await page.getByRole('link', { name: 'Enter Parent View' }).click();
  await expect(page.getByRole('heading', { name: 'Set a PIN for Parent View' })).toBeVisible();
  await page.locator('#parent-pin').fill(PIN);
  await page.getByRole('button', { name: 'Save the PIN' }).click();
  await expect(
    page.getByRole('heading', { name: 'Parent View', level: 1, exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Student Profiles' }).click();
  await expect(page.getByRole('heading', { name: 'Student Profiles', level: 1 })).toBeVisible();
  return email;
}

/** A MUI select is a listbox, not a `<select>`: open it, then pick an option. */
async function chooseGradeLevel(page: Page, selectId: string, name: string): Promise<void> {
  await page.locator(`[role="combobox"]#${selectId}`).click();
  await page.getByRole('option', { name }).click();
  await expect(page.getByRole('listbox')).toBeHidden();
}

async function addProfile(page: Page, name: string, gradeLevel: string): Promise<void> {
  await page.locator('#student-name').fill(name);
  await chooseGradeLevel(page, 'student-grade-level', gradeLevel);
  await page.getByRole('button', { name: 'Add the profile' }).click();
  await expect(page.locator('main').getByRole('status')).toContainText(name);
}

/** Crosses the PIN from wherever the browser is standing. */
async function enterParentView(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Enter your PIN' })).toBeVisible();
  await page.locator('#parent-pin').fill(PIN);
  await page.getByRole('button', { name: 'Enter Parent View' }).click();
  await expect(
    page.getByRole('heading', { name: 'Parent View', level: 1, exact: true }),
  ).toBeVisible();
}

test.describe('Student Mode and the handover', () => {
  test('binds the device to the first profile, and shows that child', async ({ page }) => {
    const grade = await createGradeLevelFixture('Grade');
    await openStudents(page);
    await addProfile(page, 'Noah', grade.name);

    // Creating the first profile is the whole of the setup: the device is now
    // a device with a Student Mode, and the front door goes there.
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Your practice', level: 1 })).toBeVisible();
    await expect(page.getByText('Hello, Noah.')).toBeVisible();
    await expect(page.getByText(`You are in ${grade.name}.`)).toBeVisible();

    // Nothing about the binding is readable by the page itself.
    const residue = await page.evaluate(() => ({
      local: Object.entries({ ...window.localStorage }),
      session: Object.entries({ ...window.sessionStorage }),
      cookie: document.cookie,
    }));
    expect(residue.local).toEqual([]);
    expect(residue.session).toEqual([]);
    expect(residue.cookie).toBe('');

    // And it survives a restart: Student Mode is the device's default state.
    await page.reload();
    await expect(page.getByText('Hello, Noah.')).toBeVisible();
  });

  test('hands the device straight over when there is only one child', async ({ page }) => {
    const grade = await createGradeLevelFixture('Grade');
    await openStudents(page);
    await addProfile(page, 'Noah', grade.name);

    // The exit is present wherever the parent is standing, not only on
    // `/parent`: this is the Students screen, and it is here too.
    const exit = page.getByRole('button', { name: 'Back to Student Mode' });
    await expect(exit).toBeVisible();

    await exit.click();
    // One child is no choice at all, so the parent is not asked to make one.
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Your practice', level: 1 })).toBeVisible();
    await expect(page.getByText('Hello, Noah.')).toBeVisible();
    await expect(page).toHaveURL(/\/student$/u);

    // And the handover is the binding: it survives a reload.
    await page.reload();
    await expect(page.getByText('Hello, Noah.')).toBeVisible();
  });

  test('asks which child the device is handed to once there is more than one', async ({ page }) => {
    const grade = await createGradeLevelFixture('Grade');
    await openStudents(page);
    await addProfile(page, 'Noah', grade.name);
    await addProfile(page, 'Mira', grade.name);

    // The second creation does not rebind, so the device is still Noah's.
    await page.goto('/student');
    await expect(page.getByText('Hello, Noah.')).toBeVisible();

    // A link, not a button: it is a client-side navigation to the PIN gate.
    await page.getByRole('link', { name: 'Parent' }).click();
    await enterParentView(page);

    await page.getByRole('button', { name: 'Back to Student Mode' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // The child the device is on right now is the one already chosen.
    await expect(dialog.getByRole('radio', { name: 'Noah' })).toBeChecked();

    await dialog.getByRole('radio', { name: 'Mira' }).check();
    await dialog.getByRole('button', { name: 'Hand over the device' }).click();

    await expect(page.getByRole('heading', { name: 'Your practice', level: 1 })).toBeVisible();
    await expect(page.getByText('Hello, Mira.')).toBeVisible();
    // The choice is the binding, not a page's memory of one.
    await page.reload();
    await expect(page.getByText('Hello, Mira.')).toBeVisible();
  });

  test('renders the PIN gate for a parent URL typed from Student Mode', async ({ page }) => {
    const grade = await createGradeLevelFixture('Grade');
    await openStudents(page);
    await addProfile(page, 'Noah', grade.name);

    await page.goto('/student');
    await expect(page.getByText('Hello, Noah.')).toBeVisible();

    for (const url of ['/parent', '/parent/students', '/parent/pin/change']) {
      await page.goto(url);
      await expect(page.getByRole('heading', { name: 'Enter your PIN' })).toBeVisible();
      // No parent-scoped data reaches the screen behind the gate.
      await expect(page.locator('body')).not.toContainText('Noah');
      await expect(page.locator('body')).not.toContainText(grade.name);
    }

    // The PIN is the only way through, and it is what the one control reaches.
    await page.goto('/student');
    // A link, not a button: it is a client-side navigation to the PIN gate.
    await page.getByRole('link', { name: 'Parent' }).click();
    await enterParentView(page);
  });

  test('drops the device back to sign-in when the parent signs out', async ({ page }) => {
    const grade = await createGradeLevelFixture('Grade');
    await openStudents(page);
    await addProfile(page, 'Noah', grade.name);

    await page.goto('/auth/signed-in');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();

    // The device is no longer attached to that account, so it is no longer in
    // a Student Mode belonging to it.
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
  });

  test('stops sitting in a profile the parent archives', async ({ page }) => {
    const grade = await createGradeLevelFixture('Grade');
    await openStudents(page);
    await addProfile(page, 'Noah', grade.name);

    page.on('dialog', (confirmation) => void confirmation.accept());
    await page.getByRole('button', { name: 'Archive' }).first().click();
    await expect(page.locator('main').getByRole('status')).toContainText('archived');

    // An archived profile is not a Student Mode the device can sit in.
    await page.goto('/student');
    await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
  });
});
