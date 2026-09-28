/**
 * Every figure and every sentence the `topics` module owns, stated once.
 *
 * One file, exactly as `explanation-policy.ts` is one file and for the same
 * reason: a threshold written at the comparison and a refusal written at its
 * throw site are both values the next person to touch that line quietly
 * changes. The threshold in particular is the single number that decides whether
 * two spellings are one concept, and it belongs somewhere a reader can find it
 * without reading the cascade.
 *
 * Nothing here names a model, a provider or a price (AD-20). None of those is
 * this module's knowledge, and a refusal is the last place one should appear.
 */

/**
 * The cosine at or above which stage 2 calls two labels the same concept.
 *
 * 0.85 from AD-11, and high on purpose. The two failures are not symmetric: a
 * threshold set too low merges two real concepts into one Mastery value and
 * nothing downstream can tell that it happened, while one set too high sends the
 * pair to stage 3, which is a model call that then gets it right. So the
 * expensive stage absorbs the doubt, and this stage only takes the cases it is
 * sure of.
 *
 * It is a floor and not a ceiling — `bestTopicMatch` compares with `>=`, so a
 * vector compared against itself, which scores exactly 1, matches.
 */
export const TOPIC_SIMILARITY_THRESHOLD = 0.85;

/**
 * How many canonical Topics stage 3 is shown.
 *
 * A cap and not a page: the candidates are ordered oldest-first, so the set a
 * Subject has actually accumulated is what the model sees, and a Subject that
 * has somehow grown past this many Topics has a curation problem that Story 7.6
 * addresses — not one this module should answer by sending a prompt that grows
 * without bound. Fifty short names is a small prompt; five thousand is a cost
 * row nobody predicted and a list no model reads carefully.
 *
 * It bounds the stage-2 read too, which is the same list. That is deliberate:
 * two different caps would mean a Topic that stage 2 can match but stage 3 never
 * sees, or the reverse.
 */
export const TOPIC_CANDIDATE_LIMIT = 50;

/**
 * The longest label this module will carry, in characters.
 *
 * **A label is model-written text with no bound on it**, and it goes four places
 * that each punish length differently: it becomes `topic.name`, it becomes the
 * `matchKey` inside a btree unique index — where Postgres refuses a key past about
 * 2704 bytes with an error that is not a domain error and reaches the caller as a
 * raw client fault — it becomes the text of a paid embedding, and it becomes a line
 * of every subsequent stage-3 prompt for that Subject, forever.
 *
 * **Shortened, never refused.** That is the whole reason this is a length and not a
 * validation: a refused label is a lost Mastery write, and a Topic named by its
 * first 200 characters is a slightly ugly dashboard row. The first is a hole in a
 * child's history and the second is a cosmetic defect, so the trade is not close.
 *
 * 200 is far longer than any real Topic name — "Adding and Subtracting Fractions
 * with Unlike Denominators" is 58 — so reaching it means the label is not a Topic
 * name at all, and truncating it loses nothing that was ever going to be read.
 */
export const MAX_TOPIC_LABEL_LENGTH = 200;

/**
 * There is no label here to canonicalize.
 *
 * A blank label is a caller's fault and not a model's: `normalize` is asked to
 * map *something* onto the canonical set, and an empty string names no concept
 * that any Topic could be. Refused before a single provider call, and never
 * retried — a second identical blank is identically blank.
 *
 * It names no Subject and no id, because the sentence is about the argument.
 */
export const TOPIC_LABEL_REQUIRED = 'A topic label cannot be blank.';

/**
 * The Subject this canonicalization was scoped to does not exist.
 *
 * Refused before any provider call, for the reason the blank label is: a
 * canonical set is per Subject, so without one there is nothing to match against
 * and nothing a minted row could belong to. Minting into a Subject that is not
 * there would leave a `Topic` row whose foreign key cannot be satisfied — the
 * database would refuse it anyway, and a great deal later, after the money was
 * spent.
 *
 * It states that the Subject is unknown and names no id: this is an internal
 * seam with no HTTP surface in this story, and an id echoed into a message is an
 * id that ends up in a log line.
 */
export const TOPIC_SUBJECT_UNKNOWN = 'That subject does not exist.';

/**
 * A `normalize` this module cannot perform at all.
 *
 * A plain named error rather than a Nest HTTP exception, exactly as
 * `LegibilityPayloadInvalid` is: `topics` has no route in this story and must
 * stay callable — and unit-testable — without a framework. Whichever surface
 * eventually calls `normalize` decides what an unusable argument looks like on
 * the wire.
 *
 * Never retried. Both cases it carries are standing facts about the request.
 */
export class TopicInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TopicInputError';
  }
}
