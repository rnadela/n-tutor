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
    // Nothing has been released for this child, and the screen says so as a plain
    // sentence rather than showing an empty space. Asserted *visible* on purpose:
    // the repo's only other reference to this test id is a `toHaveCount(0)` in a
    // non-empty state, which the sentence never rendering at all would satisfy.
    await expect(page.getByTestId('student-empty')).toBeVisible();
    await expect(page.locator('[data-testid="student-practice-test"]')).toHaveCount(0);

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

  /**
   * The AD-26 sweep, at the two crossings that run it.
   *
   * A record belonging to another child is seeded directly rather than typed into a
   * practice test: what is being asserted is that the sweep **removes another
   * profile's key**, and the sweep is decided from the key rather than the payload —
   * so where the record came from changes nothing about the claim. (That the decision
   * is key-based and not payload-based is `attempt-store.spec.ts`'s.)
   *
   * Seeded twice on purpose, once per crossing. Either call site alone would satisfy a
   * single assertion, so deleting the other would go unnoticed.
   */
  test('leaves no other child’s answers on the device at either mode crossing', async ({
    page,
  }) => {
    const grade = await createGradeLevelFixture('Grade');
    await openStudents(page);
    await addProfile(page, 'Noah', grade.name);
    await addProfile(page, 'Mira', grade.name);

    const seed = () =>
      page.evaluate(() => {
        window.localStorage.setItem(
          'ntr.attempt.another-child.some-attempt',
          JSON.stringify({
            createdAt: Date.now(),
            profileId: 'another-child',
            attemptId: 'some-attempt',
            answers: { 'q-1': 'a sibling’s working' },
            index: 0,
            pendingSubmitAt: null,
          }),
        );
      });
    const attemptKeys = () =>
      page.evaluate(() =>
        Object.keys({ ...window.localStorage }).filter((key) => key.startsWith('ntr.attempt.')),
      );

    // --- Crossing one: the binding changes ---------------------------------
    await page.goto('/student');
    await expect(page.getByText('Hello, Noah.')).toBeVisible();
    await seed();
    expect(await attemptKeys()).toHaveLength(1);

    await page.getByRole('link', { name: 'Parent' }).click();
    await enterParentView(page);
    await page.getByRole('button', { name: 'Back to Student Mode' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('radio', { name: 'Mira' }).check();
    await dialog.getByRole('button', { name: 'Hand over the device' }).click();
    await expect(page.getByText('Hello, Mira.')).toBeVisible();

    // The device is Mira's now, and nothing of anyone else's work is on it.
    expect(await attemptKeys()).toEqual([]);

    // --- Crossing two: every child passes through Student Home -------------
    await seed();
    expect(await attemptKeys()).toHaveLength(1);
    await page.goto('/student');
    await expect(page.getByText('Hello, Mira.')).toBeVisible();

    await expect.poll(async () => (await attemptKeys()).length, { timeout: 10_000 }).toBe(0);
  });

  /**
   * The AD-26 sweep's third crossing: signing in.
   *
   * `sign-in/page.spec.tsx` only asserts the call is present in source, never that it
   * runs — this drives the real form and reads real `localStorage`, so a regression
   * that keeps the exact wording intact while breaking the effect (a guard that never
   * evaluates true, a stale `attemptStorage()` capture, an exception path that skips
   * it) would fail here even though it would not fail that spec.
   */
  test('clears every attempt record on sign-in, the third AD-26 crossing', async ({ page }) => {
    const email = uniqueParentEmail('sign-in-sweep');
    await page.goto('/auth/sign-up');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByLabel('I accept the terms of use.').check();
    await page.getByLabel('I accept the notice on children’s data.').check();
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { name: 'Signed in' })).toBeVisible();

    await page.evaluate(() => {
      window.localStorage.setItem(
        'ntr.attempt.another-child.some-attempt',
        JSON.stringify({
          createdAt: Date.now(),
          profileId: 'another-child',
          attemptId: 'some-attempt',
          answers: { 'q-1': 'a sibling’s working' },
          index: 0,
          pendingSubmitAt: null,
        }),
      );
    });
    const attemptKeyCount = () =>
      page.evaluate(
        () =>
          Object.keys({ ...window.localStorage }).filter((key) => key.startsWith('ntr.attempt.'))
            .length,
      );
    expect(await attemptKeyCount()).toBe(1);

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
    // Signing out is not a crossing this story adds a sweep for; the record must
    // still be there right up until the sign-in below is what clears it.
    expect(await attemptKeyCount()).toBe(1);

    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Signed in' })).toBeVisible();

    expect(await attemptKeyCount()).toBe(0);
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
