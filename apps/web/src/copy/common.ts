// Type-only, so it is erased at compile time and this module gains no runtime
// dependency on a `'use client'` one. The four states are the API's own literals.
import type { GradeState } from '@/lib/parent-api';

/**
 * Copy shared by the primitives in `src/components`, and the only place it
 * exists. Plain and factual, no exclamation marks, no blame and no upsell
 * (UX-DR41 voice): a destructive confirmation states what goes and what that
 * costs, and nothing else.
 */
export const commonCopy = {
  destructive: {
    /** Names exactly what will be destroyed — never "this item" (UX-DR27). */
    title: (subject: string) => `Delete ${subject}?`,
    /** The irreversibility, stated rather than implied. */
    irreversible: (subject: string) =>
      `${subject} and everything saved under it will be removed. This cannot be undone.`,
    /** Re-authentication: the account password, not the Parent PIN. */
    passwordLabel: 'Account password',
    passwordHint: 'Enter your account password to confirm.',
    confirm: 'Delete',
    cancel: 'Cancel',
  },
  snackbar: {
    dismiss: 'Dismiss',
  },
  /**
   * The four grade labels, and the **one place they exist**.
   *
   * **Normative literals.** These exact strings are what every surface shows for a
   * grade state — a child's results, and whatever a later story builds for a parent
   * — so a second copy anywhere would be a second vocabulary, and the two would
   * disagree the first time either was reworded. They are here rather than in
   * `student.ts` because they are cross-surface, not because this file is generic.
   *
   * **The same string is the visible label and the announcement.** A marker's icon,
   * frame, glyph, row rule and colour all carry the state as well, but the label is
   * the carrier that survives being read aloud, printed in one ink or seen by
   * someone who cannot separate two hues — and it cannot drift from what assistive
   * technology says, because there is only one string.
   *
   * `Not graded yet` is "nothing has judged this" and never "being graded": nothing
   * is in flight, there is no fifth state, and the sentence that explains the gap is
   * the results surface's own.
   */
  gradeState: {
    Correct: 'Correct',
    Incorrect: 'Not correct',
    Unanswered: 'Unanswered',
    Ungraded: 'Not graded yet',
    // `satisfies` rather than a bare object, so the table is held to the enum: a
    // state renamed or added on the wire fails **here**, at the one place the words
    // are decided, instead of at whichever call site happened to index it first.
  } satisfies Record<GradeState, string>,
} as const;
