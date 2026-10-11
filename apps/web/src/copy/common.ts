// Type-only, so it is erased at compile time and this module gains no runtime
// dependency on a `'use client'` one. The four states are the API's own literals.
import type { GradeState } from '@/lib/parent-api';

/**
 * What the product is called. Held in a `const` as well as on `commonCopy`
 * because the install banner's own lines name it, and an object literal cannot
 * read its own field — two spellings of the app's name is exactly what
 * `commonCopy.appName` exists to prevent.
 */
const APP_NAME = 'n-tutor';

/**
 * Copy shared by the primitives in `src/components`, and the only place it
 * exists. Plain and factual, no exclamation marks, no blame and no upsell
 * (UX-DR41 voice): a destructive confirmation states what goes and what that
 * costs, and nothing else.
 */
export const commonCopy = {
  /**
   * What the product is called, and the **one place it is decided**.
   *
   * This is the installed app's `name` and `short_name` — the words under the
   * icon on a home screen — so it has to be a copy-module string rather than a
   * literal inside the manifest route (AD-32: no user-facing literal inside a
   * module that renders). `adminCopy.appName` is the Admin console's own window
   * title and names a different thing; reusing it would put "Admin" on a
   * family's home screen.
   */
  appName: APP_NAME,
  /**
   * The install banner's every word, for both surfaces and both install paths
   * (AD-32: no user-facing literal inside a module that renders).
   *
   * One offer, stated plainly and once. No exclamation mark, no urgency and no
   * second ask (UX-DR41): a family that does not want the app on the home
   * screen has said so by dismissing it.
   */
  installBanner: {
    /**
     * The region's accessible name. It names the app rather than saying
     * "banner": a screen-reader user hears what the region is for, and the
     * word "region" is already announced by the role.
     */
    regionName: `Install ${APP_NAME}`,
    /** Parent View: the parent is the one who installs it, on their device. */
    parent: `Add ${APP_NAME} to this device’s home screen to open it without the browser.`,
    /** Student Home: addressed to the child, in the second person. */
    student: `Add ${APP_NAME} to your home screen to open it like any other app.`,
    /**
     * iOS and iPadOS, where no prompt exists and the only install path is a
     * menu the person has to find. Both steps are named exactly as Safari
     * labels them, because a paraphrase is a step nobody can follow.
     */
    iosSteps: `To add ${APP_NAME} to your home screen, tap Share in the browser toolbar, then tap Add to Home Screen.`,
    /**
     * The one consequence worth stating up front: the home-screen window is a
     * fresh place to the browser, so the device signs in there once more.
     */
    iosSignIn: 'You will be asked to sign in once the first time you open it from there.',
    /** The action, where the browser deferred a prompt for us to show. */
    action: 'Install',
    /** The way out, on every variant. */
    dismiss: 'Dismiss',
  },
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
