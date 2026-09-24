import { z } from 'zod';
import { RichText } from './rich-text.js';

/**
 * The shape the model must answer in: the JSON schema `zodTextFormat` builds
 * the Responses API's structured output from (AD-9), and the same schema the
 * fake transport's payload is parsed against, so both transports are held to
 * one contract.
 *
 * Two rules shape every field:
 *
 * - Every self-assessment the model makes is carried as a confidence (AD-30),
 *   never as a verdict. Nothing downstream reads one directly; the post-hoc
 *   pass computes from them.
 * - Anything the model may legitimately decline is `nullable`, so declining is
 *   expressible without guessing. A question that depends on something it could
 *   not read says so and names the region, rather than inventing the content.
 *
 * **It is a wire contract as much as a type.** Strict Structured Outputs
 * accepts a small subset of JSON Schema: every property must be `required`
 * (`nullable` expresses "may be absent"), and `minItems`, `maxItems`,
 * `maxLength` and `refine` are not expressible at all. So nothing here is
 * optional and nothing here is bounded — every ceiling and every constraint
 * lives in `extraction-payload.ts`, where it is actually enforced. A limit
 * written here would be one the API silently drops.
 *
 * Nothing here is a `usable` flag. Asked whether a question is usable a model
 * would answer, and the answer would be the thing Story 3.6 warns on and Epic 4
 * generates from — so it is derived in code and has no place in the payload at
 * all.
 */

export const ExtractionConfidence = z.enum(['Low', 'Medium', 'High']);
export const QuestionFormat = z.enum(['MultipleChoice', 'FillInTheBlank', 'ShortAnswer']);
export const ExtractedContextKind = z.enum(['Passage', 'DataTable']);
export const UninterpretableKind = z.enum(['Diagram', 'Handwriting', 'Cropped', 'Other']);

/** One page as the model saw it, by the ordinal the caller sent it under. */
export const ExtractedPage = z.object({
  ordinal: z.number().int(),
  /** False when nothing on the page could be read at all. */
  interpretable: z.boolean(),
});

/**
 * A passage or data table shared across pages: emitted **once**, carrying the
 * page range it occupies, and referenced by id from every question that depends
 * on it — including questions printed on later pages.
 */
export const ExtractedContextPayload = z.object({
  /** Payload-local. It becomes a row id on storage and is never stored as one. */
  id: z.string(),
  kind: ExtractedContextKind,
  body: RichText,
  startPageOrdinal: z.number().int(),
  endPageOrdinal: z.number().int(),
});

export const ExtractedTopicPayload = z.object({
  /** Raw, as read. Canonicalization is Epic 7's (AD-11). */
  label: z.string(),
  confidence: ExtractionConfidence,
});

export const ExtractedQuestionPayload = z.object({
  pageOrdinal: z.number().int(),
  format: QuestionFormat,
  prompt: RichText,
  /** Options for a Multiple Choice question; empty for every other format. */
  choices: z.array(RichText),
  topics: z.array(ExtractedTopicPayload),
  confidence: ExtractionConfidence,
  /** The shared context this question depends on, or null when it stands alone. */
  contextId: z.string().nullable(),
  /** Declared by the model; the `usable` flag is computed from it, not stored from it. */
  dependsOnUninterpretable: z.boolean(),
});

export const UninterpretableRegionPayload = z.object({
  pageOrdinal: z.number().int(),
  kind: UninterpretableKind,
});

export const ExtractionPayload = z.object({
  pages: z.array(ExtractedPage),
  contexts: z.array(ExtractedContextPayload),
  questions: z.array(ExtractedQuestionPayload),
  uninterpretable: z.array(UninterpretableRegionPayload),
});

export type ExtractionPayload = z.infer<typeof ExtractionPayload>;
export type ExtractedQuestionPayload = z.infer<typeof ExtractedQuestionPayload>;
export type ExtractedContextPayload = z.infer<typeof ExtractedContextPayload>;

/** The name the structured-output format is declared under. */
export const EXTRACTION_SCHEMA_NAME = 'source_test_extraction';

/**
 * What the `fake` transport answers with (AD-22).
 *
 * It lives here, beside the schema it has to satisfy, for the same reason the
 * prompt lives in this module: the shape of a valid answer is domain knowledge,
 * and `ai` would otherwise have to know what an Extraction is.
 *
 * The document it builds is deliberately not a trivial one — it is the smallest
 * payload that exercises every rule the story has: a context that spans every
 * page and is referenced from questions on more than one of them, a fraction
 * emitted as structure rather than as text, an uninterpretable region, and
 * exactly one question that depends on it. Deterministic in the page count
 * alone, so a test asserts on figures rather than on whatever came back.
 */
export function fakeExtractionPayload(context: {
  imageCount: number;
  failure: 'none' | 'transport' | 'schema' | 'unusable';
}): ExtractionPayload {
  const pages = Array.from({ length: context.imageCount }, (_, index) => ({
    ordinal: index + 1,
    // The client-fault branch (AD-31): every page came back unreadable.
    interpretable: context.failure !== 'unusable',
  }));
  const lastPage = Math.max(context.imageCount, 1);

  const questions: ExtractedQuestionPayload[] = pages.map((page) => ({
    pageOrdinal: page.ordinal,
    format: 'MultipleChoice' as const,
    prompt: [
      { kind: 'text' as const, value: `Question on page ${page.ordinal}. What is ` },
      // Structure, never the string "1/2" (AD-32).
      { kind: 'fraction' as const, whole: null, numerator: 1, denominator: 2 },
      { kind: 'text' as const, value: ' of the passage about?' },
    ],
    choices: [
      [{ kind: 'text' as const, value: 'The first option.' }],
      [{ kind: 'text' as const, value: 'The second option.' }],
    ],
    topics: [{ label: 'Reading comprehension', confidence: 'High' as const }],
    confidence: 'High' as const,
    // Every question points at the one shared context, including the ones on
    // pages after the page it starts on.
    contextId: 'context-1',
    dependsOnUninterpretable: false,
  }));

  // Exactly one question depends on the region, so "only the dependent one is
  // unusable" is observable rather than vacuous.
  questions.push({
    pageOrdinal: lastPage,
    format: 'ShortAnswer',
    prompt: [{ kind: 'text', value: 'Describe what the diagram shows.' }],
    choices: [],
    topics: [{ label: 'Diagram interpretation', confidence: 'Medium' }],
    confidence: 'Medium',
    contextId: null,
    dependsOnUninterpretable: true,
  });

  return {
    pages,
    contexts: [
      {
        id: 'context-1',
        kind: 'Passage',
        body: [{ kind: 'text', value: 'A passage that runs across every page of this test.' }],
        startPageOrdinal: 1,
        endPageOrdinal: lastPage,
      },
    ],
    questions,
    uninterpretable: [{ pageOrdinal: lastPage, kind: 'Diagram' }],
  };
}
