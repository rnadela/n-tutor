import { describe, expect, it } from 'vitest';
import {
  answeredCount,
  firstNotAnsweredIndex,
  isAnswered,
  notAnswered,
  progressOf,
  type QuestionRef,
} from './answers';

const ORDER: QuestionRef[] = [
  { id: 'q-a', ordinal: 1 },
  { id: 'q-b', ordinal: 2 },
  { id: 'q-c', ordinal: 3 },
];

describe('what counts as answered', () => {
  it('is any text the child actually left behind', () => {
    expect(isAnswered('3/4')).toBe(true);
    expect(isAnswered('one half')).toBe(true);
    // A Multiple Choice selection is carried as the chosen ordinal.
    expect(isAnswered('2')).toBe(true);
  });

  it('is not a Question that was never touched', () => {
    // Absent, never `''`: "never answered" and "answered then cleared" are one
    // state, because to a child they are.
    expect(isAnswered(undefined)).toBe(false);
  });

  it('is not a field emptied back to nothing, or to whitespace', () => {
    expect(isAnswered('')).toBe(false);
    expect(isAnswered('   ')).toBe(false);
    expect(isAnswered('\n\t')).toBe(false);
  });
});

describe('the count and the per-question states', () => {
  it('agree with each other', () => {
    const answers = { 'q-a': '3/4', 'q-c': '  ' };
    const states = progressOf(ORDER, answers);
    expect(states.filter((question) => question.state === 'answered')).toHaveLength(
      answeredCount(ORDER, answers),
    );
    expect(states.map((question) => question.state)).toEqual([
      'answered',
      'not-answered',
      'not-answered',
    ]);
  });

  it('counts nothing when nothing has been answered', () => {
    expect(answeredCount(ORDER, {})).toBe(0);
    expect(progressOf(ORDER, {}).every((question) => question.state === 'not-answered')).toBe(true);
  });

  it('ignores an answer for a Question that is not in this test', () => {
    // A stale entry cannot inflate the figure the map states.
    expect(answeredCount(ORDER, { 'q-a': 'x', 'q-elsewhere': 'y' })).toBe(1);
  });

  it('holds only the two words, and never a third', () => {
    const states = new Set(progressOf(ORDER, { 'q-b': 'x' }).map((question) => question.state));
    for (const state of states) expect(['answered', 'not-answered']).toContain(state);
  });
});

describe('the order the map is drawn in', () => {
  it('is the order it was given, never sorted', () => {
    // The server's stored ordinal order is the order shown. A map that reordered
    // itself as answers arrived would move the cell under the child's finger.
    const shuffled: QuestionRef[] = [
      { id: 'q-c', ordinal: 3 },
      { id: 'q-a', ordinal: 1 },
      { id: 'q-b', ordinal: 2 },
    ];
    expect(progressOf(shuffled, {}).map((question) => question.id)).toEqual(['q-c', 'q-a', 'q-b']);
    expect(progressOf(shuffled, {}).map((question) => question.ordinal)).toEqual([3, 1, 2]);
  });

  it('does not mutate what it was handed', () => {
    const order = [...ORDER];
    progressOf(order, { 'q-a': 'x' });
    answeredCount(order, { 'q-a': 'x' });
    expect(order).toEqual(ORDER);
  });
});

describe('which Questions are not answered, and which one to go back to', () => {
  it('names as many as the map states in its own summary, for the same input', () => {
    // The dialog's count and the map's figure are the same claim about the same
    // input. Derived from one predicate here so they cannot drift apart there.
    const answers = { 'q-a': '3/4' };
    const states = progressOf(ORDER, answers);
    expect(notAnswered(ORDER, answers)).toHaveLength(states.length - answeredCount(ORDER, answers));
    expect(notAnswered(ORDER, answers).map((question) => question.ordinal)).toEqual([2, 3]);
  });

  it('counts a Question answered and then cleared, because to a child it is not answered', () => {
    expect(notAnswered(ORDER, { 'q-a': '3/4', 'q-b': '' }).map((q) => q.id)).toEqual([
      'q-b',
      'q-c',
    ]);
  });

  it('counts whitespace as not answered', () => {
    expect(
      notAnswered(ORDER, { 'q-a': '   ', 'q-b': '\n\t', 'q-c': 'x' }).map((q) => q.id),
    ).toEqual(['q-a', 'q-b']);
  });

  it('is empty when every Question in the order is answered', () => {
    expect(notAnswered(ORDER, { 'q-a': '1', 'q-b': '2', 'q-c': '3' })).toEqual([]);
    expect(firstNotAnsweredIndex(ORDER, { 'q-a': '1', 'q-b': '2', 'q-c': '3' })).toBeNull();
  });

  it('points at the earliest one in the order given, never merely at one of them', () => {
    // The order given, not the ordinals: the screen navigates by index.
    expect(firstNotAnsweredIndex(ORDER, { 'q-a': '1', 'q-c': '3' })).toBe(1);
    expect(firstNotAnsweredIndex(ORDER, {})).toBe(0);
    const shuffled: QuestionRef[] = [
      { id: 'q-c', ordinal: 3 },
      { id: 'q-a', ordinal: 1 },
      { id: 'q-b', ordinal: 2 },
    ];
    expect(firstNotAnsweredIndex(shuffled, { 'q-c': 'x' })).toBe(1);
  });

  it('is unmoved by an answer held for a Question that is not in the order', () => {
    // A stale entry can neither hide a blank nor invent one.
    expect(notAnswered(ORDER, { 'q-elsewhere': 'x' })).toHaveLength(ORDER.length);
    expect(firstNotAnsweredIndex(ORDER, { 'q-elsewhere': 'x' })).toBe(0);
    expect(
      firstNotAnsweredIndex(ORDER, { 'q-a': '1', 'q-b': '2', 'q-c': '3', 'q-elsewhere': '' }),
    ).toBeNull();
  });

  it('does not mutate what it was handed', () => {
    const order = [...ORDER];
    notAnswered(order, { 'q-a': 'x' });
    firstNotAnsweredIndex(order, { 'q-a': 'x' });
    expect(order).toEqual(ORDER);
  });
});
