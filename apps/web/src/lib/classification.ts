/**
 * The classification rules, as pure functions.
 *
 * They live here rather than inside the capture screen for the reason
 * `page-order.ts` does: `apps/web` runs its unit tests without a DOM, so a rule
 * reachable only through a rendered control's `disabled` attribute is a rule no
 * test can state. The screen reads them; it never restates them.
 *
 * Every one of them is a mirror of a server refusal and only a mirror. The
 * server refuses an unclassified submission whatever the browser did, and it
 * decides on its own which Subjects a Grade Level offers — nothing here filters
 * a list or re-derives an availability rule.
 */

import { isChecked, type Checkable } from './legibility';
import { canSubmitPages } from './page-order';
import type { TaxonomyItem } from './parent-api';

/** As much of a Source Test as any rule below actually reads. */
export interface Classifiable {
  subjectId: string | null;
  gradeLevelId: string | null;
}

/**
 * Whether both halves of the classification are set.
 *
 * Non-null, never enabled — the same assertion the server's own submit gate
 * makes. A Subject an administrator disables after a parent chose it keeps
 * submitting, so there is nothing about enablement for this to read.
 */
export function isClassified(view: Classifiable): boolean {
  return view.subjectId !== null && view.gradeLevelId !== null;
}

/**
 * Which requirement the submit control is refused for. Three of them, so the
 * order is the order the screen states them in — and the order the parent can
 * act on them in: pages first, then what the upload is of, then the check over
 * the pages they ended up with.
 */
export type SubmitBlocker = 'pages' | 'classification' | 'legibility';

/**
 * Every unmet requirement, in reading order — empty when submission is offered.
 *
 * A list rather than a first-failure, because more than one can be unmet at
 * once and a parent told only about the pages would fix them and be refused
 * again for the classification they were never told about.
 *
 * The page count is the count of pages that actually landed: the server's gate
 * counts `Ready` rows alone, so a page still uploading is not one yet. Whether
 * that count is enough is `canSubmitPages`'s sentence and is called rather than
 * restated — two copies of one bound are two things that can disagree.
 *
 * The legibility reason is whether the check **ran**, never what it said:
 * `Low` is advisory and the server commits over it, so a rule that read a
 * verdict here would disable a control the server would have honoured. This is
 * the one function that decides why the submit is refused — `legibility.ts`
 * re-exports the type rather than growing a second one.
 */
export function submitBlockedReasons(
  view: Classifiable & Checkable,
  readyPageCount: number,
): SubmitBlocker[] {
  const reasons: SubmitBlocker[] = [];
  if (!canSubmitPages(readyPageCount)) reasons.push('pages');
  if (!isClassified(view)) reasons.push('classification');
  if (!isChecked(view)) reasons.push('legibility');
  return reasons;
}

/**
 * The options a classification select renders: everything currently offered,
 * plus whatever the Source Test already holds.
 *
 * An administrator may disable a Subject or a Grade Level after a parent chose
 * it, and a stored reference keeps resolving on purpose — the submit gate
 * asserts non-null and never enabled. So an offered list, which holds only
 * selectable rows, is not on its own an account of what the upload *is*:
 * rendering the control blank would tell a parent nothing is chosen about an
 * upload that is classified and submittable. The stored row is appended
 * instead, named by the label the API resolved for it, and it is still offered
 * to nobody who has not already got it.
 *
 * This changes what the control *shows*, never what may be chosen and never the
 * submit gate — both of those stay the server's.
 */
export function optionsWithStored(
  offered: readonly TaxonomyItem[],
  storedId: string | null,
  storedName: string | null,
): TaxonomyItem[] {
  if (storedId === null || storedName === null) return [...offered];
  if (offered.some((item) => item.id === storedId)) return [...offered];
  // `enabled: false` is the honest flag: the row is here precisely because it
  // is not among the selectable ones.
  return [...offered, { id: storedId, name: storedName, enabled: false }];
}

/**
 * Which sentence the classification write's announcement is, decided from the
 * answer the server actually returned rather than from what the patch asked
 * for — the answer is the only place a Grade Level change that drops the
 * stored Subject shows up, since clearing it is the server's decision, not
 * this one's.
 */
export type ClassificationAnnouncement =
  | { kind: 'subjectSet'; subjectName: string }
  | { kind: 'gradeLevelSet'; gradeLevelName: string }
  | { kind: 'gradeLevelSetSubjectCleared'; gradeLevelName: string };

/**
 * A patch that carries only `subjectId` announces the Subject; one that
 * carries `gradeLevelId` (alone or paired with a Subject) announces the Grade
 * Level, naming whether the write cleared the stored Subject along the way.
 * Today's screen only ever sends one field at a time, so the paired case is
 * untested by any caller — see the deferred note on a combined patch's
 * announcement leaving the Subject unmentioned.
 */
export function classificationAnnouncement(
  before: Classifiable,
  patch: { subjectId?: string; gradeLevelId?: string },
  after: { subjectId: string | null; subjectName: string | null; gradeLevelName: string | null },
): ClassificationAnnouncement {
  if (patch.gradeLevelId === undefined) {
    return { kind: 'subjectSet', subjectName: after.subjectName ?? '' };
  }
  const gradeLevelName = after.gradeLevelName ?? '';
  return before.subjectId !== null && after.subjectId === null
    ? { kind: 'gradeLevelSetSubjectCleared', gradeLevelName }
    : { kind: 'gradeLevelSet', gradeLevelName };
}
