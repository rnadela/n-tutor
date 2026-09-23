import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TIER_LIMITS, type TierLimits } from './tiers.js';

/**
 * The transcription test.
 *
 * `tiers.ts` claims to be the one transcription of `tiers.md`. A test that
 * asserted each figure against `limitsFor` would only prove the table equals
 * itself — a wrong transcription would ship green. So this parses the
 * authoritative markdown table and compares row for row: the figures live in
 * exactly one place still, and that place is now verified against its source.
 */
const TIERS_MD = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../_bmad-output/specs/spec-n-test-reviewer/tiers.md',
);

/** `unlimited` in the table means no limit, which the code models as `null`. */
function parseCell(cell: string): number | null {
  const value = cell.replace(/\*/gu, '').trim();
  if (value.toLowerCase() === 'unlimited') return null;
  const numeric = Number(value);
  expect(Number.isInteger(numeric), `"${value}" is a figure or "unlimited"`).toBe(true);
  return numeric;
}

/** Reads the one authoritative numbers table out of `tiers.md`. */
function parseTiersTable(): Record<string, TierLimits> {
  const lines = readFileSync(TIERS_MD, 'utf8').split('\n');
  const parsed: Record<string, TierLimits> = {};

  for (const line of lines) {
    if (!line.trimStart().startsWith('|')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length !== 5) continue;

    const tier = cells[0]!.replace(/\*/gu, '').trim();
    // Skip the header row and the `|---|` separator.
    if (tier === 'Account Tier' || /^-+$/u.test(tier)) continue;

    parsed[tier] = {
      studentProfiles: parseCell(cells[1]!),
      upload: parseCell(cells[2]!),
      generation: parseCell(cells[3]!),
      explanation: parseCell(cells[4]!),
    };
  }
  return parsed;
}

describe('tier limits are the table in tiers.md', () => {
  const fromSpec = parseTiersTable();

  it('parses every tier out of the source table', () => {
    // Guards the parser itself: a table that stopped matching would otherwise
    // silently make every assertion below vacuous.
    expect(Object.keys(fromSpec).sort()).toEqual(Object.keys(TIER_LIMITS).sort());
    expect(Object.keys(fromSpec).length).toBeGreaterThan(0);
  });

  it.each(Object.keys(TIER_LIMITS))('transcribes %s row for row', (tier) => {
    expect(fromSpec[tier], `tiers.md has a row for ${tier}`).toBeDefined();
    expect(TIER_LIMITS[tier as keyof typeof TIER_LIMITS]).toEqual(fromSpec[tier]);
  });

  it('models unlimited as null, never a sentinel number', () => {
    for (const limits of Object.values(TIER_LIMITS)) {
      for (const limit of Object.values(limits)) {
        expect(limit === null || (Number.isInteger(limit) && limit > 0)).toBe(true);
      }
    }
  });

  it('is frozen, so no caller can mutate a limit at runtime', () => {
    expect(Object.isFrozen(TIER_LIMITS)).toBe(true);
    for (const limits of Object.values(TIER_LIMITS)) expect(Object.isFrozen(limits)).toBe(true);
  });
});
