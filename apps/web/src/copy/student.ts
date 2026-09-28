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

    // --- The clock -------------------------------------------------------
    //
    // Not one figure is written into a sentence here. The countdown's figures
    // come from `attempt-clock`, which computes them from the instants the server
    // stated, and the thresholds are that module's constants. A duration written
    // into copy would be a second definition of the timer, in the one place
    // nothing could reconcile it with the first.

    /**
     * The countdown's accessible name: what this figure is, said with its units.
     *
     * The spoken form is handed in, because it is the same figure the display
     * shows and nothing here may restate it. `role="timer"` with no unit-bearing
     * name reads as a bare number, which is a number about nothing.
     */
    timerLabel: (spoken: string) => `Time left: ${spoken}`,
    /**
     * The countdown as it appears on screen: the `m:ss` figure alone.
     *
     * No unit words beside it — they are the label's, and repeating them would
     * make every tick read twice.
     */
    timerRemaining: (display: string) => display,
    /**
     * Said at each of the three thresholds, and said **identically** at all
     * three.
     *
     * One sentence, with the remaining time handed in. Nothing escalates: a
     * countdown that got louder as it ran out would be pressure rather than
     * information, and a child working under it does not need to be hurried.
     * There is no exclamation mark for the same reason.
     */
    timerWarning: (spoken: string) => `You have ${spoken} left.`,

    // --- Handing in ------------------------------------------------------

    /** The deadline has passed. It states the fact and nothing about the work. */
    timeUp: 'Your time is up.',
    /** The one control that ends the Attempt. */
    handIn: 'Hand in',
    /** While the request is out. Not a promise that it worked. */
    handingIn: 'Handing in…',
    /** It worked. No count, no tally, and nothing about being right. */
    handedIn: 'Your work is handed in.',
    /**
     * The heading of the state the screen moves to, which is where focus lands.
     * A state change with no heading is a state change nothing can be pointed at.
     */
    handedInHeading: 'Handed in',
    /**
     * Handing in offline.
     *
     * It says what is needed and what is safe, in that order, because "it did not
     * work" on its own reads as work lost. The Attempt stays open and the control
     * stays live, so there is nothing else to ask of the child.
     */
    offlineSubmit:
      'Handing in needs a connection. Your answers are kept, so you can try again once you are back online.',
    /**
     * The deadline passed with no connection.
     *
     * It states that the time is up and that the handing in is already arranged,
     * so a child is not left wondering whether to keep pressing something.
     */
    offlineExpired: 'Your time is up. Your work will be handed in as soon as you are back online.',
    /** Announced before the screen changes on its own, so the move is never silent. */
    autoSubmitAnnouncement: 'Your time is up. Your work is being handed in.',
    /** It was already in. Said rather than re-sent. */
    alreadyHandedIn: 'This practice test is already handed in.',

    // --- Being asked about what is still blank ---------------------------
    //
    // A question put to the child before their own press goes through, and only
    // ever before *their* press: a deadline that has already passed has nobody to
    // ask. It states a count in the progress vocabulary and says nothing about
    // being right — it is a question about what is finished, not a verdict on any
    // of it. The word `Unanswered` appears nowhere here: it is a grade state, and
    // this is asked while nothing has been graded.

    /** The confirmation's heading, which is where its accessible name comes from. */
    confirmHandInTitle: 'Hand in now?',
    /**
     * The confirmation's whole sentence, with the count handed in.
     *
     * Singular and plural, because "1 questions" is a sentence nobody wrote on
     * purpose. It names what is left and says the work can still be finished, in
     * that order, so the way back reads as an offer rather than as a warning.
     */
    confirmHandIn: (notAnswered: number) =>
      notAnswered === 1
        ? `You have ${notAnswered} question that is not answered. You can go back and finish it, or hand in now.`
        : `You have ${notAnswered} questions that are not answered. You can go back and finish them, or hand in now.`,
    /** The way back to the questions. It leads to the map, not to a hand-in. */
    confirmHandInBack: 'Go back to the questions',
    /** The way through. Nothing else on the screen hands in on the child's behalf. */
    confirmHandInAnyway: 'Hand in anyway',
    /** The request failed for some other reason. The Attempt is still open. */
    submitFailed: 'Your work could not be handed in. Your answers are kept, so you can try again.',
    /** The Attempt could not be opened at all, so there is nothing to work under. */
    attemptFailed: 'That practice test could not be started.',
    // There is deliberately no link label here. Student Home's row *is* the
    // link, and the sentence it already shows — "A practice test with 8
    // questions" — is its accessible name. A second string over the top of it
    // would read the same on every row and hide the count that tells them apart.
  },
  /**
   * The answer key: what the work came to, once it is in.
   *
   * Second person, no exclamation mark and no flourish. There is no count-up, no
   * reveal and no celebration anywhere on this surface — a result is information,
   * and a child who got most of a paper wrong should not have it announced at them.
   *
   * **Not one figure is written into a sentence here.** Every number is handed in,
   * and the score's own two figures are the server's single answer to FR-37: this
   * file states no denominator and computes none.
   *
   * The four grade labels are deliberately **not** here. They are cross-surface
   * literals and they live in `commonCopy.gradeState`, so a parent surface and this
   * one cannot come to say different words for the same state.
   */
  results: {
    /** The section's own heading, and where the score sits under. */
    heading: 'Your results',
    /**
     * Which test these results are of: the Subject it is and how long it was.
     *
     * The line exists because these results are reached from history as well as from
     * a hand-in — a child opening a finished test weeks later has nothing else on the
     * screen that says which one it is. The Subject is dropped when the server sent
     * none, rather than rendered as an empty half of a separator: a test whose
     * Subject does not resolve keeps its place and loses its label, exactly as it
     * does on Student Home.
     *
     * Both figures are handed in. Nothing here is a grade.
     */
    testMeta: (subjectName: string | null, questionCount: number) => {
      const questions = questionCount === 1 ? '1 question' : `${questionCount} questions`;
      const subject = subjectName?.trim();
      return subject ? `${subject} · ${questions}` : questions;
    },
    /**
     * The score, when every presented Question was judged.
     *
     * Both figures handed in, and no percentage: a fraction is the figure the
     * server stated, and a percentage would be a second one computed here.
     */
    score: (correct: number, denominator: number) =>
      `You got ${correct} out of ${denominator} right.`,
    /**
     * The score while something is excluded, which says **what it is over**.
     *
     * `graded questions` rather than `questions`, because the denominator is not the
     * paper: it is the part of the paper that has been judged, and a fraction that
     * did not say so would quietly restate how long the test was.
     */
    scorePartial: (correct: number, denominator: number) =>
      `You got ${correct} out of ${denominator} graded questions right.`,
    /**
     * The one line for an Attempt nothing could grade at all.
     *
     * A zero denominator is a legitimate answer, and this is said instead of the
     * fraction rather than beside it: `0 out of 0` is not a sentence, and dividing
     * by it is not a thing this screen does.
     */
    nothingToScore: 'There is nothing to score yet. Nothing on this test has been graded.',
    /** How many were wrong, for the line under the score. Singular and plural. */
    metaIncorrect: (n: number) => (n === 1 ? '1 not correct' : `${n} not correct`),
    /** How many were left blank. The grade word, because the work is in now. */
    metaUnanswered: (n: number) => (n === 1 ? '1 unanswered' : `${n} unanswered`),
    /** The answer key's own heading. It says what the order is, because the order matters. */
    questionsHeading: 'Every question, in order',
    /** One row's own heading. The stored ordinal, which is the number the child was shown. */
    question: (ordinal: number) => `Question ${ordinal}`,
    /** What the child put down. A label, so the two answers are never confused. */
    yourAnswer: 'You answered',
    /** What the answer was. */
    correctAnswer: 'Correct answer',
    /**
     * Said in place of the child's answer on a Question they left blank.
     *
     * A sentence rather than an empty space, because an empty space beside a label
     * reads as something that failed to load.
     */
    noAnswer: 'You didn’t answer this one.',
    /**
     * Said in place of an answer the stored key could not give back.
     *
     * It states what is missing and nothing about why. The row still shows its state
     * — the work was graded, and only the words for the answer are gone.
     */
    answerUnavailable: 'The answer for this question is not available.',
    /**
     * The gap, stated in the header: how many are excluded, that they are **not** in
     * the figure above, and that the total may go up next time.
     *
     * The last clause is the whole point of the sentence. A score that grows between
     * two visits looks like the work changed, and it did not — the grading finished.
     * Said in that order, so the reassurance lands after the fact.
     */
    ungradedGap: (n: number) =>
      n === 1
        ? '1 question has not been graded yet. It is not counted in the figure above, so the total may go up the next time you open this.'
        : `${n} questions have not been graded yet. They are not counted in the figure above, so the total may go up the next time you open this.`,
    /**
     * The gap when there is **no figure above it at all**.
     *
     * A zero denominator with Questions excluded is the one case where
     * `nothingToScore` is stated instead of a fraction, and `ungradedGap` would then
     * point at "the figure above" — which was never given. So this variant names the
     * count and promises the same thing about next time, without referring to a
     * number nobody was shown.
     */
    ungradedGapOnly: (n: number) =>
      n === 1
        ? '1 question has not been graded yet. You can open this again later to see it.'
        : `${n} questions have not been graded yet. You can open this again later to see them.`,
    /** The same fact on the row it is about, so a row read alone still says it. */
    rowUngraded: 'This one has not been graded yet.',
    /**
     * Said on a row this very read judged, in words rather than by a highlight.
     *
     * "Newly graded" has to be a thing the row *says*: a colour or an animation on
     * it would be unreadable to anyone the row is read aloud to, and would be the
     * only account of the one fact that changed since last time.
     */
    rowNewlyGraded: 'Just graded.',
    /**
     * The announcement for a read that resolved something, and it is **the same
     * sentence the screen displays** — the count handed in, once per read.
     *
     * One string for both, so the words announced and the words shown cannot come
     * apart. Nothing else on this surface announces: results appearing is not a
     * state change a child needs narrated.
     */
    newlyGradedAnnouncement: (n: number) =>
      n === 1
        ? '1 more question has just been graded. Your results have been updated.'
        : `${n} more questions have just been graded. Your results have been updated.`,
    loading: 'Loading…',
    /** The read failed. The work is still in; only this could not be read. */
    failed: 'Your results could not be loaded.',
    /**
     * The control that opens another run at this practice test.
     *
     * "Practise" rather than "retake": the child's word for what they are about to
     * do is the doing of it, not a record of how many times they have. No flourish,
     * no count, no "personal best" and no promise about doing better.
     */
    retake: 'Practise this again',
    /** The same control while the request is out. Stated, so the press is never silent. */
    retakeStarting: 'Starting…',
    /**
     * The retake could not be opened.
     *
     * One sentence, no error code, and it says what did *not* happen rather than
     * what went wrong: the results are still on screen and still true, and the
     * control is still there to press again.
     */
    retakeFailed: 'Your retake could not be started.',
    /**
     * Everything the explain panel says, and the only place any of it is written.
     *
     * Four rules hold this group together, and they are the same four the panel's
     * spec asserts over its own source.
     *
     * **Nothing here counts.** No "3 of 10 left", no "1 explanation used", no
     * badge and no running total: an allowance is a billing fact and a child is
     * never shown one (AD-26). The one sentence that mentions the limit at all is
     * `atCap`, and it says the plan ran out rather than how far.
     *
     * **Blame lands on the plan, never on the child.** A child who has read ten
     * explanations has done nothing wrong, and a sentence that implied otherwise
     * would teach them not to ask. There is no apology either: an apology makes a
     * system's bad minute into something the reader has to absorb.
     *
     * **No exclamation marks and no upsell.** Nothing here names a tier, a price
     * or an upgrade, and nothing invites one.
     *
     * **Every figure is a parameter.** No instant, count or server sentence is
     * restated here; `atCap` takes the API's own refusal and never rewrites it.
     */
    explain: {
      /**
       * The control that asks for an explanation, and the same control that hides
       * one again.
       *
       * One label for both directions, because `aria-expanded` is what says which
       * way the press goes and a label that changed under the finger would be a
       * second, contradictory account of it. "Why?" is the child's own word for
       * what they want — not "Explanation", which is the product's word for it.
       */
      control: 'Why is that the answer?',
      /** The panel's own heading, above the prose. */
      heading: 'Why that is the answer',
      /**
       * Said while nothing has been asked for yet and the panel is open.
       *
       * It exists because an open panel with nothing in it reads as something that
       * failed to load. It promises nothing and starts nothing: the press is the
       * only thing that asks.
       */
      idle: 'Press the button to see why.',
      /** The request is out. Stated, so the press is never silent. */
      loading: 'Working it out…',
      /**
       * It could not be written. One sentence for every failure class.
       *
       * It says what did not happen rather than what went wrong — there is no
       * error code, no mention of a provider and nothing about the Question — and
       * the rest of the results screen is untouched behind it. The control is
       * still there to press, and nothing presses it on its own.
       */
      failed: 'This explanation could not be written just now.',
      /**
       * The press happened with no connection, so nothing was sent.
       *
       * Deliberately **distinct** from both `failed` and `atCap`: "there is no
       * connection" is a thing a child can act on, and collapsing it into "it did
       * not work" would send them pressing again at a wall.
       */
      offline: 'You are not connected right now, so this could not be asked for.',
      /**
       * Nothing is left of the plan's explanations this period.
       *
       * The sentence naming the limit is the **API's own**, handed in whole: it is
       * written once, in the API's policy file, and a second spelling here would be
       * two answers to one refusal. This wraps it in the one thing the server has
       * no business knowing — that the reader is a child and the answer is not
       * about them.
       *
       * `null` is the fallback for a refusal that arrived without its sentence, and
       * it says the same thing in this module's own words rather than leaving a
       * panel that refuses and will not say why.
       */
      atCap: (limitSentence: string | null) =>
        limitSentence === null
          ? 'Your plan has no more explanations this period. They come back at the start of the next one. Everything you have already opened is still here.'
          : `${limitSentence} That is about the plan, not about you — everything you have already opened is still here.`,
      /**
       * Said to the live region when an Explanation appears, and it is **the same
       * sentence the screen displays** beside the prose.
       *
       * The ordinal is handed in, because two panels open on one screen are two
       * different facts and an announcement that did not say which Question it was
       * about would be unusable to anyone reading the page by ear.
       */
      announcement: (ordinal: number) => `The explanation for question ${ordinal} is ready.`,

      // --- Telling a grown-up it is wrong --------------------------------
      //
      // The same four rules hold this half of the group as hold the half above, and
      // two more besides.
      //
      // **Nothing here names what happens next beyond a grown-up reading it.** No
      // operator, no queue, no review team, no "we", and nothing about what a parent
      // might decide: a child promised an outcome nobody has decided on would be
      // waiting for something that may never come. What is promised is exactly what is
      // true -- a grown-up will read it.
      //
      // **Nothing here blames the explanation, the child, or the asking.** Reporting
      // one is a good thing to do, said plainly and without praise: "well done" for
      // pressing a button would teach a child to press it.

      /**
       * The control that says the explanation is wrong.
       *
       * The child's own framing -- something here is not right -- rather than the
       * product's word for it, exactly as `control` is "Why is that the answer?" and
       * not "Explanation". It says nothing about who reads it, because the note
       * beneath it does, once.
       */
      flagControl: 'Something here looks wrong',
      /**
       * What reporting does, said **before** it is pressed and kept beside the
       * reported state afterwards.
       *
       * Two facts and no third: a grown-up will read it, and nothing on this screen
       * changes. The second half exists because a child who pressed a button and
       * watched a paragraph stay put would otherwise think the press did not work --
       * and the paragraph staying put is deliberate, because it may well be right.
       */
      flagNote:
        'A grown-up will read this explanation. Nothing here changes, so you can keep reading it.',
      /** Once reported. The state, named rather than the act that produced it. */
      flagged: (instant: string) => `You told a grown-up about this on ${instant}.`,
      /**
       * The same state with no date, for a stored instant that will not parse.
       *
       * The report was still made, which is the fact the child needs; only the date is
       * unstateable, and the words "Invalid Date" would read as a fault in the report.
       */
      flaggedUndated: 'You told a grown-up about this.',
      /**
       * It could not be reported. One sentence for every failure class, and it leaves
       * the asking available: the control is still there to press.
       */
      flagFailed: 'That could not be sent just now.',
      /**
       * The press happened with no connection, so nothing was sent.
       *
       * Distinct from `flagFailed` for the reason `offline` is distinct from `failed`:
       * "there is no connection" is a thing a child can act on.
       */
      flagOffline: 'You are not connected right now, so this could not be sent.',
      /**
       * Said to the live region when the report is recorded, and it is **the same
       * sentence the screen displays** beside the explanation.
       *
       * The ordinal is handed in, because two panels open on one screen are two
       * different facts and an announcement that did not say which question it was
       * about would be unusable to anyone reading the page by ear.
       */
      flagAnnouncement: (ordinal: number) =>
        `A grown-up will read the explanation for question ${ordinal}. Nothing here changes.`,
    },
  },
  /**
   * What a row on Student Home says about a practice test the child has finished.
   *
   * **Every figure is handed in.** This module states no denominator, computes no
   * fraction and never turns one into a percentage: the score is the server's one
   * answer to FR-37, exactly as on the results screen.
   *
   * The count is over **finished** runs only. A run still going is not a figure and
   * is not counted, so nothing here has a word for one.
   *
   * The word for Mastery on a child's screen is `progress` — plain, second person,
   * and never the parent's term. Nothing here says "mastery", "average", "best" or
   * anything comparative: it names which run counts and stops.
   */
  runs: {
    /**
     * One run's figure, as it appears on a row.
     *
     * Bare rather than a sentence, because it is one part of a line joined by `·`
     * and three sentences on one row would read as a paragraph.
     */
    figure: (correct: number, denominator: number) => `${correct} out of ${denominator}`,
    /**
     * Said in place of a figure when there is nothing to divide.
     *
     * `AttemptScore.denominator` may legitimately be 0 — a run nothing could judge —
     * and `0 out of 0` is not a sentence. Replaced rather than divided, exactly as
     * `results.nothingToScore` already does on the results screen.
     */
    notGradedYet: 'Not graded yet',
    /** The first run's part of the multi-run line. */
    first: (figure: string) => `First ${figure}`,
    /** The latest run's part of the same line. */
    latest: (figure: string) => `Latest ${figure}`,
    /** How many finished runs there are. Singular, because `1 attempts` is not English. */
    count: (n: number) => (n === 1 ? '1 attempt' : `${n} attempts`),
    /** What joins the three parts of the multi-run line. */
    separator: ' · ',
    /**
     * Which run counts, said once and beneath the figures.
     *
     * It names the first run as the one that counts and promises nothing about the
     * others — they are practice, which is what the whole surface is for. `progress`
     * rather than the parent's word for it.
     */
    countsTowardProgress: 'Your first attempt is the one that counts toward your progress.',
  },
  /** The one control out of Student Mode. It leads to the PIN, never past it. */
  parent: 'Parent',
  notBound: 'This device is not set up for a student yet.',
  failed: 'Your practice could not be loaded.',
  retry: 'Try again',
} as const;
