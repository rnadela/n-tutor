/** The zone used when an account has no usable timezone in force. */
export const DEFAULT_TIMEZONE = 'UTC';

/**
 * Whether the platform's `Intl` time-zone data recognises `zone`.
 *
 * Every zone-aware computation runs through `Intl`, which throws `RangeError`
 * on an unknown zone. A single unrecognised row must never be able to take a
 * read path down, so this gates both the write (reject) and the read (fall back
 * to `DEFAULT_TIMEZONE`).
 */
export function isSupportedTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
