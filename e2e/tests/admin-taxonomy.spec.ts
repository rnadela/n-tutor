import { expect, test, type Page } from '@playwright/test';

const OPERATOR_EMAIL = process.env.ADMIN_SEED_EMAIL ?? 'operator@example.test';
const OPERATOR_PASSWORD = process.env.ADMIN_SEED_PASSWORD ?? 'change-me-too';
const API_ORIGIN = `http://localhost:${process.env.API_PORT ?? '3001'}`;

const SUBJECT = 'Mathematics';
const SUBJECT_RENAMED = 'Maths';
const GRADE_LEVEL = 'Grade 4';

async function signIn(page: Page): Promise<void> {
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(OPERATOR_EMAIL);
  await page.getByLabel('Password').fill(OPERATOR_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Subjects & Grade Levels' })).toBeVisible();
}

/**
 * Chromium only paints `:focus-visible` when focus arrived by keyboard, so the
 * focus-ring assertions have to tab their way to the control.
 */
async function focusByKeyboard(page: Page, accessibleName: string): Promise<void> {
  await page.locator('body').focus();
  for (let step = 0; step < 80; step += 1) {
    await page.keyboard.press('Tab');
    const name = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.textContent?.trim() ?? '',
    );
    if (name === accessibleName) return;
  }
  throw new Error(`Tab order never reached "${accessibleName}"`);
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
    await page.getByLabel('Password').fill('not-the-password');
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

    await page.getByRole('button', { name: `Disable ${SUBJECT_RENAMED}` }).click();
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
      'Disable Keyboard',
      'New Grade Level name',
      'Add Grade Level',
      'Rename Grade 9',
      'Disable Grade 9',
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

    for (const [label, control] of [
      ['Add Subject', page.getByRole('button', { name: 'Add Subject' })],
      ['Rename', page.getByRole('button', { name: 'Rename Focusable' })],
      ['Disable', page.getByRole('button', { name: 'Disable Focusable' })],
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
