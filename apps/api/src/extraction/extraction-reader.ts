/**
 * The narrow view of `extraction` that `practicetest` is allowed to hold, and
 * the token it is injected under.
 *
 * It exists for exactly the reason `source-test-reader.ts` exists, and that
 * file explains the mechanics in full: under ESM, two decorated services that
 * import each other as *values* cannot both be defined, because
 * `emitDecoratorMetadata` writes the other class into `design:paramtypes` and
 * that is evaluated the moment the class is declared. `forwardRef` cannot help,
 * because the failure happens before Nest is involved.
 *
 * A leaf file that imports nothing but types breaks the cycle at the only place
 * it can be broken: `practicetest` imports this interface as a **type** and the
 * token as its one value, and never imports `ExtractionService` itself.
 * `ExtractionModule` binds the token to its own service with `useExisting`, so
 * there is still exactly one instance and still exactly one reader of every
 * extraction table (AD-17).
 *
 * What travels across the boundary is the *persisted Extraction* and nothing
 * else: no page image, no storage path, no Page Image row. That is what makes
 * generation survive Epic 8's 90-day image expiry.
 */

import type { QuestionFormat } from '../generated/prisma/enums.js';
import type { RichText } from './rich-text.js';

/** One usable source Question, as generation reads it. */
export interface ExtractionQuestionForGeneration {
  /** Its ordinal within the document, so the prompt can refer to it stably. */
  ordinal: number;
  format: QuestionFormat;
  prompt: RichText;
  /** The printed options, in printed order. Empty for every non-MC format. */
  choices: RichText[];
  /** The raw labels as they were read. Canonicalization is Epic 7's (AD-11). */
  topics: string[];
}

/**
 * The whole of what a generation job reads: usable Questions and how many pages
 * they came off. `usable = false` questions are not here at all, because Epic 4
 * generates from the usable ones "and from nothing else".
 */
export interface ExtractionForGeneration {
  pageCount: number;
  questions: ExtractionQuestionForGeneration[];
}

/**
 * The one thing `practicetest` asks of `extraction`, and the only one.
 *
 * `null` means there is no completed Extraction for that Source Test — no job
 * has succeeded, or the Extraction was removed. It is a fact the caller has to
 * decide about, not an exception, because "nothing to generate from" is a
 * refusal a parent reads rather than a fault.
 */
export interface ExtractionReader {
  readForGeneration(sourceTestId: string): Promise<ExtractionForGeneration | null>;
}

/** The injection token `ExtractionModule` binds to its own service. */
export const EXTRACTION_READER = 'EXTRACTION_READER';
