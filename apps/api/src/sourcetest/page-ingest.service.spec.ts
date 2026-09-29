import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Logger } from '@nestjs/common';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageIngestService, UnsupportedImageFormat } from './page-ingest.service.js';
import {
  MAX_DECODED_PIXELS,
  STORED_MIME,
  resetSourceTestRuntime,
  storagePathFor,
} from './source-test-policy.js';

/**
 * `normalize` on its own: the one method where the format of what arrived is
 * decided and where it stops being that format.
 *
 * No database, no filesystem and no HTTP layer — the rest of the service is
 * covered by the integration spec. What is asserted here is the ingest contract
 * the matrix states: HEIC is *converted* rather than refused, EXIF orientation
 * is honoured, the dimensions come off the output, and everything undecodable
 * raises exactly one rejection whose message is the rule it was handed.
 *
 * The route-level half of the contract — that the *declared* content type is
 * never read — lives in `test/source-test.int-spec.ts`, because `normalize`
 * takes a buffer and has no declared type to ignore.
 */

/**
 * The real decoder, kept aside before the module is mocked.
 *
 * `heic-decode` is mocked for one test only — the one that has to state a
 * non-square decoded image, which the committed fixture cannot. Every other test
 * runs the genuine libheif path through this delegate, so "HEIC converts" stays
 * a fact about the decoder rather than about a stub.
 */
const { decodeMock } = vi.hoisted(() => ({ decodeMock: vi.fn() }));
vi.mock('heic-decode', () => ({ default: decodeMock }));
const realDecode = (await vi.importActual<typeof import('heic-decode')>('heic-decode')).default;

beforeEach(() => {
  decodeMock.mockReset();
  decodeMock.mockImplementation(realDecode);
});

const FIXTURES = path.resolve(import.meta.dirname, '../../test/fixtures');

/**
 * A real 64×64 HEIC photograph.
 *
 * Provenance: recovered from the preserved attempt ref
 * `refs/attempt-preserve-dirty/20260923-210321-45b5-b38a8047-2`, where it had
 * already been verified to decode through libheif. Regenerate with any HEIC
 * encoder at the same dimensions, or take one from a phone and crop it — the
 * tests below couple to its 64×64 size, so a replacement of another size has to
 * update the two dimension assertions with it.
 *
 * Being square, it cannot by itself prove the raw descriptor is the right way
 * round; `the decoded image reaches sharp the right way round` is the test that
 * does, with a mocked non-square decode.
 */
const HEIC_FIXTURE = path.join(FIXTURES, 'sample-page.heic');
const HEIC_FIXTURE_SIZE = 64;

/** The rule string the caller owns. `normalize` must echo it and nothing else. */
const RULE = 'A page must be a JPEG, PNG, WebP or HEIC photograph.';

const ingest = new PageIngestService();

/**
 * A JPEG that is wider than it is tall and *declares* EXIF orientation 6 — the
 * quarter-turn an iPhone held upright writes. Synthesised rather than committed
 * as a fixture so the input dimensions are stated by the test that asserts the
 * output's.
 */
async function orientationSixJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 60, b: 40 } },
  })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
}

/** A plain raster in whichever listed format the sniff is being tested on. */
async function photo(
  format: 'png' | 'webp' | 'jpeg',
  width: number,
  height: number,
): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 30, g: 120, b: 200 } },
  })
    .toFormat(format)
    .toBuffer();
}

/** Raw RGBA of the given size, as `heic-decode` hands it back. */
function rgba(width: number, height: number): Uint8ClampedArray {
  return new Uint8ClampedArray(width * height * 4).fill(140);
}

describe('what ingest does to a HEIC photograph', () => {
  it('converts it to stored JPEG at the decoded dimensions', async () => {
    const heic = await readFile(HEIC_FIXTURE);
    // The premise of the whole branch: `sharp` alone cannot open this on the
    // platform the story was written for, so a passing test is not accidentally
    // exercising libvips. Conditional because that is a fact about the installed
    // libvips and not about this repo — where HEIF support *is* compiled in, the
    // branch is still the one taken, and asserting the refusal would fail a
    // build whose production behaviour is correct.
    if (sharp.format.heif?.input.buffer !== true) {
      await expect(sharp(heic).jpeg().toBuffer()).rejects.toThrow();
    }

    const normalized = await ingest.normalize(heic, RULE);

    expect(normalized.mimeType).toBe(STORED_MIME);
    const stored = await sharp(normalized.buffer).metadata();
    expect(stored.format).toBe('jpeg');
    // The dimensions on the row are the output's, and the output is the decoded
    // image: nothing about the branch crops or scales.
    expect(normalized.width).toBe(stored.width);
    expect(normalized.height).toBe(stored.height);
    expect(normalized.width).toBe(HEIC_FIXTURE_SIZE);
    expect(normalized.height).toBe(HEIC_FIXTURE_SIZE);
    expect(normalized.byteSize).toBe(normalized.buffer.length);
    // The genuine decoder ran: this is not a stub answering for libheif.
    expect(decodeMock).toHaveBeenCalledTimes(1);
  });

  it('hands the decoded image to sharp the right way round', async () => {
    // The committed fixture is square, so a transposed `raw: { width, height }`
    // descriptor would still match the buffer length and still satisfy every
    // assertion above — while writing every real (never square) phone HEIC out
    // transposed. Real HEIC bytes still go in, so the sniff is genuine; only the
    // decode is stated, and it is deliberately not square.
    const heic = await readFile(HEIC_FIXTURE);
    const width = 96;
    const height = 32;
    decodeMock.mockResolvedValueOnce({ width, height, data: rgba(width, height) });

    const normalized = await ingest.normalize(heic, RULE);

    expect(normalized.width).toBe(width);
    expect(normalized.height).toBe(height);
    const stored = await sharp(normalized.buffer).metadata();
    expect(stored.width).toBe(width);
    expect(stored.height).toBe(height);
  });

  it('refuses a decoded raster over the pixel ceiling', async () => {
    // The byte cap cannot bound this: HEIC is far denser than the raster it
    // decodes to, so bytes well inside `MAX_PAGE_BYTES` can decode to any size.
    // The raw pipeline bypasses sharp's own `limitInputPixels`, so this ceiling
    // is the only thing in front of the allocation.
    const heic = await readFile(HEIC_FIXTURE);
    // Stated off the constant, so the test moves with the policy rather than
    // pinning a second copy of the figure. `data` is never read — the ceiling is
    // checked before sharp is handed anything.
    decodeMock.mockResolvedValueOnce({
      width: MAX_DECODED_PIXELS + 1,
      height: 1,
      data: new Uint8ClampedArray(4),
    });

    await expect(ingest.normalize(heic, RULE)).rejects.toThrow(new UnsupportedImageFormat(RULE));
  });

  it('does not treat exactly the pixel ceiling as exceeding it', async () => {
    // `width * height > MAX_DECODED_PIXELS` is the check, so a decode that lands
    // exactly on the ceiling must fall through the ceiling branch rather than
    // being rejected by it — an off-by-one here (`>=`) would refuse a real
    // maximum-size phone photo. The descriptor is deliberately too small for the
    // 4-byte stub `data`, so the decode still fails and rejects, but it fails
    // *past* the ceiling check, in sharp's own raw-buffer validation — proven by
    // the logged failure class not being the ceiling's.
    const heic = await readFile(HEIC_FIXTURE);
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    decodeMock.mockResolvedValueOnce({
      width: MAX_DECODED_PIXELS,
      height: 1,
      data: new Uint8ClampedArray(4),
    });

    await expect(ingest.normalize(heic, RULE)).rejects.toThrow(new UnsupportedImageFormat(RULE));

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [message] = warnSpy.mock.calls[0] as [string];
    expect(message).not.toContain('DecodedPixelCeilingExceeded');
    warnSpy.mockRestore();
  });
});

describe('what ingest does to EXIF orientation', () => {
  it('stores a quarter-turned photograph upright, with the dimensions swapped', async () => {
    const jpeg = await orientationSixJpeg(80, 40);

    const normalized = await ingest.normalize(jpeg, RULE);

    // Orientation 6 means the stored pixels must come back rotated, so the
    // landscape input is a portrait output — and the row states the size the
    // page is stored at rather than the size it was taken at.
    expect(normalized.width).toBe(40);
    expect(normalized.height).toBe(80);
    const stored = await sharp(normalized.buffer).metadata();
    expect(stored.width).toBe(40);
    expect(stored.height).toBe(80);
    // The rotation is baked into the pixels, not deferred to another reader's
    // orientation handling.
    expect(stored.orientation ?? 1).toBe(1);
  });
});

describe('the formats the sniff admits', () => {
  it('converts a PNG to stored JPEG at its own dimensions', async () => {
    const normalized = await ingest.normalize(await photo('png', 50, 70), RULE);

    expect(normalized.mimeType).toBe(STORED_MIME);
    expect(normalized.width).toBe(50);
    expect(normalized.height).toBe(70);
    // Re-encoded, not passed through: the stored bytes are a JPEG whatever
    // arrived.
    expect((await sharp(normalized.buffer).metadata()).format).toBe('jpeg');
  });

  it('converts a WebP to stored JPEG at its own dimensions', async () => {
    const normalized = await ingest.normalize(await photo('webp', 70, 50), RULE);

    expect(normalized.mimeType).toBe(STORED_MIME);
    expect(normalized.width).toBe(70);
    expect(normalized.height).toBe(50);
    expect((await sharp(normalized.buffer).metadata()).format).toBe('jpeg');
  });

  it('leaves no trace of what arrived on what is stored', async () => {
    // Every listed format converges on one stored format, which is what lets the
    // rest of the system stop caring which control or which phone produced a
    // page.
    for (const format of ['png', 'webp', 'jpeg'] as const) {
      const normalized = await ingest.normalize(await photo(format, 40, 40), RULE);
      expect(normalized.mimeType).toBe(STORED_MIME);
    }
  });
});

describe('what ingest refuses', () => {
  it('refuses an empty buffer', async () => {
    await expect(ingest.normalize(Buffer.alloc(0), RULE)).rejects.toThrow(UnsupportedImageFormat);
  });

  it('refuses PDF bytes, whatever the client called them', async () => {
    // The declared content type is never read, so the only thing that can
    // decide this is the signature.
    const pdf = Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n1 0 obj\n<<>>\nendobj\n', 'binary');
    await expect(ingest.normalize(pdf, RULE)).rejects.toThrow(UnsupportedImageFormat);
  });

  it('refuses a GIF, which is an image but not a listed one', async () => {
    // The allow-list is the rule, not "is this an image at all": a format the
    // vision model is not promised is refused as plainly as a PDF.
    const gif = Buffer.from('R0lGODdhAQABAIAAAAAAAAAAACwAAAAAAQABAAACAkQBADs=', 'base64');
    await expect(ingest.normalize(gif, RULE)).rejects.toThrow(UnsupportedImageFormat);
  });

  it('refuses a HEIC that sniffs as one but cannot be decoded', async () => {
    const heic = await readFile(HEIC_FIXTURE);
    // Enough of the container to be sniffed, not enough to be decoded — the
    // case that proves the branch's own failure is answered like any other.
    const truncated = heic.subarray(0, 256);
    await expect(ingest.normalize(truncated, RULE)).rejects.toThrow(UnsupportedImageFormat);
  });

  it('states the rule it was handed and nothing else', async () => {
    // No filename, no declared type, no byte count (AD-20) — the message is
    // the caller's string verbatim.
    await expect(ingest.normalize(Buffer.from('not an image at all'), RULE)).rejects.toThrow(
      new UnsupportedImageFormat(RULE),
    );
    const raised = await ingest.normalize(Buffer.alloc(0), RULE).catch((cause: unknown) => cause);
    expect(raised).toBeInstanceOf(UnsupportedImageFormat);
    expect((raised as Error).message).toBe(RULE);
  });

  it('logs only the failure class on a decode fault, and nothing about the buffer (AD-20)', async () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const heic = await readFile(HEIC_FIXTURE);
    // Enough of the container to be sniffed, not enough to be decoded — the same
    // fixture the refusal test above uses, so the fault is a real libheif one.
    const truncated = heic.subarray(0, 256);

    await expect(ingest.normalize(truncated, RULE)).rejects.toThrow(UnsupportedImageFormat);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [message] = warnSpy.mock.calls[0] as [string];
    // The rule string, the filename and the byte count never appear — only the
    // class of what was thrown.
    expect(message).not.toContain(RULE);
    expect(message).not.toContain('sample-page');
    expect(message).toMatch(/^Page ingest could not decode an allowed format: \S+\.$/);
    warnSpy.mockRestore();
  });
});

describe('what `remove` reports about the bytes', () => {
  /**
   * `remove()` is the only thing standing between a page whose bytes survived
   * and a row that claims they are gone: the retention sweep marks a row
   * `Deleted` on a `true` and leaves it `Ready` on a `false`. A `false` that
   * became a `true` would write the tombstone over a photograph that is still
   * on disk, and no clock would ever come back for it — so the answer is
   * asserted here, from the real method, rather than only from the sweep's own
   * stub.
   */
  const PAGE = '55555555-5555-4555-8555-555555555555';
  const root = path.join(tmpdir(), `nts-remove-spec-${randomUUID()}`);
  const stored = storagePathFor(PAGE, root);

  beforeEach(() => {
    vi.stubEnv('UPLOAD_ROOT', root);
    resetSourceTestRuntime();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    resetSourceTestRuntime();
    await rm(root, { recursive: true, force: true });
  });

  it('answers true when it unlinked the file, and the file is gone', async () => {
    await mkdir(path.dirname(stored), { recursive: true });
    await writeFile(stored, Buffer.from([1, 2, 3]));

    expect(await ingest.remove(PAGE)).toBe(true);
    await expect(readFile(stored)).rejects.toThrow();
  });

  it('answers true when the file was already absent', async () => {
    // "Already gone" and "just removed" are the same outcome for every caller,
    // and this is what lets the sweep converge on a row whose bytes a crashed
    // earlier pass had already unlinked.
    expect(await ingest.remove(PAGE)).toBe(true);
  });

  it('answers false when the bytes could not be removed', async () => {
    // A non-ENOENT fault: the path is a directory with something in it, so
    // `unlink` refuses with EPERM or EISDIR depending on the platform — either
    // way it is not ENOENT and the bytes are still there.
    await mkdir(stored, { recursive: true });
    await writeFile(path.join(stored, 'occupant'), Buffer.from([0]));
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    expect(await ingest.remove(PAGE)).toBe(false);

    // Warned by page id alone, never by path (AD-15, AD-20).
    const [message] = warnSpy.mock.calls[0] as [string];
    expect(message).toContain(PAGE);
    expect(message).not.toContain(root);
    warnSpy.mockRestore();
  });
});
