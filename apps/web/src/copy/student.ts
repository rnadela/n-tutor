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
   * One row's question-count line, and the row's accessible name.
   *
   * The count arrives from the API rather than being written here, and it is
   * the only figure on the row: no allowance, no tier, no minute figure.
   */
  practiceTest: (questionCount: number) =>
    questionCount === 1
      ? 'A practice test with 1 question'
      : `A practice test with ${questionCount} questions`,
  /**
   * The word for the condition a row is in, or `null` for anything else.
   *
   * **Exhaustive over exactly the three tags the API states, and nothing
   * else.** An unrecognized or missing value renders no label at all — never
   * `Completed`, because telling a child that a test they have never touched
   * is finished is the worst answer available, and a `switch` that fell
   * through to the last case would say exactly that.
   *
   * These are words, not colours. The three conditions have to be tellable
   * apart with every bit of styling stripped away, so the distinction lives in
   * the sentence and not in a swatch.
   */
  practiceTestState: (state: string | null | undefined): string | null => {
    switch (state) {
      case 'NotStarted':
        return 'Not started';
      case 'InProgress':
        return 'In progress';
      case 'Completed':
        return 'Completed';
      default:
        return null;
    }
  },
  loading: 'Loading…',
  /**
   * Take Test: the screen a child actually works on.
   *
   * Every sentence here is second person and none of them says anything about
   * being right. There is no score word, no tally and no grade vocabulary in this
   * object at all — correctness is something only submission can claim, and a
   * screen that hinted at it before then would be marking the child's work while
   * they were still doing it.
   *
   * The progress vocabulary is exactly two words, `Answered` and `Not answered`.
   * Never `Unanswered`: that reads as a grade state, and nothing here grades.
   */
  takeTest: {
    /** Where the child is in the test. Both figures are handed in. */
    counter: (n: number, total: number) => `Question ${n} of ${total}`,
    /**
     * What kind of question this is, said plainly. Not a label the child has to
     * act on — it tells them what the control below is going to be.
     */
    format: {
      MultipleChoice: 'Multiple choice',
      FillInTheBlank: 'Fill in the blank',
      ShortAnswer: 'Short answer',
    },
    /** The label every answer control carries. A control with no label is not one. */
    answerLabel: 'Your answer',
    /**
     * Said beside the fill-in-the-blank field, because the stacked form appearing
     * next to what was typed is otherwise unexplained. It promises nothing about
     * the answer being right — it explains a rendering, not a verdict.
     */
    fractionHelp: 'You can type a fraction like 3/4, or write your answer in words.',
    back: 'Back',
    next: 'Next',
    /** The question map's own heading. */
    mapHeading: 'Your questions',
    /**
     * The map's one-line summary. Two counts and no third: there is no score to
     * state, and "how many are right" is not a question this screen can answer.
     */
    mapSummary: (answered: number, notAnswered: number) =>
      `${answered} answered · ${notAnswered} not answered`,
    /**
     * One map cell's whole spoken sentence.
     *
     * Every cell says which question it is and where that question stands, so a
     * cell read on its own is never just a number. The current cell says so in
     * words as well as through `aria-current`.
     */
    cellState: (ordinal: number, answered: boolean, current: boolean) =>
      `Question ${ordinal}, ${answered ? 'answered' : 'not answered'}${
        current ? ', you are here' : ''
      }`,
    /** The on-screen legend, so the glyphs are never the only account of a state. */
    legendAnswered: 'Answered',
    legendNotAnswered: 'Not answered',
    openMap: 'Your questions',
    closeMap: 'Close',
    loading: 'Loading…',
    failed: 'That practice test could not be opened.',
    // There is deliberately no link label here. Student Home's row *is* the
    // link, and the sentence it already shows — "A practice test with 8
    // questions" — is its accessible name. A second string over the top of it
    // would read the same on every row and hide the count that tells them apart.
  },
  /** The one control out of Student Mode. It leads to the PIN, never past it. */
  parent: 'Parent',
  notBound: 'This device is not set up for a student yet.',
  failed: 'Your practice could not be loaded.',
  retry: 'Try again',
} as const;
