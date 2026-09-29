import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { UNCOMMITTED_STATE_TTL_MS } from '../identity/uncommitted-state-policy.js';
import {
  ALLOWED_MIMES,
  MAX_PAGES,
  PAGE_EXPIRY_SWEEP_BATCH_SIZE,
  PAGE_IMAGE_RETENTION_MS,
  PageOrderMismatch,
  SOURCE_TEST_TTL_MS,
  STORED_EXTENSION,
  canAddPage,
  canSubmit,
  expiryFrom,
  isAllowedMime,
  isChecked,
  isClassified,
  isExpired,
  isPageImageExpired,
  isPageReadable,
  pageImageExpiryCutoff,
  pageImageExpiryFrom,
  renumbered,
  reorderedOrThrow,
  storagePathFor,
} from './source-test-policy.js';

const ROOT = '/tmp/source-test-policy-spec';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const FOREIGN = '44444444-4444-4444-8444-444444444444';

describe('the page ceiling', () => {
  it('admits pages up to the stated maximum and refuses the one after it', () => {
    expect(canAddPage(0)).toBe(true);
    expect(canAddPage(MAX_PAGES - 1)).toBe(true);
    expect(canAddPage(MAX_PAGES)).toBe(false);
  });
});

describe('the submission gate', () => {
  it('refuses zero pages and admits one', () => {
    expect(canSubmit(0)).toBe(false);
    expect(canSubmit(1)).toBe(true);
    expect(canSubmit(MAX_PAGES)).toBe(true);
  });
});

describe('ordinals', () => {
  it('numbers a list contiguously from one, in the order given', () => {
    expect(renumbered([C, A, B])).toEqual([
      { id: C, ordinal: 1 },
      { id: A, ordinal: 2 },
      { id: B, ordinal: 3 },
    ]);
  });

  it('numbers an empty list as nothing at all', () => {
    expect(renumbered([])).toEqual([]);
  });
});

describe('reorder is an explicit permutation', () => {
  it('accepts a permutation and returns it in the order asked for', () => {
    expect(reorderedOrThrow([A, B, C], [C, A, B])).toEqual([C, A, B]);
  });

  it('accepts the identity order', () => {
    expect(reorderedOrThrow([A, B, C], [A, B, C])).toEqual([A, B, C]);
  });

  it('rejects an order that omits a page', () => {
    expect(() => reorderedOrThrow([A, B, C], [A, B])).toThrow(PageOrderMismatch);
  });

  it('rejects an order that repeats a page in place of another', () => {
    expect(() => reorderedOrThrow([A, B, C], [A, A, C])).toThrow(PageOrderMismatch);
  });

  it('rejects an order naming a page that is not on this Source Test', () => {
    expect(() => reorderedOrThrow([A, B, C], [A, B, FOREIGN])).toThrow(PageOrderMismatch);
  });

  it('rejects an order carrying an extra page', () => {
    expect(() => reorderedOrThrow([A, B], [A, B, C])).toThrow(PageOrderMismatch);
  });

  it('does not mutate the stored order it was handed', () => {
    const stored = [A, B, C];
    reorderedOrThrow(stored, [C, B, A]);
    expect(stored).toEqual([A, B, C]);
  });
});

describe('the allowed formats', () => {
  it('admits exactly the set AD-28 names, by what the bytes are', () => {
    for (const mime of ALLOWED_MIMES) expect(isAllowedMime(mime)).toBe(true);
    expect(isAllowedMime('text/plain')).toBe(false);
    expect(isAllowedMime('application/pdf')).toBe(false);
    expect(isAllowedMime('image/gif')).toBe(false);
    expect(isAllowedMime(undefined)).toBe(false);
  });
});

describe('the storage path', () => {
  it('derives from the row id alone, under the root', () => {
    const derived = storagePathFor(A, ROOT);
    expect(derived).toBe(path.join(ROOT, '11', '11', `${A}${STORED_EXTENSION}`));
    expect(derived.startsWith(ROOT + path.sep)).toBe(true);
  });

  it('is stable: the same id derives the same path every time', () => {
    expect(storagePathFor(B, ROOT)).toBe(storagePathFor(B, ROOT));
  });

  it('refuses anything that is not a row id, so no path can be steered', () => {
    expect(() => storagePathFor('../../etc/passwd', ROOT)).toThrow();
    expect(() => storagePathFor('', ROOT)).toThrow();
    expect(() => storagePathFor(`${A}/../..`, ROOT)).toThrow();
  });
});

describe('the one TTL', () => {
  it('is the uncommitted-state TTL itself, not a second figure', () => {
    expect(SOURCE_TEST_TTL_MS).toBe(UNCOMMITTED_STATE_TTL_MS);
  });

  it('expires from creation, and is exclusive at the boundary', () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const expiresAt = expiryFrom(createdAt, SOURCE_TEST_TTL_MS);
    expect(expiresAt.getTime()).toBe(createdAt.getTime() + SOURCE_TEST_TTL_MS);
    expect(isExpired({ expiresAt }, new Date(expiresAt.getTime() - 1))).toBe(false);
    expect(isExpired({ expiresAt }, expiresAt)).toBe(true);
    expect(isExpired({ expiresAt }, new Date(expiresAt.getTime() + 1))).toBe(true);
  });
});

describe('the classification gate', () => {
  const SUBJECT = '55555555-5555-4555-8555-555555555555';
  const GRADE_LEVEL = '66666666-6666-4666-8666-666666666666';

  it('holds only when both references are stored', () => {
    expect(isClassified({ subjectId: SUBJECT, gradeLevelId: GRADE_LEVEL })).toBe(true);
    expect(isClassified({ subjectId: SUBJECT, gradeLevelId: null })).toBe(false);
    expect(isClassified({ subjectId: null, gradeLevelId: GRADE_LEVEL })).toBe(false);
    expect(isClassified({ subjectId: null, gradeLevelId: null })).toBe(false);
  });

  it('reads nothing but the two references, so a later disable cannot move it', () => {
    // The rule takes no enablement flag at all — that is what makes "a stored
    // reference keeps submitting" a property of the signature rather than a
    // promise about the caller.
    const disabledLater = { subjectId: SUBJECT, gradeLevelId: GRADE_LEVEL, enabled: false };
    expect(isClassified(disabledLater)).toBe(true);
  });
});

describe('the legibility rules', () => {
  it('flags Low and nothing else', () => {
    // The threshold between "readable" and "blurry" is stated exactly here,
    // and the two passing verdicts are asserted rather than assumed: a rule
    // that only ever tested Low would still pass if Medium started failing.
    expect(isPageReadable('Low')).toBe(false);
    expect(isPageReadable('Medium')).toBe(true);
    expect(isPageReadable('High')).toBe(true);
  });

  it('reads an unchecked page as readable, not as flagged', () => {
    // A page nobody has looked at is not a page somebody found wanting. The
    // gate that cares whether the check ran is `isChecked`, and conflating the
    // two would make a fresh draft look full of blurry pages.
    expect(isPageReadable(null)).toBe(true);
  });

  it('gates the submit on the check having run, and on nothing it said', () => {
    expect(isChecked({ legibilityCheckedAt: new Date('2026-09-27T10:00:00.000Z') })).toBe(true);
    expect(isChecked({ legibilityCheckedAt: null })).toBe(false);
  });
});

describe('the 90-day Page Image retention clock (FR-32)', () => {
  const SUBMITTED = new Date('2026-01-01T00:00:00.000Z');

  it('states ninety days once, and states them as days', () => {
    // The figure is asserted against its own arithmetic rather than against a
    // second literal: a spec that restates the number cannot catch the number
    // changing. What it does catch is the unit slipping — hours for days, or
    // the 72h draft TTL being re-used here, which is exactly the confusion the
    // two clocks invite.
    expect(PAGE_IMAGE_RETENTION_MS).toBe(90 * 24 * 60 * 60 * 1000);
    expect(PAGE_IMAGE_RETENTION_MS).not.toBe(SOURCE_TEST_TTL_MS);
  });

  it('anchors the expiry on submission, not on creation', () => {
    expect(pageImageExpiryFrom(SUBMITTED).toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });

  it('is inclusive at the boundary and untouched the millisecond before it', () => {
    const due = pageImageExpiryFrom(SUBMITTED);
    expect(isPageImageExpired(SUBMITTED, new Date(due.getTime() - 1))).toBe(false);
    expect(isPageImageExpired(SUBMITTED, due)).toBe(true);
    expect(isPageImageExpired(SUBMITTED, new Date(due.getTime() + 1))).toBe(true);
  });

  it('leaves a page untouched at eighty-nine days', () => {
    const now = new Date(SUBMITTED.getTime() + 89 * 24 * 60 * 60 * 1000);
    expect(isPageImageExpired(SUBMITTED, now)).toBe(false);
  });

  it('never expires the pages of a Source Test that was never submitted', () => {
    // However old it is. A draft is owned by the 72h TTL (AD-16); putting it
    // under this clock as well would hand it a second, far longer life.
    const muchLater = new Date(SUBMITTED.getTime() + 200 * 24 * 60 * 60 * 1000);
    expect(isPageImageExpired(null, muchLater)).toBe(false);
  });

  it('derives the sweep cutoff as the mirror of the expiry', () => {
    // The sweep compares `submittedAt` against a cutoff rather than computing
    // an expiry per row, so the two have to agree exactly: a test submitted at
    // the cutoff is due, and the same instant read the other way round is too.
    const now = new Date('2026-06-01T00:00:00.000Z');
    const cutoff = pageImageExpiryCutoff(now);
    expect(cutoff.toISOString()).toBe('2026-03-03T00:00:00.000Z');
    expect(isPageImageExpired(cutoff, now)).toBe(true);
    expect(isPageImageExpired(new Date(cutoff.getTime() + 1), now)).toBe(false);
  });

  it('caps one sweep pass at a hundred rows', () => {
    expect(PAGE_EXPIRY_SWEEP_BATCH_SIZE).toBe(100);
  });
});
