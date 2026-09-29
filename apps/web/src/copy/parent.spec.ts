import { describe, expect, it } from 'vitest';
import { parentCopy } from '@/copy/parent';
import type { AccountDeletionPreview } from '@/lib/parent-api';

/**
 * The confirmation sentences the parent copy authors, tested as copy.
 *
 * The body of a destructive confirmation *is* the acceptance criterion: FR-33
 * requires the sentence the parent confirms against to name what will be
 * destroyed and that it cannot be undone. So it is asserted here, against the one
 * place the words live, rather than only through a screen that happens to render
 * it.
 */

const FULL: AccountDeletionPreview = {
  students: 2,
  sourceTests: 3,
  pageImages: 7,
  practiceTests: 4,
  attempts: 5,
  explanations: 6,
  masteryTopics: 8,
};

const EMPTY: AccountDeletionPreview = {
  students: 0,
  sourceTests: 0,
  pageImages: 0,
  practiceTests: 0,
  attempts: 0,
  explanations: 0,
  masteryTopics: 0,
};

describe('the confirmation’s sentence', () => {
  it('names the children first, then every count and kind that has something in it', () => {
    const said = parentCopy.settings.deleteAccountBody(FULL);
    expect(said).toContain('2 student profiles');
    expect(said.indexOf('2 student profiles')).toBeLessThan(said.indexOf('3 uploaded tests'));
    for (const phrase of [
      '3 uploaded tests',
      '7 photographs',
      '4 practice tests',
      '5 finished runs',
      '6 explanations',
      '8 topics with progress saved',
    ]) {
      expect(said).toContain(phrase);
    }
  });

  it('leaves out every kind that has nothing in it', () => {
    const said = parentCopy.settings.deleteAccountBody({
      ...EMPTY,
      students: 1,
      pageImages: 1,
    });
    // "0 practice tests" is noise in a sentence a parent is meant to read
    // carefully.
    expect(said).toContain('1 student profile');
    expect(said).toContain('1 photograph');
    expect(said).not.toMatch(/\b0 /u);
    expect(said).not.toMatch(/practice test/i);
  });

  it('keeps a count whose digits end in zero, which is not an absent kind', () => {
    // "10 photographs" must survive the rule that drops "0 photographs": the
    // check is a word boundary before the zero, and there is none inside a
    // number. A rule that read the last digit instead would silently delete the
    // largest figures in the sentence.
    const said = parentCopy.settings.deleteAccountBody({
      ...EMPTY,
      students: 10,
      pageImages: 20,
    });
    expect(said).toContain('10 student profiles');
    expect(said).toContain('20 photographs');
    expect(said).not.toMatch(/nothing saved under it/i);
  });

  it('has a short form for an account with nothing under it', () => {
    const said = parentCopy.settings.deleteAccountBody(EMPTY);
    expect(said).toMatch(/nothing saved under it/i);
  });

  it('always states the irreversibility, whatever the counts', () => {
    for (const counts of [FULL, EMPTY, { ...EMPTY, students: 1 }]) {
      const said = parentCopy.settings.deleteAccountBody(counts);
      expect(said).toMatch(/cannot be undone/i);
      expect(said).toMatch(/nothing can be recovered/i);
    }
  });

  it('names something real as the subject, so the title is never headless', () => {
    // `DestructiveConfirmDialog` throws on an empty subject, and the title is
    // "Delete <subject>?".
    expect(parentCopy.settings.deleteAccountSubject.trim().length).toBeGreaterThan(0);
  });
});

describe('the account confirmation’s voice', () => {
  it('uses the typographic apostrophe wherever the parent copy needs one', () => {
    // Asserted against sentences that genuinely carry an apostrophe, so the rule
    // is exercised rather than merely satisfied: a `not.toContain("'")` over
    // strings with no apostrophe of either kind passes whatever the copy says.
    for (const sentence of [
      parentCopy.students.deleteBody('Noah', FULL),
      parentCopy.students.deleted('Noah'),
    ]) {
      expect(sentence).toContain('’');
      expect(sentence).not.toContain("'");
    }
  });

  it('needs no apostrophe of its own, because it addresses the parent directly', () => {
    // "Your account", never "this account’s" — so there is no possessive to
    // punctuate, and a stray ASCII apostrophe would be a sentence somebody wrote
    // in a different voice.
    for (const sentence of [
      parentCopy.settings.deleteAccountBody(FULL),
      parentCopy.settings.deleteAccountBody(EMPTY),
      parentCopy.settings.deleteAccountNote,
      parentCopy.settings.deleteAccountFailed,
      parentCopy.settings.loading,
      parentCopy.settings.preparing,
    ]) {
      expect(sentence).not.toContain("'");
      expect(sentence).not.toContain('’');
    }
  });

  it('says nothing about the month’s allowance, unlike the per-child body', () => {
    // The per-child sentence promises the month is not given back, because the
    // account survives to be charged. Here there is no account left for an
    // allowance to be about, and mentioning one would imply something survives.
    expect(parentCopy.students.deleteBody('Noah', FULL)).toMatch(/allowance/i);
    expect(parentCopy.settings.deleteAccountBody(FULL)).not.toMatch(/allowance/i);
  });
});
