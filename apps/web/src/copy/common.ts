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
} as const;
