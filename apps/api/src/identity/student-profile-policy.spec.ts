import { describe, expect, it } from 'vitest';
import { TIER_LIMITS } from '../allowance/tiers.js';
import type { AccountTier } from '../generated/prisma/enums.js';
import {
  DISPLAY_NAME_MAX_LENGTH,
  cannotAddStudentProfile,
  cannotRestoreStudentProfile,
  isAcceptableDisplayName,
  normaliseDisplayName,
} from './student-profile-policy.js';

describe('the Student Profile display-name shape', () => {
  it('trims the ends', () => {
    expect(normaliseDisplayName('  Noah  ')).toBe('Noah');
  });

  it('collapses internal whitespace so two spellings are one name', () => {
    expect(normaliseDisplayName('Noah   Smith')).toBe('Noah Smith');
    expect(normaliseDisplayName('Noah\tSmith')).toBe('Noah Smith');
    expect(normaliseDisplayName('Noah\nSmith')).toBe('Noah Smith');
  });

  it('normalises compatibility forms to NFKC', () => {
    // A composed and a decomposed "é" are the same name.
    expect(normaliseDisplayName('Chloé')).toBe(normaliseDisplayName('Chloé'));
    // Full-width Latin is the same name as its ASCII spelling.
    expect(normaliseDisplayName('Ｎｏａｈ')).toBe('Noah');
  });

  it('refuses a name that is empty once normalised', () => {
    expect(isAcceptableDisplayName('')).toBe(false);
    expect(isAcceptableDisplayName('   ')).toBe(false);
    expect(isAcceptableDisplayName('\t\n ')).toBe(false);
  });

  it('accepts a name of exactly the bound and refuses one past it', () => {
    expect(isAcceptableDisplayName('n'.repeat(DISPLAY_NAME_MAX_LENGTH))).toBe(true);
    expect(isAcceptableDisplayName('n'.repeat(DISPLAY_NAME_MAX_LENGTH + 1))).toBe(false);
  });

  it('measures the bound against the normalised name, not the raw input', () => {
    // Padding is not length: this is exactly the bound once trimmed.
    const padded = `  ${'n'.repeat(DISPLAY_NAME_MAX_LENGTH)}  `;
    expect(isAcceptableDisplayName(padded)).toBe(true);
  });

  it('does not impose a uniqueness rule — two children may share a name', () => {
    expect(isAcceptableDisplayName('Noah')).toBe(true);
    expect(normaliseDisplayName('Noah')).toBe(normaliseDisplayName('Noah'));
  });
});

describe('the Account-Tier refusals a parent at their profile limit reads', () => {
  /** Every capped tier, with its own limit — never a figure written here. */
  const capped = (
    Object.entries(TIER_LIMITS) as [AccountTier, { studentProfiles: number | null }][]
  )
    .filter(([, limits]) => limits.studentProfiles !== null)
    .map(([tier, limits]) => [tier, limits.studentProfiles as number] as const);

  it('has a capped tier to speak about at all', () => {
    expect(capped.length).toBeGreaterThan(0);
  });

  it('names the tier and its own limit, for every capped tier', () => {
    for (const [tier, limit] of capped) {
      for (const sentence of [
        cannotAddStudentProfile(tier, limit),
        cannotRestoreStudentProfile(tier, limit),
      ]) {
        expect(sentence).toContain(tier);
        expect(sentence).toContain(String(limit));
      }
    }
  });

  it('names no figure other than the limit', () => {
    for (const [tier, limit] of capped) {
      for (const sentence of [
        cannotAddStudentProfile(tier, limit),
        cannotRestoreStudentProfile(tier, limit),
      ]) {
        expect(sentence.match(/\d+/gu)).toEqual([String(limit)]);
      }
    }
  });

  // Grammar probes, not tier figures: one and more-than-one are the only two
  // cases the plural has, and no tier's limit is being restated by naming them.
  const ONE = 1;
  const MORE_THAN_ONE = ONE + 1;

  it('reads singular at a limit of one and plural above it', () => {
    for (const sentence of [cannotAddStudentProfile, cannotRestoreStudentProfile]) {
      expect(sentence('Free', ONE)).toContain('Student Profile.');
      expect(sentence('Free', ONE)).not.toContain('Student Profiles');
      expect(sentence('Free', MORE_THAN_ONE)).toContain('Student Profiles.');
    }
  });

  it('shares one head and differs only in the action its tail names', () => {
    const [tier, limit] = capped[0]!;
    const add = cannotAddStudentProfile(tier, limit);
    const restore = cannotRestoreStudentProfile(tier, limit);

    // The head is the opening sentence, whatever it says; it is not restated
    // here, only required to state the tier and the figure and to be shared.
    const head = `${add.split('. ')[0]!}.`;
    expect(head).toContain(tier);
    expect(head).toContain(String(limit));
    expect(restore.startsWith(head)).toBe(true);

    expect(add.slice(head.length)).not.toBe(restore.slice(head.length));
    expect(add).toContain('adding another');
    expect(restore).toContain('restoring this child');
  });

  it('does not invite an upgrade or name a price', () => {
    for (const [tier, limit] of capped) {
      for (const sentence of [
        cannotAddStudentProfile(tier, limit),
        cannotRestoreStudentProfile(tier, limit),
      ]) {
        expect(sentence).not.toMatch(/upgrade|\$|month|per month/iu);
        expect(sentence).not.toContain('!');
      }
    }
  });
});
