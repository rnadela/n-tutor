import type { MasteryTopicView } from '@/lib/parent-api';

/**
 * The dashboard's presentation rules, as pure functions.
 *
 * `apps/web` runs its unit suite with `environment: 'node'`, so a rule expressed
 * inside a component is a rule no test can read back. These are the decisions the
 * page makes about what it shows — which subjects are offerable, which rows a
 * choice keeps, what a fraction reads as, and how far along an empty dashboard is
 * — and each of them is assertable here without a DOM.
 *
 * **Nothing here decides a Weak Area and nothing here states a threshold.** The
 * verdict arrives on each row and the two figures it was resolved against arrive
 * on the response; a comparison or a constant in this file would be a second
 * classifier that disagreed with the API the day either figure was retuned.
 *
 * **Nothing here re-sorts the table either.** The order is the API's answer, and
 * a filter returns the rows it kept *in the order they arrived*.
 */

/** One Subject a parent can narrow the table to. */
export interface SubjectOption {
  /** `null` is the group of rows whose Subject no longer resolves. */
  subjectId: string | null;
  /** `null` alongside a null id — the caller supplies the wording. */
  subjectName: string | null;
}

/**
 * The Subjects actually present in this table, in the order they first appear.
 *
 * **Derived from the rows and never from a Subject list.** Offering a Subject the
 * student has no topic in would be a filter that empties the table and tells the
 * parent nothing, and a Subject list read from elsewhere could offer exactly that.
 *
 * Rows whose Subject no longer resolves collapse into one `null` option rather
 * than one option each: they are not several subjects, they are the rows that have
 * lost their label.
 */
export function subjectOptions(topics: readonly MasteryTopicView[]): SubjectOption[] {
  const seen = new Set<string | null>();
  const options: SubjectOption[] = [];
  for (const topic of topics) {
    if (seen.has(topic.subjectId)) continue;
    seen.add(topic.subjectId);
    options.push({ subjectId: topic.subjectId, subjectName: topic.subjectName });
  }
  return options;
}

/**
 * The rows one Subject choice keeps, in the order they arrived.
 *
 * `undefined` is "no choice made" and keeps everything. `null` is a choice — the
 * rows with no Subject — and is not the same thing, which is why the absence is
 * `undefined` rather than being folded into the null case.
 */
export function filterBySubject(
  topics: readonly MasteryTopicView[],
  subjectId: string | null | undefined,
): MasteryTopicView[] {
  if (subjectId === undefined) return [...topics];
  return topics.filter((topic) => topic.subjectId === subjectId);
}

/**
 * A stored fraction as a whole percentage, or `null` when there is no fraction.
 *
 * **Null in, null out, and never a zero.** A topic the student skipped entirely
 * has no fraction, and rendering that as `0%` would tell a parent their child got
 * everything wrong on a topic they never answered.
 *
 * Rounded to whole percent, because a dashboard reading `39.99999%` is a dashboard
 * reporting a float's error to a parent.
 */
export function masteryPercent(value: number | null): number | null {
  if (value === null) return null;
  return Math.round(value * 100);
}

/** What an empty dashboard can truthfully say about how far along the student is. */
export interface EmptyStateProgress {
  /** What the API said it takes. Never a figure this app knows on its own. */
  answeredFloor: number;
  /** Practice tests the student has finished. The evidence a figure is coming. */
  completed: number;
  /** Practice tests they are part-way through. */
  inProgress: number;
  /**
   * Whether there is any finished or started work at all to state progress about.
   *
   * **Read off the activity summary and never off the topics.** This function is
   * only ever called when there are no topic rows, so a signal derived from those
   * rows is a constant: it would make the progress sentence unreachable and would
   * tell a student who *has* finished work that they have finished none. The
   * activity counts are the one thing on the response that is still true in this
   * branch.
   */
  hasWork: boolean;
}

/** The two activity figures the empty state reads. A subset, so the page's whole
 * `ActivitySummaryView` satisfies it and nothing has to be unpacked at the call. */
export interface EmptyStateActivity {
  completed: number;
  inProgress: number;
}

/**
 * The progress an empty dashboard states.
 *
 * The empty state has to say more than "nothing here": it says what makes a figure
 * appear and how close the student is, which is the difference between a parent
 * who waits and a parent who concludes the product is broken. The floor is the
 * API's — this module states no threshold of its own.
 *
 * **It takes the activity summary and not the topics**, because it is only ever
 * rendered when there are no topics: the two states it has to tell apart are "no
 * practice test finished yet" and "work finished, but no topic has enough answered
 * questions on it yet", and only the activity counts distinguish them. A student in
 * the second state told the first is told something false.
 */
export function emptyStateProgress(
  activity: EmptyStateActivity,
  answeredFloor: number,
): EmptyStateProgress {
  return {
    answeredFloor,
    completed: activity.completed,
    inProgress: activity.inProgress,
    hasWork: activity.completed > 0 || activity.inProgress > 0,
  };
}
