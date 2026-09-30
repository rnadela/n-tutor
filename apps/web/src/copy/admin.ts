/**
 * The single copy module for the Admin console. No user-facing string is a
 * hardcoded literal in a component (AD-32). Admin copy is third person, plain
 * and factual.
 */
export const adminCopy = {
  appName: 'n-test-reviewer Admin',
  signIn: {
    title: 'Admin sign-in',
    emailLabel: 'Email',
    passwordLabel: 'Password',
    submit: 'Sign in',
    submitting: 'Signing in…',
    failed: 'Sign-in failed. Check the email and password and try again.',
  },
  nav: {
    taxonomy: 'Subjects & Grade Levels',
    accounts: 'Parent Accounts',
    /**
     * The way in to the queue of Explanations to judge.
     *
     * A destination with no nav entry is a destination an operator cannot reach — and a
     * confirmed report nobody can open is a report that went nowhere.
     */
    flaggedExplanations: 'Flagged Explanations',
    /**
     * The way in to the Topic curation queue.
     *
     * A destination with no nav entry is one an operator cannot reach — and a canonical
     * set nobody curates is one that accumulates near-duplicates until every parent's
     * Mastery picture fragments.
     */
    topics: 'Topics',
    signOut: 'Sign out',
    menuToggle: 'Open Admin menu',
    collapseSidebar: 'Collapse menu',
    expandSidebar: 'Expand menu',
  },

  /**
   * Topic curation, and the only place its copy is written.
   *
   * **Factual and third person**, like every other Admin string. Not one sentence here
   * names a child, an account, a cost, a tier or a model (AD-20, AD-26): a canonical
   * Topic is a concept a Subject is taught, and curating it is a decision about the
   * concept rather than about anyone's work.
   *
   * **The merge states its blast radius before it fires.** A merge re-points every tag
   * onto the survivor, deletes the folded-away Topic and recomputes Mastery for every
   * affected child — none of which can be undone from this screen — so the confirmation
   * names both Topics and how many Questions are carried. Every figure in it is a
   * parameter; this file writes none.
   */
  topics: {
    title: 'Topic curation',
    intro:
      'Every topic that was created automatically and has not been reviewed. Confirm one as it stands, rename it, or merge it into another topic of the same subject. A merge moves every tagged question onto the surviving topic and recomputes mastery for the children affected.',
    /** An empty queue. The normal case, stated rather than left blank. */
    empty: 'No topics are waiting to be reviewed.',
    loading: 'Loading topics…',
    loadFailed: 'The topics could not be listed.',
    retry: 'Try again',
    nameColumn: 'Topic',
    subjectColumn: 'Subject',
    taggedColumn: 'Tagged questions',
    createdColumn: 'Created',
    actionsColumn: 'Actions',
    confirm: 'Confirm',
    rename: 'Rename',
    renameLabel: 'New name',
    saveName: 'Save name',
    cancelRename: 'Cancel',
    merge: 'Merge',
    startMerge: 'Merge into…',
    cancelMerge: 'Cancel',
    mergeTargetLabel: 'Merge into',
    /** The placeholder option, so the select never starts on a real target. */
    mergeTargetUnchosen: 'Choose a topic',
    loadingTargets: 'Loading topics for this subject…',
    /** A Subject whose canonical set holds nothing else to merge into. */
    noTargets: 'This subject has no other topic to merge into.',
    /** Which rows in the target list a human has already judged, and which not. */
    targetProvisional: 'not reviewed',
    targetConfirmed: 'reviewed',
    /**
     * What a merge is about to do, in full, before it is fired.
     *
     * It names both topics and the count because the count is the difference between
     * folding away a stray spelling and folding away a term's worth of history — and
     * nothing on this screen undoes it.
     *
     * **"Up to", and not a flat figure.** The count is how many questions carry the
     * merged topic; a question that already carries the survivor has its duplicate tag
     * removed rather than moved, so the number that actually moves can be smaller. An
     * exact promise here would contradict the announcement the same action then makes,
     * over the same merge, with the real figure — and an operator who saw the two
     * disagree would have no way to tell which had lied.
     *
     * Singular and plural, and its own sentence for none: "1 tagged questions" is a
     * sentence nobody wrote, and a topic nothing carries moves nothing at all.
     */
    mergeConfirmation: (merged: string, target: string, taggedQuestionCount: number) => {
      const moving =
        taggedQuestionCount === 0
          ? `${merged} carries no tagged questions`
          : taggedQuestionCount === 1
            ? `Up to 1 tagged question moves onto ${target}`
            : `Up to ${taggedQuestionCount} tagged questions move onto ${target}`;
      return `Merge ${merged} into ${target}. ${moving}, ${merged} is removed, and mastery is recomputed for every child affected. This cannot be undone.`;
    },
    /** The created instant, or the same row with no date when the stored one will not parse. */
    createdUndated: '—',
  },

  /**
   * The Flagged Explanations queue, and the only place its copy is written.
   *
   * **Factual and third person**, like every other Admin string, and about the *prose*
   * rather than about a family: not one sentence here names a child, an email address, a
   * cost, a tier or a model name (AD-20, AD-26). An operator judging a paragraph needs the
   * paragraph and the identifiers to name it by.
   *
   * **Nothing here is an action.** This story opens the queue; it does not suppress, edit
   * or regenerate anything, so there is no control copy to write and none is written.
   *
   * Every figure is a parameter.
   */
  flaggedExplanations: {
    title: 'Flagged Explanations',
    intro:
      'Every explanation a parent has reported, and every one a student reported that a parent agreed with. A student report a parent has not decided about, or decided was fine, is not listed. Each explanation appears once, however many times it was raised.',
    /** An empty queue. The normal case, stated rather than left blank. */
    empty: 'No explanations are flagged.',
    loading: 'Loading flagged explanations…',
    loadFailed: 'The flagged explanations could not be listed.',
    retry: 'Try again',
    /**
     * One entry's own heading, which is what makes the outline navigable.
     *
     * A screen-reader user moving by heading needs each card to announce *which*
     * explanation it is; without this every card would present the same three in-card
     * labels and the queue would read as one label repeated N times. The Question is what
     * an operator judges, so its id is what names the entry — no child's name and no
     * account email (AD-20, AD-26).
     */
    entryHeading: (questionId: string) => `Question ${questionId}`,
    /** The prose being judged. */
    explanationHeading: 'The explanation',
    /** Which routes raised it, from the list the API answered with. */
    raisedByHeading: 'Raised by',
    raisedBy: {
      Parent: 'Parent',
      Student: 'Student',
    },
    /** The earliest instant any qualifying report was raised. */
    raisedAt: (instant: string) => `First raised ${instant}`,
    /**
     * The same fact with no date, for a stored instant that will not parse.
     *
     * It was still raised, which is why it is in this queue at all; the words "Invalid
     * Date" would read as a fault in the report rather than in a string.
     */
    raisedAtUndated: 'First raised',
    /** The identifiers an operator names an explanation by. No name and no email. */
    identifiersHeading: 'Identifiers',
    explanationIdLabel: 'Explanation',
    attemptIdLabel: 'Attempt',
    questionIdLabel: 'Question',
    accountIdLabel: 'Parent account',
    studentIdLabel: 'Student profile',
  },
  /**
   * Not one figure from `tiers.md` appears below. Every limit on the screen is
   * read off the API response, which originates in `allowance`'s tiers table.
   */
  accounts: {
    title: 'Parent Accounts',
    intro:
      'An operator sees every Parent Account and assigns its Account Tier. A tier change takes effect immediately against the current period. Consumption is shown in each account’s own period and timezone.',
    emailColumn: 'Email',
    nameColumn: 'Name',
    tierColumn: 'Account Tier',
    timezoneColumn: 'Timezone',
    createdColumn: 'Created',
    actionsColumn: 'Consumption',
    tiers: {
      Free: 'Free',
      Plus: 'Plus',
      Family: 'Family',
      Internal: 'Internal',
    },
    unlimited: 'Unlimited',
    noName: '—',
    consumptionHeading: 'Consumption',
    allowanceColumn: 'Allowance',
    usageColumn: 'Used of limit',
    uploadAllowance: 'Upload Allowance',
    generationAllowance: 'Generation Allowance',
    explanationAllowance: 'Explanation Allowance',
    studentProfileLimitLabel: 'Student Profile limit',
    periodStartLabel: 'Period start',
    resetLabel: 'Resets',
    timezoneLabel: 'Computed in',
    showConsumption: 'Show consumption',
    hideConsumption: 'Hide consumption',
    empty: 'No Parent Accounts yet.',
    loading: 'Loading Parent Accounts…',
    loadingConsumption: 'Loading consumption…',
    retry: 'Try again',
    usageOfLimit: (used: number, limit: string) => `${used} of ${limit}`,
  },
  taxonomy: {
    title: 'Subjects & Grade Levels',
    intro:
      'An operator creates, renames, enables, and disables Subjects and Grade Levels, and controls which Subjects are offered for which Grade Levels. Changes apply to new selections only.',
    subjectsHeading: 'Subjects',
    gradeLevelsHeading: 'Grade Levels',
    availabilityHeading: 'Availability',
    availabilityIntro:
      'A Subject is offered for a Grade Level when the Subject, the Grade Level, and the pairing are all enabled.',
    newSubjectLabel: 'New Subject name',
    newGradeLevelLabel: 'New Grade Level name',
    addSubject: 'Add Subject',
    addGradeLevel: 'Add Grade Level',
    nameColumn: 'Name',
    statusColumn: 'Status',
    actionsColumn: 'Actions',
    enabled: 'Enabled',
    disabled: 'Disabled',
    rename: 'Rename',
    disable: 'Disable',
    enable: 'Enable',
    saveName: 'Save name',
    cancelRename: 'Cancel',
    renameLabel: 'New name',
    emptySubjects: 'No Subjects yet.',
    emptyGradeLevels: 'No Grade Levels yet.',
    availabilityNeedsBoth: 'Availability needs at least one Subject and one Grade Level.',
    loading: 'Loading the taxonomy…',
    retry: 'Try again',
  },
  announce: {
    subjectCreated: (name: string) => `Subject ${name} created.`,
    subjectRenamed: (from: string, to: string) => `Subject ${from} renamed to ${to}.`,
    subjectEnabled: (name: string) => `Subject ${name} enabled.`,
    subjectDisabled: (name: string) => `Subject ${name} disabled.`,
    gradeLevelCreated: (name: string) => `Grade Level ${name} created.`,
    gradeLevelRenamed: (from: string, to: string) => `Grade Level ${from} renamed to ${to}.`,
    gradeLevelEnabled: (name: string) => `Grade Level ${name} enabled.`,
    gradeLevelDisabled: (name: string) => `Grade Level ${name} disabled.`,
    availabilityEnabled: (subject: string, gradeLevel: string) =>
      `${subject} is now offered for ${gradeLevel}.`,
    availabilityDisabled: (subject: string, gradeLevel: string) =>
      `${subject} is no longer offered for ${gradeLevel}.`,
    tierChanged: (account: string, from: string, to: string) =>
      `${account} moved from ${from} to ${to}.`,
    consumptionShown: (account: string) => `Consumption shown for ${account}.`,
    consumptionHidden: (account: string) => `Consumption hidden for ${account}.`,
    topicConfirmed: (name: string) => `Topic ${name} confirmed.`,
    topicRenamed: (from: string, to: string) => `Topic ${from} renamed to ${to}.`,
    /**
     * What the merge came to, with the **real** figure the server reported.
     *
     * Singular and plural, and its own clause for none: a merge whose every tagged
     * question already carried the survivor moves nothing, and "0 tagged questions
     * moved" states that as though something had been counted wrong.
     */
    topicMerged: (merged: string, target: string, repointed: number) => {
      const moved =
        repointed === 0
          ? 'No tagged questions moved'
          : repointed === 1
            ? '1 tagged question moved'
            : `${repointed} tagged questions moved`;
      return `Topic ${merged} merged into ${target}. ${moved}.`;
    },
  },
  availabilityCheckboxLabel: (subject: string, gradeLevel: string) =>
    `Offer ${subject} for ${gradeLevel}`,
  tierSelectLabel: (account: string) => `Account Tier for ${account}`,
  consumptionToggleLabel: (account: string) => `Consumption for ${account}`,
  errors: {
    generic: 'The change could not be saved. Try again.',
    duplicate: 'That name is already in use.',
    notFound: 'That item no longer exists. Reload the screen.',
    sessionExpired: 'The session has ended. Sign in again.',
  },
} as const;
