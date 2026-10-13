import { expect, test, type Locator, type Page } from '@playwright/test';
import { createGradeLevelFixture, uniqueParentEmail } from '../fixtures';

const PASSWORD = 'correct-horse-battery-staple';
const PIN = '4821';
/** The seeded operator, the way `admin-taxonomy.spec.ts` names it. */
const OPERATOR_EMAIL = process.env.ADMIN_SEED_EMAIL ?? 'operator@example.test';
const OPERATOR_PASSWORD = process.env.ADMIN_SEED_PASSWORD ?? 'change-me-too';

/** A phone, in portrait. Everything about the bar is stated at this size. */
const PHONE = { width: 390, height: 844 };
/** A tablet both ways up: still below `lg`, so still the bar. */
const TABLET_PORTRAIT = { width: 820, height: 1180 };
const TABLET_LANDSCAPE = { width: 1180, height: 820 };
/** A desktop: at and above `lg` (1200), so the sidebar and no bar. */
const DESKTOP = { width: 1280, height: 800 };

/** Parent View's four tabs plus its overflow action, in order. */
const PARENT_TABS = ['Home', 'Upload', 'Drafts', 'Attempts', 'More'];
/** The Admin console's five, in `SIDEBAR_ITEMS` order. There is no overflow. */
const ADMIN_TABS = ['Overview', 'Subjects', 'Accounts', 'Flagged', 'Topics'];

async function signUp(page: Page, email: string): Promise<void> {
  await page.goto('/auth/sign-up');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByLabel('I accept the terms of use.').check();
  await page.getByLabel('I accept the notice on children’s data.').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Signed in' })).toBeVisible();
}

/**
 * A signed-up parent standing in Parent View with a PIN set.
 *
 * The Parent View heading is matched `exact` for `parent-pin.spec.ts`'s reason:
 * the first-PIN screen is itself headed "Set a PIN for Parent View", so a loose
 * match reports Parent View as reached while the browser is still at the gate.
 */
async function signUpAndEnterParentView(page: Page): Promise<string> {
  const email = uniqueParentEmail('bottom-nav');
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

async function signInAsOperator(page: Page): Promise<void> {
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(OPERATOR_EMAIL);
  await page.getByLabel(/^Password/).fill(OPERATOR_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Subjects & Grade Levels' })).toBeVisible();
}

function bar(page: Page): Locator {
  return page.getByTestId('bottom-nav');
}

/**
 * The drawer's own panel, by MUI's class.
 *
 * It has no role to reach for: the drawer's nav carries no accessible name of
 * its own — the sidebar is the named one. Every other locator in this file is a
 * role or a label.
 */
function drawerPanel(page: Page): Locator {
  return page.locator('.MuiDrawer-paper');
}

/** The bar's top edge in viewport coordinates. */
async function barTop(page: Page): Promise<number> {
  const box = await bar(page).boundingBox();
  expect(box, 'the bar has no box').not.toBeNull();
  return box!.y;
}

test.describe('the bottom navigation bar', () => {
  test('is Parent View’s navigation below `lg`, and the sidebar’s at `lg`', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await signUpAndEnterParentView(page);

    // Five actions, in order, and the hamburger that used to hide them is gone.
    const parentBar = bar(page);
    await expect(parentBar).toBeVisible();
    await expect(parentBar.locator('a, button')).toHaveText(PARENT_TABS);
    await expect(page.getByRole('button', { name: 'Open Parent View menu' })).toHaveCount(0);
    // The sidebar is in the markup and off the screen: the choice is CSS, so
    // nothing swapped layouts after hydration.
    await expect(page.getByRole('navigation', { name: 'Parent View', exact: true })).toBeHidden();

    // Home is where the parent is standing, and it says so.
    await expect(parentBar.getByRole('link', { name: 'Home' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    // A tab press is a client-side navigation: the PIN is not asked again.
    await parentBar.getByRole('link', { name: 'Drafts' }).click();
    await expect(page).toHaveURL(/\/parent\/drafts$/u);
    await expect(page.getByRole('heading', { name: 'Enter your PIN' })).toHaveCount(0);
    await expect(parentBar.getByRole('link', { name: 'Drafts' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(parentBar.getByRole('link', { name: 'Home' })).not.toHaveAttribute(
      'aria-current',
      'page',
    );

    // Every action clears the surface's 44px floor.
    for (const label of PARENT_TABS) {
      const box = await parentBar
        .getByRole(label === 'More' ? 'button' : 'link', { name: label })
        .boundingBox();
      expect(box, label).not.toBeNull();
      expect(box!.height, label).toBeGreaterThanOrEqual(44);
    }

    // More opens the same drawer the hamburger used to, with the full grouped
    // list inside it — including the destinations no tab names.
    await parentBar.getByRole('button', { name: 'More' }).click();
    const drawer = drawerPanel(page);
    await expect(drawer.getByRole('link', { name: 'Student Profiles' })).toBeVisible();
    await expect(drawer.getByRole('link', { name: 'Settings and account deletion' })).toBeVisible();
    await drawer.getByRole('link', { name: 'Student Profiles' }).click();
    await expect(page).toHaveURL(/\/parent\/students$/u);
    // Nothing the four tabs name: More is the current action.
    await expect(parentBar.getByRole('button', { name: 'More' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    // A tablet either way up is still below `lg`.
    for (const size of [TABLET_PORTRAIT, TABLET_LANDSCAPE]) {
      await page.setViewportSize(size);
      await expect(bar(page)).toBeVisible();
    }

    // And at `lg` the sidebar is back and the bar is not drawn at all.
    await page.setViewportSize(DESKTOP);
    await expect(page.getByRole('navigation', { name: 'Parent View', exact: true })).toBeVisible();
    await expect(bar(page)).toBeHidden();
    await expect(page.getByRole('button', { name: 'Open Parent View menu' })).toHaveCount(0);
  });

  test('leaves room under the last row of a list', async ({ page }) => {
    // A grade level has to be seeded: `globalSetup` starts every run from an
    // empty taxonomy, and a profile cannot be added without one.
    const grade = await createGradeLevelFixture('Grade');
    await page.setViewportSize(PHONE);
    await signUpAndEnterParentView(page);

    await bar(page).getByRole('button', { name: 'More' }).click();
    await drawerPanel(page).getByRole('link', { name: 'Student Profiles' }).click();
    await expect(page.getByRole('heading', { name: 'Student Profiles', level: 1 })).toBeVisible();

    // A row to measure. The shared snackbar's own offset is asserted in
    // `components/Snackbar.spec.tsx`: no screen mounts it yet, so there is no
    // message to raise here.
    await page.locator('#student-name').fill('Noah');
    await page.locator('[role="combobox"]#student-grade-level').click();
    await page.getByRole('option', { name: grade.name }).click();
    await expect(page.getByRole('listbox')).toBeHidden();
    await page.getByRole('button', { name: 'Add the profile' }).click();
    await expect(page.locator('main').getByRole('status')).toContainText('Noah');

    // Shortened until the screen genuinely scrolls, and asserted so: with a
    // page that fits, the comparison below would pass whether the clearance
    // existed or not.
    await page.setViewportSize({ width: PHONE.width, height: 420 });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
        ),
      )
      .toBeGreaterThan(0);

    // The end of the list clears the bar, however far down it is scrolled.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect
      .poll(async () => {
        const last = await page.getByTestId('student-card').last().boundingBox();
        const top = await barTop(page);
        return last === null ? null : Math.round(last.y + last.height - top);
      })
      .toBeLessThanOrEqual(0);
  });

  test('leaves room under the last row of the Admin console’s own list', async ({ page }) => {
    // Admin gets the same clearance rule as Parent View
    // (`routeCarriesBottomNav` in `AdminChrome.tsx`), but only Parent View's
    // version of this test scrolls a real list to the bar — Admin's was
    // pinned by a source-text match alone. Enough subjects to outgrow a
    // shrunk viewport, the same way Parent View's single profile does.
    await page.setViewportSize(PHONE);
    await signInAsOperator(page);

    for (const name of [
      'Nav Subject One',
      'Nav Subject Two',
      'Nav Subject Three',
      'Nav Subject Four',
      'Nav Subject Five',
      'Nav Subject Six',
    ]) {
      await page.getByLabel('New Subject name').fill(name);
      await page.getByRole('button', { name: 'Add Subject' }).click();
      await expect(page.getByRole('status').first()).toContainText(`Subject ${name} created.`);
    }

    // Shortened until the screen genuinely scrolls, and asserted so: with a
    // page that fits, the comparison below would pass whether the clearance
    // existed or not.
    await page.setViewportSize({ width: PHONE.width, height: 420 });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
        ),
      )
      .toBeGreaterThan(0);

    // The end of the list clears the bar, however far down it is scrolled.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect
      .poll(async () => {
        const last = await page.getByTestId('subjects-card').last().boundingBox();
        const top = await barTop(page);
        return last === null ? null : Math.round(last.y + last.height - top);
      })
      .toBeLessThanOrEqual(0);
  });

  test('is the Admin console’s navigation below `lg`, and the sidebar’s at `lg`', async ({
    page,
  }) => {
    // The console is the one surface whose only narrow-width navigation this
    // story deleted outright: there is no drawer behind the bar to fall back on.
    await page.setViewportSize(PHONE);
    await signInAsOperator(page);

    const adminBar = bar(page);
    await expect(adminBar).toBeVisible();
    await expect(adminBar.locator('a, button')).toHaveText(ADMIN_TABS);
    await expect(page.getByRole('button', { name: 'Open Admin menu' })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'n-test-reviewer Admin' })).toBeHidden();
    // The header keeps its own cluster whatever the width.
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Switch to (dark|light) mode/u })).toBeVisible();

    await expect(adminBar.getByRole('link', { name: 'Subjects' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await adminBar.getByRole('link', { name: 'Accounts' }).click();
    await expect(page).toHaveURL(/\/admin\/accounts$/u);
    await expect(adminBar.getByRole('link', { name: 'Accounts' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(adminBar.getByRole('link', { name: 'Subjects' })).not.toHaveAttribute(
      'aria-current',
      'page',
    );

    await page.setViewportSize(DESKTOP);
    await expect(page.getByRole('navigation', { name: 'n-test-reviewer Admin' })).toBeVisible();
    await expect(bar(page)).toBeHidden();
  });

  test('stays off Admin sign-in, where there is nothing authenticated yet', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/admin/login');
    await expect(page.getByRole('heading', { name: 'Admin sign-in' })).toBeVisible();
    await expect(bar(page)).toHaveCount(0);
  });

  test('stays off the PIN gate, where there is nowhere to go', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await signUpAndEnterParentView(page);
    // A full load ends Parent View, which puts the gate back in front.
    await page.goto('/parent');
    await expect(page.getByRole('heading', { name: 'Enter your PIN' })).toBeVisible();
    await expect(bar(page)).toHaveCount(0);
  });

  test('is Student Mode’s three tabs, in place of Home’s own exit link', async ({ page }) => {
    const grade = await createGradeLevelFixture('Grade');
    await page.setViewportSize(PHONE);
    await signUpAndEnterParentView(page);

    await bar(page).getByRole('button', { name: 'More' }).click();
    await drawerPanel(page).getByRole('link', { name: 'Student Profiles' }).click();
    await expect(page.getByRole('heading', { name: 'Student Profiles', level: 1 })).toBeVisible();
    await page.locator('#student-name').fill('Noah');
    await page.locator('[role="combobox"]#student-grade-level').click();
    await page.getByRole('option', { name: grade.name }).click();
    await expect(page.getByRole('listbox')).toBeHidden();
    await page.getByRole('button', { name: 'Add the profile' }).click();
    await expect(page.locator('main').getByRole('status')).toContainText('Noah');

    // One child is no choice at all, so the exit hands the device straight over.
    await page.getByRole('button', { name: 'Back to Student Mode' }).click();
    await expect(page.getByRole('heading', { name: 'Your practice', level: 1 })).toBeVisible();

    const studentBar = page.getByRole('navigation', { name: 'Student sections' });
    await expect(studentBar).toBeVisible();
    await expect(studentBar.getByRole('link')).toHaveText(['Home', 'Results', 'Parent']);
    await expect(studentBar.getByRole('link', { name: 'Home' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // Student Mode's own 48px floor, not the console's 44.
    for (const label of ['Home', 'Results', 'Parent']) {
      const box = await studentBar.getByRole('link', { name: label }).boundingBox();
      expect(box, label).not.toBeNull();
      expect(box!.height, label).toBeGreaterThanOrEqual(48);
    }

    // The Results tab: an ordinary Student Mode destination, reached without a
    // full load, carrying the bar with the tab now reading as current. This
    // child has finished nothing, so the screen says what will appear here.
    await studentBar.getByRole('link', { name: 'Results' }).click();
    await expect(
      page.getByRole('heading', { name: 'Your finished tests', level: 1 }),
    ).toBeVisible();
    await expect(studentBar.getByRole('link', { name: 'Results' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByTestId('student-results-empty')).toBeVisible();
    await expect(studentBar).toBeVisible();

    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Your practice', level: 1 })).toBeVisible();

    // Home's own way out is hidden below `lg`: the tab carries that crossing,
    // and two controls for one crossing is one too many. The light/dark switch
    // beside it stays at every width.
    await expect(
      page.locator('main').getByRole('link', { name: 'Parent', exact: true }),
    ).toBeHidden();
    await expect(page.getByRole('button', { name: /Switch to (dark|light) mode/u })).toBeVisible();

    // And Home's own link to the finished tests is the same way round: below
    // `lg` the tab carries it, so the link is not there to be a second copy.
    await expect(
      page.locator('main').getByRole('link', { name: 'Results', exact: true }),
    ).toBeHidden();

    await page.setViewportSize(DESKTOP);
    await expect(
      page.locator('main').getByRole('link', { name: 'Parent', exact: true }),
    ).toBeVisible();
    // At and above `lg` there is no bar, so Home carries the way to Results.
    await expect(
      page.locator('main').getByRole('link', { name: 'Results', exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId('bottom-nav')).toBeHidden();

    // And an Attempt path carries no bar at all, whatever it resolves to.
    await page.setViewportSize(PHONE);
    await page.goto('/student/tests/not-a-real-attempt');
    await expect(page.getByTestId('bottom-nav')).toHaveCount(0);
  });
});
