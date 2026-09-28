import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type {
  AiFailureKind,
  GenerationJobStatus,
  PracticeTestStatus,
  QuestionFormat,
} from '../generated/prisma/enums.js';
import { AiInputError, AiRejectedError, AiService, AiUpstreamError } from '../ai/ai.service.js';
import { AllowanceService } from '../allowance/allowance.service.js';
import {
  EXTRACTION_READER,
  type ExtractionForGeneration,
  type ExtractionReader,
} from '../extraction/extraction-reader.js';
import {
  RICH_TEXT_EMPTY,
  isRichText,
  plainTextOf,
  richTextFromPlainText,
  type RichText,
} from '../extraction/rich-text.js';
import { PrismaService, type TransactionClient } from '../prisma/prisma.service.js';
import { renumbered } from '../sourcetest/source-test-policy.js';
import { SOURCE_TEST_READER, type SourceTestReader } from '../sourcetest/source-test-reader.js';
import {
  ATTEMPT_ALREADY_SUBMITTED,
  ATTEMPT_NOT_RETAKEABLE,
  EXTRACTION_NOT_READY,
  GENERATION_CLOCK_ANOMALY,
  GENERATION_FAILED,
  GENERATION_INPUT_UNUSABLE,
  GENERATION_NOT_REQUESTED,
  GENERATION_REQUEST_REJECTED,
  GENERATION_SOURCE_GONE,
  GENERATION_UPSTREAM_REJECTED,
  MAX_JOB_ATTEMPTS,
  MAX_PER_REQUEST,
  NO_GENERATION_ALLOWANCE,
  NO_USABLE_QUESTIONS,
  PRACTICE_TEST_NOT_FOUND,
  WEIGHTED_TOPIC_UNKNOWN,
  claimTimeoutMs,
  clampCount,
  compareStudentListRows,
  formatTargets,
  lastSubmission,
  normalizeTopicLabel,
  remainingFor,
  studentListState,
  suggestedTimerMinutes,
  weightingFor,
  type GenerationWeighting,
  type StudentListState,
} from './practice-test-policy.js';
import {
  ANSWER_FORBIDDEN,
  CHOICES_FORBIDDEN,
  CHOICES_MISMATCHED,
  EditedQuestionInvalid,
  GenerationPayloadInvalid,
  normalizePrompt,
  validateEditedQuestion,
  validateGenerationPayload,
  type EditedQuestion,
  type NormalizedPracticeTest,
} from './practice-test-payload.js';
import { buildGenerationPrompt } from './practice-test-prompt.js';
import {
  PRACTICE_TEST_SCHEMA_NAME,
  PracticeTestPayload,
  fakePracticeTestPayload,
  type FakeFormatTarget,
} from './practice-test-schema.js';

/**
 * The Extraction this job was to generate from is no longer there, or never had
 * anything usable in it. Terminal: a retry reads the same nothing.
 */
export class GenerationTargetMissing extends Error {
  constructor(readonly gone: boolean) {
    super(gone ? GENERATION_SOURCE_GONE : GENERATION_INPUT_UNUSABLE);
    this.name = 'GenerationTargetMissing';
  }
}

/**
 * This pass was superseded: the job row has moved on since it was claimed —
 * reclaimed after this pass's lock went stale, most likely. Thrown to roll the
 * *current draft* back with its charge, and deliberately silent afterwards,
 * because whatever moved the row on is the run whose verdict should stand.
 *
 * Note what it does **not** roll back: drafts that already landed in their own
 * committed transactions stay landed and stay charged. That is the whole point
 * of charging incrementally — a parent who got three Practice Tests has three
 * Practice Tests, whatever happened to the fourth.
 */
export class GenerationFenced extends Error {
  constructor() {
    super('This generation pass was superseded by a newer one.');
    this.name = 'GenerationFenced';
  }
}

/**
 * The instant a draft landed on fell outside the period window computed for
 * that same instant — arithmetically impossible without a clock or timezone
 * anomaly on this machine.
 *
 * Terminal and never retried, and that is the whole reason it is not simply an
 * upstream fault: a retry would be run against the same broken clock, and every
 * attempt would spend another provider call to reach the same impossible
 * arithmetic. Better to stop and be visible than to bill in a loop.
 */
export class GenerationClockAnomaly extends Error {
  constructor() {
    super(GENERATION_CLOCK_ANOMALY);
    this.name = 'GenerationClockAnomaly';
  }
}

/**
 * How long one draft's landing gets. The provider call is already paid for by
 * the time a row is written, so a five-second default that aborts a forty-
 * question draft is a transaction limit deciding to spend the money again.
 */
const LAND_TIMEOUT_MS = 30_000;
const LAND_MAX_WAIT_MS = 10_000;

/** A job as the claim pass hands it to the run. Identifiers and counts only. */
export interface ClaimedGenerationJob {
  id: string;
  parentAccountId: string;
  sourceTestId: string;
  studentProfileId: string;
  requestedCount: number;
  producedCount: number;
  attempts: number;
  /**
   * The Topic this job was asked to concentrate on, in the Extraction's own
   * spelling, or null for an unweighted request. Carried into the run because
   * the run happens later than the request that chose it.
   *
   * A Topic label is content read off a parent's page, so it travels here to be
   * put in a prompt and counted against — never into a log line (AD-20).
   */
  weightedTopic: string | null;
}

/**
 * What a parent is told about their Generation Allowance before they spend it.
 *
 * `limit` is `null` for unlimited and is never a sentinel number; `remaining`
 * is what one request may actually ask for, which on an unlimited tier is the
 * per-request ceiling. Every figure a screen shows arrives from here, so the
 * web app holds none of them.
 */
export interface GenerationAllowanceView {
  used: number;
  limit: number | null;
  remaining: number;
  maxPerRequest: number;
  resetAt: string;
  timezone: string;
}

/**
 * The Topics a request may be weighted on: the Extraction's own labels, raw and
 * de-duplicated, in first-appearance order.
 *
 * A list and nothing else — no counts, no mastery, no ordering by how often a
 * Topic appears. Anything more would be an Analytics figure on a generate
 * screen, and that surface is Epic 7's (FR-11, FR-29).
 */
export interface GenerationTopicsView {
  topics: string[];
}

/** The progress read's whole answer: where the job stands, and how much landed. */
export interface GenerationJobView {
  id: string;
  status: GenerationJobStatus;
  /** Already clamped. What the client asked for is never stored or reported. */
  requestedCount: number;
  /**
   * The Topic the request was weighted on, in the Extraction's own spelling, or
   * null for an unweighted request. It travels on the view so a parent
   * returning to the URL reads the request they actually made.
   */
  weightedTopic: string | null;
  producedCount: number;
  completedAt: string | null;
  failureKind: AiFailureKind | null;
  failureReason: string | null;
  retryable: boolean;
}

/**
 * One row of Pending drafts: enough to recognise a draft and open it, and not
 * one word of what it holds.
 *
 * `studentProfileId` rather than a child's name: `practicetest` does not read
 * an identity table (AD-17), so the screen joins the name from the Student
 * Profile read it already makes.
 */
export interface PracticeTestDraftSummary {
  id: string;
  sourceTestId: string;
  studentProfileId: string;
  /** Its place within the job that produced it, 1-based — "draft 2 of 5". */
  ordinal: number;
  /** How many drafts of the same job are still drafts. The "of 5". */
  siblingCount: number;
  questionCount: number;
  createdAt: string;
}

/**
 * One row of the student-scoped list of released Practice Tests.
 *
 * An identifier, the Subject it is, how many questions it holds and which of
 * the three conditions it is in — and deliberately nothing else. A
 * student-scoped read that carried prompts, options and *correct answers*
 * would hand a child the answer key before any surface existed to grade an
 * Attempt against, the exact leak the human quality gate exists to prevent. No
 * prompt, no answer, no option body, no Topic label, no allowance figure, no
 * tier, no model name and no `timerMinutes` (AD-20, AD-26).
 *
 * `subjectName` is null for a Source Test carrying no classification, or one
 * whose stored Subject no longer resolves: the row keeps its place and loses
 * its label, because one unresolvable Subject must never cost a child the
 * whole list.
 *
 * `state` is **derived** from Attempts, not stored: there is no `Completed`
 * member on `PracticeTestStatus`.
 */
export interface PracticeTestReleasedSummary {
  id: string;
  subjectName: string | null;
  questionCount: number;
  state: StudentListState;
}

/**
 * One option a child chooses between, in the order it is to be shown.
 *
 * There is **no `isCorrect`**, and that is the whole shape of it. A student view
 * carrying the flag would be an answer key served to the person being tested,
 * whatever a screen then chose to render (AD-20).
 */
export interface StudentChoiceView {
  ordinal: number;
  /** The stored segments, exactly as stored (AD-32). Never re-parsed on the way out. */
  body: RichText;
}

/**
 * One Question as the child working through it sees it.
 *
 * A prompt, a format and — for Multiple Choice — the option bodies. There is no
 * `answer` field and no Topic label: neither is a student-scoped fact, and the
 * first is the answer key itself (AD-20, AD-26).
 */
export interface StudentQuestionView {
  id: string;
  ordinal: number;
  format: QuestionFormat;
  prompt: RichText;
  /** Empty for every format but MultipleChoice. */
  choices: StudentChoiceView[];
}

/**
 * One released Practice Test, whole, as the Take Test screen reads it.
 *
 * Every Question in stored `ordinal` order and never a page: the screen walks
 * the whole test, and a second call could show half of one. It carries no
 * `status` — the only status this read can reach is `Released`, by construction
 * — and no timer, which is Story 5.3's.
 */
export interface StudentPracticeTestView {
  id: string;
  questionCount: number;
  questions: StudentQuestionView[];
}

/**
 * One Attempt, as the Take Test screen reads it.
 *
 * Three instants and nothing else of substance. `startedAt` and `expiresAt` are
 * the server's own, written once at start; `serverNow` is the server's clock at
 * the moment it answered, and it is here so the browser can render a countdown
 * against a **fixed offset** rather than against its own unadjusted clock. A
 * device whose clock is wrong then shifts only what is displayed — expiry is
 * still decided server-side, at submit, from the stored column.
 *
 * `expiresAt` is null for an untimed Practice Test: there is no deadline to
 * render and none to reach.
 *
 * No `timerMinutes`: the duration is not a student-scoped fact and the deadline
 * already expresses it. No grade, no score, no answer and no parent-scoped
 * figure — there is nothing on this view a child could learn anything from but
 * their own clock.
 */
export interface AttemptView {
  id: string;
  practiceTestId: string;
  startedAt: string;
  /** The deadline, or null for an untimed Practice Test. Written once. */
  expiresAt: string | null;
  /** The server's clock when it answered. The browser's offset is measured off this. */
  serverNow: string;
  /** Null while the Attempt is open. */
  submittedAt: string | null;
}

/**
 * One **handed-in** run at a Practice Test, as `grading` reads it to build a run
 * history.
 *
 * An identifier, which test it belongs to, which run of that test it is, when it
 * went in, and how many Questions the paper presented. Nothing else, and in
 * particular **no grade, no answer, no Question and no score**: the module that
 * owns `QuestionGrade` is the one asking, and a figure computed here would be a
 * second answer to FR-37 (AD-6, AD-17).
 *
 * `submittedAt` is a `string` rather than a nullable one because an open run is not
 * in this list at all.
 *
 * `questionCount` is the **owning test's** presented count. It is the same for every
 * run of a released test — Epic 4's write barrier freezes the presented set — which
 * is why it travels on the run rather than being looked up again per test.
 */
export interface AttemptRun {
  attemptId: string;
  practiceTestId: string;
  ordinal: number;
  submittedAt: string;
  questionCount: number;
}

/**
 * One **handed-in** run of one child, as the parent's list of their runs reads it.
 *
 * `AttemptRun` with a Subject label on it, and deliberately not that interface
 * widened: `AttemptRun` is what `grading` composes a *child's* run history from, and
 * the Subject is a label the parent's flat list needs to tell one run from another
 * on a screen that spans every test. Widening it would put a batched cross-module
 * label read on a path that has never needed one.
 *
 * Still **no grade, no score, no answer and no Question**. The score is
 * `grading`'s one figure (FR-37) and arrives with the Attempt detail read; a figure
 * computed here would be a second answer to it (AD-6, AD-17). And still no cost, no
 * tier and no model name (AD-20, AD-26).
 *
 * `subjectName` is null for a test whose Subject carries no classification or no
 * longer resolves. The row keeps its place and loses its label, exactly as
 * `releasedFor`'s rows do.
 */
export interface ParentAttemptSummary {
  attemptId: string;
  practiceTestId: string;
  ordinal: number;
  submittedAt: string;
  questionCount: number;
  subjectName: string | null;
}

/**
 * Which child sat one Attempt of this account — the whole of what a parent-scoped
 * read of anything cached per child needs, and nothing else.
 *
 * It exists so that `explanation` can read an Explanation for a parent without
 * acquiring an `attempt` delegate (AD-17), exactly as `explanationInputFor` exists
 * so it can build a prompt without one. The profile id is **resolved from the
 * Attempt row**, never passed in: an Explanation is cached under
 * `(attemptId, questionId, studentProfileId)`, and taking the third id from a URL
 * would let one child's id be paired with another child's Attempt. Resolved from
 * the row, that pairing cannot be expressed.
 */
export interface AttemptProfile {
  attemptId: string;
  studentProfileId: string;
}

/**
 * What one `(Attempt, Question)` pair **is**, for a surface that holds only the pair.
 *
 * The boundary read Story 6.3's per-child flag list is built on, and it exists for the
 * reason `attemptProfileFor` and `explanationInputFor` do: `explanation` owns
 * `explanation_flag` and holds no `attempt`, `practiceTest`, `question`, `sourceTest`
 * or taxonomy delegate (AD-17), so a list of flags could otherwise name nothing but
 * two opaque ids. A flag a parent cannot recognise is a flag that did not surface.
 *
 * `runOrdinal` is which run of that Practice Test the Attempt was, and
 * `questionOrdinal` the number the child was shown while they worked. Both are the
 * server's figures; nothing derives either from a position in a list.
 *
 * `subjectName` is null for a test whose Subject carries no classification or no
 * longer resolves, exactly as `ParentAttemptSummary`'s is: the entry keeps its place
 * and loses its label.
 *
 * Still **no grade, no score, no answer and no prose**, and no cost, tier or model
 * name (AD-20, AD-26). This says what a flag points at, not what it is about.
 */
export interface FlaggedQuestionContext {
  attemptId: string;
  questionId: string;
  practiceTestId: string;
  /** Which run of that Practice Test the Attempt was. */
  runOrdinal: number;
  /** The number the child was shown while they worked. */
  questionOrdinal: number;
  subjectName: string | null;
  submittedAt: string;
}

/**
 * What handing in answered.
 *
 * `expired` is the comparison **the server made, against its own clock and its
 * own column**, and `gradeAt` is the instant the work is judged at: the deadline
 * when it had passed, the arrival instant otherwise. A submission that crossed a
 * network outage is therefore judged at the moment the time ran out rather than
 * at the moment the connection came back — which is the whole reason the column
 * exists and the reason nothing a browser sends can move it.
 *
 * Still no grade, no score and no answer key: grading is Stories 5.5–5.6, and
 * `gradeAt` names *when* a later story will judge, never what it judged.
 */
export interface AttemptSubmissionView {
  submittedAt: string;
  expired: boolean;
  gradeAt: string;
}

/**
 * What closing an Attempt came to, for the caller that closed it.
 *
 * The submission view's three fields, plus the one fact only the writer of
 * `Answer` can state: which Questions of this Practice Test ended up with no
 * answer row. It is **not** part of any response body — `grading` answers with
 * `AttemptSubmissionView` and nothing more — because a blank count is a fact
 * about the paper and this surface tells a child nothing about their work.
 *
 * Still no grade of any kind. This says *which* Questions are blank; what a blank
 * means is the caller's, and the caller is the module that owns grade state
 * (AD-6, AD-17).
 */
export interface AttemptClosure extends AttemptSubmissionView {
  /**
   * The blank Questions, in stored ordinal order: every Question on the Practice
   * Test that the closing transaction wrote no `Answer` row for.
   */
  blankQuestionIds: string[];
}

/**
 * One Question of an Attempt as **the grader** reads it: the answer key beside
 * the child's raw answer.
 *
 * **Never a response body and never a student-scoped view.** Every field
 * `StudentQuestionView` deliberately omits is here — the stored correct answer,
 * which option is flagged, the raw Topic labels — because the caller of this is
 * the module that decides whether the child was right, and it cannot do that
 * without the answer key. `grading` reads it, uses it and answers with none of
 * it (AD-20).
 */
export interface GradingQuestionInput {
  questionId: string;
  ordinal: number;
  format: QuestionFormat;
  /** The stored segments, exactly as stored (AD-32). */
  prompt: RichText;
  /** The stored correct free-text answer, or null for MultipleChoice. */
  answer: RichText | null;
  /**
   * The ordinal of the option flagged `isCorrect`, or null where there is no
   * such option — every non-MultipleChoice Question, and a Multiple Choice row
   * that somehow lost its flag. An ordinal rather than a body, because what the
   * browser submits for a Multiple Choice Question is the chosen ordinal.
   */
  correctChoiceOrdinal: number | null;
  /** Raw as stored. Canonicalization is Epic 7's (AD-11). */
  topics: string[];
  /** Exactly what the child typed or chose, or null for a Question left blank. */
  answerValue: string | null;
}

/**
 * Everything grading one Attempt needs, in one read.
 *
 * The Attempt's own three facts plus one row per Question of its Practice Test,
 * in stored ordinal order, so every list downstream of this — the prompt's
 * lines, the verdicts, the score — is in the order the child was shown the
 * Questions.
 *
 * An **internal** read, for the reason the row type states. It exists at all
 * because grade state is `grading`'s and Practice Test rows are `practicetest`'s
 * (AD-6, AD-17): the module arrow is `grading -> practicetest`, so the grader
 * asks for this rather than reaching for a delegate it does not own.
 */
export interface AttemptGradingInput {
  practiceTestId: string;
  /** The comparison the server made at submit, against its own clock and column. */
  expired: boolean;
  /** Null while the Attempt is open. */
  submittedAt: Date | null;
  questions: GradingQuestionInput[];
}

/** One Question of an Attempt, with the raw labels generation emitted for it. */
export interface MasteryContextQuestion {
  questionId: string;
  /**
   * The free-form labels, exactly as stored and in stored order. Raw because
   * canonicalizing them is the caller's job and `practicetest` must never do it:
   * `Topic` is `topics`' table and the cascade that fills it is `topics`' (AD-11,
   * AD-17).
   */
  labels: string[];
}

/**
 * Everything canonicalizing and recomputing one Attempt's Topics needs, in one
 * read.
 *
 * An **internal** read, like `AttemptGradingInput`, and for the same reason: Mastery
 * is `grading`'s (AD-6) while `attempt`, `practice_test_question_topic` and the
 * Source Test's classification are not, so the grader asks for this rather than
 * acquiring three delegates it does not own. Not a response shape — no route reads
 * Mastery at all in this story — and deliberately **not** a widening of
 * `gradingInputFor`: that read is the answer key and every one of its callers grades
 * with it, so adding a profile id and a Subject to it would make four fields travel
 * on every hand-in for the sake of one path.
 *
 * `subjectId` is `null` for a Practice Test behind an unclassified Source Test.
 * `isClassified` gates submission, so a released test always carries one in
 * practice — but the column is nullable and a caller that assumed otherwise would
 * canonicalize against `undefined` and mint a Topic under no Subject at all.
 */
export interface AttemptMasteryContext {
  practiceTestId: string;
  studentProfileId: string;
  /** This Attempt's place in the child's runs at this test. What decides eligibility. */
  ordinal: number;
  /** The Subject the canonical Topic set is scoped by, or null if unclassified. */
  subjectId: string | null;
  questions: MasteryContextQuestion[];
}

/**
 * One of a child's submitted Attempts, as the Mastery window rule needs it.
 *
 * `ordinal` rides along rather than being filtered here, because the predicate that
 * decides which run counts is `grading/mastery-eligibility.ts`'s and is stated there
 * and nowhere else. Applying it in this module would either duplicate the rule or
 * reverse the module arrow — `grading -> practicetest` is never `practicetest ->
 * grading` — so this read narrows to what it *can* state from its own columns (the
 * work was handed in) and hands the ordinal over for the one predicate to judge.
 */
export interface SubmittedAttemptRow {
  attemptId: string;
  practiceTestId: string;
  /** Never null: the read filters open Attempts out. */
  submittedAt: Date;
  /** Judged by `countsTowardMastery`, in `grading`, and never compared here. */
  ordinal: number;
}

/**
 * The three facts a Mastery recompute needs about the Attempt whose grade changed:
 * whose run it is, which paper it was at, and which run it is.
 *
 * **One statement on `attempt` and nothing else**, which is the whole reason it is not
 * `masteryContextFor`. That read resolves the Subject through `SOURCE_TEST_READER`,
 * which runs on `sourcetest`'s own client — a second pooled connection taken while the
 * caller's interactive transaction holds locks — and it loads every Question of the
 * paper with its labels. The recompute path is inside that transaction and needs none
 * of it, so it asks for exactly this instead.
 */
export interface AttemptMasteryKey {
  practiceTestId: string;
  studentProfileId: string;
  ordinal: number;
}

/**
 * One Question of a handed-in Attempt as **the child reading their results**
 * sees it: the prompt, what they answered, and what the answer was.
 *
 * The reader's view, beside `GradingQuestionInput`'s grader's view. Every text
 * field is **resolved display text**: a Multiple Choice answer is the chosen
 * option's stored body rather than the ordinal the browser submitted, because a
 * child cannot read "2" as an answer and no screen may build that sentence for
 * itself.
 *
 * There is **no Topic label** on it and no flagged ordinal — the first is not a
 * student-scoped fact (AD-20, AD-26) and the second is not a thing to show — and
 * there is no grade state either: which state a Question is in is `grading`'s to
 * say, and this module neither reads nor writes one (AD-6, AD-17).
 *
 * `studentAnswer` is null for a Question left blank. `correctAnswer` is null only
 * where the stored answer key cannot be read back — a degradation, never a
 * refusal, for the reason `landedPromptsFor` states.
 */
export interface AnswerKeyQuestion {
  questionId: string;
  ordinal: number;
  format: QuestionFormat;
  /** The stored segments, exactly as stored (AD-32). Null when unreadable. */
  prompt: RichText | null;
  /** What the child answered, as words. Null for a Question left blank. */
  studentAnswer: RichText | null;
  /** What the answer was, as words. Null when the stored key is unreadable. */
  correctAnswer: RichText | null;
}

/**
 * One handed-in Attempt's whole answer key, in one read.
 *
 * Every **presented** Question in stored `ordinal` order and never a page: the
 * results screen shows the whole paper, and this is the read that criterion is
 * met by.
 *
 * It carries no score and no grade: FR-37's denominator is `scoreOf`'s and grade
 * state is `grading`'s, so the module that owns them composes this with them.
 */
export interface AttemptAnswerKey {
  attemptId: string;
  practiceTestId: string;
  /** Null for a test whose Subject carries no classification or no longer resolves. */
  subjectName: string | null;
  questionCount: number;
  questions: AnswerKeyQuestion[];
}

/**
 * Everything an Explanation is written from, for one Question of one handed-in
 * Attempt.
 *
 * The third view of a Question, beside `GradingQuestionInput`'s grader's view and
 * `AnswerKeyQuestion`'s reader's view — and the only one that is **plain text
 * throughout**. It is going into a prompt, and a prompt is a string: flattening
 * the stored segments here keeps the module that must not know how a fraction is
 * stored from having to flatten them itself (AD-17, AD-32).
 *
 * `studentAnswer` is an empty string for a Question the child left blank, and
 * `correctAnswer` is an empty string where the stored key could not be read back.
 * Both degrade rather than refuse, because this runs on work already done.
 *
 * `gradeLevelName` is the **Practice Test's** Grade Level, resolved through
 * `sourcetest` — never the Student Profile's. It is `null` for a test carrying no
 * Grade Level or one whose stored id no longer names a row, and the prompt drops
 * its register clause rather than refusing.
 */
export interface ExplanationInput {
  practiceTestId: string;
  /** The number the child was shown while they worked. */
  ordinal: number;
  format: QuestionFormat;
  /** Plain text of the stored prompt. Empty where it could not be read back. */
  prompt: string;
  /** What the child put down, as words. Empty for a Question left blank. */
  studentAnswer: string;
  /** What the answer was, as words. Empty where the stored key is unreadable. */
  correctAnswer: string;
  /** The Practice Test's Grade Level name, or null when it does not resolve. */
  gradeLevelName: string | null;
}

/** One generated option, in the order it is to be shown. */
export interface DraftChoiceView {
  ordinal: number;
  /**
   * The stored rich-text segment array, exactly as it was stored (AD-32). It is
   * not re-parsed on the way out: it was validated on the way in, and a second
   * parse would be a second chance for the two to disagree.
   */
  body: RichText;
  isCorrect: boolean;
}

/** One generated Question, with everything a parent reviews it by. */
export interface DraftQuestionView {
  id: string;
  ordinal: number;
  format: QuestionFormat;
  prompt: RichText;
  /**
   * The correct free-text answer, or null for MultipleChoice — where the answer
   * is the one choice flagged correct rather than a field of its own.
   */
  answer: RichText | null;
  /** Empty for every format but MultipleChoice. */
  choices: DraftChoiceView[];
  /** Raw as stored. Canonicalization is Epic 7's (AD-11). */
  topics: string[];
}

/**
 * One draft, whole: the review screen's entire answer.
 *
 * It carries `status` even though this read serves `Draft` rows and nothing
 * else, because Story 4.5 owns `Released` and `Discarded` and widening this
 * later should be an `in` clause rather than a redesign.
 */
export interface PracticeTestDraftView {
  id: string;
  sourceTestId: string;
  studentProfileId: string;
  status: PracticeTestStatus;
  ordinal: number;
  siblingCount: number;
  questionCount: number;
  createdAt: string;
  /**
   * The countdown the parent configured, in whole minutes, or `null` for none.
   *
   * `null` is off, and it is what every draft nobody configured reads as (FR-15).
   */
  timerMinutes: number | null;
  /**
   * What the screen pre-fills the minutes field with, derived from the stored
   * question count.
   *
   * Computed here rather than in the browser so one definition of "suggested"
   * serves the screen, Epic 5 and every test — and a **suggestion only**: it is
   * never stored by anything but an explicit parent write, so a draft nobody
   * configured stays `null` however often this figure was shown.
   */
  suggestedTimerMinutes: number;
  /** Every Question the draft holds, in stored `ordinal` order. Never a page. */
  questions: DraftQuestionView[];
}

/**
 * Sole owner and sole writer of every Practice Test table (AD-17), and the
 * owner of the generation prompt.
 *
 * Four rules hold it together:
 *
 * - It reads the source material **through `ExtractionReader`** and never
 *   through a Prisma delegate of its own, a Page Image row or a storage path
 *   (AD-15, AD-28). That is what makes generation survive image expiry.
 * - It makes provider calls **through `AiService`** and never constructs a
 *   client, a pin, a retry policy or a cost row (AD-17, AD-20).
 * - Each draft lands in **its own** transaction, fenced against the job row and
 *   carrying its own `chargedAt`. A landed draft is never rolled back by a
 *   later failure of the same job.
 * - Nothing it logs, throws or stores outside a Practice Test row carries a
 *   fragment of generated content. Identifiers, counts and money only (AD-20).
 */
@Injectable()
export class PracticeTestService {
  private readonly logger = new Logger(PracticeTestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly allowance: AllowanceService,
    // Both injected by token against a type-only interface, never against the
    // class: under ESM two services importing each other as values cannot both
    // be decorated, whatever `forwardRef` says. `source-test-reader.ts`
    // explains why in full.
    @Inject(SOURCE_TEST_READER)
    private readonly sourceTests: SourceTestReader,
    @Inject(EXTRACTION_READER)
    private readonly extraction: ExtractionReader,
  ) {}

  /**
   * What this account has left to spend, and the ceiling one request may ask
   * for. Read by the generate screen before anything is chosen.
   */
  async allowanceFor(parentAccountId: string): Promise<GenerationAllowanceView> {
    const consumption = await this.allowance.consumptionFor(parentAccountId);
    const { used, limit } = consumption.allowances.generation;
    return {
      used,
      limit,
      remaining: remainingFor(used, limit),
      maxPerRequest: MAX_PER_REQUEST,
      resetAt: consumption.resetAt,
      timezone: consumption.timezone,
    };
  }

  /**
   * The Topics this Source Test's Extraction actually carries, which are the
   * only Topics a request may be weighted on.
   *
   * In first-appearance order, and de-duplicated by the **same** comparison
   * `request()` resolves against, so the offered list and the resolver cannot
   * disagree: two raw labels differing only by case or spacing are one option
   * here, and choosing it resolves to the spelling offered. Nothing
   * canonicalizes, merges or sorts beyond that — the labels are raw as they
   * were read (AD-11, Epic 7), and the screen offers them as they are.
   *
   * Its refusals mirror `request()`'s, and for the same reason: a screen that
   * could list Topics for an upload the request would refuse would be offering
   * a choice that cannot be made.
   */
  async topicsFor(parentAccountId: string, sourceTestId: string): Promise<GenerationTopicsView> {
    const sourceTest = await this.sourceTests.requireReadable(parentAccountId, sourceTestId);
    if (sourceTest.status !== 'Submitted') throw new ConflictException(EXTRACTION_NOT_READY);

    const extraction = await this.extraction.readForGeneration(sourceTestId);
    if (extraction === null) throw new ConflictException(EXTRACTION_NOT_READY);
    if (extraction.questions.length === 0) throw new ConflictException(NO_USABLE_QUESTIONS);

    return { topics: topicsOf(extraction) };
  }

  /**
   * Accepts a generation request and enqueues the job, or refuses it.
   *
   * The count is clamped **here**, against a count of charged rows read inside
   * the same transaction that writes the job. What the client sent is an
   * opening bid and nothing more: the UI disabling a radio button is a
   * courtesy, and a direct call simply does not have to respect it.
   *
   * The refusals are ordered so the parent reads the most actionable fact: an
   * upload that has not finished being read, then one with nothing usable in
   * it, then a weighting on a Topic the upload does not carry, then an
   * allowance that is spent. A foreign or unknown id answers 404 through
   * `sourcetest` before any of them (AD-18).
   *
   * The weighted Topic is deliberately decided **before** the allowance, and
   * the ordering is not incidental: a request naming a Topic that does not
   * exist is malformed against this upload however much allowance is left, and
   * telling such a parent "no allowance remains" would send them to wait for a
   * period rollover that would refuse them again for a reason nobody stated.
   * The unknown Topic is the fact they can act on, so it is the fact they get.
   */
  async request(
    parentAccountId: string,
    sourceTestId: string,
    count: number,
    weightedTopic?: string | null,
  ): Promise<GenerationJobView> {
    // `requireReadable`, not `requireLive`: a submitted Source Test's
    // `expiresAt` is the draft's capture TTL and is never cleared, so honouring
    // it here would make generation impossible three days after the photograph
    // — the exact opposite of the rule that an Extraction outlives its images.
    const sourceTest = await this.sourceTests.requireReadable(parentAccountId, sourceTestId);
    if (sourceTest.status !== 'Submitted') throw new ConflictException(EXTRACTION_NOT_READY);

    const extraction = await this.extraction.readForGeneration(sourceTestId);
    if (extraction === null) throw new ConflictException(EXTRACTION_NOT_READY);
    if (extraction.questions.length === 0) throw new ConflictException(NO_USABLE_QUESTIONS);

    // Resolved here, before the transaction and before anything is enqueued or
    // charged, and resolved to the **Extraction's** spelling rather than the
    // client's. The prompt asks the model to write Topics in the words it is
    // given, and the post-hoc pass counts generated labels against this one, so
    // persisting what a browser happened to send would put a third spelling
    // into a loop that only works while there is one.
    const resolvedTopic = resolveWeightedTopic(extraction, weightedTopic ?? null);

    const consumption = await this.allowance.consumptionFor(parentAccountId);
    const { limit } = consumption.allowances.generation;
    const windowStart = new Date(consumption.periodStart);
    const windowEnd = new Date(consumption.periodEnd);

    return this.prisma.withTransaction(async (tx) => {
      // Counted inside the transaction that writes the job. Derived from
      // charged rows — never a counter column, and never decremented (AD-14).
      // This does not serialize two concurrent requests against each other
      // (Postgres's default Read Committed isolation lets both read the same
      // pre-charge usage and both be accepted) — a known, deferred gap; see
      // the `deferred` entry on concurrent-request overspend.
      const used = await tx.practiceTest.count({
        where: {
          parentAccountId,
          chargedAt: { gte: windowStart, lt: windowEnd },
        },
      });
      const requestedCount = clampCount(count, remainingFor(used, limit));
      if (requestedCount === 0) throw new ConflictException(NO_GENERATION_ALLOWANCE);

      const job = await tx.generationJob.create({
        data: {
          parentAccountId,
          sourceTestId,
          studentProfileId: sourceTest.studentProfileId,
          requestedCount,
          weightedTopic: resolvedTopic,
        },
        select: JOB_VIEW_FIELDS,
      });
      this.logger.log(
        `Generation job ${job.id} enqueued for source test ${sourceTestId}, ${requestedCount} requested.`,
      );
      return viewOf(job);
    });
  }

  /**
   * Where this account's newest generation job for a Source Test stands.
   *
   * Newest, because a parent may generate again (Story 4.2) and the screen they
   * are standing on is about the request they just made. Ownership is proven by
   * `sourcetest`, which is what makes a foreign or unknown id a 404 rather than
   * a 403 (AD-18).
   */
  async statusFor(parentAccountId: string, sourceTestId: string): Promise<GenerationJobView> {
    await this.sourceTests.requireReadable(parentAccountId, sourceTestId);
    const job = await this.prisma.generationJob.findFirst({
      where: { parentAccountId, sourceTestId },
      // `id` breaks a tie on `createdAt`, which two jobs enqueued in the same
      // millisecond would otherwise leave to whatever order Postgres happens
      // to return — this is "the newest job", not "an arbitrary tied job".
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: JOB_VIEW_FIELDS,
    });
    // No job answers the same 404 an unknown id gets: there is nothing to
    // report, and nothing about the answer confirms which of the two it was.
    if (job === null) throw new NotFoundException(GENERATION_NOT_REQUESTED);
    return viewOf(job);
  }

  /**
   * Every draft this account is still holding, newest first.
   *
   * This is what makes the generation screen's "nothing is lost by leaving"
   * true: a parent who walked away from a running job finds the drafts they
   * paid for here, addressed by id and reachable without the URL they left.
   *
   * The account is the `where`, not a comparison after the read — which is what
   * makes another account's draft unreachable by construction rather than by
   * remembering to check. Nothing of what a draft *holds* is on this view: a
   * list is for finding one, and the questions are the full read's answer.
   *
   * The rows and their sibling counts are read in **one transaction**: a
   * sibling released or discarded between two separate reads would produce
   * "draft 2 of 1", and that figure is stated as authoritative precisely
   * because the browser has no way to check it.
   */
  async draftsFor(parentAccountId: string): Promise<PracticeTestDraftSummary[]> {
    const { drafts, countByJob } = await this.prisma.withTransaction(async (tx) => {
      const rows = await tx.practiceTest.findMany({
        where: { parentAccountId, status: 'Draft' },
        // `id` breaks a tie on `createdAt`: two drafts of one job can land
        // inside the same millisecond, and "newest first" must not mean
        // "whatever order Postgres happened to return".
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          sourceTestId: true,
          studentProfileId: true,
          generationJobId: true,
          ordinal: true,
          questionCount: true,
          createdAt: true,
        },
      });
      if (rows.length === 0) return { drafts: rows, countByJob: new Map<string, number>() };

      // "Draft 2 of 3" is a fact about the job, counted here in one grouped
      // read rather than by the browser fetching each job's whole draft set to
      // render a heading.
      const siblings = await tx.practiceTest.groupBy({
        by: ['generationJobId'],
        where: {
          parentAccountId,
          status: 'Draft',
          generationJobId: { in: [...new Set(rows.map((draft) => draft.generationJobId))] },
        },
        _count: { _all: true },
      });
      return {
        drafts: rows,
        countByJob: new Map(siblings.map((row) => [row.generationJobId, row._count._all])),
      };
    });

    return drafts.map((draft) => ({
      id: draft.id,
      sourceTestId: draft.sourceTestId,
      studentProfileId: draft.studentProfileId,
      ordinal: draft.ordinal,
      // The draft is its own sibling, so the grouped count always holds it and
      // the fallback is never reached — it exists so the view carries a real
      // figure rather than a `?? 0` that would read as "of 0".
      siblingCount: countByJob.get(draft.generationJobId) ?? 1,
      questionCount: draft.questionCount,
      createdAt: draft.createdAt.toISOString(),
    }));
  }

  /**
   * The Practice Tests one child can see: released, theirs, what there is left
   * to do first and what is finished after it.
   *
   * The **only** cross-boundary read of a Practice Test that exists, and the
   * whole of what Student Home is drawn from. Both ids come from the binding the
   * Student Mode guard verified, never from a parameter, a query or a path — so
   * a device bound to one child cannot address another's release at all.
   *
   * `status: 'Released'` is in the `where` of the statement, which is how
   * discard's exclusion from every downstream surface is structural rather than
   * remembered: a `Discarded` row is not something a later reader must filter,
   * it is something this read cannot reach (AD-17).
   *
   * An identifier, a Subject, a count and a condition per row. Not a prompt,
   * not an answer, not an option body, not a Topic label, no `timerMinutes`,
   * and no allowance figure, tier or model name — none of those is a
   * student-scoped fact (AD-20, AD-26).
   *
   * **One flat list, never grouped.** The Subject is a label on a row, not a
   * heading over a section: grouping would make finding the newest thing to do
   * a search through headings, and the whole point of the order below is that
   * it is not.
   *
   * The Subject label is resolved through `SOURCE_TEST_READER`, batched over
   * every row's Source Test in one call. `practicetest` holds no `sourceTest`
   * and no `subject` delegate and must not acquire one (AD-17), and one call
   * per row across a module boundary would be an N+1. A test whose Subject
   * cannot be resolved keeps its place and loses its label.
   *
   * **Sorted in memory**, which every other read here does in the statement.
   * The comparator's key for the completed band is the *most recent
   * `submittedAt` across a row's Attempts* — a per-row aggregate Prisma cannot
   * `orderBy` — and the band itself is derived from those same rows. A child's
   * released tests are bounded by the Generation Allowance their parent has
   * spent, so the set being sorted is small by construction and stays small.
   *
   * Band 1's key is `createdAt`: when the Practice Test was **generated**, not
   * when it was released. There is no `releasedAt` column, so a test generated
   * last week and released today sorts below one generated this morning. The
   * acceptance criterion asks only for newest-first within the band and does
   * not name the instant, so this is stated as what it is rather than
   * described as a release order it cannot express.
   */
  async releasedFor(
    parentAccountId: string,
    studentProfileId: string,
  ): Promise<PracticeTestReleasedSummary[]> {
    const rows = await this.prisma.practiceTest.findMany({
      where: { parentAccountId, studentProfileId, status: 'Released' },
      // Still `createdAt desc, id desc`, so the rows arrive in band-1 order
      // already and the comparator below only has to move the completed ones.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        sourceTestId: true,
        questionCount: true,
        createdAt: true,
        // Read-only: nothing in this story creates, starts or submits an
        // Attempt. Stories 5.2–5.4 own every write.
        attempts: { select: { submittedAt: true } },
      },
    });
    if (rows.length === 0) return [];

    const labels = await this.sourceTests.readSubjectLabels(rows.map((row) => row.sourceTestId));

    return rows
      .map((row) => ({
        id: row.id,
        subjectName: labels.get(row.sourceTestId) ?? null,
        questionCount: row.questionCount,
        createdAt: row.createdAt,
        state: studentListState(row.attempts),
        lastSubmittedAt: lastSubmission(row.attempts),
      }))
      .sort(compareStudentListRows)
      .map(({ id, subjectName, questionCount, state }) => ({
        id,
        subjectName,
        questionCount,
        state,
      }));
  }

  /**
   * One released Practice Test, whole, for the bound child to work through.
   *
   * **All three ids and the status sit in one `where`.** `parentAccountId` and
   * `studentProfileId` come from the binding the Student Mode guard verified —
   * never from the path, which names *which* test and never *whose* — and
   * `status: 'Released'` sits beside them. That single statement is what makes a
   * `Draft`, a `Discarded` row, a sibling's release, another account's test and
   * an id that never existed answer the **same** sentence by construction rather
   * than by five checks somebody has to remember to write (AD-17, AD-18).
   *
   * What comes back carries **no correct answer of any kind**: no `answer`
   * column, no `isCorrect` flag, no Topic label, and no allowance figure, tier or
   * model name (AD-20, AD-26). That is not the mapper's discipline — it is
   * `STUDENT_TEST_SELECT`'s, which never names those columns at all.
   *
   * There is no Attempt and nothing is written: a child's answers are the
   * screen's for now, and persisting them is Story 5.3's.
   */
  async releasedTestFor(
    parentAccountId: string,
    studentProfileId: string,
    practiceTestId: string,
  ): Promise<StudentPracticeTestView> {
    const test = await this.prisma.practiceTest.findFirst({
      where: { id: practiceTestId, parentAccountId, studentProfileId, status: 'Released' },
      select: STUDENT_TEST_SELECT,
    });
    // The one sentence every refusal shares. Nothing in it says which case it
    // was, and nothing could: the statement above cannot tell them apart either.
    if (test === null) throw new NotFoundException(PRACTICE_TEST_NOT_FOUND);
    return studentTestViewOf(test);
  }

  /**
   * The Attempt this child is working under: the open one if there is one, a new
   * one otherwise.
   *
   * **Idempotent by construction.** A refresh, a second tab and a re-entry after
   * a dropped connection all reach this and all get the *same* row back with its
   * original instants: an existing Attempt is looked for first, and only its
   * absence inserts. Without that, every reload would hand the child a fresh
   * deadline and the timer the parent configured would mean nothing.
   *
   * "Existing" means the **latest** Attempt on this Practice Test for this child by
   * `ordinal desc`, not only an open one. A child who re-opens a test they handed in
   * gets that Attempt back with its `submittedAt` set, and the screen states that
   * the work is in. A second row is a retake, and the only thing that inserts one is
   * `startRetake` — never this method, on any path, with any argument.
   *
   * **After a retake this resumes the retake**, because the retake is now the latest
   * row: the `orderBy` is what makes that true rather than a branch, so a reload, a
   * second tab and a re-entry all reach the run the child is actually on and the
   * earlier Attempt is never handed back out.
   *
   * **The server writes both instants, from its own clock, once.** `startedAt` is
   * `now`. `expiresAt` is `startedAt` plus the Practice Test's `timerMinutes`
   * *snapshotted at this moment*, or null for an untimed test — and neither is
   * ever moved, extended, paused or recomputed afterwards. Nothing in a request
   * body reaches either: there is no body on this route at all. A timer that
   * could be moved would retroactively change how a past Attempt graded.
   *
   * All three ids and `status: 'Released'` sit in one `where`, exactly as
   * `releasedTestFor`'s do, and for the same reason: a draft, a discarded row, a
   * sibling's release, another account's test and an id that never existed are
   * one indistinguishable 404 by construction rather than by five checks.
   *
   * One transaction, because the read that decides whether to insert and the
   * insert itself have to be one decision — two children cannot be on one device,
   * but two tabs can, and a split read would leave two open Attempts with two
   * different deadlines.
   */
  async startOrResumeAttempt(
    parentAccountId: string,
    studentProfileId: string,
    practiceTestId: string,
  ): Promise<AttemptView> {
    /**
     * Find the released test, resume the Attempt there is, insert one otherwise.
     *
     * Named rather than inlined because it is run **twice** in the race the catch
     * below describes, and both runs have to be the same decision.
     */
    const open = async (tx: TransactionClient): Promise<AttemptRow> => {
      const test = await tx.practiceTest.findFirst({
        where: { id: practiceTestId, parentAccountId, studentProfileId, status: 'Released' },
        select: { id: true, timerMinutes: true },
      });
      // The one sentence every student refusal shares. Nothing in it says which
      // case it was, and nothing could: the statement above cannot tell them
      // apart either.
      if (test === null) throw new NotFoundException(PRACTICE_TEST_NOT_FOUND);

      const existing = await tx.attempt.findFirst({
        where: { practiceTestId: test.id, studentProfileId },
        orderBy: { ordinal: 'desc' },
        select: ATTEMPT_SELECT,
      });
      // Returned untouched, **whether it is open or already handed in**. Not
      // `update`d, not re-stamped, not extended: resuming is reading, and the whole
      // authority of the clock is that this row's instants were written once. A
      // submitted Attempt comes back carrying its `submittedAt`, which is how the
      // screen knows to state that the work is in rather than to offer a second run
      // at it — there is **no retake here**, and inserting a second row for a test
      // this child has already handed in is `startRetake`'s and nothing else's.
      if (existing !== null) return existing;

      const startedAt = new Date();
      return tx.attempt.create({
        data: {
          practiceTestId: test.id,
          parentAccountId,
          studentProfileId,
          // Always 1 here: the branch above returns the latest row whenever one
          // exists, so this insert is only ever the child's **first** run at this
          // test. Every later ordinal is `startRetake`'s, computed from the latest
          // row it found — and the unique index is what makes "one row per run" a
          // database fact rather than an ordering accident.
          ordinal: 1,
          startedAt,
          // Minutes converted here and nowhere else: the column is what a parent
          // entered, and a unit converted twice is a unit two surfaces can
          // disagree about.
          expiresAt:
            test.timerMinutes === null
              ? null
              : new Date(startedAt.getTime() + test.timerMinutes * 60_000),
        },
        select: ATTEMPT_SELECT,
      });
    };

    let attempt: AttemptRow;
    try {
      attempt = await this.prisma.withTransaction(open);
    } catch (cause: unknown) {
      // The read and the insert inside `open` are one decision but not one lock:
      // under read-committed isolation two tabs opening the same test both find no
      // row and both insert `ordinal: 1`, and the loser trips
      // `attempt_practiceTestId_studentProfileId_ordinal_key`. That is the unique
      // index doing its job — "one Attempt per child per run" held at the database
      // rather than by whichever request happened to arrive first — so the loser
      // **resumes** the row the winner wrote. A 500 here would break the one promise
      // this method makes, at exactly the moment it is needed.
      //
      // **Caught out here, and the transaction run again.** Postgres aborts the whole
      // transaction on a constraint violation, so every statement after it inside the
      // same transaction fails with "current transaction is aborted" — recovering
      // where the insert failed is not something a retry inside it can do. The second
      // run finds the winner's row with its `existing` branch and returns it
      // untouched; it cannot loop, because that row is now there for good.
      if (!isUniqueViolation(cause)) throw cause;
      attempt = await this.prisma.withTransaction(open);
    }
    return attemptViewOf(attempt, new Date());
  }

  /**
   * Opens a **second** run at a Practice Test the child has already finished: a new
   * Attempt at the next `ordinal`, with the same Questions and a fresh deadline.
   *
   * **Its own method rather than a flag on `startOrResumeAttempt`.** That route's
   * whole promise is that it never inserts while a row exists — it is what keeps a
   * reload, a second tab and a reconnect from handing out a fresh deadline, and it is
   * asserted from outside in several places. A query flag or a body field able to
   * make it create would turn every one of those paths into a path that could start a
   * run the child never asked for. A separate write is the smallest change that keeps
   * that promise literally true, and it is also where the 409 belongs.
   *
   * **Nothing about a Question is read here, and nothing about one is written.** The
   * new Attempt presents the same `PracticeTestQuestion` rows in the same stored
   * `ordinal` order, because it presents *the test* and the test did not change:
   * there is no per-Attempt order column and no shuffle, so a retake cannot alter a
   * prompt, an answer key or the order any run's results are read in. This method
   * does not touch `practiceTestQuestion` at all.
   *
   * **Prior Attempts are read to decide, never to write.** The latest row is read for
   * its `ordinal` and its `submittedAt` and for nothing else; no earlier `Attempt`,
   * no `Answer` row and no `QuestionGrade` row appears in any statement this method
   * makes, so there is no path by which a retake could move, blank or delete a
   * finished run's work.
   *
   * **Refused unless the latest Attempt is handed in**, which deliberately covers a
   * test never sat as well: `ATTEMPT_NOT_RETAKEABLE`, one 409 and one sentence, for
   * the reason the constant states at length. Two open Attempts would give the resume
   * read two answers and split the client-held store.
   *
   * **Both instants are the server's, written from its own clock at this moment**,
   * exactly as the first run's are — and `timerMinutes` is snapshotted *as the column
   * stands now* rather than copied from the earlier Attempt's instants, so a retake
   * of a timed test gets the duration the test currently carries.
   *
   * Ownership is the same one-`where` released lookup and the same shared 404: a
   * draft, a discarded row, a sibling's release, another account's test and an id
   * that never existed are one indistinguishable refusal by construction.
   */
  async startRetake(
    parentAccountId: string,
    studentProfileId: string,
    practiceTestId: string,
  ): Promise<AttemptView> {
    /** This child's latest run at this released test, or null for a test never sat. */
    const latestAttemptOf = async (tx: TransactionClient): Promise<AttemptRow | null> => {
      const test = await tx.practiceTest.findFirst({
        where: { id: practiceTestId, parentAccountId, studentProfileId, status: 'Released' },
        select: { id: true },
      });
      if (test === null) throw new NotFoundException(PRACTICE_TEST_NOT_FOUND);
      return tx.attempt.findFirst({
        where: { practiceTestId: test.id, studentProfileId },
        orderBy: { ordinal: 'desc' },
        select: ATTEMPT_SELECT,
      });
    };

    const retake = async (tx: TransactionClient): Promise<AttemptRow> => {
      const test = await tx.practiceTest.findFirst({
        where: { id: practiceTestId, parentAccountId, studentProfileId, status: 'Released' },
        select: { id: true, timerMinutes: true },
      });
      // The one sentence every student ownership refusal shares, from the one
      // statement that cannot tell the cases apart either.
      if (test === null) throw new NotFoundException(PRACTICE_TEST_NOT_FOUND);

      const latest = await tx.attempt.findFirst({
        where: { practiceTestId: test.id, studentProfileId },
        // The same `ordinal desc` the resume read uses, so "the latest run" is one
        // definition rather than two that could disagree.
        orderBy: { ordinal: 'desc' },
        select: { ordinal: true, submittedAt: true },
      });
      // Both cases, one sentence: nothing to retake, and a run still going.
      if (latest === null || latest.submittedAt === null) {
        throw new ConflictException(ATTEMPT_NOT_RETAKEABLE);
      }

      const startedAt = new Date();
      return tx.attempt.create({
        data: {
          practiceTestId: test.id,
          parentAccountId,
          studentProfileId,
          // The next run, from the row that is currently the last one. Nothing about
          // the earlier Attempt is carried over but this number.
          ordinal: latest.ordinal + 1,
          startedAt,
          // The column as it stands **now**, converted here and nowhere else — never
          // the first run's `expiresAt` shifted, which would make a past Attempt's
          // deadline the authority over a new one.
          expiresAt:
            test.timerMinutes === null
              ? null
              : new Date(startedAt.getTime() + test.timerMinutes * 60_000),
        },
        select: ATTEMPT_SELECT,
      });
    };

    let attempt: AttemptRow;
    try {
      attempt = await this.prisma.withTransaction(retake);
    } catch (cause: unknown) {
      // Two presses, one run. The read and the insert are one decision but not one
      // lock, so two requests can both compute the same `ordinal + 1` and the loser
      // trips `attempt_practiceTestId_studentProfileId_ordinal_key`. Caught out here
      // because Postgres aborts the whole transaction on a constraint violation.
      //
      // **The loser does not re-run the decision.** `startOrResumeAttempt` recovers
      // by running its whole transaction again, which is safe there because the
      // second run finds the winner's row and returns it. Here a second run would
      // re-read the latest ordinal — now the winner's — and insert *again*, leaving a
      // child who pressed once with two open runs. So the recovery is a read: the
      // latest row, which is the winner's retake, returned as the answer to the press
      // that lost. The unique index is the only thing that can tell us we lost.
      if (!isUniqueViolation(cause)) throw cause;
      const latest = await this.prisma.withTransaction(latestAttemptOf);
      // Unreachable in practice — the violation means a row at that ordinal exists —
      // and stated rather than asserted away, so a future change cannot make a
      // non-null assertion quietly wrong.
      if (latest === null) throw new ConflictException(ATTEMPT_NOT_RETAKEABLE);
      attempt = latest;
    }
    return attemptViewOf(attempt, new Date());
  }

  /**
   * Every **handed-in** run this child has at a released Practice Test, in run order,
   * with the owning test's presented count beside each.
   *
   * The one read `grading` composes a child's run history off. It carries **no grade,
   * no answer and no Question**: the module that reads `QuestionGrade` is the caller
   * (AD-6, AD-17), and this read's whole job is to say which runs exist and how long
   * the paper was.
   *
   * **A run still open is absent.** An open Attempt is not a score and is not a run
   * anything can be said about yet, so the filter is `submittedAt: { not: null }`
   * rather than a flag the caller has to remember.
   *
   * `questionCount` travels **with the run** rather than being looked up per test,
   * because Epic 4's write barrier freezes the presented set of a released test: every
   * run of it met the same Questions, so the count is the same for all of them and
   * one join answers it in the same round trip.
   *
   * Ordered `practiceTestId asc, ordinal asc`, so the caller groups by walking rather
   * than by sorting — and "first" and "latest" are the ends of each group by
   * construction.
   */
  async submittedRunsFor(parentAccountId: string, studentProfileId: string): Promise<AttemptRun[]> {
    const rows = await this.prisma.attempt.findMany({
      where: {
        parentAccountId,
        studentProfileId,
        submittedAt: { not: null },
        practiceTest: { status: 'Released' },
      },
      orderBy: [{ practiceTestId: 'asc' }, { ordinal: 'asc' }],
      select: {
        id: true,
        practiceTestId: true,
        ordinal: true,
        submittedAt: true,
        // The owning test's presented count, in the same statement. Not its status,
        // not its timer and not its Subject: none of those is a fact about a run.
        practiceTest: { select: { questionCount: true } },
      },
    });
    return rows.map((row) => ({
      attemptId: row.id,
      practiceTestId: row.practiceTestId,
      ordinal: row.ordinal,
      // Non-null by the `where` above, which is what makes the view's `string`
      // honest rather than optimistic.
      submittedAt: row.submittedAt!.toISOString(),
      questionCount: row.practiceTest.questionCount,
    }));
  }

  /**
   * Every **handed-in** run one child of this account has, newest first, with the
   * Subject label beside each — the parent's way in to an Attempt.
   *
   * **The account is the entitlement and the profile is a filter.** Both ids sit in
   * the `where`, and the account one comes off the verified elevation rather than
   * off the path (AD-18) — so a profile id belonging to another account matches no
   * Attempt of *this* account and answers `[]`. That is the identical answer a child
   * of this account with nothing handed in gets, which is what keeps this route from
   * enumerating anybody's profile ids. There is deliberately **no 404 here**: a list
   * that refused an unknown profile would be a list that confirmed a known one.
   *
   * **Newest first**, which is the opposite of `submittedRunsFor`'s order and for a
   * different reader: that one is grouped by test so `grading` can walk it, and this
   * one is a flat list a parent scans for the most recent thing their child did. So
   * the order is `submittedAt desc` with `id desc` behind it, in the statement.
   *
   * The Subject label is batched through `SOURCE_TEST_READER` over every row's
   * Source Test in one call, exactly as `releasedFor` does it: `practicetest` holds
   * no `sourceTest` and no `subject` delegate and must not acquire one (AD-17), and
   * one call per row across a module boundary would be an N+1. A label that no
   * longer resolves costs the row nothing.
   *
   * No grade, no score, no answer and no allowance, tier, cost or model figure: none
   * of those is a fact about which runs exist (AD-20, AD-26).
   */
  async parentSubmittedRunsFor(
    parentAccountId: string,
    studentProfileId: string,
  ): Promise<ParentAttemptSummary[]> {
    const rows = await this.prisma.attempt.findMany({
      where: {
        parentAccountId,
        studentProfileId,
        submittedAt: { not: null },
        practiceTest: { status: 'Released' },
      },
      // Newest first, with the id behind it so two runs handed in inside the same
      // millisecond still come back in a stable order.
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        practiceTestId: true,
        ordinal: true,
        submittedAt: true,
        practiceTest: { select: { questionCount: true, sourceTestId: true } },
      },
    });
    if (rows.length === 0) return [];

    const labels = await this.sourceTests.readSubjectLabels(
      rows.map((row) => row.practiceTest.sourceTestId),
    );

    return rows.map((row) => ({
      attemptId: row.id,
      practiceTestId: row.practiceTestId,
      ordinal: row.ordinal,
      // Non-null by the `where` above, which is what makes the view's `string`
      // honest rather than optimistic.
      submittedAt: row.submittedAt!.toISOString(),
      questionCount: row.practiceTest.questionCount,
      subjectName: labels.get(row.practiceTest.sourceTestId) ?? null,
    }));
  }

  /**
   * Which child sat one handed-in Attempt of this account.
   *
   * **The boundary read the parent's Explanation surface is built on.** It is the
   * sibling of `explanationInputFor` and it exists for the same reason: so the
   * module that owns `Explanation` can serve a parent without acquiring an `attempt`
   * delegate (AD-17). It returns the one fact that module cannot know and must not
   * be told — which child's rows to read — and it returns it *from the Attempt row*.
   *
   * **It is also the ownership proof, and it runs first.** The `where` carries the
   * account off the verified elevation and no profile id at all, because a parent's
   * entitlement is the account: any child of *this* account is readable and nothing
   * else is. A foreign Attempt, an unknown id and one still open all throw the single
   * `PRACTICE_TEST_NOT_FOUND` sentence, never a 403 and never three sentences
   * (AD-18) — an open Attempt has no results and no Explanations to read, and that
   * is not a different flavour of refusal.
   *
   * One statement, two columns. No Question, no answer, no grade and nothing about
   * the Practice Test: a caller that wanted any of those would be a caller asking
   * the wrong module.
   */
  async attemptProfileFor(parentAccountId: string, attemptId: string): Promise<AttemptProfile> {
    const attempt = await this.prisma.attempt.findFirst({
      where: { id: attemptId, parentAccountId },
      select: { id: true, studentProfileId: true, submittedAt: true },
    });
    // The one sentence a foreign Attempt, an unknown id and an Attempt still open
    // all share.
    if (attempt === null || attempt.submittedAt === null) {
      throw new NotFoundException(PRACTICE_TEST_NOT_FOUND);
    }
    return { attemptId: attempt.id, studentProfileId: attempt.studentProfileId };
  }

  /**
   * What a set of `(Attempt, Question)` pairs point at, for this account only.
   *
   * **One boundary read for a whole list**, which is why it takes the refs in bulk:
   * `explanation` composes a parent's flag list from rows that carry two ids and no
   * context, and a call per entry across a module boundary would be an N+1 on a screen
   * whose whole job is to be a list. Two statements and one batched label read,
   * whatever the length.
   *
   * **It refuses nothing and returns less instead.** A ref outside this account, one
   * naming an Attempt still open, one naming an id that never existed and one pairing a
   * real Question with the wrong Attempt are all simply *absent* from the answer. The
   * caller has already proved its own entitlement — these refs come off rows it owns,
   * not off a request — so a throw here would turn one unresolvable label into a whole
   * screen that will not load. A missing context costs the entry its label, never its
   * place, exactly as an unresolved Subject does.
   *
   * The account is in the `where` regardless, because "the caller has proved it" is not
   * a thing this method can see: a future caller that got its scoping wrong reads
   * nothing here rather than reading another family's ordinals.
   *
   * The Subject label is batched through `SOURCE_TEST_READER` over every row's Source
   * Test in one call, exactly as `parentSubmittedRunsFor` does it: this module holds no
   * `sourceTest` and no `subject` delegate and must not acquire one (AD-17).
   *
   * No grade, no score, no answer, no prose and no allowance, tier, cost or model
   * figure: none of those is a fact about what a flag points at (AD-20, AD-26).
   */
  async flaggedQuestionContextsFor(
    parentAccountId: string,
    refs: readonly { attemptId: string; questionId: string }[],
  ): Promise<FlaggedQuestionContext[]> {
    if (refs.length === 0) return [];

    const attempts = await this.prisma.attempt.findMany({
      where: {
        id: { in: [...new Set(refs.map((ref) => ref.attemptId))] },
        parentAccountId,
        // A run still open has no results and nothing to review, so it names nothing.
        submittedAt: { not: null },
      },
      select: {
        id: true,
        practiceTestId: true,
        ordinal: true,
        submittedAt: true,
        practiceTest: { select: { sourceTestId: true } },
      },
    });
    if (attempts.length === 0) return [];
    const attemptById = new Map(attempts.map((attempt) => [attempt.id, attempt]));

    // Scoped to the Practice Tests those Attempts were sat at, so a real Question of
    // another test is as absent as one that never existed — the same scoping
    // `explanationInputFor` puts on its own Question read, for the same reason.
    const questions = await this.prisma.practiceTestQuestion.findMany({
      where: {
        id: { in: [...new Set(refs.map((ref) => ref.questionId))] },
        practiceTestId: { in: [...new Set(attempts.map((attempt) => attempt.practiceTestId))] },
      },
      select: { id: true, practiceTestId: true, ordinal: true },
    });
    const questionById = new Map(questions.map((question) => [question.id, question]));

    const labels = await this.sourceTests.readSubjectLabels(
      attempts.map((attempt) => attempt.practiceTest.sourceTestId),
    );

    const contexts: FlaggedQuestionContext[] = [];
    for (const ref of refs) {
      const attempt = attemptById.get(ref.attemptId);
      const question = questionById.get(ref.questionId);
      if (attempt === undefined || question === undefined) continue;
      // The pair has to agree: a Question of another test paired with this Attempt
      // names no ordinal of this run, and answering one anyway would label an entry
      // with a number the child never saw.
      if (question.practiceTestId !== attempt.practiceTestId) continue;
      contexts.push({
        attemptId: attempt.id,
        questionId: question.id,
        practiceTestId: attempt.practiceTestId,
        runOrdinal: attempt.ordinal,
        questionOrdinal: question.ordinal,
        subjectName: labels.get(attempt.practiceTest.sourceTestId) ?? null,
        // Non-null by the `where` above, which is what makes the view's `string` honest
        // rather than optimistic.
        submittedAt: attempt.submittedAt!.toISOString(),
      });
    }
    return contexts;
  }

  /**
   * Closes the Attempt inside the caller's transaction: the child's raw answers,
   * the instant it closed, and which Questions were left blank.
   *
   * **Called from `grading`, never mounted here.** Handing in is one transaction
   * that closes the Attempt *and* records what its blanks mean (AD-4, AD-10), and
   * grade state is `grading`'s entity and `grading`'s sole write (AD-6, AD-17). So
   * the route lives over there and this is the half of it `practicetest` owns.
   * Nothing in this module reads or writes a grade, and the module arrow stays
   * `grading -> practicetest` with no `forwardRef` and no reversed edge.
   *
   * It takes a `tx` rather than opening one, for the reason `admin-audit` and
   * `parent-account` do: `withTransaction` does not nest, and a cross-module
   * transaction is a client passed as a parameter. There is therefore no instant at
   * which an Attempt is handed in and its blanks are unrecorded.
   *
   * **Expiry is decided here, on the server's clock, against the server's own
   * column.** A client claim about expiry never arrives and would never be
   * believed: the browser decides only *when it dispatches*, never how the
   * Attempt is judged. So a submission that crossed a network outage is judged at
   * `expiresAt` — `gradeAt` names that instant rather than the arrival one — and
   * nothing a browser sends can buy time or lose it.
   *
   * The Attempt is found by its id **and** both ids off the binding, so an
   * Attempt of another profile or another account answers the one shared 404. A
   * second submission answers 409 with its own stated reason instead: "already
   * handed in" is a rule the child is entitled to know about, where a 404 would
   * make a successful hand-in look like a lost one and invite a re-send.
   *
   * What is written here is the **raw** answers and nothing else. A question id
   * that is not on this Practice Test is ignored rather than refused — a stale id in
   * a browser's store is not a reason to lose a child's whole paper — and a blank
   * value is simply a Question left blank, with no row at all. There is still no
   * grade column on `Answer` and nothing here says what a blank *means*: this method
   * reports which Questions are blank and the caller decides.
   *
   * The blanks are computed here because **only the writer of `Answer` knows what it
   * wrote**. Computing them anywhere else would be a second definition of "blank",
   * and the two would disagree the first time either the dedupe or the
   * drop-the-whitespace rule was tuned.
   */
  async closeAttempt(
    tx: TransactionClient,
    parentAccountId: string,
    studentProfileId: string,
    attemptId: string,
    answers: readonly { questionId: string; value: string }[],
  ): Promise<AttemptClosure> {
    const attempt = await tx.attempt.findFirst({
      where: { id: attemptId, parentAccountId, studentProfileId },
      select: { id: true, practiceTestId: true, expiresAt: true, submittedAt: true },
    });
    if (attempt === null) throw new NotFoundException(PRACTICE_TEST_NOT_FOUND);
    if (attempt.submittedAt !== null) throw new ConflictException(ATTEMPT_ALREADY_SUBMITTED);

    const now = new Date();
    // The comparison, in one place: the server's clock against the server's
    // column. `expiresAt` null is an untimed Attempt, which never expires.
    const expired = attempt.expiresAt !== null && now.getTime() > attempt.expiresAt.getTime();

    // **Closed first, and closed conditionally.** `submittedAt: null` is in the
    // `where`, so exactly one of two concurrent submissions can match — the read
    // above is a courtesy that gives the common case its sentence early, and *this*
    // is what makes "a second submission answers 409" true rather than merely
    // usual. Without it, two submissions arriving together both read `null` under
    // read-committed isolation, both write answers, and the loser trips
    // `answer_attemptId_questionId_key` as a 500 instead of the stated refusal.
    //
    // Before the answers rather than after, so the loser is refused before it
    // writes a row: the whole statement is one transaction, so a rollback would
    // undo them either way, but ordering it this way means the conflict is decided
    // by the Attempt's own state and never by a collision on someone else's rows.
    const closed = await tx.attempt.updateMany({
      where: { id: attempt.id, submittedAt: null },
      data: { submittedAt: now, expired },
    });
    if (closed.count !== 1) throw new ConflictException(ATTEMPT_ALREADY_SUBMITTED);

    // Which Questions are on this Practice Test is a row-dependent fact, so it
    // is settled here rather than in the DTO. Ids the body names and this set
    // does not are dropped silently.
    //
    // Read in stored ordinal order, so the blank list below comes back in the
    // order the child was shown the Questions rather than in whatever order the
    // planner happened to return rows in.
    const questionsOnThisTest = (
      await tx.practiceTestQuestion.findMany({
        where: { practiceTestId: attempt.practiceTestId },
        orderBy: { ordinal: 'asc' },
        select: { id: true },
      })
    ).map((question) => question.id);
    const onThisTest = new Set(questionsOnThisTest);

    // Keyed by question, so a body that named one Question twice writes one row
    // rather than tripping the unique index and losing the whole submission.
    // Trimmed for emptiness only — the stored value is exactly what was typed.
    const byQuestion = new Map<string, string>();
    for (const answer of answers) {
      if (!onThisTest.has(answer.questionId)) continue;
      if (answer.value.trim().length === 0) continue;
      byQuestion.set(answer.questionId, answer.value);
    }

    if (byQuestion.size > 0) {
      await tx.answer.createMany({
        data: [...byQuestion].map(([questionId, value]) => ({
          attemptId: attempt.id,
          questionId,
          value,
        })),
      });
    }

    return {
      submittedAt: now.toISOString(),
      expired,
      // Judged at the deadline when it had passed, at arrival otherwise. The
      // non-null assertion is the `expired` guard's: `expired` is only ever true
      // where `expiresAt` is a date.
      gradeAt: (expired ? attempt.expiresAt! : now).toISOString(),
      // Every Question on this test that `byQuestion` — the set actually written
      // above — has no key for. A body that named a Question twice leaves it
      // unblank once; a body that named one of another test's Questions does not
      // make that Question blank here, because it is not on this test at all; and
      // a value trimmed away to nothing leaves its Question blank, because no row
      // was written for it.
      blankQuestionIds: questionsOnThisTest.filter((id) => !byQuestion.has(id)),
    };
  }

  /**
   * The answer key plus the child's raw answers, for the module that grades them.
   *
   * **Internal, and never a response body.** This is the one read on this service
   * that hands out what `StudentQuestionView` exists to withhold — the stored
   * correct answer, which option is flagged, the raw Topic labels (AD-20). Its
   * only caller is `grading`, which needs all three to decide whether the child
   * was right and answers with none of them.
   *
   * It lives here rather than in `grading` because the rows are `practicetest`'s:
   * the module arrow is `grading -> practicetest` and never reversed, so the
   * grader asks for a view instead of holding a delegate of its own (AD-6, AD-17).
   *
   * Found by the attempt id **and** both binding ids, so an Attempt of another
   * profile or another account answers the one shared 404 by construction rather
   * than by a check somebody has to remember to make (AD-18). Joined in one round
   * trip for the reason `draftViewIn` is, and ordered by `ordinal` so every list
   * derived from it is in the order the child was shown the Questions.
   *
   * `tx` is required: both callers are inside a transaction — the submit path
   * reads this in the same transaction that closed the Attempt, and the retry path
   * opens its own — and a read of its own would be a second snapshot of rows the
   * caller is about to write against.
   *
   * `studentProfileId` is nullable because **either party reaches this**: the child
   * hands the work in under their own binding, and the parent reads the result of
   * it later under none. Null narrows to the account alone, which is still the
   * whole of what that party is entitled to; a profile id narrows further, so a
   * child's binding can never reach a sibling's Attempt.
   */
  async gradingInputFor(
    tx: TransactionClient,
    parentAccountId: string,
    studentProfileId: string | null,
    attemptId: string,
  ): Promise<AttemptGradingInput> {
    const attempt = await tx.attempt.findFirst({
      where: {
        id: attemptId,
        parentAccountId,
        ...(studentProfileId === null ? {} : { studentProfileId }),
      },
      select: { id: true, practiceTestId: true, expired: true, submittedAt: true },
    });
    // The one sentence a foreign, another profile's and an unknown id all share.
    if (attempt === null) throw new NotFoundException(PRACTICE_TEST_NOT_FOUND);

    const questions = await tx.practiceTestQuestion.findMany({
      where: { practiceTestId: attempt.practiceTestId },
      orderBy: { ordinal: 'asc' },
      select: {
        id: true,
        ordinal: true,
        format: true,
        prompt: true,
        answer: true,
        choices: { select: { ordinal: true, isCorrect: true }, orderBy: { ordinal: 'asc' } },
        topics: { select: { label: true }, orderBy: { label: 'asc' } },
        answers: {
          where: { attemptId: attempt.id },
          select: { value: true },
        },
      },
    });

    return {
      practiceTestId: attempt.practiceTestId,
      expired: attempt.expired,
      submittedAt: attempt.submittedAt,
      questions: questions.map((question) => ({
        questionId: question.id,
        ordinal: question.ordinal,
        format: question.format,
        // Checked rather than cast past `JsonValue`, and degraded rather than
        // thrown on, for the reason `landedPromptsFor` states: this read runs on
        // work already done — an Attempt that is already closed — so a row a
        // schema change left unreadable must not fail the hand-in. An empty
        // prompt or a null answer is a Question the grader can only leave
        // `Ungraded`, which is exactly what it is for.
        prompt: isRichText(question.prompt) ? (question.prompt as RichText) : [],
        answer: isRichText(question.answer) ? (question.answer as RichText) : null,
        correctChoiceOrdinal: question.choices.find((choice) => choice.isCorrect)?.ordinal ?? null,
        topics: question.topics.map((topic) => topic.label),
        // One row at most, by `answer_attemptId_questionId_key`. No row is a
        // Question the child left blank.
        answerValue: question.answers[0]?.value ?? null,
      })),
    };
  }

  /**
   * What canonicalizing and recomputing one Attempt's Topics needs: whose run it
   * is, which run it is, which Subject the canonical set is scoped by, and every
   * Question's raw labels.
   *
   * **It is not an ownership proof and does not pretend to be one.** There is no
   * account in the `where`, because every caller has already proved its entitlement
   * — the hand-in closed the Attempt under both binding ids, the results read and
   * the override both went through their own 404 first — and a second proof here
   * would be a second place that proof could disagree with itself. It refuses
   * nothing: an unknown id answers `null`, which the caller treats as nothing to
   * tag and nothing to recompute rather than as a refusal, because this read runs
   * beside work that is already committed and must never turn a committed hand-in
   * into a 500.
   *
   * `tx` is required, exactly as on `gradingInputFor`: every caller is inside a
   * transaction or is about to open one, and a read of its own would be a second
   * snapshot of rows the caller is writing against.
   *
   * The Subject arrives through `SOURCE_TEST_READER`, one batched call over one id,
   * because this module holds no `sourceTest` delegate and must not acquire one
   * (AD-17). The **id** and not the label: a canonical Topic set is keyed by
   * Subject, and a name is not a key.
   *
   * No grade, no answer, no score: none of those is a fact about which Topics a
   * paper is on.
   */
  async masteryContextFor(
    tx: TransactionClient,
    attemptId: string,
  ): Promise<AttemptMasteryContext | null> {
    const attempt = await tx.attempt.findUnique({
      where: { id: attemptId },
      select: {
        practiceTestId: true,
        studentProfileId: true,
        ordinal: true,
        practiceTest: { select: { sourceTestId: true } },
      },
    });
    if (attempt === null) return null;

    const subjectIds = await this.sourceTests.readSubjectIds([attempt.practiceTest.sourceTestId]);

    const questions = await tx.practiceTestQuestion.findMany({
      where: { practiceTestId: attempt.practiceTestId },
      orderBy: { ordinal: 'asc' },
      select: { id: true, topics: { select: { label: true }, orderBy: { label: 'asc' } } },
    });

    return {
      practiceTestId: attempt.practiceTestId,
      studentProfileId: attempt.studentProfileId,
      ordinal: attempt.ordinal,
      // Absent from the map — a Source Test this reader cannot see — is treated
      // exactly as an unclassified one: there is no Subject to scope a canonical set
      // by either way, and the caller's one log line says the same thing about both.
      subjectId: subjectIds.get(attempt.practiceTest.sourceTestId) ?? null,
      questions: questions.map((question) => ({
        questionId: question.id,
        labels: question.topics.map((topic) => topic.label),
      })),
    };
  }

  /**
   * Whose run one Attempt is, at which paper, and which run it is — and nothing else.
   *
   * **The recompute path's read, and deliberately not `masteryContextFor`.** It runs
   * inside the caller's open transaction, where that read would be two faults at once:
   * it resolves the Subject through `SOURCE_TEST_READER`, which runs on `sourcetest`'s
   * own client and so takes a **second pooled connection while this transaction holds
   * locks**, and it loads every Question of the paper with all of its labels. The
   * recompute needs neither — the Subject only scopes canonicalization, which happened
   * outside every transaction — so this is one statement on `attempt` and stops there.
   *
   * Not an ownership proof, for the reason `masteryContextFor` states: every caller has
   * already proved its entitlement, and an unknown id answers `null` rather than
   * refusing, because this runs beside work that is already committed.
   */
  async attemptMasteryKeyFor(
    tx: TransactionClient,
    attemptId: string,
  ): Promise<AttemptMasteryKey | null> {
    return tx.attempt.findUnique({
      where: { id: attemptId },
      select: { practiceTestId: true, studentProfileId: true, ordinal: true },
    });
  }

  /**
   * Every submitted Attempt of one child, newest first, for the Mastery window to
   * choose five from — **every** one of them, retakes included.
   *
   * Named for what it returns rather than for what its caller wants: which run counts
   * toward Mastery is `grading/mastery-eligibility.ts`'s one predicate, applied by
   * `grading` to the `ordinal` this hands over, so a name promising "qualifying" rows
   * would be a second, silent statement of that rule living in the wrong module.
   *
   * **`(submittedAt desc, id desc)` and never `submittedAt` alone.** The column is
   * `TIMESTAMP(3)`, so two Attempts handed in within the same millisecond tie — and
   * on a tie the order is Postgres's choice, which would make two recomputes over
   * identical rows answer differently. The id breaks it, exactly as
   * `topic.service.ts`'s candidate read does on `createdAt`.
   *
   * Open Attempts are filtered out here, in SQL, because "was it handed in" is a fact
   * about this module's own column. Which *run* counts is not: that is
   * `grading/mastery-eligibility.ts`'s one predicate, so the ordinal is returned
   * rather than compared, and the arrow stays `grading -> practicetest`.
   *
   * Uncapped deliberately. The window is five Attempts *that included the Topic*, and
   * which those are is not knowable from this table — so a `take` here would silently
   * hide a child's fractions history behind five recent papers about something else.
   * The rows are three columns each and one child's runs are tens of them.
   */
  async submittedAttemptsFor(
    tx: TransactionClient,
    studentProfileId: string,
  ): Promise<SubmittedAttemptRow[]> {
    const rows = await tx.attempt.findMany({
      where: { studentProfileId, submittedAt: { not: null } },
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      select: { id: true, practiceTestId: true, submittedAt: true, ordinal: true },
    });
    return rows.map((row) => ({
      attemptId: row.id,
      practiceTestId: row.practiceTestId,
      // Non-null by the `where` above. Asserted rather than defaulted: a default
      // would invent an instant the window would then order by.
      submittedAt: row.submittedAt as Date,
      ordinal: row.ordinal,
    }));
  }

  /**
   * One handed-in Attempt's answer key, as **the reader** needs it.
   *
   * The sibling of `gradingInputFor` and deliberately **not** that read widened.
   * They read the same rows and answer different questions: the grader needs the
   * raw typed string, the flagged *ordinal* and the Topic labels; the screen needs
   * words a child can read, and must never be one mapper away from a Topic label.
   * Keeping them apart is what makes "no Topic reaches a student response"
   * structural rather than remembered — the duplication here is a select shape,
   * not a rule. Merging them would put `topics` one `.map` from a student body.
   *
   * It **resolves the ordinal into words**. What the browser submits for a Multiple
   * Choice Question is the chosen option's ordinal as a string, and `2` is not an
   * answer anybody can read: so the stored option body travels instead, matched on
   * the trimmed digits-only ordinal. A value that is no ordinal of this Question —
   * which is a value the grader has already judged `Incorrect` — travels as the raw
   * stored string, because what the child actually put down is the one thing the
   * row must not invent.
   *
   * Found by the attempt id **and** both binding ids, and refused when
   * `submittedAt` is null: a foreign Attempt, a sibling's, an unknown id and one
   * still open all answer the one shared 404 by construction (AD-18). An open
   * Attempt has no answer key to read — the work is not in — and that is not a
   * different flavour of refusal.
   *
   * `studentProfileId` is nullable for the reason `gradingInputFor`'s is: the child
   * reads their own results under their binding, and the parent surface a later
   * story builds reads them under none, so neither needs a second read.
   *
   * The Attempt, its questions, their choices and this Attempt's answers are read
   * in **one transaction** in `ordinal` order, for the reason `draftViewIn` joins
   * in one round trip: a row-set assembled from two snapshots could answer with a
   * Question that had no place in the list it is being ordered into.
   *
   * The Subject label is resolved through `readSubjectLabels` exactly as
   * `releasedFor` does it. `practicetest` holds no `subject` delegate and must not
   * acquire one (AD-17), and a test whose Subject does not resolve keeps its place
   * and loses its label.
   *
   * Unreadable stored segments **degrade to null** rather than throwing, for the
   * reason `:1184` states: this read runs on work already done, so a row a schema
   * change left unreadable must not make a closed Attempt unreadable too. Only ids
   * are logged — never a prompt, an answer or an option body (AD-20).
   */
  async answerKeyFor(
    parentAccountId: string,
    studentProfileId: string | null,
    attemptId: string,
  ): Promise<AttemptAnswerKey> {
    return this.prisma.withTransaction(async (tx) => {
      const attempt = await tx.attempt.findFirst({
        where: {
          id: attemptId,
          parentAccountId,
          ...(studentProfileId === null ? {} : { studentProfileId }),
        },
        select: {
          id: true,
          practiceTestId: true,
          submittedAt: true,
          practiceTest: { select: { sourceTestId: true } },
        },
      });
      // The one sentence a foreign Attempt, a sibling's, an unknown id and an
      // Attempt still open all share.
      if (attempt === null || attempt.submittedAt === null) {
        throw new NotFoundException(PRACTICE_TEST_NOT_FOUND);
      }

      const questions = await tx.practiceTestQuestion.findMany({
        where: { practiceTestId: attempt.practiceTestId },
        orderBy: { ordinal: 'asc' },
        select: {
          id: true,
          ordinal: true,
          format: true,
          prompt: true,
          answer: true,
          // No `isCorrect`-only projection: the flagged option's *body* is what a
          // reader needs, and the ordinal the child chose has to be matched against
          // the same list.
          choices: {
            select: { ordinal: true, body: true, isCorrect: true },
            orderBy: { ordinal: 'asc' },
          },
          answers: { where: { attemptId: attempt.id }, select: { value: true } },
        },
      });

      // Batched across the module boundary, exactly as `releasedFor` does it. One
      // Attempt is one Practice Test, so this is one id — stated through the same
      // reader rather than through a delegate this module does not own (AD-17).
      const labels = await this.sourceTests.readSubjectLabels([attempt.practiceTest.sourceTestId]);

      const unreadable: string[] = [];
      const rows = questions.map((question) => {
        // One row at most, by `answer_attemptId_questionId_key`. No row is a
        // Question the child left blank, which is a null answer and never an empty
        // one — the blank is the fact, and `grading` is what says what it means.
        const value = question.answers[0]?.value ?? null;
        const correct = correctAnswerTextOf(question);
        const prompt = isRichText(question.prompt) ? (question.prompt as RichText) : null;
        const studentAnswer = studentAnswerTextOf(question, value);
        // Any of the three can independently fail to read back; the log below
        // exists to say how many rows degraded, not which field did.
        if (correct === null || prompt === null || (value !== null && studentAnswer === null)) {
          unreadable.push(question.id);
        }
        return {
          questionId: question.id,
          ordinal: question.ordinal,
          format: question.format,
          prompt,
          studentAnswer,
          correctAnswer: correct,
        };
      });
      if (unreadable.length > 0) {
        // Ids and a count. Never a prompt, an answer or an option body (AD-20).
        this.logger.warn(
          `The stored answer key of ${unreadable.length} question(s) of attempt ${attempt.id} could not be read back: ${unreadable.join(', ')}.`,
        );
      }

      return {
        attemptId: attempt.id,
        practiceTestId: attempt.practiceTestId,
        subjectName: labels.get(attempt.practiceTest.sourceTestId) ?? null,
        // The presented count, counted from the rows this read returned rather than
        // taken from the stored column: they are the Questions the results are
        // about, and one figure derived from two sources is two figures.
        questionCount: rows.length,
        questions: rows,
      };
    });
  }

  /**
   * Everything an Explanation is written from, for one Question of one handed-in
   * Attempt — in one read across the module boundary.
   *
   * **It exists so `explanation` holds no delegate of this module's.** That module
   * owns `Explanation` and nothing else (AD-17): no `practiceTest`, no `attempt`,
   * no `answer`, no `sourceTest` and no taxonomy. Everything it needs to build a
   * prompt is here, resolved once, by the module that owns the rows.
   *
   * Ownership is the same `where` `answerKeyFor` uses and refuses the same way: a
   * foreign Attempt, a sibling's, an unknown id and one still open all answer the
   * single `PRACTICE_TEST_NOT_FOUND` sentence by construction (AD-18). A
   * `questionId` that is not on that Attempt's Practice Test answers it too — an
   * alien Question is not a different flavour of refusal, and a second sentence
   * would let the outside tell a real Question of another test from one that never
   * existed.
   *
   * **`gradeLevelName` is the Practice Test's, never the child's.** It is resolved
   * from `practiceTest.sourceTest.gradeLevelId` through `readGradeLevelLabels`, for
   * the reason the Subject label is resolved through `readSubjectLabels`: the name
   * is `sourcetest`'s to give and this module must not acquire a taxonomy delegate.
   * `StudentProfile.gradeLevelId` is not read on this path at all — the register an
   * Explanation is pitched at is the grade of the paper that was sat, and a child
   * working a grade above or below their profile must be met where the paper is.
   *
   * Every text field is **plain text**, because it is going into a prompt. The
   * prompt is a string; carrying segments across this boundary only to flatten them
   * on the other side would put the flattening in the module that must not know how
   * a fraction is stored. An unreadable stored field degrades to an empty string
   * rather than throwing, for the reason `answerKeyFor`'s fields degrade to null:
   * this runs on work already done.
   */
  async explanationInputFor(
    parentAccountId: string,
    studentProfileId: string,
    attemptId: string,
    questionId: string,
  ): Promise<ExplanationInput> {
    const found = await this.prisma.withTransaction(async (tx) => {
      const attempt = await tx.attempt.findFirst({
        where: { id: attemptId, parentAccountId, studentProfileId },
        select: {
          id: true,
          practiceTestId: true,
          submittedAt: true,
          practiceTest: { select: { sourceTestId: true } },
        },
      });
      // The one sentence a foreign Attempt, a sibling's, an unknown id and an
      // Attempt still open all share.
      if (attempt === null || attempt.submittedAt === null) {
        throw new NotFoundException(PRACTICE_TEST_NOT_FOUND);
      }

      // Scoped by the Practice Test as well as by the id, so a real Question of
      // another test is as absent as one that never existed.
      const question = await tx.practiceTestQuestion.findFirst({
        where: { id: questionId, practiceTestId: attempt.practiceTestId },
        select: {
          id: true,
          ordinal: true,
          format: true,
          prompt: true,
          answer: true,
          choices: {
            select: { ordinal: true, body: true, isCorrect: true },
            orderBy: { ordinal: 'asc' },
          },
          answers: { where: { attemptId: attempt.id }, select: { value: true } },
        },
      });
      if (question === null) throw new NotFoundException(PRACTICE_TEST_NOT_FOUND);

      return { attempt, question };
    });

    // Outside the transaction, because it crosses a module boundary and resolves
    // through `admin`'s taxonomy: holding a transaction open across a call this
    // module does not control would pin a connection for the duration of somebody
    // else's read.
    const labels = await this.sourceTests.readGradeLevelLabels([
      found.attempt.practiceTest.sourceTestId,
    ]);

    const { question } = found;
    const value = question.answers[0]?.value ?? null;
    const prompt = isRichText(question.prompt) ? plainTextOf(question.prompt as RichText) : '';
    const correct = correctAnswerTextOf(question);
    const student = studentAnswerTextOf(question, value);

    return {
      practiceTestId: found.attempt.practiceTestId,
      ordinal: question.ordinal,
      format: question.format,
      prompt,
      // An empty string for a Question left blank: the prompt says in its own words
      // that a blank is a blank, and an invented answer would be an Explanation of
      // something the child never wrote.
      studentAnswer: student === null ? '' : plainTextOf(student),
      correctAnswer: correct === null ? '' : plainTextOf(correct),
      gradeLevelName: labels.get(found.attempt.practiceTest.sourceTestId) ?? null,
    };
  }

  /**
   * One draft, whole — every Question in stored order, each with its answer,
   * its options and its Topics.
   *
   * Nothing is paginated and nothing is collapsed: "every Question" is the
   * epic's acceptance criterion, and this is the read it is met by. The whole
   * draft is one round trip because the screen shows the whole draft.
   *
   * `Draft` is in the `where` beside the account, so a `Released` or
   * `Discarded` row answers the same 404 an unknown id and a foreign id get —
   * those are Story 4.5's states and Story 4.5's surface, and a differently
   * flavoured refusal here would be this module answering a question that story
   * has not been asked yet (AD-18).
   *
   * The stored `Json` travels out as it is stored. It was parsed by
   * `parseRichText` on the way in; re-parsing on the way out would be a second
   * chance for the two readings to disagree about a row neither of them wrote.
   *
   * The draft and its sibling count are read in **one transaction**, for the
   * reason `draftsFor` states: a sibling discarded between two separate reads
   * would head the screen "draft 2 of 1".
   */
  async draftFor(parentAccountId: string, practiceTestId: string): Promise<PracticeTestDraftView> {
    return this.prisma.withTransaction((tx) =>
      this.draftViewIn(tx, parentAccountId, practiceTestId),
    );
  }

  /**
   * The draft view, read inside whatever transaction the caller is in.
   *
   * One reader for the read and for both mutations, rather than a second mapper
   * written beside each write: an edit that answered with a differently-shaped
   * draft than the read does would put the screen's re-render and its first load
   * out of step on exactly the rows that were just changed.
   *
   * `Draft` is in the `where` beside the account, so a `Released`, `Discarded`,
   * foreign or unknown id all answer the same 404 **by construction** rather
   * than by a check somebody has to remember to make (AD-18).
   */
  private async draftViewIn(
    tx: TransactionClient,
    parentAccountId: string,
    practiceTestId: string,
  ): Promise<PracticeTestDraftView> {
    const draft = await tx.practiceTest.findFirst({
      where: { id: practiceTestId, parentAccountId, status: 'Draft' },
      select: DRAFT_SELECT,
    });
    // The one sentence all three refusals share. Nothing about the answer
    // says which of them it was. Thrown inside the transaction, which — on the
    // read path — reads and writes nothing there is anything to roll back.
    if (draft === null) throw new NotFoundException(PRACTICE_TEST_NOT_FOUND);

    const siblingCount = await tx.practiceTest.count({
      where: { parentAccountId, generationJobId: draft.generationJobId, status: 'Draft' },
    });
    return draftViewOf(draft, siblingCount);
  }

  /**
   * Rewrites one Question of a draft: its prompt, its free-text answer, its
   * option bodies, and which option is correct.
   *
   * The edited text **is** the Question. There is no second "original" column,
   * no revision history and no shadow copy: what is stored here is exactly what
   * the student will later be graded against, which is the whole reason a human
   * quality gate is worth having.
   *
   * Two things happen before a row is written. The plain text a parent typed
   * goes through `richTextFromPlainText` — the one inverse of `plainTextOf`
   * (AD-32) — so a fraction stays structure; and the *merged* result, stored
   * columns and edit together, goes through `validateEditedQuestion`, the same
   * invariants a generated payload satisfies. A Multiple Choice question that
   * would be left with no correct option is refused with the module's own
   * existing sentence, and nothing is written.
   *
   * `format` is not editable and Topics are not editable (AD-11, Epic 7), and
   * neither the Practice Test's `status` nor its `chargedAt` is touched: an
   * edit is not a transition and not a charge.
   */
  async editQuestion(
    parentAccountId: string,
    practiceTestId: string,
    questionId: string,
    input: EditQuestionInput,
  ): Promise<PracticeTestDraftView> {
    const view = await this.prisma.withTransaction(async (tx) => {
      const stored = await tx.practiceTestQuestion.findFirst({
        // The pair must match, and the Practice Test must be this account's own
        // draft: a valid question id belonging to a different Practice Test is
        // refused exactly as an unknown one is.
        where: {
          id: questionId,
          practiceTestId,
          practiceTest: { parentAccountId, status: 'Draft' },
        },
        select: {
          id: true,
          format: true,
          prompt: true,
          answer: true,
          choices: { orderBy: { ordinal: 'asc' }, select: { ordinal: true, body: true } },
        },
      });
      if (stored === null) throw new NotFoundException(PRACTICE_TEST_NOT_FOUND);

      const multipleChoice = stored.format === 'MultipleChoice';
      // Shape refusals that do not need the merged question to be built first,
      // in the module's own sentences rather than a new one each.
      if (multipleChoice && input.answer !== undefined) refuseEdit(ANSWER_FORBIDDEN);
      if (!multipleChoice && (input.choices !== undefined || input.correctOrdinal !== undefined)) {
        refuseEdit(CHOICES_FORBIDDEN);
      }

      const storedOrdinals = stored.choices.map((choice) => choice.ordinal);
      const bodies = new Map(input.choices?.map((choice) => [choice.ordinal, choice.body]) ?? []);
      // An edit that names an ordinal twice is a restatement that contradicts
      // itself; the Map would silently keep the last one.
      if (bodies.size !== (input.choices?.length ?? 0)) refuseEdit(CHOICES_MISMATCHED);

      const edited = validatedEdit(
        {
          format: stored.format,
          prompt: input.prompt === undefined ? storedRichText(stored.prompt) : parsed(input.prompt),
          answer: multipleChoice
            ? null
            : input.answer === undefined
              ? stored.answer === null
                ? null
                : storedRichText(stored.answer)
              : parsed(input.answer),
          choices: stored.choices.map((choice) => ({
            ordinal: choice.ordinal,
            body:
              bodies.get(choice.ordinal) === undefined
                ? storedRichText(choice.body)
                : parsed(bodies.get(choice.ordinal)!),
            // Absent `correctOrdinal` on a Multiple Choice edit leaves no
            // option flagged and is refused below: an edit of the options
            // states which one is right, rather than inheriting an answer that
            // may no longer belong to the body it was flagged on.
            isCorrect: choice.ordinal === input.correctOrdinal,
          })),
        },
        // Restated in full or not at all — but only when it was restated: an
        // edit that touches no option leaves every stored body where it is.
        input.choices === undefined ? storedOrdinals : [...bodies.keys()],
      );

      const writtenQuestion = await tx.practiceTestQuestion.updateMany({
        where: { id: stored.id },
        data: {
          prompt: edited.prompt,
          // `DbNull` rather than a bare `null`, for the reason `land` states:
          // on a nullable Json column Prisma refuses an ambiguous `null`.
          answer: edited.answer ?? Prisma.DbNull,
        },
      });
      // Deleted between the read above and this statement: the same 404 the
      // choices loop below gives a removed option, not Prisma's own fault.
      if (writtenQuestion.count !== 1) throw new NotFoundException(PRACTICE_TEST_NOT_FOUND);
      for (const choice of edited.choices) {
        const written = await tx.practiceTestChoice.updateMany({
          where: { questionId: stored.id, ordinal: choice.ordinal },
          data: { body: choice.body, isCorrect: choice.isCorrect },
        });
        // A row that was not there to write is an option removed between the
        // read above and this statement. Answering 200 on a write that landed
        // nowhere would tell a parent their option was rewritten when it was
        // not, so the whole edit rolls back on the module's one sentence.
        if (written.count !== 1) throw new NotFoundException(PRACTICE_TEST_NOT_FOUND);
      }

      return this.draftViewIn(tx, parentAccountId, practiceTestId);
    });

    // After the commit, never inside it: a log line written in the transaction
    // survives a rollback and would assert an edit that never landed.
    // Identifiers only — not a word of the prompt, the option or the Topic that
    // was just rewritten (AD-20).
    this.logger.log(`Practice test ${practiceTestId} had question ${questionId} edited.`);
    return view;
  }

  /**
   * Deletes one Question of a draft, renumbers what is left, and discards the
   * Practice Test when nothing is left at all.
   *
   * One transaction, and it has to be: the delete, the renumber and the
   * `questionCount` rewrite are one fact about the draft, and committing any
   * two of them without the third leaves the stored count disagreeing with the
   * list, or leaves a gap in the heading numbers a parent reads as a Question
   * that vanished.
   *
   * Deleting the **last** Question sets `Discarded` here and by no other path —
   * the acceptance criterion names it, and `Released` has no path in this story
   * at all. `chargedAt` is neither cleared nor rewritten: a discard does not
   * refund (AD-14).
   */
  async deleteQuestion(
    parentAccountId: string,
    practiceTestId: string,
    questionId: string,
  ): Promise<PracticeTestDraftView> {
    const { view, discarded } = await this.prisma.withTransaction(async (tx) => {
      const removed = await tx.practiceTestQuestion.deleteMany({
        where: {
          id: questionId,
          practiceTestId,
          practiceTest: { parentAccountId, status: 'Draft' },
        },
      });
      // Nothing removed is the one refusal every other id shape gets: an
      // unknown question, one of another draft, a released draft, a foreign
      // account (AD-18). Scoped inside the statement, never checked before it.
      if (removed.count !== 1) throw new NotFoundException(PRACTICE_TEST_NOT_FOUND);

      const survivors = await tx.practiceTestQuestion.findMany({
        where: { practiceTestId },
        orderBy: { ordinal: 'asc' },
        select: { id: true },
      });
      await this.rewriteQuestionOrdinals(
        tx,
        practiceTestId,
        survivors.map((question) => question.id),
      );

      await tx.practiceTest.update({
        where: { id: practiceTestId },
        data: {
          questionCount: survivors.length,
          // The last Question taken away leaves a Practice Test with nothing in
          // it, which is not a thing to release. `chargedAt` is absent on
          // purpose: a discard does not refund (AD-14).
          ...(survivors.length === 0 ? { status: 'Discarded' as PracticeTestStatus } : {}),
        },
        select: { id: true },
      });

      if (survivors.length > 0) {
        return {
          view: await this.draftViewIn(tx, parentAccountId, practiceTestId),
          discarded: false,
        };
      }

      // The draft is no longer a draft, so the `Draft`-scoped read above would
      // refuse it — correctly, and with the same sentence an unknown id gets.
      // The view is built here instead, carrying `status: 'Discarded'` and no
      // questions, because that is the honest answer to what just happened: the
      // screen reads the status and goes back to Pending drafts rather than
      // having to read a refusal as a success. A later read of the same id does
      // answer the ordinary 404, which is the acceptance criterion.
      const row = await tx.practiceTest.findFirst({
        where: { id: practiceTestId, parentAccountId },
        select: DRAFT_SELECT,
      });
      // The row this same transaction just discarded, gone by the time it is
      // read back: the module's one sentence, not Prisma's own missing-row fault.
      if (row === null) throw new NotFoundException(PRACTICE_TEST_NOT_FOUND);
      return {
        view: draftViewOf(
          row,
          await tx.practiceTest.count({
            where: { parentAccountId, generationJobId: row.generationJobId, status: 'Draft' },
          }),
        ),
        discarded: true,
      };
    });

    // Identifiers and counts. Never a word of what was deleted (AD-20).
    this.logger.log(
      discarded
        ? `Practice test ${practiceTestId} was discarded: its last question ${questionId} was deleted.`
        : `Practice test ${practiceTestId} had question ${questionId} deleted.`,
    );
    return view;
  }

  /**
   * Releases a draft: the gate opens, and the child it was made for can see it.
   *
   * One-way in v0. There is no route, flag or parameter anywhere that returns a
   * `Released` row to `Draft`, and the irreversibility is not a promise about
   * that — it is the `where` of the statement below. A second release matches no
   * row and answers the module's one sentence, indistinguishable from the answer
   * an unknown id, a foreign id or an already-discarded id gets (AD-18).
   *
   * `chargedAt` is untouched and no allowance figure is written: the derived
   * usage count counts rows that have *ever* reached draft, so neither
   * transition changes it (AD-14).
   */
  async release(parentAccountId: string, practiceTestId: string): Promise<PracticeTestDraftView> {
    return this.transitionTo(parentAccountId, practiceTestId, 'Released');
  }

  /**
   * Discards a draft: the child never sees it, and nothing downstream can reach
   * it.
   *
   * No refund (AD-14) — the confirmation said so in words before this was ever
   * called — and no `chargedAt` rewrite. Exclusion from Analytics is inherited
   * rather than implemented: `practicetest` owns these tables (AD-17) and the one
   * cross-boundary read of a Practice Test scopes `status: 'Released'`, so a
   * discarded row is unreachable rather than filtered.
   *
   * A `Released` row is refused here too: release is terminal, and discarding
   * something a child has already been shown is not a state this story owns.
   */
  async discard(parentAccountId: string, practiceTestId: string): Promise<PracticeTestDraftView> {
    return this.transitionTo(parentAccountId, practiceTestId, 'Discarded');
  }

  /**
   * Sets or clears the countdown a draft carries, in whole minutes.
   *
   * `null` turns it off, and is a restatement of the same configuration rather
   * than a different verb on a different resource — there is one duration and the
   * parent restates it whole. Nothing is stored on a parent's behalf: the
   * suggestion the screen pre-fills is carried on the view and never written
   * here, so a draft nobody configured stays `null`.
   *
   * `Draft` is in the `where`, exactly as it is for both transitions and both
   * 4.4 mutations. That is the released-state write barrier: a `Released` id, a
   * `Discarded` id, a foreign id and an unknown id all answer the module's one
   * sentence, so "editable up to release, never after" is a property of this
   * statement rather than a check a screen has to remember. A timer changed
   * after release would retroactively change how expiry graded past Attempts.
   *
   * Not a transition and not a charge: `status` and `chargedAt` are untouched
   * (AD-14), and the derived allowance count is unaffected. The bounds are the
   * DTO's — a figure outside them never reaches here.
   */
  async setTimer(
    parentAccountId: string,
    practiceTestId: string,
    minutes: number | null,
  ): Promise<PracticeTestDraftView> {
    const view = await this.prisma.withTransaction(async (tx) => {
      // `updateMany` with the state in the `where`, not `update` after a check: a
      // row released by another tab between a read and this statement would make
      // the check stale, and `update` would surface Prisma's own missing-row
      // fault as a 500 rather than as this module's own answer.
      const set = await tx.practiceTest.updateMany({
        where: { id: practiceTestId, parentAccountId, status: 'Draft' },
        // `status` and `chargedAt` absent on purpose: configuring a timer is
        // neither a transition nor a charge.
        data: { timerMinutes: minutes },
      });
      if (set.count !== 1) throw new NotFoundException(PRACTICE_TEST_NOT_FOUND);
      // Still a draft, so the ordinary reader serves the answer — the whole view,
      // as every other mutation in this module answers with, and no second
      // mapper of its own.
      return this.draftViewIn(tx, parentAccountId, practiceTestId);
    });

    // After the commit, never inside it: a log line written in the transaction
    // survives a rollback and would assert a configuration that never landed.
    // Identifiers and the minute figure only — no Question text, no Topic label,
    // no allowance figure, no tier, no model name (AD-20).
    this.logger.log(
      minutes === null
        ? `Practice test ${practiceTestId} had its timer turned off.`
        : `Practice test ${practiceTestId} had its timer set to ${minutes} minutes.`,
    );
    return view;
  }

  /**
   * The one shape both terminal transitions have, written once.
   *
   * `updateMany` with the state in the `where`, and not `update` after a check: a
   * row released by another tab between a read and this statement would make the
   * check stale, and `update` would surface Prisma's own missing-row fault as a
   * 500 rather than as this module's own answer.
   *
   * The answer is the full draft view carrying the **new** status, built here
   * exactly as `deleteQuestion`'s discard branch already builds it for a row that
   * is no longer a draft — the screen reads the status rather than inferring
   * success from a bare 204.
   */
  private async transitionTo(
    parentAccountId: string,
    practiceTestId: string,
    to: Extract<PracticeTestStatus, 'Released' | 'Discarded'>,
  ): Promise<PracticeTestDraftView> {
    const view = await this.prisma.withTransaction(async (tx) => {
      const moved = await tx.practiceTest.updateMany({
        where: { id: practiceTestId, parentAccountId, status: 'Draft' },
        // `chargedAt` is absent on purpose: neither transition refunds (AD-14).
        data: { status: to },
      });
      // Not a draft any more is indistinguishable from never having been this
      // account's, which is the whole point: a second sentence for one rule
      // would let the outside enumerate which of another account's ids exist.
      if (moved.count !== 1) throw new NotFoundException(PRACTICE_TEST_NOT_FOUND);

      // The row is no longer a draft, so the `Draft`-scoped reader would refuse
      // it — correctly. The view is built here instead, as `deleteQuestion`'s
      // discard branch already does.
      const row = await tx.practiceTest.findFirst({
        where: { id: practiceTestId, parentAccountId },
        select: DRAFT_SELECT,
      });
      // The row this same transaction just moved, gone by the time it is read
      // back: the module's one sentence, not Prisma's own missing-row fault.
      if (row === null) throw new NotFoundException(PRACTICE_TEST_NOT_FOUND);
      return draftViewOf(
        row,
        await tx.practiceTest.count({
          where: { parentAccountId, generationJobId: row.generationJobId, status: 'Draft' },
        }),
      );
    });

    // After the commit, never inside it: a log line written in the transaction
    // survives a rollback and would assert a transition that never landed.
    // Identifiers only — no Question text, no Topic label, no allowance figure,
    // no tier, no model name (AD-20).
    this.logger.log(
      to === 'Released'
        ? `Practice test ${practiceTestId} was released.`
        : `Practice test ${practiceTestId} was discarded.`,
    );
    return view;
  }

  /**
   * The two-phase ordinal rewrite `@@unique([practiceTestId, ordinal])` forces,
   * exactly as `source-test.service.ts` does it for pages.
   *
   * A straight rewrite collides mid-statement — moving question 3 to 2 hits the
   * row still sitting at 2 — so every ordinal is first moved out of the
   * positive range in one statement, then written back as `1..N`. Both phases
   * are inside the caller's transaction, so no other reader ever observes the
   * negative interval and the contiguity invariant holds at every committed
   * boundary.
   */
  private async rewriteQuestionOrdinals(
    tx: TransactionClient,
    practiceTestId: string,
    orderedIds: readonly string[],
  ): Promise<void> {
    if (orderedIds.length === 0) return;
    await tx.$executeRaw`UPDATE "practice_test_question" SET "ordinal" = -"ordinal" WHERE "practiceTestId" = ${practiceTestId}`;
    for (const { id, ordinal } of renumbered(orderedIds)) {
      // `updateMany`, not `update`: a row removed between the read above and
      // this statement would make `update` throw Prisma's missing-row fault,
      // which would escape as a 500 rather than as this module's own answer.
      await tx.practiceTestQuestion.updateMany({
        where: { id, practiceTestId },
        data: { ordinal },
      });
    }
  }

  /**
   * Takes the oldest claimable job, or nothing.
   *
   * `FOR UPDATE SKIP LOCKED` is the whole of the concurrency control, exactly
   * as it is for extraction: two workers running the same pass at the same
   * instant cannot both take the same row, and the loser skips it rather than
   * blocking on it.
   */
  async claimNext(): Promise<ClaimedGenerationJob | null> {
    const staleBefore = new Date(Date.now() - claimTimeoutMs());
    return this.prisma.withTransaction(async (tx) => {
      // A job that has used every attempt is given up on, once, before anything
      // claims it again. Whatever it produced stays produced and stays charged
      // — that is what `PartiallyComplete` is for.
      const exhausted = await tx.generationJob.findMany({
        where: {
          status: 'Running',
          lockedAt: { lte: staleBefore },
          attempts: { gte: MAX_JOB_ATTEMPTS },
        },
        select: { id: true, producedCount: true },
      });
      for (const job of exhausted) {
        await tx.generationJob.updateMany({
          where: { id: job.id, status: 'Running' },
          data: {
            status: job.producedCount > 0 ? 'PartiallyComplete' : 'Failed',
            lockedAt: null,
            failureKind: 'UpstreamFault',
            failureReason: GENERATION_FAILED,
            // Not retryable by the worker: it has already tried. A parent
            // asking again is a new request and a new job.
            retryable: false,
            completedAt: new Date(),
          },
        });
      }

      // The comparison is against the enum type rather than a cast to text, so
      // `@@index([status, createdAt])` is actually usable: under `FOR UPDATE
      // SKIP LOCKED` a sequential scan locks its way through the table.
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "generation_job"
        WHERE "attempts" < ${MAX_JOB_ATTEMPTS}
          AND ("status" = 'Queued'::"generation_job_status"
            OR ("status" = 'Running'::"generation_job_status"
                AND "lockedAt" IS NOT NULL
                AND "lockedAt" <= ${staleBefore}))
        ORDER BY "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;
      const id = rows[0]?.id;
      if (id === undefined) return null;
      return tx.generationJob.update({
        where: { id },
        data: { status: 'Running', lockedAt: new Date(), attempts: { increment: 1 } },
        select: {
          id: true,
          parentAccountId: true,
          sourceTestId: true,
          studentProfileId: true,
          requestedCount: true,
          producedCount: true,
          attempts: true,
          weightedTopic: true,
        },
      });
    });
  }

  /**
   * Produces the drafts this job still owes, one AI call and one committed
   * transaction each.
   *
   * Never throws: a worker loop that has to catch is a worker loop that will
   * one day fail to, and a job whose failure escaped is a job that stays
   * `Running` until its claim expires.
   *
   * It resumes from `producedCount` rather than starting over, which is what
   * makes a reclaimed job finish the request instead of charging for it twice.
   */
  async runJob(job: ClaimedGenerationJob): Promise<void> {
    let produced = job.producedCount;
    try {
      const extraction = await this.extraction.readForGeneration(job.sourceTestId);
      if (extraction === null) throw new GenerationTargetMissing(true);
      if (extraction.questions.length === 0) throw new GenerationTargetMissing(false);

      const plan = planFor(extraction, job.weightedTopic);
      // Seeded with the source's own prompts, then grown with everything this
      // job has landed — including drafts a previous pass of the same job
      // landed, which is why it is read from the rows rather than kept in
      // memory. Plain text only; it never leaves this method.
      const landedPrompts = await this.landedPromptsFor(job.id);

      while (produced < job.requestedCount) {
        const draftOrdinal = produced + 1;
        const draft = await this.produceDraft(job, draftOrdinal, plan, extraction, landedPrompts);
        await this.land(job, draftOrdinal, draft);
        produced = draftOrdinal;
        for (const question of draft.questions) {
          landedPrompts.push(plainTextOf(question.prompt));
        }
      }

      await this.complete(job, produced);
    } catch (cause) {
      await this.fail(job, cause, produced);
    }
  }

  // --- Internals ---------------------------------------------------------

  /**
   * One draft: the provider call, then the deterministic pass, re-issued while
   * the pass keeps rejecting what came back.
   *
   * The retry is the point. A post-hoc rejection — a MultipleChoice question
   * with no correct option, a prompt that reproduces a source question — is the
   * provider's fault (AD-31): the model was asked for a shape and answered with
   * another. `AiService`'s own loop cannot see it, because the payload parsed
   * and the call returned, so without this the first malformed answer would
   * fail the parent's whole request on one bad roll of the dice.
   *
   * Bounded by `AI_MAX_ATTEMPTS`, the same figure `AiService` retries transport
   * faults under, so one draft's worst case is the figure the claim-timeout
   * invariant in `practice-test-policy.ts` is already computed against. On
   * exhaustion the last rejection is rethrown and `fail` treats it exactly as
   * it treats any other upstream fault.
   */
  private async produceDraft(
    job: ClaimedGenerationJob,
    draftOrdinal: number,
    plan: GenerationPlan,
    extraction: ExtractionForGeneration,
    landedPrompts: readonly string[],
  ): Promise<NormalizedPracticeTest> {
    const forbiddenPrompts = new Set([
      ...plan.sourcePrompts,
      ...landedPrompts.map((text) => normalizePrompt(text)),
    ]);
    const maxAttempts = this.ai.config.maxAttempts;
    let lastRejection: GenerationPayloadInvalid | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      // Before the call, not only before the write: a pass whose claim expired
      // can never land anything, so every provider call it goes on to make is
      // money spent on a draft that is guaranteed to be rolled back. The check
      // is one indexed count against the row this pass claimed.
      await this.requireFence(job);

      const { payload } = await this.ai.run({
        callClass: 'Generation',
        parentAccountId: job.parentAccountId,
        // Text in, text out: this call reads the persisted Extraction, never
        // a photograph. Stated rather than inferred from an empty array.
        modality: 'text',
        images: [],
        prompt: buildGenerationPrompt({
          sourceQuestions: extraction.questions,
          targets: plan.targets,
          topics: plan.topics,
          weighting: plan.weighting,
          alreadyGenerated: landedPrompts,
        }),
        schema: PracticeTestPayload,
        schemaName: PRACTICE_TEST_SCHEMA_NAME,
        fakePayload: ({ failure }) =>
          fakePracticeTestPayload({
            targets: plan.fakeTargets,
            topics: plan.topics,
            weighting: plan.weighting,
            draftOrdinal,
            failure,
          }),
      });

      try {
        return validateGenerationPayload(payload, {
          targets: plan.targets,
          forbiddenPrompts,
          weighting: plan.weighting,
        });
      } catch (cause) {
        // Only a post-hoc rejection is worth asking again for. Anything else
        // is this module's own fault and is not made better by repetition.
        if (!(cause instanceof GenerationPayloadInvalid)) throw cause;
        lastRejection = cause;
        // The job, the draft and the attempt number. Never the rule that was
        // broken in the model's own words, and never a fragment of what it
        // wrote (AD-20).
        this.logger.warn(
          `Generation job ${job.id} draft ${draftOrdinal} was rejected after parsing on attempt ${attempt} of ${maxAttempts}.`,
        );
      }
    }
    throw lastRejection!;
  }

  /**
   * Asserts this pass still holds the claim it was handed, and throws if not.
   *
   * The same three columns `land` fences on, read rather than written, so the
   * fence can be checked at a point where there is nothing to roll back.
   */
  private async requireFence(job: ClaimedGenerationJob): Promise<void> {
    const held = await this.prisma.generationJob.count({
      where: { id: job.id, status: 'Running', attempts: job.attempts },
    });
    if (held !== 1) throw new GenerationFenced();
  }

  /** Plain text of every prompt this job has already landed, oldest first. */
  private async landedPromptsFor(generationJobId: string): Promise<string[]> {
    const questions = await this.prisma.practiceTestQuestion.findMany({
      where: { practiceTest: { generationJobId } },
      orderBy: [{ practiceTest: { ordinal: 'asc' } }, { ordinal: 'asc' }],
      select: { prompt: true },
    });
    const prompts: string[] = [];
    for (const question of questions) {
      // Checked, never cast past `JsonValue`. A row written before a schema
      // change would otherwise throw here — and this runs *after* drafts have
      // landed and been charged, so a throw would fail a job whose spent money
      // is already spent. A prompt this cannot read is dropped from the
      // must-differ list instead, which costs a little material difference and
      // keeps the run alive.
      if (isRichText(question.prompt)) {
        prompts.push(plainTextOf(question.prompt as RichText));
        continue;
      }
      this.logger.warn(
        `Generation job ${generationJobId} holds a question whose prompt could not be read back; it is not in the must-differ list.`,
      );
    }
    return prompts;
  }

  /**
   * One draft and its charge, in one transaction.
   *
   * The fence is the whole reason this is a transaction at all. A pass that
   * took longer than its claim timeout comes back to a job somebody else has
   * since reclaimed, and writing a draft against it would charge the account
   * for work another pass is also producing. `attempts` is the value this pass
   * claimed with, so matching it is matching this pass; failing the match
   * throws, and the draft and its `chargedAt` roll back together.
   */
  private async land(
    job: ClaimedGenerationJob,
    ordinal: number,
    draft: NormalizedPracticeTest,
  ): Promise<void> {
    // Re-read rather than computed once at the top of the run: a job may span a
    // period boundary, and the charge belongs to the window the draft actually
    // landed in, not the one the request was made in. Both the window and the
    // charge are derived from the same instant so a period boundary crossing
    // the gap between two separate clock reads can never manufacture a false
    // anomaly.
    const chargedAt = new Date();
    const window = await this.allowance.windowFor(job.parentAccountId, chargedAt);
    if (chargedAt < window.start || chargedAt >= window.end) {
      // The window is computed from this instant, so this cannot happen without
      // a clock or zone anomaly. Refusing beats writing a charge that no period
      // would ever count — and refusing *terminally*, because a retry would be
      // run against the same broken clock and would spend another provider
      // call to reach the same impossible arithmetic.
      throw new GenerationClockAnomaly();
    }

    // Row ids are minted here rather than by the database, which is what lets
    // every level go in as one `createMany`: a choice needs its question's id,
    // and waiting for each parent's returned id turns a forty-question draft
    // into eighty sequential round trips inside one transaction.
    const practiceTestId = randomUUID();
    const questionIds = draft.questions.map(() => randomUUID());

    await this.prisma.withTransaction(
      async (tx) => {
        await tx.practiceTest.create({
          data: {
            id: practiceTestId,
            parentAccountId: job.parentAccountId,
            sourceTestId: job.sourceTestId,
            studentProfileId: job.studentProfileId,
            generationJobId: job.id,
            ordinal,
            questionCount: draft.questions.length,
            // The durable marker the Generation Allowance is counted from
            // (AD-14). Written once, here, and never rewritten: a Practice Test
            // charges on first reaching draft and never again.
            chargedAt,
          },
          select: { id: true },
        });

        await tx.practiceTestQuestion.createMany({
          data: draft.questions.map((question, index) => ({
            id: questionIds[index]!,
            practiceTestId,
            ordinal: question.ordinal,
            format: question.format,
            prompt: question.prompt,
            // `DbNull` rather than a bare `null`: on a nullable Json column
            // Prisma reads `null` as ambiguous between "the SQL NULL" and "the
            // JSON value null", and refuses it outright. A MultipleChoice
            // question's answer is the flagged option, so the column is SQL
            // NULL and says so.
            answer: question.answer ?? Prisma.DbNull,
          })),
        });

        await tx.practiceTestChoice.createMany({
          data: draft.questions.flatMap((question, index) =>
            question.choices.map((choice) => ({
              questionId: questionIds[index]!,
              ordinal: choice.ordinal,
              body: choice.body,
              isCorrect: choice.isCorrect,
            })),
          ),
        });

        await tx.practiceTestQuestionTopic.createMany({
          // Raw, as written. Canonicalization is Epic 7's (AD-11).
          data: draft.questions.flatMap((question, index) =>
            question.topics.map((label) => ({ questionId: questionIds[index]!, label })),
          ),
        });

        const fenced = await tx.generationJob.updateMany({
          where: { id: job.id, status: 'Running', attempts: job.attempts },
          data: { producedCount: { increment: 1 } },
        });
        if (fenced.count !== 1) throw new GenerationFenced();
      },
      { timeout: LAND_TIMEOUT_MS, maxWait: LAND_MAX_WAIT_MS },
    );

    // Identifiers and counts. Not a word of what was written (AD-20).
    this.logger.log(
      `Generation job ${job.id} landed draft ${ordinal} of ${job.requestedCount} with ${draft.questions.length} questions.`,
    );
  }

  /** The job's success, behind the same fence every terminal write uses. */
  private async complete(job: ClaimedGenerationJob, produced: number): Promise<void> {
    const written = await this.prisma.generationJob.updateMany({
      where: { id: job.id, status: 'Running', attempts: job.attempts },
      data: {
        status: 'Succeeded',
        lockedAt: null,
        failureKind: null,
        failureReason: null,
        retryable: false,
        completedAt: new Date(),
      },
    });
    if (written.count !== 1) {
      this.logger.warn(`Generation job ${job.id} finished, but its row had already moved on.`);
      return;
    }
    this.logger.log(`Generation job ${job.id} succeeded with ${produced} drafts.`);
  }

  /**
   * Fails the job, saying whose fault it was and keeping what landed (AD-31).
   *
   * The classification is exactly `extraction.service.ts`'s, because it is the
   * same distinction: an upstream fault — transport, timeout, schema-invalid
   * payload, post-hoc violation — is retryable, and a client fault is not.
   *
   * What differs is the terminal status. A job that produced nothing failed; a
   * job that produced something is `PartiallyComplete`, and its drafts stay
   * committed and stay charged. Collapsing the two would misreport what the
   * parent was charged, which is the one thing this story may not get wrong.
   *
   * The reason written is a **constant** from this module's policy file, never
   * the message an exception arrived with: a provider string could carry a
   * fragment of what it wrote (AD-20).
   */
  private async fail(job: ClaimedGenerationJob, cause: unknown, produced: number): Promise<void> {
    // Superseded, not failed. Whatever moved the job row on is the run whose
    // verdict should stand, and this pass has already rolled back the one draft
    // it was mid-way through.
    if (cause instanceof GenerationFenced) {
      this.logger.warn(
        `Generation job ${job.id} was superseded mid-run; ${produced} drafts had already landed and stay charged.`,
      );
      return;
    }

    const targetMissing = cause instanceof GenerationTargetMissing;
    // The input's fault, and the only branch that asks a parent to do
    // something: the Extraction held nothing usable by the time the job ran.
    const unusable = targetMissing && !(cause as GenerationTargetMissing).gone;
    // This service asked for a call it cannot make. Also terminal, but never
    // the sentence above: the pages were fine, and telling a parent to
    // photograph them again would send them to do work that cannot help.
    const requestRejected = cause instanceof AiInputError;
    // A clock or zone anomaly on this machine. Terminal for its own reason.
    const clockAnomaly = cause instanceof GenerationClockAnomaly;
    const clientFault = targetMissing || requestRejected;

    // A provider that refused the request outright — a bad key, a model this
    // account cannot use — is upstream, but retrying it buys the same refusal.
    const refused = cause instanceof AiRejectedError;

    const failureKind: AiFailureKind = clientFault ? 'ClientFault' : 'UpstreamFault';

    if (
      !clientFault &&
      !refused &&
      !clockAnomaly &&
      !(cause instanceof AiUpstreamError) &&
      !(cause instanceof GenerationPayloadInvalid)
    ) {
      // Something this module did not anticipate. Reported as upstream so the
      // job is retryable, and named by its error class alone so the fault is
      // findable without a message that might carry content.
      this.logger.error(
        `Generation job ${job.id} failed unexpectedly: ${(cause as Error)?.name ?? 'unknown'}.`,
      );
    }

    const status: GenerationJobStatus = produced > 0 ? 'PartiallyComplete' : 'Failed';
    const written = await this.prisma.generationJob.updateMany({
      where: { id: job.id, status: 'Running', attempts: job.attempts },
      data: {
        status,
        lockedAt: null,
        failureKind,
        failureReason:
          targetMissing && (cause as GenerationTargetMissing).gone
            ? GENERATION_SOURCE_GONE
            : unusable
              ? GENERATION_INPUT_UNUSABLE
              : requestRejected
                ? GENERATION_REQUEST_REJECTED
                : clockAnomaly
                  ? GENERATION_CLOCK_ANOMALY
                  : refused
                    ? GENERATION_UPSTREAM_REJECTED
                    : GENERATION_FAILED,
        // A clock anomaly is nobody's *input* and nobody's provider, but the
        // enum has two values and this is not the parent's upload at fault, so
        // it is reported upstream — and, like a refusal, never retryable.
        retryable: !clientFault && !refused && !clockAnomaly,
        completedAt: new Date(),
      },
    });
    if (written.count !== 1) {
      this.logger.warn(`Generation job ${job.id} failed, but its row had already moved on.`);
      return;
    }
    this.logger.warn(`Generation job ${job.id} ended ${status} (${failureKind}) with ${produced}.`);
  }
}

/** The columns every job view is built from, selected in one place. */
const JOB_VIEW_FIELDS = {
  id: true,
  status: true,
  requestedCount: true,
  weightedTopic: true,
  producedCount: true,
  completedAt: true,
  failureKind: true,
  failureReason: true,
  retryable: true,
} as const;

interface JobRow {
  id: string;
  status: GenerationJobStatus;
  requestedCount: number;
  weightedTopic: string | null;
  producedCount: number;
  completedAt: Date | null;
  failureKind: AiFailureKind | null;
  failureReason: string | null;
  retryable: boolean;
}

function viewOf(job: JobRow): GenerationJobView {
  return {
    id: job.id,
    status: job.status,
    requestedCount: job.requestedCount,
    weightedTopic: job.weightedTopic,
    producedCount: job.producedCount,
    completedAt: job.completedAt?.toISOString() ?? null,
    failureKind: job.failureKind,
    failureReason: job.failureReason,
    retryable: job.retryable,
  };
}

/**
 * A stored rich-text column, on its way back out.
 *
 * A cast and nothing else, deliberately. Every one of these columns went
 * through `parseRichText` before it was written (AD-32, AD-30), so the shape is
 * already an invariant of the row; re-parsing here would be a second reading of
 * a value neither reading wrote, and a second place for the two to disagree.
 * The cast is named rather than sprinkled so there is exactly one line in the
 * module that asserts it.
 */
function storedRichText(value: Prisma.JsonValue): RichText {
  return value as unknown as RichText;
}

/**
 * Everything the Take Test screen reads a released Practice Test by, written
 * **from scratch**.
 *
 * Deliberately not derived from `DRAFT_SELECT` — not by spread, not by `Omit`,
 * not by deleting keys. `DRAFT_SELECT` selects `answer` and `isCorrect`, and
 * deriving from it would make the absence of the answer key a subtraction
 * somebody has to keep performing correctly on every later edit. Written as its
 * own literal, the answer key is an *addition* nobody can forget: a column that
 * is not named here cannot reach a child however the mapper below changes.
 *
 * No `answer`, no `isCorrect`, no `topics`, no `status`, no `timerMinutes`, no
 * `chargedAt` (AD-20, AD-26). Questions and choices are ordered explicitly, so
 * the order the child works in is the stored one rather than whatever the
 * planner returned.
 */
const STUDENT_TEST_SELECT = {
  id: true,
  questionCount: true,
  questions: {
    orderBy: { ordinal: 'asc' },
    select: {
      id: true,
      ordinal: true,
      format: true,
      prompt: true,
      choices: {
        orderBy: { ordinal: 'asc' },
        select: { ordinal: true, body: true },
      },
    },
  },
} as const satisfies Prisma.PracticeTestSelect;

type StudentTestRow = Prisma.PracticeTestGetPayload<{ select: typeof STUDENT_TEST_SELECT }>;

/**
 * The released Practice Test as the child's screen reads it.
 *
 * The stored `Json` travels out as it is stored, for the reason `draftViewOf`
 * gives: it was parsed on the way in, and a second parse is a second chance for
 * the two readings to disagree.
 */
/**
 * A unique-index violation: something landed concurrently, which is not a fault.
 *
 * The same predicate `uncommitted-state.service.ts` holds, restated here rather than
 * shared across a module boundary this service does not otherwise cross.
 */
function isUniqueViolation(cause: unknown): boolean {
  return cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2002';
}

function studentTestViewOf(test: StudentTestRow): StudentPracticeTestView {
  return {
    id: test.id,
    questionCount: test.questionCount,
    questions: test.questions.map((question) => ({
      id: question.id,
      ordinal: question.ordinal,
      format: question.format,
      prompt: storedRichText(question.prompt),
      choices: question.choices.map((choice) => ({
        ordinal: choice.ordinal,
        body: storedRichText(choice.body),
      })),
    })),
  };
}

/**
 * Everything an Attempt is read by, on both routes.
 *
 * Five columns and no more. `parentAccountId` and `studentProfileId` are
 * deliberately **not** selected: they were in the `where` of the statement that
 * found the row, so they are already known to the caller that asked, and putting
 * them on the wire would tell a child an id they never addressed. No
 * `timerMinutes` either — the deadline already expresses the duration, and the
 * duration is the parent's configuration rather than a student-scoped fact.
 */
const ATTEMPT_SELECT = {
  id: true,
  practiceTestId: true,
  startedAt: true,
  expiresAt: true,
  submittedAt: true,
} as const satisfies Prisma.AttemptSelect;

type AttemptRow = Prisma.AttemptGetPayload<{ select: typeof ATTEMPT_SELECT }>;

/**
 * The Attempt as the Take Test screen reads it, with the server's own clock
 * stamped on the way out.
 *
 * `serverNow` is read here rather than inside the transaction on purpose: it is
 * what the browser measures its offset against, so the closer it sits to the
 * response the smaller the offset's error. It is not a deadline and decides
 * nothing — the only clock that decides anything is the one `submitAttempt`
 * reads, against the stored column.
 */
function attemptViewOf(attempt: AttemptRow, serverNow: Date): AttemptView {
  return {
    id: attempt.id,
    practiceTestId: attempt.practiceTestId,
    startedAt: attempt.startedAt.toISOString(),
    expiresAt: attempt.expiresAt === null ? null : attempt.expiresAt.toISOString(),
    serverNow: serverNow.toISOString(),
    submittedAt: attempt.submittedAt === null ? null : attempt.submittedAt.toISOString(),
  };
}

/**
 * Everything the review screen reads a draft by, selected in one place.
 *
 * One `select` for the read and for both mutations, so an edit's answer and a
 * first load are the same shape by construction rather than by two lists being
 * kept in step by hand.
 */
const DRAFT_SELECT = {
  id: true,
  sourceTestId: true,
  studentProfileId: true,
  status: true,
  generationJobId: true,
  ordinal: true,
  questionCount: true,
  timerMinutes: true,
  createdAt: true,
  questions: {
    orderBy: { ordinal: 'asc' },
    select: {
      id: true,
      ordinal: true,
      format: true,
      prompt: true,
      answer: true,
      choices: {
        orderBy: { ordinal: 'asc' },
        select: { ordinal: true, body: true, isCorrect: true },
      },
      topics: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { label: true },
      },
    },
  },
} as const satisfies Prisma.PracticeTestSelect;

type DraftRow = Prisma.PracticeTestGetPayload<{ select: typeof DRAFT_SELECT }>;

/**
 * The stored draft as the screen reads it.
 *
 * The stored `Json` travels out as it is stored. It was parsed by
 * `parseRichText` on the way in — by generation, or by the edit path's single
 * inverse — and re-parsing on the way out would be a second chance for the two
 * readings to disagree about a row neither of them wrote.
 */
function draftViewOf(draft: DraftRow, siblingCount: number): PracticeTestDraftView {
  return {
    id: draft.id,
    sourceTestId: draft.sourceTestId,
    studentProfileId: draft.studentProfileId,
    status: draft.status,
    ordinal: draft.ordinal,
    siblingCount,
    questionCount: draft.questionCount,
    timerMinutes: draft.timerMinutes,
    // Derived from the *stored* count on every read, so a deleted Question moves
    // the suggestion with it — and never stored, so showing it configures
    // nothing.
    suggestedTimerMinutes: suggestedTimerMinutes(draft.questionCount),
    createdAt: draft.createdAt.toISOString(),
    questions: draft.questions.map((question) => ({
      id: question.id,
      ordinal: question.ordinal,
      format: question.format,
      prompt: storedRichText(question.prompt),
      // A MultipleChoice question's column is SQL NULL, and Prisma reads it
      // back as `null` — the flagged choice is the answer.
      answer: question.answer === null ? null : storedRichText(question.answer),
      choices: question.choices.map((choice) => ({
        ordinal: choice.ordinal,
        body: storedRichText(choice.body),
        isCorrect: choice.isCorrect,
      })),
      topics: question.topics.map((topic) => topic.label),
    })),
  };
}

/**
 * One edit's whole payload, as the controller hands it over: plain text, and
 * nothing already turned into segments.
 *
 * Every field is optional and an absent field means "leave what is stored",
 * which is what makes editing one option body a one-field request rather than a
 * restatement of the whole Question.
 *
 * **One exception, and it is deliberate.** A Multiple Choice edit must always
 * restate `correctOrdinal`: an absent one leaves no option flagged and is
 * refused `ONE_CORRECT_CHOICE_REQUIRED`. Inheriting the stored flag would mean
 * an edit that rewrote the option bodies could silently leave "correct" on a
 * body that no longer says what it said when it was flagged.
 */
export interface EditQuestionInput {
  prompt?: string;
  answer?: string;
  choices?: { ordinal: number; body: string }[];
  correctOrdinal?: number;
}

/** A fixed sentence of this module's own, as the 400 a parent's edit gets. */
function refuseEdit(message: string): never {
  throw new BadRequestException(message);
}

/**
 * Plain text as the segments it will be stored as (AD-32).
 *
 * An empty field, a whitespace-only field and a zero denominator all throw out
 * of `parseRichText`, and each is a thing a parent typed rather than a fault of
 * this server — so each becomes a 400 carrying the rich-text module's own
 * sentence, and nothing is written.
 */
function parsed(text: string): RichText {
  try {
    return richTextFromPlainText(text);
  } catch (cause) {
    throw new BadRequestException(cause instanceof Error ? cause.message : RICH_TEXT_EMPTY);
  }
}

/**
 * The shared Question invariants, answered as the 400 an edit gets.
 *
 * The rules are the payload module's — one set for a generated payload and a
 * parent edit alike — and only the *fault* differs: nothing here is retried,
 * because no provider is at fault.
 */
function validatedEdit(edited: EditedQuestion, storedOrdinals: readonly number[]): EditedQuestion {
  try {
    return validateEditedQuestion(edited, storedOrdinals);
  } catch (cause) {
    if (cause instanceof EditedQuestionInvalid) throw new BadRequestException(cause.message);
    throw cause;
  }
}

/**
 * Everything derived from the Extraction that is the same for every draft of
 * one job: the per-format targets, the Topics to cover, and the source prompts
 * no generated prompt may collide with.
 *
 * Computed once per run rather than per draft — it cannot change between two
 * calls of the same job, and recomputing it would be a second chance for the
 * targets the payload is checked against to differ from the targets the prompt
 * asked for.
 */
interface GenerationPlan {
  targets: Map<QuestionFormat, number>;
  fakeTargets: FakeFormatTarget[];
  topics: string[];
  sourcePrompts: Set<string>;
  /**
   * The Topic to concentrate on and how many questions must carry it, or null
   * when nothing is weighted. One value, so the prompt, the fake and the
   * validator are all handed the same indivisible rule.
   */
  weighting: GenerationWeighting | null;
}

function planFor(
  extraction: ExtractionForGeneration,
  weightedTopic: string | null,
): GenerationPlan {
  // Each generated Practice Test defaults its Question count from the Source
  // Test's own usable count — the epic's rule, stated here as the one place the
  // total comes from.
  const total = extraction.questions.length;
  const targets = formatTargets(
    extraction.questions.map((question) => question.format),
    total,
  );
  const topics = topicsOf(extraction);
  const sourcePrompts = new Set(
    extraction.questions.map((question) => normalizePrompt(plainTextOf(question.prompt))),
  );
  const fakeTargets = [...targets.entries()]
    .filter(([, count]) => count > 0)
    .map(([format, count]) => ({ format, count }));
  // Taken from the row as it was stored, not re-resolved: `request()` already
  // matched it against this same `readForGeneration` and persisted the
  // Extraction's own spelling, and resolving a second time would be a second
  // chance for the Topic the prompt names to differ from the Topic the
  // post-hoc pass counts.
  return {
    targets,
    fakeTargets,
    topics,
    sourcePrompts,
    weighting: weightingFor(weightedTopic, total),
  };
}

/**
 * The Extraction's Topic labels, in first-appearance order, de-duplicated by
 * the same comparison the resolver uses.
 *
 * Not a plain `Set`: labels are stored raw (AD-11), so one Extraction can
 * genuinely hold `Fractions` and `  fractions ` as two rows. A plain `Set`
 * keeps both, the screen offers both, and `matchTopic` resolves both to the
 * first — leaving the second option unselectable in a way nothing explains.
 * Folding them here, keeping the first spelling, makes the list the screen
 * offers and the list the resolver searches literally the same list.
 */
function topicsOf(extraction: ExtractionForGeneration): string[] {
  const seen = new Set<string>();
  const topics: string[] = [];
  for (const label of extraction.questions.flatMap((question) => question.topics)) {
    const key = normalizeTopicLabel(label);
    if (seen.has(key)) continue;
    seen.add(key);
    topics.push(label);
  }
  return topics;
}

/** The Extraction's own spelling of a label, or undefined if it carries none. */
function matchTopic(topics: readonly string[], wanted: string): string | undefined {
  const normalized = normalizeTopicLabel(wanted);
  return topics.find((label) => normalizeTopicLabel(label) === normalized);
}

/**
 * Turns what the client asked to weight into what is stored, or refuses.
 *
 * Absent stays absent, which is Story 4.1's request unchanged in every respect.
 * A label the Extraction does carry resolves to **its** spelling. Anything else
 * is a 409 before the transaction opens, so nothing is enqueued and nothing is
 * charged for a request that could never have been satisfied.
 */
function resolveWeightedTopic(
  extraction: ExtractionForGeneration,
  wanted: string | null,
): string | null {
  if (wanted === null) return null;
  const matched = matchTopic(topicsOf(extraction), wanted);
  if (matched === undefined) throw new ConflictException(WEIGHTED_TOPIC_UNKNOWN);
  return matched;
}

/** One stored row, as much of it as the answer key's text resolution needs. */
interface AnswerKeySource {
  format: QuestionFormat;
  answer: Prisma.JsonValue | null;
  choices: readonly { ordinal: number; body: Prisma.JsonValue; isCorrect: boolean }[];
}

/**
 * What the answer **was**, as words.
 *
 * The flagged option's stored body for Multiple Choice, the stored free-text
 * answer for everything else. `null` is the one degradation: a stored segment
 * array that no longer reads back, or a Multiple Choice row that somehow lost its
 * flag. The caller renders the row and says the answer is unavailable — throwing
 * would make a closed Attempt unreadable over a field nobody is being marked on.
 */
function correctAnswerTextOf(question: AnswerKeySource): RichText | null {
  if (question.format === 'MultipleChoice') {
    const flagged = question.choices.find((choice) => choice.isCorrect);
    if (flagged === undefined) return null;
    return isRichText(flagged.body) ? (flagged.body as RichText) : null;
  }
  return isRichText(question.answer) ? (question.answer as RichText) : null;
}

/**
 * What the child **put down**, as words.
 *
 * `null` for a Question with no `Answer` row — the blank is the fact, and what a
 * blank *means* is `grading`'s to say.
 *
 * For Multiple Choice the stored value is the chosen option's ordinal as a string,
 * so it is matched against this Question's own options on the trimmed digits-only
 * form and the option's **body** is what travels. A value that is no ordinal of
 * this Question, or an ordinal no option carries, travels as the raw stored string:
 * the child's own answer is the one thing this row must not invent, and the grader
 * has already judged it.
 *
 * Free text travels as **one text segment**, exactly as stored. Nothing here parses
 * a fraction out of it — a child's typed answer is not generated content, and a
 * reading built here would be this module deciding what they meant.
 *
 * An ordinal that matches no option of this Question is not this degradation —
 * it travels as the raw stored string, per the rule above. An ordinal that *does*
 * match an option whose stored body no longer reads back is the degradation: it
 * must not fall back to the raw digits, which would show the child a bare ordinal
 * for an answer they did give.
 */
function studentAnswerTextOf(question: AnswerKeySource, value: string | null): RichText | null {
  if (value === null) return null;
  if (question.format === 'MultipleChoice') {
    const trimmed = value.trim();
    if (/^\d+$/u.test(trimmed)) {
      const chosen = question.choices.find((choice) => choice.ordinal === Number(trimmed));
      if (chosen !== undefined) return isRichText(chosen.body) ? (chosen.body as RichText) : null;
    }
  }
  return [{ kind: 'text', value }];
}
