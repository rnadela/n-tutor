import { expect, test, type Page } from '@playwright/test';
import { countPasswordResetsFor, uniqueParentEmail, waitForResetLink } from '../fixtures';

const PASSWORD = 'correct-horse-battery-staple';

async function signUp(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.goto('/auth/sign-up');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByLabel('I accept the terms of use.').check();
  await page.getByLabel('I accept the notice on children’s data.').check();
  await page.getByRole('button', { name: 'Create account' }).click();
}

test.describe('parent sign-up and sign-in', () => {
  test('lands on parent sign-in from the root', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
  });

  test('signs up, stays signed in across a reload, and signs out', async ({ page }) => {
    const email = uniqueParentEmail('signup');
    await signUp(page, email);

    await expect(page.getByRole('heading', { name: 'Signed in' })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();

    // The session is a cookie, so it survives a reload with no credentials.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Signed in' })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();

    // And after sign-out the same reload lands back on sign-in.
    await page.goto('/auth/signed-in');
    await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
  });

  test('shows one generic message for a duplicate email', async ({ page }) => {
    const email = uniqueParentEmail('duplicate');
    await signUp(page, email);
    await expect(page.getByRole('heading', { name: 'Signed in' })).toBeVisible();

    await signUp(page, email);
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).not.toContainText(email);
  });

  test('signs in with the account just created, then signs out', async ({ page }) => {
    const email = uniqueParentEmail('signin');
    await signUp(page, email);
    await page.getByRole('button', { name: 'Sign out' }).click();

    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('heading', { name: 'Signed in' })).toBeVisible();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
  });
});

test.describe('parent password reset', () => {
  async function requestReset(page: Page, email: string): Promise<void> {
    await page.goto('/auth/reset');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send the link' }).click();
    await expect(page.getByRole('status')).toBeVisible();
  }

  test('shows the same confirmation for a registered and an unregistered email', async ({
    page,
  }) => {
    const registered = uniqueParentEmail('reset-known');
    await signUp(page, registered);
    await page.getByRole('button', { name: 'Sign out' }).click();

    await requestReset(page, registered);
    const known = await page.getByRole('status').innerText();

    const unregistered = uniqueParentEmail('reset-unknown');
    await requestReset(page, unregistered);
    const unknown = await page.getByRole('status').innerText();

    expect(unknown).toBe(known);
    // An unregistered request writes nothing at all.
    expect(await countPasswordResetsFor(unregistered)).toBe(0);
  });

  test('completes the reset round trip through the emailed link', async ({ page }) => {
    const email = uniqueParentEmail('reset-roundtrip');
    await signUp(page, email);
    await page.getByRole('button', { name: 'Sign out' }).click();

    await requestReset(page, email);
    const link = await waitForResetLink(email);

    await page.goto(link);
    await page.getByLabel('New password').fill('a-brand-new-passphrase');
    await page.getByRole('button', { name: 'Save the new password' }).click();
    await expect(page.getByRole('status')).toContainText('password is saved');

    await page.goto('/auth/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('a-brand-new-passphrase');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Signed in' })).toBeVisible();
  });
});
