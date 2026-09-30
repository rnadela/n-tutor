import type { AccountTier } from '../generated/prisma/enums.js';

/**
 * Every Student Profile rule that has a sentence, and the sentence it has.
 *
 * The display-name bound lives here and reaches the web app through
 * `GET /api/auth/policy`, never as a literal in a component or a DTO message
 * written twice. The Account-Tier refusals at the foot live here for the same
 * reason: a refusal written at its throw site is a refusal the next edit
 * rewords. The `AccountTier` import is type-only, so this module still has no
 * runtime edge to anything.
 */

/** Long enough for a full name a parent actually types; short enough to render. */
export const DISPLAY_NAME_MAX_LENGTH = 60;

/**
 * The stored display name: Unicode-normalised (NFKC), internal whitespace
 * collapsed, trimmed. "Noah  Smith" and "Noah Smith" are the same name — the
 * same rule `admin`'s taxonomy applies to its labels, for the same reason.
 *
 * There is deliberately no uniqueness rule: two children may share a name.
 */
export function normaliseDisplayName(name: string): string {
  return name.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

/**
 * Acceptable once normalised: non-empty and within the bound. A name that is
 * only whitespace is empty, so it is refused before any write.
 */
export function isAcceptableDisplayName(name: string): boolean {
  const normalised = normaliseDisplayName(name);
  return normalised.length >= 1 && normalised.length <= DISPLAY_NAME_MAX_LENGTH;
}

/**
 * One rule, one sentence.
 *
 * Both the DTO and the service refuse the same names — the DTO at the edge, the
 * service because it is the sole writer and may not depend on having been
 * called through one. They say it with this string, so the message a parent
 * reads never depends on which layer caught the name.
 */
export const NAME_SHAPE = `A name of at most ${DISPLAY_NAME_MAX_LENGTH} characters is required.`;

/** The other input-shape rule both layers state: a patch must change something. */
export const NOTHING_TO_CHANGE = 'Give a name or a Grade Level to change.';

/**
 * The head both Account-Tier refusals share: the tier this account is on and
 * the number of active Student Profiles it allows.
 *
 * Unlike `NO_EXPLANATION_ALLOWANCE`, which is read by a **student** and
 * therefore names neither tier nor figure, this pair is read by the parent who
 * owns the account and who is the only person who can act on it — so it names
 * both. The Upload and Generation refusals (`allowance-policy.ts`) are the
 * parent-facing shape this one predates and now matches. It still does not
 * invite an upgrade: the tier and the limit are the fact, not a pitch.
 *
 * The figure is the caller's, read from `limitsFor(tier).studentProfiles`. No
 * number is written here, and none is written at either throw site.
 */
function profileLimitReached(tier: AccountTier, limit: number): string {
  const profiles = limit === 1 ? 'Student Profile' : 'Student Profiles';
  // "Account Tier", the domain's own name for it and the one the Admin console
  // prints — never "plan", a word this product uses nowhere else.
  return `The ${tier} Account Tier allows ${limit} active ${profiles}.`;
}

/** Refused because adding a profile would put the account past its tier. */
export function cannotAddStudentProfile(tier: AccountTier, limit: number): string {
  return `${profileLimitReached(tier, limit)} Archive or delete one before adding another.`;
}

/**
 * Refused because restoring an archived profile would put the account past its
 * tier. Nothing is taken away: the child stays archived, with the instant they
 * were archived at, and is restorable once a slot is free.
 */
export function cannotRestoreStudentProfile(tier: AccountTier, limit: number): string {
  return `${profileLimitReached(tier, limit)} Archive or delete an active one before restoring this child.`;
}
