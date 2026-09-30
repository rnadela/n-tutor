import { adminCopy } from '@/copy/admin';

/**
 * **The app's one consumption vocabulary — the shape, and how it renders.**
 *
 * Two surfaces state an allowance: the Admin console's account detail and Parent
 * View's Settings screen. They read the *same* API payload from the same method,
 * so the type it arrives as and the functions that render it are defined here,
 * once, rather than per surface — a second `AccountConsumption` or a second tier
 * label map would be a second place for the two views to disagree, which is the
 * thing having one composition on the API side exists to prevent.
 *
 * `parent-api.ts` therefore imports from here rather than from `admin-api.ts`:
 * this module is already the shared one (Parent View's analytics and generate
 * screens read `limitLabel` from it), and pointing Parent View at the admin client
 * would give it an edge to that client's token storage for a type.
 *
 * Consumption is rendered against **the account's own period and timezone**,
 * never the viewer's and never a server default. These are the functions that
 * carry that guarantee, so they live apart from the components and are pinned by
 * unit tests against a zone the test machine does not share — rendering in the
 * local zone or in UTC has to be a test failure, not an invisible regression.
 *
 * Not one figure from the tiers table appears here. Every limit, every count and
 * every instant originates in the API response.
 */

/** Mirrors the API's AccountTier enum. Carries no figure — only the labels. */
export const ACCOUNT_TIERS = ['Free', 'Plus', 'Family', 'Internal'] as const;
export type AccountTier = (typeof ACCOUNT_TIERS)[number];

/** `limit: null` is unlimited. Every figure originates in the API's tiers table. */
export interface AllowanceReading {
  used: number;
  limit: number | null;
}

export interface AccountConsumption {
  periodStart: string;
  periodEnd: string;
  resetAt: string;
  timezone: string;
  tier: AccountTier;
  studentProfileLimit: number | null;
  allowances: {
    upload: AllowanceReading;
    generation: AllowanceReading;
    explanation: AllowanceReading;
  };
}

/** An instant as a date and time in `timezone`. */
export function inZone(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

/** An instant as a date alone in `timezone`. */
export function dateOnly(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(new Date(iso));
}

/**
 * `null` is unlimited. The screen says so in words — it never invents a number,
 * and no figure from the tiers table is restated here.
 */
export function limitLabel(limit: number | null): string {
  return limit === null ? adminCopy.accounts.unlimited : String(limit);
}

/**
 * The Account Tier's label, read from the copy file and never from the enum
 * value. One map for the app: both surfaces name the tier the same way, and a
 * rename is one edit.
 *
 * **The fallback is not defensive noise.** `tier` arrives on an unchecked API
 * payload, and `ACCOUNT_TIERS` is this app's *mirror* of the API's enum — a tier
 * added on the API side reaches here before the mirror does. Indexing the map
 * blind would then render the literal text `undefined` into the tier line, which
 * reads to a parent as a broken account rather than as a label this build does not
 * know yet. The neutral placeholder is the same one the Admin console already
 * shows for an absent name.
 */
export function tierLabel(tier: AccountTier): string {
  return adminCopy.accounts.tiers[tier] ?? adminCopy.accounts.noName;
}
