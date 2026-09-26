import { describe, expect, it } from 'vitest';
import { ACCEPTED_IMAGE_TYPES, splitSelection } from './library-selection';

/**
 * A stand-in for a picked photo. Only the name is read by these assertions —
 * what matters is which files come back and in what order.
 */
function photo(name: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' });
}

function names(files: readonly File[]): string[] {
  return files.map((file) => file.name);
}

describe('splitting a library selection against the slots that are left', () => {
  it('accepts the whole selection, in selection order, when it fits', () => {
    const chosen = [photo('a.jpg'), photo('b.jpg'), photo('c.jpg')];

    const split = splitSelection(chosen, 0, 10);

    expect(names(split.accepted)).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
    expect(split.rejectedCount).toBe(0);
  });

  it('trims the selection at the remaining slots and counts the rest', () => {
    // The matrix's over-cap row: nine pages held, one slot left, three chosen.
    const chosen = [photo('a.jpg'), photo('b.jpg'), photo('c.jpg')];

    const split = splitSelection(chosen, 9, 10);

    expect(names(split.accepted)).toEqual(['a.jpg']);
    expect(split.rejectedCount).toBe(2);
  });

  it('keeps the order of the trimmed head rather than any other subset', () => {
    const chosen = [photo('first.jpg'), photo('second.jpg'), photo('third.jpg')];

    const split = splitSelection(chosen, 8, 10);

    expect(names(split.accepted)).toEqual(['first.jpg', 'second.jpg']);
    expect(split.rejectedCount).toBe(1);
  });

  it('yields nothing from an empty selection, and rejects nothing either', () => {
    const split = splitSelection([], 2, 10);

    expect(split.accepted).toEqual([]);
    expect(split.rejectedCount).toBe(0);
  });

  it('accepts nothing at all once the upload is full', () => {
    const chosen = [photo('a.jpg'), photo('b.jpg')];

    const split = splitSelection(chosen, 10, 10);

    expect(split.accepted).toEqual([]);
    expect(split.rejectedCount).toBe(2);
    // And no request can be sent for a trimmed file, because none is returned.
    expect(split.accepted).toHaveLength(0);
  });

  it('accepts nothing when the count has somehow passed the ceiling', () => {
    const split = splitSelection([photo('a.jpg')], 11, 10);

    expect(split.accepted).toEqual([]);
    expect(split.rejectedCount).toBe(1);
  });

  it('reads the ceiling it is handed rather than a figure of its own', () => {
    // The same selection, two different ceilings: the cap is the API's.
    const chosen = [photo('a.jpg'), photo('b.jpg'), photo('c.jpg')];

    expect(splitSelection(chosen, 0, 2).accepted).toHaveLength(2);
    expect(splitSelection(chosen, 0, 3).accepted).toHaveLength(3);
  });
});

describe('what the library picker is told to offer', () => {
  it('names every format ingest accepts, HEIC included', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']) {
      expect(ACCEPTED_IMAGE_TYPES).toContain(type);
    }
    // The extensions too: iOS pickers report no useful type for some HEICs.
    expect(ACCEPTED_IMAGE_TYPES).toContain('.heic');
  });

  it('does not fall back to a wildcard the server would then refuse', () => {
    expect(ACCEPTED_IMAGE_TYPES).not.toContain('image/*');
  });
});
