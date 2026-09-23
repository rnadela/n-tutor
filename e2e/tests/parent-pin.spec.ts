import { expect, test, type Page } from '@playwright/test';
import { uniqueParentEmail } from '../fixtures';

const PASSWORD = 'correct-horse-battery-staple';
const PIN = '4821';
const WRONG_PIN = '1357';
const NEW_PIN = '9042';

async function signUp(page: Page, email: string): Promise<void> {
  await page.goto('/auth/sign-up');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByLabel('I accept the terms of use.').check();
  await page.getByLabel('I accept the notice on children’s data.').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Signed in' })).toBeVisible();
}

/** The entry point a signed-in parent actually uses. */
async function openTheGate(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Enter Parent View' }).click();
}

/** Alerts inside the card, never Next's own route announcer. */
function alert(page: Page) {
  return page.locator('main').getByRole('alert');
}

async function enterPin(page: Page, pin: string): Promise<void> {
  const submit = page.getByRole('button', { name: /Save the PIN|Enter Parent View/ });
  // A refused entry clears the field; typing into it before that lands would
  // submit an empty PIN instead of the one under test.
  await expect(submit).toBeEnabled();
  await page.locator('#parent-pin').fill(pin);
  await submit.click();
}

/**
 * Ends Parent View the way anything other than the handover does: a full load,
 * which unmounts the provider holding the elevation token.
 *
 * "Back to Student Mode" — the one control that leaves Parent View — hands the
 * device to a child, and these accounts have no child to hand it to. Its
 * no-profile branch is asserted on its own below.
 */
async function leaveParentView(page: Page): Promise<void> {
  await page.goto('/auth/signed-in');
  await expect(page.getByRole('heading', { name: 'Signed in' })).toBeVisible();
}

/**
 * A signed-up parent who has set a PIN and is standing in Parent View.
 *
 * The Parent View heading is matched `exact`: `getByRole` matches a name by
 * substring, and the first-PIN screen is itself headed "Set a PIN for Parent
 * View" — so a loose match reports Parent View as reached while the browser is
 * still standing at the gate, and everything after it races the PIN submit.
 */
async function signUpAndSetPin(page: Page): Promise<string> {
  const email = uniqueParentEmail('pin');
  await signUp(page, email);
  await openTheGate(page);
  await expect(page.getByRole('heading', { name: 'Set a PIN for Parent View' })).toBeVisible();
  await enterPin(page, PIN);
  await expect(
    page.getByRole('heading', { name: 'Parent View', level: 1, exact: true }),
  ).toBeVisible();
  return email;
}

test.describe('the Parent View PIN gate', () => {
  test('sets a PIN, enters Parent View, and is asked again after a reload', async ({ page }) => {
    const email = await signUpAndSetPin(page);
    await expect(page.getByText(email)).toBeVisible();

    // The elevation token lives in memory alone, so a reload destroys it and
    // the gate goes back up — with nothing left behind in any browser storage.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Enter your PIN' })).toBeVisible();

    const residue = await page.evaluate(() => ({
      local: Object.entries({ ...window.localStorage }),
      session: Object.entries({ ...window.sessionStorage }),
      cookie: document.cookie,
    }));
    expect(residue.local).toEqual([]);
    expect(residue.session).toEqual([]);
    // The session cookie is httpOnly, so nothing readable is here at all.
    expect(residue.cookie).toBe('');

    // And the same PIN opens it again.
    await enterPin(page, PIN);
    await expect(
      page.getByRole('heading', { name: 'Parent View', level: 1, exact: true }),
    ).toBeVisible();
  });

  test('sends a parent with no elevation straight back to the PIN', async ({ page }) => {
    await signUpAndSetPin(page);
    await page.goto('/parent');
    await expect(page.getByRole('heading', { name: 'Enter your PIN' })).toBeVisible();
  });

  test('says there is no child to hand the device to, and still leaves', async ({ page }) => {
    await signUpAndSetPin(page);
    // The exit is a handover, so an account with no profile has nothing to hand
    // the device to — the control says so rather than offering an empty list.
    await page.getByRole('button', { name: 'Back to Student Mode' }).click();
    await expect(page.getByRole('dialog')).toContainText('no profile');

    await page.getByRole('button', { name: 'Leave Parent View' }).click();
    await expect(page.getByRole('heading', { name: 'Signed in' })).toBeVisible();

    await openTheGate(page);
    await expect(page.getByRole('heading', { name: 'Enter your PIN' })).toBeVisible();
  });

  test('locks the gate after three wrong entries, and the lock survives a reload', async ({
    page,
  }) => {
    await signUpAndSetPin(page);
    await leaveParentView(page);
    await openTheGate(page);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await enterPin(page, WRONG_PIN);
      await expect(alert(page)).toBeVisible();
    }

    const locked = alert(page);
    await expect(locked).toContainText('locked');
    // The copy names when the lock lifts rather than counting attempts.
    await expect(locked).toContainText(/unlocks at \d/);
    await expect(locked).not.toContainText(/attempt/i);
    await expect(page.getByRole('button', { name: 'Enter Parent View' })).toBeDisabled();

    // The lock is a row, not a page's memory of one.
    await page.reload();
    await expect(alert(page)).toContainText('locked');
    await expect(page.getByRole('button', { name: 'Enter Parent View' })).toBeDisabled();

    // Even the correct PIN is refused while the cool-down runs: the field
    // itself is closed, so there is nothing to submit.
    await expect(page.locator('#parent-pin')).toBeDisabled();
  });

  test('changes the PIN, after which the old one is refused and the new one works', async ({
    page,
  }) => {
    await signUpAndSetPin(page);
    await page.getByRole('link', { name: 'Change PIN' }).click();
    await expect(page.getByRole('heading', { name: 'Change your PIN' })).toBeVisible();

    await page.locator('#parent-new-pin').fill(NEW_PIN);
    await page.locator('#parent-confirm-new-pin').fill(NEW_PIN);
    await page.locator('#parent-current-pin').fill(PIN);
    await page.getByRole('button', { name: 'Save the new PIN' }).click();
    await expect(page.locator('main').getByRole('status')).toContainText('saved');

    await page.getByRole('link', { name: 'Back to Parent View' }).click();
    await leaveParentView(page);
    await openTheGate(page);

    await enterPin(page, PIN);
    await expect(alert(page)).toBeVisible();
    await expect(alert(page)).not.toContainText(PIN);

    await enterPin(page, NEW_PIN);
    await expect(
      page.getByRole('heading', { name: 'Parent View', level: 1, exact: true }),
    ).toBeVisible();
  });

  test('refuses a change whose two new-PIN entries do not match, without calling the API', async ({
    page,
  }) => {
    await signUpAndSetPin(page);
    await page.getByRole('link', { name: 'Change PIN' }).click();
    await expect(page.getByRole('heading', { name: 'Change your PIN' })).toBeVisible();

    await page.locator('#parent-new-pin').fill(NEW_PIN);
    await page.locator('#parent-confirm-new-pin').fill(WRONG_PIN);
    await page.locator('#parent-current-pin').fill(PIN);
    await page.getByRole('button', { name: 'Save the new PIN' }).click();
    await expect(alert(page)).toContainText('do not match');

    // The rejected change never reached the API: the old PIN still works.
    await page.getByRole('link', { name: 'Back to Parent View' }).click();
    await leaveParentView(page);
    await openTheGate(page);
    await enterPin(page, PIN);
    await expect(
      page.getByRole('heading', { name: 'Parent View', level: 1, exact: true }),
    ).toBeVisible();
  });

  test('never renders the PIN back, in the field or in a response', async ({ page }) => {
    const bodies: string[] = [];
    page.on('response', (response) => {
      if (!response.url().includes('/api/parent/')) return;
      void response
        .text()
        .then((text) => bodies.push(text))
        .catch(() => undefined);
    });

    await signUp(page, uniqueParentEmail('pin-secrecy'));
    await openTheGate(page);

    const field = page.locator('#parent-pin');
    await field.fill(PIN);
    // Obscured in the DOM, not merely styled to look it.
    await expect(field).toHaveAttribute('type', 'password');

    await page.getByRole('button', { name: 'Save the PIN' }).click();
    await expect(
      page.getByRole('heading', { name: 'Parent View', level: 1, exact: true }),
    ).toBeVisible();

    await expect(page.locator('body')).not.toContainText(PIN);
    for (const body of bodies) {
      expect(body).not.toContain(PIN);
      expect(body).not.toContain('argon2');
    }
  });
});
