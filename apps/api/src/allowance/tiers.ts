import type { AccountTier } from '../generated/prisma/enums.js';

/**
 * The one transcription of `_bmad-output/specs/spec-n-test-reviewer/tiers.md`.
 *
 * Nothing else in the product — no controller, copy string, component,
 * migration default, or test — restates any figure below. The web reads every
 * limit off the API response, so there is exactly one place to recalibrate.
 *
 * `null` means unlimited. There is no sentinel number.
 */
export interface TierLimits {
  /** The tier's Student Profile limit. Only the limit; no count is stored. */
  studentProfiles: number | null;
  upload: number | null;
  generation: number | null;
  explanation: number | null;
}

export const TIER_LIMITS: Readonly<Record<AccountTier, Readonly<TierLimits>>> = Object.freeze({
  Free: Object.freeze({ studentProfiles: 1, upload: 2, generation: 2, explanation: 10 }),
  Plus: Object.freeze({ studentProfiles: 2, upload: 8, generation: 20, explanation: null }),
  Family: Object.freeze({ studentProfiles: 5, upload: 20, generation: 60, explanation: null }),
  Internal: Object.freeze({
    studentProfiles: null,
    upload: null,
    generation: null,
    explanation: null,
  }),
});

export function limitsFor(tier: AccountTier): Readonly<TierLimits> {
  return TIER_LIMITS[tier];
}
