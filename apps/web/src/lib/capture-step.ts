/**
 * The upload stepper's rules, as pure functions.
 *
 * They live here rather than inside the capture screen for the reason
 * `page-order.ts`, `classification.ts` and `legibility.ts` do: `apps/web` runs
 * its unit tests without a DOM, so a rule reachable only through a rendered
 * control's `disabled` attribute is a rule no test can state.
 *
 * And there is a second reason this one is a file of its own. "May the parent
 * be on Check yet?" is the same question the submit gate already answers in
 * pieces, so it is asked here once, in terms of those same predicates —
 * `isClassified`, `canSubmitPages`, `isChecked` — rather than restated in the
 * screen. The component holds which step is *shown*; it holds no rule about
 * which step is *allowed*.
 *
 * Nothing here reads a figure, a threshold or a status the API does not state.
 */

import { isClassified } from './classification';
import { isChecked } from './legibility';
import { canSubmitPages } from './page-order';
import type { SourceTestView } from './parent-api';

/** The four steps an upload is taken in, in the order they are taken. */
export type CaptureStep = 'details' | 'pages' | 'check' | 'generate';

/**
 * The order itself, as the one tuple every index, next and previous is read
 * from — so "after Pages comes Check" is written down once.
 */
export const CAPTURE_STEPS = [
  'details',
  'pages',
  'check',
  'generate',
] as const satisfies readonly CaptureStep[];

/**
 * As much of a Source Test as any rule below actually reads.
 *
 * Four booleans rather than the view itself, so every rule is statable against
 * a state a test can write out in full — all sixteen combinations of it, the
 * ones the server never produces included.
 *
 * `checked` is carried although no rule below reads it: the check step is
 * complete when the upload is *committed*, not when the check has run, because
 * the check is advisory and running it moves the parent nowhere. It is here
 * because it is part of the saved state this screen's steps are about, and
 * Story 3.8's Check step reads it.
 */
export interface CaptureStepState {
  classified: boolean;
  hasPages: boolean;
  checked: boolean;
  submitted: boolean;
}

/**
 * The state, built from the server's own account of the draft.
 *
 * `null` — no draft open yet, or one still being read — is all-false rather
 * than a thrown error: the screen renders its first step while the open-or-
 * resume call is in flight, and a step state is exactly what it needs then.
 *
 * The page count is the count of pages that actually landed: the server's gate
 * counts `Ready` rows alone, so a page still uploading is not one yet. Whether
 * that count is enough is `canSubmitPages`'s sentence and is called rather than
 * restated.
 */
export function captureStepState(view: SourceTestView | null): CaptureStepState {
  if (view === null) {
    return { classified: false, hasPages: false, checked: false, submitted: false };
  }
  const readyPageCount = view.pages.filter((page) => page.state === 'Ready').length;
  return {
    classified: isClassified(view),
    hasPages: canSubmitPages(readyPageCount),
    checked: isChecked(view),
    submitted: view.status === 'Submitted',
  };
}

/**
 * Whether a step's own condition is met.
 *
 * Details is complete when the upload is classified — which is why a Grade
 * Level offering no Subjects is a dead end rather than a step to press through.
 * Pages is complete when at least one page landed. Check is complete when the
 * upload was committed, because that is the only thing the Check step produces.
 * Generate is never complete: it is the last step, and what happens past it is
 * another screen's.
 *
 * A committed upload completes all three steps before Generate outright, and
 * not only Check. Everything those steps were for has happened — it is the
 * whole meaning of the commit — so none of them may read as unfinished
 * afterwards, however the pages it was made of are reported later. Deriving
 * them from the state instead would make the rail disagree with itself the
 * moment the page rows stop being `Ready`, which Epic 8's expiry eventually
 * does to every upload.
 */
export function isStepComplete(step: CaptureStep, state: CaptureStepState): boolean {
  switch (step) {
    case 'details':
      return state.submitted || state.classified;
    case 'pages':
      return state.submitted || state.hasPages;
    case 'check':
      return state.submitted;
    case 'generate':
      return false;
  }
}

/**
 * Whether Next is offered from this step.
 *
 * The same sentence as `isStepComplete`, deliberately: a step is left when the
 * thing it is for has been done, and there is no second notion of readiness for
 * the two to drift apart on. It is named separately because the rail asks the
 * first question and the button asks the second, and a later story may have to
 * tell them apart.
 */
export function canAdvance(step: CaptureStep, state: CaptureStepState): boolean {
  return isStepComplete(step, state);
}

/** The step after this one, or null at the end of the flow. */
export function nextStep(step: CaptureStep): CaptureStep | null {
  return CAPTURE_STEPS[stepIndex(step) + 1] ?? null;
}

/** The step before this one, or null at the start of it. */
export function previousStep(step: CaptureStep): CaptureStep | null {
  const index = stepIndex(step);
  return index <= 0 ? null : CAPTURE_STEPS[index - 1]!;
}

/**
 * The furthest step this draft's saved state allows, which is the step a
 * reload or a resumed draft opens on.
 *
 * A committed upload answers `generate` on the commit alone. Gating that on the
 * pages as well would strand the parent exactly where the product expects them
 * to still be working: the Extraction deliberately outlives the page images, so
 * a committed upload whose pages are gone is a normal thing to come back to,
 * and its Generate step must stay reachable. Every other branch names each
 * condition up to it, so no uncommitted draft is ever opened on a step whose
 * predecessors are unmet.
 */
export function furthestStep(state: CaptureStepState): CaptureStep {
  if (state.submitted) return 'generate';
  if (state.classified && state.hasPages) return 'check';
  if (state.classified) return 'pages';
  return 'details';
}

/** Where this step sits in the flow, counting from zero. */
export function stepIndex(step: CaptureStep): number {
  return CAPTURE_STEPS.indexOf(step);
}
