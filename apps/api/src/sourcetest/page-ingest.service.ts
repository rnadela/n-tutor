import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { fileTypeFromBuffer } from 'file-type';
import decodeHeic from 'heic-decode';
import sharp, { type Sharp } from 'sharp';
import { PageBytesUnavailable } from './source-test-reader.js';
import {
  JPEG_QUALITY,
  MAX_DECODED_PIXELS,
  STORED_MIME,
  isAllowedMime,
  storagePathFor,
  uploadRoot,
} from './source-test-policy.js';

/**
 * The two members of the HEIF family an iPhone actually produces, and the one
 * pair `sharp` cannot open on this platform: the prebuilt libvips decodes only
 * AVIF out of that family. Stated here rather than in the policy because it is
 * a fact about *this* decoder, not a product rule about which formats a parent
 * may upload — the allow-list is the rule, and it lives in the policy.
 */
const HEIF_MIMES: readonly string[] = ['image/heic', 'image/heif'];

function isHeif(mime: string): boolean {
  return HEIF_MIMES.includes(mime);
}

/**
 * Raised, not thrown as a plain `Error`, so `classNameOf` can tell a decoded
 * image that was simply too big apart from a decoder that actually failed —
 * the two would otherwise both log as `Error` and look like the same incident.
 */
class DecodedPixelCeilingExceeded extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecodedPixelCeilingExceeded';
  }
}

/**
 * The sniffed bytes as a `sharp` pipeline ready to be encoded, with the one
 * branch that exists in this service: HEIC/HEIF goes through libheif first.
 *
 * `rotate()` is applied on the ordinary branch and deliberately **not** on the
 * HEIF one. `rotate()` with no argument means "honour the EXIF orientation",
 * and there is no EXIF on the HEIF branch to honour: libheif has already
 * applied the container's own `irot`/`imir` transforms while decoding, and raw
 * RGBA carries no metadata at all. Calling it there would be a second rotation
 * of an already-upright image.
 *
 * A HEIF decode that fails throws, and the caller's `catch` turns that into the
 * same `UnsupportedImageFormat` an undecodable JPEG gets — this function never
 * decides what a rejection says. An oversized one throws for the same reason and
 * lands in the same place.
 */
async function decodedPipeline(mime: string, buffer: Buffer): Promise<Sharp> {
  // `limitInputPixels` bounds every decoder sharp owns, so the ordinary branch
  // is already covered and needs no ceiling of its own here.
  if (!isHeif(mime)) return sharp(buffer).rotate();
  const { width, height, data } = await decodeHeic({ buffer });
  // Checked after libheif has allocated, because there is no earlier place to
  // check it: the container's dimensions are not known until it is decoded. What
  // this bounds is the *encode* that would follow — sharp never sees the raw
  // bytes, so `limitInputPixels` would not stop them.
  if (width * height > MAX_DECODED_PIXELS) {
    throw new DecodedPixelCeilingExceeded('Decoded HEIF image exceeds the page pixel ceiling.');
  }
  return sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), {
    raw: { width, height, channels: 4 },
  });
}

/**
 * What was thrown, named by its class and by nothing else.
 *
 * Deliberately not the message: a decoder's own text is outside this repo's
 * control and could carry anything, and AD-20 keeps the buffer, the filename and
 * the declared type out of every log line. A class name is a closed fact about
 * our own process, which is what an operator needs to tell a bad photo apart
 * from a broken decoder.
 */
function classNameOf(cause: unknown): string {
  if (cause instanceof Error) return cause.name;
  // A thrown non-Error — a wasm abort, a string, a rejected `undefined`. Its
  // type is all there is to say about it.
  return typeof cause;
}

/** What ingest produced: the bytes to store, and what they turned out to be. */
export interface NormalizedPage {
  buffer: Buffer;
  /** Always the stored format. What arrived is not recorded anywhere. */
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
}

/**
 * The one rejection ingest raises. A plain error rather than a Nest exception,
 * so nothing about this service depends on the HTTP layer; the controller layer
 * turns it into the 415 the matrix names.
 *
 * Its message states the rule and nothing else — no filename, no declared type,
 * no byte (AD-20).
 */
export class UnsupportedImageFormat extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedImageFormat';
  }
}

/**
 * Mandatory ingest (AD-28): sniff, honour EXIF orientation, re-encode to JPEG
 * q85, and only then let the row leave `Uploading`.
 *
 * Two rules hold every method together:
 *
 * - The format is decided by the bytes. `fileTypeFromBuffer` against
 *   `ALLOWED_MIMES` is the whole of the check; the client-declared
 *   `content-type` is never read, here or anywhere above this.
 * - The path is derived from the row id alone, by `storagePathFor`. Nothing
 *   that crossed the wire reaches the filesystem, which is the path-traversal
 *   control itself and not merely a sanitisation of one.
 *
 * Nothing here crops. `rotate()` with no argument applies the EXIF orientation
 * and nothing else, and the dimensions are read off the **output** metadata
 * rather than the input's, so a 90°-rotated photo reports the size it is stored
 * at rather than the size it was taken at. The one exception is the HEIF branch,
 * which arrives already upright and carries no EXIF at all — `decodedPipeline`
 * says why.
 */
@Injectable()
export class PageIngestService {
  private readonly logger = new Logger(PageIngestService.name);

  /**
   * Sniff → decode → JPEG q85. Completes before the caller promotes the row out
   * of `Uploading`, so no downstream consumer ever sees a format the vision
   * model cannot read.
   *
   * HEIC/HEIF is *converted* here rather than refused — an ordinary iPhone
   * photograph is HEIC, and refusing one would make the allow-list a lie.
   */
  async normalize(buffer: Buffer, unsupportedMessage: string): Promise<NormalizedPage> {
    if (buffer.length === 0) throw new UnsupportedImageFormat(unsupportedMessage);

    const sniffed = await fileTypeFromBuffer(buffer);
    if (!isAllowedMime(sniffed?.mime)) throw new UnsupportedImageFormat(unsupportedMessage);

    let output: { data: Buffer; info: { width: number; height: number; size: number } };
    try {
      const pipeline = await decodedPipeline(sniffed!.mime, buffer);
      output = await pipeline.jpeg({ quality: JPEG_QUALITY }).toBuffer({
        resolveWithObject: true,
      });
    } catch (cause) {
      // A format the allow-list admits but neither libheif nor this platform's
      // libvips can actually decode — truncated bytes, an exotic HEIF profile,
      // a raster over the pixel ceiling — is the same answer as an unlisted one:
      // the parent is told the photo cannot be read, and no `Ready` row
      // survives.
      //
      // The parent's answer says nothing about why, but an operator gets the
      // failure's class: a libheif wasm trap, an allocation failure and a
      // decoder imported in the wrong shape are three different incidents that
      // would otherwise be indistinguishable from an ordinary bad photo.
      //
      // The class and nothing else. Not the decoder's message — which is not
      // ours to vouch for — and nothing about the buffer, the filename or the
      // declared type (AD-20). The sniffed format is deliberately absent too: it
      // is a fact read off the bytes, and this line stays free of those.
      this.logger.warn(`Page ingest could not decode an allowed format: ${classNameOf(cause)}.`);
      throw new UnsupportedImageFormat(unsupportedMessage);
    }

    return {
      buffer: output.data,
      mimeType: STORED_MIME,
      width: output.info.width,
      height: output.info.height,
      byteSize: output.info.size,
    };
  }

  /**
   * Writes the normalized bytes at the path the row id derives, creating the
   * fan-out directory on the way. Returns the path so the caller can store it;
   * the caller never computes one.
   *
   * The write is atomic: the bytes land in a sibling temp file and are then
   * `rename`d onto the target, which is a single filesystem operation. A retake
   * writes onto the path of a page the parent already has, so a plain
   * `writeFile` that failed part-way — a full disk, an I/O fault, a crash —
   * would destroy that page and leave a `Ready` row pointing at a truncated
   * file. With the rename, the target is either the old bytes or the new ones
   * and never half of either.
   *
   * The temp name is derived from the row id like the target is, plus a random
   * suffix per call — a process-id suffix alone collides between two
   * concurrent writes to the same page (a double-tap retake, a client retry),
   * letting one silently clobber the other's temp file. Nothing that crossed
   * the wire reaches the filesystem here either (AD-15).
   */
  async write(pageId: string, buffer: Buffer): Promise<string> {
    const target = storagePathFor(pageId, uploadRoot());
    const pending = `${target}.${randomUUID()}.pending`;
    await mkdir(path.dirname(target), { recursive: true });
    try {
      await writeFile(pending, buffer);
      await rename(pending, target);
    } catch (cause) {
      // The half-written file is this method's own litter, and leaving it would
      // occupy the name the next attempt wants.
      await unlink(pending).catch(() => undefined);
      throw cause;
    }
    return target;
  }

  /**
   * Reads one page's stored bytes back, by row id.
   *
   * The path is derived here, exactly as the write derived it, and is never
   * returned: a caller asks for a page's bytes and gets bytes (AD-15). This is
   * the only way anything outside this module reaches a stored page, and it is
   * how the Extraction job gets the images it sends.
   */
  async read(pageId: string): Promise<Buffer> {
    try {
      return await readFile(storagePathFor(pageId, uploadRoot()));
    } catch {
      // `ENOENT` and friends carry the path in their message, and that message
      // travels to whatever logs the failure. The path is the one thing that
      // may not leave this module (AD-15, AD-20), so the fault is renamed to
      // carry the row id alone — deliberately, the way `remove` is deliberate
      // about its own.
      throw new PageBytesUnavailable(pageId);
    }
  }

  /**
   * Removes a page's bytes, tolerantly.
   *
   * A missing file is not a failure: this runs on the failure path of an add
   * that never got as far as writing, and on a delete whose row is already
   * gone. Anything else is logged by page id alone — never by path (AD-20) —
   * and swallowed, because a file left behind must not fail the transaction
   * that removed the row that was its only reference.
   *
   * Returns whether the bytes are gone: `true` when the file was unlinked and
   * `true` for `ENOENT`, because "already absent" and "just removed" are the
   * same outcome for every caller. `false` means the bytes survived, which is
   * what stops the retention sweep marking a row whose photograph is still on
   * disk — the row would then say the bytes were deleted while they were not,
   * and nothing would ever come back for them.
   */
  async remove(pageId: string): Promise<boolean> {
    try {
      await unlink(storagePathFor(pageId, uploadRoot()));
      return true;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException)?.code === 'ENOENT') return true;
      this.logger.warn(`Could not remove the stored bytes for page ${pageId}.`);
      return false;
    }
  }
}
