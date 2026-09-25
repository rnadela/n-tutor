/**
 * Student Mode's copy, and the only place it exists.
 *
 * Second person throughout — this surface talks *to* the child, where Parent
 * View talks *about* them. No exclamation marks, and no figure of any kind: the
 * spacing and the tap-target floor come from tokens, not from a sentence.
 */
export const studentCopy = {
  title: 'Your practice',
  /**
   * The front door's own heading, while it asks what this device is set up for.
   * Deliberately not `title`: the front door is not Student Mode, and a shared
   * heading would let a test believe it had arrived when it had not.
   */
  frontDoorTitle: 'This device',
  /** The child is greeted by the name their parent gave the profile. */
  greeting: (name: string) => `Hello, ${name}.`,
  gradeLevel: (name: string) => `You are in ${name}.`,
  /** Nothing is here yet, and saying so is better than an empty screen. */
  empty: 'There is nothing to practise yet. Your practice tests will show up here.',
  /** The released list's own heading. Second person, like everything here. */
  practiceTestsTitle: 'Your practice tests',
  /**
   * One row of the list.
   *
   * The question count arrives from the API rather than being written here, and
   * it is the only figure on the row: there is nothing to open yet, because
   * taking a practice test is Epic 5's. Seeing that it is there is the whole of
   * what this story ships to a child.
   */
  practiceTest: (questionCount: number) =>
    questionCount === 1
      ? 'A practice test with 1 question'
      : `A practice test with ${questionCount} questions`,
  loading: 'Loading…',
  /** The one control out of Student Mode. It leads to the PIN, never past it. */
  parent: 'Parent',
  notBound: 'This device is not set up for a student yet.',
  failed: 'Your practice could not be loaded.',
  retry: 'Try again',
} as const;
