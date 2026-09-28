import type { GradeState } from '../generated/prisma/enums.js';

/**
 * What belongs in which of the drill-down's two lists, as one pure function.
 *
 * **A rule, and a rule belongs in a spec rather than in a screen.** "A blank is
 * listed apart from a wrong answer, and a Question nothing judged is listed in
 * neither" is exactly the statement FR-26 makes about Mastery's two terms, read
 * back out over the members of the window instead of over the counts. If the
 * partition lived in the composition — or worse, in a `.filter` inside a
 * component — then the list a parent reads and the figure above it would be two
 * answers to one question, and they would disagree the first time either was
 * touched.
 *
 * Pure and dependency-free, for the reason `mastery.ts` and
 * `mastery-eligibility.ts` give: which rows exist is an integration claim, what
 * they come to is this.
 */

/**
 * The only two states a listed row can be in.
 *
 * **A type and not a comment**, so a reader of either list needs no cast and no
 * defensive arm to know what it is holding. The partition is the one place the other
 * two states — `Ungraded` and a Question with no grade row — are dropped, and
 * narrowing here is what makes that a fact the compiler carries downstream rather
 * than one every consumer has to take on trust.
 */
export type TopicEvidenceState = 'Incorrect' | 'Unanswered';

/**
 * One tagged Question of one Attempt in a Topic's window, before the partition.
 *
 * `state` is the **effective** state — `effectiveStateOf` has already been applied,
 * so a parent's override is what counts here — and `null` is a Question with no
 * grade row at all. The two absences are one fact (nothing has judged this) exactly
 * as they are in `masteryFrom`, which is why neither reaches a list below.
 *
 * There is deliberately no `ordinal` and no prompt. The number a child was shown and
 * the words of a Question are `practicetest`'s (AD-17), joined onto these refs
 * afterwards; a shape that could carry them here would be `grading` growing a
 * delegate it must not have.
 *
 * `parentAdjusted` and `disputed` are booleans for the reason `AnswerKeyRowView`'s
 * are: the row reads as the mark it now is, plus the fact that somebody settled it.
 * No direction, no instant and no prior verdict.
 */
export interface TopicEvidenceEntry {
  attemptId: string;
  questionId: string;
  practiceTestId: string;
  /** When that Attempt was handed in. ISO, for ordering and for labelling. */
  submittedAt: string;
  /** The effective state, or null for a Question with no grade row. */
  state: GradeState | null;
  parentAdjusted: boolean;
  disputed: boolean;
}

/**
 * One row of one of the two lists: an entry whose state is one the list is named
 * after.
 *
 * The **only** difference from `TopicEvidenceEntry` is that `state` can no longer be
 * absent or `Ungraded`, which is exactly what surviving the partition means.
 */
export interface TopicEvidenceRef extends TopicEvidenceEntry {
  state: TopicEvidenceState;
}

/** The two lists the drill-down states, and they never overlap. */
export interface TopicEvidencePartition {
  /** Every `Incorrect` ref — the Questions a parent came here to read. */
  missed: TopicEvidenceRef[];
  /** Every `Unanswered` ref, listed **apart** and never mixed into `missed`. */
  unanswered: TopicEvidenceRef[];
}

/**
 * The window's refs, split into the two lists, newest Attempt first.
 *
 * **Four states in, two lists out, and the two states that are left out are the two
 * that enter neither term of the Mastery fraction.** `Ungraded` and a ref with no
 * grade row are dropped: nothing has judged them, so a parent reading "these are the
 * ones they got wrong" would be reading a claim about work nothing marked. They are
 * not a third list either — that would be a gap presented as a finding.
 *
 * **`Correct` is dropped too**, and that is the whole point of the screen: the
 * drill-down is the evidence behind a weak figure, not a re-run of the answer key.
 * The figure above it already states how many were right.
 *
 * **Newest Attempt first**, by `submittedAt` descending with `attemptId` descending
 * as the tie-break — the same total order `submittedAttemptsFor` returns and the
 * window was taken from, restated here so a caller that handed the refs over in some
 * other order still gets one answer. Two Attempts handed in inside the same
 * millisecond would otherwise swap places between two reads of unchanged data.
 *
 * Within one Attempt the refs keep the order they arrived in. The number the child
 * was shown is `practicetest`'s column and is not on this shape at all, so the
 * `ordinal` tie-break is applied once the words are joined on — in
 * `analytics-view.ts`'s `drillDownRowsOf`, which is the one place that holds both.
 */
export function partitionTopicEvidence(
  entries: readonly TopicEvidenceEntry[],
): TopicEvidencePartition {
  const ordered = [...entries].sort((left, right) => {
    if (left.submittedAt !== right.submittedAt) {
      return left.submittedAt < right.submittedAt ? 1 : -1;
    }
    if (left.attemptId !== right.attemptId) return left.attemptId < right.attemptId ? 1 : -1;
    return 0;
  });
  const missed: TopicEvidenceRef[] = [];
  const unanswered: TopicEvidenceRef[] = [];
  for (const entry of ordered) {
    // Rebuilt with the narrowed state rather than pushed through a cast: the row's
    // state *is* which list it is in, and spelling it out here is what lets every
    // reader downstream hold a `TopicEvidenceRef` and need no assertion.
    if (entry.state === 'Incorrect') missed.push({ ...entry, state: entry.state });
    if (entry.state === 'Unanswered') unanswered.push({ ...entry, state: entry.state });
  }
  return { missed, unanswered };
}
