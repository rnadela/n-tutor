import type { QuestionFormat } from '../generated/prisma/enums.js';
import {
  RichText as RichTextSchema,
  parseRichText,
  plainTextOf,
  type RichText,
} from '../extraction/rich-text.js';
import {
  FIGURE_SVG_TOO_LARGE,
  MAX_FIGURE_SVG_BYTES,
  figureSvgByteLength,
} from '../extraction/svg-figure.js';
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
 * A generated figure is one of the source's own drawings.
 *
 * The same rule as `PROMPT_NOT_NEW`, one medium over: the prompt tells the
 * model to draw something new, and this is what holds the line when it redraws
 * the source instead. Sound because every figure compared here is the canonical
 * serializer's output on both sides, so "the same drawing" is "the same bytes".
 */
export const FIGURE_NOT_NEW = 'A question reproduces a figure the source test already draws.';
/**
 * An edit names a set of options that is not the stored one.
 *
 * Editing an option's body is a rewrite of what is already there; adding or
 * removing one is not this story's, and a partial restatement would silently
 * leave an option untouched that the parent believed they had replaced.
 */
export const CHOICES_MISMATCHED =
  'An edit must restate every option of a multiple-choice question, and only those.';

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
/**
 * How many figures one field may hold, and how many bytes of drawing in total
 * — the extraction module's own figures, for the extraction module's own
 * reason: `MAX_FIGURE_SVG_BYTES` bounds one drawing, and `MAX_SEGMENTS`
 * drawings of 16 KB is megabytes in a single question prompt. A question needs
 * a diagram or two, so the count is where the absurd starts and the byte budget
 * is the backstop for many small ones.
 */
export const MAX_FIGURES = 4;
export const MAX_FIGURE_BYTES = 32 * 1024;

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
  /**
   * Sanitized SVG of every figure the source test draws. A generated figure
   * whose own sanitized SVG is in here is a copy, refused `FIGURE_NOT_NEW`.
   *
   * A `Set` of the canonical form rather than a similarity measure: the
   * serializer makes two identical drawings two identical strings, and
   * "nearly the same shape" is the prompt's business (rule 7), not a rule code
   * can hold without comparing pictures.
   */
  forbiddenFigures?: ReadonlySet<string>;
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

/** A field as it will be stored, or the one sentence it is refused with. */
type NormalizedField = { rich: RichText } | { refusal: string };

/**
 * A rich-text field normalized for storage, within this module's ceilings — or
 * the refusal it earned, which each caller raises as its own kind of fault.
 *
 * **Normalized, not merely checked.** `parseRichText` rewrites what it is given
 * (AD-32): it trims a figure's text alternative and replaces a figure's SVG
 * with the sanitizer's own output. A guard that returned the value as received
 * would persist model-authored markup that nothing had rewritten — the exact
 * shape Story 3.9 exists to remove — so the caller stores *this* value and
 * never its own copy.
 *
 * Since Story 4.8 a generated prompt and a generated option body may carry a
 * figure, so the ceilings and the copy rule mirror `richTextForStorage` in
 * `extraction-payload.ts` field for field — judged on the field as it arrived,
 * so an oversize figure is the honest `PAYLOAD_TOO_LARGE` rather than the
 * `RICH_TEXT_INVALID` the sanitizer's own cap would report, and re-summed on
 * the sanitized form, because escaping can only grow a drawing and the raw sum
 * is therefore not the last word on the aggregate.
 *
 * The edit path runs through here too. An edit cannot introduce a figure — the
 * inverse only grafts back what was stored — but it carries the stored ones,
 * and a field that was within bounds must stay within them.
 */
function normalizedField(value: unknown, forbiddenFigures: ReadonlySet<string>): NormalizedField {
  const shaped = RichTextSchema.safeParse(value);
  if (!shaped.success) return { refusal: RICH_TEXT_INVALID };
  const bound = figureBoundsRefusal(shaped.data);
  if (bound !== null) return { refusal: bound };

  let rich: RichText;
  try {
    rich = parseRichText(shaped.data);
  } catch (cause) {
    // One rejection reason and no new failure kind, so a figure fault routes
    // exactly like every other post-hoc one — except the case the raw-byte
    // check above cannot see: a figure under the cap whose canonical, escaped
    // form grows past it. That is still an oversize figure.
    if (cause instanceof Error && cause.message === FIGURE_SVG_TOO_LARGE) {
      return { refusal: PAYLOAD_TOO_LARGE };
    }
    return { refusal: RICH_TEXT_INVALID };
  }

  if (rich.length > MAX_SEGMENTS) return { refusal: RICH_TEXT_INVALID };
  if (plainTextOf(rich).length > MAX_TEXT_LENGTH) return { refusal: RICH_TEXT_INVALID };

  let figureBytes = 0;
  for (const segment of rich) {
    if (segment.kind !== 'figure') continue;
    figureBytes += figureSvgByteLength(segment.svg);
    if (figureBytes > MAX_FIGURE_BYTES) return { refusal: PAYLOAD_TOO_LARGE };
    if (forbiddenFigures.has(segment.svg)) return { refusal: FIGURE_NOT_NEW };
  }
  return { rich };
}

/** The figure ceilings, on the field as it arrived. */
function figureBoundsRefusal(rich: RichText): string | null {
  let figures = 0;
  let figureBytes = 0;
  for (const segment of rich) {
    if (segment.kind !== 'figure') continue;
    figures += 1;
    figureBytes += figureSvgByteLength(segment.svg);
    if (
      segment.alt.length > MAX_TEXT_LENGTH ||
      figureSvgByteLength(segment.svg) > MAX_FIGURE_SVG_BYTES ||
      figures > MAX_FIGURES ||
      figureBytes > MAX_FIGURE_BYTES
    ) {
      return PAYLOAD_TOO_LARGE;
    }
  }
  return null;
}

function refuse(message: string): never {
  throw new GenerationPayloadInvalid(message);
}

/** The same field, refused as the provider's fault. */
function normalizedRichText(value: unknown, forbiddenFigures: ReadonlySet<string>): RichText {
  const field = normalizedField(value, forbiddenFigures);
  if ('refusal' in field) refuse(field.refusal);
  return field.rich;
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
  const forbiddenFigures = expectation.forbiddenFigures ?? new Set<string>();
  const questions: NormalizedGeneratedQuestion[] = [];

  raw.questions.forEach((question, index) => {
    const format = question.format as QuestionFormat;
    produced.set(format, (produced.get(format) ?? 0) + 1);

    const prompt = normalizedRichText(question.prompt, forbiddenFigures);

    const normalized = normalizePrompt(plainTextOf(prompt));
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
        const body = normalizedRichText(choice.body, forbiddenFigures);
        const key = normalizePrompt(plainTextOf(body));
        // A repeated option is either two right answers or a distractor that
        // is not one; either way the question cannot be graded honestly.
        if (key === '') refuse(CHOICE_BODY_EMPTY);
        if (bodies.has(key)) refuse(CHOICES_NOT_DISTINCT);
        bodies.add(key);
        if (choice.isCorrect) correct += 1;
        choices.push({ ordinal: choiceIndex + 1, body, isCorrect: choice.isCorrect });
      });
      if (correct !== 1) refuse(ONE_CORRECT_CHOICE_REQUIRED);
    } else {
      if (question.choices.length > 0) refuse(CHOICES_FORBIDDEN);
      if (question.answer === null) refuse(ANSWER_REQUIRED);
      answer = normalizedRichText(question.answer, forbiddenFigures);
    }

    questions.push({
      ordinal: index + 1,
      format,
      prompt,
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

// --- The edit path -------------------------------------------------------

/**
 * A parent's edit does not satisfy what a Question is.
 *
 * A separate class from `GenerationPayloadInvalid` because the *fault* is
 * different — a parent typed something, no provider is at fault and nothing is
 * retried — while the **rules** are deliberately the same ones, read from the
 * same constants above. A parent edit and a generated payload obeying two
 * copies of the Question invariants is how an edit comes to store the malformed
 * Multiple Choice question the post-hoc pass exists to catch.
 *
 * Carries no Question text, no option body and no Topic label: the message is
 * one of this module's own fixed sentences and nothing else (AD-20).
 */
export class EditedQuestionInvalid extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EditedQuestionInvalid';
  }
}

/** An edit that restates every option of a Multiple Choice question. */
export interface EditedChoice {
  ordinal: number;
  body: RichText;
  isCorrect: boolean;
}

/** One Question as an edit would leave it, merged over what is stored. */
export interface EditedQuestion {
  format: QuestionFormat;
  prompt: RichText;
  answer: RichText | null;
  choices: EditedChoice[];
}

function refuseEdit(message: string): never {
  throw new EditedQuestionInvalid(message);
}

/**
 * The same field, refused as the parent's 400.
 *
 * No forbidden set: an edit carries the figures the field already stored, and
 * the source's own drawing landing there was the generation pass's business.
 */
function editedRichText(value: unknown): RichText {
  const field = normalizedField(value, new Set<string>());
  if ('refusal' in field) refuseEdit(field.refusal);
  return field.rich;
}

/**
 * Checks one edited Question against the invariants every Question holds,
 * before a row is written.
 *
 * `storedOrdinals` is what makes "no option is added and none is removed" a
 * rule rather than a hope: an edit either names every stored option exactly
 * once or it is refused whole, the same way a page reorder is an explicit
 * permutation rather than a move.
 *
 * Format is never edited, so it is taken from the stored row and only ever read
 * here — which is what lets the two shapes be checked against each other: a
 * Multiple Choice question keeps a null `answer` and its options, and every
 * other format keeps a non-null `answer` and none.
 */
export function validateEditedQuestion(
  edited: EditedQuestion,
  storedOrdinals: readonly number[],
): EditedQuestion {
  const prompt = editedRichText(edited.prompt);
  if (normalizePrompt(plainTextOf(prompt)) === '') refuseEdit(PROMPT_EMPTY);

  if (edited.format === 'MultipleChoice') {
    // The flagged option is the answer. A second copy of it in the answer
    // column is two answers that can disagree, with nothing deciding which wins.
    if (edited.answer !== null) refuseEdit(ANSWER_FORBIDDEN);
    if (edited.choices.length < 3) refuseEdit(CHOICES_REQUIRED);
    if (edited.choices.length > MAX_CHOICES) refuseEdit(PAYLOAD_TOO_LARGE);

    const wanted = [...storedOrdinals].sort((a, b) => a - b);
    const given = edited.choices.map((choice) => choice.ordinal).sort((a, b) => a - b);
    if (wanted.length !== given.length || wanted.some((value, index) => value !== given[index])) {
      refuseEdit(CHOICES_MISMATCHED);
    }

    const bodies = new Set<string>();
    const choices: EditedChoice[] = [];
    let correct = 0;
    for (const choice of edited.choices) {
      const body = editedRichText(choice.body);
      const key = normalizePrompt(plainTextOf(body));
      if (key === '') refuseEdit(CHOICE_BODY_EMPTY);
      if (bodies.has(key)) refuseEdit(CHOICES_NOT_DISTINCT);
      bodies.add(key);
      if (choice.isCorrect) correct += 1;
      choices.push({ ordinal: choice.ordinal, body, isCorrect: choice.isCorrect });
    }
    if (correct !== 1) refuseEdit(ONE_CORRECT_CHOICE_REQUIRED);
    // Returned rebuilt rather than as it came in: the caller writes what this
    // returns, so every field it writes is one `parseRichText` normalized.
    return { ...edited, prompt, answer: null, choices };
  }

  if (edited.choices.length > 0) refuseEdit(CHOICES_FORBIDDEN);
  if (edited.answer === null) refuseEdit(ANSWER_REQUIRED);
  const answer = editedRichText(edited.answer);
  return { ...edited, prompt, answer, choices: [] };
}
