import { describe, expect, it } from 'vitest';
import {
  explanationAllowanceExhausted,
  generationAllowanceExhausted,
  uploadAllowanceExhausted,
} from './allowance-policy.js';
import { limitsFor } from './tiers.js';

/** The tier under test throughout: the one with the smallest Upload Allowance. */
const TIER = 'Free' as const;
/** Read, never written: no allowance figure may appear as a literal in a test. */
const LIMIT = limitsFor(TIER).upload!;
/** The Generation sibling's own figure, read the same way. */
const GENERATION_LIMIT = limitsFor(TIER).generation!;
/** The Explanation sibling's own figure — the only tier that has one. */
const EXPLANATION_LIMIT = limitsFor(TIER).explanation!;

/**
 * A zone far enough east that its calendar date at the boundary is **not** the
 * UTC one: local midnight on the first of the next month falls on the previous
 * UTC day. That is the whole point of rendering the reset in the account's own
 * zone, and a formatter that quietly used UTC would read a day early here.
 */
const FAR_EAST = 'Pacific/Kiritimati';
/** Local 2026-10-01T00:00 in `FAR_EAST` (UTC+14) — 2026-09-30 in UTC. */
const RESET_AT = new Date('2026-09-30T10:00:00.000Z');

function sentence(overrides: Partial<Parameters<typeof uploadAllowanceExhausted>[0]> = {}): string {
  return uploadAllowanceExhausted({
    tier: TIER,
    used: LIMIT,
    limit: LIMIT,
    resetAt: RESET_AT,
    timezone: FAR_EAST,
    ...overrides,
  });
}

describe('the Upload Allowance refusal', () => {
  it('names the Account Tier the account is on', () => {
    expect(sentence()).toContain(`${TIER} Account Tier`);
    // The domain's own name for it. "Plan" is a word this product uses nowhere.
    expect(sentence().toLowerCase()).not.toContain('plan');
  });

  it('states the usage against the limit, in uploads', () => {
    expect(sentence()).toContain(`${LIMIT} of ${LIMIT}`);
    expect(sentence()).toContain(`${LIMIT} uploads`);
  });

  it('reads the figures from the tiers table rather than restating them', () => {
    // A sentence built for a tier with a different Upload Allowance states that
    // tier's figure, which is only possible if nothing here is a literal.
    const other = limitsFor('Plus').upload!;
    expect(other).not.toBe(LIMIT);
    expect(sentence({ tier: 'Plus', used: other, limit: other })).toContain(`${other} of ${other}`);
  });

  it('renders the reset date in the account’s own zone, not in UTC', () => {
    expect(sentence()).toContain('October 1, 2026');
    expect(sentence()).not.toContain('September 30, 2026');
    // And the same instant genuinely reads as the day before in UTC, so the
    // assertion above is about the zone and not about the fixture.
    expect(sentence({ timezone: 'UTC' })).toContain('September 30, 2026');
  });

  it('names no figure beyond the two counts and the date', () => {
    const figures = sentence().match(/\d+/gu) ?? [];
    expect(figures).toEqual([String(LIMIT), String(LIMIT), String(LIMIT), '1', '2026']);
  });

  it('still produces a sentence when the stored zone is not one the platform knows', () => {
    // A single unrecognised row must never turn a 409 a parent can act on into
    // a 500 they cannot.
    const fallback = sentence({ timezone: 'Mars/Olympus_Mons' });
    expect(fallback).toContain(`${TIER} Account Tier`);
    expect(fallback).toContain('September 30, 2026');
  });

  it('says it without an exclamation mark and without an apology', () => {
    expect(sentence()).not.toContain('!');
    expect(sentence().toLowerCase()).not.toContain('sorry');
  });

  it('agrees in number when a tier allows exactly one upload', () => {
    const singular = sentence({ used: 1, limit: 1 });
    expect(singular).toContain('1 upload each period');
    // The verb agrees with `used`, not with the sentence's default plural.
    expect(singular).toContain('1 of 1 has been used');
    expect(singular).not.toContain('have been used');
  });

  it('keeps the plural verb for every other usage', () => {
    expect(sentence()).toContain(`${LIMIT} of ${LIMIT} have been used`);
    expect(sentence({ used: 0 })).toContain(`0 of ${LIMIT} have been used`);
  });
});

function generationSentence(
  overrides: Partial<Parameters<typeof generationAllowanceExhausted>[0]> = {},
): string {
  return generationAllowanceExhausted({
    tier: TIER,
    used: GENERATION_LIMIT,
    limit: GENERATION_LIMIT,
    resetAt: RESET_AT,
    timezone: FAR_EAST,
    ...overrides,
  });
}

describe('the Generation Allowance refusal', () => {
  it('names the Account Tier the account is on', () => {
    expect(generationSentence()).toContain(`${TIER} Account Tier`);
    // The domain's own name for it. "Plan" is a word this product uses nowhere.
    expect(generationSentence().toLowerCase()).not.toContain('plan');
  });

  it('states the usage against the limit, denominated in practice tests', () => {
    expect(generationSentence()).toContain(`${GENERATION_LIMIT} of ${GENERATION_LIMIT}`);
    expect(generationSentence()).toContain(`${GENERATION_LIMIT} practice tests`);
    // Never in requests, generations or credits: one request may ask for
    // several, so a figure stated in requests would mean nothing.
    expect(generationSentence().toLowerCase()).not.toMatch(
      /request|generation|credit|token|upload/,
    );
  });

  it('reads the figures from the tiers table rather than restating them', () => {
    const other = limitsFor('Plus').generation!;
    expect(other).not.toBe(GENERATION_LIMIT);
    expect(generationSentence({ tier: 'Plus', used: other, limit: other })).toContain(
      `${other} of ${other}`,
    );
  });

  it('renders the reset date in the account’s own zone, not in UTC', () => {
    expect(generationSentence()).toContain('October 1, 2026');
    expect(generationSentence()).not.toContain('September 30, 2026');
    // And the same instant genuinely reads as the day before in UTC, so the
    // assertion above is about the zone and not about the fixture.
    expect(generationSentence({ timezone: 'UTC' })).toContain('September 30, 2026');
  });

  it('names no figure beyond the two counts and the date', () => {
    const figures = generationSentence().match(/\d+/gu) ?? [];
    expect(figures).toEqual([
      String(GENERATION_LIMIT),
      String(GENERATION_LIMIT),
      String(GENERATION_LIMIT),
      '1',
      '2026',
    ]);
  });

  it('still produces a sentence when the stored zone is not one the platform knows', () => {
    // A single unrecognised row must never turn a 409 a parent can act on into
    // a 500 they cannot.
    const fallback = generationSentence({ timezone: 'Mars/Olympus_Mons' });
    expect(fallback).toContain(`${TIER} Account Tier`);
    expect(fallback).toContain('September 30, 2026');
  });

  it('says it without an exclamation mark and without an apology', () => {
    expect(generationSentence()).not.toContain('!');
    expect(generationSentence().toLowerCase()).not.toContain('sorry');
  });

  it('agrees in number when a tier allows exactly one practice test', () => {
    const singular = generationSentence({ used: 1, limit: 1 });
    expect(singular).toContain('1 practice test each period');
    // The verb agrees with `used`, not with the sentence's default plural.
    expect(singular).toContain('1 of 1 has been used');
    expect(singular).not.toContain('have been used');
  });

  it('keeps the plural verb for every other usage', () => {
    expect(generationSentence()).toContain(
      `${GENERATION_LIMIT} of ${GENERATION_LIMIT} have been used`,
    );
    expect(generationSentence({ used: 0 })).toContain(`0 of ${GENERATION_LIMIT} have been used`);
  });

  it('shares the wording and the date rendering with its Upload sibling', () => {
    // The siblings differ in exactly one thing: the unit. Everything else — the
    // tier clause, the two figures, the reset sentence — is one shape, which is
    // why they live in one file.
    expect(generationSentence().replace(/practice tests?/gu, 'UNIT')).toBe(
      sentence({ used: GENERATION_LIMIT, limit: GENERATION_LIMIT }).replace(/uploads?/gu, 'UNIT'),
    );
  });
});

function explanationSentence(
  overrides: Partial<Parameters<typeof explanationAllowanceExhausted>[0]> = {},
): string {
  return explanationAllowanceExhausted({
    limit: EXPLANATION_LIMIT,
    resetAt: RESET_AT,
    timezone: FAR_EAST,
    ...overrides,
  });
}

/**
 * The third sibling, and the only one a **child** reads. Moved here from
 * `explanation/explanation-payload.spec.ts` with the sentence itself: the limit,
 * the period and the reset instant it names are `allowance`'s facts.
 */
describe('the Explanation Allowance refusal', () => {
  it('names the limit, denominated in explanations', () => {
    expect(explanationSentence()).toContain(`${EXPLANATION_LIMIT} explanations`);
  });

  it('reads the limit from the tiers table rather than restating it', () => {
    // A sentence built for a different figure states that figure, which is only
    // possible if nothing here is a literal.
    const other = EXPLANATION_LIMIT + 7;
    expect(explanationSentence({ limit: other })).toContain(`${other} explanations`);
    expect(explanationSentence({ limit: other })).not.toContain(`${EXPLANATION_LIMIT} `);
  });

  it('names no Account Tier, because a child reads it', () => {
    // No allowance counter, cost figure or tier label is reachable from a
    // student-scoped response (AD-20, AD-26).
    for (const tier of ['Free', 'Plus', 'Family', 'Internal'] as const) {
      expect(explanationSentence()).not.toContain(tier);
    }
    expect(explanationSentence()).not.toContain('Account Tier');
    // "Plan" is a word this product uses nowhere — as a *word*: "explanations"
    // carries the letters and is the unit this sentence is denominated in.
    expect(explanationSentence()).not.toMatch(/\bplans?\b/iu);
  });

  it('states no usage figure at all — not even the one that equals the limit', () => {
    // Its siblings say "N of N have been used"; this one may not, so the count
    // never reaches the child even when it is arithmetically the limit.
    //
    // Asserted as the absence of the usage *clause*, in every spelling a count
    // reaches a reader in. Counting how many times the limit's digits occur would
    // pass or fail on what the fixture's reset date happens to render as — a limit
    // of 20 against a date in 2026, or a limit of 10 against October 10, would each
    // fail here with no defect present.
    expect(explanationSentence()).not.toMatch(/\d+\s*(of|\/)\s*\d+/u);
    expect(explanationSentence()).not.toMatch(/\bleft\b|remaining/iu);
    expect(explanationSentence()).not.toMatch(/\d+\s+(has|have)\s+been\s+used/u);
    expect(explanationSentence()).not.toMatch(/used\s+\d/u);
    // And the clause its siblings carry is genuinely matched by those patterns, so
    // the assertions above are about this sentence and not about a regex that can
    // never fire.
    expect(sentence()).toMatch(/\d+\s*of\s*\d+/u);
    expect(sentence()).toMatch(/\d+\s+(has|have)\s+been\s+used/u);
  });

  it('renders the reset date in the account’s own zone, not in UTC', () => {
    expect(explanationSentence()).toContain('October 1, 2026');
    expect(explanationSentence()).not.toContain('September 30, 2026');
    // And the same instant genuinely reads as the day before in UTC, so the
    // assertion above is about the zone and not about the fixture.
    expect(explanationSentence({ timezone: 'UTC' })).toContain('September 30, 2026');
  });

  it('names no figure beyond the limit and the date', () => {
    // The date's own figures are derived from `RESET_AT` rather than listed, so a
    // fixture moved to another day or another year stays a statement about the
    // sentence. `FAR_EAST` is the zone the sentence is built in, which is the whole
    // point of the case below it.
    const local = new Intl.DateTimeFormat('en-US', {
      timeZone: FAR_EAST,
      day: 'numeric',
      year: 'numeric',
    }).formatToParts(RESET_AT);
    const figureOf = (type: Intl.DateTimeFormatPartTypes): string =>
      local.find((part) => part.type === type)!.value;
    const figures = explanationSentence().match(/\d+/gu) ?? [];
    expect(figures).toEqual([String(EXPLANATION_LIMIT), figureOf('day'), figureOf('year')]);
  });

  it('still produces a sentence when the stored zone is not one the platform knows', () => {
    // A single unrecognised row must never turn a 409 a child's screen can
    // explain into a 500 it cannot.
    const fallback = explanationSentence({ timezone: 'Mars/Olympus_Mons' });
    expect(fallback).toContain(`${EXPLANATION_LIMIT} explanations`);
    expect(fallback).toContain('September 30, 2026');
  });

  it('says it without an exclamation mark, an apology or an upsell', () => {
    expect(explanationSentence()).not.toContain('!');
    expect(explanationSentence().toLowerCase()).not.toContain('sorry');
    expect(explanationSentence().toLowerCase()).not.toMatch(/upgrade|price|cost|\$/u);
  });

  it('blames the account and never the child', () => {
    expect(explanationSentence()).not.toMatch(/\byou\b|\byour\b/iu);
    expect(explanationSentence().toLowerCase()).not.toMatch(/too many|should have/u);
  });

  it('agrees in number when a tier allows exactly one explanation', () => {
    const singular = explanationSentence({ limit: 1 });
    expect(singular).toContain('1 explanation each period');
    expect(singular).toContain('it has been used');
    expect(singular).not.toContain('they have all been used');
  });

  it('keeps the plural for every other limit', () => {
    expect(explanationSentence()).toContain(`${EXPLANATION_LIMIT} explanations each period`);
    expect(explanationSentence()).toContain('they have all been used');
  });

  it('shares the reset sentence and its date rendering with both siblings', () => {
    // The clause a period turns over on is one clause in one file, so the three
    // can never disagree about which calendar day it is.
    const resets = 'The allowance resets on October 1, 2026.';
    expect(explanationSentence()).toContain(resets);
    expect(sentence()).toContain(resets);
    expect(generationSentence()).toContain(resets);
  });
});
