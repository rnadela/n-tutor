/**
 * The single source of the shape a Student Profile display name has.
 *
 * The bound lives here and reaches the web app through `GET /api/auth/policy`,
 * never as a literal in a component or a DTO message written twice.
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
