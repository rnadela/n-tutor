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
     * Both figures arrive from the API. The web app holds no limit, no tier and
     * no per-request ceiling of its own.
     */
    countUnavailable: (remaining: number) =>
      remaining === 0
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
  },
  errors: {
    generic: 'Something went wrong. Try again.',
    network: 'The request could not be completed. Check the connection and try again.',
    tooManyAttempts: 'Too many attempts. Wait a minute and try again.',
    policyUnavailable: 'The sign-up requirements could not be loaded.',
    retry: 'Try again',
  },
} as const;
