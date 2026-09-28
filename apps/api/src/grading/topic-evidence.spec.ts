import { describe, expect, it } from 'vitest';
import {
  partitionTopicEvidence,
  type TopicEvidenceEntry,
  type TopicEvidenceRef,
} from './topic-evidence.js';

/**
 * What belongs in which of the drill-down's two lists, case by case.
 *
 * Every claim here is about **one** rule — which of the four states reaches which
 * list, and in what order the rows come out. Pure, so the counter-examples that
 * matter (a Question nothing judged, an override that moves a row between lists, two
 * Attempts handed in a second apart) are ones no fixture has to be contorted to
 * produce.
 */

/** One entry on the way *in*, whose state may still be any of the four — or absent. */
function ref(over: Partial<TopicEvidenceEntry> & { questionId: string }): TopicEvidenceEntry {
  return {
    attemptId: 'attempt-1',
    practiceTestId: 'test-1',
    submittedAt: '2026-09-01T10:00:00.000Z',
    state: 'Incorrect',
    parentAdjusted: false,
    disputed: false,
    ...over,
  };
}

const idsOf = (rows: readonly TopicEvidenceRef[]) => rows.map((row) => row.questionId);

describe('partitioning one Topic’s evidence', () => {
  it('lists a wrong answer under missed', () => {
    const { missed, unanswered } = partitionTopicEvidence([ref({ questionId: 'q1' })]);
    expect(idsOf(missed)).toEqual(['q1']);
    expect(unanswered).toEqual([]);
  });

  it('lists a blank apart, and never mixed into missed', () => {
    // The whole point of the second list: a Question the child skipped is evidence of
    // neither knowing nor not knowing, exactly as it is in neither term of the figure.
    const { missed, unanswered } = partitionTopicEvidence([
      ref({ questionId: 'q1' }),
      ref({ questionId: 'q2', state: 'Unanswered' }),
    ]);
    expect(idsOf(missed)).toEqual(['q1']);
    expect(idsOf(unanswered)).toEqual(['q2']);
  });

  it('drops a Question nothing has judged, and does not give it a third list', () => {
    // `Ungraded` and a row-less Question are one fact — nothing has judged this — and
    // a gap presented as a finding would be a claim about work nobody marked.
    const { missed, unanswered } = partitionTopicEvidence([
      ref({ questionId: 'q1', state: 'Ungraded' }),
      ref({ questionId: 'q2', state: null }),
    ]);
    expect(missed).toEqual([]);
    expect(unanswered).toEqual([]);
  });

  it('drops a Correct answer: the drill-down is the evidence, not the answer key', () => {
    expect(partitionTopicEvidence([ref({ questionId: 'q1', state: 'Correct' })])).toEqual({
      missed: [],
      unanswered: [],
    });
  });

  it('takes a row out of missed once a parent has overridden it to Correct', () => {
    // The state arriving here is already the effective one, so an override is what
    // decides which list a row lands in — as it decides every other figure.
    const { missed } = partitionTopicEvidence([
      ref({ questionId: 'q1', state: 'Correct', parentAdjusted: true }),
      ref({ questionId: 'q2' }),
    ]);
    expect(idsOf(missed)).toEqual(['q2']);
  });

  it('carries the adjustment and the dispute through onto the row that stays', () => {
    const { missed } = partitionTopicEvidence([
      ref({ questionId: 'q1', parentAdjusted: true, disputed: true }),
    ]);
    expect(missed[0]).toMatchObject({ parentAdjusted: true, disputed: true });
  });

  it('puts no questionId in both lists', () => {
    const { missed, unanswered } = partitionTopicEvidence([
      ref({ questionId: 'q1' }),
      ref({ questionId: 'q2', state: 'Unanswered' }),
      ref({ questionId: 'q3' }),
    ]);
    const overlap = idsOf(missed).filter((id) => idsOf(unanswered).includes(id));
    expect(overlap).toEqual([]);
  });

  it('orders the newest Attempt first, whatever order it was handed the refs in', () => {
    const { missed } = partitionTopicEvidence([
      ref({
        questionId: 'older',
        attemptId: 'attempt-1',
        submittedAt: '2026-09-01T10:00:00.000Z',
      }),
      ref({
        questionId: 'newer',
        attemptId: 'attempt-2',
        submittedAt: '2026-09-08T10:00:00.000Z',
      }),
    ]);
    expect(idsOf(missed)).toEqual(['newer', 'older']);
  });

  it('breaks a tie on the instant by attempt id, descending', () => {
    // Two Attempts handed in inside the same millisecond would otherwise swap places
    // between two reads of unchanged data — and a list that reorders itself on refresh
    // reads as a list telling you something changed. The same total order
    // `submittedAttemptsFor` returns.
    const at = '2026-09-08T10:00:00.000Z';
    const { missed } = partitionTopicEvidence([
      ref({ questionId: 'a', attemptId: 'attempt-a', submittedAt: at }),
      ref({ questionId: 'b', attemptId: 'attempt-b', submittedAt: at }),
    ]);
    expect(idsOf(missed)).toEqual(['b', 'a']);
  });

  it('keeps the order it was given within one Attempt', () => {
    // The number the child was shown is not on this shape, so the `ordinal` tie-break
    // is applied once the words are joined on. Within one run the refs keep their order.
    const { missed } = partitionTopicEvidence([
      ref({ questionId: 'q1' }),
      ref({ questionId: 'q2' }),
      ref({ questionId: 'q3' }),
    ]);
    expect(idsOf(missed)).toEqual(['q1', 'q2', 'q3']);
  });

  it('answers two empty lists over no refs at all', () => {
    expect(partitionTopicEvidence([])).toEqual({ missed: [], unanswered: [] });
  });
});
