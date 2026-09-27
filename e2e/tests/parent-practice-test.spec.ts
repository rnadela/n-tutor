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
async function uploadAndRead(page: Page, email: string): Promise<{ subjectName: string }> {
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

  // Two controls, not one: the batch legibility check charges nothing, and
  // the commit it gates spends an Upload Allowance. A fixture that wants a
  // submitted upload passes through both.
  await page.getByRole('button', { name: 'Check pages' }).click();
  const commit = page.getByTestId('legibility-continue');
  await expect(commit).toBeVisible({ timeout: 20_000 });
  await commit.click();
  await expect(page.getByTestId('submitted-note')).toBeVisible();
  // The job outlives the request that enqueued it, so this waits on the worker.
  await expect(page.getByRole('button', { name: 'Continue to practice test' })).toBeVisible({
    timeout: 30_000,
  });
  // Returned so a case can assert the Subject the child's list shows: it is
  // generated per run, so no case can spell it out for itself.
  return { subjectName: subject.name };
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

    // The timer since Story 4.6, release and discard since 4.5, edit and delete
    // since 4.4 — each exactly one control, per draft, with no batch anything.
    // The timer is configuration only: nothing here counts down (Epic 5 owns
    // that), so there is no element exposed as a timer on this screen.
    await expect(page.getByTestId('draft-timer')).toHaveCount(1);
    await expect(page.getByRole('timer')).toHaveCount(0);
    await expect(page.getByTestId('draft-release-open')).toHaveCount(1);
    await expect(page.getByTestId('draft-discard-open')).toHaveCount(1);

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

    // --- A typed-but-unsaved time limit survives a delete -------------------
    // Deleting a question moves the *suggested* duration with the question
    // count. A screen that re-seeded the timer from the suggestion would untick
    // the box and overwrite the figure a parent had typed, because they deleted
    // a question — so the state is set up here and checked after the delete
    // below.
    const timerOn = page.getByRole('checkbox', { name: 'Set a time limit' });
    await timerOn.check();
    await page.getByTestId('draft-timer-minutes').fill('42');

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

    // And the unsaved time limit is exactly where the parent left it, even though
    // the suggestion the field was seeded from has moved with the count.
    await expect(timerOn).toBeChecked();
    await expect(page.getByTestId('draft-timer-minutes')).toHaveValue('42');
    await expect(page.getByTestId('draft-timer-suggestion')).toContainText(String(before - 1 + 5));
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

  test('releases one draft into Student Mode, and discards the other', async ({ page }) => {
    // Two drafts, an upload, an extraction, both transitions and a crossing of the
    // mode boundary: the criterion is about what a child can see, which only a
    // browser leaving Parent View can prove.
    test.setTimeout(180_000);
    const email = uniqueParentEmail('draft-release');
    const { subjectName } = await uploadAndRead(page, email);
    await enterGenerate(page);

    await countRow(page, 2).getByRole('radio').check();
    await page.getByTestId('generate-start').click();
    await page.getByTestId('generate-confirm').click();
    await expect(page.getByTestId('generate-progress-line')).toHaveText(
      '2 practice tests are ready.',
      { timeout: 60_000 },
    );
    await page.getByTestId('generate-to-drafts').click();
    const rows = page.locator('[data-testid="draft-row"]');
    await expect(rows).toHaveCount(2);

    // --- Release the first ------------------------------------------------
    await rows.first().getByRole('link', { name: 'Read it' }).click();
    await expect(page.getByRole('heading', { name: 'Read the practice test' })).toBeVisible();
    // Waited for rather than counted straight away: the heading renders while the
    // draft is still loading, so a bare `.count()` here can read zero and every
    // later comparison against it would then be a comparison against nothing.
    await expect(page.locator('[data-testid="draft-question"]').first()).toBeVisible();
    const questionCount = await page.locator('[data-testid="draft-question"]').count();
    expect(questionCount).toBeGreaterThanOrEqual(1);
    const draftUrl = page.url();

    // --- The timer, set while reading the draft it applies to --------------
    // Off by default (FR-15), with the server's suggestion already in the field
    // and nothing stored: a parent who releases without touching this has
    // released an untimed test.
    const timerOn = page.getByRole('checkbox', { name: 'Set a time limit' });
    await expect(timerOn).not.toBeChecked();
    await timerOn.check();
    const minutesField = page.getByTestId('draft-timer-minutes');
    // `questionCount + 5`, from the server. Asserted as the figure the draft
    // actually holds rather than a constant, so it still says something for a
    // draft of any size.
    await expect(minutesField).toHaveValue(String(questionCount + 5));
    await expect(page.getByTestId('draft-timer-suggestion')).toContainText('suggested');

    // A time limit that is on with no figure in it is not a request worth
    // sending, and the control says so rather than the parent finding out from
    // the server.
    const timerSave = page.getByTestId('draft-timer-save');
    await minutesField.fill('');
    await expect(timerSave).toBeDisabled();
    await minutesField.fill('25');
    await expect(timerSave).toBeEnabled();

    await timerSave.click();
    // Announced in the same words the screen shows, third person about the
    // student.
    await expect(page.getByTestId('draft-notice')).toHaveText(
      'The student has 25 minutes for this practice test.',
    );

    // --- And turning it back off is the same statement, with null -----------
    // This is the only layer that chooses `null` at all: with the screen never
    // driven through the off path, `timerOn ? Number(...) : null` could invert
    // and every other test would still pass.
    await timerOn.uncheck();
    await timerSave.click();
    await expect(page.getByTestId('draft-notice')).toHaveText(
      'There is no time limit on this practice test.',
    );

    // --- And it survives a reload -----------------------------------------
    // The elevation bearer is in memory, so a reload goes through the PIN gate
    // and back in by the list. What comes back is the stored row, not anything
    // this browser was holding.
    await page.reload();
    await page.locator('#parent-pin').fill(PIN);
    await page.getByRole('button', { name: 'Enter Parent View' }).click();
    await expect(
      page.getByRole('heading', { name: 'Parent View', level: 1, exact: true }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Pending practice tests' }).click();
    await page
      .locator('[data-testid="draft-row"]')
      .first()
      .getByRole('link', { name: 'Read it' })
      .click();
    await expect(page.getByRole('heading', { name: 'Read the practice test' })).toBeVisible();
    await expect(page.locator('[data-testid="draft-question"]').first()).toBeVisible();
    // The same draft, by its own URL: a different row here would be a different
    // practice test and this assertion is what says so.
    expect(page.url()).toBe(draftUrl);
    // Off came back as off, and off is `null`: the field falls back to the
    // server's suggestion rather than to the 25 that was there before.
    const timerOnAgain = page.getByRole('checkbox', { name: 'Set a time limit' });
    await expect(timerOnAgain).not.toBeChecked();
    await timerOnAgain.check();
    await expect(page.getByTestId('draft-timer-minutes')).toHaveValue(String(questionCount + 5));

    // Set again, so what is released is a timed practice test.
    await page.getByTestId('draft-timer-minutes').fill('25');
    await page.getByTestId('draft-timer-save').click();
    await expect(page.getByTestId('draft-notice')).toHaveText(
      'The student has 25 minutes for this practice test.',
    );

    await page.getByTestId('draft-release-open').click();
    // Both facts, in words, **before** anything happens: the child can see it
    // straight away, and it can no longer be changed. The child is named.
    const releaseBody = page.getByTestId('draft-transition-body');
    await expect(releaseBody).toContainText('straight away');
    await expect(releaseBody).toContainText('can no longer be changed');
    // By name. The name is joined in the browser from the Student Profile read, so
    // without this the whole join could degrade to the neutral stand-in ("A student
    // profile") for every parent and nothing would fail.
    await expect(releaseBody).toContainText('Noah');
    // Cancel leaves the draft exactly as it was.
    await page.getByTestId('draft-transition-cancel').click();
    await expect(page.locator('[data-testid="draft-question"]')).toHaveCount(questionCount);

    await page.getByTestId('draft-release-open').click();
    await page.getByTestId('draft-release-confirm').click();
    // The parent lands on Pending drafts and is told there, by the screen they are
    // actually standing on.
    await expect(page.getByRole('heading', { name: 'Pending practice tests' })).toBeVisible();
    await expect(page.getByTestId('drafts-released')).toHaveText('The practice test was released.');
    // And the released draft has left the list.
    await expect(page.locator('[data-testid="draft-row"]')).toHaveCount(1);
    // With it goes every way of changing its timer. "Editable at any point up to
    // release and never after" is the `Draft` in the API's own `where`; in a
    // browser it looks like this — the released test is reachable from no parent
    // screen, so there is no timer control for it anywhere.
    await expect(page.getByTestId('draft-timer')).toHaveCount(0);

    // --- Read it back as the child ----------------------------------------
    // The one account has one child, so the exit binds straight to them rather
    // than asking a question with a single answer.
    await page.getByRole('button', { name: 'Back to Student Mode' }).click();
    await expect(page.getByRole('heading', { name: 'Your practice', level: 1 })).toBeVisible();
    const tests = page.locator('[data-testid="student-practice-test"]');
    await expect(tests).toHaveCount(1);
    // Per line, never one `toHaveText` over the whole row: the row now carries
    // a Subject, a question count and a state, and an exact match on all of it
    // would break on any one of them moving.
    const row = tests.first();
    await expect(row).toContainText(
      questionCount === 1
        ? 'A practice test with 1 question'
        : `A practice test with ${questionCount} questions`,
    );
    // The Subject the upload was classified under, on the row itself.
    await expect(row.getByTestId('student-practice-test-subject')).toHaveText(subjectName);
    // And the condition, in words — nothing has been sat yet.
    await expect(row.getByTestId('student-practice-test-state')).toHaveText('Not started');
    // The "nothing yet" sentence is gone, and the draft still waiting is not here.
    await expect(page.getByTestId('student-empty')).toHaveCount(0);

    // --- Discard the other ------------------------------------------------
    await page.getByRole('link', { name: 'Parent' }).click();
    await page.locator('#parent-pin').fill(PIN);
    await page.getByRole('button', { name: 'Enter Parent View' }).click();
    await expect(
      page.getByRole('heading', { name: 'Parent View', level: 1, exact: true }),
    ).toBeVisible();
    // Client-side, because the elevation bearer is in memory: a `page.goto` would
    // reload the app, destroy it, and send the parent straight back to the PIN.
    await page.getByRole('link', { name: 'Pending practice tests' }).click();
    const remaining = page.locator('[data-testid="draft-row"]');
    await expect(remaining).toHaveCount(1);
    await remaining.first().getByRole('link', { name: 'Read it' }).click();
    await expect(page.getByRole('heading', { name: 'Read the practice test' })).toBeVisible();

    await page.getByTestId('draft-discard-open').click();
    // Both facts again, before the act: the child never sees it, and the allowance
    // already spent is not given back.
    const discardBody = page.getByTestId('draft-transition-body');
    await expect(discardBody).toContainText('never see it');
    await expect(discardBody).toContainText('not given back');
    await expect(discardBody).toContainText('Noah');
    await page.getByTestId('draft-discard-confirm').click();

    await expect(page.getByTestId('drafts-discarded')).toHaveText(
      'The practice test was discarded.',
    );
    // Gone from Pending drafts, and the list is empty rather than merely shorter.
    await expect(page.getByTestId('drafts-empty')).toBeVisible();

    // And the child still sees exactly the one that was released — a discard
    // reaches no student-facing surface.
    await page.getByRole('button', { name: 'Back to Student Mode' }).click();
    await expect(page.getByRole('heading', { name: 'Your practice', level: 1 })).toBeVisible();
    await expect(page.locator('[data-testid="student-practice-test"]')).toHaveCount(1);
  });

  test('leaves the parent on the draft, told why, when a release is refused', async ({ page }) => {
    // The failure path of the most consequential control in the epic. Without a
    // case that drives it, omitting `setBusy(null)` from the catch — which leaves
    // every control on the screen permanently disabled — ships green, and so does
    // swapping the two failure sentences.
    test.setTimeout(150_000);
    const email = uniqueParentEmail('draft-release-fail');
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
    const draftUrl = page.url();
    // As above: the heading is on screen before the questions are, so the count
    // every later assertion compares against is waited for rather than sampled.
    await expect(page.locator('[data-testid="draft-question"]').first()).toBeVisible();
    const questionCount = await page.locator('[data-testid="draft-question"]').count();

    // Refused at the network, so the screen meets a real failure rather than a
    // mocked client. The retryable case first, because the 404 branch replaces the
    // screen with the missing state and there is no way back to this draft's URL
    // once the bearer is gone — the PIN gate always lands on Parent View.
    await page.route('**/practice-tests/*/release', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
    );

    await page.getByTestId('draft-release-open').click();
    await page.getByTestId('draft-release-confirm').click();

    // Stated as this screen's own action error, in the release's own words.
    await expect(page.getByTestId('draft-action-error')).toHaveText(
      'That practice test could not be released. Try again.',
    );
    // The parent is still reading the draft, and it is still whole.
    expect(page.url()).toBe(draftUrl);
    await expect(page.getByTestId('draft-missing')).toHaveCount(0);
    await expect(page.locator('[data-testid="draft-question"]')).toHaveCount(questionCount);
    // Nothing was announced as a success.
    await expect(page.getByTestId('draft-notice')).toBeEmpty();
    // `busy` was released: the controls work again rather than being dead for the
    // rest of the session.
    await expect(page.getByTestId('draft-release-open')).toBeEnabled();
    await expect(page.getByTestId('draft-discard-open')).toBeEnabled();

    // The timer's sentence is its own too, and its own control comes back from a
    // failure rather than being dead for the rest of the session.
    await page.route('**/practice-tests/*/timer', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
    );
    await page.getByRole('checkbox', { name: 'Set a time limit' }).check();
    await page.getByTestId('draft-timer-save').click();
    await expect(page.getByTestId('draft-action-error')).toHaveText(
      'That time limit could not be saved. Try again.',
    );
    // Nothing was announced as a success, and the draft is still whole.
    await expect(page.getByTestId('draft-notice')).toBeEmpty();
    await expect(page.locator('[data-testid="draft-question"]')).toHaveCount(questionCount);
    await expect(page.getByTestId('draft-timer-save')).toBeEnabled();
    await expect(page.getByTestId('draft-release-open')).toBeEnabled();
    await page.unroute('**/practice-tests/*/timer');

    // The discard's sentence is its own, not the release's.
    await page.unroute('**/practice-tests/*/release');
    await page.route('**/practice-tests/*/discard', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
    );
    await page.getByTestId('draft-discard-open').click();
    await page.getByTestId('draft-discard-confirm').click();
    await expect(page.getByTestId('draft-action-error')).toHaveText(
      'That practice test could not be discarded. Try again.',
    );
    await expect(page.getByTestId('draft-discard-open')).toBeEnabled();

    // And a 404 — the draft moved out from under the screen, which is what a second
    // tab releasing it looks like — is the missing state with the way back, not a
    // fault and not a navigation.
    await page.unroute('**/practice-tests/*/discard');
    await page.route('**/practice-tests/*/release', (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ statusCode: 404, message: 'Nope.' }),
      }),
    );
    await page.getByTestId('draft-release-open').click();
    await page.getByTestId('draft-release-confirm').click();

    await expect(page.getByTestId('draft-missing')).toBeVisible();
    expect(page.url()).toBe(draftUrl);
    await expect(page.getByTestId('draft-notice')).toBeEmpty();
    // The way back is offered in that state, as it is in every other.
    await expect(
      page.getByRole('link', { name: 'Back to the pending practice tests' }),
    ).toBeVisible();
  });
});
