import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import { PageBytesUnavailable } from './source-test-reader.js';
import {
  JPEG_QUALITY,
  STORED_MIME,
  isAllowedMime,
  storagePathFor,
  uploadRoot,
} from './source-test-policy.js';

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
 * at rather than the size it was taken at.
 */
@Injectable()
export class PageIngestService {
  private readonly logger = new Logger(PageIngestService.name);

  /**
   * Sniff → rotate → JPEG q85. Completes before the caller promotes the row
   * out of `Uploading`, so no downstream consumer ever sees a format the vision
   * model cannot read.
   */
  async normalize(buffer: Buffer, unsupportedMessage: string): Promise<NormalizedPage> {
    if (buffer.length === 0) throw new UnsupportedImageFormat(unsupportedMessage);

    const sniffed = await fileTypeFromBuffer(buffer);
    if (!isAllowedMime(sniffed?.mime)) throw new UnsupportedImageFormat(unsupportedMessage);

    let output: { data: Buffer; info: { width: number; height: number; size: number } };
    try {
      output = await sharp(buffer).rotate().jpeg({ quality: JPEG_QUALITY }).toBuffer({
        resolveWithObject: true,
      });
    } catch {
      // A format the allow-list admits but this platform's libvips cannot
      // decode — HEIC, most likely — is the same answer as an unlisted one: the
      // parent is told the photo cannot be read, and no `Ready` row survives.
      // Nothing about the buffer is logged.
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
   */
  async remove(pageId: string): Promise<void> {
    try {
      await unlink(storagePathFor(pageId, uploadRoot()));
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException)?.code === 'ENOENT') return;
      this.logger.warn(`Could not remove the stored bytes for page ${pageId}.`);
    }
  }
}
