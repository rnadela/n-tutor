import { describe, expect, it } from 'vitest';
import {
  DISPLAY_NAME_MAX_LENGTH,
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
