import type {
  ExplanationFlagDisposition,
  ExplanationFlagOrigin,
} from '../generated/prisma/enums.js';
import type { RichText } from '../extraction/rich-text.js';
import { suppressionUnlocked } from './explanation-suppression.js';

/**
 * The origin a parent's flag is recorded under, named once.
 *
 * Spelled here rather than inline at the two places that use it — the `where` that
 * reads a row's flags and the `create` that writes one — because those two must
 * agree or a flag would be written under one origin and read under another, and a
 * parent pressing the control would watch nothing happen. One constant is what makes
 * that impossible rather than unlikely.
 */
export const PARENT_FLAG_ORIGIN: ExplanationFlagOrigin = 'Parent';

/**
 * The origin a child's own flag is recorded under.
 *
 * Its own constant beside the parent's, and **not** an enum migration: both members
 * of `ExplanationFlagOrigin` were declared by Story 6.2 precisely so the student
 * route would be a code path. The two constants are what keep the write and the reads
 * agreeing across three surfaces — the child's own response, the parent's, and the
 * Admin queue — where a literal at each site would be three chances to disagree.
 *
 * The origin is **part of the identity of a flag**: `@@unique([explanationId,
 * origin])` means a parent and a child who each report the same Explanation are two
 * rows, and one person pressing twice is one row.
 */
export const STUDENT_FLAG_ORIGIN: ExplanationFlagOrigin = 'Student';

/**
 * The one disposition that puts a child's concern in front of an operator.
 *
 * Its own constant beside the two origins, and for exactly their reason: the Admin
 * queue's `where`, the mapper that reports a decision to a parent and every spec that
 * pins which reports reach an operator all name this value, and a literal at each site
 * would be three chances to disagree about which of two words qualifies. A queue that
 * read one spelling and a write that used another would drop every confirmed
 * Explanation silently — nothing would fail, an operator would simply never see one.
 *
 * `Dismissed` deliberately has no constant: nothing keys off it. It is the value a
 * disposition happens to hold when it is not this one, and a constant for it would
 * invite a second `where` arm that must never exist.
 */
export const QUEUED_FLAG_DISPOSITION: ExplanationFlagDisposition = 'Confirmed';

/**
 * One stored Explanation as the **parent** reading it gets it back.
 *
 * `questionId` rather than the pair the student's own response carries: a parent reads a
 * whole Attempt at once, so the Attempt id is the request and restating it on every
 * entry would be the same string repeated per Question.
 *
 * **One entry per generation since Story 6.4, not one per Question.** A Question a parent
 * suppressed and then regenerated holds two rows, and both are here — the removed one so
 * it can be read beside its replacement, the replacement so it can be read at all. The
 * `questionId` is therefore no longer unique across the list, and the screen groups by
 * it. `generation` is what tells two entries of one Question apart.
 *
 * **Three independent flag facts, and each is its own field.** `parentFlaggedAt` is
 * the instant a parent first recorded a concern; `studentFlaggedAt` the instant the
 * child did; `studentFlagDisposition` what the parent decided about the child's. They
 * are instants rather than booleans because they are records of *when*, and they are
 * the *first* instants, which the upsert keeps, so a second press cannot move one.
 *
 * `studentFlagDisposition` is null in two cases that are the same absence: no student
 * flag at all, and one nobody has decided about yet. The screen tells them apart by
 * `studentFlaggedAt`, which is why that field exists separately rather than being
 * folded into a single three-state string here.
 *
 * There is no cost, no tier, no model name, no allowance figure and no grading rationale
 * (AD-20, AD-26) — the rationale is Story 6.5's, and it has nowhere here to sit. And
 * there is no suppression *reason* either: suppression follows a recorded flag and the
 * flag is the record, so a second free-text field would be a second account of one
 * concern.
 */
export interface ParentExplanationView {
  questionId: string;
  /**
   * Which explanation of this Question this entry is: 1 for the one the child asked
   * for, 2 for the first free replacement, and so on.
   *
   * The ordinal the screen labels an entry with, and the reason two entries of one
   * Question are tellable apart. It is the stored column, never a position in this list:
   * a list index would renumber itself the day the read's order changed.
   */
  generation: number;
  /**
   * When a parent stopped this one being served to their child, or null for one still
   * live.
   *
   * An instant rather than a boolean, and the **first** one — the write keeps it — so a
   * second press cannot move it. A suppressed entry is still here and still carries its
   * `body`: suppression is a serving rule, and the parent who made the decision remains
   * able to read what they decided about.
   */
  suppressedAt: string | null;
  /**
   * Whether this Explanation may be suppressed right now.
   *
   * **The server's answer, and never a rule the browser re-derives.** It is
   * `suppressionUnlocked(flags) && suppressedAt === null` — the same predicate the API's
   * refusal reads and the same one the Admin queue's two `where` arms state — so the
   * control a parent is offered and the answer they would get cannot disagree. A second
   * derivation in the browser would fail silently in the worst direction: a control
   * offered for a concern nobody confirmed.
   *
   * False on a suppressed entry, because suppression is not reversible and pressing
   * again is not a second decision.
   */
  canSuppress: boolean;
  /** The stored segments, exactly as stored (AD-32). */
  body: RichText;
  /** When a parent first flagged it, or null. */
  parentFlaggedAt: string | null;
  /** When the child first flagged it, or null. */
  studentFlaggedAt: string | null;
  /** What the parent decided about the child's flag, or null for none and for awaiting. */
  studentFlagDisposition: ExplanationFlagDisposition | null;
  /**
   * When that decision was recorded, or null.
   *
   * Beside the disposition rather than folded into it, because the screen states *when* a
   * decision was made and a decision with no instant is one nobody can date. Null exactly
   * where `studentFlagDisposition` is null, and written in the same statement it is — so a
   * screen never has to handle a decision whose instant is missing.
   */
  studentFlagDispositionAt: string | null;
}

/**
 * The one flag fact a **child's** own response carries: their own.
 *
 * A separate interface from the parent's rather than the same one with fields left
 * null, because the shape is the guarantee: there is nowhere here for a parent flag
 * or a disposition to travel, so no change to a student-scoped read can carry one by
 * accident (AD-20, AD-26). A dismissal in particular is recorded and relayed to
 * nobody.
 *
 * It rides on the Explanation response rather than having a read of its own. The
 * panel unmounts on collapse, so reopening it re-issues the `POST .../explanation`,
 * which answers 200 from the stored row — putting the instant on that response means
 * the reported state survives a reload and a re-open with no second request and no
 * new endpoint.
 */
export interface StudentExplanationFlagView {
  /** When this child first reported it, or null. Never anybody else's flag. */
  studentFlaggedAt: string | null;
}

/**
 * One stored row, as it comes back from the read that composes the parent's view.
 *
 * `flags` carries **both origins** since Story 6.3, which is why every flag here
 * brings its `origin` with it and why the mapper below folds rather than indexes. The
 * read can no longer pre-filter to one origin — the parent needs both routes and a
 * disposition — so the place the two routes are told apart is the pure function, not
 * a `where`.
 */
export interface StoredExplanationRow {
  questionId: string;
  body: unknown;
  /** The stored ordinal, straight off the column. */
  generation: number;
  /** The stored instant, or null for a generation still being served. */
  suppressedAt: Date | null;
  flags: readonly {
    origin: ExplanationFlagOrigin;
    createdAt: Date;
    disposition: ExplanationFlagDisposition | null;
    dispositionAt: Date | null;
  }[];
}

/**
 * The stored rows, mapped into what a parent reads — as one pure function.
 *
 * Pure and file-local so the mapping is assertable without a database, for the
 * reason `grading-results.ts` gives about `answerKeyRows`. What the rows *are* is an
 * integration claim; what they *become* is this.
 *
 * **Nothing here invents an entry.** A Question with no stored row is simply absent
 * from the list, and it is the screen that says nothing was explained — a synthesized
 * empty entry would be indistinguishable from an Explanation that came back blank,
 * and the parent would be told their child was shown prose that does not exist.
 *
 * **The fold is by origin, not by position.** `flags[0]` was safe while the read
 * filtered to one origin; with both origins in the list it would be whichever row the
 * planner happened to return first, which is how a child's concern would be reported
 * to a parent as their own. At most one row per origin by the unique key, so `find` is
 * exact rather than a search over an ambiguity.
 *
 * A **parent-origin** flag's disposition is never read, and there is nowhere for it to
 * go if one were somehow written: a parent-origin flag is already the parent's own
 * judgement, so there is nothing for them to decide about it.
 *
 * The order is the read's order and nothing here sorts: the parent's screen groups
 * these by Question id onto answer-key rows that are already in the order the child
 * met them, and the read states the generations oldest first within a Question.
 *
 * **`canSuppress` is computed here and nowhere else.** One predicate, read by the
 * refusal the API would give and by the control the screen draws — which is what keeps
 * one rule in one place.
 */
export function parentExplanationViews(
  rows: readonly StoredExplanationRow[],
): ParentExplanationView[] {
  return rows.map((row) => {
    // At most one of each, by `@@unique([explanationId, origin])`. Found by origin
    // rather than taken by index, because the list now holds both.
    const parentFlag = row.flags.find((flag) => flag.origin === PARENT_FLAG_ORIGIN);
    const studentFlag = row.flags.find((flag) => flag.origin === STUDENT_FLAG_ORIGIN);
    return {
      questionId: row.questionId,
      generation: row.generation,
      suppressedAt: row.suppressedAt?.toISOString() ?? null,
      // The one predicate, applied to the row's own flags. `&& suppressedAt === null`
      // rather than a separate field, because suppression is not reversible: an entry
      // already removed has no second decision to offer.
      canSuppress: suppressionUnlocked(row.flags) && row.suppressedAt === null,
      // Stored segments travel out exactly as stored (AD-32). They were parsed on the
      // way in; re-parsing here would be a second chance for two readings of a row
      // neither of them wrote to disagree.
      body: row.body as RichText,
      // `?? null` rather than a length check, so an unflagged row and a flagged one
      // differ in the value and never in the shape.
      parentFlaggedAt: parentFlag?.createdAt.toISOString() ?? null,
      studentFlaggedAt: studentFlag?.createdAt.toISOString() ?? null,
      // Read off the **student's** flag and only ever that one: a disposition is a
      // decision about a concern the child raised, and a parent-origin flag has none
      // to make.
      studentFlagDisposition: studentFlag?.disposition ?? null,
      studentFlagDispositionAt: studentFlag?.dispositionAt?.toISOString() ?? null,
    };
  });
}
