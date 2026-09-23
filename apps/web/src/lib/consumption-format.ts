import { adminCopy } from '@/copy/admin';

/**
 * Consumption is rendered against **the account's own period and timezone**,
 * never the viewer's and never a server default. These are the functions that
 * carry that guarantee, so they live apart from the component and are pinned by
 * unit tests against a zone the test machine does not share — rendering in the
 * local zone or in UTC has to be a test failure, not an invisible regression.
 */

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
