import { describe, expect, it } from 'vitest';
import { EXTRACTION_PROMPT } from './extraction-prompt.js';
import { FIGURE_ELEMENTS, MAX_FIGURE_SVG_BYTES } from './svg-figure.js';

/**
 * The prompt states the rules the code afterwards enforces, and a prompt that
 * has drifted from the code is worse than no prompt: the model is told to do
 * one thing and refused for doing it, so every payload fails for a reason
 * nobody wrote down.
 *
 * Only the figure rule is pinned here, because it is the one that restates a
 * list and a figure that live in code. The other rules name no constant.
 */
const RULES = EXTRACTION_PROMPT.split('\n').filter((line) => /^\d+\./u.test(line));
const FIGURE_RULE = RULES.find((rule) => rule.includes('`figure`'))!;

/** Every `backticked` token in the figure rule. */
const NAMED = [...FIGURE_RULE.matchAll(/`([^`]+)`/gu)].map((match) => match[1]!);

/** Tags a browser executes, fetches or styles from — the grammar admits none. */
const FORBIDDEN_TAGS = ['script', 'style', 'image', 'use', 'foreignObject', 'iframe', 'a'];

describe('the figure rule', () => {
  it('exists, beside the fraction rule and before the never-guess rule', () => {
    expect(FIGURE_RULE).toBeDefined();
    const numbers = RULES.map((rule) => Number.parseInt(rule, 10));
    expect(numbers).toEqual([1, 2, 3, 4, 5]);
    expect(RULES[1]).toContain('fraction segment');
    expect(RULES[3]).toBe(FIGURE_RULE);
    expect(RULES[4]).toContain('Never guess.');
  });

  it('names every element the sanitizer admits, and no element it refuses', () => {
    // The rule restates the allowlist as prose. Unpinned, the two drift and the
    // model is instructed to draw with something that is then rejected.
    for (const element of FIGURE_ELEMENTS) {
      expect(NAMED, element).toContain(element);
    }
    for (const tag of FORBIDDEN_TAGS) {
      expect(NAMED, tag).not.toContain(tag);
    }
  });

  it('states the byte cap the code enforces, not a figure of its own', () => {
    expect(FIGURE_RULE).toContain(`${MAX_FIGURE_SVG_BYTES / 1024} KB`);
  });

  it('asks for a viewBox, the current colour, a text alternative and no guessing', () => {
    expect(NAMED).toContain('viewBox');
    expect(NAMED).toContain('currentColor');
    expect(NAMED).toContain('none');
    expect(NAMED).toContain('alt');
    expect(FIGURE_RULE).toContain('uninterpretable');
  });

  it('leaves the never-guess rule saying what it said before', () => {
    // A figure rule that weakened it would be a licence to draw a diagram
    // nobody photographed.
    expect(RULES[4]).toContain('un-photographed diagram');
    expect(RULES[4]).toContain('dependsOnUninterpretable');
    expect(RULES[4]).toContain('interpretable: false');
  });
});
