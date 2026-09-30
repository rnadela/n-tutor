import type { AccountTier } from '../generated/prisma/enums.js';
import { DEFAULT_TIMEZONE, isSupportedTimeZone } from '../common/timezone.js';

/**
 * Every sentence this module refuses an allowance with.
 *
 * A pure module beside `tiers.ts` and `period.ts`, with no Nest dependency and
 * no import of a service: the sentence is a function of the tier, the two
 * figures and the window, and nothing else. It lives here rather than in the
 * enforcing module's own policy file because all three facts it names — the
 * Account Tier, the period and the reset instant — are `allowance`'s, and
 * because Generation (9.4, here now) and Explanation (9.5) refuse in the same
 * shape — two of the three live here already.
 * Each allowance keeps its own builder — the unit it is denominated in is part
 * of the sentence — but they share `AllowanceRefusal`, the date rendering and
 * the wording, so the siblings join this file rather than writing a second
 * formatter at a third throw site.
 *
 * **No figure is written here.** `used` and `limit` are the caller's, read
 * through `limitsFor`, and the reset instant is the window's own `end`.
 */

export interface AllowanceRefusal {
  tier: AccountTier;
  used: number;
  /**
   * The tier's limit, always a real figure. An unlimited tier is `null` in
   * `TIER_LIMITS`, and the caller returns early on it — there is no refusal to
   * write — so nothing ever hands one to this builder.
   */
  limit: number;
  /** The window's exclusive end — the instant the period turns over. */
  resetAt: Date;
  /** The zone the window was actually cut in. */
  timezone: string;
}

/**
 * The reset date as the account's own calendar reads it.
 *
 * The parent reads a date, not an instant: an account in Manila whose period
 * ends at 16:00Z on the last of the month turns over on the *first* locally,
 * and a sentence that said the last would be wrong by a day for the only reader
 * who can act on it. So the instant is rendered in `timezone` and never in UTC.
 *
 * Defence in depth, the same as `monthWindowFor`'s: a zone the platform does
 * not recognise makes every `Intl` call throw, and a refusal that threw would
 * turn a 409 a parent can act on into a 500 they cannot. `PeriodWindow.timezone`
 * is already fallen back, so this guard is the second belt rather than the
 * first.
 */
function resetDateIn(resetAt: Date, timezone: string): string {
  const timeZone = isSupportedTimeZone(timezone) ? timezone : DEFAULT_TIMEZONE;
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(resetAt);
}

/**
 * Nothing of the Upload Allowance is left this period.
 *
 * Read by the **parent** who owns the account and who is the only person who
 * can act on it, so — unlike `NO_EXPLANATION_ALLOWANCE`, which a child reads —
 * it names the Account Tier, both figures, and the date the allowance comes
 * back. It still does not invite an upgrade: the tier and the limit are the
 * fact, not a pitch. No exclamation mark and no apology.
 *
 * "Account Tier" is the domain's own name for it and the one the Admin console
 * prints — never "plan", a word this product uses nowhere else.
 */
export function uploadAllowanceExhausted({
  tier,
  used,
  limit,
  resetAt,
  timezone,
}: AllowanceRefusal): string {
  const uploads = limit === 1 ? 'upload' : 'uploads';
  // The verb agrees with `used`, which is the subject of the second clause — a
  // tier that allows one upload otherwise reads "1 of 1 have been used".
  const been = used === 1 ? 'has' : 'have';
  return `The ${tier} Account Tier allows ${limit} ${uploads} each period, and ${used} of ${limit} ${been} been used. The allowance resets on ${resetDateIn(resetAt, timezone)}.`;
}

/**
 * Nothing of the Generation Allowance is left this period.
 *
 * The Upload sibling above, with one difference and only one: the unit. A
 * parent's Generation Allowance is denominated in **practice tests** and never
 * in requests, generations or credits — one request may ask for several, and a
 * figure stated in requests would be a figure that meant nothing.
 *
 * Read by the parent, in two places: the 409 a request at cap answers with, and
 * the allowance read the generate screen loads — because a parent already at cap
 * cannot fire the request and would otherwise never be told the tier, the
 * figures or the date. One builder, so the two can never disagree.
 *
 * It states the fact and does not invite an upgrade, and it names no figure this
 * file wrote: `used` and `limit` are the caller's, read through `limitsFor`.
 */
export function generationAllowanceExhausted({
  tier,
  used,
  limit,
  resetAt,
  timezone,
}: AllowanceRefusal): string {
  const tests = limit === 1 ? 'practice test' : 'practice tests';
  // The verb agrees with `used`, which is the subject of the second clause — a
  // tier that allows one practice test otherwise reads "1 of 1 have been used".
  const been = used === 1 ? 'has' : 'have';
  return `The ${tier} Account Tier allows ${limit} ${tests} each period, and ${used} of ${limit} ${been} been used. The allowance resets on ${resetDateIn(resetAt, timezone)}.`;
}
