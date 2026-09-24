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
import { optionalEnv, requireIntEnv } from '../common/env.js';
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

/** Where page bytes live when nothing overrides it. Never served statically. */
export const DEFAULT_UPLOAD_ROOT = path.resolve(process.cwd(), '.uploads');

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
