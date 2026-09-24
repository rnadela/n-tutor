import type { QuestionFormat } from '../generated/prisma/enums.js';
import { plainTextOf, type RichText } from '../extraction/rich-text.js';
import { normalizeTopicLabel, type GenerationWeighting } from './practice-test-policy.js';

/**
 * The generation prompt.
 *
 * This is the AD-17 carve-out, exactly as `extraction-prompt.ts` is: every
 * provider call goes through `ai`, but the *question* belongs to the module
 * that owns the answer. `ai` knows about clients, pins, timeouts and cost; it
 * does not know what a Practice Test is.
 *
 * It states the rules the payload is afterwards checked against in code
 * (AD-30). Stating them is not trusting them: a model told that exactly one
 * option is correct still sometimes flags two, and
 * `practice-test-payload.ts` is what holds the line. The prompt exists so the
 * common case is right, not so the check can be skipped.
 *
 * The material-difference list is the part that is not merely hopeful: every
 * source prompt, and every prompt already landed in this job, is named here as
 * text to differ from — and the post-hoc pass rejects a collision, so the
 * instruction and the check are two halves of one rule.
 */

export interface GenerationSourceQuestion {
  ordinal: number;
  format: QuestionFormat;
  prompt: RichText;
  choices: RichText[];
  topics: string[];
}

export interface GenerationPromptInput {
  /** The usable source Questions, in document order. */
  sourceQuestions: readonly GenerationSourceQuestion[];
  /** How many Questions of each Format this draft must hold. */
  targets: ReadonlyMap<QuestionFormat, number>;
  /** Every Topic the Extraction carries, covered evenly unless one is weighted. */
  topics: readonly string[];
  /**
   * The Topic to concentrate this draft on and how many Questions must carry
   * it, or absent for the even spread. Absent produces the unweighted prompt
   * byte for byte: Story 4.1's requests must not change wording under this.
   *
   * One pair rather than two fields, so the floor quoted to the model is
   * always the floor the post-hoc pass counts against — the instruction and
   * the check are two halves of one rule.
   */
  weighting?: GenerationWeighting | null;
  /** Plain text of every prompt already landed in this job. */
  alreadyGenerated: readonly string[];
}

/** One line per source question: its format, its prompt, its options. */
function describeSource(question: GenerationSourceQuestion): string {
  const options =
    question.choices.length === 0
      ? ''
      : ` Options: ${question.choices.map((choice) => plainTextOf(choice)).join(' | ')}`;
  return `${question.ordinal}. [${question.format}] ${plainTextOf(question.prompt)}${options}`;
}

/**
 * The weighted draft's topic instruction: the one Topic and its minimum count,
 * then what to do with the questions above that floor.
 *
 * The second list is the Extraction's *other* Topics, with the weighted one
 * filtered out — by the same normalizer the floor is counted with, so a raw
 * label differing from it only in case or spacing is not re-offered as
 * something else to write about. A single-Topic Extraction has no others at
 * all, and gets a sentence saying so rather than an instruction trailing an
 * empty list.
 */
function weightedCoverage(
  topics: readonly string[],
  weighting: GenerationWeighting,
  total: number,
): string[] {
  const wanted = normalizeTopicLabel(weighting.topic);
  const others = topics.filter((topic) => normalizeTopicLabel(topic) !== wanted);
  const lines = [
    `Concentrate this test on one topic. At least ${weighting.floor} of the ${total} questions must carry this topic, written in exactly these words:`,
    `- ${weighting.topic}`,
  ];
  if (others.length === 0) {
    lines.push('', 'It is the only topic this test covers, so give it every question.');
    return lines;
  }
  if (weighting.floor >= total) {
    lines.push(
      '',
      'The floor above already covers every question this test asks, so give it every question.',
    );
    return lines;
  }
  lines.push(
    '',
    'Give the remaining questions to the other topics below, writing each topic in the same words it is given here:',
    ...others.map((topic) => `- ${topic}`),
  );
  return lines;
}

export function buildGenerationPrompt(input: GenerationPromptInput): string {
  const targetLines = [...input.targets.entries()]
    .filter(([, count]) => count > 0)
    .map(([format, count]) => `- ${format}: ${count}`);
  const total = [...input.targets.values()].reduce((sum, count) => sum + count, 0);

  // Two halves of one rule: the figure stated here is the figure
  // `practice-test-payload.ts` counts against. An unweighted request takes the
  // first branch and produces Story 4.1's prompt byte for byte.
  const coverage =
    input.weighting == null
      ? [
          'Cover these topics as evenly as the question count allows, writing each topic in the same words it is given here:',
          ...input.topics.map((topic) => `- ${topic}`),
        ]
      : weightedCoverage(input.topics, input.weighting, total);

  const lines = [
    'You are writing one new practice test for a school student, modelled on a test they have already taken. You are given that test in full. Write fresh questions that examine the same material at the same level.',
    '',
    `Write exactly ${total} questions, in this mix of formats:`,
    ...targetLines,
    '',
    ...coverage,
    '',
    'Rules:',
    '1. Give every question exactly one format, and at least one topic drawn from the list above.',
    '2. A MultipleChoice question carries at least three options, exactly one of which is marked correct, and the other options must be plausible answers a student could reasonably choose. Its `answer` field is null, because the correct option is the answer.',
    '3. Every other format carries no options at all and states the full correct answer in its `answer` field.',
    '4. Emit every number written as a fraction as a structured fraction segment, with its numerator and denominator as separate integers and its whole part separate again for a mixed number. Never write a fraction as text such as "1/2" or "one half". This applies to question prompts, options and answers alike.',
    '5. Never reproduce a question from the source test, and never reproduce one you have already written for this request. Rewording, reordering the options, or changing only the numbers in an otherwise identical question is reproduction. Each question must be genuinely new work on the same material.',
    '',
    'The source test, which you must not copy from:',
    ...input.sourceQuestions.map((question) => describeSource(question)),
  ];

  if (input.alreadyGenerated.length > 0) {
    lines.push(
      '',
      'Questions you have already written for this request, which you must also not repeat:',
      ...input.alreadyGenerated.map((prompt, index) => `${index + 1}. ${prompt}`),
    );
  }

  return lines.join('\n');
}
