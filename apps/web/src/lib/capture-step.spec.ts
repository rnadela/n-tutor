import { describe, expect, it } from 'vitest';
import {
  CAPTURE_STEPS,
  canAdvance,
  captureStepState,
  furthestStep,
  isStepComplete,
  nextStep,
  previousStep,
  stepIndex,
  type CaptureStep,
  type CaptureStepState,
} from './capture-step';
import type { PageImageView, SourceTestView } from './parent-api';

function page(ordinal: number, state: PageImageView['state'] = 'Ready'): PageImageView {
  return {
    id: `page-${ordinal}`,
    ordinal,
    state,
    width: 40,
    height: 60,
    byteSize: 512,
    legibility: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    bytesDeletedAt: null,
  };
}

/** A draft as the API answers an open with: the Grade Level seeded, no Subject. */
function draft(overrides: Partial<SourceTestView> = {}): SourceTestView {
  return {
    id: 'source-test-1',
    studentProfileId: 'student-1',
    status: 'Draft',
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-04T00:00:00.000Z',
    submittedAt: null,
    subjectId: null,
    subjectName: null,
    gradeLevelId: 'grade-1',
    gradeLevelName: 'Grade 4',
    legibilityCheckedAt: null,
    maxPages: 10,
    pages: [],
    ...overrides,
  };
}

const CLASSIFIED = { subjectId: 'subject-1', subjectName: 'Maths' } as const;

/** Every one of the sixteen states, so no rule is covered only where it is true. */
const ALL_STATES: CaptureStepState[] = [false, true].flatMap((classified) =>
  [false, true].flatMap((hasPages) =>
    [false, true].flatMap((checked) =>
      [false, true].map((submitted) => ({ classified, hasPages, checked, submitted })),
    ),
  ),
);

describe('the state the steps are decided from', () => {
  it('reads all-false with no draft open, rather than throwing', () => {
    // The screen renders its first step while the open-or-resume call is in
    // flight, and this is the state it renders it from.
    expect(captureStepState(null)).toEqual({
      classified: false,
      hasPages: false,
      checked: false,
      submitted: false,
    });
  });

  it('is unclassified while the Subject is unset, Grade Level seeded or not', () => {
    expect(captureStepState(draft()).classified).toBe(false);
    expect(captureStepState(draft({ gradeLevelId: null, gradeLevelName: null })).classified).toBe(
      false,
    );
    expect(captureStepState(draft({ ...CLASSIFIED })).classified).toBe(true);
  });

  it('counts only the pages that landed, the way the server’s gate does', () => {
    // A row stranded in `Uploading` holds no bytes yet, so it is not a page the
    // parent may move on from.
    expect(captureStepState(draft({ pages: [page(1, 'Uploading')] })).hasPages).toBe(false);
    expect(captureStepState(draft({ pages: [page(1)] })).hasPages).toBe(true);
    expect(captureStepState(draft({ pages: [page(1, 'Deleted')] })).hasPages).toBe(false);
  });

  it('reads the check from whether it ran, and the commit from the status', () => {
    expect(captureStepState(draft()).checked).toBe(false);
    expect(
      captureStepState(draft({ legibilityCheckedAt: '2026-01-02T00:00:00.000Z' })).checked,
    ).toBe(true);
    expect(captureStepState(draft()).submitted).toBe(false);
    expect(captureStepState(draft({ status: 'Submitted' })).submitted).toBe(true);
  });
});

describe('when a step is complete, and when Next is offered', () => {
  it('completes Details on the classification alone', () => {
    for (const state of ALL_STATES) {
      expect(isStepComplete('details', state)).toBe(state.submitted || state.classified);
    }
  });

  it('completes Pages on a page having landed', () => {
    for (const state of ALL_STATES) {
      expect(isStepComplete('pages', state)).toBe(state.submitted || state.hasPages);
    }
  });

  it('completes every step before Generate on the commit, however the pages read later', () => {
    // Epic 8 eventually deletes the page bytes of every upload, and the rows go
    // with them. A committed upload must not start reading as half-finished
    // when that happens: the steps were finished by the commit.
    const expired = { classified: false, hasPages: false, checked: false, submitted: true };
    expect(isStepComplete('details', expired)).toBe(true);
    expect(isStepComplete('pages', expired)).toBe(true);
    expect(isStepComplete('check', expired)).toBe(true);
    expect(isStepComplete('generate', expired)).toBe(false);
  });

  it('completes Check on the commit, never on the check having run', () => {
    // The check is advisory: running it produces nothing and moves the parent
    // nowhere, so it is the commit that finishes this step.
    for (const state of ALL_STATES) {
      expect(isStepComplete('check', state)).toBe(state.submitted);
    }
    expect(isStepComplete('check', { ...ALL_STATES[0]!, checked: true })).toBe(false);
  });

  it('never completes Generate: it is the last step, and past it is another screen', () => {
    for (const state of ALL_STATES) {
      expect(isStepComplete('generate', state)).toBe(false);
    }
  });

  it('offers Next on exactly the condition that completes the step', () => {
    // One notion of readiness, so the rail and the button cannot disagree.
    for (const state of ALL_STATES) {
      for (const step of CAPTURE_STEPS) {
        expect(canAdvance(step, state)).toBe(isStepComplete(step, state));
      }
    }
  });
});

describe('moving between the steps', () => {
  it('walks the four steps in order', () => {
    expect(CAPTURE_STEPS).toEqual(['details', 'pages', 'check', 'generate']);
    expect(nextStep('details')).toBe('pages');
    expect(nextStep('pages')).toBe('check');
    expect(nextStep('check')).toBe('generate');
    expect(previousStep('generate')).toBe('check');
    expect(previousStep('check')).toBe('pages');
    expect(previousStep('pages')).toBe('details');
  });

  it('answers null at both ends rather than wrapping around', () => {
    expect(nextStep('generate')).toBeNull();
    expect(previousStep('details')).toBeNull();
  });

  it('indexes every step from zero, in flow order', () => {
    expect(CAPTURE_STEPS.map((step) => stepIndex(step))).toEqual([0, 1, 2, 3]);
  });
});

describe('the step a draft opens on', () => {
  it('opens on Details for a fresh draft with the grade level seeded and no subject', () => {
    expect(furthestStep(captureStepState(draft()))).toBe('details');
  });

  it('opens on Details when nothing is open at all', () => {
    expect(furthestStep(captureStepState(null))).toBe('details');
  });

  it('opens on Pages for a classified draft with no page yet', () => {
    expect(furthestStep(captureStepState(draft({ ...CLASSIFIED })))).toBe('pages');
  });

  it('keeps a classified draft on Pages while its only page is still uploading', () => {
    expect(
      furthestStep(captureStepState(draft({ ...CLASSIFIED, pages: [page(1, 'Uploading')] }))),
    ).toBe('pages');
  });

  it('opens on Check once a page has landed', () => {
    expect(furthestStep(captureStepState(draft({ ...CLASSIFIED, pages: [page(1)] })))).toBe(
      'check',
    );
  });

  it('opens on Check for a draft already checked but not committed', () => {
    expect(
      furthestStep(
        captureStepState(
          draft({
            ...CLASSIFIED,
            pages: [page(1)],
            legibilityCheckedAt: '2026-01-02T00:00:00.000Z',
          }),
        ),
      ),
    ).toBe('check');
  });

  it('opens on Generate for a committed upload whose pages are already gone', () => {
    // The Extraction deliberately outlives the page images, so this is a normal
    // upload to come back to — and its Generate step is the only thing left on
    // the screen for it.
    expect(
      furthestStep({ classified: false, hasPages: false, checked: false, submitted: true }),
    ).toBe('generate');
  });

  it('opens on Generate for a committed upload', () => {
    expect(
      furthestStep(
        captureStepState(
          draft({
            ...CLASSIFIED,
            status: 'Submitted',
            submittedAt: '2026-01-02T00:00:00.000Z',
            legibilityCheckedAt: '2026-01-02T00:00:00.000Z',
            pages: [page(1)],
          }),
        ),
      ),
    ).toBe('generate');
  });

  it('never names a step whose predecessors are not all complete', () => {
    // The invariant the whole navigation rests on, asserted over every state —
    // the ones the server never answers with included.
    for (const state of ALL_STATES) {
      const furthest = furthestStep(state);
      for (const step of CAPTURE_STEPS.slice(0, stepIndex(furthest))) {
        expect(isStepComplete(step as CaptureStep, state)).toBe(true);
      }
    }
  });
});
