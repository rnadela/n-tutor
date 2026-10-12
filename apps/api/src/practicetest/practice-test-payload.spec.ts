import { describe, expect, it } from 'vitest';
import type { QuestionFormat } from '../generated/prisma/enums.js';
import type { RichText } from '../extraction/rich-text.js';
import {
  ANSWER_FORBIDDEN,
  MAX_CHOICES,
  MAX_LABEL_LENGTH,
  MAX_SEGMENTS,
  MAX_TEXT_LENGTH,
  MAX_TOPICS,
  PAYLOAD_TOO_LARGE,
  ANSWER_REQUIRED,
  CHOICE_BODY_EMPTY,
  CHOICES_FORBIDDEN,
  CHOICES_NOT_DISTINCT,
  CHOICES_REQUIRED,
  FORMAT_MIX_MISMATCH,
  GenerationPayloadInvalid,
  ONE_CORRECT_CHOICE_REQUIRED,
  PAYLOAD_SHAPE_INVALID,
  PROMPT_EMPTY,
  PROMPT_NOT_NEW,
  QUESTION_COUNT_MISMATCH,
  FIGURE_NOT_NEW,
  MAX_FIGURES,
  MAX_FIGURE_BYTES,
  RICH_TEXT_INVALID,
  TOPIC_LABEL_TOO_LONG,
  TOPIC_REQUIRED,
  WEIGHTED_TOPIC_UNDERWEIGHT,
  CHOICES_MISMATCHED,
  EditedQuestionInvalid,
  normalizePrompt,
  validateEditedQuestion,
  validateGenerationPayload,
  type EditedQuestion,
} from './practice-test-payload.js';
import { weightedTopicFloor, weightingFor } from './practice-test-policy.js';
import { PracticeTestPayload } from './practice-test-schema.js';
import {
  MALICIOUS_FIGURES,
  SANITIZED_FIGURES,
  figureOfCircles,
  oversizeFigure,
} from '../extraction/svg-figure.fixtures.js';
import { MAX_FIGURE_SVG_BYTES, figureSvgByteLength } from '../extraction/svg-figure.js';

/** A figure as a model would write it, and the only form that may be stored. */
const FIGURE_RAW =
  '<svg viewBox="0 0 10 10" width="200" height="200"><circle cx="5" cy="5" r="4" fill="#ff0000" stroke="black"/></svg>';
const FIGURE_SANITIZED =
  '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="currentColor" stroke="currentColor"/></svg>';

const text = (value: string) => [{ kind: 'text', value }];

function mcQuestion(overrides: Record<string, unknown> = {}) {
  return {
    format: 'MultipleChoice',
    prompt: text('What is two plus two?'),
    choices: [
      { body: text('Four'), isCorrect: true },
      { body: text('Five'), isCorrect: false },
      { body: text('Six'), isCorrect: false },
    ],
    answer: null,
    topics: ['Addition'],
    ...overrides,
  };
}

function shortAnswer(overrides: Record<string, unknown> = {}) {
  return {
    format: 'ShortAnswer',
    prompt: text('Explain why the sky is blue.'),
    choices: [],
    answer: text('Light scatters.'),
    topics: ['Light'],
    ...overrides,
  };
}

/** The expectation a one-MultipleChoice draft is checked against. */
function expecting(
  targets: Array<[QuestionFormat, number]>,
  forbidden: string[] = [],
): Parameters<typeof validateGenerationPayload>[1] {
  return {
    targets: new Map(targets),
    forbiddenPrompts: new Set(forbidden.map((prompt) => normalizePrompt(prompt))),
  };
}

/** Asserts the rejection *and* which rule rejected it. */
function refusedWith(payload: unknown, expectation: ReturnType<typeof expecting>, reason: string) {
  expect(() => validateGenerationPayload(payload, expectation)).toThrow(GenerationPayloadInvalid);
  expect(() => validateGenerationPayload(payload, expectation)).toThrow(reason);
}

describe('normalizePrompt', () => {
  it('ignores case, spacing and sentence punctuation, which a copy varies and a rewrite does not', () => {
    expect(normalizePrompt('What is  2 + 2?')).toBe(normalizePrompt('what is 2 + 2'));
    expect(normalizePrompt('Name the capital (of France).')).toBe(
      normalizePrompt('name the capital of france'),
    );
  });

  it('keeps distinct questions distinct', () => {
    expect(normalizePrompt('What is 2 + 2?')).not.toBe(normalizePrompt('What is 3 + 3?'));
  });

  it('keeps mathematical operators significant', () => {
    // Folding every punctuation and symbol class would make these one string,
    // and the verbatim check would then reject a legitimately new subtraction
    // question as a copy of the addition one.
    expect(normalizePrompt('What is 5 + 3?')).not.toBe(normalizePrompt('What is 5 - 3?'));
    expect(normalizePrompt('What is 5 x 3?')).not.toBe(normalizePrompt('What is 5 / 3?'));
    expect(normalizePrompt('Is 5 > 3?')).not.toBe(normalizePrompt('Is 5 < 3?'));
  });

  it('accepts a new arithmetic question that differs only by its operator', () => {
    // The same rule stated where it actually bites: through the validator.
    expect(() =>
      validateGenerationPayload(
        { questions: [mcQuestion({ prompt: text('What is 5 - 3?') })] },
        expecting([['MultipleChoice', 1]], ['What is 5 + 3?']),
      ),
    ).not.toThrow();
  });
});

describe('the ceilings the wire schema cannot express', () => {
  /** A rich-text field of `count` segments, each a distinct run of text. */
  function segments(count: number) {
    return Array.from({ length: count }, (_unused, index) => ({
      kind: 'text',
      value: `s${index} `,
    }));
  }

  it('refuses a prompt with more segments than a question can plausibly have', () => {
    refusedWith(
      { questions: [mcQuestion({ prompt: segments(MAX_SEGMENTS + 1) })] },
      expecting([['MultipleChoice', 1]]),
      RICH_TEXT_INVALID,
    );
    expect(() =>
      validateGenerationPayload(
        { questions: [mcQuestion({ prompt: segments(MAX_SEGMENTS) })] },
        expecting([['MultipleChoice', 1]]),
      ),
    ).not.toThrow();
  });

  it('refuses a text field longer than a question can plausibly be', () => {
    refusedWith(
      { questions: [mcQuestion({ prompt: text('a'.repeat(MAX_TEXT_LENGTH + 1)) })] },
      expecting([['MultipleChoice', 1]]),
      RICH_TEXT_INVALID,
    );
  });

  it('refuses more options than a multiple-choice question can plausibly carry', () => {
    const choices = Array.from({ length: MAX_CHOICES + 1 }, (_unused, index) => ({
      body: text(`Option ${index}`),
      isCorrect: index === 0,
    }));
    refusedWith(
      { questions: [mcQuestion({ choices })] },
      expecting([['MultipleChoice', 1]]),
      PAYLOAD_TOO_LARGE,
    );
  });

  it('refuses more topics than a question can plausibly carry', () => {
    const topics = Array.from({ length: MAX_TOPICS + 1 }, (_unused, index) => `Topic ${index}`);
    refusedWith(
      { questions: [mcQuestion({ topics })] },
      expecting([['MultipleChoice', 1]]),
      PAYLOAD_TOO_LARGE,
    );
  });

  it('refuses a topic label longer than a label can plausibly be', () => {
    // Every element of every array becomes a row, and a label is a column.
    refusedWith(
      { questions: [mcQuestion({ topics: ['t'.repeat(MAX_LABEL_LENGTH + 1)] })] },
      expecting([['MultipleChoice', 1]]),
      TOPIC_LABEL_TOO_LONG,
    );
    expect(() =>
      validateGenerationPayload(
        { questions: [mcQuestion({ topics: ['t'.repeat(MAX_LABEL_LENGTH)] })] },
        expecting([['MultipleChoice', 1]]),
      ),
    ).not.toThrow();
  });
});

describe('a payload that satisfies every rule', () => {
  it('comes back normalized, with ordinals minted here', () => {
    const result = validateGenerationPayload(
      { questions: [mcQuestion(), shortAnswer()] },
      expecting([
        ['MultipleChoice', 1],
        ['ShortAnswer', 1],
      ]),
    );
    expect(result.questions.map((question) => question.ordinal)).toEqual([1, 2]);
    expect(result.questions[0]!.choices.map((choice) => choice.ordinal)).toEqual([1, 2, 3]);
    // The answer lives on the flagged option for MultipleChoice, and in the
    // field for everything else. Never both.
    expect(result.questions[0]!.answer).toBeNull();
    expect(result.questions[1]!.answer).not.toBeNull();
    expect(result.questions[1]!.choices).toHaveLength(0);
  });
});

describe('shape', () => {
  it('refuses a payload the schema does not admit', () => {
    refusedWith({ unparseable: true }, expecting([['MultipleChoice', 1]]), PAYLOAD_SHAPE_INVALID);
  });

  it('refuses a text field that is not a rich-text segment array', () => {
    // A plain string is the shape a model reaches for, and the one thing
    // AD-32 exists to refuse: a fraction inside it is unrecoverable.
    refusedWith(
      { questions: [mcQuestion({ prompt: 'What is two plus two?' })] },
      expecting([['MultipleChoice', 1]]),
      PAYLOAD_SHAPE_INVALID,
    );
  });

  it('refuses a rich-text field with nothing in it', () => {
    refusedWith(
      { questions: [mcQuestion({ prompt: [{ kind: 'text', value: '   ' }] })] },
      expecting([['MultipleChoice', 1]]),
      RICH_TEXT_INVALID,
    );
  });
});

describe('what was asked for', () => {
  it('refuses a draft holding the wrong number of questions', () => {
    refusedWith(
      { questions: [mcQuestion()] },
      expecting([['MultipleChoice', 2]]),
      QUESTION_COUNT_MISMATCH,
    );
  });

  it('refuses a draft whose format mix is not the computed one', () => {
    // The right total, the wrong mix. Without this the acceptance criterion
    // about the format mix would be a rule nothing enforces.
    refusedWith(
      { questions: [mcQuestion(), mcQuestion({ prompt: text('What is three plus three?') })] },
      expecting([
        ['MultipleChoice', 1],
        ['ShortAnswer', 1],
      ]),
      FORMAT_MIX_MISMATCH,
    );
  });
});

describe('multiple choice', () => {
  it('refuses a question whose correct answer is not among its own options', () => {
    // The canonical malformed case the epic names, expressed as the rule it
    // actually is: nothing flagged means nothing to grade against.
    refusedWith(
      {
        questions: [
          mcQuestion({
            choices: [
              { body: text('Four'), isCorrect: false },
              { body: text('Five'), isCorrect: false },
              { body: text('Six'), isCorrect: false },
            ],
          }),
        ],
      },
      expecting([['MultipleChoice', 1]]),
      ONE_CORRECT_CHOICE_REQUIRED,
    );
  });

  it('refuses a question with two correct options', () => {
    refusedWith(
      {
        questions: [
          mcQuestion({
            choices: [
              { body: text('Four'), isCorrect: true },
              { body: text('Five'), isCorrect: true },
              { body: text('Six'), isCorrect: false },
            ],
          }),
        ],
      },
      expecting([['MultipleChoice', 1]]),
      ONE_CORRECT_CHOICE_REQUIRED,
    );
  });

  it('refuses fewer than three options', () => {
    refusedWith(
      {
        questions: [
          mcQuestion({
            choices: [
              { body: text('Four'), isCorrect: true },
              { body: text('Five'), isCorrect: false },
            ],
          }),
        ],
      },
      expecting([['MultipleChoice', 1]]),
      CHOICES_REQUIRED,
    );
  });

  it('refuses a question that repeats one of its own options', () => {
    refusedWith(
      {
        questions: [
          mcQuestion({
            choices: [
              { body: text('Four'), isCorrect: true },
              { body: text('four'), isCorrect: false },
              { body: text('Six'), isCorrect: false },
            ],
          }),
        ],
      },
      expecting([['MultipleChoice', 1]]),
      CHOICES_NOT_DISTINCT,
    );
  });

  it('refuses an answer stated twice', () => {
    refusedWith(
      { questions: [mcQuestion({ answer: text('Four') })] },
      expecting([['MultipleChoice', 1]]),
      ANSWER_FORBIDDEN,
    );
  });
});

describe('the other formats', () => {
  it('refuses options on a question that has none', () => {
    refusedWith(
      { questions: [shortAnswer({ choices: [{ body: text('Four'), isCorrect: true }] })] },
      expecting([['ShortAnswer', 1]]),
      CHOICES_FORBIDDEN,
    );
  });

  it('refuses a question that never states its answer', () => {
    refusedWith(
      { questions: [shortAnswer({ answer: null })] },
      expecting([['ShortAnswer', 1]]),
      ANSWER_REQUIRED,
    );
  });
});

describe('topics', () => {
  it('refuses a question carrying none', () => {
    refusedWith(
      { questions: [mcQuestion({ topics: [] })] },
      expecting([['MultipleChoice', 1]]),
      TOPIC_REQUIRED,
    );
  });

  it('refuses a topic that is only whitespace', () => {
    refusedWith(
      { questions: [mcQuestion({ topics: ['  '] })] },
      expecting([['MultipleChoice', 1]]),
      TOPIC_REQUIRED,
    );
  });
});

describe('material difference', () => {
  it('refuses a prompt that normalizes to nothing', () => {
    refusedWith(
      { questions: [mcQuestion({ prompt: text('   !!  ') })] },
      expecting([['MultipleChoice', 1]]),
      PROMPT_EMPTY,
    );
  });

  it('refuses a choice body that normalizes to nothing', () => {
    refusedWith(
      {
        questions: [
          mcQuestion({
            choices: [
              { body: text('   !!  '), isCorrect: true },
              { body: text('Five'), isCorrect: false },
              { body: text('Six'), isCorrect: false },
            ],
          }),
        ],
      },
      expecting([['MultipleChoice', 1]]),
      CHOICE_BODY_EMPTY,
    );
  });

  it('refuses a prompt that reproduces a source question after normalization', () => {
    // The verbatim-copy row of the matrix: caught post-hoc, not trusted
    // because it parsed. An upstream fault, so the call retries.
    refusedWith(
      { questions: [mcQuestion()] },
      expecting([['MultipleChoice', 1]], ['What is  TWO plus two!!']),
      PROMPT_NOT_NEW,
    );
  });

  it('refuses a draft that repeats itself', () => {
    refusedWith(
      { questions: [mcQuestion(), mcQuestion()] },
      expecting([['MultipleChoice', 2]]),
      PROMPT_NOT_NEW,
    );
  });

  it('accepts a prompt that is genuinely new', () => {
    expect(() =>
      validateGenerationPayload(
        { questions: [mcQuestion()] },
        expecting([['MultipleChoice', 1]], ['What is nine minus three?']),
      ),
    ).not.toThrow();
  });
});

describe('weighted topic floor', () => {
  /** N ShortAnswer questions, each with its own prompt and its own topic. */
  function draft(topics: string[]) {
    return {
      questions: topics.map((topic, index) =>
        shortAnswer({
          prompt: text(`Question number ${index + 1} about something.`),
          topics: [topic],
        }),
      ),
    };
  }

  function weighted(total: number, topic: string) {
    return {
      targets: new Map<QuestionFormat, number>([['ShortAnswer', total]]),
      forbiddenPrompts: new Set<string>(),
      weighting: weightingFor(topic, total),
    };
  }

  it('accepts a draft that carries the floor exactly', () => {
    const floor = weightedTopicFloor(5);
    const topics = [
      ...Array.from({ length: floor }, () => 'Fractions'),
      ...Array.from({ length: 5 - floor }, () => 'Decimals'),
    ];
    const result = validateGenerationPayload(draft(topics), weighted(5, 'Fractions'));
    expect(result.questions).toHaveLength(5);
  });

  it('refuses a draft one question below the floor', () => {
    // The whole point of the post-hoc pass: a model told to concentrate still
    // sometimes spreads evenly, and only a check in code makes the rule true.
    const floor = weightedTopicFloor(5);
    const topics = [
      ...Array.from({ length: floor - 1 }, () => 'Fractions'),
      ...Array.from({ length: 5 - floor + 1 }, () => 'Decimals'),
    ];
    refusedWith(draft(topics), weighted(5, 'Fractions'), WEIGHTED_TOPIC_UNDERWEIGHT);
  });

  it('counts a label that drifted in case or spacing', () => {
    // The model was asked to write the topic in the words it was given and
    // wrote them with different whitespace. That is the same topic, and
    // spending another provider call over it would buy nothing.
    const floor = weightedTopicFloor(3);
    const topics = [
      ...Array.from({ length: floor }, () => '  fractions '),
      ...Array.from({ length: 3 - floor }, () => 'Decimals'),
    ];
    const result = validateGenerationPayload(draft(topics), weighted(3, 'Fractions'));
    expect(result.questions).toHaveLength(3);
    // Stored raw, as written. Canonicalization is Epic 7's (AD-11).
    expect(result.questions[0]!.topics).toEqual(['fractions']);
  });

  it('does not count a different topic that merely contains the weighted one', () => {
    // Normalization is case and whitespace, never substring matching: "Adding
    // fractions" is its own topic and a draft made entirely of it did not do
    // what was asked.
    refusedWith(
      draft(['Adding fractions', 'Adding fractions', 'Adding fractions']),
      weighted(3, 'Fractions'),
      WEIGHTED_TOPIC_UNDERWEIGHT,
    );
  });

  it('counts a question that carries the weighted topic among several', () => {
    const floor = weightedTopicFloor(2);
    const questions = [
      shortAnswer({ prompt: text('One about something.'), topics: ['Decimals', 'Fractions'] }),
      shortAnswer({ prompt: text('Two about something.'), topics: ['Fractions'] }),
    ];
    const result = validateGenerationPayload({ questions }, weighted(2, 'Fractions'));
    expect(result.questions).toHaveLength(2);
    expect(floor).toBeLessThanOrEqual(2);
  });

  it('is trivially met by a single-topic extraction weighted on its one topic', () => {
    // An Extraction carrying exactly one Topic: weighting on it leaves the
    // model nothing else to write about, every question lands on it, and the
    // floor is met by a margin rather than by luck. The rule must accept that
    // draft rather than trip on a payload with no other topic to spread into.
    const only = 'Fractions';
    const payload = draft([only, only, only, only]);
    const result = validateGenerationPayload(payload, weighted(4, only));

    expect(result.questions).toHaveLength(4);
    expect(new Set(result.questions.flatMap((question) => question.topics))).toEqual(
      new Set([only]),
    );
    // Every question on it, which is at or above the floor by construction.
    expect(result.questions.length).toBeGreaterThanOrEqual(weightedTopicFloor(4));
  });

  it('is not applied at all to an unweighted request', () => {
    // Story 4.1's requests must pass exactly the checks they passed before:
    // the same payload that fails a weighting passes without one.
    const spread = draft(['Decimals', 'Decimals', 'Decimals']);
    refusedWith(spread, weighted(3, 'Fractions'), WEIGHTED_TOPIC_UNDERWEIGHT);
    expect(
      validateGenerationPayload(spread, expecting([['ShortAnswer', 3]])).questions,
    ).toHaveLength(3);
  });

  it('refuses a weighted draft that carries the topic nowhere at all', () => {
    refusedWith(
      draft(['Decimals', 'Decimals', 'Decimals']),
      weighted(3, 'Fractions'),
      WEIGHTED_TOPIC_UNDERWEIGHT,
    );
  });
});

describe('a figure on the generation wire', () => {
  /** The expectation, with the source's own drawings named as copies to refuse. */
  const forbidding = (figures: string[]): ReturnType<typeof expecting> => ({
    ...expecting([['MultipleChoice', 1]]),
    forbiddenFigures: new Set(figures),
  });

  const figure = (svg: string, alt: string) => [{ kind: 'figure', svg, alt }];

  it('stores a prompt figure sanitized, never the markup it was handed', () => {
    const result = validateGenerationPayload(
      {
        questions: [
          mcQuestion({
            prompt: [{ kind: 'text', value: 'Which shape? ' }, ...figure(FIGURE_RAW, ' A circle ')],
          }),
        ],
      },
      expecting([['MultipleChoice', 1]]),
    );
    expect(result.questions[0]!.prompt[1]).toEqual({
      kind: 'figure',
      svg: FIGURE_SANITIZED,
      alt: 'A circle',
    });
  });

  it('stores a figure in an option body the same way', () => {
    const result = validateGenerationPayload(
      {
        questions: [
          mcQuestion({
            choices: [
              { body: figure(FIGURE_RAW, 'A circle'), isCorrect: true },
              { body: figure(SANITIZED_FIGURES[1]![0], 'A square'), isCorrect: false },
              { body: text('Neither'), isCorrect: false },
            ],
          }),
        ],
      },
      expecting([['MultipleChoice', 1]]),
    );
    expect(result.questions[0]!.choices[0]!.body[0]).toEqual({
      kind: 'figure',
      svg: FIGURE_SANITIZED,
      alt: 'A circle',
    });
    expect(result.questions[0]!.choices[1]!.body[0]).toMatchObject({
      svg: SANITIZED_FIGURES[1]![1],
    });
  });

  it('is refused by the schema in the answer field, where nothing could grade it', () => {
    // The narrowing that stays: grading compares plain text, so an answer whose
    // only content is a drawing is an answer nothing can be marked against.
    refusedWith(
      {
        questions: [shortAnswer({ answer: figure(FIGURE_SANITIZED, 'A circle') })],
      },
      expecting([['ShortAnswer', 1]]),
      PAYLOAD_SHAPE_INVALID,
    );
  });

  it('refuses every drawing the sanitizer does not admit, as the one content fault', () => {
    for (const malicious of MALICIOUS_FIGURES) {
      refusedWith(
        { questions: [mcQuestion({ prompt: figure(malicious.svg, 'A shape') })] },
        expecting([['MultipleChoice', 1]]),
        // An oversize drawing is reported as the oversize payload it is; every
        // other grammar refusal is the one content fault.
        malicious.reason === 'tooLarge' ? PAYLOAD_TOO_LARGE : RICH_TEXT_INVALID,
      );
    }
  });

  it('refuses more figures in one field than a question can need', () => {
    const many = Array.from({ length: MAX_FIGURES + 1 }, (_unused, index) => ({
      kind: 'figure',
      svg: figureOfCircles(index + 1),
      alt: `Shape ${index}`,
    }));
    refusedWith(
      { questions: [mcQuestion({ prompt: many })] },
      expecting([['MultipleChoice', 1]]),
      PAYLOAD_TOO_LARGE,
    );
  });

  it('refuses a field whose drawings together exceed the byte budget', () => {
    // Each figure is under its own cap; together they are over the field's.
    const half = oversizeFigure(3_000);
    expect(figureSvgByteLength(half)).toBeLessThan(MAX_FIGURE_SVG_BYTES);
    const pair = [
      { kind: 'figure', svg: half, alt: 'One' },
      { kind: 'figure', svg: oversizeFigure(3_100), alt: 'Two' },
      { kind: 'figure', svg: oversizeFigure(3_200), alt: 'Three' },
    ];
    expect(
      pair.reduce((sum, segment) => sum + figureSvgByteLength(segment.svg), 0),
    ).toBeGreaterThan(MAX_FIGURE_BYTES);
    refusedWith(
      { questions: [mcQuestion({ prompt: pair })] },
      expecting([['MultipleChoice', 1]]),
      PAYLOAD_TOO_LARGE,
    );
  });

  it('refuses one figure larger than a drawn shape can plausibly be', () => {
    refusedWith(
      { questions: [mcQuestion({ prompt: figure(oversizeFigure(5_000), 'A shape') })] },
      expecting([['MultipleChoice', 1]]),
      PAYLOAD_TOO_LARGE,
    );
  });

  it('refuses a text alternative longer than a field of text may be', () => {
    refusedWith(
      {
        questions: [
          mcQuestion({ prompt: figure(FIGURE_SANITIZED, 'A'.repeat(MAX_TEXT_LENGTH + 1)) }),
        ],
      },
      expecting([['MultipleChoice', 1]]),
      PAYLOAD_TOO_LARGE,
    );
  });

  it('refuses a figure the source test already draws', () => {
    // The prompt says draw something new; this is what holds the line when the
    // model redraws the source instead. The comparison is on the canonical
    // form, so the raw markup of the same drawing is caught too.
    refusedWith(
      { questions: [mcQuestion({ prompt: figure(FIGURE_RAW, 'A circle') })] },
      forbidding([FIGURE_SANITIZED]),
      FIGURE_NOT_NEW,
    );
  });

  it('refuses a source drawing redrawn in an option body, not only in a prompt', () => {
    // Every field a figure may reach is checked against the same set: a pictured
    // option copied off the source is the same reproduction a copied prompt is.
    refusedWith(
      {
        questions: [
          mcQuestion({
            choices: [
              { body: figure(FIGURE_RAW, 'A circle'), isCorrect: true },
              { body: text('Five'), isCorrect: false },
              { body: text('Six'), isCorrect: false },
            ],
          }),
        ],
      },
      forbidding([FIGURE_SANITIZED]),
      FIGURE_NOT_NEW,
    );
  });

  it('reports a figure that only crosses the per-figure cap once escaped as oversize', () => {
    // The raw-byte check cannot see this: the figure arrives under the cap and
    // grows past it when the sanitizer writes it back canonically. It is still
    // an oversize figure, and must not fall into the generic content fault.
    const quotes = '"'.repeat(4_000);
    const grows = `<svg viewBox="0 0 2 2"><circle cx="1" cy="1" r="1"/><path d='${quotes}'/></svg>`;
    expect(figureSvgByteLength(grows)).toBeLessThan(MAX_FIGURE_SVG_BYTES);
    refusedWith(
      { questions: [mcQuestion({ prompt: figure(grows, 'A quoted path') })] },
      expecting([['MultipleChoice', 1]]),
      PAYLOAD_TOO_LARGE,
    );
  });

  it('refuses a byte budget only sanitizing escapes past, which the raw sum cannot see', () => {
    // Each figure is under the per-figure cap raw and escaped, and the field's
    // *raw* total is under the budget — only the re-sum of the sanitized form
    // crosses it.
    const quotes = '"'.repeat(1_500);
    const inflates = `<svg viewBox="0 0 2 2"><circle cx="1" cy="1" r="1"/><path d='${quotes}'/></svg>`;
    expect(figureSvgByteLength(inflates) * MAX_FIGURES).toBeLessThan(MAX_FIGURE_BYTES);
    refusedWith(
      {
        questions: [
          mcQuestion({
            prompt: Array.from({ length: MAX_FIGURES }, () => ({
              kind: 'figure',
              svg: inflates,
              alt: 'A quoted path',
            })),
          }),
        ],
      },
      expecting([['MultipleChoice', 1]]),
      PAYLOAD_TOO_LARGE,
    );
  });

  it('accepts a figure that is not one of the source drawings', () => {
    expect(() =>
      validateGenerationPayload(
        { questions: [mcQuestion({ prompt: figure(figureOfCircles(3), 'Three circles') })] },
        forbidding([FIGURE_SANITIZED]),
      ),
    ).not.toThrow();
  });

  it('refuses two pictured options whose alternatives read alike', () => {
    // Distinctness is computed on the plain projection, where a figure reads as
    // `[Figure: <alt>]` — so two drawings described the same way are one option
    // said twice, to a screen reader and to the marking alike.
    refusedWith(
      {
        questions: [
          mcQuestion({
            choices: [
              { body: figure(figureOfCircles(1), 'A shape'), isCorrect: true },
              { body: figure(figureOfCircles(2), 'A shape'), isCorrect: false },
              { body: text('Neither'), isCorrect: false },
            ],
          }),
        ],
      },
      expecting([['MultipleChoice', 1]]),
      CHOICES_NOT_DISTINCT,
    );
  });

  it('takes text and fractions, which is everything a narrowed field may be', () => {
    const parsed = PracticeTestPayload.safeParse({
      questions: [
        {
          format: 'ShortAnswer',
          prompt: [
            { kind: 'text', value: 'Half of six is ' },
            { kind: 'fraction', whole: null, numerator: 6, denominator: 2 },
          ],
          choices: [],
          answer: text('Three'),
          topics: ['Fractions'],
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });
});

describe('an edited question', () => {
  /** The same helper as above, typed, so an override is checked rather than cast. */
  const seg = (value: string): RichText => [{ kind: 'text', value }];

  /** One Multiple Choice question as an edit would leave it. */
  function edited(overrides: Partial<EditedQuestion> = {}): EditedQuestion {
    return {
      format: 'MultipleChoice' as QuestionFormat,
      prompt: seg('What is two plus two?'),
      answer: null,
      choices: [
        { ordinal: 1, body: seg('Four'), isCorrect: true },
        { ordinal: 2, body: seg('Five'), isCorrect: false },
        { ordinal: 3, body: seg('Six'), isCorrect: false },
      ],
      ...overrides,
    } as EditedQuestion;
  }

  const ORDINALS = [1, 2, 3];

  it('takes an edit that leaves the invariants intact', () => {
    expect(() => validateEditedQuestion(edited(), ORDINALS)).not.toThrow();
  });

  it('stores the sanitized figure, never the one it was handed', () => {
    // The edit path takes a `RichText` directly rather than through the wire
    // schema, so a figure is reachable here whatever the generation schema
    // admits — and the value written is the one this returns.
    const prompt: RichText = [
      { kind: 'text', value: 'What shape? ' },
      { kind: 'figure', svg: FIGURE_RAW, alt: '  A circle  ' },
    ];
    const stored = validateEditedQuestion(edited({ prompt }), ORDINALS);
    expect(stored.prompt).toEqual([
      { kind: 'text', value: 'What shape? ' },
      { kind: 'figure', svg: FIGURE_SANITIZED, alt: 'A circle' },
    ]);
  });

  it('keeps a stored figure byte-identical when the text around it is edited', () => {
    // What the inverse grafted back, carried through the invariants untouched:
    // an edit cannot introduce a figure, and it must not alter one either.
    const kept = { kind: 'figure' as const, svg: FIGURE_SANITIZED, alt: 'A circle' };
    const stored = validateEditedQuestion(
      edited({ prompt: [{ kind: 'text', value: 'Which shape? ' }, kept] }),
      ORDINALS,
    );
    expect(stored.prompt[1]).toEqual(kept);
  });

  it('holds an edited field to the same figure ceilings a generated one', () => {
    const many: RichText = Array.from({ length: MAX_FIGURES + 1 }, (_unused, index) => ({
      kind: 'figure' as const,
      svg: figureOfCircles(index + 1),
      alt: `Shape ${index}`,
    }));
    expect(() => validateEditedQuestion(edited({ prompt: many }), ORDINALS)).toThrow(
      PAYLOAD_TOO_LARGE,
    );
    expect(() =>
      validateEditedQuestion(
        edited({ prompt: [{ kind: 'figure', svg: oversizeFigure(5_000), alt: 'A shape' }] }),
        ORDINALS,
      ),
    ).toThrow(PAYLOAD_TOO_LARGE);
  });

  it('sanitizes a figure in an option body the same way', () => {
    const choices = [
      {
        ordinal: 1,
        body: [{ kind: 'figure' as const, svg: FIGURE_RAW, alt: 'A circle' }],
        isCorrect: true,
      },
      { ordinal: 2, body: seg('Five'), isCorrect: false },
      { ordinal: 3, body: seg('Six'), isCorrect: false },
    ];
    const stored = validateEditedQuestion(edited({ choices }), ORDINALS);
    expect(stored.choices[0]!.body).toEqual([
      { kind: 'figure', svg: FIGURE_SANITIZED, alt: 'A circle' },
    ]);
  });

  it('refuses an edit whose figure the sanitizer does not admit', () => {
    const prompt: RichText = [
      {
        kind: 'figure',
        svg: '<svg viewBox="0 0 2 2"><script>alert(1)</script><circle cx="1" cy="1" r="1"/></svg>',
        alt: 'A circle',
      },
    ];
    expect(() => validateEditedQuestion(edited({ prompt }), ORDINALS)).toThrow(
      EditedQuestionInvalid,
    );
    expect(() => validateEditedQuestion(edited({ prompt }), ORDINALS)).toThrow(RICH_TEXT_INVALID);
  });

  it('refuses an edit that leaves no option correct', () => {
    expect(() =>
      validateEditedQuestion(
        edited({
          choices: [
            { ordinal: 1, body: seg('Four'), isCorrect: false },
            { ordinal: 2, body: seg('Five'), isCorrect: false },
            { ordinal: 3, body: seg('Six'), isCorrect: false },
          ],
        }),
        ORDINALS,
      ),
    ).toThrow(ONE_CORRECT_CHOICE_REQUIRED);
  });

  it('refuses an edit that leaves two options correct', () => {
    expect(() =>
      validateEditedQuestion(
        edited({
          choices: [
            { ordinal: 1, body: seg('Four'), isCorrect: true },
            { ordinal: 2, body: seg('Five'), isCorrect: true },
            { ordinal: 3, body: seg('Six'), isCorrect: false },
          ],
        }),
        ORDINALS,
      ),
    ).toThrow(ONE_CORRECT_CHOICE_REQUIRED);
  });

  it('refuses a free-text answer on a Multiple Choice question', () => {
    // The flagged option is the answer. A second copy of it can disagree, and
    // nothing decides which wins.
    expect(() => validateEditedQuestion(edited({ answer: seg('Four') }), ORDINALS)).toThrow(
      ANSWER_FORBIDDEN,
    );
  });

  it('refuses options on a question that has none', () => {
    expect(() =>
      validateEditedQuestion(
        edited({ format: 'FillInTheBlank' as QuestionFormat, answer: seg('four') }),
        ORDINALS,
      ),
    ).toThrow(CHOICES_FORBIDDEN);
  });

  it('requires a free-text answer where there are no options', () => {
    expect(() =>
      validateEditedQuestion(
        edited({ format: 'ShortAnswer' as QuestionFormat, answer: null, choices: [] }),
        [],
      ),
    ).toThrow(ANSWER_REQUIRED);
  });

  it('refuses an edit that does not restate exactly the stored options', () => {
    // No option is added and none is removed by this story: a partial
    // restatement would silently leave an option a parent believed replaced.
    expect(() => validateEditedQuestion(edited(), [1, 2, 3, 4])).toThrow(CHOICES_MISMATCHED);
  });

  it('refuses an empty prompt, an empty option body and a repeated one', () => {
    // Whitespace alone is a field claimed and not filled, and it is refused by
    // the rich-text rule before the prompt rule is ever reached.
    expect(() => validateEditedQuestion(edited({ prompt: seg('   ') }), ORDINALS)).toThrow(
      RICH_TEXT_INVALID,
    );
    // A prompt that is nothing but punctuation survives the rich-text rule and
    // is caught by the one that asks whether anything was actually asked.
    expect(() => validateEditedQuestion(edited({ prompt: seg('...') }), ORDINALS)).toThrow(
      PROMPT_EMPTY,
    );
    expect(() =>
      validateEditedQuestion(
        edited({
          choices: [
            { ordinal: 1, body: seg('Four'), isCorrect: true },
            { ordinal: 2, body: seg('...'), isCorrect: false },
            { ordinal: 3, body: seg('Six'), isCorrect: false },
          ],
        }),
        ORDINALS,
      ),
    ).toThrow(CHOICE_BODY_EMPTY);
    expect(() =>
      validateEditedQuestion(
        edited({
          choices: [
            { ordinal: 1, body: seg('Four'), isCorrect: true },
            { ordinal: 2, body: seg('Four'), isCorrect: false },
            { ordinal: 3, body: seg('Six'), isCorrect: false },
          ],
        }),
        ORDINALS,
      ),
    ).toThrow(CHOICES_NOT_DISTINCT);
  });

  it('refuses a field beyond this module own ceilings', () => {
    expect(() =>
      validateEditedQuestion(edited({ prompt: seg('x'.repeat(MAX_TEXT_LENGTH + 1)) }), ORDINALS),
    ).toThrow(RICH_TEXT_INVALID);
  });

  it('is its own fault class, so nothing retries a parent typing', () => {
    // A generated payload's rejection is the provider's fault and is re-issued;
    // an edit is not made better by asking for it again.
    let thrown: unknown;
    try {
      validateEditedQuestion(edited({ answer: seg('Four') }), ORDINALS);
    } catch (cause) {
      thrown = cause;
    }
    expect(thrown).toBeInstanceOf(EditedQuestionInvalid);
    expect(thrown).not.toBeInstanceOf(GenerationPayloadInvalid);
  });

  it('carries no question text, option body or topic label in any refusal', () => {
    // Identifiers and fixed sentences only (AD-20).
    for (const sentence of [
      CHOICES_MISMATCHED,
      ONE_CORRECT_CHOICE_REQUIRED,
      ANSWER_FORBIDDEN,
      ANSWER_REQUIRED,
      CHOICES_FORBIDDEN,
      CHOICE_BODY_EMPTY,
    ]) {
      expect(sentence).not.toMatch(/gpt|Allowance|Free|Fractions/iu);
    }
  });
});
