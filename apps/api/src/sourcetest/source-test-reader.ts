/**
 * The narrow view of `sourcetest` that `extraction` is allowed to hold, and the
 * token it is injected under.
 *
 * This file exists because the dependency between the two modules is a genuine
 * cycle — `submit` enqueues the job, and the job reads the pages back — and
 * under ESM a cycle expressed as two classes importing each other is not merely
 * untidy: `emitDecoratorMetadata` writes the other class into `design:paramtypes`,
 * which is evaluated the moment the decorated class is defined, so whichever
 * module is reached second throws `Cannot access '…' before initialization` at
 * boot. `forwardRef` cannot help, because the failure happens before Nest is
 * involved at all.
 *
 * A leaf file that imports nothing breaks the cycle at the only place it can be
 * broken: `extraction` imports this interface as a **type** and the token as its
 * one value, and never imports `SourceTestService` itself. `SourceTestModule`
 * binds the token to its own service with `useExisting`, so there is still
 * exactly one instance and still exactly one writer of every Source Test table
 * (AD-17). The dependency in the other direction stays a plain `forwardRef`,
 * because only one side of a cycle has to be cut.
 */

import type { SourceTestStatus } from '../generated/prisma/enums.js';

/** One page's stored bytes, as the Extraction job reads them. Never a path. */
export interface PageBytes {
  ordinal: number;
  buffer: Buffer;
  mimeType: string;
}

/**
 * What a Source Test looks like to a reader outside `sourcetest`: enough to
 * know it exists and whose it is, and nothing about its pages or its bytes.
 */
export interface LiveSourceTest {
  id: string;
  /**
   * The child the upload was photographed for. Carried across the boundary
   * because a Practice Test generated from it belongs to the same child, and
   * re-deriving that through a second delegate read would be a second place the
   * association could drift (AD-17).
   */
  studentProfileId: string;
  /**
   * Whether the pages have been committed. A `Draft` has no Extraction and
   * nothing to generate from, so a reader has to be able to tell.
   */
  status: SourceTestStatus;
  /**
   * When the pages were committed, or null while it is still a Draft.
   *
   * **Required, not optional.** `null` already carries the one legitimate absence —
   * a Draft has no submission — so an *optional* field would mean a second kind of
   * absence, "this reader did not select the column", which no caller can tell from
   * the first. Story 7.5's weighted target labels the upload a parent would generate
   * from by its date, and under an optional field a reader that quietly stopped
   * selecting it would degrade every one of those labels to "a <subject> upload" with
   * nothing failing. The shared field list selects it for every caller, so requiring
   * it costs nothing and closes that.
   */
  submittedAt: Date | null;
  /** Not in the shared field list, so absent unless the caller selected it. */
  parentAccountId?: string;
}

/**
 * The two things `extraction` asks of `sourcetest`, and the only two.
 *
 * `requireLive` is the ownership proof for work still in progress — it raises
 * `sourcetest`'s own 404 for a foreign, unknown or expired id (AD-18).
 *
 * `requireReadable` is the same proof for something already committed, and the
 * difference is the whole point: a Source Test's `expiresAt` is the *draft's*
 * 72-hour TTL and is never cleared on submit, so a read that honoured it would
 * start answering 404 three days after capture for an Extraction that is intact
 * and will outlive its photographs by design. A Draft is still invisible once
 * expired; a Submitted one is not, because it is no longer uncommitted work.
 *
 * `readPageBytes` is the only way anything outside that module reaches a stored
 * page (AD-15).
 */
export interface SourceTestReader {
  requireLive(parentAccountId: string, id: string): Promise<LiveSourceTest>;
  requireReadable(parentAccountId: string, id: string): Promise<LiveSourceTest>;
  readPageBytes(sourceTestId: string): Promise<PageBytes[]>;
  /**
   * The Subject label of each of the given Source Tests, keyed by Source Test
   * id — `null` where the upload carries no classification, and absent where
   * the id names nothing this reader can see.
   *
   * Batched rather than single-id because its one caller is a *list*:
   * `practicetest` renders the Subject on every row of Student Home, and a
   * per-row call would be an N+1 across a module boundary. It exists at all
   * because `practicetest` must never hold the `sourceTest` or the `subject`
   * delegate (AD-17) — the label is `sourcetest`'s to resolve, through the same
   * `TaxonomyService` call the classification read already makes.
   *
   * Deliberately **not** account-scoped: the caller has already proved whose
   * the Practice Test is, in the very `where` that found it, and re-proving
   * ownership here would be a second place that proof could disagree with
   * itself. Nothing but a Subject *name* crosses back.
   */
  readSubjectLabels(sourceTestIds: readonly string[]): Promise<Map<string, string | null>>;
  /**
   * The Subject **id** of each of the given Source Tests, keyed by Source Test id —
   * `null` where the upload carries no classification, and absent where the id
   * names nothing this reader can see.
   *
   * `readSubjectLabels`'s sibling, and here because they answer two different
   * questions. A *name* is what a list renders; an *id* is what canonicalization
   * needs, because AD-11's canonical Topic set is scoped by Subject and a name is
   * not a key. Resolving the id back out of a name would be a lookup that fails the
   * day two Subjects are spelled alike.
   *
   * No taxonomy call at all, which is the other difference: the column *is* the
   * answer, so there is nothing to resolve and nothing to degrade. A disabled
   * Subject answers with its id unchanged — a stored reference resolves for as long
   * as it is stored, and a Subject retired after a test was classified must not cost
   * a child their Mastery history.
   *
   * Batched, and deliberately **not** account-scoped, for the two reasons
   * `readSubjectLabels` states: the caller has already proved whose the row is in the
   * `where` that found it, and re-proving ownership here would be a second place that
   * proof could disagree with itself. Nothing but a Subject id crosses back.
   */
  readSubjectIds(sourceTestIds: readonly string[]): Promise<Map<string, string | null>>;
  /**
   * The Grade Level name of each of the given Source Tests, keyed by Source Test
   * id — `null` where the upload carries no Grade Level or the stored id no
   * longer names a row, and absent where the id names nothing this reader can
   * see.
   *
   * The sibling of `readSubjectLabels`, and here for the same reason (AD-17):
   * the Grade Level is `sourcetest`'s column and the *name* behind it is
   * `admin`'s taxonomy to resolve, so a reader outside this module must never
   * acquire a `sourceTest` or a `gradeLevel` delegate to reach it.
   *
   * Its caller is `explanation`, which pitches an Explanation's register at the
   * **Practice Test's** Grade Level — the grade of the paper the child actually
   * sat, never the grade on their Student Profile. The label is a prompt
   * instruction and nothing more: an unresolvable one costs the prompt its grade
   * clause and never costs the child their Explanation, which is why this
   * degrades to `null` rather than refusing.
   *
   * Batched, and deliberately **not** account-scoped, for the two reasons
   * `readSubjectLabels` states: one call site today asks about one id and a
   * later list would ask about many, and ownership has already been proven in
   * the `where` that found the row.
   */
  readGradeLevelLabels(sourceTestIds: readonly string[]): Promise<Map<string, string | null>>;
}

/**
 * A stored page whose bytes are not where the row says they are.
 *
 * A plain named error carrying the **page id** and nothing else, because the
 * one thing that must not escape `sourcetest` is a storage path (AD-15), and an
 * `ENOENT` from `readFile` carries one in its message straight into whatever
 * logs the failure (AD-20).
 */
export class PageBytesUnavailable extends Error {
  constructor(readonly pageId: string) {
    super(`The stored bytes for page ${pageId} could not be read.`);
    this.name = 'PageBytesUnavailable';
  }
}

/** The injection token `SourceTestModule` binds to its own service. */
export const SOURCE_TEST_READER = 'SOURCE_TEST_READER';
