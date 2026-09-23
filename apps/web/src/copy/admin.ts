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
    signOut: 'Sign out',
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
