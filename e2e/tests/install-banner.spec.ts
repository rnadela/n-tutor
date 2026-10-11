import { expect, test, type Browser, type Page } from '@playwright/test';
import { createGradeLevelFixture, uniqueParentEmail } from '../fixtures';

/**
 * The install banner, asserted where a browser actually meets it.
 *
 * Every unit spec for this story reads a rule's return value or a component's
 * markup, which proves what the code says and not what a loaded page does: the
 * `beforeinstallprompt` event is caught by a mount in the root layout, held in
 * a module-level store, and read by a component two trees away. Nothing short
 * of a real page proves that chain joins up.
 *
 * Chromium never fires `beforeinstallprompt` under automation — the heuristics
 * behind it involve engagement the suite cannot fake — so the event is
 * synthesised. The init script below wraps `window.addEventListener`, so the
 * moment the app's own capture subscribes, a stand-in event is delivered to it.
 * That is the one honest way to drive this: the product code is untouched, and
 * what is faked is the browser's offer rather than anything the banner does
 * with it.
 */

const PASSWORD = 'correct-horse-battery-staple';
const PIN = '4821';

/**
 * Delivers a synthetic install offer to whoever subscribes to it, and records
 * whether `prompt()` was ever called.
 *
 * The outcome is a parameter because the two halves of the story need different
 * answers from the same browser: a refusal leaves the banner standing, which is
 * what the placement assertions are about, and an acceptance is the only thing
 * that proves the banner leaves for good.
 */
function offerAnInstall(outcome: 'accepted' | 'dismissed'): string {
  return `
  (() => {
    const realAdd = window.addEventListener.bind(window);
    window.__installPromptCalls = 0;
    window.addEventListener = (type, listener, options) => {
      realAdd(type, listener, options);
      if (type !== 'beforeinstallprompt' || typeof listener !== 'function') return;
      const event = {
        type: 'beforeinstallprompt',
        preventDefault() {
          window.__installPromptPrevented = true;
        },
        prompt() {
          window.__installPromptCalls += 1;
          return Promise.resolve({ outcome: '${outcome}' });
        },
      };
      setTimeout(() => listener(event), 0);
    };
  })();
`;
}

/** An offer the person turns down, so the banner is still there afterwards. */
const OFFER_AN_INSTALL = offerAnInstall('dismissed');
/** An offer the person accepts, which is what takes the banner away for good. */
const ACCEPT_AN_INSTALL = offerAnInstall('accepted');

/**
 * What an installed window looks like from inside: the display-mode query
 * matches.
 *
 * Emulated in the page rather than over CDP, because `Emulation.setEmulatedMedia`
 * does not move `display-mode` in this Chromium — asserted before relying on it,
 * and `matchMedia` reported `false` with the feature set, with `media` set
 * alongside it, and after a reload. So the browser's answer to that one query is
 * replaced and every other query passes through to the real implementation,
 * which is the same shape of stand-in as the install offer above: what is faked
 * is the browser's signal, and the product's own reading of it is what runs.
 */
const ALREADY_INSTALLED = `
  (() => {
    const realMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query) =>
      query === '(display-mode: standalone)'
        ? {
            matches: true,
            media: query,
            onchange: null,
            addListener() {},
            removeListener() {},
            addEventListener() {},
            removeEventListener() {},
            dispatchEvent: () => false,
          }
        : realMatchMedia(query);
  })();
`;

function banner(page: Page) {
  return page.getByRole('region', { name: 'Install n-tutor' });
}

async function signUp(page: Page, email: string): Promise<void> {
  await page.goto('/auth/sign-up');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByLabel('I accept the terms of use.').check();
  await page.getByLabel('I accept the notice on children’s data.').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Signed in' })).toBeVisible();
}

/** Signs up and stops on the set-a-PIN gate, which is a Parent View screen. */
async function reachTheGate(page: Page): Promise<string> {
  const email = uniqueParentEmail('install-banner');
  await signUp(page, email);
  await page.getByRole('link', { name: 'Enter Parent View' }).click();
  await expect(page.getByRole('heading', { name: 'Set a PIN for Parent View' })).toBeVisible();
  return email;
}

async function setThePin(page: Page): Promise<void> {
  await page.locator('#parent-pin').fill(PIN);
  await page.getByRole('button', { name: 'Save the PIN' }).click();
  await expect(
    page.getByRole('heading', { name: 'Parent View', level: 1, exact: true }),
  ).toBeVisible();
}

/**
 * A MUI select is a listbox, not a `<select>`: open it, then pick an option —
 * the same route `student-mode.spec.ts` takes.
 */
async function chooseGradeLevel(page: Page, selectId: string, name: string): Promise<void> {
  await page.locator(`[role="combobox"]#${selectId}`).click();
  await page.getByRole('option', { name }).click();
  await expect(page.getByRole('listbox')).toBeHidden();
}

/**
 * Signs up, sets the PIN, binds the device to one child, and lands on Student
 * Mode Home — the only Student Mode screen the banner is on, and the one the
 * front door goes to once a profile exists.
 */
async function reachStudentHome(page: Page, gradeLevel: string): Promise<void> {
  await reachTheGate(page);
  await setThePin(page);
  await page
    .getByRole('navigation', { name: 'Parent View' })
    .getByRole('link', { name: 'Student Profiles' })
    .click();
  await expect(page.getByRole('heading', { name: 'Student Profiles', level: 1 })).toBeVisible();
  await page.locator('#student-name').fill('Ada');
  await chooseGradeLevel(page, 'student-grade-level', gradeLevel);
  await page.getByRole('button', { name: 'Add the profile' }).click();
  await expect(page.locator('main').getByRole('status')).toContainText('Ada');

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your practice', level: 1 })).toBeVisible();
}

/** A second device for the same account: a new context, with the offer armed. */
async function freshContext(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  await context.addInitScript(OFFER_AN_INSTALL);
  return context.newPage();
}

test.describe('the install banner on Parent View', () => {
  test('offers the install, calls the deferred prompt, and stays off camera capture', async ({
    page,
  }) => {
    await page.addInitScript(OFFER_AN_INSTALL);
    await reachTheGate(page);

    // The gate is a Parent View screen with its own early return, so the shell
    // mounts the banner in that branch too.
    await expect(banner(page)).toBeVisible();
    // The browser's own mini-infobar must not compete with it.
    expect(await page.evaluate(() => window.__installPromptPrevented)).toBe(true);

    await setThePin(page);
    await expect(banner(page)).toBeVisible();

    const install = banner(page).getByRole('button', { name: 'Install' });
    await expect(install).toBeVisible();
    // Two synchronous native clicks in the same tick, so the second lands
    // before the first `prompt()` call has settled: the in-flight guard must
    // swallow it, or the platform's rejection of a second `prompt()` on the
    // same event would reach the person as two taps that did nothing.
    await install.evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    // The offer resolves `dismissed` here, so the banner is still standing and
    // the action can be taken again.
    await expect.poll(() => page.evaluate(() => window.__installPromptCalls)).toBe(1);
    await expect(banner(page)).toBeVisible();

    await page
      .getByRole('navigation', { name: 'Parent View' })
      .getByRole('link', { name: 'Upload a test' })
      .click();
    await expect(page).toHaveURL(/\/parent\/capture$/u);
    // The capture screen *is* the camera view; an offer appearing and
    // disappearing beside a viewfinder is the content shift the UX rules out.
    await expect(banner(page)).toHaveCount(0);

    await page
      .getByRole('navigation', { name: 'Parent View' })
      .getByRole('link', { name: 'Where a student is strong and weak' })
      .click();
    await expect(banner(page)).toBeVisible();
  });

  test('goes for good once the install is accepted', async ({ page }) => {
    await page.addInitScript(ACCEPT_AN_INSTALL);
    await reachTheGate(page);
    await setThePin(page);
    await expect(banner(page)).toBeVisible();

    await banner(page).getByRole('button', { name: 'Install' }).click();
    // The app is installed; an offer to install it again is the one thing the
    // banner must never do.
    await expect(banner(page)).toHaveCount(0);

    // And it stays gone across a reload in that tab, even though the stand-in
    // offers again on every load: accepting is a dismissal that lasts the
    // session, on top of the held event being dropped.
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Parent View', level: 1, exact: true }),
    ).toBeVisible();
    await expect(banner(page)).toHaveCount(0);
  });

  test('stays dismissed for the session, and comes back in a new one', async ({
    page,
    browser,
  }) => {
    await page.addInitScript(OFFER_AN_INSTALL);
    const email = await reachTheGate(page);
    await setThePin(page);
    await expect(banner(page)).toBeVisible();

    await banner(page).getByRole('button', { name: 'Dismiss' }).click();
    await expect(banner(page)).toHaveCount(0);

    // `sessionStorage` outlives a reload in the same tab, which is the whole
    // point of the dismissal lasting the session rather than the render.
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Parent View', level: 1, exact: true }),
    ).toBeVisible();
    await expect(banner(page)).toHaveCount(0);

    // A new context is a new session, and nothing about the dismissal was kept
    // past the tab — no `localStorage`, no cookie and no server record.
    const next = await freshContext(browser);
    await next.goto('/auth/sign-in');
    await next.getByLabel('Email').fill(email);
    await next.getByLabel(/^Password/).fill(PASSWORD);
    await next.getByRole('button', { name: 'Sign in' }).click();
    await expect(next.getByRole('heading', { name: 'Signed in' })).toBeVisible();
    await next.getByRole('link', { name: 'Enter Parent View' }).click();
    await expect(next.getByRole('heading', { name: 'Enter your PIN' })).toBeVisible();
    await expect(banner(next)).toBeVisible();
    await next.context().close();
  });

  test('is absent from an installed window', async ({ page }) => {
    await page.addInitScript(OFFER_AN_INSTALL);
    await page.addInitScript(ALREADY_INSTALLED);

    await reachTheGate(page);
    await expect(page.getByRole('heading', { name: 'Set a PIN for Parent View' })).toBeVisible();
    // An offer to install the app you are reading it inside.
    await expect(banner(page)).toHaveCount(0);

    await setThePin(page);
    await expect(banner(page)).toHaveCount(0);
    // And the offer really was made: what suppressed the banner is the
    // emulated display mode, not a missing event.
    expect(await page.evaluate(() => window.__installPromptPrevented)).toBe(true);
  });
});

test.describe('the install banner on Student Mode Home', () => {
  test('offers the install to the child in their own words, and dismisses', async ({ page }) => {
    const grade = await createGradeLevelFixture('Grade');
    await page.addInitScript(OFFER_AN_INSTALL);
    await reachStudentHome(page, grade.name);

    const home = banner(page);
    await expect(home).toBeVisible();
    // The child's sentence, not the parent's: Student Mode addresses the
    // reader in the second person throughout, and the parent's line talks
    // about "this device" to somebody else.
    await expect(home).toContainText('Add n-tutor to your home screen');
    await expect(home).not.toContainText('this device’s home screen');

    const install = home.getByRole('button', { name: 'Install' });
    await expect(install).toBeVisible();
    await install.click();
    await expect.poll(() => page.evaluate(() => window.__installPromptCalls)).toBe(1);
    // The offer was refused, so it is still standing.
    await expect(home).toBeVisible();

    await home.getByRole('button', { name: 'Dismiss' }).click();
    await expect(banner(page)).toHaveCount(0);
    // And the screen underneath it is untouched: the banner was never a
    // condition of Student Home rendering.
    await expect(page.getByRole('heading', { name: 'Your practice', level: 1 })).toBeVisible();
    await expect(page.getByText('Hello, Ada.')).toBeVisible();
  });

  test('is absent from a Student Mode screen that is not Home', async ({ page }) => {
    const grade = await createGradeLevelFixture('Grade');
    await page.addInitScript(OFFER_AN_INSTALL);
    await reachStudentHome(page, grade.name);
    await expect(banner(page)).toBeVisible();

    // Nothing has been released for this child, so there is no Take Test to
    // walk into: the rule is asserted on the route itself, which is where the
    // placement decision is made.
    await page.goto('/student/tests/00000000-0000-0000-0000-000000000000');
    await expect(banner(page)).toHaveCount(0);
  });
});

declare global {
  interface Window {
    __installPromptCalls: number;
    __installPromptPrevented?: boolean;
  }
}
