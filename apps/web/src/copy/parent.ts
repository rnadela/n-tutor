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
  errors: {
    generic: 'Something went wrong. Try again.',
    network: 'The request could not be completed. Check the connection and try again.',
    tooManyAttempts: 'Too many attempts. Wait a minute and try again.',
    policyUnavailable: 'The sign-up requirements could not be loaded.',
    retry: 'Try again',
  },
} as const;
