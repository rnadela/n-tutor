import { expect, test, type Page } from '@playwright/test';
import { createGradeLevelFixture, uniqueParentEmail } from '../fixtures';

const PASSWORD = 'correct-horse-battery-staple';
const PIN = '4821';
const WRONG_PIN = '1357';

/**
 * The idle window, read from the same expression `playwright.config.ts` reads
 * when it states the API's environment. Every fast-forward below is a multiple
 * of it rather than a clock time of its own, so an override moves this suite
 * with the server instead of leaving it quietly asserting fifteen minutes.
 *
 * Only the *browser's* clock is ever moved here — the server's runs at real
 * speed throughout, which is exactly the case this story is about: a parent who
 * walked away while their token was still perfectly refreshable.
 */
const WINDOW_MS = Number(process.env.ELEVATION_TTL_SECONDS ?? '900') * 1000;

/** Comfortably more than one window, and comfortably less than two. */
const PAST_THE_WINDOW = Math.ceil(WINDOW_MS * 1.1);

/** Half a window: the refresh threshold, and still short of the deadline. */
const HALF_THE_WINDOW = Math.ceil(WINDOW_MS / 2);

/**
 * A step well short of the refresh threshold, so an active parent is refreshed
 * rather than dropped — and so a replacement always has real time to land long
 * before the token it replaces would have died.
 */
const WITHIN_THE_WINDOW = Math.ceil(WINDOW_MS / 8);

async function signUp(page: Page, email: string): Promise<void> {
  await page.goto('/auth/sign-up');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByLabel('I accept the terms of use.').check();
  await page.getByLabel('I accept the notice on children’s data.').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Signed in' })).toBeVisible();
}

async function chooseGradeLevel(page: Page, selectId: string, name: string): Promise<void> {
  await page.locator(`[role="combobox"]#${selectId}`).click();
  await page.getByRole('option', { name }).click();
  await expect(page.getByRole('listbox')).toBeHidden();
}

/**
 * A signed-up parent, a PIN, one child, and a device handed over to them — the
 * state every case here starts from, because expiry lands on Student Mode and
 * there has to be a Student Mode to land on.
 *
 * Done before the browser's clock is replaced: a faked clock stalls the MUI
 * transitions this setup clicks through, and none of it is what is under test.
 */
async function handOverTheDevice(page: Page, child: string): Promise<void> {
  const grade = await createGradeLevelFixture('Grade');
  await signUp(page, uniqueParentEmail('idle-expiry'));
  await page.getByRole('link', { name: 'Enter Parent View' }).click();
  await expect(page.getByRole('heading', { name: 'Set a PIN for Parent View' })).toBeVisible();
  await page.locator('#parent-pin').fill(PIN);
  await page.getByRole('button', { name: 'Save the PIN' }).click();
  await expect(parentViewHeading(page)).toBeVisible();

  await page.getByRole('link', { name: 'Student Profiles' }).click();
  await expect(page.getByRole('heading', { name: 'Student Profiles', level: 1 })).toBeVisible();
  await page.locator('#student-name').fill(child);
  await chooseGradeLevel(page, 'student-grade-level', grade.name);
  await page.getByRole('button', { name: 'Add the profile' }).click();
  await expect(page.locator('main').getByRole('status')).toContainText(child);

  // One child is no choice at all: the exit binds the device and goes.
  await page.getByRole('button', { name: 'Back to Student Mode' }).click();
  await expect(page.getByRole('heading', { name: 'Your practice', level: 1 })).toBeVisible();
}

/**
 * Parent View's own heading, matched exactly.
 *
 * `getByRole` matches a name by substring, and the first-PIN screen is headed
 * "Set a PIN for Parent View" — so a loose match reports Parent View as reached
 * while the browser is still standing at the gate, and everything after it
 * asserts against the wrong screen.
 */
function parentViewHeading(page: Page) {
  return page.getByRole('heading', { name: 'Parent View', level: 1, exact: true });
}

/** Crosses the PIN from wherever the browser is standing. */
async function enterParentView(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Enter your PIN' })).toBeVisible();
  await page.locator('#parent-pin').fill(PIN);
  await page.getByRole('button', { name: 'Enter Parent View' }).click();
  await expect(parentViewHeading(page)).toBeVisible();
}

/**
 * Installs the browser's own clock and opens Student Mode on it, then crosses
 * the PIN. Everything after this point ages at the speed the test chooses.
 */
async function enterParentViewOnAFakeClock(page: Page): Promise<void> {
  // Safe to install before these two screens, unlike the setup above: Student
  // Mode and the PIN gate are a link and a text field, with no MUI select or
  // dialog whose opening transition a frozen clock would stall.
  await page.clock.install();
  await page.goto('/student');
  await expect(page.getByRole('heading', { name: 'Your practice', level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'Parent' }).click();
  await enterParentView(page);
}

test.describe('Parent View’s idle window', () => {
  test('drops a parent who walked away onto Student Mode, silently', async ({ page }) => {
    await handOverTheDevice(page, 'Noah');
    await enterParentViewOnAFakeClock(page);

    // Nothing is touched: no pointer, no key, no scroll. The window lapses.
    await page.clock.fastForward(PAST_THE_WINDOW);

    await expect(page.getByRole('heading', { name: 'Your practice', level: 1 })).toBeVisible();
    await expect(page.getByText('Hello, Noah.')).toBeVisible();
    await expect(page).toHaveURL(/\/student$/u);

    // Nothing warned, counted down, or asked which profile to hand over to:
    // the device went back to the child it was already bound to.
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.locator('main').getByRole('alert')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(/expired|signed out|countdown/iu);
  });

  test('puts the PIN back in front of Parent View, cool-down included', async ({ page }) => {
    await handOverTheDevice(page, 'Noah');
    await enterParentViewOnAFakeClock(page);
    await page.clock.fastForward(PAST_THE_WINDOW);
    await expect(page.getByText('Hello, Noah.')).toBeVisible();

    // The browser's clock has been run ahead of the server's; the cool-down is
    // the server's figure, so the two are put back in step before it is
    // asserted on. Only the idle window was ever the thing being hurried.
    await page.clock.setSystemTime(new Date());
    await page.clock.resume();

    // Re-entry is the existing gate, unchanged.
    await page.getByRole('link', { name: 'Parent' }).click();
    await expect(page.getByRole('heading', { name: 'Enter your PIN' })).toBeVisible();

    const submit = page.getByRole('button', { name: 'Enter Parent View' });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(submit).toBeEnabled();
      await page.locator('#parent-pin').fill(WRONG_PIN);
      await submit.click();
      await expect(page.locator('main').getByRole('alert')).toBeVisible();
    }

    // Three wrong entries lock the gate, exactly as Story 1.2 defines.
    await expect(page.locator('main').getByRole('alert')).toContainText('locked');
    await expect(submit).toBeDisabled();
    await expect(page.locator('#parent-pin')).toBeDisabled();
  });

  test('refreshes a parent who keeps working, carrying the original ceiling', async ({ page }) => {
    await handOverTheDevice(page, 'Noah');

    // Every elevation the browser is handed: the one the PIN minted, and every
    // replacement the idle clock asked for.
    const elevations: Promise<{ status: number; ceilingAt: string | null }>[] = [];
    page.on('response', (response) => {
      const route = new URL(response.url()).pathname;
      if (!route.endsWith('/parent/pin/verify') && !route.endsWith('/parent/elevation/refresh')) {
        return;
      }
      elevations.push(
        response
          .json()
          .then((body: { ceilingAt?: string }) => ({
            status: response.status(),
            ceilingAt: body.ceilingAt ?? null,
          }))
          .catch(() => ({ status: response.status(), ceilingAt: null })),
      );
    });

    await enterParentViewOnAFakeClock(page);

    // Ten minutes of wall-clock time — past the refresh threshold — with a
    // keystroke every couple of minutes throughout. Only the browser's clock is
    // hurried here, and a replacement token is minted against the server's own
    // clock, so this case asserts the refresh rather than trying to carry a
    // session past an instant the server has not reached yet.
    for (let step = 0; step < 5; step += 1) {
      await page.keyboard.press('Tab');
      await page.clock.fastForward(WITHIN_THE_WINDOW);
      // Asserted every step, so a drop halfway through is not hidden by a
      // later refresh putting Parent View back.
      await expect(parentViewHeading(page)).toBeVisible();
    }

    await expect(page).toHaveURL(/\/parent$/u);

    const granted = await Promise.all(elevations);
    // A replacement was asked for and granted: Parent View continued because
    // the token was replaced, not because one outlived what the server stated.
    expect(granted.length).toBeGreaterThan(1);
    for (const elevation of granted) expect(elevation.status).toBe(200);
    // And every one of them carries the ceiling the PIN crossing set. A refresh
    // is a replacement, never an extension.
    expect(new Set(granted.map((elevation) => elevation.ceilingAt)).size).toBe(1);
    expect(granted[0]?.ceilingAt).not.toBeNull();
  });

  test('ends one window after the last interaction, not after the refresh', async ({ page }) => {
    await handOverTheDevice(page, 'Noah');
    await enterParentViewOnAFakeClock(page);

    // One keystroke, and then the parent walks away. The replacement token the
    // clock asks for on the way must not buy them a second window: the deadline
    // hangs off this keystroke, and an API call is not a parent.
    await page.keyboard.press('Tab');
    await page.clock.fastForward(PAST_THE_WINDOW);

    await expect(page.getByRole('heading', { name: 'Your practice', level: 1 })).toBeVisible();
    await expect(page.getByText('Hello, Noah.')).toBeVisible();
    await expect(page).toHaveURL(/\/student$/u);
  });

  test('expires the same way on every Parent View surface', async ({ page }) => {
    await handOverTheDevice(page, 'Noah');
    await enterParentViewOnAFakeClock(page);

    // The clock is mounted in the layout, so this is not `/parent`'s behaviour.
    await page.getByRole('link', { name: 'Student Profiles' }).click();
    await expect(page.getByRole('heading', { name: 'Student Profiles', level: 1 })).toBeVisible();

    await page.clock.fastForward(PAST_THE_WINDOW);
    await expect(page.getByRole('heading', { name: 'Your practice', level: 1 })).toBeVisible();
    await expect(page.getByText('Hello, Noah.')).toBeVisible();
  });

  test('does not count an API call as the parent being there', async ({ page }) => {
    await handOverTheDevice(page, 'Noah');
    await enterParentViewOnAFakeClock(page);

    // The Students screen fetches on its own. Reloading its data is a request,
    // not a parent — so the window lapses on schedule anyway.
    await page.getByRole('link', { name: 'Student Profiles' }).click();
    await expect(page.getByRole('heading', { name: 'Student Profiles', level: 1 })).toBeVisible();
    await page.clock.fastForward(HALF_THE_WINDOW);
    await expect(page.getByRole('heading', { name: 'Student Profiles', level: 1 })).toBeVisible();
    await page.clock.fastForward(PAST_THE_WINDOW);

    await expect(page.getByRole('heading', { name: 'Your practice', level: 1 })).toBeVisible();
  });

  test('sends a device with no child on to sign-in rather than a broken Student Mode', async ({
    page,
  }) => {
    // An account that has never created a profile has no Student Mode to be
    // returned to. Expiry still goes to `/student`, which refuses as not bound
    // and routes on — the parent is not left standing in Parent View.
    //
    // The clock is installed up front here, unlike in `handOverTheDevice`,
    // because this path clicks nothing whose opening a frozen clock would
    // stall: sign-up is checkboxes and a button, the PIN gate a text field.
    // There is no MUI select and no dialog anywhere in it.
    await page.clock.install();
    await signUp(page, uniqueParentEmail('idle-expiry-unbound'));
    await page.getByRole('link', { name: 'Enter Parent View' }).click();
    await expect(page.getByRole('heading', { name: 'Set a PIN for Parent View' })).toBeVisible();
    await page.locator('#parent-pin').fill(PIN);
    await page.getByRole('button', { name: 'Save the PIN' }).click();
    await expect(parentViewHeading(page)).toBeVisible();

    await page.clock.fastForward(PAST_THE_WINDOW);

    await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
    await expect(page).toHaveURL(/\/auth\/sign-in$/u);
  });
});
