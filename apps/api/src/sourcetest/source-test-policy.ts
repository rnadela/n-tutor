/**
 * The single source of truth for every figure and every rule the Source Test
 * mechanism owns: how many pages one may hold, which formats its bytes may be,
 * where a page's bytes live, when a draft dies, and what "contiguous 1..N"
 * actually means.
 *
 * Nothing else states any of them. Everything here is pure or reads one env
 * override with the constant below as its fallback, resolved once at boot by
 * the same pattern `uncommitted-state-policy.ts` uses — so a test can drive a
 * different upload root without a second definition of what the root is.
 */

import path from 'node:path';
import { optionalBoolEnv, optionalEnv, requireIntEnv } from '../common/env.js';
import { UNCOMMITTED_STATE_TTL_MS } from '../identity/uncommitted-state-policy.js';

/**
 * A Source Test accepts 1–10 Page Images. The ceiling is stated here alone: the
 * controller refuses an eleventh against this figure, the web strip disables
 * its add control against the same figure read from the API, and the tests
 * compare against the constant rather than against a literal `10`.
 */
export const MAX_PAGES = 10;

/**
 * The one TTL (AD-16). A draft Source Test lives 72 hours from `createdAt` and
 * is never extended by activity — the same lifecycle uncommitted parent input
 * runs on, re-exported rather than restated so there is exactly one 72 in the
 * codebase.
 */
export { UNCOMMITTED_STATE_TTL_MS as SOURCE_TEST_TTL_MS };

/**
 * The formats ingest accepts, decided by sniffing the bytes and never from the
 * client-declared type (AD-28). HEIC/HEIF is listed because the epic requires
 * it; whether the installed libvips can actually decode one is a platform fact,
 * and a buffer this set admits but `sharp` refuses is answered
 * `UNSUPPORTED_IMAGE_FORMAT` exactly as an unlisted one is.
 */
export const ALLOWED_MIMES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];

/** What every page is stored as, whatever it arrived as (AD-28). Never cropped. */
export const STORED_MIME = 'image/jpeg';
export const STORED_EXTENSION = '.jpg';
export const JPEG_QUALITY = 85;

/**
 * The largest single upload the multipart layer will hold in memory. Not a
 * product rule — the product rule is the page count — but a bound a byte-
 * carrying route must have, or one request decides how much memory the process
 * spends.
 */
export const MAX_PAGE_BYTES = 25 * 1024 * 1024;

/**
 * The largest decoded image ingest will encode, in pixels.
 *
 * The byte cap above does not bound this on its own: a HEIC is far denser than
 * the image it decodes to, so bytes well inside `MAX_PAGE_BYTES` can decode to
 * an arbitrarily large raster. `sharp` bounds its own decoders with
 * `limitInputPixels`, but the HEIF branch hands it raw RGBA that has *already*
 * been allocated by libheif, so that limit never sees those bytes and this
 * ceiling is the only thing standing in front of the allocation.
 *
 * 64 megapixels: every photograph a phone actually produces fits — a 48MP
 * iPhone frame is 8064×6048, under 49MP — while the worst case libheif may
 * allocate stays bounded at four bytes a pixel, about 268MB. Stated as a page
 * rule here beside the byte cap rather than in the service, because it decides
 * which uploads are refused.
 */
export const MAX_DECODED_PIXELS = 64 * 1024 * 1024;

/** Where page bytes live when nothing overrides it. Never served statically. */
export const DEFAULT_UPLOAD_ROOT = path.resolve(process.cwd(), '.uploads');

// --- Page Image retention (FR-32) ----------------------------------------
//
// The 90 is written once, here, beside the other figures this module owns. It
// is a different clock from `SOURCE_TEST_TTL_MS` above and must never be
// confused with it: that one is the 72h draft TTL (AD-16), which kills a Source
// Test that was never committed; this one removes the *photographs* of a Source
// Test that was.

/**
 * How long a submitted Source Test's photographs are kept: 90 days from the
 * moment the upload was committed (FR-32).
 *
 * Anchored on `submittedAt` rather than `createdAt` because the commit is the
 * event the promise is made about, and a draft that was never submitted is
 * already owned by the 72h TTL — putting it under this clock as well would give
 * it a second, much longer life.
 */
export const PAGE_IMAGE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/** Submission plus the retention window. Activity never moves it. */
export function pageImageExpiryFrom(
  submittedAt: Date,
  retentionMs: number = PAGE_IMAGE_RETENTION_MS,
): Date {
  return new Date(submittedAt.getTime() + retentionMs);
}

/**
 * Whether one page's bytes are due for removal, given its Source Test's
 * `submittedAt`.
 *
 * Null means never submitted, which is never due: that Source Test is a draft
 * and the 72h TTL owns it. Inclusive at the boundary, exactly as `isExpired` is
 * — the bytes are over the instant the clock reaches the expiry.
 */
export function isPageImageExpired(submittedAt: Date | null, now: Date): boolean {
  if (submittedAt === null) return false;
  return pageImageExpiryFrom(submittedAt).getTime() <= now.getTime();
}

/** The `submittedAt` a page must be at or before to be swept, as one figure. */
export function pageImageExpiryCutoff(
  now: Date,
  retentionMs: number = PAGE_IMAGE_RETENTION_MS,
): Date {
  return new Date(now.getTime() - retentionMs);
}

/**
 * The most pages one sweep pass removes.
 *
 * The same ceiling `uncommitted-state-policy.ts` puts on its own sweep, and for
 * the same reason: a pass whose cost is bounded only by how much backlog exists
 * is not bounded at all. A larger backlog simply drains over the next few
 * passes — the schedule runs daily and the clock does not move while it drains.
 */
export const PAGE_EXPIRY_SWEEP_BATCH_SIZE = 100;

// --- Messages ------------------------------------------------------------
//
// One message per rejection, and not one of them carries image bytes, a
// filename or a storage path (AD-20): identifiers only, and mostly not even
// those. The names are the codes the I/O matrix names; the values are the plain
// sentences the product's copy rules require.

/**
 * The Source Test read's one and only rejection.
 *
 * Every way it can fail — the row is another account's, the row is unknown, the
 * row has expired — answers with exactly this. One message for all of them is
 * what makes them indistinguishable, so nothing about the read confirms that a
 * Source Test exists somewhere. A 404, never a 403.
 */
export const SOURCE_TEST_NOT_FOUND = 'That upload is no longer available.';

/** Distinct from the above on purpose: this one the parent can act on. */
export const SOURCE_TEST_NOT_DRAFT = 'That upload has already been submitted.';

/** The same indistinguishability, one level down. */
export const PAGE_NOT_FOUND = 'That page is no longer part of this upload.';

export const PAGE_LIMIT_REACHED = `An upload holds at most ${MAX_PAGES} pages.`;

export const UNSUPPORTED_IMAGE_FORMAT =
  'That file is not a photo this can read. Use a photo taken with the camera or picked from the photo library.';

export const NO_PAGES_TO_SUBMIT = 'Add at least one page before submitting.';

/**
 * The Subject is not offered for the Grade Level the Source Test will hold
 * after the write. Availability is a property of the *pair*, so the sentence
 * names both rather than the Subject alone.
 *
 * The Grade Level's own refusal is `identity`'s exported
 * `GRADE_LEVEL_NOT_SELECTABLE`, reused rather than restated here: one sentence
 * per rule, wherever the rule first got one.
 */
export const SUBJECT_NOT_AVAILABLE = 'That subject is not available for that grade level.';

/** The submit gate's own refusal, distinct from the page-count one. */
export const CLASSIFICATION_REQUIRED = 'Choose a subject and a grade level before submitting.';

/**
 * The legibility check's own classification gate. A direct call must not be
 * able to spend a provider call on a Source Test the parent has not
 * classified yet, the same reason the submit gate above exists.
 */
export const CLASSIFICATION_REQUIRED_FOR_CHECK =
  'Choose a subject and a grade level before checking pages.';

/**
 * The third submit gate: the check has to have run over this page set.
 *
 * It gates on the check having *happened*, never on what it said — `Low` is a
 * warning and is never a refusal (AD-29). The disabled control on the screen is
 * a courtesy; this is what a caller who never saw the screen gets.
 */
export const LEGIBILITY_CHECK_REQUIRED = 'Check the pages before submitting.';

/**
 * The check itself could not be completed — the provider could not be reached,
 * or answered with something the payload rules reject.
 *
 * One sentence for both, on purpose: from the parent's side they are the same
 * fact, and the difference between them is not something they can act on. It
 * says the check may be run again, because it may: nothing was stored.
 */
export const LEGIBILITY_CHECK_FAILED = 'The pages could not be checked. Try again.';

/** A classification patch that would change nothing is a mistake, not a no-op. */
export const NOTHING_TO_CLASSIFY = 'Choose a subject or a grade level.';

/**
 * The shape refusals the classification DTO answers with, stated here beside
 * every other sentence this module owns rather than left to class-validator's
 * own English. A value that is not an identifier at all is a different fault
 * from one that names no row, so each says which field it is about.
 */
export const SUBJECT_ID_INVALID = 'That subject could not be recognised.';
export const GRADE_LEVEL_ID_INVALID = 'That grade level could not be recognised.';

/**
 * The multipart layer's own refusal, stated rather than left to surface as a
 * framework fault. It names the bound in megabytes because that is the unit the
 * photo a parent is holding is measured in; the byte figure is the one the
 * runtime actually enforces.
 */
export function pageTooLarge(maxBytes: number = maxPageBytes()): string {
  // Rounded to the nearest tenth of a MB rather than floored: flooring stated
  // a smaller limit than the one actually enforced for any override that
  // isn't an exact multiple of 1 MiB.
  const megabytes = Math.round((maxBytes / (1024 * 1024)) * 10) / 10;
  return `That photo is too large. The limit is ${megabytes} MB.`;
}

export const PAGE_ORDER_MISMATCH =
  'The page order sent does not match the pages on this upload. Reload and try again.';

// --- Runtime -------------------------------------------------------------

export interface SourceTestRuntime {
  uploadRoot: string;
  maxPageBytes: number;
}

let resolved: SourceTestRuntime | null = null;

/**
 * Reads and checks both overrides once, at boot (`SourceTestModule` asks for it
 * as it is constructed), so a mistyped override is a process that refuses to
 * start rather than a 500 the first parent to photograph a page discovers.
 */
export function sourceTestRuntime(): SourceTestRuntime {
  if (resolved === null) {
    const maxPageBytes = requireIntEnv('MAX_PAGE_BYTES', MAX_PAGE_BYTES);
    if (maxPageBytes <= 0) {
      throw new Error('MAX_PAGE_BYTES must be a positive integer.');
    }
    resolved = {
      uploadRoot: path.resolve(optionalEnv('UPLOAD_ROOT', DEFAULT_UPLOAD_ROOT)),
      maxPageBytes,
    };
  }
  return resolved;
}

/** Test seam: forgets the resolved values so a new environment is read. */
export function resetSourceTestRuntime(): void {
  resolved = null;
}

export function uploadRoot(): string {
  return sourceTestRuntime().uploadRoot;
}

export function maxPageBytes(): number {
  return sourceTestRuntime().maxPageBytes;
}

export interface PageExpiryRuntime {
  /** Whether this process registers the schedule at all. */
  workerEnabled: boolean;
  /** The pg-boss cron expression the sweep runs on. */
  cron: string;
}

/**
 * Daily at 03:17 UTC. A retention promise measured in days needs a pass a day
 * and nothing finer; deep in the night because that is when a parent is least
 * likely to be uploading, and off the hour because every other system in the
 * world also schedules on the hour.
 */
export const DEFAULT_PAGE_EXPIRY_CRON = '17 3 * * *';

let pageExpiryResolved: PageExpiryRuntime | null = null;

/**
 * Reads the two overrides once, at boot, the same way `sourceTestRuntime()`
 * does — so a mistyped flag is a process that refuses to start rather than a
 * retention promise that silently stopped being kept.
 */
export function pageExpiryRuntime(): PageExpiryRuntime {
  if (pageExpiryResolved === null) {
    const cron = optionalEnv('PAGE_EXPIRY_CRON', DEFAULT_PAGE_EXPIRY_CRON).trim();
    // Five fields, and that is the whole check: pg-boss parses the rest, and an
    // expression it cannot parse must not be discovered by a schedule that
    // quietly never fires.
    if (cron.split(/\s+/).length !== 5) {
      throw new Error(`PAGE_EXPIRY_CRON must be a five-field cron expression, got "${cron}".`);
    }
    pageExpiryResolved = {
      workerEnabled: optionalBoolEnv('PAGE_EXPIRY_WORKER_ENABLED', true),
      cron,
    };
  }
  return pageExpiryResolved;
}

/** Test seam: forgets the resolved values so a new environment is read. */
export function resetPageExpiryRuntime(): void {
  pageExpiryResolved = null;
}

/**
 * The shape a row id must have before it is allowed to become a path segment.
 *
 * The ids this module derives paths from are the database's own `uuid()`
 * defaults, so this always holds; it is asserted anyway because the whole
 * path-traversal control is that the path comes from the id and nothing else
 * (AD-15). A value that is not a bare uuid is a programming error, and a loud
 * one is better than a quiet write outside the root.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Where one page's bytes live, derived from the row id alone — never from a
 * client-supplied name, a declared type, or anything else that crossed the wire
 * (AD-15). Two levels of fan-out so one directory never holds every page ever
 * uploaded.
 */
export function storagePathFor(pageId: string, root: string = uploadRoot()): string {
  if (!UUID.test(pageId)) {
    throw new Error('A page storage path is derived from a row id, and that is not one.');
  }
  return path.join(root, pageId.slice(0, 2), pageId.slice(2, 4), `${pageId}${STORED_EXTENSION}`);
}

// --- Rules ---------------------------------------------------------------

/**
 * Submission is refused while zero pages remain, server-side. The disabled
 * button on the strip is a courtesy; this is the control.
 */
export function canSubmit(pageCount: number): boolean {
  return pageCount >= 1;
}

/**
 * Whether a Source Test carries the classification submission requires.
 *
 * Non-null, never enabled: the taxonomy's whole design is that disabling
 * changes what may be *chosen*, not what a stored reference resolves to
 * (`resolveSubject` succeeds for a disabled row on purpose). A gate that
 * re-checked enablement would let an Admin action invalidate work a parent had
 * already done.
 */
export function isClassified(row: {
  subjectId: string | null;
  gradeLevelId: string | null;
}): boolean {
  return row.subjectId !== null && row.gradeLevelId !== null;
}

/**
 * Whether one page's stored verdict is a readable one.
 *
 * `Low` is the only failing verdict, and this is the one place that threshold
 * is stated — the web app mirrors it, the flag copy reads it, and neither
 * restates which verdict is the bad one.
 *
 * An unchecked page (`null`) reads as readable rather than as flagged: nothing
 * has judged it, and a page nobody has looked at is not a page somebody found
 * wanting. The gate that cares whether the check ran is `isChecked`, and
 * conflating the two would make a fresh draft look full of blurry pages.
 */
export function isPageReadable(legibility: 'Low' | 'Medium' | 'High' | null): boolean {
  return legibility !== 'Low';
}

/**
 * Whether the one batch check has run over the page set as it currently
 * stands. The whole of the submit gate, and the only thing it asserts.
 */
export function isChecked(row: { legibilityCheckedAt: Date | null }): boolean {
  return row.legibilityCheckedAt !== null;
}

/** And an eleventh page is refused before any byte is written. */
export function canAddPage(pageCount: number): boolean {
  return pageCount < MAX_PAGES;
}

/**
 * The ordinals a list of page ids takes: `1..N` in the order given.
 *
 * Contiguous from one, always — which is the invariant `@@unique([sourceTestId,
 * ordinal])` makes enforceable. Both the reorder and the delete path renumber
 * through this one function, so neither can drift into its own arithmetic.
 */
export function renumbered(orderedIds: readonly string[]): { id: string; ordinal: number }[] {
  return orderedIds.map((id, index) => ({ id, ordinal: index + 1 }));
}

/**
 * Validates a requested order against the stored one, or throws.
 *
 * Reorder is an explicit permutation, not a move: the client sends the full
 * array and a body that is not a permutation of exactly the stored ids — one
 * omitted, one repeated, one foreign — is rejected whole, never partially
 * applied. The check is on the multiset, so length alone is not enough: `[A, A,
 * C]` against `[A, B, C]` has to fail.
 */
export function reorderedOrThrow(
  storedIds: readonly string[],
  requestedIds: readonly string[],
): string[] {
  if (requestedIds.length !== storedIds.length) throw new PageOrderMismatch();
  const remaining = new Set(storedIds);
  for (const id of requestedIds) {
    if (!remaining.delete(id)) throw new PageOrderMismatch();
  }
  // `remaining` is necessarily empty here: equal lengths, and every requested id
  // removed exactly one stored id.
  return [...requestedIds];
}

/**
 * The permutation rule's own failure, thrown by a pure function and translated
 * to a 400 by the service. A pure module does not import Nest's HTTP
 * exceptions — that is what keeps it unit-testable without a framework.
 */
export class PageOrderMismatch extends Error {
  constructor() {
    super(PAGE_ORDER_MISMATCH);
    this.name = 'PageOrderMismatch';
  }
}

/**
 * The format rule, applied to what the bytes actually are. The caller passes
 * what sniffing returned, never what the client declared.
 */
export function isAllowedMime(mime: string | undefined): boolean {
  return mime !== undefined && ALLOWED_MIMES.includes(mime);
}

/** Created-at plus the one TTL. Written once; activity never moves it. */
export function expiryFrom(createdAt: Date, ttlMs: number = UNCOMMITTED_STATE_TTL_MS): Date {
  return new Date(createdAt.getTime() + ttlMs);
}

/**
 * Exclusive at the boundary, exactly as every other expiry in the codebase is:
 * a draft is over the instant the clock reaches its expiry, not a millisecond
 * after.
 */
export function isExpired(row: { expiresAt: Date }, now: Date): boolean {
  return row.expiresAt.getTime() <= now.getTime();
}

/** The `expiresAt` comparison every read filters on, stated once. */
export function liveAt(now: Date): { gt: Date } {
  return { gt: now };
}
