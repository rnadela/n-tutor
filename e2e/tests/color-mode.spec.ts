import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createGradeLevelFixture, uniqueParentEmail } from '../fixtures';

/**
 * The light/dark switch, asserted where the three things only a browser can
 * show actually happen: the `data-light` / `data-dark` attribute flip on
 * `<html>`, one stored mode shared across surfaces through a reload and a
 * sign-out, and a device preference that no longer overrides a held choice.
 *
 * Every unit-level claim — which scheme is in effect, what the next press is,
 * where the switch may appear, what the theme colour becomes — is pinned by
 * `apps/web/src/lib/color-mode.spec.ts` under the `node` runner. Nothing here
 * re-derives those; this file only observes what a real page does.
 */

const PASSWORD = 'correct-horse-battery-staple';
const PIN = '4821';

const OPERATOR_EMAIL = process.env.ADMIN_SEED_EMAIL ?? 'operator@example.test';
const OPERATOR_PASSWORD = process.env.ADMIN_SEED_PASSWORD ?? 'change-me-too';

const TO_DARK = 'Switch to dark mode';
const TO_LIGHT = 'Switch to light mode';

/**
 * The brand ink, read out of `tokens.ts` itself rather than restated here —
 * `pwa-installability.spec.ts`'s own reason, and the same parser.
 */
function colorToken(name: string, scheme: 'light' | 'dark'): string {
  // `__dirname`, like `e2e/database.ts`: Playwright loads these specs as
  // CommonJS, where `import.meta` is a syntax error.
  const source = readFileSync(
    path.resolve(__dirname, '../../apps/web/src/theme/tokens.ts'),
    'utf8',
  );
  const pair = new RegExp(
    `${name}:\\s*\\{\\s*light:\\s*'(#[0-9A-Fa-f]{6})',\\s*dark:\\s*'(#[0-9A-Fa-f]{6})'`,
    'u',
  ).exec(source);
  expect(pair, `tokens.ts must declare ${name}`).not.toBeNull();
  return scheme === 'light' ? pair![1]! : pair![2]!;
}

/** Every `theme-color` meta's `content`, in document order. */
async function themeColors(page: Page): Promise<(string | null)[]> {
  return page
    .locator('meta[name="theme-color"]')
    .evaluateAll((metas) => metas.map((meta) => meta.getAttribute('content')));
}

/**
 * A value no token could produce, written into every `theme-color` meta so that
 * the next assertion observes a *write* rather than agreeing with the markup
 * the server already sent.
 *
 * Needed because `brandInk.light` and `brandInk.dark` are deliberately the same
 * value: without a sentinel, "both metas carry the dark ink" is true of a page
 * whose sync never ran at all.
 */
const SENTINEL = '#010203';

async function stampSentinel(page: Page): Promise<void> {
  const count = await page.evaluate((value) => {
    const metas = Array.from(document.querySelectorAll('meta[name="theme-color"]'));
    metas.forEach((meta) => meta.setAttribute('content', value));
    return metas.length;
  }, SENTINEL);
  // A page with no metas to stamp would make every assertion below vacuous.
  expect(count).toBeGreaterThan(0);
  expect(await themeColors(page)).toEqual(Array.from({ length: count }, () => SENTINEL));
}

/** Signs up and ends on the "Signed in" screen. */
async function signUp(page: Page, email: string): Promise<void> {
  await page.goto('/auth/sign-up');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByLabel('I accept the terms of use.').check();
  await page.getByLabel('I accept the notice on children’s data.').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Signed in' })).toBeVisible();
}

/** Signs up, sets the PIN, and ends standing in Parent View. */
async function enterParentView(page: Page): Promise<string> {
  const email = uniqueParentEmail('color-mode');
  await signUp(page, email);
  await page.getByRole('link', { name: 'Enter Parent View' }).click();
  await expect(page.getByRole('heading', { name: 'Set a PIN for Parent View' })).toBeVisible();
  await page.locator('#parent-pin').fill(PIN);
  await page.getByRole('button', { name: 'Save the PIN' }).click();
  await expect(
    page.getByRole('heading', { name: 'Parent View', level: 1, exact: true }),
  ).toBeVisible();
  return email;
}

/**
 * Moves inside Parent View by its own nav, never by a `goto`: the elevation the
 * PIN granted does not survive a full page load, so a hard navigation lands on
 * the PIN gate rather than the screen asked for.
 */
async function parentNav(page: Page, label: string): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Parent View' })
    .getByRole('link', { name: label })
    .click();
}

/** Adds one profile from the Students screen, so Student Mode has a child. */
async function addFirstProfile(page: Page, name: string, gradeLevel: string): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Student Profiles', level: 1 })).toBeVisible();
  await page.locator('#student-name').fill(name);
  // A MUI select is a listbox, not a `<select>`: open it, then pick an option.
  await page.locator('[role="combobox"]#student-grade-level').click();
  await page.getByRole('option', { name: gradeLevel }).click();
  await expect(page.getByRole('listbox')).toBeHidden();
  await page.getByRole('button', { name: 'Add the profile' }).click();
  await expect(page.locator('main').getByRole('status')).toContainText(name);
}

test.describe('the light and dark mode switch', () => {
  // Every test in this file starts from a light-preference device, so "the
  // first press off the device preference" is a thing it can assert.
  test.use({ colorScheme: 'light' });

  test('follows the device until it is pressed, then holds the choice', async ({ page }) => {
    await page.goto('/auth/sign-in');

    // Nothing has been chosen, so the device's own light preference decides —
    // and MUI's selector is `data-light` / `data-dark`, not a `data-mui-*`
    // attribute.
    await expect(page.locator('html')).toHaveAttribute('data-light', '');
    const toDark = page.getByRole('button', { name: TO_DARK });
    await expect(toDark).toBeVisible();

    // Wiped first, so what the press does to the metas is visible: both tokens
    // hold the same value, and the server already sent the one we expect.
    await stampSentinel(page);

    await toDark.click();

    // The other scheme, at once: the attribute flips and the control now
    // describes the press back.
    await expect(page.locator('html')).toHaveAttribute('data-dark', '');
    await expect(page.locator('html')).not.toHaveAttribute('data-light', '');
    await expect(page.getByRole('button', { name: TO_LIGHT })).toBeVisible();
    await expect(page.getByRole('button', { name: TO_DARK })).toHaveCount(0);

    // The browser chrome follows the chosen mode, in both metas — the pair the
    // server emitted is media-scoped and whichever one matches has to be right,
    // which is why they are rewritten rather than joined by a third. The
    // sentinel is gone, so this is the sync's own write and not the markup's.
    const dark = colorToken('brandInk', 'dark');
    await expect.poll(() => themeColors(page)).toEqual([dark, dark]);

    // Still dark after a reload, from the first paint: the init script reads
    // the stored mode before anything is drawn.
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-dark', '');
    await expect(page.getByRole('button', { name: TO_LIGHT })).toBeVisible();

    // And the device preference stops deciding, in both directions it could
    // move. Emulating *dark* agrees with the held choice and so proves nothing
    // on its own; emulating *light* afterwards is the one that would clobber a
    // mode still being read off the media query.
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-dark', '');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-dark', '');
    await expect(page.locator('html')).not.toHaveAttribute('data-light', '');
    await expect(page.getByRole('button', { name: TO_LIGHT })).toBeVisible();
  });

  test('holds a chosen light mode against a device that prefers dark', async ({ page }) => {
    // The converse of the case above, and the half a light-only emulation
    // cannot reach: a family on a dark tablet who wants the light theme.
    await page.goto('/auth/sign-in');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-dark', '');

    // The first press off the device preference lands on the opposite of what
    // is actually on screen, not on dark again.
    await stampSentinel(page);
    await page.getByRole('button', { name: TO_LIGHT }).click();
    await expect(page.locator('html')).toHaveAttribute('data-light', '');
    await expect(page.locator('html')).not.toHaveAttribute('data-dark', '');
    await expect(page.getByRole('button', { name: TO_DARK })).toBeVisible();

    const light = colorToken('brandInk', 'light');
    await expect.poll(() => themeColors(page)).toEqual([light, light]);

    // And it survives the reload with the dark preference still in force.
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-light', '');
    await expect(page.getByRole('button', { name: TO_DARK })).toBeVisible();
  });

  test('says what the next press does to a keyboard, not only to a mouse', async ({ page }) => {
    // UX-DR45: the tooltip answers focus as well as hover, because a keyboard
    // is how this control is reached by anyone who cannot see the glyph.
    await page.goto('/auth/sign-in');
    const toDark = page.getByRole('button', { name: TO_DARK });
    await expect(toDark).toBeVisible();

    await toDark.focus();
    await expect(toDark).toBeFocused();
    // The tooltip itself, not the button's own accessible name: scoped to the
    // `tooltip` role so a passing assertion cannot be the `aria-label`.
    await expect(page.getByRole('tooltip')).toHaveText(TO_DARK);
  });

  test('shares the one stored mode with a surface that shows no switch', async ({ page }) => {
    await page.goto('/auth/sign-in');
    await page.getByRole('button', { name: TO_DARK }).click();
    await expect(page.locator('html')).toHaveAttribute('data-dark', '');

    // `/admin/login` is a bare centred surface before any chrome, so it carries
    // no switch — and it is dark anyway, because the mode is the document's and
    // not the header's.
    await page.goto('/admin/login');
    await expect(page.locator('html')).toHaveAttribute('data-dark', '');
    await expect(page.getByRole('button', { name: TO_DARK })).toHaveCount(0);
    await expect(page.getByRole('button', { name: TO_LIGHT })).toHaveCount(0);

    // `/parent/pin` is the other one, and it is asserted in the signed-in test
    // below: reached without a session it sends the device to sign-in, which
    // *does* carry a switch, so this is not the place to claim it has none.
  });

  test('gives an operator the same control in the same corner', async ({ page }) => {
    await page.goto('/auth/sign-in');
    await page.getByRole('button', { name: TO_DARK }).click();
    await expect(page.locator('html')).toHaveAttribute('data-dark', '');

    await page.goto('/admin/login');
    await page.getByLabel('Email').fill(OPERATOR_EMAIL);
    await page.getByLabel(/^Password/).fill(OPERATOR_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Subjects & Grade Levels' })).toBeVisible();

    // The mode a family chose on the sign-in surface is the mode the console
    // opens in, and the header's switch reads for the way back.
    await expect(page.locator('html')).toHaveAttribute('data-dark', '');
    const toLight = page.getByRole('button', { name: TO_LIGHT });
    await expect(toLight).toBeVisible();

    await stampSentinel(page);
    await toLight.click();
    await expect(page.locator('html')).toHaveAttribute('data-light', '');
    await expect(page.getByRole('button', { name: TO_DARK })).toBeVisible();
    const light = colorToken('brandInk', 'light');
    await expect.poll(() => themeColors(page)).toEqual([light, light]);
  });

  test('is on Parent View and Student home, and on neither excluded screen', async ({ page }) => {
    const grade = await createGradeLevelFixture('Grade');
    await enterParentView(page);

    // A profile first: the way out of Parent View only appears once the device
    // has a child to hand back to, and the switch's placement is stated
    // relative to it. Reached by the nav link rather than a `goto`, because
    // Parent View's elevation is not survived by a full page load — a hard
    // navigation lands on the PIN gate instead.
    await parentNav(page, 'Student Profiles');
    await addFirstProfile(page, 'Noah', grade.name);

    // A client-side navigation re-emits the root `viewport` metadata, which
    // puts the device-scoped pair back in the head — the sentinel below is gone
    // after the nav without anything of ours running.
    //
    // **What this case can and cannot show.** That the chosen scheme's ink is
    // in both metas after a client-side nav, it shows. That it got there from
    // `ColorModeMeta`'s re-sync rather than from Next's own re-emission, it
    // cannot: `brandInk.light` and `brandInk.dark` are the same value today
    // (`tokens.ts`, a deliberate duplicate), so the two outcomes are
    // byte-identical. The `pathname` dependency that makes the re-sync happen
    // is pinned at the source in `ColorModeMeta.spec.ts` instead, and this
    // assertion is the end-to-end floor: whatever the mechanism, the title bar
    // is not left on a stale colour.
    await page.getByRole('button', { name: TO_DARK }).click();
    await expect(page.locator('html')).toHaveAttribute('data-dark', '');
    const darkInk = colorToken('brandInk', 'dark');
    await stampSentinel(page);
    await parentNav(page, 'Parent View');
    await expect(page).toHaveURL(/\/parent$/u);
    await expect.poll(() => themeColors(page)).toEqual([darkInk, darkInk]);

    // Back to the chosen-light starting point for the placement assertions
    // below, which name the control by the press it offers.
    await page.getByRole('button', { name: TO_LIGHT }).click();
    await expect(page.locator('html')).toHaveAttribute('data-light', '');
    await parentNav(page, 'Student Profiles');
    await expect(page.getByRole('heading', { name: 'Student Profiles', level: 1 })).toBeVisible();

    // Parent View's header, before the way out of Parent View.
    const exit = page.getByRole('button', { name: 'Back to Student Mode' });
    await expect(exit).toBeVisible();
    const switchBox = await page.getByRole('button', { name: TO_DARK }).boundingBox();
    const exitBox = await exit.boundingBox();
    expect(switchBox).not.toBeNull();
    expect(exitBox).not.toBeNull();
    expect(switchBox!.x).toBeLessThan(exitBox!.x);

    // The capture screen sits under this very header, and is the one Parent
    // View screen that must not carry it: the exit is still there, the switch
    // is gone.
    await parentNav(page, 'Upload a test');
    await expect(page).toHaveURL(/\/parent\/capture$/u);
    await expect(page.getByRole('button', { name: 'Back to Student Mode' })).toBeVisible();
    await expect(page.getByRole('button', { name: TO_DARK })).toHaveCount(0);
    await expect(page.getByRole('button', { name: TO_LIGHT })).toHaveCount(0);

    await page.getByRole('button', { name: 'Back to Student Mode' }).click();
    await expect(page.getByRole('heading', { name: 'Your practice', level: 1 })).toBeVisible();

    // Student home carries exactly one, beside the way into Parent View — and
    // pressing it there is the same single stored mode.
    const studentSwitch = page.getByRole('button', { name: TO_DARK });
    await expect(studentSwitch).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Parent' })).toBeVisible();
    await studentSwitch.click();
    await expect(page.locator('html')).toHaveAttribute('data-dark', '');

    // The Attempt carries no chrome at all, so it carries no switch — asserted
    // on the route rather than on a seeded test, because the thing being
    // claimed is "this route group has nowhere to put one", which is true of
    // every screen under it.
    await page.goto('/student/tests/00000000-0000-0000-0000-000000000000');
    // The URL first: were this route ever to bounce to sign-in, counting
    // switches would pass on a surface that carries one.
    await expect(page).toHaveURL(/\/student\/tests\//u);
    await expect(page.getByRole('button', { name: TO_DARK })).toHaveCount(0);
    await expect(page.getByRole('button', { name: TO_LIGHT })).toHaveCount(0);

    // The PIN gate returns a bare centred surface before Parent View's header
    // exists, so it carries no switch — and it is dark regardless, because the
    // mode belongs to the document and not to a header.
    await page.goto('/parent/pin');
    await expect(page.getByRole('heading', { name: 'Enter your PIN', level: 1 })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-dark', '');
    await expect(page.getByRole('button', { name: TO_DARK })).toHaveCount(0);
    await expect(page.getByRole('button', { name: TO_LIGHT })).toHaveCount(0);

    // The choice survives signing out, because it was never an account's.
    await page.goto('/auth/sign-in');
    await expect(page.locator('html')).toHaveAttribute('data-dark', '');
    await expect(page.getByRole('button', { name: TO_LIGHT })).toBeVisible();
  });

  test('still repaints on a device whose storage refuses the write', async ({ page }) => {
    // A private window, or a browser with site data blocked, throws on
    // `setItem`. MUI swallows that, so the press is still worth making: it
    // changes the page for this visit and simply has nothing to remember it
    // by. The failure this rules out is a thrown `SecurityError` taking the
    // header down over a theme.
    await page.addInitScript(() => {
      Object.defineProperty(window.localStorage, 'setItem', {
        configurable: true,
        value: () => {
          throw new DOMException('blocked', 'SecurityError');
        },
      });
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/auth/sign-in');
    await expect(page.locator('html')).toHaveAttribute('data-light', '');

    await page.getByRole('button', { name: TO_DARK }).click();
    await expect(page.locator('html')).toHaveAttribute('data-dark', '');
    await expect(page.getByRole('button', { name: TO_LIGHT })).toBeVisible();
    expect(errors).toEqual([]);

    // Nothing was kept, so the next visit is the device's preference again.
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-light', '');
    await expect(page.getByRole('button', { name: TO_DARK })).toBeVisible();
    expect(errors).toEqual([]);
  });
});
