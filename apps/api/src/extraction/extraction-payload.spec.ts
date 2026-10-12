import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ALL_PAGES_UNINTERPRETABLE,
  CHOICES_FORBIDDEN,
  CHOICES_REQUIRED,
  CONTEXT_AFTER_QUESTION,
  CONTEXT_IDS_NOT_UNIQUE,
  CONTEXT_RANGE_INVALID,
  CONTEXT_UNRESOLVABLE,
  DEPENDENCY_WITHOUT_REGION,
  ExtractionInputUnusable,
  ExtractionPayloadInvalid,
  MAX_CHOICES,
  MAX_CONTEXTS,
  MAX_QUESTIONS,
  MAX_REGIONS,
  MAX_SEGMENTS,
  MAX_TEXT_LENGTH,
  MAX_TOPICS,
  PAGE_SET_MISMATCH,
  PAYLOAD_SHAPE_INVALID,
  PAYLOAD_TOO_LARGE,
  QUESTION_ON_UNREADABLE_PAGE,
  RICH_TEXT_INVALID,
  TOPIC_REQUIRED,
  UNKNOWN_PAGE_ORDINAL,
  usableFrom,
  validateExtractionPayload,
} from './extraction-payload.js';
import {
  DEFAULT_FAKE_QUESTIONS_PER_PAGE,
  fakeExtractionPayload,
  fakeQuestionsPerPage,
} from './extraction-schema.js';
import { MAX_FIGURE_BYTES, MAX_FIGURES } from './extraction-payload.js';
import type { RichText } from './rich-text.js';
import { MAX_FIGURE_SVG_BYTES, figureSvgByteLength } from './svg-figure.js';

/**
 * Typed as `RichText` rather than as its own literal, so a figure segment is
 * assignable everywhere a text one is and `pnpm typecheck` actually sees a
 * figure inside a payload. A cast here would have hidden the thing the figure
 * cases are about.
 */
const text = (value: string): RichText => [{ kind: 'text', value }];

/** A three-page document that passes every rule, varied one field per test. */
function valid() {
  return {
    pages: [
      { ordinal: 1, interpretable: true },
      { ordinal: 2, interpretable: true },
      { ordinal: 3, interpretable: true },
    ],
    contexts: [
      {
        id: 'ctx',
        kind: 'Passage' as const,
        body: text('A passage.'),
        startPageOrdinal: 1,
        endPageOrdinal: 2,
      },
    ],
    questions: [
      {
        pageOrdinal: 1,
        format: 'MultipleChoice' as const,
        prompt: text('Which one?'),
        choices: [text('A'), text('B')],
        topics: [{ label: 'Fractions', confidence: 'High' as const }],
        confidence: 'High' as const,
        contextId: 'ctx' as string | null,
        dependsOnUninterpretable: false,
      },
      {
        pageOrdinal: 2,
        format: 'ShortAnswer' as const,
        prompt: text('Explain.'),
        choices: [],
        topics: [{ label: 'Comprehension', confidence: 'Medium' as const }],
        confidence: 'Medium' as const,
        contextId: 'ctx' as string | null,
        dependsOnUninterpretable: false,
      },
    ],
    uninterpretable: [{ pageOrdinal: 3, kind: 'Handwriting' as const }],
  };
}

const ORDINALS = [1, 2, 3];

/** The rejection a mutation produced, or a failed expectation. */
function rejectionOf(mutate: (payload: ReturnType<typeof valid>) => void): Error {
  const payload = valid();
  mutate(payload);
  try {
    validateExtractionPayload(payload, ORDINALS);
  } catch (cause) {
    return cause as Error;
  }
  throw new Error('The payload was accepted when it should have been rejected.');
}

describe('a payload that holds', () => {
  it('normalizes into a document with ordinals of its own', () => {
    const document = validateExtractionPayload(valid(), ORDINALS);
    expect(document.pageCount).toBe(3);
    expect(document.contexts.map((context) => context.ordinal)).toEqual([1]);
    expect(document.questions.map((question) => question.ordinal)).toEqual([1, 2]);
    expect(document.regions).toEqual([{ pageOrdinal: 3, kind: 'Handwriting' }]);
  });

  it('resolves a cross-page context to one row, referenced by both questions', () => {
    const document = validateExtractionPayload(valid(), ORDINALS);
    expect(document.contexts).toHaveLength(1);
    expect(document.questions.map((question) => question.contextOrdinal)).toEqual([1, 1]);
    expect(document.contexts[0]).toMatchObject({ startPageOrdinal: 1, endPageOrdinal: 2 });
  });

  it('trims a topic label without canonicalizing it', () => {
    const payload = valid();
    payload.questions[0]!.topics = [{ label: '  Long division  ', confidence: 'High' }];
    const document = validateExtractionPayload(payload, ORDINALS);
    // Raw, as read: Epic 7 canonicalizes, and doing it here would destroy the
    // evidence it works from (AD-11).
    expect(document.questions[0]!.topics[0]!.label).toBe('Long division');
  });

  it("carries the fake transport's own document through unchanged in shape", () => {
    const document = validateExtractionPayload(
      fakeExtractionPayload({ imageCount: 3, failure: 'none' }),
      ORDINALS,
    );
    expect(document.pageCount).toBe(3);
    expect(document.questions.filter((question) => question.usable)).toHaveLength(3);
    expect(document.questions.filter((question) => !question.usable)).toHaveLength(1);
  });
});

describe('usable is computed, never read', () => {
  it('is false for a question that depends on something unreadable', () => {
    expect(usableFrom({ dependsOnUninterpretable: true, confidence: 'High' })).toBe(false);
  });

  it('is false for a question the model is unsure of', () => {
    expect(usableFrom({ dependsOnUninterpretable: false, confidence: 'Low' })).toBe(false);
  });

  it('is true only for a confident, self-contained question', () => {
    expect(usableFrom({ dependsOnUninterpretable: false, confidence: 'Medium' })).toBe(true);
    expect(usableFrom({ dependsOnUninterpretable: false, confidence: 'High' })).toBe(true);
  });

  it('ignores a `usable` field the payload smuggled in', () => {
    const payload = valid() as Record<string, unknown>;
    (payload.questions as Record<string, unknown>[])[0]!.usable = false;
    (payload.questions as Record<string, unknown>[])[0]!.dependsOnUninterpretable = false;
    const document = validateExtractionPayload(payload, ORDINALS);
    expect(document.questions[0]!.usable).toBe(true);
  });

  it('marks exactly the dependent question unusable', () => {
    const payload = valid();
    // The declaration has to name something, so the region moves to the page
    // the question is on.
    payload.uninterpretable = [{ pageOrdinal: 2, kind: 'Handwriting' }];
    payload.questions[1]!.dependsOnUninterpretable = true;
    const document = validateExtractionPayload(payload, ORDINALS);
    expect(document.questions.map((question) => question.usable)).toEqual([true, false]);
  });
});

describe('rejections', () => {
  it("refuses a payload that is not the schema's shape at all", () => {
    const fault = rejectionOf((payload) => {
      (payload as Record<string, unknown>).questions = 'several';
    });
    expect(fault).toBeInstanceOf(ExtractionPayloadInvalid);
    expect(fault.message).toBe(PAYLOAD_SHAPE_INVALID);
  });

  it('refuses a page the model silently dropped', () => {
    expect(rejectionOf((payload) => payload.pages.pop()).message).toBe(PAGE_SET_MISMATCH);
  });

  it('refuses a page the model invented', () => {
    expect(
      rejectionOf((payload) => payload.pages.push({ ordinal: 9, interpretable: true })).message,
    ).toBe(PAGE_SET_MISMATCH);
  });

  it('refuses a duplicated page', () => {
    expect(
      rejectionOf((payload) => {
        payload.pages[2] = { ordinal: 1, interpretable: true };
      }).message,
    ).toBe(PAGE_SET_MISMATCH);
  });

  it('refuses a question on a page that was never sent', () => {
    expect(
      rejectionOf((payload) => {
        payload.questions[0]!.pageOrdinal = 7;
      }).message,
    ).toBe(UNKNOWN_PAGE_ORDINAL);
  });

  it('refuses a region on a page that was never sent', () => {
    expect(
      rejectionOf((payload) => {
        payload.uninterpretable[0]!.pageOrdinal = 7;
      }).message,
    ).toBe(UNKNOWN_PAGE_ORDINAL);
  });

  it('refuses a question carrying no topic', () => {
    expect(
      rejectionOf((payload) => {
        payload.questions[0]!.topics = [];
      }).message,
    ).toBe(TOPIC_REQUIRED);
  });

  it('refuses a topic that is blank, which is the array without the answer', () => {
    expect(
      rejectionOf((payload) => {
        payload.questions[0]!.topics = [{ label: '   ', confidence: 'High' }];
      }).message,
    ).toBe(TOPIC_REQUIRED);
  });

  it('refuses a format that is not one of the three', () => {
    const fault = rejectionOf((payload) => {
      (payload.questions[0] as Record<string, unknown>).format = 'Essay';
    });
    expect(fault.message).toBe(PAYLOAD_SHAPE_INVALID);
  });

  it('refuses more than one format, which the schema admits no shape for', () => {
    const fault = rejectionOf((payload) => {
      (payload.questions[0] as Record<string, unknown>).format = ['MultipleChoice', 'ShortAnswer'];
    });
    expect(fault.message).toBe(PAYLOAD_SHAPE_INVALID);
  });

  it('refuses a multiple-choice question with fewer than two choices', () => {
    expect(
      rejectionOf((payload) => {
        payload.questions[0]!.choices = [text('A')];
      }).message,
    ).toBe(CHOICES_REQUIRED);
  });

  it('refuses choices on a question that is not multiple choice', () => {
    expect(
      rejectionOf((payload) => {
        payload.questions[1]!.choices = [text('A'), text('B')];
      }).message,
    ).toBe(CHOICES_FORBIDDEN);
  });

  it('refuses a context id nothing resolves', () => {
    expect(
      rejectionOf((payload) => {
        payload.questions[0]!.contextId = 'nope';
      }).message,
    ).toBe(CONTEXT_UNRESOLVABLE);
  });

  it('refuses a context that begins after the question referring to it', () => {
    expect(
      rejectionOf((payload) => {
        payload.contexts[0]!.startPageOrdinal = 2;
        payload.contexts[0]!.endPageOrdinal = 3;
      }).message,
    ).toBe(CONTEXT_AFTER_QUESTION);
  });

  it('refuses a context range outside the pages that were sent', () => {
    expect(
      rejectionOf((payload) => {
        payload.contexts[0]!.endPageOrdinal = 9;
      }).message,
    ).toBe(CONTEXT_RANGE_INVALID);
  });

  it('refuses a context range that ends before it starts', () => {
    expect(
      rejectionOf((payload) => {
        payload.contexts[0]!.startPageOrdinal = 3;
        payload.contexts[0]!.endPageOrdinal = 1;
        payload.questions[0]!.contextId = null;
        payload.questions[1]!.contextId = null;
      }).message,
    ).toBe(CONTEXT_RANGE_INVALID);
  });

  it('refuses two contexts sharing one id', () => {
    expect(
      rejectionOf((payload) => {
        payload.contexts.push({ ...payload.contexts[0]! });
      }).message,
    ).toBe(CONTEXT_IDS_NOT_UNIQUE);
  });

  it('refuses a fraction written as a string rather than as structure', () => {
    const fault = rejectionOf((payload) => {
      (payload.questions[0] as Record<string, unknown>).prompt = 'What is 1/2 of 8?';
    });
    // The schema catches it before the rich-text pass does, which is the point:
    // there is no shape in which a plain string reaches storage.
    expect(fault.message).toBe(PAYLOAD_SHAPE_INVALID);
  });

  it('refuses a rich-text field with a zero denominator', () => {
    const fault = rejectionOf((payload) => {
      (payload.questions[0] as Record<string, unknown>).prompt = [
        { kind: 'fraction', numerator: 1, denominator: 0 },
      ];
    });
    expect([PAYLOAD_SHAPE_INVALID, RICH_TEXT_INVALID]).toContain(fault.message);
  });

  it('rejects the whole document rather than the offending question', () => {
    const payload = valid();
    payload.questions[1]!.topics = [];
    expect(() => validateExtractionPayload(payload, ORDINALS)).toThrow(ExtractionPayloadInvalid);
  });
});

describe('a payload that contradicts itself', () => {
  it('refuses a question read off a page it called unreadable', () => {
    expect(
      rejectionOf((payload) => {
        payload.pages[0]!.interpretable = false;
      }).message,
    ).toBe(QUESTION_ON_UNREADABLE_PAGE);
  });

  it('accepts an unreadable page that carries no question', () => {
    const payload = valid();
    // Page 3 holds the region and no question at all.
    payload.pages[2]!.interpretable = false;
    expect(() => validateExtractionPayload(payload, ORDINALS)).not.toThrow();
  });

  it('refuses a declared dependency that names nothing', () => {
    expect(
      rejectionOf((payload) => {
        // Page 1 carries no uninterpretable region, so there is nothing on it
        // for this question to depend on.
        payload.questions[0]!.dependsOnUninterpretable = true;
      }).message,
    ).toBe(DEPENDENCY_WITHOUT_REGION);
  });

  it('accepts a dependency backed by a region on the same page', () => {
    const payload = valid();
    payload.uninterpretable = [{ pageOrdinal: 1, kind: 'Handwriting' }];
    payload.questions[0]!.dependsOnUninterpretable = true;
    const document = validateExtractionPayload(payload, ORDINALS);
    expect(document.questions[0]!.usable).toBe(false);
  });
});

describe('ceilings the wire schema cannot carry', () => {
  it('refuses more questions than a paper test could hold', () => {
    expect(
      rejectionOf((payload) => {
        const one = payload.questions[0]!;
        payload.questions = Array.from({ length: MAX_QUESTIONS + 1 }, () => ({ ...one }));
      }).message,
    ).toBe(PAYLOAD_TOO_LARGE);
  });

  it('refuses more choices than a question could print', () => {
    expect(
      rejectionOf((payload) => {
        payload.questions[0]!.choices = Array.from({ length: MAX_CHOICES + 1 }, () => text('A'));
      }).message,
    ).toBe(PAYLOAD_TOO_LARGE);
  });

  it('refuses more topics than a question could be about', () => {
    expect(
      rejectionOf((payload) => {
        payload.questions[0]!.topics = Array.from({ length: MAX_TOPICS + 1 }, () => ({
          label: 'Fractions',
          confidence: 'High' as const,
        }));
      }).message,
    ).toBe(PAYLOAD_TOO_LARGE);
  });

  it('refuses a text segment longer than a page could hold', () => {
    expect(
      rejectionOf((payload) => {
        payload.questions[0]!.prompt = text('x'.repeat(MAX_TEXT_LENGTH + 1));
      }).message,
    ).toBe(PAYLOAD_TOO_LARGE);
  });

  it('refuses a field made of more segments than anything could need', () => {
    expect(
      rejectionOf((payload) => {
        payload.questions[0]!.prompt = Array.from({ length: MAX_SEGMENTS + 1 }, () => ({
          kind: 'text' as const,
          value: 'x',
        }));
      }).message,
    ).toBe(PAYLOAD_TOO_LARGE);
  });

  it('refuses more contexts than a document could hold', () => {
    expect(
      rejectionOf((payload) => {
        const one = payload.contexts[0]!;
        payload.contexts = Array.from({ length: MAX_CONTEXTS + 1 }, () => ({ ...one }));
      }).message,
    ).toBe(PAYLOAD_TOO_LARGE);
  });

  it('refuses more uninterpretable regions than a document could hold', () => {
    expect(
      rejectionOf((payload) => {
        const one = payload.uninterpretable[0]!;
        payload.uninterpretable = Array.from({ length: MAX_REGIONS + 1 }, () => ({ ...one }));
      }).message,
    ).toBe(PAYLOAD_TOO_LARGE);
  });
});

describe('the one client-fault branch', () => {
  it('is unusable input when no page could be read at all', () => {
    const payload = valid();
    for (const page of payload.pages) page.interpretable = false;
    const fault = (() => {
      try {
        validateExtractionPayload(payload, ORDINALS);
      } catch (cause) {
        return cause as Error;
      }
      throw new Error('accepted');
    })();
    expect(fault).toBeInstanceOf(ExtractionInputUnusable);
    expect(fault).not.toBeInstanceOf(ExtractionPayloadInvalid);
    expect(fault.message).toBe(ALL_PAGES_UNINTERPRETABLE);
  });

  it('is not reached while one page could be read', () => {
    const payload = valid();
    // Pages 1 and 2 unreadable, so their questions go with them; page 3 still
    // reads, so this is not the all-pages branch.
    payload.pages[0]!.interpretable = false;
    payload.pages[1]!.interpretable = false;
    payload.questions = [];
    expect(() => validateExtractionPayload(payload, ORDINALS)).not.toThrow();
  });

  it("is what the fake's unusable mode produces", () => {
    expect(() =>
      validateExtractionPayload(
        fakeExtractionPayload({ imageCount: 3, failure: 'unusable' }),
        ORDINALS,
      ),
    ).toThrow(ExtractionInputUnusable);
  });
});

describe("the fake transport's density knob", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('puts one usable question on each page unless told otherwise', () => {
    // One by default so every assertion written against the fake before the
    // knob existed still holds — and so the fake is thin under the default
    // threshold, which is the case a test should not have to arrange.
    expect(fakeQuestionsPerPage()).toBe(DEFAULT_FAKE_QUESTIONS_PER_PAGE);
    expect(DEFAULT_FAKE_QUESTIONS_PER_PAGE).toBe(1);
    const document = fakeExtractionPayload({ imageCount: 3, failure: 'none' });
    // Three usable, plus the one question that depends on the region.
    expect(document.questions).toHaveLength(4);
  });

  it('emits the stated number on every page', () => {
    vi.stubEnv('AI_FAKE_QUESTIONS_PER_PAGE', '3');
    const document = fakeExtractionPayload({ imageCount: 2, failure: 'none' });
    expect(document.questions).toHaveLength(7);
    for (const ordinal of [1, 2]) {
      expect(
        document.questions.filter(
          (question) => question.pageOrdinal === ordinal && !question.dependsOnUninterpretable,
        ),
      ).toHaveLength(3);
    }
  });

  it('refuses a zero, which would emit a document with no questions at all', () => {
    vi.stubEnv('AI_FAKE_QUESTIONS_PER_PAGE', '0');
    expect(() => fakeExtractionPayload({ imageCount: 2, failure: 'none' })).toThrow(
      /AI_FAKE_QUESTIONS_PER_PAGE must be a positive whole number/,
    );
  });

  it('refuses a value that is not a number at all', () => {
    vi.stubEnv('AI_FAKE_QUESTIONS_PER_PAGE', 'abc');
    expect(() => fakeExtractionPayload({ imageCount: 2, failure: 'none' })).toThrow(
      /AI_FAKE_QUESTIONS_PER_PAGE must be a positive whole number/,
    );
  });
});

describe('a figure inside a rich-text field', () => {
  const RAW =
    '<svg viewBox="0 0 10 10" width="200" height="200"><circle cx="5" cy="5" r="4" fill="#ff0000" stroke="black"/></svg>';
  const SANITIZED =
    '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="currentColor" stroke="currentColor"/></svg>';
  const figure = (svg: string, alt: string): RichText => [{ kind: 'figure', svg, alt }];

  it('stores the sanitized SVG, never the one the model wrote', () => {
    // The whole reason the three storage sites switched from guard-then-store
    // to store-what-the-parse-returns: a guard would have persisted `RAW`.
    const payload = valid();
    payload.questions[0]!.prompt = figure(RAW, 'A circle');
    const document = validateExtractionPayload(payload, ORDINALS);
    expect(document.questions[0]!.prompt).toEqual([
      { kind: 'figure', svg: SANITIZED, alt: 'A circle' },
    ]);
  });

  it('leaves a question carrying a figure usable', () => {
    const payload = valid();
    payload.questions[0]!.prompt = figure(RAW, 'A circle');
    expect(validateExtractionPayload(payload, ORDINALS).questions[0]!.usable).toBe(true);
  });

  it('sanitizes a figure in a choice and in a context body the same way', () => {
    const payload = valid();
    payload.questions[0]!.choices = [figure(RAW, 'A circle'), text('B')];
    payload.contexts[0]!.body = figure(RAW, 'A number line');
    const document = validateExtractionPayload(payload, ORDINALS);
    expect(document.questions[0]!.choices[0]).toEqual([
      { kind: 'figure', svg: SANITIZED, alt: 'A circle' },
    ]);
    expect(document.contexts[0]!.body).toEqual([
      { kind: 'figure', svg: SANITIZED, alt: 'A number line' },
    ]);
  });

  it('rejects the whole payload when a figure is outside the sanitizer grammar', () => {
    const hostile =
      '<svg viewBox="0 0 1 1"><script>alert(1)</script><circle cx="1" cy="1" r="1"/></svg>';
    for (const mutate of [
      (payload: ReturnType<typeof valid>) => {
        payload.questions[0]!.prompt = figure(hostile, 'A circle');
      },
      (payload: ReturnType<typeof valid>) => {
        payload.questions[0]!.choices = [figure(hostile, 'A circle'), text('B')];
      },
      (payload: ReturnType<typeof valid>) => {
        payload.contexts[0]!.body = figure(hostile, 'A circle');
      },
    ]) {
      const fault = rejectionOf(mutate);
      // One rejection reason and no new failure kind: a figure fault routes as
      // an `UpstreamFault` exactly like every other post-hoc rejection (AD-30).
      expect(fault).toBeInstanceOf(ExtractionPayloadInvalid);
      expect(fault.message).toBe(RICH_TEXT_INVALID);
    }
  });

  it('rejects a blank text alternative as a content fault', () => {
    expect(
      rejectionOf((payload) => {
        payload.questions[0]!.prompt = figure(RAW, '   ');
      }).message,
    ).toBe(RICH_TEXT_INVALID);
  });

  it('refuses an SVG larger than a drawn shape can plausibly be', () => {
    const padded = `<svg viewBox="0 0 2 2"><path d="${'M0 0'.repeat(MAX_FIGURE_SVG_BYTES)}"/></svg>`;
    expect(
      rejectionOf((payload) => {
        payload.questions[0]!.prompt = figure(padded, 'A long path');
      }).message,
      // The ceiling is judged on what arrived, so the honest reason survives
      // rather than the sanitizer's own byte cap reporting a content fault.
    ).toBe(PAYLOAD_TOO_LARGE);
  });

  it('reports an oversize figure the same way whether the cap is seen on input or on escaping', () => {
    // The ceiling above is judged on what arrived. But a figure whose raw
    // bytes are under the cap can still grow past it once the sanitizer
    // escapes it for storage — that case is caught deeper, inside
    // `parseRichText`, and must still read as the same oversize-figure fault
    // rather than falling into the generic content-fault catch-all.
    const quotes = '"'.repeat(4_000);
    const grows = `<svg viewBox="0 0 2 2"><circle cx="1" cy="1" r="1"/><path d='${quotes}'/></svg>`;
    expect(figureSvgByteLength(grows)).toBeLessThan(MAX_FIGURE_SVG_BYTES);
    expect(
      rejectionOf((payload) => {
        payload.questions[0]!.prompt = figure(grows, 'A long path');
      }).message,
    ).toBe(PAYLOAD_TOO_LARGE);
  });

  it('refuses a text alternative longer than a page could hold', () => {
    expect(
      rejectionOf((payload) => {
        payload.questions[0]!.prompt = figure(RAW, 'x'.repeat(MAX_TEXT_LENGTH + 1));
      }).message,
    ).toBe(PAYLOAD_TOO_LARGE);
  });

  it('refuses more figures in one field than a printed question could carry', () => {
    // One figure's byte cap bounds nothing that matters on its own:
    // `MAX_SEGMENTS` figures of 16 KB is megabytes in a single prompt.
    expect(
      rejectionOf((payload) => {
        payload.questions[0]!.prompt = Array.from({ length: MAX_FIGURES + 1 }, () => ({
          kind: 'figure' as const,
          svg: RAW,
          alt: 'A circle',
        }));
      }).message,
    ).toBe(PAYLOAD_TOO_LARGE);
  });

  it('refuses more drawing in one field than the byte budget allows', () => {
    // Under the figure count, over the budget: many middling figures are the
    // case the count alone does not catch.
    const padding = 'M0 0'.repeat(2_500);
    const wide = `<svg viewBox="0 0 2 2"><path d="${padding}"/></svg>`;
    expect(figureSvgByteLength(wide)).toBeLessThan(MAX_FIGURE_SVG_BYTES);
    expect(figureSvgByteLength(wide) * MAX_FIGURES).toBeGreaterThan(MAX_FIGURE_BYTES);
    expect(
      rejectionOf((payload) => {
        payload.questions[0]!.prompt = Array.from({ length: MAX_FIGURES }, () => ({
          kind: 'figure' as const,
          svg: wide,
          alt: 'A long path',
        }));
      }).message,
    ).toBe(PAYLOAD_TOO_LARGE);
  });

  it('refuses a byte budget only sanitizing escapes past, even under the raw check', () => {
    // Each figure is individually under the per-figure cap both raw and
    // escaped, and the field's *raw* total stays under `MAX_FIGURE_BYTES` —
    // only once every figure is sanitized does the field's real total cross
    // it. The pre-sanitize raw-byte check in `requireBoundedRichText` cannot
    // see this; it is caught re-summing the sanitized form afterward.
    const quotes = '"'.repeat(1_500);
    const inflatesOnEscape = `<svg viewBox="0 0 2 2"><circle cx="1" cy="1" r="1"/><path d='${quotes}'/></svg>`;
    expect(figureSvgByteLength(inflatesOnEscape) * MAX_FIGURES).toBeLessThan(MAX_FIGURE_BYTES);
    expect(
      rejectionOf((payload) => {
        payload.questions[0]!.prompt = Array.from({ length: MAX_FIGURES }, () => ({
          kind: 'figure' as const,
          svg: inflatesOnEscape,
          alt: 'Quoted path',
        }));
      }).message,
    ).toBe(PAYLOAD_TOO_LARGE);
  });

  it('stores a trimmed text alternative, because it is read out loud', () => {
    const payload = valid();
    payload.questions[0]!.prompt = figure(RAW, '  A circle\n');
    const stored = validateExtractionPayload(payload, ORDINALS).questions[0]!.prompt[0];
    expect(stored).toMatchObject({ alt: 'A circle' });
  });

  it('refuses a text alternative holding a character nothing could speak', () => {
    expect(
      rejectionOf((payload) => {
        payload.questions[0]!.prompt = figure(RAW, 'A circle\u0007');
      }).message,
    ).toBe(RICH_TEXT_INVALID);
  });

  it('does not make a question that depends on unreadable content usable', () => {
    // A figure is content, not an answer to "could this page be read": the
    // dependency is still the fact `usable` is computed from.
    const payload = valid();
    payload.questions[0]!.pageOrdinal = 3;
    payload.questions[0]!.dependsOnUninterpretable = true;
    payload.questions[0]!.prompt = figure(RAW, 'A circle');
    payload.pages[2]!.interpretable = true;
    const document = validateExtractionPayload(payload, ORDINALS);
    expect(document.questions[0]!.usable).toBe(false);
  });
});
