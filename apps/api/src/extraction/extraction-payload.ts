import { ExtractionPayload } from './extraction-schema.js';
import type { z } from 'zod';
import {
  ExtractedContextKind,
  ExtractionConfidence,
  QuestionFormat,
  UninterpretableKind,
} from './extraction-schema.js';
import { type RichText, isRichText } from './rich-text.js';

/**
 * The deterministic post-hoc pass (AD-30): a schema-valid payload is not a
 * trusted payload.
 *
 * Everything here is pure and everything here is a rejection of the whole
 * document. There is no repair path and no "best effort" store: a payload that
 * breaks one of these rules produced nothing, and the job fails retryably,
 * because half an Extraction is worse than none — Epic 4 would generate from it
 * without ever knowing what was missing.
 *
 * The one thing this pass *computes* rather than checks is `usable`, and that
 * is deliberate: asked whether a question is usable a model would answer, and
 * the answer would be the thing Story 3.6 warns on. Derived from two observable
 * facts, the threshold is a line of code with a unit test.
 */

/** The provider's fault (AD-31): retryable, and nothing is stored. */
export class ExtractionPayloadInvalid extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtractionPayloadInvalid';
  }
}

/**
 * The input's fault (AD-31): terminal, never retried. Every page came back
 * uninterpretable, so the same photographs would produce the same answer and a
 * retry would only spend the money again.
 */
export class ExtractionInputUnusable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtractionInputUnusable';
  }
}

export const PAYLOAD_SHAPE_INVALID = 'The payload does not match the extraction schema.';
export const PAGE_SET_MISMATCH = 'The payload does not describe exactly the pages that were sent.';
export const UNKNOWN_PAGE_ORDINAL = 'The payload refers to a page that was not sent.';
export const CONTEXT_IDS_NOT_UNIQUE = 'The payload reuses a context id.';
export const CONTEXT_RANGE_INVALID = 'A context page range is not a range of pages that were sent.';
export const CONTEXT_UNRESOLVABLE = 'A question refers to a context the payload does not contain.';
export const CONTEXT_AFTER_QUESTION = 'A question refers to a context that begins after it.';
export const TOPIC_REQUIRED = 'Every question must carry at least one topic.';
export const CHOICES_REQUIRED = 'A multiple-choice question must carry at least two choices.';
export const CHOICES_FORBIDDEN = 'Only a multiple-choice question may carry choices.';
export const RICH_TEXT_INVALID = 'A text field is not a valid rich-text segment array.';
export const ALL_PAGES_UNINTERPRETABLE = 'No page could be read.';
export const DEPENDENCY_WITHOUT_REGION =
  'A question claims to depend on unreadable content that the payload never named.';
export const QUESTION_ON_UNREADABLE_PAGE = 'A question was read off a page reported as unreadable.';
export const PAYLOAD_TOO_LARGE = 'The payload is larger than a paper test can plausibly be.';

/**
 * Ceilings, stated here because the wire schema cannot carry them.
 *
 * Strict Structured Outputs expresses no `maxItems` and no `maxLength`, so an
 * array's only bound is whatever the model happens to emit — and every element
 * of every array becomes a row. These are the figures that keep a malformed
 * answer from becoming an unbounded write; they are deliberately far above any
 * real paper test, because the purpose is to refuse the absurd rather than to
 * second-guess the plausible. The page count needs no figure of its own: it is
 * known exactly at call time and already checked against the stored set.
 */
export const MAX_CONTEXTS = 100;
export const MAX_QUESTIONS = 500;
export const MAX_REGIONS = 200;
export const MAX_CHOICES = 26;
export const MAX_TOPICS = 20;
export const MAX_SEGMENTS = 200;
export const MAX_TEXT_LENGTH = 5_000;
export const MAX_LABEL_LENGTH = 200;

/**
 * The three enums as *types*. They are declared once, as Zod enums in the
 * schema file, so the payload and the normalized document can never drift into
 * two spellings of the same set.
 */
type ExtractedContextKind = z.infer<typeof ExtractedContextKind>;
type ExtractionConfidence = z.infer<typeof ExtractionConfidence>;
type QuestionFormat = z.infer<typeof QuestionFormat>;
type UninterpretableKind = z.infer<typeof UninterpretableKind>;

/** A context as it will be stored: an ordinal, not the payload-local id. */
export interface NormalizedContext {
  ordinal: number;
  kind: ExtractedContextKind;
  body: RichText;
  startPageOrdinal: number;
  endPageOrdinal: number;
}

export interface NormalizedTopic {
  label: string;
  confidence: ExtractionConfidence;
}

export interface NormalizedQuestion {
  ordinal: number;
  pageOrdinal: number;
  format: QuestionFormat;
  prompt: RichText;
  choices: RichText[];
  topics: NormalizedTopic[];
  confidence: ExtractionConfidence;
  dependsOnUninterpretable: boolean;
  /** Computed here, never read from the payload. */
  usable: boolean;
  /** The context's ordinal within this document, or null. */
  contextOrdinal: number | null;
}

export interface NormalizedRegion {
  pageOrdinal: number;
  kind: UninterpretableKind;
}

export interface NormalizedExtraction {
  pageCount: number;
  contexts: NormalizedContext[];
  questions: NormalizedQuestion[];
  regions: NormalizedRegion[];
}

/**
 * Whether a question may be generated from.
 *
 * Two observable facts, and neither is the model's opinion of its own output: a
 * question that declares a dependency on something nobody could read has no
 * content to generate from, and a question the model itself is unsure it read
 * correctly is not a question to build a practice test on.
 */
export function usableFrom(question: {
  dependsOnUninterpretable: boolean;
  confidence: ExtractionConfidence;
}): boolean {
  return !question.dependsOnUninterpretable && question.confidence !== 'Low';
}

/**
 * Checks the payload against the pages that were actually sent, and returns the
 * document to store — or throws, having stored nothing.
 *
 * `pageOrdinals` is the stored set, in the order it was sent. The payload has
 * to describe exactly that set: a page missing from it is a page the model
 * silently dropped, and a page in it that was never sent is a page the model
 * invented.
 */
export function validateExtractionPayload(
  payload: unknown,
  pageOrdinals: readonly number[],
): NormalizedExtraction {
  const parsed = ExtractionPayload.safeParse(payload);
  if (!parsed.success) throw new ExtractionPayloadInvalid(PAYLOAD_SHAPE_INVALID);
  const document = parsed.data;

  // The ceilings first, before anything iterates: every element below becomes a
  // row, so an unbounded array is an unbounded write.
  if (
    document.contexts.length > MAX_CONTEXTS ||
    document.questions.length > MAX_QUESTIONS ||
    document.uninterpretable.length > MAX_REGIONS
  ) {
    throw new ExtractionPayloadInvalid(PAYLOAD_TOO_LARGE);
  }

  const expected = new Set(pageOrdinals);
  const reported = new Set(document.pages.map((page) => page.ordinal));
  if (
    reported.size !== document.pages.length ||
    reported.size !== expected.size ||
    [...expected].some((ordinal) => !reported.has(ordinal))
  ) {
    throw new ExtractionPayloadInvalid(PAGE_SET_MISMATCH);
  }

  // The one client-fault branch (AD-31), decided before anything else is
  // checked: if nothing could be read, the shape of what was returned about it
  // is beside the point.
  if (document.pages.every((page) => !page.interpretable)) {
    throw new ExtractionInputUnusable(ALL_PAGES_UNINTERPRETABLE);
  }

  const contexts = normalizeContexts(document.contexts, expected);
  const byPayloadId = new Map(document.contexts.map((context, index) => [context.id, index]));
  if (byPayloadId.size !== document.contexts.length) {
    throw new ExtractionPayloadInvalid(CONTEXT_IDS_NOT_UNIQUE);
  }

  const regions = document.uninterpretable.map((region) => {
    if (!expected.has(region.pageOrdinal)) {
      throw new ExtractionPayloadInvalid(UNKNOWN_PAGE_ORDINAL);
    }
    return { pageOrdinal: region.pageOrdinal, kind: region.kind };
  });

  // The pages nothing could be read from, and the pages something on them could
  // not be. Both are what the two dependency rules below are checked against,
  // so the regions are normalized before the questions rather than after.
  const unreadablePages = new Set(
    document.pages.filter((page) => !page.interpretable).map((page) => page.ordinal),
  );
  const regionPages = new Set(regions.map((region) => region.pageOrdinal));

  const questions = document.questions.map((question, index) =>
    normalizeQuestion(question, index, {
      expected,
      contexts,
      byPayloadId,
      unreadablePages,
      regionPages,
    }),
  );

  return { pageCount: expected.size, contexts, questions, regions };
}

// --- Internals -----------------------------------------------------------

/** The two ceilings a rich-text field has, neither expressible on the wire. */
function requireBoundedRichText(rich: RichText): void {
  if (rich.length > MAX_SEGMENTS) throw new ExtractionPayloadInvalid(PAYLOAD_TOO_LARGE);
  for (const segment of rich) {
    if (segment.kind === 'text' && segment.value.length > MAX_TEXT_LENGTH) {
      throw new ExtractionPayloadInvalid(PAYLOAD_TOO_LARGE);
    }
  }
}

function normalizeContexts(
  payloadContexts: readonly {
    id: string;
    kind: ExtractedContextKind;
    body: unknown;
    startPageOrdinal: number;
    endPageOrdinal: number;
  }[],
  expected: ReadonlySet<number>,
): NormalizedContext[] {
  return payloadContexts.map((context, index) => {
    if (!expected.has(context.startPageOrdinal) || !expected.has(context.endPageOrdinal)) {
      throw new ExtractionPayloadInvalid(CONTEXT_RANGE_INVALID);
    }
    // A range that ends before it starts is not a range; it is two page
    // numbers in the wrong order, and storing it would make "which pages does
    // this passage span" unanswerable.
    if (context.endPageOrdinal < context.startPageOrdinal) {
      throw new ExtractionPayloadInvalid(CONTEXT_RANGE_INVALID);
    }
    if (!isRichText(context.body)) throw new ExtractionPayloadInvalid(RICH_TEXT_INVALID);
    requireBoundedRichText(context.body);
    return {
      ordinal: index + 1,
      kind: context.kind,
      body: context.body,
      startPageOrdinal: context.startPageOrdinal,
      endPageOrdinal: context.endPageOrdinal,
    };
  });
}

function normalizeQuestion(
  question: {
    pageOrdinal: number;
    format: QuestionFormat;
    prompt: unknown;
    choices: unknown[];
    topics: { label: string; confidence: ExtractionConfidence }[];
    confidence: ExtractionConfidence;
    contextId: string | null;
    dependsOnUninterpretable: boolean;
  },
  index: number,
  against: {
    expected: ReadonlySet<number>;
    contexts: readonly NormalizedContext[];
    byPayloadId: ReadonlyMap<string, number>;
    unreadablePages: ReadonlySet<number>;
    regionPages: ReadonlySet<number>;
  },
): NormalizedQuestion {
  const { expected, contexts, byPayloadId, unreadablePages, regionPages } = against;
  if (!expected.has(question.pageOrdinal)) {
    throw new ExtractionPayloadInvalid(UNKNOWN_PAGE_ORDINAL);
  }

  // A question read off a page the payload itself calls unreadable is a
  // contradiction, and `usable` is computed from exactly these self-reports —
  // so believing one of them and ignoring the other is how a hallucinated
  // question reaches Epic 4's generator marked usable.
  if (unreadablePages.has(question.pageOrdinal)) {
    throw new ExtractionPayloadInvalid(QUESTION_ON_UNREADABLE_PAGE);
  }

  // And the other direction: a declared dependency has to name something. A
  // question claiming to depend on content no region records would be stored
  // unusable on the strength of a fact the payload never established.
  if (question.dependsOnUninterpretable && !regionPages.has(question.pageOrdinal)) {
    throw new ExtractionPayloadInvalid(DEPENDENCY_WITHOUT_REGION);
  }

  // At least one topic, and a blank label is not a topic: it is the model
  // satisfying the array's shape without answering the question.
  const topics = question.topics.filter((topic) => topic.label.trim() !== '');
  if (topics.length === 0) throw new ExtractionPayloadInvalid(TOPIC_REQUIRED);
  if (
    question.topics.length > MAX_TOPICS ||
    question.choices.length > MAX_CHOICES ||
    topics.some((topic) => topic.label.trim().length > MAX_LABEL_LENGTH)
  ) {
    throw new ExtractionPayloadInvalid(PAYLOAD_TOO_LARGE);
  }

  // Exactly one format is the schema's own doing — `format` is one enum value,
  // not a list — and the choice rule is what makes the format mean something:
  // a MultipleChoice question with no options is not multiple choice, and a
  // ShortAnswer question with options is not short answer.
  if (question.format === 'MultipleChoice') {
    if (question.choices.length < 2) throw new ExtractionPayloadInvalid(CHOICES_REQUIRED);
  } else if (question.choices.length > 0) {
    throw new ExtractionPayloadInvalid(CHOICES_FORBIDDEN);
  }

  if (!isRichText(question.prompt)) throw new ExtractionPayloadInvalid(RICH_TEXT_INVALID);
  requireBoundedRichText(question.prompt);
  const choices = question.choices.map((choice) => {
    if (!isRichText(choice)) throw new ExtractionPayloadInvalid(RICH_TEXT_INVALID);
    requireBoundedRichText(choice);
    return choice;
  });

  let contextOrdinal: number | null = null;
  if (question.contextId !== null) {
    const found = byPayloadId.get(question.contextId);
    if (found === undefined) throw new ExtractionPayloadInvalid(CONTEXT_UNRESOLVABLE);
    const context = contexts[found]!;
    // A passage the question depends on is printed on the question's page or
    // before it. One that begins afterwards is a reference the model got the
    // wrong way round, and following it would attach the wrong text.
    if (context.startPageOrdinal > question.pageOrdinal) {
      throw new ExtractionPayloadInvalid(CONTEXT_AFTER_QUESTION);
    }
    contextOrdinal = context.ordinal;
  }

  return {
    ordinal: index + 1,
    pageOrdinal: question.pageOrdinal,
    format: question.format,
    prompt: question.prompt,
    choices,
    topics: topics.map((topic) => ({ label: topic.label.trim(), confidence: topic.confidence })),
    confidence: question.confidence,
    dependsOnUninterpretable: question.dependsOnUninterpretable,
    usable: usableFrom(question),
    contextOrdinal,
  };
}
