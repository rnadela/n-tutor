/**
 * What a Student Profile deletion would destroy, as the API reports it.
 *
 * Type-only, so this module gains no runtime dependency on a `'use client'` one
 * — the same arrangement `common.ts` makes for `GradeState`. The field names are
 * the API's own: one shape, named once, and no second vocabulary for the same
 * six numbers.
 */
import type { AccountDeletionPreview, StudentDeletionPreview } from '@/lib/parent-api';

/**
 * The single copy module for the parent-facing auth screens. No user-facing
 * string is a hardcoded literal in a component (AD-32).
 *
 * Not one figure or version appears here: the password minimum, the consent
 * versions and the notice text all come from `GET /api/auth/policy`.
 */
/**
 * The four words a mark is stated in, in the parent's own wording rather than the enum's.
 *
 * **One map, read by both screens that state a mark.** The run's own region and the
 * dispute list each name a grade, and two separately maintained copies of one four-label
 * table is two chances for the same mark to be called two things on two screens a parent
 * moves between in one press. It is declared beside `parentCopy` rather than inside it so
 * both groups can reference the same object, which is what makes them one source rather
 * than two that happen to agree today.
 *
 * `Unanswered` and `Ungraded` are here even though neither can be *adjusted*: both are
 * states a question can be in, and a list that could not name one would have a hole in it
 * exactly where a child objected to a blank.
 */
const GRADE_LABELS = {
  Correct: 'correct',
  Incorrect: 'not correct',
  Unanswered: 'unanswered',
  Ungraded: 'not graded yet',
} as const;

/**
 * The mastery figure and the blank count, as four functions **two groups share**.
 *
 * Declared beside `parentCopy` for exactly `GRADE_LABELS`' reason: the dashboard row
 * and the topic drill-down state the same figure about the same window, and two
 * separately maintained copies of that wording is two chances for one number to be
 * described two ways on two screens a parent moves between in one press. The figure is
 * never stated without the count it is over, whichever group renders it.
 */
const MASTERY_FIGURE = (percent: number, answered: number): string =>
  `${percent}% of ${answered} answered`;
/** A topic the student was asked about and skipped entirely. There is no figure. */
const MASTERY_NONE = 'Nothing answered yet';
const BLANKS_NOTE = (unanswered: number): string =>
  `${unanswered} question${unanswered === 1 ? '' : 's'} left blank`;
/** No question was skipped. Said rather than left out, so nothing is implied. */
const BLANKS_NONE = 'Nothing left blank';

export type StudentDeletionCounts = StudentDeletionPreview;
export type AccountDeletionCounts = AccountDeletionPreview;

/**
 * `"3 photographs"`, or `null` when there are none.
 *
 * `null` rather than `"0 photographs"`: a confirmation a parent has to read
 * carefully must not be padded with kinds that hold nothing, and "0" in a
 * warning reads as a figure rather than as an absence.
 */
function countPhrase(count: number, singular: string, plural: string): string | null {
  if (count <= 0) return null;
  return `${count} ${count === 1 ? singular : plural}`;
}

/** `"a, b and c"` — the list separator a sentence uses, not a bullet list. */
function listOf(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export const parentCopy = {
  appName: 'n-test-reviewer',
  signUp: {
    title: 'Create your account',
    intro: 'A parent account holds every Student Profile and the work uploaded for them.',
    emailLabel: 'Email',
    passwordLabel: 'Password',
    passwordMinimum: (minimum: number) => `At least ${minimum} characters.`,
    termsLabel: 'I accept the terms of use.',
    noticeLabel: 'I accept the notice on children’s data.',
    showNotice: 'Read the notice on children’s data',
    hideNotice: 'Hide the notice on children’s data',
    showTerms: 'Read the terms of use',
    hideTerms: 'Hide the terms of use',
    submit: 'Create account',
    submitting: 'Creating your account…',
    failed: 'The account could not be created. Check the details and try again.',
    haveAccount: 'Sign in instead',
  },
  signIn: {
    title: 'Sign in',
    emailLabel: 'Email',
    passwordLabel: 'Password',
    submit: 'Sign in',
    submitting: 'Signing in…',
    failed: 'Sign-in failed. Check the email and password and try again.',
    forgot: 'Forgot your password?',
    noAccount: 'Create an account',
  },
  reset: {
    title: 'Reset your password',
    intro: 'Enter the email on the account. If it is registered, a link will be sent to it.',
    emailLabel: 'Email',
    submit: 'Send the link',
    submitting: 'Sending…',
    // Shown only on a successful response — never in a `finally`.
    sent: 'If that email is registered, a link is on its way. The link is usable once and expires in an hour.',
    backToSignIn: 'Back to sign in',
  },
  resetConfirm: {
    title: 'Set a new password',
    passwordLabel: 'New password',
    submit: 'Save the new password',
    submitting: 'Saving…',
    done: 'The password is saved. Sign in with it.',
    missingToken: 'That link is incomplete. Request a new one.',
    failed: 'That link is no longer usable. Request a new one.',
    requestAnother: 'Request a new link',
  },
  signedIn: {
    title: 'Signed in',
    intro: 'The session lasts until you sign out, on this device.',
    emailLabel: 'Signed in as',
    timezoneLabel: 'Timezone',
    signOut: 'Sign out',
    signingOut: 'Signing out…',
    loading: 'Loading your account…',
    enterParentView: 'Enter Parent View',
  },
  /**
   * The PIN gate. Not one figure is stated here: the shape and the cool-down
   * arrive as arguments, from `GET /api/auth/policy`.
   */
  pin: {
    setTitle: 'Set a PIN for Parent View',
    setIntro: 'Parent View asks for this PIN. Choose one a child will not guess.',
    enterTitle: 'Enter your PIN',
    enterIntro: 'Parent View is behind this PIN, on every device and after every reload.',
    changeTitle: 'Change your PIN',
    changeIntro: 'Confirm with your current PIN or with your account password.',
    pinLabel: 'PIN',
    newPinLabel: 'New PIN',
    confirmNewPinLabel: 'Confirm new PIN',
    pinMismatch: 'The two PINs do not match.',
    currentPinLabel: 'Current PIN',
    passwordLabel: 'Account password',
    useCurrentPin: 'Confirm with the current PIN',
    usePassword: 'Confirm with the account password',
    pinShape: (length: number) => `Exactly ${length} digits.`,
    setSubmit: 'Save the PIN',
    enterSubmit: 'Enter Parent View',
    changeSubmit: 'Save the new PIN',
    submitting: 'Checking…',
    saving: 'Saving…',
    changed: 'The PIN is saved. The old one no longer works.',
    loading: 'Loading the PIN settings…',
    // One generic line for every wrong entry: no counter, no attempts left.
    incorrect: 'That PIN is not correct.',
    // States the lock and when it lifts, never how many entries were spent.
    locked: (until: string) => `Parent View is locked. It unlocks at ${until}.`,
    lockedUnknown: 'Parent View is locked. Try again later.',
    notElevated: 'Parent View needs the PIN again.',
    failed: 'The PIN could not be saved. Check the details and try again.',
    back: 'Back to Parent View',
  },

  parentView: {
    title: 'Parent View',
    intro: 'This is the parent side of the account. It closes when you leave it.',
    emailLabel: 'Signed in as',
    expiresLabel: 'Parent View stays open until',
    ceilingLabel: 'The PIN is required again after',
    changePin: 'Change PIN',
    students: 'Student Profiles',
    /** The way in to page management; the surface itself is titled "Pages". */
    capture: 'Upload a test',
    /**
     * The way in to draft review, and a first-class destination rather than a
     * step in the generate flow: a parent who left a running job finds what
     * they paid for here.
     */
    drafts: 'Pending practice tests',
    /**
     * The way in to the child's handed-in runs, and the only way in there is.
     * A destination with no link from Parent View is a destination a parent
     * cannot reach — and this one is where they read what their child was told.
     */
    attempts: 'Practice tests a student has finished',
    /**
     * The way in to what a student has reported, and the only way in there is.
     *
     * A destination with no link from Parent View is a destination a parent cannot
     * reach — and a report they cannot reach is a report that did not surface.
     */
    explanationFlags: 'Explanations a student has reported',
    /**
     * The way in to the grades a student says are wrong, and the only way in there is.
     *
     * Its own link beside the reported explanations, for the same reason that one exists:
     * the Attempt-detail row shows an objection only to somebody who already opened that
     * Attempt, so without this a child raising a hand about a mark would be a record
     * nobody ever sees — and a dispute a parent cannot reach is a dispute that did not
     * surface.
     */
    gradeDisputes: 'Marks a student says are wrong',
    /**
     * The way in to the dashboard, and the only way in there is.
     *
     * It names what a parent gets rather than what the screen is called, because
     * "Analytics" is a word about the product and this is a question about their
     * child.
     */
    analytics: 'Where a student is strong and weak',
    /**
     * The way in to the account's own settings, and the only way in there is.
     *
     * It names what is behind it rather than the word "Settings" alone, because
     * the one thing it holds today is where a parent ends the account — and a
     * destination a parent cannot reach is a destination that did not ship.
     */
    settings: 'Settings and account deletion',
    loading: 'Loading Parent View…',
    /** The hamburger toggle that opens the nav drawer on a narrow screen. */
    menuToggle: 'Open Parent View menu',
    /** Section headers grouping the sidebar's destinations by what they're
     * about, not by when they shipped. */
    navGroups: {
      students: 'Students',
      practiceTests: 'Practice tests',
      reports: 'Reports',
      insights: 'Insights',
      account: 'Account',
    },
    /** The desktop rail's own toggle, between the full sidebar and an
     * icon-only strip. */
    collapseSidebar: 'Collapse menu',
    expandSidebar: 'Expand menu',

    /**
     * Leaving Parent View is handing the device to a child, so the control
     * names where it goes rather than what it closes. Third person, by name —
     * this is a parent reading about their child, never the child themself.
     */
    backToStudent: 'Back to Student Mode',
    /** The toggle's own two sides — short enough to sit inside a switch
     * rather than the full sentence `backToStudent` names the action with. */
    parentSide: 'Parent',
    studentSide: 'Student',
    chooseProfileTitle: 'Who is using this device?',
    chooseProfileIntro:
      'The device will be handed to the child you choose. It stays on that child until you change it here.',
    chooseProfileLabel: 'Child',
    confirmExit: 'Hand over the device',
    exiting: 'Leaving…',
    noProfiles: 'There is no profile to hand the device to yet. Add one first.',
    boundTo: (name: string) => `This device is set up for ${name}.`,
    exitFailed: 'The device could not be handed over. Try again.',
    cancel: 'Cancel',
    /**
     * The no-profile branch still needs a real way out — an account with no
     * child has no Student Mode to be handed to, and a dialog that can only be
     * cancelled would strand the parent inside Parent View.
     */
    leaveWithoutHandover: 'Leave Parent View',
  },
  /**
   * The Students screen. A child is named in the third person, by name, and
   * never addressed. No figure is stated: the name bound arrives from
   * `GET /api/auth/policy`.
   */
  students: {
    title: 'Student Profiles',
    intro: 'Each child on this account has a profile with a name and a grade level.',
    loading: 'Loading the profiles…',
    empty: 'There are no profiles yet. Add the first one below.',
    nameColumn: 'Name',
    gradeLevelColumn: 'Grade level',
    statusColumn: 'Status',
    actionsColumn: 'Actions',
    active: 'Active',
    archivedStatus: 'Archived',
    /** Stated on a profile whose stored grade level an Admin has withdrawn. */
    gradeLevelWithdrawn: 'This grade level is no longer offered. Choose another one.',

    addTitle: 'Add a profile',
    nameLabel: 'Name',
    nameMaximum: (max: number) => `At most ${max} characters.`,
    gradeLevelLabel: 'Grade level',
    gradeLevelRequired: 'Choose a grade level.',
    noGradeLevels: 'No grade levels are available yet. Ask an administrator to add one.',
    add: 'Add the profile',
    adding: 'Adding…',
    added: (name: string) => `${name} was added.`,

    rename: 'Rename',
    renameLabel: 'New name',
    saveName: 'Save the name',
    cancel: 'Cancel',
    renamed: (name: string) => `The profile is now named ${name}.`,

    changeGradeLevel: 'Change grade level',
    /** Names the child, as every other per-row control does. */
    changeGradeLevelFor: (name: string) => `Change grade level for ${name}`,
    /** Says plainly what a grade-level change does *not* touch. */
    gradeLevelNote: 'Changing the grade level does not change any practice test already made.',
    gradeLevelChanged: (name: string, gradeLevel: string) => `${name} is now in ${gradeLevel}.`,

    archive: 'Archive',
    /** Archiving is visibly not deleting: the copy says what is kept. */
    archiveNote:
      'Archiving hides the profile from Student Mode and keeps its history. Nothing is deleted.',
    archiveConfirm: (name: string) =>
      `Archive ${name}? The profile is hidden from Student Mode and its history is kept. Nothing is deleted.`,
    archived: (name: string) => `${name} is archived and hidden from Student Mode.`,
    restore: 'Restore',
    restoreNote: 'Restoring puts the profile back in Student Mode.',
    restored: (name: string) => `${name} is active again.`,

    delete: 'Delete',
    /**
     * Beside `archiveNote` in the same row, because the two controls must read
     * as different actions rather than as two words for one.
     */
    deleteNote: 'Deleting removes the profile and everything saved under it, for good.',
    /**
     * The confirmation's body. FR-33 requires it to name the child, every count
     * and kind that will be destroyed, and that it cannot be undone — and to say
     * that the month's allowance does not come back, because a parent who
     * deleted to free up uploads would otherwise learn that afterwards.
     *
     * Only the kinds that have something in them are listed: "0 practice tests"
     * is noise in a sentence a parent is meant to read carefully. A child with
     * nothing saved under them gets the short form.
     */
    deleteBody: (name: string, counts: StudentDeletionCounts) => {
      const parts = [
        countPhrase(counts.sourceTests, 'uploaded test', 'uploaded tests'),
        countPhrase(counts.pageImages, 'photograph', 'photographs'),
        countPhrase(counts.practiceTests, 'practice test', 'practice tests'),
        countPhrase(counts.attempts, 'finished run', 'finished runs'),
        countPhrase(counts.explanations, 'explanation', 'explanations'),
        countPhrase(
          counts.masteryTopics,
          'topic with progress saved',
          'topics with progress saved',
        ),
      ].filter((part): part is string => part !== null);
      // The typographic apostrophe every other string in this file uses. A
      // sentence that mixed the two would be visibly two people's copy.
      const destroyed =
        parts.length === 0
          ? `${name}’s profile will be removed. Nothing else is saved under it.`
          : `${name}’s profile will be removed, along with ${listOf(parts)}.`;
      return `${destroyed} This cannot be undone, and this month’s allowance is not given back.`;
    },
    /**
     * What the live region says once it is done.
     *
     * "and everything saved under them" would be a claim the body has just
     * spent a sentence denying for a child with nothing saved under them, so it
     * states the one thing that is true in both cases: the profile is gone, and
     * it is not coming back.
     */
    deleted: (name: string) => `${name}’s profile was deleted. This cannot be undone.`,
    deleteFailed: 'The profile could not be deleted. Nothing was removed. Try again.',

    failed: 'That change could not be saved. Try again.',
    back: 'Back to Parent View',
  },
  /**
   * The Settings screen, and the account-level data actions that had no home
   * before it.
   *
   * The account is addressed in the second person — this is the parent reading
   * about their own account — while a child is still only ever named in the
   * third. No figure is stated beyond the counts the API sends.
   */
  settings: {
    title: 'Settings',
    intro: 'Settings for this account, and what can be removed from it.',
    loading: 'Loading the settings…',
    /**
     * Said while the confirmation's counts are being read.
     *
     * Its own sentence rather than a second use of `loading`: the screen is
     * already up by then, and "loading the settings" about a control the parent
     * has just pressed describes the wrong thing.
     */
    preparing: 'Checking what would be removed…',

    /**
     * The Allowances section: the Account Tier, the three counters, and the one
     * instant they all start again at.
     *
     * **Not one figure, tier name or date is written here.** Every number arrives
     * on the API's consumption payload, every limit renders through `limitLabel`,
     * every tier name through `tierLabel` and the reset date through `dateOnly` in
     * the account's own zone. The wording follows `analytics.allowance*`, which
     * states the Explanation counter on the dashboard, so a parent reading both
     * surfaces reads one sentence pattern.
     *
     * Each allowance names **its own unit**, because "2 of 2 used" says nothing
     * about what was used. The Generation unit is *practice tests* and is nothing
     * else: not generations, not requests and not credits — the same denomination
     * the generate screen's cost sentence is bound to.
     */
    allowancesHeading: 'Allowances',
    allowancesIntro:
      'What this account has used this period. The allowances are the account’s and are shared by every profile on it.',
    allowancesLoading: 'Loading the allowances…',
    allowancesFailed: 'The allowances could not be read. Nothing has changed. Try again.',
    /** The tier line's label. The tier's own name comes from the API. */
    tierLine: (tier: string) => `Account Tier: ${tier}`,
    uploadAllowance: 'Upload Allowance',
    generationAllowance: 'Generation Allowance',
    explanationAllowance: 'Explanation Allowance',
    uploadUnit: 'uploaded tests',
    /** Practice Tests, and never a credit or an abstract unit. */
    generationUnit: 'practice tests',
    explanationUnit: 'explanations',
    allowanceUsed: (used: number, limit: string, unit: string) =>
      `${used} of ${limit} ${unit} used this period.`,
    /** No ceiling. Said in words, never as a number and never as "0 left". */
    allowanceUnlimited: (used: number, unit: string) =>
      `${used} ${unit} used this period. There is no limit.`,
    studentProfileLimitLabel: 'Student profiles on this account',
    /** One date for all three counters, because they start again together. */
    allowanceResets: (date: string) => `All three counts start again on ${date}.`,

    /** The section heading, which is the entry point the UX names. */
    dataAndDeletion: 'Data & deletion',
    deleteAccount: 'Delete this account',
    /**
     * What the control costs, said before it is touched rather than only in the
     * confirmation: a parent deciding whether to open the dialog at all is
     * entitled to know that this is not the per-child delete one screen over, and
     * that there is nothing to recover afterwards.
     */
    deleteAccountNote:
      'Deleting the account removes every profile on it, everything uploaded for them and every practice test, run and explanation made from it. The photographs are removed from storage. Nothing can be recovered afterwards, and you will be signed out.',
    /** What the confirmation's title names, in place of a child's name. */
    deleteAccountSubject: 'your account',
    /**
     * The confirmation's body: the number of children first, then every count
     * and kind that has something in it, then the irreversibility.
     *
     * The children lead, because that is the figure a parent recognises before
     * any count of uploads or runs. Only the kinds that have something in them
     * are listed, for the reason the per-child body lists only those: "0 practice
     * tests" is noise in a sentence a parent is meant to read carefully.
     *
     * It says nothing about the month's allowance, unlike the per-child body.
     * There is no account left for an allowance to be about, and mentioning it
     * would invite the reading that something survives.
     */
    deleteAccountBody: (counts: AccountDeletionCounts) => {
      const parts = [
        countPhrase(counts.students, 'student profile', 'student profiles'),
        countPhrase(counts.sourceTests, 'uploaded test', 'uploaded tests'),
        countPhrase(counts.pageImages, 'photograph', 'photographs'),
        countPhrase(counts.practiceTests, 'practice test', 'practice tests'),
        countPhrase(counts.attempts, 'finished run', 'finished runs'),
        countPhrase(counts.explanations, 'explanation', 'explanations'),
        countPhrase(
          counts.masteryTopics,
          'topic with progress saved',
          'topics with progress saved',
        ),
      ].filter((part): part is string => part !== null);
      const destroyed =
        parts.length === 0
          ? 'Your account will be removed. There is nothing saved under it.'
          : `Your account will be removed, along with ${listOf(parts)}.`;
      return `${destroyed} This cannot be undone, and nothing can be recovered afterwards.`;
    },
    deleteAccountFailed: 'The account could not be deleted. Nothing was removed. Try again.',
    back: 'Back to Parent View',
  },
  /**
   * The page-management strip, before a Source Test is submitted.
   *
   * The visible strings are the capture mockup's own. The ordinal is a
   * parameter everywhere it appears — in the visible label and in every
   * icon-control's accessible name alike — because the strip's whole
   * accessibility rule is that a control names the page it acts on.
   *
   * Not one figure is stated: the page ceiling arrives on every Source Test
   * read as `maxPages`.
   */
  capture: {
    title: 'Pages',
    orderLabel: 'Order',
    /** The mockup's caption, with both figures supplied by the API. */
    countLine: (count: number, max: number) =>
      `Pages are used in this order. ${count} of ${max} page images.`,
    /**
     * The number the strip shows in text on every row. It is the row's whole
     * visible identity: this story renders no thumbnail, because stored image
     * bytes are never served.
     */
    pageLabel: (ordinal: number) => `Page ${ordinal}`,

    /**
     * What the row says once the photograph has been removed, 90 days after the
     * upload was committed.
     *
     * Stated plainly and without apology: nothing went wrong, and the practice
     * built from this page is untouched. `photoDeletedOn` is the same sentence
     * with the date the row carries, used when there is one — the caller
     * formats the date, because the strip never parses one.
     */
    photoDeleted: 'Photo deleted',
    photoDeletedOn: (date: string) => `Photo deleted on ${date}`,

    /**
     * Removing the photographs early (FR-33), rather than waiting out the
     * ninety days.
     *
     * The confirmation states the count, because that is what goes, and states
     * in the same breath that the practice built from those photographs stays —
     * which is the whole reason this costs the parent nothing and the reason no
     * password is asked for. Plain and without alarm: nothing is going wrong,
     * the parent asked for this.
     */
    deletePhotos: 'Delete photos',
    deletePhotosTitle: 'Delete the photos of this upload?',
    deletePhotosBody: (count: number) =>
      `${count === 1 ? 'The 1 photo' : `All ${count} photos`} of this upload will be removed. ` +
      'The practice tests, answers and progress built from them stay exactly as they are. ' +
      'This cannot be undone.',
    /** Said from the view the server answered with, never from a prediction. */
    photosDeleted: (count: number) =>
      count === 1 ? 'The photo has been removed.' : `All ${count} photos have been removed.`,
    /**
     * The fallback only. A refusal the API authored — an upload not submitted
     * yet, one still being read — arrives as its own sentence and is shown
     * instead of this one.
     */
    deletePhotosFailed: 'The photos could not be removed. Try again.',
    childLabel: 'Child',
    loading: 'Loading the pages…',
    empty: 'There are no pages yet. Add the first one below.',
    noProfiles: 'There is no profile to upload for yet. Add one first.',

    adding: 'Adding the page…',
    /** Says why the add control is gone, rather than leaving it unexplained. */
    limitReached: (max: number) => `This upload already holds ${max} pages.`,

    /**
     * The camera and the photo library — the two ways a page arrives.
     *
     * Nothing here names which control added a page: the two are one action
     * from the parent's side, and the strip records only the order. Not one
     * figure is a literal either; the ceiling and the count both arrive on the
     * Source Test read.
     */
    camera: {
      /** The mockup's heading for the capture surface. */
      heading: 'Capture pages',
      /** The viewfinder's accessible name: a live camera view is not decorative. */
      viewfinderLabel: 'Camera view of the page in front of the camera',
      /**
       * Which page the parent is being asked to frame. The ordinal is the page
       * the shot will become, so it moves as pages are added.
       */
      framing: (ordinal: number) => `Fill the frame with page ${ordinal}`,
      /** The mockup's live counter, above the shutter. */
      captured: (count: number, max: number) => `Pages captured: ${count} of ${max}`,
      shutter: 'Take photo',
      /** Closes the viewfinder. The pages already added stay. */
      done: 'Done',
      /** Opens it. Named for what it does rather than for the hardware. */
      useCamera: 'Use the camera',

      /**
       * The photo library beside the camera — several pages in one action.
       *
       * Not "camera roll": there is no camera roll on Android or on a desktop,
       * and this control is the same control on all three. It is named for what
       * the parent is choosing from rather than for what one platform calls it.
       */
      libraryLabel: 'Choose from your photos',

      /**
       * The camera being unavailable is never a dead end: the guidance names
       * how to re-enable it, and the library control beside it stays usable.
       */
      cameraUnavailable: 'The camera cannot be used on this device.',
      cameraDenied:
        'This site is not allowed to use the camera. Allow camera access in this browser’s site settings for this page, then try again.',
      cameraFallback: 'Pages can still be added from this device’s photos.',
    },

    /**
     * Announced after an add, from the server's answer.
     *
     * A count of zero or less is a sentence of its own rather than "0 pages were
     * added": the delta is the difference between two server reads, so a failed
     * first file, a request that changed nothing, or a read that went backwards
     * all arrive here as zero, and every one of them means nothing landed.
     */
    addedCount: (count: number) =>
      count <= 0
        ? 'No pages were added.'
        : count === 1
          ? 'One page was added.'
          : `${count} pages were added.`,
    /**
     * Said alongside `addedCount` when a selection was larger than the slots
     * left. The parent is told what did not happen, not only what did.
     */
    rejectedCount: (count: number) =>
      count === 1
        ? 'One photo was not added — this upload is full.'
        : `${count} photos were not added — this upload is full.`,
    /**
     * Both halves of an add's outcome, as one sentence for one live region.
     *
     * The screen announces into a single polite region, so two messages would
     * mean the parent only ever hears the second: told "3 pages were added", they
     * would never learn that two photos were turned away. Joined here rather than
     * at the call site so the two clauses cannot drift apart.
     */
    addOutcome: (added: number, rejected: number) =>
      rejected > 0
        ? `${parentCopy.capture.addedCount(added)} ${parentCopy.capture.rejectedCount(rejected)}`
        : parentCopy.capture.addedCount(added),

    moveUp: 'Move up',
    moveDown: 'Move down',
    /** Icon-only controls name the page ordinal they act on. */
    moveUpFor: (ordinal: number) => `Move page ${ordinal} up`,
    moveDownFor: (ordinal: number) => `Move page ${ordinal} down`,
    retake: 'Retake',
    retakeFor: (ordinal: number) => `Retake page ${ordinal}`,
    delete: 'Delete',
    deleteFor: (ordinal: number) => `Delete page ${ordinal}`,
    deleteConfirm: (ordinal: number, total: number) =>
      ordinal < total
        ? `Delete page ${ordinal}? The pages after it are renumbered. The photo is removed.`
        : `Delete page ${ordinal}? The photo is removed.`,

    submit: 'Check pages',
    submitting: 'Checking…',
    /**
     * Shown beside the disabled submit control. The button being disabled is a
     * courtesy; this sentence is what makes the refusal legible, and the server
     * refuses a zero-page submission whatever the browser did.
     */
    submitBlocked: (reasons: readonly ('pages' | 'classification' | 'legibility')[]): string =>
      reasons
        .map((reason) =>
          reason === 'pages'
            ? 'Add at least one page before submitting.'
            : reason === 'classification'
              ? 'Choose a subject and a grade level before submitting.'
              : 'Check the pages before submitting.',
        )
        .join(' '),

    deleted: (ordinal: number, total: number) =>
      ordinal < total
        ? `Page ${ordinal} was deleted. The pages after it are renumbered.`
        : `Page ${ordinal} was deleted.`,
    retaken: (ordinal: number) => `Page ${ordinal} was replaced.`,
    moved: (from: number, to: number) => `Page ${from} is now page ${to}.`,
    submitted: 'The pages were submitted.',
    /**
     * A submitted upload is shown rather than hidden — the work did not vanish
     * — and the sentence says plainly why nothing on it can be changed.
     */
    submittedNote: 'These pages were submitted. Nothing on this upload can be changed now.',

    /**
     * What the upload is *of*. One subject and one grade level, chosen from
     * what an administrator offers — so both lists are the server's answer and
     * neither is filtered here.
     */
    classification: {
      heading: 'Subject and grade level',
      /** Says what the grade level here is, and what it is not. */
      intro:
        'This is the grade level for this upload. Changing it here does not change the child’s profile.',
      gradeLevelLabel: 'Grade level',
      subjectLabel: 'Subject',
      /** The subject list is a function of the grade level, so it says so. */
      chooseGradeLevelFirst: 'Choose a grade level to see the subjects offered for it.',
      noSubjects: 'No subjects are offered for that grade level yet. Choose another grade level.',
      loadingSubjects: 'Loading the subjects…',
      noGradeLevels: 'No grade levels are available yet. Ask an administrator to add one.',
      loadingGradeLevels: 'Loading the grade levels…',
      saving: 'Saving…',
      subjectSet: (subject: string) => `The subject is ${subject}.`,
      gradeLevelSet: (gradeLevel: string) => `The grade level is ${gradeLevel}.`,
      /**
       * A grade-level change may clear a subject the new grade level does not
       * offer. That is announced rather than left to be noticed.
       */
      gradeLevelSetSubjectCleared: (gradeLevel: string) =>
        `The grade level is ${gradeLevel}. That grade level does not offer the subject that was chosen, so the subject was cleared. Choose one again.`,
      failed: 'That choice could not be saved. Try again.',
      subjectsFailed: 'The subjects could not be loaded. Try again.',
      /**
       * Distinct from `noGradeLevels`: a read that failed is not the same fact
       * as a catalogue that is empty, and telling a parent to ask an
       * administrator about a network fault sends them somewhere useless.
       */
      gradeLevelsFailed: 'The grade levels could not be loaded. Try again.',
    },

    /**
     * The batch page check, and the commit it leads into.
     *
     * Two rules shape every string here. The verdict is stated per page and
     * the page is named, because the retake it offers is scoped to that page
     * alone. And the cost is stated in **words** before the commit control —
     * one Upload Allowance, and nothing at all for leaving — because Story 9.6
     * owns the parent-facing Allowances surface and no figure or counter is
     * this screen's to show.
     */
    legibility: {
      heading: 'How the pages read',
      /** While the batch call is in flight. It is foreground, so it says so. */
      checking: 'Checking how clearly the pages read…',
      /**
       * The badge on every row, as **text**. The glyph beside it is
       * decorative; this is what a screen reader hears and what a parent who
       * cannot tell the two colours apart reads.
       */
      readable: 'Readable',
      blurry: 'Blurry',
      /** The badge's accessible name, which names the page it is about. */
      verdictFor: (ordinal: number, verdict: string) => `Page ${ordinal}: ${verdict}`,
      /**
       * The flag head. It names the pages rather than counting them, because
       * the parent's next action is to point a camera at one of them.
       */
      flagged: (ordinals: readonly number[]) =>
        ordinals.length === 0
          ? ''
          : ordinals.length === 1
            ? `Page ${ordinals[0]} may be too blurry to read.`
            : `Pages ${ordinals.slice(0, -1).join(', ')} and ${ordinals[ordinals.length - 1]} may be too blurry to read.`,
      /** Said when nothing was flagged, so silence is never the only answer. */
      allReadable: 'Every page reads clearly.',
      /** The advisory sentence. It is a warning, and it says so plainly. */
      advisory: 'This is a warning, not a block. Continuing is allowed.',
      /** Scoped to one page, exactly as the strip's own retake control is. */
      retakeFor: (ordinal: number) => `Retake page ${ordinal}`,
      /**
       * The commit control. It names the count so the parent knows what is
       * about to be committed, flagged pages included.
       */
      continueWith: (count: number) =>
        count === 1 ? 'Continue with 1 page' : `Continue with all ${count} pages`,
      /**
       * FR-31's two halves, stated beforehand and in words. No figure and no
       * counter: the parent-facing Allowances surface is Story 9.6's.
       */
      cost: 'Continuing commits this upload and uses one upload allowance.',
      noCost: 'Nothing is used if you leave without continuing.',
      /**
       * While the commit is in flight. Distinct from `capture.submitting`,
       * which now says "Checking…" and belongs to the control before this
       * one: a commit button that reports checking describes the wrong step
       * at the one moment the allowance is actually spent.
       */
      committing: 'Committing the upload…',
      /** Announced from the answer the server returned, never predicted. */
      checked: (flagged: number) =>
        flagged === 0
          ? 'The pages were checked. Every page reads clearly.'
          : flagged === 1
            ? 'The pages were checked. One page may be too blurry to read.'
            : `The pages were checked. ${flagged} pages may be too blurry to read.`,
      /**
       * One sentence for the transport fault and the content fault alike:
       * from the parent's side they are the same fact, nothing was stored,
       * and the check may be run again.
       */
      failed: 'The pages could not be checked. Try again.',
    },

    /**
     * The step between a committed upload and Epic 4's generation, and the one
     * gate that fires on the way into it.
     *
     * Not one figure is stated: both counts arrive from the status read, and
     * the verdict that decides whether the warning appears is the server's.
     */
    generate: {
      heading: 'Generate a practice test',
      /** While the job is Queued or Running. Says what is happening and why. */
      reading: 'The pages are being read. This takes a moment.',
      readFailed: 'The reading of this upload could not be checked. Try again.',
      proceed: 'Continue to practice test',
      /**
       * Announced as the parent is sent on to the generate screen. It says
       * where the flow went, because the navigation is the only other signal
       * that anything happened.
       */
      leaving: 'This upload is ready. Opening the practice test step.',

      warningTitle: 'Fewer questions than expected',
      /**
       * FR-9a's two load-bearing figures, in plain words. Both are handed in;
       * neither is computed here.
       */
      counts: (usable: number, pages: number) =>
        `${usable === 1 ? '1 usable question was' : `${usable} usable questions were`} found across ${
          pages === 1 ? '1 page' : `${pages} pages`
        }.`,
      /** FR-9a's third: retaking is free, and the parent is told so up front. */
      noGenerationCharge: 'Retaking the pages uses no Generation Allowance.',
      continueAnyway: 'Continue anyway',
      retakePages: 'Retake the pages',
      /**
       * Honest about what retake does. A submitted upload is terminal, so this
       * is a new upload rather than the old pages coming back.
       */
      retakeStarted: 'A new upload was started. Add the pages again.',
    },

    failed: 'That change could not be saved. Try again.',
    addFailed: 'That page could not be added. Try again with another photo.',
    submitFailed: 'The pages could not be submitted. Try again.',
    back: 'Back to Parent View',
  },
  generate: {
    title: 'Generate practice tests',
    /**
     * What the screen is for, in one sentence: the choice about to be made,
     * and what it is made from. It says nothing about time, cost or outcome —
     * those have sentences of their own below.
     */
    intro: 'Choose how many practice tests to make from this upload.',
    loading: 'Loading…',
    loadFailed: 'This upload could not be opened. Try again.',
    retry: 'Try again',
    back: 'Back to the upload',

    countLegend: 'How many practice tests',
    /** The radio label. One figure, handed in — nothing counts here. */
    countOption: (count: number) => (count === 1 ? '1 practice test' : `${count} practice tests`),
    /**
     * Beside a count the account cannot afford. The count stays on screen and
     * stays readable; only its control is disabled, and this says why.
     *
     * For **1 or more** left it describes disabled options rather than a block.
     * Nothing left is normally not this sentence at all: the API states that one,
     * on `exhaustedReason`, naming the Account Tier, the usage against the limit
     * and the date the allowance comes back — three facts this app may not hold
     * and could not state. The screen renders that sentence instead, so a blocked
     * parent never reads words that name none of them.
     *
     * The zero branch is the **version-skew fallback only**, and nothing else
     * should reach it: an API that predates `exhaustedReason` answers without the
     * field, and the response is an unchecked cast, so the screen would otherwise
     * fall through to "Only 0 practice tests are left". It states the plain fact
     * and deliberately no tier, no limit and no reset date — the sentence that
     * names those is the API's, and guessing at them here would be a second copy
     * that could be wrong.
     *
     * The figure arrives from the API. The web app holds no limit, no tier and no
     * per-request ceiling of its own.
     */
    countUnavailable: (remaining: number) =>
      remaining <= 0
        ? 'No Generation Allowance is left this period.'
        : remaining === 1
          ? 'Only 1 practice test is left in this period’s Generation Allowance.'
          : `Only ${remaining} practice tests are left in this period’s Generation Allowance.`,

    /**
     * The optional weighting's own fieldset label.
     *
     * "Focus" rather than "weight": a parent is choosing what the practice is
     * mostly about, and the arithmetic behind the word is the server's business.
     */
    topicLegend: 'What to focus on',
    /**
     * The default, and the first option in the group: the even spread every
     * request made so far produced. Choosing it is choosing today's behaviour.
     */
    topicAll: 'All topics',
    /**
     * One Topic, in the Extraction's own words. The label arrives from the API
     * and nothing here rewrites, titles or truncates it — it is what was read
     * off the parent's own page.
     */
    topicOption: (topic: string) => topic,
    /**
     * Why the choice is there at all, in one sentence. It says what focusing
     * does and — because the epic requires it — that it does not change what
     * this costs.
     */
    topicHint:
      'Most of the questions will be on the topic chosen here. It does not change how much of the Generation Allowance this uses.',
    /**
     * The cost, stated before the confirm control is actionable, denominated in
     * Practice Tests and never in credits or an abstract unit. It names both
     * what the action spends and what is left afterwards.
     */
    cost: (spend: number, remainingAfter: number) =>
      `${spend === 1 ? 'This uses 1 practice test' : `This uses ${spend} practice tests`} of the Generation Allowance. ${
        remainingAfter === 1
          ? '1 will be left this period.'
          : `${remainingAfter} will be left this period.`
      }`,
    /** The same sentence on an unlimited tier, which has no remainder to state. */
    costUnlimited: (spend: number) =>
      `${spend === 1 ? 'This uses 1 practice test' : `This uses ${spend} practice tests`} of the Generation Allowance. The allowance on this account is unlimited.`,
    /** What has already been spent this period, as a plain fact. */
    usage: (used: number, limit: string) => `Used this period: ${used} of ${limit}.`,

    start: 'Generate',
    confirmTitle: 'Generate practice tests',
    confirm: 'Generate',
    cancel: 'Cancel',
    startFailed: 'The practice tests could not be started. Try again.',

    progressHeading: 'Making the practice tests',
    /**
     * The progress sentence, announced in exactly the words it displays.
     *
     * It says what has landed and what was asked for, and nothing about time
     * remaining: there is no honest estimate to give, and an invented one is
     * the kind of figure a parent plans around.
     */
    progress: (produced: number, requested: number) =>
      `${produced} of ${requested} practice tests are ready.`,
    /**
     * The same sentence for a weighted job, naming the Topic the request was
     * actually made with — which is what a parent returning to the URL needs in
     * order to recognise the request as theirs.
     *
     * The Topic arrives from the job view, in the spelling the server resolved
     * and stored, so the screen names the same label the drafts were written
     * against rather than whatever this browser last had in a radio group.
     */
    progressWeighted: (produced: number, requested: number, topic: string) =>
      `${produced} of ${requested} practice tests are ready, focused on ${topic}.`,
    /**
     * The stay-here advice. It says the screen is where completion shows, and
     * it does **not** say anything is lost by leaving — that would be false,
     * and it would contradict both retry-without-re-upload and charge-on-land.
     */
    stayHere:
      'This screen is where the practice tests appear as they are made. Leaving does not stop the work, and anything already made is kept.',
    /**
     * A finished job's outcome. When the job was weighted, the Topic is named
     * here too — a parent returning after completion should read the same
     * request they made, not just for a job still in progress.
     */
    done: (produced: number, topic: string | null = null) => {
      const base =
        produced === 1 ? '1 practice test is ready.' : `${produced} practice tests are ready.`;
      return topic === null ? base : `${base.slice(0, -1)}, focused on ${topic}.`;
    },
    /**
     * A job that produced some of what was asked for. The count that landed is
     * the count that was charged, and the sentence says both plainly. Names
     * the weighted Topic too, for the same reason `done` does.
     */
    partial: (produced: number, requested: number, topic: string | null = null) => {
      const base = `${produced} of ${requested} practice tests were made. Only the ones that were made used the Generation Allowance.`;
      return topic === null
        ? base
        : `${produced} of ${requested} practice tests were made, focused on ${topic}. Only the ones that were made used the Generation Allowance.`;
    },
    /** A job that produced nothing. The upload is untouched and still usable. */
    failed: 'No practice tests were made, and nothing was used from the Generation Allowance.',
    /** Stated beside a failure: the upload survives it, and so does the reading. */
    retryFree: 'The upload is still here. Trying again needs no new photos.',
    progressFailed: 'The progress could not be checked. Try again.',
    /**
     * The way on from a finished job. It names the destination rather than the
     * action, because Pending drafts is a place a parent comes back to and not
     * a step in a wizard.
     */
    toDrafts: 'Review the practice tests',
  },
  /**
   * Draft review: the list of what is waiting, and one draft read whole.
   *
   * Every string here is parameterized and every figure in one arrives from the
   * API. Nothing names an allowance, a cost, a tier or a model: nothing is
   * being spent on either screen.
   */
  drafts: {
    listTitle: 'Pending practice tests',
    /**
     * What the list is for. It says these are waiting on the parent, which is
     * the whole reason the screen exists — nothing generated reaches a child
     * before someone has read it.
     */
    listIntro: 'These practice tests are waiting to be read. Nothing is shown to a child yet.',
    loading: 'Loading…',
    /** Nothing waiting is a state, not a fault, and it is said as plain fact. */
    empty: 'There are no practice tests waiting to be read.',
    listFailed: 'The practice tests could not be listed. Try again.',
    openFailed: 'That practice test could not be opened. Try again.',
    /** A draft that is no longer there. The way back is offered beside it. */
    notFound: 'That practice test could not be found.',
    retry: 'Try again',
    backToParentView: 'Back to Parent View',
    backToList: 'Back to the pending practice tests',

    /**
     * Which draft of its job this is, from the two figures the server supplies.
     * The browser holds one draft and could not count the other two.
     */
    position: (ordinal: number, siblingCount: number) => `Draft ${ordinal} of ${siblingCount}`,
    /** Whose practice this is. Third person, by name, as every parent string is. */
    forStudent: (studentName: string) => `For ${studentName}`,
    /** The child a draft belongs to, before the profile list has been joined. */
    unknownStudent: 'A student profile',
    questionTotal: (count: number) => (count === 1 ? '1 question' : `${count} questions`),
    /** When the draft landed, in the device's own formatting. */
    made: (when: string) => `Made ${when}`,
    open: 'Read it',

    reviewTitle: 'Read the practice test',
    /** Each Question's own heading, by its stored place in the draft. */
    questionHeading: (ordinal: number) => `Question ${ordinal}`,
    correctAnswerLabel: 'Correct answer',
    optionsLabel: 'Options',
    /** Beside the one option flagged correct. Words, never colour alone. */
    correctOption: 'Correct',
    topicsLabel: 'Topics',
    /** A Question the Extraction gave no Topic for. Stated, never left blank. */
    noTopics: 'No topic',

    /**
     * The spoken reading of a fraction, built here rather than concatenated in
     * the component — which is what keeps "1/2" from being assembled anywhere
     * and the reading from being lost (AD-32).
     */
    fractionReading: (fraction: {
      whole: number | null;
      numerator: number;
      denominator: number;
    }) =>
      fraction.whole === null
        ? `${fraction.numerator} over ${fraction.denominator}`
        : `${fraction.whole} and ${fraction.numerator} over ${fraction.denominator}`,

    // --- Editing one Question -------------------------------------------
    //
    // What a parent is offered on a draft they have read and found something
    // wrong in. Plain fact throughout: nothing here congratulates, warns
    // twice, or names an allowance figure, a tier or a model.

    /** The control that opens one Question for editing, named by its place. */
    edit: (ordinal: number) => `Edit question ${ordinal}`,
    /** Each field's own label inside the editor. */
    editPrompt: 'Question',
    editAnswer: 'Correct answer',
    editOption: (ordinal: number) => `Option ${ordinal}`,
    /** The radio group that says which option is the right one. */
    editCorrectLegend: 'Which option is correct',
    editCorrectOption: (ordinal: number) => `Option ${ordinal} is correct`,
    /**
     * What editing does, said once, before it is done. It is the sentence the
     * whole gate rests on: what is saved here is what the child sees.
     */
    editHint: 'What is saved here is what the student sees and is marked against.',
    save: 'Save the changes',
    cancel: 'Cancel',
    /** Said after a save, in the same words the screen shows (UX-DR: a11y). */
    edited: (ordinal: number) => `Question ${ordinal} was saved.`,
    editFailed: 'That question could not be saved. Try again.',

    // --- Deleting one Question ------------------------------------------

    delete: (ordinal: number) => `Delete question ${ordinal}`,
    deleteTitle: 'Delete this question',
    /**
     * Names what is destroyed **before** it is, by its place in the draft and
     * by how many are left afterwards. There is no undo and no history, so the
     * confirmation is the only place this can be said.
     */
    deleteBody: (ordinal: number, remaining: number) =>
      `Question ${ordinal} will be deleted. ${
        remaining === 1
          ? '1 question will be left in this practice test.'
          : `${remaining} questions will be left in this practice test.`
      } This cannot be undone.`,
    /**
     * The last Question, which is a different thing entirely: the Practice Test
     * goes away with it. The epic requires both facts in words before the
     * action — that it is discarded, and that the Generation Allowance already
     * spent on it is not given back.
     */
    deleteLastTitle: 'Delete the only question',
    deleteLastBody:
      'This is the only question left. Deleting it discards the whole practice test, and the Generation Allowance already used on it is not given back. This cannot be undone.',
    deleteConfirm: 'Delete the question',
    /** Said after a delete, naming what is left rather than what is gone. */
    deleted: (remaining: number) =>
      remaining === 1
        ? '1 question is left in this practice test.'
        : `${remaining} questions are left in this practice test.`,
    /** Said when the last one went, on the way back to the list. */
    discarded: 'The practice test was discarded.',
    deleteFailed: 'That question could not be deleted. Try again.',

    /**
     * Beside a restored edit. A parent who was put back through the PIN should
     * know why the field does not match what is stored below it.
     */
    editRestored: 'An edit that was not saved has been put back.',

    // --- Releasing or discarding the whole draft --------------------------
    //
    // The two terminal transitions, and the only place on either screen where a
    // consequence has to be stated *in advance*: there is no undo, no recall and
    // no refund, so the confirmation is the last moment anything can be said.
    // Third person about the student throughout, plain fact, no exclamation
    // marks, no cheerleading, no upsell and no error codes.

    /** The control that opens the release confirmation. */
    release: 'Release it',
    releaseTitle: 'Release this practice test',
    /**
     * Both facts, before the action: the child can see it from this moment, and
     * it can no longer be changed. Named by the child, because "which child"
     * is the one thing a parent holding several drafts must not have to infer.
     */
    releaseBody: (studentName: string) =>
      `${studentName} will be able to see this practice test straight away, and it can no longer be changed. This cannot be undone.`,
    releaseConfirm: 'Release it',
    /** Said on arrival at the pending list, by the screen the parent lands on. */
    released: 'The practice test was released.',
    releaseFailed: 'That practice test could not be released. Try again.',

    /** The control that opens the discard confirmation, for the whole draft. */
    discard: 'Discard it',
    discardTitle: 'Discard this practice test',
    /**
     * Both facts, before the action: the child never sees it, and the allowance
     * already spent is not given back (AD-14).
     */
    discardBody: (studentName: string) =>
      `This practice test will be discarded and ${studentName} will never see it. The Generation Allowance already used on it is not given back. This cannot be undone.`,
    discardConfirm: 'Discard it',
    discardFailed: 'That practice test could not be discarded. Try again.',

    // --- The timer -------------------------------------------------------
    //
    // Optional and off by default (FR-15), set while reading the draft it
    // applies to, and settable at any point up to release and never after.
    // Third person about the student, plain fact, every figure parameterized —
    // no exclamation marks, no cheerleading, no error codes, and no allowance
    // figure, tier or model name anywhere near it.

    /** The block's own heading, beside the release and discard controls. */
    timerLegend: 'Time limit',
    /**
     * What the timer is, said once, before it is set. It states the default in
     * words so a parent who does nothing knows what they have left behind.
     */
    timerHint: 'A time limit is optional. Without one the student takes as long as they need.',
    /** The on/off control. Named by what turning it on does. */
    timerOn: 'Set a time limit',
    /** The minutes field. Minutes, because minutes are what a parent enters. */
    timerMinutesLabel: 'Minutes',
    /**
     * The pre-filled figure, described **as a suggestion** so a parent knows
     * nothing was stored on their behalf by the screen showing it.
     */
    timerSuggestion: (minutes: number) =>
      `${minutes} minutes is suggested for this practice test. Nothing is saved until it is saved below.`,
    timerSave: 'Save the time limit',
    /** Said after a save, in the same words the screen shows. */
    timerSaved: (minutes: number) =>
      minutes === 1
        ? 'The student has 1 minute for this practice test.'
        : `The student has ${minutes} minutes for this practice test.`,
    /** Said after the timer is turned off, naming the state rather than the act. */
    timerOffSaved: 'There is no time limit on this practice test.',
    timerFailed: 'That time limit could not be saved. Try again.',
  },
  /**
   * The parent's Attempt review: a child's handed-in runs, one run whole, and each
   * Explanation the child was shown beneath the Question it is about.
   *
   * **Third person throughout, and never addressed to the child.** A parent reading
   * this is reading *about* their child: "the student answered", never "you
   * answered". The four grade-state literals are deliberately absent — they are
   * `commonCopy.gradeState`'s, shared with the child's own screen on purpose, so the
   * two surfaces cannot disagree about what `Unanswered` is called.
   *
   * Every figure is a parameter and every sentence is whole here rather than
   * assembled at a call site. Nothing names an allowance, a cost, a tier or a model:
   * a parent reading an Explanation is spending nothing, and the screen says so.
   */
  attempts: {
    listTitle: 'Finished practice tests',
    /**
     * What the list is for, stated as the reason a parent is here: this is where
     * what a child was told can be read.
     */
    listIntro:
      'Choose a student to see the practice tests they have handed in. Opening one shows the answer key and anything that was explained to them.',
    /** The child selector. One child at a time, because runs belong to one child. */
    studentLabel: 'Student',
    loading: 'Loading…',
    /** No profile to choose from yet. The way on is the Students screen. */
    noStudents: 'There is no student profile yet. Add one first.',
    /** A child who has handed nothing in. A state, not a fault. */
    empty: 'This student has not handed in a practice test yet.',
    listFailed: 'The finished practice tests could not be listed. Try again.',
    retry: 'Try again',
    backToParentView: 'Back to Parent View',
    backToList: 'Back to the finished practice tests',

    /** Which run of its practice test this is. The server supplies the figure. */
    run: (ordinal: number) => `Run ${ordinal}`,
    /** When it was handed in, in the device's own formatting. */
    submitted: (instant: string) => `Handed in ${instant}`,
    /**
     * The same fact with no date, for a stored instant that will not parse.
     *
     * The run was still handed in — that is why it is in this list at all — so the
     * sentence states it and drops only the part that cannot be stated. The words
     * "Invalid Date" on a parent's screen read as a fault in the practice test
     * rather than in a string, and a screen reader says them out loud.
     */
    submittedUndated: 'Handed in',
    /** A test whose Subject carries no classification or no longer resolves. */
    unknownSubject: 'No subject',
    open: 'Read it',

    detailTitle: 'The practice test, as it was marked',
    detailFailed: 'That practice test could not be opened. Try again.',
    /** A run that is not there, or not this account's. One sentence for all of it. */
    notFound: 'That practice test could not be found.',
    /**
     * The score, from the two figures the server computed over exactly the rows in
     * the same response. The browser counts nothing (FR-37).
     */
    score: (correct: number, denominator: number) => `${correct} of ${denominator} marked correct`,
    /** Stated when Questions were left out of the denominator, in words. */
    excluded: (count: number) =>
      count === 1
        ? '1 question has not been graded and is not counted.'
        : `${count} questions have not been graded and are not counted.`,
    questionsHeading: 'Every question',

    /** Each row's heading. Third person: the number, not "your question". */
    question: (ordinal: number) => `Question ${ordinal}`,
    /** What kind of question it was, in the parent's own wording. */
    format: {
      MultipleChoice: 'Multiple choice',
      FillInTheBlank: 'Fill in the blank',
      ShortAnswer: 'Short answer',
    },
    /** Above what the child put down. About them, never to them. */
    studentAnswer: 'The student answered',
    /** Instead of an empty space, for a Question left blank. */
    noAnswer: 'The student left this one blank.',
    correctAnswer: 'Correct answer',
    answerUnavailable: 'The answer for this question is not available.',
    rowUngraded: 'This one has not been graded yet.',
    rowNewlyGraded: 'Just graded.',

    /** The inline region beneath a row, headed as what it is. */
    explanationHeading: 'What the student was told',
    /**
     * A Question the child never asked about. Stated as a fact about the asking,
     * because nothing was generated and nothing will be: this screen does not
     * explain anything, it reads what was already explained.
     */
    nothingExplained: 'The student did not ask about this question.',
    flagControl: 'Report a problem with this explanation',
    /** Once flagged. The state, named rather than the act that produced it. */
    flagged: (instant: string) => `Reported ${instant}`,
    /**
     * The same state with no date, for a stored instant that will not parse.
     *
     * The concern was still recorded, which is the fact a parent needs; only the
     * instant is unstateable, and "Reported Invalid Date" would put the fault on
     * the report.
     */
    flaggedUndated: 'Reported',
    /**
     * What flagging does, said **before** it is pressed and kept beside the
     * flagged state afterwards.
     *
     * It exists because a control with no consequence a parent can see teaches
     * them it did something it did not. Suppression is the act that changes what a
     * child is served, and it is not this one.
     */
    flagNote:
      'Reporting an explanation records the concern for review. The student still sees the same explanation.',
    /** Announced, and shown, in the same words. */
    flagAnnouncement: (ordinal: number) =>
      `The explanation for question ${ordinal} is reported. The student still sees the same explanation.`,
    flagFailed: 'That explanation could not be reported. Try again.',
    explanationsFailed: 'What the student was told could not be read. Try again.',

    // --- What the student reported, and what the parent decides ----------
    //
    // Third person about the child throughout, every figure a parameter, and every
    // sentence whole here rather than assembled at a call site.
    //
    // **The confirm copy states what confirming does and what it does not.** It sends
    // the report on for review; it does not remove the explanation, and the student is
    // served exactly the same one afterwards. A control whose consequence a parent
    // cannot see teaches them it did something it did not — and here the wrong
    // assumption would be that confirming took something away from their child.
    //
    // **Nothing here names an operator, a queue, a tier or a cost.** "Sent on for
    // review" is the whole of what a parent is told about what happens next, because it
    // is the whole of what is true.

    /** The student has reported this one. The state, not the act. */
    studentFlagged: (instant: string) => `The student reported this explanation on ${instant}.`,
    /** The same state with no date, for a stored instant that will not parse. */
    studentFlaggedUndated: 'The student reported this explanation.',
    /**
     * What the parent has to do about it, said once, above the two controls.
     *
     * It names the choice rather than urging it: a report nobody has decided about is
     * not a problem a parent has caused, and a sentence that pressed them would turn
     * their child raising a hand into a chore.
     */
    studentFlagAwaiting: 'The student says this explanation is wrong. Decide what happens next.',
    /** Agreeing with the child. */
    confirm: 'Agree and send it on for review',
    /** Disagreeing with the child. */
    dismiss: 'Decide the explanation is fine',
    /**
     * What each decision does, in words, beside the two controls.
     *
     * Both halves matter. Confirming sends it on and **does not remove the
     * explanation**, which is the assumption a parent would otherwise make; dismissing
     * records the decision and tells the student nothing, which is the assumption they
     * would otherwise make about that one.
     */
    dispositionNote:
      'Agreeing sends the report on for review. It does not remove the explanation, and the student still sees the same one either way. The student is not told what you decide.',
    /** Decided, and which way. */
    confirmed: (instant: string) => `Agreed and sent on for review on ${instant}.`,
    dismissed: (instant: string) => `Decided the explanation is fine on ${instant}.`,
    /** The same two states with no date, for a stored instant that will not parse. */
    confirmedUndated: 'Agreed and sent on for review.',
    dismissedUndated: 'Decided the explanation is fine.',
    /** Announced, and shown, in the same words. */
    confirmAnnouncement: (ordinal: number) =>
      `The report about question ${ordinal} is sent on for review. The student still sees the same explanation.`,
    dismissAnnouncement: (ordinal: number) =>
      `The explanation for question ${ordinal} is decided to be fine. The student is not told.`,
    disposeFailed: 'That decision could not be recorded. Try again.',

    // --- Removing an explanation, and replacing it for nothing -----------
    //
    // Third person about the child throughout, every figure a parameter, and every
    // sentence whole here rather than assembled at a call site.
    //
    // **The confirmation names every consequence before it fires, including the one that
    // cannot be taken back.** A parent who assumed this deleted the record, or applied to
    // every child, or changed the grade, would be finding out afterwards -- and afterwards
    // is exactly when nothing can be done about it.
    //
    // **Nothing here names a tier, a price, a model or a counter.** The regeneration's cost
    // is stated as what it is -- nothing, at every plan -- and not as a figure, a number of
    // units left or an exception to a limit.

    /** The control that stops an explanation being shown to the student. */
    suppressControl: 'Remove this explanation from the student',
    /** The confirmation's title. What is about to happen, named plainly. */
    suppressTitle: 'Remove this explanation?',
    /**
     * Every consequence, before it fires -- and there is no "afterwards" to read it in.
     *
     * Seven facts in one breath, and each is one a parent would otherwise assume the other
     * way: it stops being shown to **this student only**; **the student will be told it was
     * removed**; it is not a deletion; it stays readable here; it is still visible to the
     * people reviewing reports; the question, the attempt, its score and Mastery are
     * unchanged; and it **cannot be undone**.
     *
     * **Mastery, not "progress".** Parent View names the figure the way the Analytics
     * dashboard does; "progress" is the word reserved for the child's own screen (see
     * `copy/student.ts`), and using it here would be the parent-facing surface borrowing
     * the wrong register for the one figure this dialog has to name precisely.
     *
     * **The student-visible statement is named second, right after the removal itself.** It is
     * the most visible consequence of all and the easiest to assume the other way: a parent
     * expecting a silent removal would otherwise find out from their child. It says what the
     * child is shown and no more — the child is never told who decided or why beyond the
     * product's own sentence.
     *
     * The irreversibility is last, because it is the one that decides whether to press.
     */
    suppressBody:
      'This explanation stops being shown to this student, and the student is told that a parent removed it. It is not deleted: it stays here for you to read, and it is still visible to the people reviewing reported explanations. The question, the attempt, its score and Mastery are all unchanged, and no other student is affected. This cannot be undone.',
    /** The confirm control inside the dialog. The act, named again. */
    suppressConfirm: 'Remove it',
    /** Once removed. The state, named rather than the act that produced it. */
    suppressed: (instant: string) => `Removed from the student on ${instant}.`,
    /**
     * The same state with no date, for a stored instant that will not parse.
     *
     * It was still removed, which is the fact a parent needs; only the date is unstateable,
     * and "Removed Invalid Date" would put the fault on the removal.
     */
    suppressedUndated: 'Removed from the student.',
    /** Announced, and shown, in the same words. */
    suppressAnnouncement: (ordinal: number) =>
      `The explanation for question ${ordinal} is no longer shown to the student. This cannot be undone.`,
    suppressFailed: 'That explanation could not be removed. Try again.',

    /** The control that asks for a replacement. Offered only once one has been removed. */
    regenerateControl: 'Write a new explanation',
    /**
     * What it costs, said **before** it is pressed.
     *
     * Nothing, at every plan -- stated as the fact rather than as an exception, a figure or
     * a number of units left. A parent who has just taken something away from their child
     * should not have to weigh whether replacing it will cost them something.
     */
    regenerateNote:
      'Writing a new explanation costs nothing. It is free on every plan, and it does not count against anything.',
    /** The request is out. Stated, so the press is never silent. */
    regenerating: 'Writing a new explanation…',
    /** Announced, and shown, in the same words. */
    regeneratedAnnouncement: (ordinal: number) =>
      `A new explanation for question ${ordinal} is written, and the student can read it.`,
    regenerateFailed: 'A new explanation could not be written just now. Try again.',
    /**
     * Which explanation of this question an entry is.
     *
     * A question can hold several: the one the student asked for, and each replacement
     * after it. The label is what tells them apart on screen, and the ordinal is handed in.
     */
    generationLabel: (ordinal: number) => `Explanation ${ordinal}`,

    // --- Adjusting a mark, and the evidence it is adjusted on -------------
    //
    // Third person about the child throughout, every figure a parameter, and every
    // sentence whole here rather than assembled at a call site.
    //
    // **The original mark and its reason are never described as gone.** They are retained
    // and still readable here after an adjustment, which is the whole of FR-25: a parent
    // who thought adjusting destroyed the reason would stop being able to check their own
    // decision. So the recorded mark keeps its own label and its own place on screen.
    //
    // **Nothing here names a model, a provider, a cost or a tier.** "How this was marked"
    // is as specific as the reason's heading gets: naming a provider would put a billing
    // fact on a screen about a child's work, and "the AI" invites a parent to relay it to
    // their child, which is the one thing the student surface exists to prevent.
    //
    // **Nothing here is a dismissal.** There is no control that settles a dispute the
    // other way, because nothing in the requirement authorizes one — a parent who reads a
    // dispute and agrees with the mark leaves it listed as awaiting, which is what a
    // record of an unanswered concern should look like. The copy therefore never offers
    // one and never implies it exists.

    override: {
      /** The region's own heading, above the recorded mark and the reason. */
      heading: 'How this was marked',
      /** What the marking recorded, which the adjustment does not erase. */
      recorded: (grade: string) => `Recorded as ${grade}`,
      /** The words a mark is stated in — the one map, shared with the dispute list. */
      grade: GRADE_LABELS,
      /**
       * The control that shows and hides the reason.
       *
       * **Collapsed by default**, and one label for both directions because
       * `aria-expanded` is what says which way the press goes. The reason is a paragraph
       * per question, and twenty of them open at once is a screen a parent cannot scan —
       * so it is there when they go looking and out of the way when they are not.
       */
      reasonControl: 'Why it was marked that way',
      /** Above the reason itself. */
      reasonHeading: 'The reason given',
      /**
       * A question whose mark came with no reason.
       *
       * Stated as the fact rather than as a failure: a multiple-choice question is marked
       * by comparison and a blank is not a judgement, so there was never a reason to
       * give. A parent reading "not available" would go looking for one.
       */
      noReason: 'This question was not marked by judgement, so there is no reason to read.',
      /** The student said the mark is wrong. The state, not the act. */
      disputed: (instant: string) => `The student said this is marked wrong on ${instant}.`,
      /** The same state with no date, for a stored instant that will not parse. */
      disputedUndated: 'The student said this is marked wrong.',
      /**
       * What there is to do about it, said once, above the control.
       *
       * It names the choice rather than urging it: a dispute nobody has decided about is
       * not a problem the parent caused, and a sentence that pressed them would turn
       * their child raising a hand into a chore. It also says the one thing a parent
       * would otherwise assume — that leaving it alone is a legitimate answer.
       */
      disputeAwaiting:
        'The student says this mark is wrong. You can change it, or leave it as it is.',
      /** The control that picks the other mark. Nothing is sent until it is saved. */
      control: (grade: string) => `Change the mark to ${grade}`,
      /**
       * What adjusting does, in words, beside the control.
       *
       * Four facts and each is one a parent would otherwise assume the other way: the
       * recorded mark and its reason are **kept**; the score is recalculated; the student
       * sees the new mark and one plain line that a grown-up looked at it; and the student
       * is never shown the reason or told what it said.
       */
      note: 'Changing the mark recalculates the score for this practice test. The recorded mark and its reason are kept here for you. The student sees the new mark and one line saying a grown-up looked at it, and never the reason.',
      /**
       * A question the marking never judged, said where the control would otherwise be.
       *
       * **Stated rather than left blank.** An unanswered question and one nothing has
       * graded are not judgements there is anything to disagree with, so there is no
       * control — and a region that simply showed nothing would leave a parent looking
       * for one, especially on a question their child objected to. It names the reason
       * and stops: no instruction, because nothing the parent can do changes it.
       */
      notJudged: 'This question was not marked right or wrong, so there is no mark to change.',
      /** The explicit save. A picked mark is not a saved one. */
      save: 'Save this mark',
      /**
       * Puts a picked mark back, without saving anything.
       *
       * It exists because a pick is a step and not a decision: a mis-press would otherwise
       * be escapable only by saving the wrong mark. It says what it undoes — the picking —
       * rather than "cancel", which a parent could read as abandoning the whole question.
       */
      cancel: 'Keep the mark as it is',
      /** The same control while the request is out. Stated, so the press is never silent. */
      saving: 'Saving…',
      /** The picked-but-unsaved mark, restored after Parent View was crossed again. */
      restored:
        'You had picked a different mark for this question and had not saved it. It is still picked.',
      /** Once adjusted. The state, named rather than the act that produced it. */
      adjusted: (instant: string) => `You set this mark on ${instant}.`,
      /** The same state with no date, for a stored instant that will not parse. */
      adjustedUndated: 'You set this mark.',
      /** The row-level marker, said on the row itself so a row read alone still says it. */
      rowParentAdjusted: 'A parent set this mark.',
      /** Announced, and shown, in the same words. */
      announcement: (ordinal: number, grade: string) =>
        `Question ${ordinal} is now marked ${grade}, and the score is recalculated.`,
      failed: 'That mark could not be saved. Try again.',
      /**
       * The score stated as a change rather than one figure replacing another.
       *
       * Every figure is the server's, over the one denominator both fractions share: an
       * adjustment moves a question between right and wrong and never into or out of the
       * count. This module divides nothing and computes no percentage.
       */
      scoreChanged: (before: number, after: number, denominator: number) =>
        `${before} of ${denominator} marked correct, adjusted by parent to ${after} of ${denominator}.`,
    },
  },

  /**
   * The list of what one student has reported, and the only place its copy is written.
   *
   * **A list, not a dashboard band.** It states what the student reported and what has
   * been decided, and nothing else: no Mastery figure, no score, no grade and no
   * analytics of any kind. Third person about the child throughout.
   *
   * Every figure is a parameter. Not one instant, ordinal or count is written into a
   * sentence here.
   */
  flags: {
    title: 'What a student has reported',
    /**
     * Why a parent is here, stated as what the screen is for: their child said an
     * explanation was wrong, and this is where those are found.
     */
    intro:
      'A student can say an explanation is wrong. Everything they have reported is listed here, newest first, with what has been decided about it.',
    /** The child selector. One child at a time, because a report belongs to one. */
    studentLabel: 'Student',
    loading: 'Loading…',
    /** No profile to choose from yet. The way on is the Students screen. */
    noStudents: 'There is no student profile yet. Add one first.',
    /** A child who has reported nothing. A state, not a fault, and the common one. */
    empty: 'This student has not reported an explanation.',
    listFailed: 'What the student has reported could not be listed. Try again.',
    /**
     * The **profiles** read failed, which is a different claim from the one above.
     *
     * Two sentences because two reads can fail independently, and saying "what the student
     * has reported could not be listed" when it was the list of students that could not be
     * read names the wrong thing — beside a selector that is empty for a reason the
     * sentence does not give.
     */
    profilesFailed: 'The students could not be listed. Try again.',
    retry: 'Try again',
    backToParentView: 'Back to Parent View',
    /** Which run and which question a report points at. Both figures the server's. */
    where: (runOrdinal: number, questionOrdinal: number) =>
      `Run ${runOrdinal}, question ${questionOrdinal}`,
    /**
     * The same entry with no run or question to name, for a context that no longer
     * resolves.
     *
     * The report was still made, which is why it is in this list at all: the entry keeps
     * its place and loses only its label.
     */
    whereUnknown: 'The practice test this belongs to is no longer available.',
    /** A test whose Subject carries no classification or no longer resolves. */
    unknownSubject: 'No subject',
    /** When the student reported it. */
    reported: (instant: string) => `Reported ${instant}`,
    reportedUndated: 'Reported',
    /** Awaiting a decision, which is the absence of one rather than a state somebody set. */
    awaiting: 'Waiting for a decision',
    /** Decided, and which way. Both figures the response's. */
    confirmed: (instant: string) => `Sent on for review ${instant}`,
    dismissed: (instant: string) => `Decided to be fine ${instant}`,
    confirmedUndated: 'Sent on for review',
    dismissedUndated: 'Decided to be fine',
    /** The way through to the explanation itself, which is read beside its question. */
    open: 'Read the explanation',
  },

  /**
   * The list of the marks one student says are wrong, and the only place its copy is
   * written.
   *
   * **A list, not a dashboard band.** It states what the student objected to, what the
   * mark was recorded as, what it is now and whether it has been decided — and nothing
   * else: no Mastery figure, no score for the run, no analytics of any kind. Third person
   * about the child throughout.
   *
   * **Awaiting is the absence of a decision.** There is no "dismissed" here and no
   * "declined", because there is no control that settles a dispute the other way: a
   * parent who reads one and agrees with the mark leaves it awaiting, and a word for that
   * would be inventing an outcome nobody recorded.
   *
   * Every figure is a parameter. Not one instant, ordinal or grade is written into a
   * sentence here.
   */
  disputes: {
    title: 'Marks a student says are wrong',
    /**
     * Why a parent is here, stated as what the screen is for: their child said a mark was
     * wrong, and this is where those are found.
     */
    intro:
      'A student can say a question was marked wrong. Everything they have said is listed here, newest first, with what the mark is now.',
    /** The child selector. One child at a time, because a dispute belongs to one. */
    studentLabel: 'Student',
    loading: 'Loading…',
    /** No profile to choose from yet. The way on is the Students screen. */
    noStudents: 'There is no student profile yet. Add one first.',
    /** A child who has objected to nothing. A state, not a fault, and the common one. */
    empty: 'This student has not said a mark is wrong.',
    listFailed: 'The marks the student says are wrong could not be listed. Try again.',
    /**
     * The **profiles** read failed, which is a different claim from the one above.
     *
     * Two sentences because two reads can fail independently, and saying the disputes
     * could not be listed when it was the list of students that could not be read names
     * the wrong thing — beside a selector that is empty for a reason the sentence does not
     * give.
     */
    profilesFailed: 'The students could not be listed. Try again.',
    retry: 'Try again',
    backToParentView: 'Back to Parent View',
    /** Which run and which question a dispute points at. Both figures the server's. */
    where: (runOrdinal: number, questionOrdinal: number) =>
      `Run ${runOrdinal}, question ${questionOrdinal}`,
    /**
     * The same entry with no run or question to name, for a context that no longer
     * resolves.
     *
     * The objection was still raised, which is why it is in this list at all: the entry
     * keeps its place and loses only its label.
     */
    whereUnknown: 'The practice test this belongs to is no longer available.',
    /** A test whose Subject carries no classification or no longer resolves. */
    unknownSubject: 'No subject',
    /** When the student said it. */
    raised: (instant: string) => `Said this on ${instant}`,
    /**
     * The same fact with no date, for a stored instant that will not parse.
     *
     * A whole clause rather than the bare word the dated form opens with: "Said" alone is
     * a fragment a reader finishes in their head, and the words "Invalid Date" beside it
     * would read as a fault in the objection rather than in a string.
     */
    raisedUndated: 'Said this',
    /** What the marking recorded, which an adjustment does not erase. */
    recorded: (grade: string) => `Recorded as ${grade}`,
    /** What the mark counts as now. Stated even when it is the same, so nothing is implied. */
    effective: (grade: string) => `Marked ${grade} now`,
    /** The words a mark is stated in — the one map, shared with the run's own region. */
    grade: GRADE_LABELS,
    /** Nobody has changed it. The absence of a decision, not one somebody recorded. */
    awaiting: 'Waiting for you to decide',
    /**
     * Resolved: a parent set the mark, and when.
     *
     * Worded exactly as `attempts.override.adjusted` words the same fact on the run
     * itself, down to the preposition and the stop: a parent reads this line here and
     * again one click later, and two spellings of one sentence read as two different
     * events.
     */
    resolved: (instant: string) => `You set this mark on ${instant}.`,
    resolvedUndated: 'You set this mark.',
    /** The way through to the question itself, where the reason is read and the mark set. */
    open: 'Read the question',
  },
  /**
   * The dashboard. **Every sentence about a student's work is a function of the
   * address** and never a literal naming the child (UX-DR31) — Parent View is third
   * person, by name, so the name arrives as an argument rather than being written in.
   *
   * **Not one threshold, window size or percentage is stated here.** The answered
   * floor, the ceiling and the trend's window all arrive on the response, resolved by
   * the API at boot; a figure restated in this file would drift silently the first
   * time an operator changed the environment.
   *
   * No account plan, no price and no prompt to buy anything: the empty state is a
   * mechanism and a progress, not a sales surface.
   */
  analytics: {
    title: 'Where a student is strong and weak',
    intro: 'Everything below is about one student, from the work they have already finished.',
    studentLabel: 'Student',
    loading: 'Loading…',
    noStudents: 'There is no student profile yet. Add one first.',
    loadFailed: 'This could not be loaded. Try again.',
    /**
     * The **profiles** read failed, which is a different claim: saying the dashboard
     * could not be loaded when it was the list of students that could not be read
     * names the wrong thing, beside a selector that is empty for a reason the
     * sentence does not give.
     */
    profilesFailed: 'The students could not be listed. Try again.',
    retry: 'Try again',
    backToParentView: 'Back to Parent View',

    /** What is waiting, and what is done — the whole list, in one sentence. */
    activityTitle: 'Practice tests',
    activity: (name: string, counts: { released: number; completed: number }) =>
      `${name} has ${counts.released} practice test${counts.released === 1 ? '' : 's'}, ${counts.completed} of them finished.`,
    activityBreakdown: (counts: { unstarted: number; inProgress: number }) =>
      `${counts.unstarted} not started, ${counts.inProgress} in progress.`,

    /** The one trend on the page, with its own scope said beside it. */
    trendTitle: 'Recent scores',
    /**
     * The chart's scope, stated on the chart: how many runs, whose, and which runs
     * count. It says "first runs" because a retake is excluded, and it never claims
     * to be a record of everything the student did.
     */
    trendScope: (name: string, windowSize: number) =>
      `The last ${windowSize} practice tests ${name} finished for the first time, oldest first. Retakes are not plotted.`,
    /**
     * One plotted run, as the text equivalent of a point.
     *
     * **Labelled by the date it was handed in, not by its place in the list.** "Test
     * 3" is a fact about this chart, not about the student's work — it renames
     * itself the moment a run drops out of the window, and it collides with the
     * ordinal a parent already knows a practice test by.
     */
    trendPoint: (when: string, correct: number, denominator: number) =>
      `${when}: ${correct} of ${denominator} correct.`,
    /**
     * The same point where some questions could not be marked.
     *
     * Stated rather than dropped: a run scored over fewer questions than the
     * student sat reads as a worse result than it was, unless the reason is beside
     * it.
     */
    trendPointExcluded: (when: string, correct: number, denominator: number, excluded: number) =>
      `${when}: ${correct} of ${denominator} correct. ${excluded} question${excluded === 1 ? '' : 's'} could not be marked.`,
    /** The same fact about the most recent run, beside the printed figure. */
    trendLatestExcluded: (excluded: number) =>
      `${excluded} question${excluded === 1 ? '' : 's'} in this test could not be marked.`,
    /** An instant that will not parse. The run happened; only its date is unstateable. */
    trendPointUndated: 'This test',
    /** The endpoint's own figure, printed beside the line. */
    trendLatest: (correct: number, denominator: number) => `${correct} of ${denominator}`,
    trendEmpty: (name: string) => `${name} has not finished a practice test yet.`,

    /** The ranked table. */
    masteryTitle: 'Topics',
    /**
     * **The table's own scope, stated on the table**, exactly as the chart states
     * its own — and deliberately not the same scope. A topic's figure is over the
     * last few practice tests that *asked about that topic*, where the chart is
     * over the last few finished at all, so the two select different runs for most
     * students. Both are stated; neither is reconciled with the other, because
     * reconciling them would mean answering a question nobody asked.
     *
     * The window is the API's figure and the per-row count is the API's too, so no
     * number here is one this app knows.
     */
    masteryScope: (name: string, windowSize: number) =>
      `Each topic is over the last ${windowSize} practice tests ${name} finished for the first time that asked about it — not the same ${windowSize} tests as the scores above.`,
    /** How many runs one row's own figure is actually over. */
    masteryRowScope: (attemptsCounted: number) =>
      `over ${attemptsCounted} practice test${attemptsCounted === 1 ? '' : 's'}`,
    /** The column that states it, for the widths where the table has columns. */
    runsColumn: 'Practice tests',
    topicColumn: 'Topic',
    masteryColumn: 'How much is right',
    answeredColumn: 'Questions answered',
    unansweredColumn: 'Left blank',
    statusColumn: 'Status',
    /** A stored figure whose topic no longer resolves. The row keeps its place. */
    unknownTopic: 'A topic that is no longer listed',
    /**
     * The Mastery figure, **always with the skipped count beside it**: a percentage
     * on its own is a percentage over a denominator nobody stated.
     */
    masteryFigure: MASTERY_FIGURE,
    /** A topic the student was asked about and skipped entirely. There is no figure. */
    masteryNone: MASTERY_NONE,
    unansweredNote: BLANKS_NOTE,
    /** No question was skipped. Said rather than left out, so nothing is implied. */
    unansweredNone: BLANKS_NONE,
    /** The label on the marker. The same words the marker announces. */
    weakArea: 'Weak Area',

    /** The Subject filter. The heading changes when the table is narrowed. */
    subjectLabel: 'Subject',
    allSubjects: 'Every subject',
    subjectHeading: (subjectName: string) => `Topics in ${subjectName}`,
    /** A topic whose subject no longer resolves, as an option. */
    unknownSubject: 'No subject',

    /** The digest: what is waiting for the parent, each with its way through. */
    digestTitle: 'Waiting for you',
    disputes: (count: number) =>
      count === 1
        ? '1 mark a student says is wrong is waiting for you.'
        : `${count} marks a student says are wrong are waiting for you.`,
    disputesNone: 'No marks are waiting for a decision.',
    openDisputes: 'Read the marks',
    flags: (count: number) =>
      count === 1
        ? '1 reported explanation is waiting for you.'
        : `${count} reported explanations are waiting for you.`,
    flagsNone: 'No reported explanations are waiting for a decision.',
    openFlags: 'Read the reports',

    /**
     * The Explanation counter. **Stated as the account's**, because it is: it is
     * shared by every student on the account and is not this one's budget.
     */
    allowanceTitle: 'Explanations on this account',
    allowanceUsed: (used: number, limit: string) => `${used} of ${limit} used this period.`,
    /** No ceiling. Said in words, never as a number and never as "0 left". */
    allowanceUnlimited: (used: number) => `${used} used this period. There is no limit.`,
    allowanceResets: (date: string) => `The count starts again on ${date}.`,

    /**
     * The empty state: **the mechanism, and how far along it is.**
     *
     * It names the one thing that makes a figure appear — answered questions on a
     * topic — and the figure the API resolved for it, so a parent knows what to do
     * rather than only that there is nothing here. Nothing about an account plan and
     * nothing to buy: a parent with no data has a waiting problem, not a purchasing
     * one.
     */
    emptyTitle: 'Nothing to show yet',
    empty: (name: string, answeredFloor: number) =>
      `A topic appears here once ${name} has answered ${answeredFloor} questions on it in a finished practice test.`,
    /**
     * There **is** finished or started work, and still no topic figure.
     *
     * The distinction matters: a parent whose child has finished two tests and is
     * told "no practice test has been finished yet" is told something false, and
     * concludes the product is broken rather than that it is waiting.
     */
    emptyProgress: (counts: { completed: number; inProgress: number }) => {
      const finished = `${counts.completed} practice test${counts.completed === 1 ? '' : 's'} finished`;
      return counts.inProgress === 0
        ? `${finished} so far. No topic has enough answered questions yet.`
        : `${finished} so far, and ${counts.inProgress} in progress. No topic has enough answered questions yet.`;
    },
    /** Nothing started and nothing finished, so there is no progress to state. */
    emptyNoWork: 'No practice test has been started yet.',
  },
  /**
   * The topic drill-down: the evidence behind one figure, and the one thing a parent
   * can do about it.
   *
   * **Every sentence about the student is a function of the subject** (UX-DR31): Parent
   * View is third person and names the child, so no literal in the screen and no
   * default here addresses anybody. The figure and blank wordings are the `analytics`
   * group's own functions, reused rather than re-typed, so the dashboard row and the
   * drill-down heading cannot come to state the same figure differently.
   *
   * **No account plan is named and there is nothing offered for sale.** A parent looking
   * at a weak topic has a practice problem, not a purchasing one — and the cost block
   * below is denominated in practice tests, which is the only unit this product spends.
   */
  topicDrillDown: {
    /** The way back, naming the place rather than the action. */
    back: 'Back to the topics',
    loading: 'Loading\u2026',
    /** The drill-down read failed. Its own sentence, never a platform string. */
    loadFailed: 'This topic could not be opened. Try again.',
    /** The **profiles** read failed, which is a different claim. */
    profilesFailed: 'The students could not be listed. Try again.',
    /** The allowance read failed. The evidence still renders; only the cost cannot. */
    allowanceFailed: 'What is left of the Generation Allowance could not be read. Try again.',
    retry: 'Try again',

    /** The heading: which topic, about which student. */
    title: (name: string, topicName: string) => `${topicName}, for ${name}`,
    /** A stored figure whose topic no longer resolves. The screen keeps its place. */
    unknownTopic: 'A topic that is no longer listed',
    /**
     * The `?student=` in the address names nobody this account has.
     *
     * A deleted profile, another account's child, or a link that was edited. One
     * sentence for all of them — this screen does not try to tell them apart, because
     * telling them apart would be confirming which ids exist — and the way back is the
     * table that knows who is selected.
     */
    unknownStudent:
      'This topic could not be shown, because the student in the address is not one on this account. Go back to the topics and open the row again.',
    /**
     * A row whose stored question could no longer be read back.
     *
     * It keeps its place, because the figure above is still over it — but it is headed
     * by what is actually known rather than by "Question 0", which would be a claim
     * about a number the system has just admitted it cannot recover.
     */
    unidentifiedQuestion: 'A question that can no longer be identified',
    /** Which subject the topic sits under, when it still resolves. */
    subject: (subjectName: string) => `Subject: ${subjectName}`,

    /**
     * The figure, with the count it is over — the `analytics` wording, so the two
     * screens cannot drift.
     */
    figure: MASTERY_FIGURE,
    /** A topic the student was asked about and skipped entirely. There is no figure. */
    figureNone: MASTERY_NONE,
    /** How many runs the figure is over — the API's count, never one derived here. */
    scope: (name: string, attemptsCounted: number) =>
      `This is over the last ${attemptsCounted} practice test${attemptsCounted === 1 ? '' : 's'} ${name} finished for the first time that asked about this topic.`,
    /** The blank count, in the same words the dashboard uses. */
    blanks: BLANKS_NOTE,
    blanksNone: BLANKS_NONE,
    /**
     * What a blank *means*, said once on the screen it matters on.
     *
     * Two facts, and both are needed: a skipped question is counted in neither part of
     * the figure, and it is only a blank at all because the practice test was handed in
     * before its timer ran out. Had the timer expired, the same empty box would have
     * been marked wrong — so a parent reading "3 left blank" beside a percentage that
     * ignores them is owed the reason.
     */
    blanksExplained: (name: string) =>
      `A question ${name} left blank counts in neither part of the figure above \u2014 it is not a right answer and not a wrong one. Had the practice test's timer run out, the same empty answers would have been marked wrong instead.`,

    /** The two lists, each named after the student and never addressed to them. */
    missedHeading: (name: string) => `What ${name} got wrong`,
    unansweredHeading: (name: string) => `What ${name} left blank`,
    /** Neither list has anything in it, and the figure still stands. */
    missedNone: (name: string) => `${name} got none of these questions wrong.`,
    unansweredNone: (name: string) => `${name} left none of these questions blank.`,
    /** Which run a row came off, and when it went in. */
    rowFrom: (when: string) => `From the practice test handed in on ${when}`,
    /** The same fact for a stored instant that will not parse. */
    rowFromUndated: 'From a finished practice test',

    /**
     * There is no stored figure for this topic and this student at all.
     *
     * The same sentence for a topic they have never been asked about, one met only on a
     * retake, and one belonging to another account's child: this screen does not try to
     * tell those apart, because the API does not either.
     */
    empty: (name: string) =>
      `There is nothing to show for this topic yet. A figure appears once ${name} has answered questions on it in a finished practice test.`,

    /** "Generate more on this" — the section, the cost, then the control. */
    generateHeading: 'Generate more on this',
    /** What the control will do, before the cost and before it can be pressed. */
    generateIntro: (topicName: string) =>
      `This makes one more practice test from an upload that already covers ${topicName}, with most of its questions on that topic.`,
    /** Which upload it would come from, so a parent recognises the paper. */
    generateFrom: (subjectName: string, when: string) =>
      `From the ${subjectName} upload of ${when}.`,
    generateFromUndated: (subjectName: string) => `From a ${subjectName} upload.`,
    /** The same, for an upload whose subject no longer resolves. */
    generateFromUnknownSubject: (when: string) => `From the upload of ${when}.`,
    /**
     * Neither a subject nor a readable date.
     *
     * Its own sentence rather than one of the three above with a stand-in dropped into
     * it: passing "a finished practice test" where a date belongs reads "From the upload
     * of From a finished practice test", which is the kind of sentence a parent reads as
     * a fault in the product.
     */
    generateFromUnknown: 'From an earlier upload of this student’s.',

    /**
     * The cost, in **practice tests** and in three lines: what this spends, what is
     * left, and what is left after. All three above the control, and every figure the
     * API's.
     */
    costSpend: (count: number) =>
      count === 1
        ? 'This uses 1 practice test of the Generation Allowance.'
        : `This uses ${count} practice tests of the Generation Allowance.`,
    costRemaining: (remaining: number) =>
      remaining === 1
        ? '1 practice test is left in the Generation Allowance this period.'
        : `${remaining} practice tests are left in the Generation Allowance this period.`,
    /** No ceiling. Said in words, never as a number and never as "0 left". */
    costRemainingUnlimited: 'The Generation Allowance on this account has no limit.',
    costAfter: (after: number) =>
      after === 1
        ? '1 practice test would be left afterwards.'
        : `${after} practice tests would be left afterwards.`,
    /** An unlimited account has no remainder to state, so none is invented. */
    costAfterUnlimited: 'There is no remainder to state afterwards.',
    /** When the counters start again, in the account's own zone. */
    resets: (date: string) => `The count starts again on ${date}.`,
    /** Nothing is left, so the control is disabled and says why. */
    spent: 'No Generation Allowance is left this period, so nothing can be made right now.',

    /** The control. One tap, one practice test, this topic already chosen. */
    fire: 'Generate one practice test on this topic',
    /** While the request is in flight. */
    firing: 'Starting\u2026',
    /** The request was refused or never arrived. The screen stays usable. */
    fireFailed: 'The practice test could not be started. Try again.',

    /**
     * No upload of this student's carries the topic, so there is nothing to aim a
     * request at and no control is offered.
     *
     * The reason is stated rather than the control being quietly absent: a parent who
     * read the evidence and found no way to act on it would conclude the product is
     * broken rather than that this topic came off a paper they no longer have.
     */
    noTarget: (name: string) =>
      `None of ${name}'s uploads covers this topic any more, so there is nothing to make more practice from. Upload a paper that covers it to practise it again.`,
  },

  errors: {
    generic: 'Something went wrong. Try again.',
    network: 'The request could not be completed. Check the connection and try again.',
    tooManyAttempts: 'Too many attempts. Wait a minute and try again.',
    policyUnavailable: 'The sign-up requirements could not be loaded.',
    retry: 'Try again',
  },
} as const;
