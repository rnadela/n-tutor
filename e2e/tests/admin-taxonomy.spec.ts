import { expect, test, type Page } from '@playwright/test';
import {
  chooseRowAction,
  COMPACT_TAP_TARGET,
  focusByKeyboard,
  focusedControl,
  measureActionCell,
  ONE_LINE_CEILING,
  rowActionsName,
} from '../fixtures';

const OPERATOR_EMAIL = process.env.ADMIN_SEED_EMAIL ?? 'operator@example.test';
const OPERATOR_PASSWORD = process.env.ADMIN_SEED_PASSWORD ?? 'change-me-too';
const API_ORIGIN = `http://localhost:${process.env.API_PORT ?? '3001'}`;

const SUBJECT = 'Mathematics';
const SUBJECT_RENAMED = 'Maths';
const GRADE_LEVEL = 'Grade 4';

async function signIn(page: Page): Promise<void> {
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(OPERATOR_EMAIL);
  await page.getByLabel(/^Password/).fill(OPERATOR_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Subjects & Grade Levels' })).toBeVisible();
}

async function selectableSubjectNames(page: Page, gradeLevelId: string): Promise<string[]> {
  const token = await page.evaluate(() =>
    window.localStorage.getItem('n-test-reviewer.admin.token'),
  );
  const response = await page.request.get(
    `${API_ORIGIN}/api/admin/taxonomy/grade-levels/${gradeLevelId}/selectable-subjects`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  expect(response.ok()).toBeTruthy();
  return ((await response.json()) as { name: string }[]).map((item) => item.name);
}

async function gradeLevelId(page: Page, name: string): Promise<string> {
  const token = await page.evaluate(() =>
    window.localStorage.getItem('n-test-reviewer.admin.token'),
  );
  const response = await page.request.get(`${API_ORIGIN}/api/admin/taxonomy`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = (await response.json()) as { gradeLevels: { id: string; name: string }[] };
  const match = body.gradeLevels.find((level) => level.name === name);
  expect(match, `Grade Level ${name}`).toBeTruthy();
  return match!.id;
}

test.describe('admin taxonomy', () => {
  test('rejects a wrong password without revealing whether the operator exists', async ({
    page,
  }) => {
    await page.goto('/admin/login');
    await page.getByLabel('Email').fill(OPERATOR_EMAIL);
    await page.getByLabel(/^Password/).fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    const wrongPassword = await page.getByRole('alert').textContent();

    await page.getByLabel('Email').fill('nobody@example.test');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toHaveText(wrongPassword!);
  });

  test('creates, renames, disables, and controls availability', async ({ page }) => {
    await signIn(page);

    await page.getByLabel('New Subject name').fill(SUBJECT);
    await page.getByRole('button', { name: 'Add Subject' }).click();
    await expect(page.getByRole('status').first()).toContainText(`Subject ${SUBJECT} created.`);

    await page.getByLabel('New Grade Level name').fill(GRADE_LEVEL);
    await page.getByRole('button', { name: 'Add Grade Level' }).click();
    await expect(page.getByRole('status').first()).toContainText(
      `Grade Level ${GRADE_LEVEL} created.`,
    );

    const levelId = await gradeLevelId(page, GRADE_LEVEL);
    expect(await selectableSubjectNames(page, levelId)).toEqual([]);

    // Enable the mapping — the Subject becomes selectable immediately.
    await page.getByRole('checkbox', { name: `Offer ${SUBJECT} for ${GRADE_LEVEL}` }).click();
    await expect(page.getByRole('status').first()).toContainText(
      `${SUBJECT} is now offered for ${GRADE_LEVEL}.`,
    );
    expect(await selectableSubjectNames(page, levelId)).toEqual([SUBJECT]);

    // Rename — the id is unchanged and the selectable list shows the new label.
    await page.getByRole('button', { name: `Rename ${SUBJECT}` }).click();
    await page.getByLabel('New name').fill(SUBJECT_RENAMED);
    await page.getByRole('button', { name: 'Save name' }).click();
    await expect(page.getByRole('status').first()).toContainText(
      `Subject ${SUBJECT} renamed to ${SUBJECT_RENAMED}.`,
    );
    expect(await selectableSubjectNames(page, levelId)).toEqual([SUBJECT_RENAMED]);

    // Disable the mapping only — the Subject drops out of the list.
    await page
      .getByRole('checkbox', { name: `Offer ${SUBJECT_RENAMED} for ${GRADE_LEVEL}` })
      .click();
    await expect(page.getByRole('status').first()).toContainText(
      `${SUBJECT_RENAMED} is no longer offered for ${GRADE_LEVEL}.`,
    );
    expect(await selectableSubjectNames(page, levelId)).toEqual([]);

    // Re-enable the mapping, then disable the Subject itself.
    await page
      .getByRole('checkbox', { name: `Offer ${SUBJECT_RENAMED} for ${GRADE_LEVEL}` })
      .click();
    await expect(page.getByRole('status').first()).toContainText(
      `${SUBJECT_RENAMED} is now offered for ${GRADE_LEVEL}.`,
    );
    expect(await selectableSubjectNames(page, levelId)).toEqual([SUBJECT_RENAMED]);

    await chooseRowAction(page, SUBJECT_RENAMED, 'Disable');
    await expect(page.getByRole('status').first()).toContainText(
      `Subject ${SUBJECT_RENAMED} disabled.`,
    );
    expect(await selectableSubjectNames(page, levelId)).toEqual([]);
  });

  test('redirects to sign-in when no token is stored', async ({ page }) => {
    await page.goto('/admin/taxonomy');
    await expect(page).toHaveURL(/\/admin\/login$/);
    await expect(page.getByRole('heading', { name: 'Admin sign-in' })).toBeVisible();
  });

  test('redirects to sign-in when the token is cleared mid-session', async ({ page }) => {
    await signIn(page);
    await page.evaluate(() => window.localStorage.removeItem('n-test-reviewer.admin.token'));
    await page.goto('/admin/taxonomy');
    await expect(page).toHaveURL(/\/admin\/login$/);
  });

  test('sends an already-signed-in operator straight to the taxonomy screen', async ({ page }) => {
    await signIn(page);
    await page.goto('/admin/login');
    await expect(page).toHaveURL(/\/admin\/taxonomy$/);
  });

  test('keeps every taxonomy control keyboard reachable with a visible focus ring', async ({
    page,
  }) => {
    await signIn(page);

    // Seed one Subject and one Grade Level so every control class is on screen.
    await page.getByLabel('New Subject name').fill('Keyboard');
    await page.getByRole('button', { name: 'Add Subject' }).click();
    await expect(page.getByRole('status').first()).toContainText('Subject Keyboard created.');
    await page.getByLabel('New Grade Level name').fill('Grade 9');
    await page.getByRole('button', { name: 'Add Grade Level' }).click();
    await expect(page.getByRole('status').first()).toContainText('Grade Level Grade 9 created.');

    const mustReach = [
      'Subjects & Grade Levels',
      'Sign out',
      'New Subject name',
      'Add Subject',
      'Rename Keyboard',
      // Disable is a menu item now, so what the tab order must reach is the ⋮
      // that opens it — the menu's own keyboard contract is MUI's.
      'More actions for Keyboard',
      'New Grade Level name',
      'Add Grade Level',
      'Rename Grade 9',
      'More actions for Grade 9',
      'Offer Keyboard for Grade 9',
    ];

    // Walk the real tab order and record what focus actually lands on.
    const reached = new Set<string>();
    await page.locator('body').focus();
    for (let step = 0; step < 80; step += 1) {
      await page.keyboard.press('Tab');
      const name = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        if (!element || element === document.body) return '';
        const labelled = element as HTMLInputElement;
        const fromLabel = labelled.labels?.[0]?.textContent ?? '';
        return element.getAttribute('aria-label') || fromLabel || element.textContent?.trim() || '';
      });
      if (name) reached.add(name.replace(/\s+/g, ' ').trim());
    }

    for (const name of mustReach) {
      expect(
        [...reached].some((entry) => entry.includes(name)),
        `tab order reaches ${name}`,
      ).toBe(true);
    }
  });

  test('gives every control a 2px focus ring at 2px offset and a 44px hit area', async ({
    page,
  }) => {
    await signIn(page);
    await page.getByLabel('New Subject name').fill('Focusable');
    await page.getByRole('button', { name: 'Add Subject' }).click();
    await expect(page.getByRole('status').first()).toContainText('Subject Focusable created.');

    // The inline pencil and the ⋮ are the row's whole action cell now, and both
    // have to clear the 44px floor on their own: an icon-only control is a
    // smaller target than the text button it replaced.
    for (const [label, control] of [
      ['Add Subject', page.getByRole('button', { name: 'Add Subject' })],
      ['Rename Focusable', page.getByRole('button', { name: 'Rename Focusable' })],
      [
        'More actions for Focusable',
        page.getByRole('button', { name: 'More actions for Focusable' }),
      ],
    ] as const) {
      await focusByKeyboard(page, label);
      const style = await control.evaluate((element) => {
        const computed = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return {
          outlineWidth: computed.outlineWidth,
          outlineStyle: computed.outlineStyle,
          outlineOffset: computed.outlineOffset,
          height: box.height,
          width: box.width,
        };
      });

      expect(style.outlineStyle).toBe('solid');
      expect(style.outlineWidth).toBe('2px');
      expect(style.outlineOffset).toBe('2px');
      expect(style.height).toBeGreaterThanOrEqual(44);
      expect(style.width).toBeGreaterThanOrEqual(44);
    }
  });

  // A taxonomy row keeps Rename inline, so its menu holds the one action whose
  // icon does not speak for itself. Moving *between* items by arrow key needs a
  // menu with more than one, which `parent-students.spec.ts` walks.
  test('opens and closes a row’s ⋮ menu by keyboard alone', async ({ page }) => {
    await signIn(page);
    await page.getByLabel('New Subject name').fill('Keys');
    await page.getByRole('button', { name: 'Add Subject' }).click();
    await expect(page.getByRole('status').first()).toContainText('Subject Keys created.');

    // Tabbed to, not clicked: this is the path a keyboard user actually takes,
    // and the whole acceptance criterion is about that path.
    const trigger = rowActionsName('Keys');
    await focusByKeyboard(page, trigger);

    // --- Enter opens it, with focus already inside -------------------------
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu', { name: trigger });
    await expect(menu).toBeVisible();
    expect((await focusedControl(page)).role).toBe('menuitem');

    // Every item shows its own word, not merely an accessible name: the labels
    // are the reason these actions are in a menu rather than on the row, and a
    // deleted `ListItemText` would leave every name-based query still passing.
    await expect(menu.getByRole('menuitem', { name: `Disable Keys` })).toHaveText(/Disable/);

    // An item is a tap target like any other, even inside a menu.
    //
    // `offsetHeight`, not the bounding rect: the menu arrives on a Grow
    // transition whose `transform: scale()` the rect reports but layout does
    // not, so a rect read mid-animation measures a fraction of the real box.
    const item = await menu
      .getByRole('menuitem', { name: 'Disable Keys' })
      .evaluate((element) => (element as HTMLElement).offsetHeight);
    expect(item).toBeGreaterThanOrEqual(COMPACT_TAP_TARGET);

    // --- Escape closes it and hands focus back to the trigger -------------
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    expect((await focusedControl(page)).name).toBe(trigger);

    // Space opens it too, and choosing an item closes it and fires the action.
    await page.keyboard.press(' ');
    await expect(menu).toBeVisible();
    await page.getByRole('menuitem', { name: 'Disable Keys' }).press('Enter');
    await expect(menu).toHaveCount(0);
    await expect(page.getByRole('status').first()).toContainText('Subject Keys disabled.');
  });

  test('keeps a row’s actions to two icons and one line at phone width', async ({ page }) => {
    // The wrapping this story exists to fix is only observable in a real
    // viewport: three text buttons in a narrow Actions column wrapped onto
    // three lines and pushed the table into a horizontal scroll.
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);

    await page.getByLabel('New Subject name').fill('Narrow');
    await page.getByRole('button', { name: 'Add Subject' }).click();
    await expect(page.getByRole('status').first()).toContainText('Subject Narrow created.');

    await expect(page.getByRole('button', { name: 'Rename Narrow' })).toBeVisible();
    await expect(page.getByRole('button', { name: rowActionsName('Narrow') })).toBeVisible();

    const cell = await measureActionCell(page, '[data-testid="subjects-row"][data-name="Narrow"]');
    // Two icons, the ⋮ counting as one — the cap itself.
    expect(cell.buttons).toBe(2);
    // No visible action word in the cell: the words are in the menu.
    expect(cell.text).toBe('');
    // One line, and no sideways scroll on the table that holds it.
    expect(cell.height).toBeLessThan(ONE_LINE_CEILING);
    expect(cell.scrollWidth).toBeLessThanOrEqual(cell.clientWidth);
  });

  test('resyncs the availability checkbox to the server state after a failed toggle', async ({
    page,
  }) => {
    await signIn(page);

    await page.getByLabel('New Subject name').fill('Resync Subject');
    await page.getByRole('button', { name: 'Add Subject' }).click();
    await expect(page.getByRole('status').first()).toContainText('Subject Resync Subject created.');

    await page.getByLabel('New Grade Level name').fill('Resync Grade');
    await page.getByRole('button', { name: 'Add Grade Level' }).click();
    await expect(page.getByRole('status').first()).toContainText(
      'Grade Level Resync Grade created.',
    );

    const checkbox = page.getByRole('checkbox', {
      name: 'Offer Resync Subject for Resync Grade',
    });
    await expect(checkbox).not.toBeChecked();

    // Force this one write to fail server-side, then let subsequent requests
    // (including the recovery reload) through normally.
    let intercepted = false;
    await page.route('**/api/admin/taxonomy/availability', async (route) => {
      if (!intercepted && route.request().method() === 'PUT') {
        intercepted = true;
        await route.fulfill({ status: 500, body: '{}' });
        return;
      }
      await route.continue();
    });

    await checkbox.click();
    await expect(page.getByRole('alert').filter({ hasText: /./ })).toBeVisible();

    // The control must resync to the server's actual (still-disabled) state,
    // not remain stuck in the optimistic checked state the click applied.
    await expect(checkbox).not.toBeChecked();
    await expect(checkbox).toBeEnabled();
    expect(await selectableSubjectNames(page, await gradeLevelId(page, 'Resync Grade'))).toEqual(
      [],
    );

    await page.unroute('**/api/admin/taxonomy/availability');

    // A retry now succeeds normally.
    await checkbox.click();
    await expect(page.getByRole('status').first()).toContainText(
      'Resync Subject is now offered for Resync Grade.',
    );
    await expect(checkbox).toBeChecked();
  });

  test('clears the token and returns to sign-in when Sign out is clicked', async ({ page }) => {
    await signIn(page);

    await page.getByRole('button', { name: 'Sign out' }).click();

    await expect(page).toHaveURL(/\/admin\/login$/);
    const token = await page.evaluate(() =>
      window.localStorage.getItem('n-test-reviewer.admin.token'),
    );
    expect(token).toBeNull();
  });

  test('redirects to sign-in when a write is rejected mid-session with 401', async ({ page }) => {
    await signIn(page);

    await page.getByLabel('New Subject name').fill('Expired Session Subject');

    await page.route('**/api/admin/taxonomy/subjects', async (route) => {
      if (route.request().method() === 'POST') {
        // The real server's CORS middleware stamps every response, including
        // errors; a faked response must too, or the browser reports a CORS
        // network failure instead of a 401 the app can branch on.
        await route.fulfill({
          status: 401,
          headers: { 'access-control-allow-origin': 'http://localhost:3000' },
          body: '{}',
        });
        return;
      }
      await route.continue();
    });

    await page.getByRole('button', { name: 'Add Subject' }).click();

    await expect(page).toHaveURL(/\/admin\/login$/);
  });
});
