/**
 * The single copy module for the parent-facing auth screens. No user-facing
 * string is a hardcoded literal in a component (AD-32).
 *
 * Not one figure or version appears here: the password minimum, the consent
 * versions and the notice text all come from `GET /api/auth/policy`.
 */
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
    loading: 'Loading Parent View…',

    /**
     * Leaving Parent View is handing the device to a child, so the control
     * names where it goes rather than what it closes. Third person, by name —
     * this is a parent reading about their child, never the child themself.
     */
    backToStudent: 'Back to Student Mode',
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
    archiveNote: 'Archiving hides the profile from Student Mode and keeps its history.',
    archiveConfirm: (name: string) =>
      `Archive ${name}? The profile is hidden from Student Mode and its history is kept. Nothing is deleted.`,
    archived: (name: string) => `${name} is archived and hidden from Student Mode.`,
    restore: 'Restore',
    restoreNote: 'Restoring puts the profile back in Student Mode.',
    restored: (name: string) => `${name} is active again.`,

    failed: 'That change could not be saved. Try again.',
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
    childLabel: 'Child',
    loading: 'Loading the pages…',
    empty: 'There are no pages yet. Add the first one below.',
    noProfiles: 'There is no profile to upload for yet. Add one first.',

    addPage: 'Add page',
    adding: 'Adding the page…',
    /** Says why the add control is gone, rather than leaving it unexplained. */
    limitReached: (max: number) => `This upload already holds ${max} pages.`,

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
    submitBlocked: (reasons: readonly ('pages' | 'classification')[]): string =>
      reasons
        .map((reason) =>
          reason === 'pages'
            ? 'Add at least one page before submitting.'
            : 'Choose a subject and a grade level before submitting.',
        )
        .join(' '),

    added: (ordinal: number) => `Page ${ordinal} was added.`,
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

    failed: 'That change could not be saved. Try again.',
    addFailed: 'That page could not be added. Try again with another photo.',
    submitFailed: 'The pages could not be submitted. Try again.',
    back: 'Back to Parent View',
  },
  errors: {
    generic: 'Something went wrong. Try again.',
    network: 'The request could not be completed. Check the connection and try again.',
    tooManyAttempts: 'Too many attempts. Wait a minute and try again.',
    policyUnavailable: 'The sign-up requirements could not be loaded.',
    retry: 'Try again',
  },
} as const;
