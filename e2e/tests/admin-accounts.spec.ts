import { expect, test, type Page } from '@playwright/test';
import { uniqueParentAccount } from '../fixtures';
import { PARENT_ACCOUNT_FIXTURES } from '../global-setup';

const OPERATOR_EMAIL = process.env.ADMIN_SEED_EMAIL ?? 'operator@example.test';
const OPERATOR_PASSWORD = process.env.ADMIN_SEED_PASSWORD ?? 'change-me-too';
const API_ORIGIN = `http://localhost:${process.env.API_PORT ?? '3001'}`;

const [ADA, GRACE] = PARENT_ACCOUNT_FIXTURES;

async function signIn(page: Page): Promise<void> {
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(OPERATOR_EMAIL);
  await page.getByLabel('Password').fill(OPERATOR_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Subjects & Grade Levels' })).toBeVisible();
}

async function openAccounts(page: Page): Promise<void> {
  // The nav entry renders as a link, exactly as the taxonomy entry does.
  await page.getByRole('link', { name: 'Parent Accounts' }).click();
  await expect(page.getByRole('heading', { name: 'Parent Accounts', level: 1 })).toBeVisible();
}

const tierSelect = (page: Page, email: string) =>
  page.getByLabel(`Account Tier for ${email}`, { exact: true });

/** The reset instant the API computed for an account, as an ISO string. */
async function resetInstantFor(page: Page, email: string): Promise<string> {
  const token = await page.evaluate(() =>
    window.localStorage.getItem('n-test-reviewer.admin.token'),
  );
  const headers = { authorization: `Bearer ${token}` };
  const list = await page.request.get(`${API_ORIGIN}/api/admin/parent-accounts`, { headers });
  const accounts = (await list.json()) as { id: string; email: string }[];
  const match = accounts.find((account) => account.email === email);
  expect(match, `account ${email}`).toBeTruthy();

  const detail = await page.request.get(`${API_ORIGIN}/api/admin/parent-accounts/${match!.id}`, {
    headers,
  });
  return ((await detail.json()) as { consumption: { resetAt: string } }).consumption.resetAt;
}

/**
 * ADA and GRACE are read-only fixtures. Any test that changes a tier seeds its
 * own account first, so no test depends on another having cleaned up after
 * itself — a failure mid-test can no longer dirty the rest of the run.
 */
test.describe('admin parent accounts', () => {
  test('lists every Parent Account with its tier and its own timezone', async ({ page }) => {
    await signIn(page);
    await openAccounts(page);

    const rows = page.getByTestId('account-row');
    // Other tests seed their own accounts, so this asserts on its own two
    // rather than on the table's total size.
    await expect(rows.first()).toBeVisible();
    const ada = rows.filter({ hasText: ADA.email });
    const grace = rows.filter({ hasText: GRACE.email });

    await expect(ada).toHaveCount(1);
    await expect(ada).toContainText(ADA.timezone);
    await expect(grace).toHaveCount(1);
    await expect(grace).toContainText(GRACE.timezone);

    // Ada sorts before Grace, and both sort before every seeded `zz-` account.
    const emails = await rows.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-email') ?? ''),
    );
    expect(emails.indexOf(ADA.email)).toBeLessThan(emails.indexOf(GRACE.email));
    expect([...emails]).toEqual([...emails].sort());

    // An account never assigned a tier shows Free.
    await expect(tierSelect(page, ADA.email)).toHaveValue('Free');
  });

  test('persists a tier change across a reload', async ({ page }) => {
    const mine = await uniqueParentAccount('persist');
    await signIn(page);
    await openAccounts(page);

    await tierSelect(page, mine.email).selectOption('Internal');
    await expect(page.getByRole('status').first()).toContainText(
      `${mine.email} moved from Free to Internal.`,
    );

    await page.reload();
    await expect(tierSelect(page, mine.email)).toHaveValue('Internal');
    // A read-only fixture is untouched by the change.
    await expect(tierSelect(page, ADA.email)).toHaveValue('Free');
  });

  test('shows all three allowances with the account’s own reset date', async ({ page }) => {
    await signIn(page);
    await openAccounts(page);

    await page.getByRole('button', { name: `Consumption for ${ADA.email}` }).click();

    const allowances = page.getByTestId('allowance-row');
    await expect(allowances).toHaveCount(3);
    await expect(allowances.nth(0)).toContainText('Upload Allowance');
    await expect(allowances.nth(1)).toContainText('Generation Allowance');
    await expect(allowances.nth(2)).toContainText('Explanation Allowance');
    // Each reads as usage against a limit; no figure is asserted here, since
    // every limit originates in the API's tiers table.
    for (const index of [0, 1, 2]) {
      await expect(allowances.nth(index)).toContainText(/\d+ of (\d+|Unlimited)/);
    }

    const resetAda = await page.getByTestId('reset-at').textContent();
    expect(resetAda).toBeTruthy();
    await expect(page.getByTestId('consumption-table')).toContainText('Used of limit');
    await expect(page.getByText(`Computed in: ${ADA.timezone}`)).toBeVisible();

    // The other account's period is computed in its own zone.
    await page.getByRole('button', { name: `Consumption for ${GRACE.email}` }).click();
    await expect(page.getByText(`Computed in: ${GRACE.timezone}`)).toBeVisible();

    // Each panel renders its own zone's local midnight on the 1st, so the two
    // read alike on screen while standing for different instants. The instants
    // are what "each window is computed in its own zone" means, so they are
    // what gets asserted.
    const instants = await Promise.all(
      [ADA.email, GRACE.email].map((email) => resetInstantFor(page, email)),
    );
    expect(instants[0]).not.toBe(instants[1]);
  });

  test('applies a new tier to the same, unchanged current period', async ({ page }) => {
    const mine = await uniqueParentAccount('same-period', 'Asia/Manila');
    await signIn(page);
    await openAccounts(page);

    await page.getByRole('button', { name: `Consumption for ${mine.email}` }).click();
    await expect(page.getByTestId('reset-at')).toBeVisible();
    const before = await page.getByTestId('reset-at').textContent();
    const explanationBefore = await page.getByTestId('allowance-row').nth(2).textContent();

    await tierSelect(page, mine.email).selectOption('Plus');
    await expect(page.getByRole('status').first()).toContainText(
      `${mine.email} moved from Free to Plus.`,
    );

    // Same window, different limits.
    await expect(page.getByTestId('reset-at')).toHaveText(before!);
    await expect(page.getByTestId('allowance-row').nth(2)).not.toHaveText(explanationBefore!);
    await expect(page.getByTestId('allowance-row').nth(2)).toContainText('Unlimited');
  });

  test('shows an error and a retry, never an endless spinner, when consumption fails', async ({
    page,
  }) => {
    const mine = await uniqueParentAccount('panel-error');
    await signIn(page);
    await openAccounts(page);

    let failed = false;
    await page.route('**/api/admin/parent-accounts/*', async (route) => {
      if (!failed && route.request().method() === 'GET') {
        failed = true;
        await route.fulfill({
          status: 500,
          headers: { 'access-control-allow-origin': 'http://localhost:3000' },
          body: '{}',
        });
        return;
      }
      await route.continue();
    });

    await page.getByRole('button', { name: `Consumption for ${mine.email}` }).click();

    // The panel must settle on an error with a way forward.
    const retry = page.getByRole('button', { name: 'Try again' });
    await expect(retry).toBeVisible();
    await expect(page.getByText('Loading consumption…')).toHaveCount(0);

    await retry.click();
    await expect(page.getByTestId('reset-at')).toBeVisible();
    await expect(retry).toHaveCount(0);
  });

  test('reverts the tier select and shows an error when the assignment PATCH fails', async ({
    page,
  }) => {
    const mine = await uniqueParentAccount('assign-error');
    await signIn(page);
    await openAccounts(page);

    await page.route('**/api/admin/parent-accounts/*/tier', async (route) => {
      await route.fulfill({
        status: 500,
        headers: { 'access-control-allow-origin': 'http://localhost:3000' },
        body: '{}',
      });
    });

    await tierSelect(page, mine.email).selectOption('Internal');

    await expect(page.getByText('The change could not be saved')).toBeVisible();
    // The write never landed, so the select must keep reading the true tier.
    await expect(tierSelect(page, mine.email)).toHaveValue('Free');

    await page.unroute('**/api/admin/parent-accounts/*/tier');
    await page.reload();
    await expect(tierSelect(page, mine.email)).toHaveValue('Free');
  });

  test('redirects to sign-in when no token is stored', async ({ page }) => {
    await page.goto('/admin/accounts');
    await expect(page).toHaveURL(/\/admin\/login$/);
  });

  test('keeps every accounts control keyboard reachable with a visible focus ring', async ({
    page,
  }) => {
    await signIn(page);
    await openAccounts(page);
    await page.getByRole('button', { name: `Consumption for ${ADA.email}` }).click();
    await expect(page.getByTestId('reset-at')).toBeVisible();

    const mustReach = [
      'Parent Accounts',
      'Sign out',
      `Account Tier for ${ADA.email}`,
      `Consumption for ${ADA.email}`,
      `Consumption for ${GRACE.email}`,
    ];

    const reached = new Set<string>();
    await page.locator('body').focus();
    for (let step = 0; step < 60; step += 1) {
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

    // The consumption toggle carries the standing focus ring and hit area.
    const toggle = page.getByRole('button', { name: `Consumption for ${ADA.email}` });
    await toggle.focus();
    const style = await toggle.evaluate((element) => {
      const computed = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return {
        outlineWidth: computed.outlineWidth,
        outlineOffset: computed.outlineOffset,
        height: box.height,
        width: box.width,
      };
    });
    expect(style.height).toBeGreaterThanOrEqual(44);
    expect(style.width).toBeGreaterThanOrEqual(44);
    expect(style.outlineWidth).toBe('2px');
    expect(style.outlineOffset).toBe('2px');
  });

  test('renders consumption numbers with tabular figures', async ({ page }) => {
    await signIn(page);
    await openAccounts(page);
    await page.getByRole('button', { name: `Consumption for ${ADA.email}` }).click();

    const usageCell = page.getByTestId('allowance-row').nth(0).locator('td');
    await expect(usageCell).toBeVisible();
    const variant = await usageCell.evaluate(
      (element) => getComputedStyle(element).fontVariantNumeric,
    );
    expect(variant).toContain('tabular-nums');
  });
});
