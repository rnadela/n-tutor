import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { UNCOMMITTED_STATE_TTL_MS } from '../identity/uncommitted-state-policy.js';
import {
  ALLOWED_MIMES,
  MAX_PAGES,
  PageOrderMismatch,
  SOURCE_TEST_TTL_MS,
  STORED_EXTENSION,
  canAddPage,
  canSubmit,
  expiryFrom,
  isAllowedMime,
  isExpired,
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
