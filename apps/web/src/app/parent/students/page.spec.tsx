import { describe, expect, it, vi } from 'vitest';
import { parentCopy } from '@/copy/parent';
import { NETWORK_STATUS, ParentApiError } from '@/lib/parent-api';
import {
  announcedText,
  applyIfCurrent,
  canCreateStudent,
  createRefusal,
  endsParentView,
  refusalText,
} from './page';

describe('the Students screen’s create rule', () => {
  it('refuses a create with no grade level, before anything leaves the browser', () => {
    expect(canCreateStudent('Noah', '')).toBe(false);
  });

  it('refuses a create with no name, and one that is only whitespace', () => {
    expect(canCreateStudent('', 'grade-1')).toBe(false);
    expect(canCreateStudent('   ', 'grade-1')).toBe(false);
  });

  it('allows a create only when both a name and a grade level are set', () => {
    expect(canCreateStudent('Noah', 'grade-1')).toBe(true);
  });
});

describe('the Students screen’s staleness guard', () => {
  it('applies a response that is still the most recent request', () => {
    const apply = vi.fn();
    applyIfCurrent({ value: 3 }, 3, apply)('profiles');
    expect(apply).toHaveBeenCalledWith('profiles');
  });

  it('is a no-op for a response a later request has superseded', () => {
    const current = { value: 3 };
    const apply = vi.fn();
    const land = applyIfCurrent<string>(current, 3, apply);
    // A newer request was issued while this one was still in flight.
    current.value = 4;
    land('stale profiles');
    expect(apply).not.toHaveBeenCalled();
  });
});

describe('what ends Parent View', () => {
  it('ends it when the elevation guard is the refuser', () => {
    expect(endsParentView(new ParentApiError('gone', 401, null, true))).toBe(true);
    // A bare 401 on a parent-scoped route is the same refusal, flag or not.
    expect(endsParentView(new ParentApiError('gone', 401))).toBe(true);
  });

  it('keeps the parent in place for a transient fault they could retry', () => {
    // A 400 is what the unauthenticated policy read would answer with, and a
    // 500 or a 429 is the server having a bad moment — none is a reason to
    // throw away a token that is still good.
    for (const status of [400, 404, 429, 500, 503, NETWORK_STATUS]) {
      expect(endsParentView(new ParentApiError('nope', status))).toBe(false);
    }
    expect(endsParentView(new Error('boom'))).toBe(false);
    expect(endsParentView('boom')).toBe(false);
  });
});

describe('the live region', () => {
  it('holds nothing before anything has happened', () => {
    expect(announcedText({ text: '', seq: 0 })).toBe('');
  });

  it('makes a repeat of the same sentence a change, so it announces again', () => {
    const said = parentCopy.students.archived('Noa');
    const first = announcedText({ text: said, seq: 1 });
    const again = announcedText({ text: said, seq: 3 });
    const between = announcedText({ text: said, seq: 2 });
    expect(first).not.toBe(between);
    expect(between).not.toBe(again);
    // And the sentence a reader sees is unchanged either way.
    for (const rendered of [first, between, again]) {
      expect(rendered.replace(/​/gu, '')).toBe(said);
    }
  });
});

describe('the archive copy', () => {
  it('names what archiving does, and does not read as a delete', () => {
    expect(parentCopy.students.archiveConfirmTitle('Noah')).toBe('Archive Noah?');
    const confirmation = parentCopy.students.archiveConfirmBody('Noah');
    expect(confirmation).toContain('Noah');
    expect(confirmation).toMatch(/Student Mode/);
    expect(confirmation).toMatch(/history is kept/i);
    expect(confirmation).toMatch(/Nothing is deleted/i);
    // The control itself is labelled Archive, never Delete or Remove.
    expect(parentCopy.students.archive).toBe('Archive');
    expect(parentCopy.students.archive).not.toMatch(/delete|remove/i);
  });

  it('offers a restore, so an archive is recoverable', () => {
    expect(parentCopy.students.restore).toBe('Restore');
    expect(parentCopy.students.restored('Noah')).toContain('Noah');
  });

  it('states no figure of its own: the name bound arrives as a parameter', () => {
    expect(parentCopy.students.nameMaximum(60)).toContain('60');
    expect(parentCopy.students.nameMaximum(24)).toContain('24');
  });
});

describe('the delete copy', () => {
  const FULL = {
    sourceTests: 2,
    pageImages: 5,
    practiceTests: 3,
    attempts: 1,
    explanations: 4,
    masteryTopics: 6,
  };

  it('names the child and every count and kind that will be destroyed', () => {
    const body = parentCopy.students.deleteBody('Noah', FULL);
    expect(body).toContain('Noah');
    expect(body).toContain('2 uploaded tests');
    expect(body).toContain('5 photographs');
    expect(body).toContain('3 practice tests');
    // Singular, because a sentence that says "1 finished runs" reads as a bug.
    expect(body).toContain('1 finished run');
    expect(body).not.toContain('1 finished runs');
    expect(body).toContain('4 explanations');
    expect(body).toContain('6 topics with progress saved');
  });

  it('states that it cannot be undone and that the allowance does not come back', () => {
    const body = parentCopy.students.deleteBody('Noah', FULL);
    expect(body).toMatch(/cannot be undone/i);
    // A parent deleting to free up uploads must not learn this afterwards.
    expect(body).toMatch(/not given back/i);
  });

  it('leaves out the kinds that hold nothing rather than saying "0"', () => {
    const body = parentCopy.students.deleteBody('Noah', { ...FULL, attempts: 0, explanations: 0 });
    // Asserted on the absent kind names, not on the substring "0 ", which any
    // count ending in a zero would also contain — "10 photographs" is a real
    // sentence and not a bug.
    expect(body).not.toContain('finished run');
    expect(body).not.toContain('explanation');
    expect(body).toContain('5 photographs');
  });

  it('states a count ending in zero without mistaking it for an absent kind', () => {
    const body = parentCopy.students.deleteBody('Noah', {
      ...FULL,
      pageImages: 10,
      explanations: 20,
    });
    expect(body).toContain('10 photographs');
    expect(body).toContain('20 explanations');
  });

  it('still says the profile goes for a child with nothing saved under them', () => {
    const body = parentCopy.students.deleteBody('Noah', {
      sourceTests: 0,
      pageImages: 0,
      practiceTests: 0,
      attempts: 0,
      explanations: 0,
      masteryTopics: 0,
    });
    expect(body).toContain('Noah');
    expect(body).toMatch(/cannot be undone/i);
  });

  it('reads as a different action from archiving, and says which keeps history', () => {
    // The two items sit in the same menu, so the distinction has to be in the
    // words. It lives in the two confirmations now that the per-row notes are
    // gone with the notes row: the archive's says what is kept, the delete's
    // says what is destroyed and that it cannot be undone.
    expect(parentCopy.students.delete).toBe('Delete');
    expect(parentCopy.students.archive).toBe('Archive');

    const archiving = parentCopy.students.archiveConfirmBody('Noah');
    expect(archiving).toMatch(/history is kept/i);
    expect(archiving).toMatch(/Nothing is deleted/i);
    expect(archiving).not.toMatch(/cannot be undone/i);

    const deleting = parentCopy.students.deleteBody('Noah', FULL);
    expect(deleting).toMatch(/will be removed/i);
    expect(deleting).toMatch(/cannot be undone/i);
    expect(deleting).not.toMatch(/history is kept/i);
    expect(deleting).not.toMatch(/Nothing is deleted/i);
  });

  it('announces the deletion without claiming something was saved under the child', () => {
    const said = parentCopy.students.deleted('Noah');
    expect(said).toContain('Noah');
    expect(said).toMatch(/cannot be undone/i);
    // The body's own short form says nothing is saved under this child, so the
    // announcement must not turn round and say everything under them went.
    expect(said).not.toMatch(/everything saved under/i);
    expect(parentCopy.students.deleteFailed).toMatch(/Nothing was removed/i);
  });

  it('uses the typographic apostrophe the rest of the parent copy uses', () => {
    // A sentence mixing ' and ’ is visibly two people's copy.
    for (const sentence of [
      parentCopy.students.deleteBody('Noah', FULL),
      parentCopy.students.deleteBody('Noah', { ...FULL, sourceTests: 0, pageImages: 0 }),
      parentCopy.students.deleted('Noah'),
    ]) {
      expect(sentence).not.toContain("'");
    }
  });
});

describe('what a refused delete puts on the screen', () => {
  it('shows the API’s own sentence when it authored one', () => {
    const refused = new ParentApiError(
      'generic',
      409,
      null,
      false,
      false,
      'That is not the password.',
    );
    expect(refusalText(refused, parentCopy.students.deleteFailed)).toBe(
      'That is not the password.',
    );
  });

  it('falls back to the error’s own message, then to the screen’s', () => {
    expect(refusalText(new ParentApiError('boom', 503), 'fallback')).toBe('boom');
    expect(refusalText('boom', 'fallback')).toBe('fallback');
  });

  it('leaves the parent in Parent View: a wrong password is not an expired session', () => {
    // A 401 would clear elevation and route to the PIN prompt, hiding the very
    // refusal the parent needs to read.
    const refused = new ParentApiError('generic', 409, null, false, false, 'Wrong password.');
    expect(endsParentView(refused)).toBe(false);
  });
});

describe('what a refused create puts on the screen', () => {
  /**
   * The server's sentence, kept deliberately opaque.
   *
   * What is under test is that the API's own words win, not what those words
   * say — and the words themselves name an Account Tier and a profile limit,
   * neither of which this app may restate. A fixture spelling them out would
   * both break that rule and compare the expectation against itself.
   */
  const SERVER_SAID = 'A sentence only the API authored.';
  const atLimit = new ParentApiError('generic', 409, null, false, false, SERVER_SAID);

  it('shows the API’s own sentence rather than the screen’s generic one', () => {
    expect(createRefusal(atLimit)).toBe(SERVER_SAID);
    expect(createRefusal(atLimit)).not.toBe(parentCopy.students.failed);
  });

  it('falls back to the error’s own message when the API authored no sentence', () => {
    expect(createRefusal(new ParentApiError('boom', 503))).toBe('boom');
  });

  it('falls back to the screen’s sentence for a throw that is not an Error', () => {
    expect(createRefusal('boom')).toBe(parentCopy.students.failed);
  });

  it('leaves the parent in Parent View: a refused create is not an expired session', () => {
    expect(endsParentView(atLimit)).toBe(false);
  });

  it('states no tier and no profile figure of its own', () => {
    // The limit and the tier originate in the API, exactly as the allowance
    // refusals do. This app must not carry a second copy of either.
    const ours = JSON.stringify(parentCopy.students);
    for (const tier of ['Free', 'Plus', 'Family', 'Internal']) {
      expect(ours).not.toContain(tier);
    }
    expect(ours).not.toMatch(/\d+\s+(active\s+)?Student Profile/iu);
  });
});

describe('the ⋮ trigger on a student row', () => {
  it('names the child whose row it opens, not merely "more actions"', () => {
    // An icon-only control named "More actions" is one of five identical
    // controls to anybody not reading the screen with their eyes.
    expect(parentCopy.students.rowActionsLabel('Noah')).toContain('Noah');
    expect(parentCopy.students.rowActionsLabel('Noah')).not.toContain('!');
  });
});
