import { describe, expect, it } from 'vitest';
import { AiCallClass } from '../generated/prisma/enums.js';
import {
  AI_CALL_CLASSES,
  DEFAULT_AI_TIMEOUT_MS,
  DEFAULT_EMBEDDING_PIN,
  DEFAULT_MODEL_PINS,
  costMicrosFor,
  envSuffixFor,
  fakeFailureFrom,
  resolveAiConfig,
} from './ai-config.js';

describe('transport resolution', () => {
  it('defaults to the fake transport', () => {
    expect(resolveAiConfig({}).transport).toBe('fake');
  });

  it('refuses to default to the fake in production', () => {
    expect(() => resolveAiConfig({ NODE_ENV: 'production' })).toThrow(
      /AI_TRANSPORT must be set explicitly/,
    );
    // Stated explicitly, `fake` stays an operator's choice.
    expect(resolveAiConfig({ NODE_ENV: 'production', AI_TRANSPORT: 'fake' }).transport).toBe(
      'fake',
    );
  });

  it('refuses an unknown transport rather than defaulting', () => {
    expect(() => resolveAiConfig({ AI_TRANSPORT: 'anthropic' })).toThrow(
      /AI_TRANSPORT must be one of fake, openai/,
    );
  });

  it('refuses the openai transport without a key', () => {
    expect(() => resolveAiConfig({ AI_TRANSPORT: 'openai' })).toThrow(/requires OPENAI_API_KEY/);
    expect(resolveAiConfig({ AI_TRANSPORT: 'openai', OPENAI_API_KEY: 'sk-test' })).toMatchObject({
      transport: 'openai',
      apiKey: 'sk-test',
    });
  });

  it('carries no key on the fake transport, whatever the environment holds', () => {
    expect(resolveAiConfig({ OPENAI_API_KEY: 'sk-test' }).apiKey).toBeUndefined();
  });
});

describe('durations and attempt counts', () => {
  it('defaults the vision timeout to three minutes', () => {
    expect(resolveAiConfig({}).timeoutMs).toBe(DEFAULT_AI_TIMEOUT_MS);
    expect(DEFAULT_AI_TIMEOUT_MS).toBe(180_000);
  });

  it('takes a stated timeout', () => {
    expect(resolveAiConfig({ AI_TIMEOUT_MS: '45000' }).timeoutMs).toBe(45_000);
  });

  it.each([
    ['not-a-number', /AI_TIMEOUT_MS must be a positive whole number/],
    // Zero aborts every call before it starts; negative is not a duration.
    ['0', /AI_TIMEOUT_MS must be a positive whole number/],
    ['-1', /AI_TIMEOUT_MS must be a positive whole number/],
  ])('refuses a timeout of "%s"', (value, message) => {
    expect(() => resolveAiConfig({ AI_TIMEOUT_MS: value })).toThrow(message);
  });

  it('refuses zero attempts, which would fail every job', () => {
    expect(() => resolveAiConfig({ AI_MAX_ATTEMPTS: '0' })).toThrow(
      /AI_MAX_ATTEMPTS must be a positive whole number/,
    );
  });

  it('refuses a non-numeric backoff', () => {
    expect(() => resolveAiConfig({ AI_RETRY_BASE_MS: 'soon' })).toThrow(
      /AI_RETRY_BASE_MS must be a positive whole number/,
    );
  });
});

describe('model pins', () => {
  it('seeds every call class from the AD-8 aliases', () => {
    const { pins } = resolveAiConfig({});
    expect(pins.Extraction.model).toBe('gpt-5.6-sol');
    expect(pins).toEqual(DEFAULT_MODEL_PINS);
  });

  it('takes an env-stated snapshot and price for one class alone', () => {
    const { pins } = resolveAiConfig({
      AI_MODEL_EXTRACTION: 'gpt-5.6-sol-2026-05-01',
      AI_PRICE_EXTRACTION_IN: '2000000',
      AI_PRICE_EXTRACTION_OUT: '8000000',
    });
    expect(pins.Extraction).toEqual({
      model: 'gpt-5.6-sol-2026-05-01',
      inputMicrosPerMillion: 2_000_000,
      outputMicrosPerMillion: 8_000_000,
    });
    // And nothing else moved.
    expect(pins.Legibility).toEqual(DEFAULT_MODEL_PINS.Legibility);
  });

  it('names a multi-word call class with one underscore', () => {
    expect(envSuffixFor('TopicNormalization')).toBe('TOPIC_NORMALIZATION');
    expect(envSuffixFor('Extraction')).toBe('EXTRACTION');
  });

  it('refuses a price that is not a positive whole number', () => {
    expect(() => resolveAiConfig({ AI_PRICE_EXTRACTION_IN: '1.5' })).toThrow(
      /AI_PRICE_EXTRACTION_IN must be a positive whole number/,
    );
  });
});

describe('the call classes', () => {
  it("are exactly the ones the cost row's column admits", () => {
    // The list is declared twice — once as a const tuple here, once as a Prisma
    // enum — and the second is what the database will accept. A class added to
    // one and not the other is a write that fails at the moment a real parent
    // makes the call it was added for.
    expect([...AI_CALL_CLASSES].sort()).toEqual(Object.values(AiCallClass).sort());
  });

  it('each carry a pin', () => {
    for (const callClass of AI_CALL_CLASSES) {
      expect(DEFAULT_MODEL_PINS[callClass].model).not.toBe('');
    }
  });
});

describe('cost arithmetic', () => {
  const pin = { model: 'm', inputMicrosPerMillion: 1_250_000, outputMicrosPerMillion: 10_000_000 };

  it('charges input and output at their own rates', () => {
    // A whole million of each: the rates themselves.
    expect(costMicrosFor(pin, 1_000_000, 0)).toBe(1_250_000);
    expect(costMicrosFor(pin, 0, 1_000_000)).toBe(10_000_000);
    expect(costMicrosFor(pin, 1_000_000, 1_000_000)).toBe(11_250_000);
  });

  it('is zero for a call that spent nothing', () => {
    expect(costMicrosFor(pin, 0, 0)).toBe(0);
  });

  it('rounds the sum to an integer, not each term', () => {
    // 1 × 1.25 + 1 × 10 = 11.25 micros. Rounding each term first would give
    // 1 + 10 = 11; rounding the sum gives 11 as well, so use a case where the
    // two disagree: 3 input tokens (3.75) and 0 output rounds to 4, while a
    // truncation would give 3.
    expect(costMicrosFor(pin, 3, 0)).toBe(4);
    expect(Number.isInteger(costMicrosFor(pin, 7, 13))).toBe(true);
  });
});

describe('the fake transport failure latch', () => {
  it('defaults to none', () => {
    expect(fakeFailureFrom({})).toBe('none');
    expect(fakeFailureFrom({ AI_FAKE_FAILURE: '' })).toBe('none');
  });

  it.each(['transport', 'schema', 'unusable'] as const)('takes "%s"', (kind) => {
    expect(fakeFailureFrom({ AI_FAKE_FAILURE: kind })).toBe(kind);
  });

  it('refuses an unknown mode rather than treating it as none', () => {
    expect(() => fakeFailureFrom({ AI_FAKE_FAILURE: 'explode' })).toThrow(
      /AI_FAKE_FAILURE must be one of/,
    );
  });
});

describe('the embedding pin', () => {
  it('defaults to DEFAULT_EMBEDDING_PIN on both transports', () => {
    expect(resolveAiConfig({}).embeddingPin).toEqual(DEFAULT_EMBEDDING_PIN);
    expect(
      resolveAiConfig({ AI_TRANSPORT: 'openai', OPENAI_API_KEY: 'sk-test' }).embeddingPin,
    ).toEqual(DEFAULT_EMBEDDING_PIN);
  });

  it('prices no output side, because an embedding returns a vector', () => {
    expect(resolveAiConfig({}).embeddingPin.outputMicrosPerMillion).toBe(0);
  });

  it('is a separate snapshot from the TopicNormalization call class pin', () => {
    // One call class, two models. A cost row records which of the two it paid for,
    // so these must not resolve to the same value by accident.
    const config = resolveAiConfig({});
    expect(config.embeddingPin.model).not.toBe(config.pins.TopicNormalization.model);
  });

  it('honours AI_MODEL_TOPIC_EMBEDDING and AI_PRICE_TOPIC_EMBEDDING_IN', () => {
    const config = resolveAiConfig({
      AI_MODEL_TOPIC_EMBEDDING: 'text-embedding-4-large-2027-01-01',
      AI_PRICE_TOPIC_EMBEDDING_IN: '130000',
    });
    expect(config.embeddingPin).toEqual({
      model: 'text-embedding-4-large-2027-01-01',
      inputMicrosPerMillion: 130_000,
      outputMicrosPerMillion: 0,
    });
    // The class pin is untouched by the embedding override, and the reverse.
    expect(config.pins.TopicNormalization.model).toBe(DEFAULT_MODEL_PINS.TopicNormalization.model);
  });

  it('ignores a blank or whitespace model override rather than sending an empty model', () => {
    expect(resolveAiConfig({ AI_MODEL_TOPIC_EMBEDDING: '   ' }).embeddingPin.model).toBe(
      DEFAULT_EMBEDDING_PIN.model,
    );
  });

  it('refuses a non-positive or non-numeric embedding price rather than billing zero', () => {
    // A price of zero is a cost table that says every embedding was free, which is
    // worse than a missing row because nothing about it looks wrong.
    for (const raw of ['0', '-5', 'cheap', '1.5']) {
      expect(() => resolveAiConfig({ AI_PRICE_TOPIC_EMBEDDING_IN: raw })).toThrow(
        /AI_PRICE_TOPIC_EMBEDDING_IN must be a positive whole number/,
      );
    }
  });

  it('does not read an output price variable for the embedding pin', () => {
    // There is deliberately no `_OUT` variable. Setting one must change nothing
    // rather than quietly start pricing an output side that does not exist.
    expect(resolveAiConfig({ AI_PRICE_TOPIC_EMBEDDING_OUT: '999999' }).embeddingPin).toEqual(
      DEFAULT_EMBEDDING_PIN,
    );
  });
});
