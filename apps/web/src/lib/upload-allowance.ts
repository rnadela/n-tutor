/**
 * What is left of the Upload Allowance, and the sentence that states it.
 *
 * Here rather than inside the Check step for `legibility.ts`' reason: `apps/web`
 * runs its unit tests without a DOM, so a rule reachable only through a rendered
 * sentence is a rule no test can state — and the three-way decision below is
 * exactly the kind that ships green when its arms are swapped if the only thing
 * watching it is a source-text grep. The screen may hold no tier table, no
 * limit, no reset date and no period of its own: every figure arrives in the
 * `AccountConsumption` payload, so this is deliberately the only module that
 * touches those numbers, and it touches them once.
 */

import { parentCopy } from '@/copy/parent';
import { dateOnly, type AccountConsumption, type AllowanceReading } from './consumption-format';

/**
 * What is left of the Upload Allowance, or `null` on an unlimited tier.
 *
 * `null` rather than a number, for `practice-test-count.ts`' `remainingAfter`
 * reason: an unlimited account has no remainder to state, and inventing one
 * would be a figure a parent could reasonably plan around and be wrong about.
 * The caller says "unlimited" in words instead.
 *
 * Clamped at zero because the server is the authority on the ceiling and a tier
 * can shrink under an account that has already spent more than the new limit
 * allows. "-2 left" describes nothing a parent can act on; "0 left" does.
 */
export function uploadAllowanceLeft(reading: AllowanceReading): number | null {
  if (reading.limit === null) return null;
  return Math.max(0, reading.limit - reading.used);
}

/**
 * The Check step's allowance line, or `null` when there is nothing to state.
 *
 * Three outcomes, not two. No payload — the read has not landed, or it failed —
 * is `null`, because a blank where a figure belongs is better than a figure
 * nobody vouched for, and the step works without the line. An unlimited tier
 * has no remainder, so it is said in words with no digit in it. Everything else
 * states what is left, the account's **own** ceiling, and the account's own
 * reset instant rendered in the account's own zone — never the viewer's and
 * never UTC.
 */
export function uploadAllowanceLine(consumption: AccountConsumption | null): string | null {
  if (consumption === null) return null;
  const reading = consumption.allowances.upload;
  const left = uploadAllowanceLeft(reading);
  // `uploadAllowanceLeft` returns `null` exactly when the payload's limit is
  // `null`, so this one check is both "no remainder to state" and "no ceiling
  // to state it against" — which is why the assertion below is safe.
  if (left === null) return parentCopy.capture.legibility.allowanceUnlimited;
  return parentCopy.capture.legibility.allowanceLeft(
    left,
    reading.limit!,
    dateOnly(consumption.resetAt, consumption.timezone),
  );
}
