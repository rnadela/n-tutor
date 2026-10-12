import { expect, test, type Page } from '@playwright/test';
import {
  chooseRowAction,
  createGradeLevelFixture,
  disableGradeLevelFixture,
  focusByKeyboard,
  focusedControl,
  measureActionCell,
  measureCardActions,
  ONE_LINE_CEILING,
  readStudentProfile,
  rowActionsName,
  setParentTierFixture,
  uniqueParentEmail,
  worstSidewaysOverflow,
} from '../fixtures';

const PASSWORD = 'correct-horse-battery-staple';
const PIN = '4821';

async function signUp(page: Page, email: string): Promise<void> {
  await page.goto('/auth/sign-up');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByLabel('I accept the terms of use.').check();
  await page.getByLabel('I accept the notice on children’s data.').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Signed in' })).toBeVisible();
}

/** Signs up, sets the PIN, and ends standing on the Students screen. */
async function openStudents(page: Page): Promise<string> {
  const email = uniqueParentEmail('students');
  await signUp(page, email);
  await page.getByRole('link', { name: 'Enter Parent View' }).click();
  await expect(page.getByRole('heading', { name: 'Set a PIN for Parent View' })).toBeVisible();
  await page.locator('#parent-pin').fill(PIN);
  await page.getByRole('button', { name: 'Save the PIN' }).click();
  await expect(
    page.getByRole('heading', { name: 'Parent View', level: 1, exact: true }),
  ).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Parent View' })
    .getByRole('link', { name: 'Student Profiles' })
    .click();
  await expect(page.getByRole('heading', { name: 'Student Profiles', level: 1 })).toBeVisible();
  return email;
}

/**
 * A MUI select is a listbox, not a `<select>`: open the combobox, then pick the
 * option. The combobox is addressed by role, not by id alone — MUI gives the
 * field's label an id with the same prefix, and clicking a label only focuses.
 */
async function chooseGradeLevel(page: Page, selectId: string, name: string): Promise<void> {
  await page.locator(`[role="combobox"]#${selectId}`).click();
  await page.getByRole('option', { name }).click();
  await expect(page.getByRole('listbox')).toBeHidden();
}

/**
 * The row for exactly this child.
 *
 * Matched on the row's own `data-name`, not on its text: `getByText` matches
 * substrings, so a row still reading "Noah" would satisfy a lookup for "Noa"
 * and a rename that never happened would pass unnoticed.
 */
function row(page: Page, name: string) {
  return page.locator(`[data-testid="student-row"][data-name="${name}"]`);
}

/** The profile's id, which its row states outright. */
async function profileId(page: Page, name: string): Promise<string> {
  const id = await row(page, name).getAttribute('data-profile-id');
  if (id === null) throw new Error(`No profile id on the row for ${name}.`);
  return id;
}

/**
 * A CSS colour as plain `r,g,b`, so a hex token and a computed `rgb()` compare.
 *
 * The theme states its palette as CSS variables, and `getComputedStyle` answers
 * in `rgb()` — two spellings of one colour that a string comparison would call
 * different.
 */
function rgbOf(colour: string): string {
  const value = colour.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/iu.exec(value);
  if (hex !== null) {
    const digits = hex[1]!;
    const pairs =
      digits.length === 3
        ? [...digits].map((digit) => `${digit}${digit}`)
        : [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 6)];
    return pairs.map((pair) => parseInt(pair, 16)).join(',');
  }
  const channels = value.match(/\d+(\.\d+)?/gu);
  if (channels === null) throw new Error(`Not a colour: "${colour}"`);
  return channels
    .slice(0, 3)
    .map((channel) => Math.round(Number(channel)))
    .join(',');
}

/**
 * Opens the archive confirmation for `name`, returns its text, and confirms it.
 * The text is returned so the assertion happens in the test body.
 *
 * The Students row has three actions, so all three are menu items: Archive is
 * reached through the row's `⋮`.
 */
async function confirmArchive(page: Page, name: string): Promise<string> {
  await chooseRowAction(page, name, 'Archive');
  const dialog = page.getByRole('dialog', { name: `Archive ${name}?` });
  await expect(dialog).toBeVisible();
  const text = (await dialog.textContent()) ?? '';
  await dialog.getByRole('button', { name: 'Archive' }).click();
  await expect(dialog).toHaveCount(0);
  return text;
}

test.describe('Student Profiles in Parent View', () => {
  test('creates, renames, re-grades, archives and restores a profile', async ({ page }) => {
    const first = await createGradeLevelFixture('E2E Grade A');
    const second = await createGradeLevelFixture('E2E Grade B');
    const email = await openStudents(page);

    await expect(
      page.getByText('There are no profiles yet. Add the first one below.'),
    ).toBeVisible();

    // --- Create -----------------------------------------------------------
    const add = page.getByRole('button', { name: 'Add the profile' });
    // Both are required, so the control is not offered until both are set.
    await expect(add).toBeDisabled();
    await page.locator('#student-name').fill('Noah');
    await expect(add).toBeDisabled();
    await chooseGradeLevel(page, 'student-grade-level', first.name);
    await expect(add).toBeEnabled();
    await add.click();

    await expect(row(page, 'Noah')).toBeVisible();
    await expect(row(page, 'Noah').getByText(first.name).first()).toBeVisible();
    await expect(row(page, 'Noah').getByText('Active')).toBeVisible();
    await expect(page.locator('main').getByRole('status')).toContainText('Noah was added.');

    const created = await readStudentProfile(email, 'Noah');

    // --- Rename -----------------------------------------------------------
    await chooseRowAction(page, 'Noah', 'Rename');
    // By role, not by label: both layouts carry the rename form, and only the one
    // that is drawn is in the accessibility tree.
    await page.getByRole('textbox', { name: 'New name' }).fill('Noa');
    await page.getByRole('button', { name: 'Save the name' }).click();
    await expect(row(page, 'Noa')).toBeVisible();
    // The old name is gone from the screen, not merely contained in the new one.
    await expect(row(page, 'Noah')).toHaveCount(0);

    // The same row: the id and the creation instant are untouched by a rename.
    const renamed = await readStudentProfile(email, 'Noa');
    expect(renamed.id).toBe(created.id);
    expect(renamed.createdAt.getTime()).toBe(created.createdAt.getTime());

    // --- Change the grade level -------------------------------------------
    const id = await profileId(page, 'Noa');
    await chooseGradeLevel(page, `student-grade-level-${id}`, second.name);
    await expect(row(page, 'Noa').getByText(second.name).first()).toBeVisible();
    // The name is untouched by a grade-level change.
    await expect(row(page, 'Noa')).toBeVisible();

    // --- Archive ------------------------------------------------------------
    const dialog = await confirmArchive(page, 'Noa');
    // Archiving says plainly that it is not a delete.
    expect(dialog).toContain('hidden from Student Mode');
    expect(dialog).toContain('Nothing is deleted.');

    // It is still on the screen, plainly marked — nothing was removed.
    await expect(row(page, 'Noa').getByText('Archived')).toBeVisible();
    const archived = await readStudentProfile(email, 'Noa');
    expect(archived.id).toBe(created.id);
    expect(archived.createdAt.getTime()).toBe(created.createdAt.getTime());
    // Out of what Student Mode may bind to: `archivedAt` is what that list
    // filters on, and the API-level list is asserted in the integration suite.
    expect(archived.archivedAt).not.toBeNull();

    // --- Restore ------------------------------------------------------------
    await chooseRowAction(page, 'Noa', 'Restore');
    await expect(row(page, 'Noa').getByText('Active')).toBeVisible();
    const restored = await readStudentProfile(email, 'Noa');
    expect(restored.archivedAt).toBeNull();
    expect(restored.id).toBe(created.id);

    // --- The same action twice, announced twice -----------------------------
    const secondArchive = await confirmArchive(page, 'Noa');
    expect(secondArchive).toContain('Nothing is deleted.');
    // The identical sentence is still a change in the live region, so a repeat
    // is still announced.
    await expect(page.locator('main').getByRole('status')).toContainText('Noa is archived');
  });

  test('says the stored grade level is no longer offered once Admin withdraws it', async ({
    page,
  }) => {
    const withdrawn = await createGradeLevelFixture('E2E Grade Withdrawn');
    await createGradeLevelFixture('E2E Grade Replacement');
    const email = await openStudents(page);

    await page.locator('#student-name').fill('Mira');
    await chooseGradeLevel(page, 'student-grade-level', withdrawn.name);
    await page.getByRole('button', { name: 'Add the profile' }).click();
    await expect(row(page, 'Mira')).toBeVisible();
    // The ordinary note, while the grade level is still offered.
    await expect(row(page, 'Mira')).toContainText('does not change any practice test already made');

    // Admin withdraws it: the flag alone, nothing deleted.
    await disableGradeLevelFixture(withdrawn.id);
    await page.reload();
    await page.locator('#parent-pin').fill(PIN);
    await page.getByRole('button', { name: 'Enter Parent View' }).click();
    await page
      .getByRole('navigation', { name: 'Parent View' })
      .getByRole('link', { name: 'Student Profiles' })
      .click();

    // The profile still reads, still names its grade level, and now says the
    // choice is no longer on offer.
    await expect(row(page, 'Mira')).toBeVisible();
    await expect(row(page, 'Mira')).toContainText(withdrawn.name);
    await expect(row(page, 'Mira')).toContainText('This grade level is no longer offered.');
    await expect(row(page, 'Mira')).not.toContainText(
      'does not change any practice test already made',
    );

    // And the row survived untouched.
    const stored = await readStudentProfile(email, 'Mira');
    expect(stored.archivedAt).toBeNull();
  });

  test('offers all three actions in one menu, with Delete set apart and last', async ({ page }) => {
    const level = await createGradeLevelFixture('E2E Grade Menu');
    await openStudents(page);
    await page.locator('#student-name').fill('Ada');
    await chooseGradeLevel(page, 'student-grade-level', level.name);
    await page.getByRole('button', { name: 'Add the profile' }).click();
    await expect(row(page, 'Ada')).toBeVisible();

    const trigger = page.getByRole('button', { name: rowActionsName('Ada') });

    // The icon's word, on keyboard focus and on hover both. An icon-only
    // control that names itself to a pointer alone is an unlabelled glyph to
    // everybody else.
    //
    // Focus first, and reached by Tab rather than by `.focus()`: MUI opens the
    // tooltip only for `:focus-visible`, which a programmatic focus does not
    // set — so the keyboard case has to be walked, and walked before any hover
    // has left a pointer sitting on the control.
    await focusByKeyboard(page, rowActionsName('Ada'));
    await expect(page.getByRole('tooltip')).toContainText(rowActionsName('Ada'));

    await trigger.hover();
    await expect(page.getByRole('tooltip')).toContainText(rowActionsName('Ada'));

    await trigger.click();
    const menu = page.getByRole('menu', { name: rowActionsName('Ada') });
    await expect(menu).toBeVisible();

    // All three, in the order the story fixes, each showing its own word.
    await expect(menu.getByRole('menuitem')).toHaveText([/Rename/, /Archive/, /Delete/]);

    // Delete is last, preceded by a separator, and in the error colour.
    const items = menu.getByRole('menuitem');
    const deleteItem = items.last();
    await expect(deleteItem).toHaveText(/Delete/);
    await expect(menu.getByRole('separator')).toHaveCount(1);
    const setApart = await deleteItem.evaluate((element) => {
      const previous = element.previousElementSibling;
      return {
        colour: getComputedStyle(element).color,
        errorColour: getComputedStyle(element).getPropertyValue('--mui-palette-error-main').trim(),
        afterSeparator:
          previous?.getAttribute('role') === 'separator' || previous?.tagName === 'HR',
      };
    });
    expect(setApart.afterSeparator).toBe(true);
    // The theme's own error colour, not merely "some red".
    expect(rgbOf(setApart.colour)).toBe(rgbOf(setApart.errorColour));

    // --- The arrows move between the items --------------------------------
    // This is the menu with three of them, so it is where "arrow keys move
    // between items" can actually be observed.
    const first = await focusedControl(page);
    expect(first.role).toBe('menuitem');
    await page.keyboard.press('ArrowDown');
    const second = await focusedControl(page);
    expect(second.role).toBe('menuitem');
    expect(second.name).not.toBe(first.name);
    await page.keyboard.press('ArrowUp');
    expect((await focusedControl(page)).name).toBe(first.name);

    // --- And the action itself still runs from in there -------------------
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await chooseRowAction(page, 'Ada', 'Delete');
    // The password-gated confirmation, naming the child and what goes.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Ada');
    await expect(dialog).toContainText('cannot be undone');
    await expect(dialog.getByLabel(/account password/i)).toBeVisible();

    // Backed out of, so nothing is destroyed and the row is still there.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(row(page, 'Ada')).toBeVisible();
  });

  test('shows cards, not the table, at phone width — one icon and one line', async ({ page }) => {
    // Below `lg` the table is `display: none` and the layout a phone is shown is
    // the card list (Story 1.9). What used to wrap onto three lines is now the
    // card's own action area, and it is still one icon on one line.
    const level = await createGradeLevelFixture('E2E Grade Narrow');
    // Arrived at full width and then narrowed: the Parent View sidebar this
    // helper navigates through is not on screen at phone width, and what is
    // under test is the layout the screen settles into once it is there.
    await openStudents(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#student-name').fill('Ira');
    await chooseGradeLevel(page, 'student-grade-level', level.name);
    await page.getByRole('button', { name: 'Add the profile' }).click();
    await expect(page.locator('[data-testid="student-card"][data-name="Ira"]')).toBeVisible();

    // The table is out of the accessibility tree and off the screen entirely, so
    // no row is announced twice and nothing is read without its counts.
    await expect(page.getByTestId('student-row').first()).toBeHidden();
    // A real list of real list items, and the card is named by the child.
    const card = page.locator('[data-testid="student-card"][data-name="Ira"]');
    await expect(card).toHaveJSProperty('tagName', 'LI');
    await expect(card).toHaveAttribute('aria-label', 'Ira');
    // Both remaining columns are on the card, each under its own label.
    await expect(card).toContainText('Grade level');
    await expect(card).toContainText('Status');
    await expect(card).toContainText('Active');

    const cell = await measureCardActions(page, '[data-testid="student-card"][data-name="Ira"]');
    // All three actions are in the menu, so the ⋮ is the card's only control.
    expect(cell.buttons).toBe(1);
    expect(cell.text).toBe('');
    expect(cell.height).toBeLessThan(ONE_LINE_CEILING);

    // And nothing on the screen scrolls sideways at 390px — measured over every
    // box inside `main`, because the page-level figure is blind to a wrapper
    // that scrolls on its own.
    expect(await worstSidewaysOverflow(page)).toBeLessThanOrEqual(0);
  });

  test('renames a profile from its card at phone width', async ({ page }) => {
    // The whole change rests on the card suffixing every row-scoped id while the
    // table keeps today's: drop `${idSuffix}` from the rename template and the
    // visible phone input loses the label bound to it, with every desktop rename
    // test still green. This is the test that notices.
    const level = await createGradeLevelFixture('E2E Grade Card Rename');
    const email = await openStudents(page);
    await page.locator('#student-name').fill('Rena');
    await chooseGradeLevel(page, 'student-grade-level', level.name);
    await page.getByRole('button', { name: 'Add the profile' }).click();
    await expect(row(page, 'Rena')).toBeVisible();
    const created = await readStudentProfile(email, 'Rena');

    await page.setViewportSize({ width: 390, height: 844 });
    const card = page.locator('[data-testid="student-card"][data-name="Rena"]');
    await expect(card).toBeVisible();

    // Opened from the card's own ⋮, and the form replaces the title in place.
    await chooseRowAction(page, 'Rena', 'Rename');
    const input = page.getByRole('textbox', { name: 'New name' });
    // Exactly one rename input is in the accessibility tree — the card's. The
    // table's is `display: none`, so its id is the one nothing points at here.
    await expect(input).toHaveCount(1);
    await expect(input).toHaveAttribute('id', /-card$/u);
    await input.fill('Renata');
    await page.getByRole('button', { name: 'Save the name' }).click();

    await expect(page.locator('[data-testid="student-card"][data-name="Renata"]')).toBeVisible();
    await expect(page.locator('[data-testid="student-card"][data-name="Rena"]')).toHaveCount(0);
    // The same row, renamed through the card: the write the card fired is the
    // write the table's form fires, not a second one.
    expect((await readStudentProfile(email, 'Renata')).id).toBe(created.id);
  });

  test('lays the cards out in two columns in the tablet band', async ({ page }) => {
    // 600–1200px is the band nothing else observes: one column below 600, two
    // from 600, and the table only from 1200.
    const level = await createGradeLevelFixture('E2E Grade Band');
    const email = await openStudents(page);
    // Two cards are the point, and the Free tier allows one profile — so the
    // account is moved off it before the second is added. The limit is enforced
    // per request, so no reload is needed for the second create to be allowed.
    await setParentTierFixture(email, 'Family');
    for (const name of ['Bandi', 'Bandu']) {
      await page.locator('#student-name').fill(name);
      await chooseGradeLevel(page, 'student-grade-level', level.name);
      await page.getByRole('button', { name: 'Add the profile' }).click();
      await expect(row(page, name)).toBeVisible();
    }

    await page.setViewportSize({ width: 768, height: 1024 });
    const first = page.locator('[data-testid="student-card"][data-name="Bandi"]');
    const second = page.locator('[data-testid="student-card"][data-name="Bandu"]');
    await expect(first).toBeVisible();
    // The table is still gone at 768: the cutoff is `lg`, not `sm`.
    await expect(page.getByTestId('student-row').first()).toBeHidden();

    const [a, b] = [await first.boundingBox(), await second.boundingBox()];
    expect(a, 'first card box').toBeTruthy();
    expect(b, 'second card box').toBeTruthy();
    // Side by side: their vertical extents overlap and their x origins differ.
    expect(a!.y).toBeLessThan(b!.y + b!.height);
    expect(b!.y).toBeLessThan(a!.y + a!.height);
    expect(b!.x).toBeGreaterThan(a!.x + a!.width - 1);

    // And one column below the `sm` cutoff: the same two cards stack.
    await page.setViewportSize({ width: 390, height: 844 });
    const [narrowA, narrowB] = [await first.boundingBox(), await second.boundingBox()];
    expect(narrowB!.y).toBeGreaterThanOrEqual(narrowA!.y + narrowA!.height - 1);
  });

  test('shows the table, not cards, at desktop width', async ({ page }) => {
    // The swap is only observable in a real viewport, so both ends of it are
    // checked: at 1280px the table is what renders and the card list is gone.
    const level = await createGradeLevelFixture('E2E Grade Wide');
    await openStudents(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator('#student-name').fill('Wide');
    await chooseGradeLevel(page, 'student-grade-level', level.name);
    await page.getByRole('button', { name: 'Add the profile' }).click();
    await expect(row(page, 'Wide')).toBeVisible();

    await expect(page.locator('[data-testid="student-card"][data-name="Wide"]')).toBeHidden();
    const cell = await measureActionCell(page, '[data-testid="student-row"][data-name="Wide"]');
    expect(cell.buttons).toBe(1);
    expect(cell.scrollWidth).toBeLessThanOrEqual(cell.clientWidth);
  });

  test('sends a reloaded Students screen back to the PIN gate', async ({ page }) => {
    await createGradeLevelFixture('E2E Grade Reload');
    await openStudents(page);

    // The elevation token lives in memory alone, so a reload destroys it and
    // the gate goes back up in front of the Students screen too.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Enter your PIN' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Student Profiles', level: 1 })).toBeHidden();
  });
});
