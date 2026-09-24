import type { QuestionFormat } from '../generated/prisma/enums.js';
import { isRichText, plainTextOf, type RichText } from '../extraction/rich-text.js';
import { normalizeTopicLabel, type GenerationWeighting } from './practice-test-policy.js';
import { PracticeTestPayload } from './practice-test-schema.js';

/**
 * The deterministic post-hoc pass (AD-30): a schema-valid payload is not a
 * trusted payload.
 *
 * Everything here is pure and everything here is a rejection of the whole
 * draft. There is no repair path and no "best effort" store: a payload that
 * breaks one of these rules produced nothing, and the call is an upstream fault
 * — the model was asked for a shape and answered with another. `produceDraft`
 * in `practice-test.service.ts` therefore re-issues the call on a rejection,
 * up to `AI_MAX_ATTEMPTS`, rather than failing the parent on one bad roll of
 * the dice; only the last rejection ends the job.
 *
 * The canonical case the epic names is a Multiple Choice question whose correct
 * answer is not among its own options. Here that is expressed as the rule it
 * actually is: exactly one option carries `isCorrect`. A question where none
 * does has an answer nothing can be graded against; one where two do has two
 * right answers and no way to say which.
 */

/** The provider's fault (AD-31): retryable, and nothing is stored. */
export class GenerationPayloadInvalid extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GenerationPayloadInvalid';
  }
}

export const PAYLOAD_SHAPE_INVALID = 'The payload does not match the generation schema.';
export const QUESTION_COUNT_MISMATCH =
  'The payload does not hold the number of questions that were asked for.';
export const FORMAT_MIX_MISMATCH =
  'The payload does not hold the mix of question formats asked for.';
export const CHOICES_REQUIRED = 'A multiple-choice question must carry at least three options.';
export const CHOICES_FORBIDDEN = 'Only a multiple-choice question may carry options.';
export const ONE_CORRECT_CHOICE_REQUIRED =
  'A multiple-choice question must mark exactly one option correct.';
export const ANSWER_REQUIRED = 'A question with no options must state its answer.';
export const ANSWER_FORBIDDEN =
  'A multiple-choice question states its answer by marking an option, not in the answer field.';
export const TOPIC_REQUIRED = 'Every question must carry at least one topic.';
export const WEIGHTED_TOPIC_UNDERWEIGHT =
  'The payload does not put enough of its questions on the topic that was weighted.';
export const RICH_TEXT_INVALID = 'A text field is not a valid rich-text segment array.';
export const PROMPT_NOT_NEW = 'A question reproduces one that already exists.';
export const PROMPT_EMPTY = 'A question prompt has no text once normalized.';
export const CHOICES_NOT_DISTINCT = 'A multiple-choice question repeats one of its own options.';
export const CHOICE_BODY_EMPTY = 'A multiple-choice option has no text once normalized.';
export const TOPIC_LABEL_TOO_LONG = 'A topic label is longer than a topic label can plausibly be.';
export const PAYLOAD_TOO_LARGE = 'The payload is larger than a practice test can plausibly be.';

/**
 * Ceilings, stated here because the wire schema cannot carry them.
 *
 * Strict Structured Outputs expresses no `maxItems` and no `maxLength`, so an
 * array's only bound is whatever the model happens to emit — and every element
 * of every array becomes a row. The question count is bounded exactly rather
 * than by a ceiling, because it is known at call time; these are the figures
 * that keep everything hanging off a question from becoming an unbounded write.
 */
export const MAX_CHOICES = 26;
export const MAX_TOPICS = 20;
export const MAX_SEGMENTS = 200;
export const MAX_TEXT_LENGTH = 5_000;
export const MAX_LABEL_LENGTH = 200;

/** A generated choice as it will be stored. */
export interface NormalizedGeneratedChoice {
  ordinal: number;
  body: RichText;
  isCorrect: boolean;
}

/** A generated question as it will be stored. */
export interface NormalizedGeneratedQuestion {
  ordinal: number;
  format: QuestionFormat;
  prompt: RichText;
  /** Null for MultipleChoice, where the flagged option is the answer. */
  answer: RichText | null;
  choices: NormalizedGeneratedChoice[];
  topics: string[];
}

export interface NormalizedPracticeTest {
  questions: NormalizedGeneratedQuestion[];
}

export interface GenerationExpectation {
  /** How many questions of each format this draft was asked for. */
  targets: ReadonlyMap<QuestionFormat, number>;
  /**
   * Normalized plain text of every prompt that must not be reproduced: the
   * source test's, plus everything already landed in this job.
   */
  forbiddenPrompts: ReadonlySet<string>;
  /**
   * The Topic this draft was asked to concentrate on and how many of its
   * questions must carry it, or absent for an unweighted request — which is
   * every Story 4.1 request, and which skips the count below entirely.
   *
   * One pair rather than two fields: a caller that could pass the Topic and
   * forget the floor would disable the rule silently, with nothing in the type
   * to say it had.
   */
  weighting?: GenerationWeighting | null;
}

/**
 * Characters that are decoration on a question rather than part of it: the
 * sentence-level punctuation a model adds, drops and re-adds while changing
 * nothing about what is being asked.
 *
 * Deliberately a **list**, not `\p{P}` and `\p{S}` wholesale. Those classes
 * contain every mathematical operator, so folding them would make "What is
 * 5 + 3?" and "What is 5 - 3?" the same string — and the verbatim check would
 * then reject a legitimately new arithmetic question as a copy of one that
 * already exists. Two questions that differ only by their operator are two
 * different questions, and this is the one place the product decides that.
 */
const DECORATIVE_PUNCTUATION = /[.,;:!?'"`()\[\]{}\u2018\u2019\u201C\u201D\u2026]+/gu;

/**
 * The comparison "is this the same question" is made on.
 *
 * Case, surrounding and internal whitespace, and sentence punctuation are all
 * things a model varies while changing nothing, so a verbatim check that read
 * the raw string would pass a copy with a full stop added. Operators, digits
 * and words all survive, because each of them is something a question is
 * *about*. Fractions survive as their plain rendering, which is exactly right:
 * "1/2" written as structure and the same fraction in the source are the same
 * question, whatever the segments look like.
 */
export function normalizePrompt(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(DECORATIVE_PUNCTUATION, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** A rich-text field that is valid *and* within this module's ceilings. */
function validRichText(value: unknown): value is RichText {
  if (!isRichText(value)) return false;
  const rich = value as RichText;
  if (rich.length > MAX_SEGMENTS) return false;
  return plainTextOf(rich).length <= MAX_TEXT_LENGTH;
}

function refuse(message: string): never {
  throw new GenerationPayloadInvalid(message);
}

/**
 * Checks one generated draft against the schema, this module's own rules, and
 * what the call actually asked for, and returns it in the shape it is stored in.
 *
 * The expectation is not decoration: a payload whose format mix does not equal
 * the computed targets is a payload that answered a different question, and
 * storing it would make the acceptance criterion "its format mix matches the
 * computed per-format targets" a thing nothing enforces.
 */
export function validateGenerationPayload(
  payload: unknown,
  expectation: GenerationExpectation,
): NormalizedPracticeTest {
  const parsed = PracticeTestPayload.safeParse(payload);
  if (!parsed.success) refuse(PAYLOAD_SHAPE_INVALID);
  const raw = parsed.data;

  const expectedTotal = [...expectation.targets.values()].reduce((sum, count) => sum + count, 0);
  if (raw.questions.length !== expectedTotal) refuse(QUESTION_COUNT_MISMATCH);

  // Counted as the questions are walked, then compared as a whole: a per-format
  // running check would reject a payload that is merely in a different order.
  const produced = new Map<QuestionFormat, number>();
  // Seeded with what this draft must not reproduce, then grown as the draft's
  // own prompts are accepted — so a draft that repeats *itself* is caught by
  // exactly the same rule that catches it repeating the source.
  const seen = new Set(expectation.forbiddenPrompts);
  const questions: NormalizedGeneratedQuestion[] = [];

  raw.questions.forEach((question, index) => {
    const format = question.format as QuestionFormat;
    produced.set(format, (produced.get(format) ?? 0) + 1);

    if (!validRichText(question.prompt)) refuse(RICH_TEXT_INVALID);

    const normalized = normalizePrompt(plainTextOf(question.prompt));
    // Post-hoc, never hoped for: the prompt asked the model not to copy, and
    // this is what makes the rule hold when it does anyway.
    if (normalized === '') refuse(PROMPT_EMPTY);
    if (seen.has(normalized)) refuse(PROMPT_NOT_NEW);
    seen.add(normalized);

    if (question.topics.length === 0) refuse(TOPIC_REQUIRED);
    if (question.topics.length > MAX_TOPICS) refuse(PAYLOAD_TOO_LARGE);
    const topics = question.topics.map((label) => label.trim());
    if (topics.some((label) => label === '')) refuse(TOPIC_REQUIRED);
    if (topics.some((label) => label.length > MAX_LABEL_LENGTH)) refuse(TOPIC_LABEL_TOO_LONG);

    let answer: RichText | null = null;
    const choices: NormalizedGeneratedChoice[] = [];

    if (format === 'MultipleChoice') {
      if (question.choices.length < 3) refuse(CHOICES_REQUIRED);
      if (question.choices.length > MAX_CHOICES) refuse(PAYLOAD_TOO_LARGE);
      // The answer lives on the flagged option. A payload that states it twice
      // has two answers that can disagree, and nothing decides which wins.
      if (question.answer !== null) refuse(ANSWER_FORBIDDEN);

      const bodies = new Set<string>();
      let correct = 0;
      question.choices.forEach((choice, choiceIndex) => {
        if (!validRichText(choice.body)) refuse(RICH_TEXT_INVALID);
        const key = normalizePrompt(plainTextOf(choice.body));
        // A repeated option is either two right answers or a distractor that
        // is not one; either way the question cannot be graded honestly.
        if (key === '') refuse(CHOICE_BODY_EMPTY);
        if (bodies.has(key)) refuse(CHOICES_NOT_DISTINCT);
        bodies.add(key);
        if (choice.isCorrect) correct += 1;
        choices.push({ ordinal: choiceIndex + 1, body: choice.body, isCorrect: choice.isCorrect });
      });
      if (correct !== 1) refuse(ONE_CORRECT_CHOICE_REQUIRED);
    } else {
      if (question.choices.length > 0) refuse(CHOICES_FORBIDDEN);
      if (question.answer === null) refuse(ANSWER_REQUIRED);
      if (!validRichText(question.answer)) refuse(RICH_TEXT_INVALID);
      answer = question.answer;
    }

    questions.push({
      ordinal: index + 1,
      format,
      prompt: question.prompt,
      answer,
      choices,
      topics,
    });
  });

  for (const [format, count] of expectation.targets) {
    if ((produced.get(format) ?? 0) !== count) refuse(FORMAT_MIX_MISMATCH);
  }
  // A format the targets never named is as wrong as a miscount of one they did.
  for (const format of produced.keys()) {
    if (!expectation.targets.has(format)) refuse(FORMAT_MIX_MISMATCH);
  }

  // The weighting, counted over the whole payload for the reason the format mix
  // is: a running per-question check would reject a draft that merely put its
  // on-topic questions last. Skipped entirely when nothing was weighted, so an
  // unweighted request is validated exactly as Story 4.1 validates it.
  //
  // The comparison goes through the policy's normalizer, the same one the
  // request-time resolve used, so a model that answered '  fractions ' to a
  // weighting on 'Fractions' counts — it wrote the Topic, and rejecting a
  // correct draft over its whitespace would spend another provider call to ask
  // for the same thing again. The labels themselves are stored raw (AD-11).
  if (expectation.weighting != null) {
    const wanted = normalizeTopicLabel(expectation.weighting.topic);
    const onTopic = questions.filter((question) =>
      question.topics.some((label) => normalizeTopicLabel(label) === wanted),
    ).length;
    if (onTopic < expectation.weighting.floor) refuse(WEIGHTED_TOPIC_UNDERWEIGHT);
  }

  return { questions };
}
