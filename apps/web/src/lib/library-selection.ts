/**
 * What a photo-library multi-select turns into, as pure functions.
 *
 * They live here rather than inside the capture surface because `apps/web` runs
 * its unit tests without a DOM: a cap rule reachable only through a rendered
 * `<input type="file">` and its `FileList` is a rule no test can state. The
 * component reads them; it never restates them.
 *
 * Not one figure is stated here. The page ceiling is the API's — it arrives on
 * every Source Test read as `maxPages` — so `splitSelection` takes it as an
 * argument rather than closing over a `10` the web app would then own a second
 * copy of.
 */

/**
 * The formats ingest accepts, as an `accept` attribute.
 *
 * HEIC and HEIF are named explicitly rather than left to `image/*`: iOS reports
 * no useful MIME type for a HEIC in some pickers, and `image/*` alone lets a
 * parent choose a GIF or a TIFF the server will then refuse. The extensions
 * ride alongside the types for the same reason.
 *
 * This mirrors the server's allow-list and is deliberately only a mirror — the
 * format is decided by sniffing the bytes, and this attribute is a courtesy to
 * the picker.
 */
export const ACCEPTED_IMAGE_TYPES =
  'image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif';

/** A selection split against the slots that are left. */
export interface SelectionSplit {
  /** The files that will be posted, in the order they were selected. */
  accepted: File[];
  /** How many were dropped for want of a slot. Announced, never silent. */
  rejectedCount: number;
}

/**
 * The first `maxPages - pageCount` files of a selection, in selection order,
 * and the count of everything past that.
 *
 * Trimmed rather than refused wholesale: a parent who picked five photos with
 * two slots left meant to add pages, and adding the two they can have is closer
 * to that than adding none. The rejected count exists so the trim is stated out
 * loud rather than discovered by counting the strip.
 *
 * A negative or over-full remainder yields nothing — the ceiling can only have
 * been passed by something outside this function, and the answer to that is
 * still to post nothing.
 */
export function splitSelection(
  files: readonly File[],
  pageCount: number,
  maxPages: number,
): SelectionSplit {
  const slots = Math.max(0, maxPages - pageCount);
  const accepted = files.slice(0, slots);
  return { accepted, rejectedCount: files.length - accepted.length };
}
