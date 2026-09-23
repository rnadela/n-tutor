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
    signOut: 'Sign out',
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
  },
  availabilityCheckboxLabel: (subject: string, gradeLevel: string) =>
    `Offer ${subject} for ${gradeLevel}`,
  errors: {
    generic: 'The change could not be saved. Try again.',
    duplicate: 'That name is already in use.',
    notFound: 'That item no longer exists. Reload the screen.',
    sessionExpired: 'The session has ended. Sign in again.',
  },
} as const;
