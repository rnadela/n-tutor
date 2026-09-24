import { z } from 'zod';
import type { AiFakeFailure } from '../ai/ai-config.js';
import { RichText } from '../extraction/rich-text.js';
import { normalizeTopicLabel, type GenerationWeighting } from './practice-test-policy.js';

/**
 * The shape a generated Practice Test must come back in: the JSON schema
 * `zodTextFormat` builds the Responses API's structured output from (AD-9), and
 * the same schema the fake transport's payload is parsed against, so both
 * transports are held to one contract.
 *
 * **It is a wire contract as much as a type.** Strict Structured Outputs
 * accepts a small subset of JSON Schema: every property must be `required`
 * (`nullable` expresses "may be absent"), and `minItems`, `maxItems`,
 * `maxLength` and `refine` are not expressible at all. So nothing here is
 * optional and nothing here is bounded — every ceiling and every constraint
 * lives in `practice-test-payload.ts`, where it is actually enforced. A limit
 * written here would be one the API silently drops.
 *
 * `RichText` is reused from `extraction` rather than forked: a fraction in a
 * generated question is the same structure as a fraction read off a page, and
 * two spellings of it would be two renderings and two spoken alternatives.
 */

export const QuestionFormat = z.enum(['MultipleChoice', 'FillInTheBlank', 'ShortAnswer']);

export const GeneratedChoicePayload = z.object({
  body: RichText,
  /**
   * Whether this is the right answer. Exactly one of a question's choices may
   * say so, and that is checked in code afterwards — a model told to flag one
   * still sometimes flags two, or none (AD-30).
   */
  isCorrect: z.boolean(),
});

export const GeneratedQuestionPayload = z.object({
  format: QuestionFormat,
  prompt: RichText,
  /** The options, for a MultipleChoice question; empty for every other format. */
  choices: z.array(GeneratedChoicePayload),
  /**
   * The correct answer in full, for a format that has no options. `nullable`
   * and **required**, never optional: a MultipleChoice question says
   * `answer: null`, which is the only way "absent" survives strict Structured
   * Outputs and keeps one spelling of it.
   */
  answer: RichText.nullable(),
  /** Raw labels, as written. Canonicalization is Epic 7's (AD-11). */
  topics: z.array(z.string()),
});

export const PracticeTestPayload = z.object({
  questions: z.array(GeneratedQuestionPayload),
});

export type GeneratedChoicePayload = z.infer<typeof GeneratedChoicePayload>;
export type GeneratedQuestionPayload = z.infer<typeof GeneratedQuestionPayload>;
export type PracticeTestPayload = z.infer<typeof PracticeTestPayload>;

/** The name the structured-output format is declared under. */
export const PRACTICE_TEST_SCHEMA_NAME = 'generated_practice_test';

/**
 * One format's share of a draft, as the fake is told to produce it — the same
 * `formatTargets` apportionment the post-hoc pass checks against.
 */
export interface FakeFormatTarget {
  format: z.infer<typeof QuestionFormat>;
  count: number;
}

/**
 * What the `fake` transport answers with (AD-22).
 *
 * It lives here, beside the schema it has to satisfy, for the same reason the
 * prompt lives in this module: the shape of a valid answer is domain knowledge,
 * and `ai` would otherwise have to know what a Practice Test is.
 *
 * The caller closes over the targets, the topics and the draft's ordinal and
 * hands `AiService` a nullary-ish builder, which is why none of that has to
 * travel through `ai`'s own request type. The `draftOrdinal` is what makes
 * successive drafts of one job *materially different* rather than five copies:
 * the post-hoc pass rejects a prompt that collides with a source prompt or with
 * one already landed in this job, so a fake that produced the same text five
 * times would fail its own validation on the second draft.
 */
export function fakePracticeTestPayload(context: {
  targets: readonly FakeFormatTarget[];
  topics: readonly string[];
  /**
   * The Topic to weight and how many questions must carry it, or absent for
   * the even spread. One pair, so the fake cannot be told which Topic to
   * concentrate on without also being told how far.
   */
  weighting?: GenerationWeighting | null;
  draftOrdinal: number;
  failure: AiFakeFailure;
}): PracticeTestPayload {
  const topics = context.topics.length > 0 ? context.topics : ['General'];
  const weighting = context.weighting ?? null;
  const weightedTopic = weighting?.topic ?? null;
  const weightedFloor = weighting?.floor ?? 0;
  // The other Topics the questions above the floor are spread across, folded by
  // the same normalizer the validator counts with: a case-variant of the
  // weighted label left in this pool would be counted as on-topic, and the fake
  // would over-satisfy the floor it is supposed to be held to. Falls back to
  // the weighted Topic itself on a single-Topic Extraction, where every
  // question is on it and the floor is trivially met.
  const restTopics =
    weightedTopic === null
      ? topics
      : topics.filter((label) => normalizeTopicLabel(label) !== normalizeTopicLabel(weightedTopic));
  let seq = 0;
  const questions: GeneratedQuestionPayload[] = [];

  for (const target of context.targets) {
    for (let index = 0; index < target.count; index += 1) {
      seq += 1;
      // The first `weightedFloor` questions carry the weighted Topic, the rest
      // cycle the others — so the fake satisfies the rule the integration tier
      // holds it to, rather than the tier proving the rule by disabling it.
      const topic =
        weightedTopic !== null
          ? seq <= weightedFloor
            ? weightedTopic
            : restTopics.length === 0
              ? weightedTopic
              : restTopics[(seq - weightedFloor - 1) % restTopics.length]!
          : topics[(seq - 1) % topics.length]!;
      const prompt = [
        {
          kind: 'text' as const,
          value: `Practice ${context.draftOrdinal}.${seq} on ${topic}: what is `,
        },
        // Structure, never the string "1/2" (AD-32).
        {
          kind: 'fraction' as const,
          whole: null,
          numerator: context.draftOrdinal,
          denominator: seq + 1,
        },
        { kind: 'text' as const, value: ' of the whole?' },
      ];

      if (target.format === 'MultipleChoice') {
        questions.push({
          format: 'MultipleChoice',
          prompt,
          // Three, because the post-hoc rule is "at least three": a two-option
          // question has one distractor, which is a coin toss rather than a
          // test. Exactly one of them is flagged.
          choices: [
            {
              body: [{ kind: 'text', value: `Option A for ${context.draftOrdinal}.${seq}` }],
              isCorrect: true,
            },
            {
              body: [{ kind: 'text', value: `Option B for ${context.draftOrdinal}.${seq}` }],
              isCorrect: false,
            },
            {
              body: [{ kind: 'text', value: `Option C for ${context.draftOrdinal}.${seq}` }],
              isCorrect: false,
            },
          ],
          answer: null,
          topics: [topic],
        });
        continue;
      }

      questions.push({
        format: target.format,
        prompt,
        choices: [],
        answer: [{ kind: 'text', value: `Answer for ${context.draftOrdinal}.${seq}` }],
        topics: [topic],
      });
    }
  }

  // The `unusable` latch has no meaning for a text call — there are no
  // photographs to be unreadable — so the fake answers with an empty question
  // list, which the post-hoc pass rejects as a payload that produced nothing.
  if (context.failure === 'unusable') return { questions: [] };
  return { questions };
}
