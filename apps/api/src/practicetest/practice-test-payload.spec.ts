import { describe, expect, it } from 'vitest';
import type { QuestionFormat } from '../generated/prisma/enums.js';
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
  RICH_TEXT_INVALID,
  TOPIC_LABEL_TOO_LONG,
  TOPIC_REQUIRED,
  WEIGHTED_TOPIC_UNDERWEIGHT,
  normalizePrompt,
  validateGenerationPayload,
} from './practice-test-payload.js';
import { weightedTopicFloor, weightingFor } from './practice-test-policy.js';

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
