import { expect, test, type Page } from '@playwright/test';
import {
  chargeGenerationAllowanceFixture,
  countPracticeTestsFor,
  createGradeLevelFixture,
  generatedTopicLabelsFor,
  createSubjectFixture,
  setParentTierFixture,
  uniqueParentEmail,
  weightedTopicOfNewestJobFor,
} from '../fixtures';

const PASSWORD = 'correct-horse-battery-staple';
const PIN = '4821';

/**
 * Two real JPEGs, as `parent-capture.spec.ts` carries them: small enough to
 * live here, and embedded rather than read off disk so the suite carries no
 * binary fixtures.
 */
const PAGE_A =
  '/9j/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAgABgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAUG/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AhAJzYgAAAAAP/9k=';
const PAGE_B =
  '/9j/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAgABgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAUG/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AggNOlgAAAAAP/9k=';

function jpeg(name: string, base64: string) {
  return { name, mimeType: 'image/jpeg', buffer: Buffer.from(base64, 'base64') };
}

/** The one polite live region the surface mounts. */
function liveRegion(page: Page) {
  return page.locator('[role="status"][aria-live="polite"]');
}

async function signUp(page: Page, email: string): Promise<void> {
  await page.goto('/auth/sign-up');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByLabel('I accept the terms of use.').check();
  await page.getByLabel('I accept the notice on children’s data.').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Signed in' })).toBeVisible();
}

/**
 * Takes a parent all the way to a committed upload whose Extraction has
 * finished: signed up, past the PIN, one child, two photographed pages,
 * classified and submitted.
 *
 * Every step goes through the browser rather than the database, because what is
 * being proved here is that the Extraction the generator reads is the one the
 * real pipeline wrote.
 */
async function uploadAndRead(page: Page, email: string): Promise<void> {
  const gradeLevel = await createGradeLevelFixture('Generate Grade');
  const subject = await createSubjectFixture('Generate Subject', gradeLevel.id);

  await signUp(page, email);
  await page.getByRole('link', { name: 'Enter Parent View' }).click();
  await page.locator('#parent-pin').fill(PIN);
  await page.getByRole('button', { name: 'Save the PIN' }).click();
  await expect(
    page.getByRole('heading', { name: 'Parent View', level: 1, exact: true }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Student Profiles' }).click();
  await page.locator('#student-name').fill('Noah');
  await page.locator('[role="combobox"]#student-grade-level').click();
  await page.getByRole('option', { name: gradeLevel.name }).click();
  await expect(page.getByRole('listbox')).toBeHidden();
  await page.getByRole('button', { name: 'Add the profile' }).click();
  await expect(page.locator('[data-testid="student-row"][data-name="Noah"]')).toBeVisible();

  await page.getByRole('link', { name: 'Back to Parent View' }).click();
  await page.getByRole('link', { name: 'Upload a test' }).click();
  await expect(page.getByRole('heading', { name: 'Pages', level: 1 })).toBeVisible();

  await page.locator('[role="combobox"]#capture-subject').click();
  await page.getByRole('option', { name: subject.name }).click();
  await expect(page.getByRole('listbox')).toBeHidden();

  for (const file of [jpeg('page-a.jpg', PAGE_A), jpeg('page-b.jpg', PAGE_B)]) {
    const before = await page.locator('[data-testid="page-row"]').count();
    await expect(page.locator('#capture-add-page')).toBeEnabled();
    await page.locator('#capture-add-page').setInputFiles(file);
    await expect(page.locator('[data-testid="page-row"]')).toHaveCount(before + 1, {
      timeout: 20_000,
    });
  }

  await page.getByRole('button', { name: 'Check pages' }).click();
  await expect(page.getByTestId('submitted-note')).toBeVisible();
  // The job outlives the request that enqueued it, so this waits on the worker.
  await expect(page.getByRole('button', { name: 'Continue to practice test' })).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * Crosses the thin-Extraction gate, which the fake's density always trips.
 *
 * `expect(...).toBeVisible()` rather than `if (await warning.isVisible())`:
 * that one does not wait, so the dialog opening a frame later would be missed,
 * the continue would never be clicked, and the URL assertion below would fail
 * intermittently for a reason that has nothing to do with generation. The
 * warning is *expected* here — two pages at one usable question each is
 * exactly the case Story 3.6's threshold exists for — so it is waited for.
 */
async function enterGenerate(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Continue to practice test' }).click();
  const warning = page.getByRole('dialog');
  await expect(warning).toBeVisible();
  await warning.getByRole('button', { name: 'Continue anyway' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(/\/parent\/generate\//);
  await expect(page.getByRole('heading', { name: 'Generate practice tests' })).toBeVisible();
}

/** One count's radio row, by the count it offers. */
function countRow(page: Page, count: number) {
  return page.locator(`[data-testid="generate-count-option"][data-count="${count}"]`);
}

/** The screen's own value for "no weighting", which is the group's default. */
const ALL_TOPICS = '__all__';

/**
 * One topic's radio row, by the label it offers.
 *
 * Matched by reading the attribute rather than by interpolating the label into
 * a CSS attribute selector: a Topic label is text read off a parent's own
 * page, and a quote or a backslash in it would make that selector a syntax
 * error — or, worse, a different selector that quietly matches the wrong row.
 */
async function topicRow(page: Page, topic: string) {
  const rows = page.getByTestId('generate-topic-option');
  await expect(rows.first()).toBeVisible();
  const count = await rows.count();
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    if ((await row.getAttribute('data-topic')) === topic) return row;
  }
  throw new Error('The topic group offered no option for the requested label.');
}

test.describe('generating practice tests', () => {
  test('bounds the choice, states the cost, and produces the drafts', async ({ page }) => {
    const email = uniqueParentEmail('generate');
    await uploadAndRead(page, email);
    await enterGenerate(page);

    // Free tier: two of the allowance, against a per-request ceiling of five.
    // Counts one and two are offered; three, four and five are on screen,
    // disabled, with the reason stated beside each — never trimmed away.
    await expect(page.getByTestId('generate-usage')).toHaveText('Used this period: 0 of 2.');
    await expect(page.locator('[data-testid="generate-count-option"]')).toHaveCount(5);
    for (const count of [1, 2]) {
      await expect(countRow(page, count).getByRole('radio')).toBeEnabled();
    }
    for (const count of [3, 4, 5]) {
      await expect(countRow(page, count).getByRole('radio')).toBeDisabled();
    }
    // The reason is stated once for the group, not repeated beside each of the
    // three counts, and every disabled radio is described by it — a disabled
    // control is not focusable, so a sentence merely next to it is unreachable.
    await expect(page.getByTestId('generate-count-reason')).toHaveText(
      'Only 2 practice tests are left in this period’s Generation Allowance.',
    );
    for (const count of [3, 4, 5]) {
      await expect(countRow(page, count).getByRole('radio')).toHaveAttribute(
        'aria-describedby',
        'generate-count-reason',
      );
    }

    // The cost is on screen before the confirm control is ever reached, in
    // practice tests, naming both what is spent and what is left.
    await expect(page.getByTestId('generate-cost')).toHaveText(
      'This uses 2 practice tests of the Generation Allowance. 0 will be left this period.',
    );

    await countRow(page, 1).getByRole('radio').check();
    await expect(page.getByTestId('generate-cost')).toHaveText(
      'This uses 1 practice test of the Generation Allowance. 1 will be left this period.',
    );

    // And again in the confirmation, which is the last thing read before the
    // allowance is spent.
    await page.getByTestId('generate-start').click();
    const confirm = page.getByRole('dialog');
    await expect(confirm).toBeVisible();
    await expect(page.getByTestId('generate-confirm-cost')).toHaveText(
      'This uses 1 practice test of the Generation Allowance. 1 will be left this period.',
    );
    await page.getByTestId('generate-confirm').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Progress is the job's own, read from the server — and the advice to stay
    // never claims that leaving loses anything.
    await expect(page.getByTestId('generate-progress')).toBeVisible();
    await expect(page.getByTestId('generate-progress-line')).toHaveText(
      '1 practice test is ready.',
      { timeout: 30_000 },
    );
    // Announced in exactly the words it displays.
    await expect(liveRegion(page)).toContainText('1 practice test is ready.');

    // One draft landed, charged, and the allowance now says so — on the screen
    // as well as in the database. The reading taken on arrival described the
    // account before this job spent anything; a picker still offering two
    // would be offering a count the server has just stopped accepting.
    await expect(page.getByTestId('generate-usage')).toHaveText('Used this period: 1 of 2.');
    await expect(countRow(page, 1).getByRole('radio')).toBeEnabled();
    await expect(countRow(page, 2).getByRole('radio')).toBeDisabled();
    expect(await countPracticeTestsFor(email)).toBe(1);
  });

  test('focuses the request on one topic, at exactly the same cost', async ({ page }) => {
    const email = uniqueParentEmail('generate-weighted');
    await uploadAndRead(page, email);
    await enterGenerate(page);

    // "All topics" is the default and the first option: choosing it is
    // choosing the unweighted request every earlier story made.
    const allTopics = await topicRow(page, ALL_TOPICS);
    await expect(allTopics.getByRole('radio')).toBeChecked();

    // The Extraction's own topics, offered beside it. The labels come from the
    // API, so this reads one off the screen rather than naming it here.
    const rows = page.locator('[data-testid="generate-topic-option"]');
    expect(await rows.count()).toBeGreaterThan(1);
    const chosen = rows.nth(1);
    const topic = await chosen.getAttribute('data-topic');
    expect(topic).toBeTruthy();

    await countRow(page, 1).getByRole('radio').check();
    const cost =
      'This uses 1 practice test of the Generation Allowance. 1 will be left this period.';
    await expect(page.getByTestId('generate-cost')).toHaveText(cost);

    await chosen.getByRole('radio').check();
    await expect(chosen.getByRole('radio')).toBeChecked();
    await expect(allTopics.getByRole('radio')).not.toBeChecked();
    // Weighting changes what is generated, never what it costs.
    await expect(page.getByTestId('generate-cost')).toHaveText(cost);

    await page.getByTestId('generate-start').click();
    await expect(page.getByTestId('generate-confirm-cost')).toHaveText(cost);
    await page.getByTestId('generate-confirm').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Not asserted on here: the *in-progress* line names the topic, but a job
    // this small can settle between two polls, so waiting for that sentence
    // would be waiting for a window that need not exist. The sentence itself
    // is a pure function, asserted on its output in
    // `practice-test-count.spec.ts`.
    //
    // The settled line, though, is a window that always exists — and it names
    // the topic too, because a parent returning after the job finished has to
    // read the request they actually made. The label is the one read off the
    // screen above, never a literal.
    await expect(page.getByTestId('generate-progress-line')).toHaveText(
      `1 practice test is ready, focused on ${topic}.`,
      { timeout: 30_000 },
    );
    // One draft landed, and it cost exactly what an unweighted one costs.
    await expect(page.getByTestId('generate-usage')).toHaveText('Used this period: 1 of 2.');
    expect(await countPracticeTestsFor(email)).toBe(1);

    // The choice actually left the browser, was resolved against the
    // Extraction and was persisted. Without this the whole pass would still be
    // green if the screen quietly sent an unweighted request.
    expect(await weightedTopicOfNewestJobFor(email)).toBe(topic);

    // And the draft that landed was written against it: most of its questions
    // carry the chosen topic, which is the rule the request bought.
    const labels = await generatedTopicLabelsFor(email);
    expect(labels.length).toBeGreaterThan(0);
    const onTopic = labels.filter((label) => label === topic).length;
    expect(onTopic).toBeGreaterThan(labels.length - onTopic);
  });

  test('survives leaving the screen and coming back to its URL', async ({ page }) => {
    const email = uniqueParentEmail('generate-return');
    await uploadAndRead(page, email);
    await enterGenerate(page);

    const url = page.url();
    await countRow(page, 1).getByRole('radio').check();
    await page.getByTestId('generate-start').click();
    await page.getByTestId('generate-confirm').click();
    await expect(page.getByTestId('generate-progress')).toBeVisible();

    // Away, through the app's own link, and back through history. Neither is a
    // `goto`: the elevation bearer lives in the page's memory alone (AD-18), so
    // a full navigation would land on the PIN gate rather than prove anything
    // about the job. The screen unmounts on the way out and mounts again on the
    // way in, which is the whole point — whatever it then shows, it read.
    await page.getByRole('link', { name: 'Back to the upload' }).click();
    await expect(page.getByRole('heading', { name: 'Pages', level: 1 })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(url);
    await expect(page.getByRole('heading', { name: 'Generate practice tests' })).toBeVisible();

    // What comes back is the job's own state, read from the server — nothing
    // this browser was holding.
    await expect(page.getByTestId('generate-progress-line')).toHaveText(
      '1 practice test is ready.',
      { timeout: 30_000 },
    );
    expect(await countPracticeTestsFor(email)).toBe(1);
  });

  test('disables every count once the allowance is spent, and says why', async ({ page }) => {
    const email = uniqueParentEmail('generate-spent');
    await uploadAndRead(page, email);
    // Both of the Free tier's units already charged — expressed as the charged
    // rows usage is derived from, because no counter column exists.
    await chargeGenerationAllowanceFixture(email, 2);
    await enterGenerate(page);

    await expect(page.getByTestId('generate-usage')).toHaveText('Used this period: 2 of 2.');
    for (const count of [1, 2, 3, 4, 5]) {
      await expect(countRow(page, count).getByRole('radio')).toBeDisabled();
    }
    await expect(page.getByTestId('generate-count-reason')).toHaveText(
      'No Generation Allowance is left this period.',
    );
    // Nothing to spend, so nothing to confirm.
    await expect(page.getByTestId('generate-start')).toBeDisabled();
  });

  test('shows every generated question, with its answer and its topics', async ({ page }) => {
    // Two drafts, an upload and an extraction all in one pass: the longest
    // journey in this file, and the default budget is written for the shortest.
    test.setTimeout(150_000);
    const email = uniqueParentEmail('generate-review');
    await uploadAndRead(page, email);
    await enterGenerate(page);

    // Two drafts, so "draft N of M" is a real figure rather than "1 of 1".
    await countRow(page, 2).getByRole('radio').check();
    await page.getByTestId('generate-start').click();
    await page.getByTestId('generate-confirm').click();
    await expect(page.getByTestId('generate-progress-line')).toHaveText(
      '2 practice tests are ready.',
      { timeout: 60_000 },
    );

    // A finished job links on to Pending drafts — the destination a parent who
    // left would have found the drafts at anyway.
    await page.getByTestId('generate-to-drafts').click();
    await expect(
      page.getByRole('heading', { name: 'Pending practice tests', level: 1 }),
    ).toBeVisible();

    const rows = page.locator('[data-testid="draft-row"]');
    await expect(rows).toHaveCount(2);
    // The figures are the server's: the browser holds a list, not the job.
    await expect(rows.nth(0).getByTestId('draft-position')).toHaveText(/^Draft [12] of 2$/u);
    // The child's name, joined in the browser from the Student Profile read.
    await expect(rows.nth(0)).toContainText('For Noah');

    const reviewed = rows.nth(0);
    const position = await reviewed.getByTestId('draft-position').innerText();
    await reviewed.getByRole('link', { name: 'Read it' }).click();

    await expect(page.getByRole('heading', { name: 'Read the practice test' })).toBeVisible();
    // The same draft, named the same way, from the server's own figures.
    await expect(page.getByTestId('draft-position')).toHaveText(position);
    const draftUrl = page.url();

    const questions = page.locator('[data-testid="draft-question"]');
    const questionCount = await questions.count();
    expect(questionCount).toBeGreaterThan(0);
    // Every Question the draft holds is in the list — the count the server
    // states, and no fewer.
    await expect(page.getByTestId('draft-question-total')).toHaveText(
      questionCount === 1 ? '1 question' : `${questionCount} questions`,
    );

    for (let index = 0; index < questionCount; index += 1) {
      const question = questions.nth(index);
      // In stored order, 1-based.
      await expect(question).toHaveAttribute('data-ordinal', String(index + 1));
      await expect(question.getByTestId('draft-question-prompt')).not.toBeEmpty();
      // A Topic, read out of the DOM rather than asserted as a literal: the
      // labels are content read off the parent's own page.
      await expect(question.getByTestId('draft-question-topics')).not.toBeEmpty();

      const choices = question.locator('[data-testid="draft-choice"]');
      if ((await choices.count()) > 0) {
        // Exactly one option is marked correct, and it is marked in words.
        await expect(
          question.locator('[data-testid="draft-choice"][data-correct="true"]'),
        ).toHaveCount(1);
        await expect(question.getByTestId('draft-choice-correct')).toHaveText('Correct');
      } else {
        await expect(question.getByTestId('draft-question-answer')).not.toBeEmpty();
      }
    }

    // A fraction is drawn as structure and carries its own spoken reading —
    // never flattened to the glyph the schema went to the trouble of avoiding.
    const fraction = page.locator('[data-testid="rich-text-fraction"]').first();
    await expect(fraction).toBeVisible();
    await expect(fraction).toHaveAttribute('role', 'math');
    const reading = await fraction.getAttribute('aria-label');
    expect(reading).toMatch(/^\d+( and \d+)? over \d+$/u);

    // Release, discard and the timer are Stories 4.5 and 4.6: no control for
    // any of them exists here. Edit and delete do — they are this screen's
    // whole point since Story 4.4, and they are exercised below.
    for (const name of [/release/iu, /discard/iu, /timer/iu]) {
      await expect(page.getByRole('button', { name })).toHaveCount(0);
    }

    // The review position is the URL and nothing else. A reload would drop the
    // in-memory bearer, so this is the return a parent makes through the app —
    // the same address, the same draft, with nothing stored anywhere.
    await page.getByRole('link', { name: 'Back to the pending practice tests' }).click();
    await expect(rows).toHaveCount(2);
    await page.goBack();
    await expect(page).toHaveURL(draftUrl);
    await expect(page.getByTestId('draft-position')).toHaveText(position);
    await expect(page.locator('[data-testid="draft-question"]')).toHaveCount(questionCount);
  });

  test('offers every count on an unlimited tier, with no remainder invented', async ({ page }) => {
    const email = uniqueParentEmail('generate-unlimited');
    await uploadAndRead(page, email);
    await setParentTierFixture(email, 'Internal');
    await enterGenerate(page);

    await expect(page.getByTestId('generate-usage')).toHaveText(
      'Used this period: 0 of Unlimited.',
    );
    for (const count of [1, 2, 3, 4, 5]) {
      await expect(countRow(page, count).getByRole('radio')).toBeEnabled();
    }
    // No "N will be left": there is no honest number, so none is stated.
    await expect(page.getByTestId('generate-cost')).toHaveText(
      'This uses 5 practice tests of the Generation Allowance. The allowance on this account is unlimited.',
    );
  });

  test('edits a question in place, and deletes one so the survivors renumber', async ({ page }) => {
    // An upload, an extraction and a draft, then two mutations on it.
    test.setTimeout(150_000);
    const email = uniqueParentEmail('draft-edit');
    await uploadAndRead(page, email);
    await enterGenerate(page);

    await countRow(page, 1).getByRole('radio').check();
    await page.getByTestId('generate-start').click();
    await page.getByTestId('generate-confirm').click();
    await expect(page.getByTestId('generate-progress-line')).toHaveText(
      '1 practice test is ready.',
      { timeout: 60_000 },
    );
    await page.getByTestId('generate-to-drafts').click();
    await page
      .locator('[data-testid="draft-row"]')
      .first()
      .getByRole('link', { name: 'Read it' })
      .click();
    await expect(page.getByRole('heading', { name: 'Read the practice test' })).toBeVisible();

    const questions = page.locator('[data-testid="draft-question"]');
    const before = await questions.count();
    expect(before).toBeGreaterThanOrEqual(2);

    // --- Edit the first question's prompt, in place ------------------------
    // A question of a known format, so the radio-group path is genuinely
    // exercised rather than skipped whenever the generator happens not to
    // produce options.
    const first = questions.nth(0);
    await expect(first).toHaveAttribute('data-format', 'MultipleChoice');
    await first.getByTestId('draft-edit-open').click();
    await expect(first).toHaveAttribute('data-editing', 'true');
    // Opening the editor puts focus in the field, rather than leaving it on a
    // control that no longer exists.
    const prompt = first.getByTestId('draft-edit-prompt');
    await expect(prompt).toBeFocused();
    await prompt.fill('What is 1/2 of 8?');
    // A multiple-choice question states which option is right on every save.
    const corrects = first.locator('[data-testid="draft-edit-correct"]');
    await expect(corrects).toHaveCount(3);
    await corrects.nth(2).check();
    await first.getByTestId('draft-edit-save').click();

    // Back to the read view, on the same row, with no navigation.
    await expect(first).toHaveAttribute('data-editing', 'false');
    await expect(page.getByTestId('draft-notice')).toHaveText('Question 1 was saved.');
    // Focus comes back to the control that opened the editor.
    await expect(first.getByTestId('draft-edit-open')).toBeFocused();
    // The option that was marked correct is the third, in words.
    await expect(first.locator('[data-testid="draft-choice"][data-correct="true"]')).toHaveCount(1);
    await expect(first.locator('[data-testid="draft-choice"]').nth(2)).toContainText('Correct');
    await expect(first.getByTestId('draft-question-prompt')).toContainText('What is');
    // The fraction is stored as structure, not as the glyph the schema avoids:
    // it comes back drawn, with its own spoken reading.
    const fraction = first.locator('[data-testid="rich-text-fraction"]').first();
    await expect(fraction).toBeVisible();
    await expect(fraction).toHaveAttribute('aria-label', '1 over 2');

    // And it is what is stored: the return through the app re-reads the draft.
    await page.getByRole('link', { name: 'Back to the pending practice tests' }).click();
    await page
      .locator('[data-testid="draft-row"]')
      .first()
      .getByRole('link', { name: 'Read it' })
      .click();
    await expect(page.locator('[data-testid="draft-question"]').nth(0)).toContainText('What is');
    await expect(
      page
        .locator('[data-testid="draft-question"]')
        .nth(0)
        .locator('[data-testid="rich-text-fraction"]'),
    ).toHaveAttribute('aria-label', '1 over 2');

    // --- Delete the second, and read the renumbering off the DOM -----------
    const second = page.locator('[data-testid="draft-question"]').nth(1);
    await second.getByTestId('draft-delete-open').click();
    // Named before anything is destroyed, with what would be left.
    await expect(page.getByTestId('draft-delete-body')).toContainText(
      'Question 2 will be deleted.',
    );
    // Cancel leaves the draft exactly as it was.
    await page.getByTestId('draft-delete-cancel').click();
    await expect(page.locator('[data-testid="draft-question"]')).toHaveCount(before);

    await second.getByTestId('draft-delete-open').click();
    await page.getByTestId('draft-delete-confirm').click();

    await expect(page.locator('[data-testid="draft-question"]')).toHaveCount(before - 1);
    await expect(page.getByTestId('draft-question-total')).toHaveText(
      before - 1 === 1 ? '1 question' : `${before - 1} questions`,
    );
    // Contiguous from 1: the survivors were renumbered, not left with a gap.
    for (let index = 0; index < before - 1; index += 1) {
      await expect(page.locator('[data-testid="draft-question"]').nth(index)).toHaveAttribute(
        'data-ordinal',
        String(index + 1),
      );
    }
  });

  test('deletes the last question, which discards the practice test', async ({ page }) => {
    test.setTimeout(150_000);
    const email = uniqueParentEmail('draft-discard');
    await uploadAndRead(page, email);
    await enterGenerate(page);

    await countRow(page, 1).getByRole('radio').check();
    await page.getByTestId('generate-start').click();
    await page.getByTestId('generate-confirm').click();
    await expect(page.getByTestId('generate-progress-line')).toHaveText(
      '1 practice test is ready.',
      { timeout: 60_000 },
    );
    await page.getByTestId('generate-to-drafts').click();
    await page
      .locator('[data-testid="draft-row"]')
      .first()
      .getByRole('link', { name: 'Read it' })
      .click();
    await expect(page.getByRole('heading', { name: 'Read the practice test' })).toBeVisible();

    const questions = page.locator('[data-testid="draft-question"]');
    // Down to one, through the screen rather than through the database: what is
    // under test is the confirmation a parent actually reads.
    while ((await questions.count()) > 1) {
      await questions.last().getByTestId('draft-delete-open').click();
      await page.getByTestId('draft-delete-confirm').click();
      await expect(page.getByTestId('draft-notice')).not.toBeEmpty();
    }
    await expect(questions).toHaveCount(1);

    await questions.first().getByTestId('draft-delete-open').click();
    // Both facts, in words, **before** anything is destroyed: that the practice
    // test goes with it, and that the allowance already spent is not refunded.
    const body = page.getByTestId('draft-delete-body');
    await expect(body).toContainText('discards the whole practice test');
    await expect(body).toContainText('Generation Allowance already used on it is not given back');
    // Cancel leaves the draft exactly as it was.
    await page.getByTestId('draft-delete-cancel').click();
    await expect(questions).toHaveCount(1);

    await questions.first().getByTestId('draft-delete-open').click();
    await page.getByTestId('draft-delete-confirm').click();

    // The parent lands on Pending drafts, and is told what happened there —
    // the screen that knew was the one being navigated away from.
    await expect(page.getByRole('heading', { name: 'Pending practice tests' })).toBeVisible();
    await expect(page.getByTestId('drafts-discarded')).toHaveText(
      'The practice test was discarded.',
    );
    // And it is gone from the list, not merely emptied.
    await expect(page.getByTestId('drafts-empty')).toBeVisible();
  });
});
