import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { GradeState } from '../generated/prisma/enums.js';
import { AiInputError, AiRejectedError, AiService, AiUpstreamError } from '../ai/ai.service.js';
import { plainTextOf } from '../extraction/rich-text.js';
import { PrismaService, type TransactionClient } from '../prisma/prisma.service.js';
import { PRACTICE_TEST_NOT_FOUND } from '../practicetest/practice-test-policy.js';
import {
  PracticeTestService,
  type AttemptGradingInput,
  type AttemptSubmissionView,
  type GradingQuestionInput,
} from '../practicetest/practice-test.service.js';
import { TopicService } from '../topics/topic.service.js';
import { buildGradingPrompt, type GradingPromptQuestion } from './grading-prompt.js';
import { countsTowardMastery } from './mastery-eligibility.js';
import { hasEvidence, masteryFrom, masteryWindowOf } from './mastery.js';
import { answeredOf, isWeakArea } from './weak-area-policy.js';
import { runsOf, type PracticeTestRunsView } from './grading-history.js';
import { answerKeyRows, type AttemptResultsView } from './grading-results.js';
import { effectiveStateOf, overrideDecision } from './grading-override.js';
import {
  GRADE_ALREADY_RECORDED,
  GRADE_NOT_JUDGED,
  NO_GRADE_TO_DISPUTE,
  NO_GRADE_TO_OVERRIDE,
} from './grading-policy.js';
import {
  originalScoreOf,
  type GradeDisputeListEntry,
  type ParentAnswerKeyRowView,
  type ParentAttemptResultsView,
} from './parent-results.js';
import {
  GradingPayloadInvalid,
  validateGradingPayload,
  type NormalizedVerdict,
} from './grading-payload.js';
import { GRADING_SCHEMA_NAME, GradingPayload, fakeGradingPayload } from './grading-schema.js';
import { scoreOf, type AttemptScore } from './grading-score.js';

/**
 * One Topic's stored Mastery, as a caller reads it.
 *
 * The five stored figures, plus the two that are derived every time rather than
 * kept: `answered` (the fraction's denominator, which is also what the Weak Area
 * floor is measured against) and `isWeakArea` itself. Neither is a column, and both
 * come from `weak-area-policy.ts` so a retune changes every answer at once.
 *
 * `value` is nullable for the reason the column is: a Topic whose whole window was
 * skipped is not a Topic the child got nothing right on, and a surface showing `0%`
 * for it would be reporting something that never happened.
 *
 * There is no Topic name here. Naming a Topic is `topics`' (AD-11) and the label a
 * parent reads is Story 7.4's to join on.
 */
export interface TopicMasteryView {
  topicId: string;
  correct: number;
  incorrect: number;
  unanswered: number;
  /** How many Questions of the window the child answered: `correct + incorrect`. */
  answered: number;
  /** How many Attempts the window held, one to five. */
  attemptsCounted: number;
  value: number | null;
  /** Derived at read time by the one predicate, never stored. */
  isWeakArea: boolean;
}

/** Who is asking. A parent reaches an Attempt by account; a child by both ids. */
export interface GradingScope {
  parentAccountId: string;
  /**
   * The child's own profile, when the caller is the child. Absent for a parent,
   * whose entitlement is the account — and absent is not "any child", it is "any
   * child of this account", which is what a parent may read.
   */
  studentProfileId?: string;
}

/**
 * A child asking about their own work, with **both** ids required.
 *
 * `GradingScope` admits either party, because an Attempt's answer key is a thing a
 * parent may legitimately read by account. A run history is not: there is no
 * parent-facing Attempt history surface in this story (Epic 6, Parent View), so the
 * profile is not optional here and the read cannot be reached without one — which is
 * a type saying so rather than a non-null assertion standing in for it.
 */
export interface StudentScope {
  parentAccountId: string;
  studentProfileId: string;
}

/**
 * A parent asking about their own account's work, with **no** profile id.
 *
 * `GradingScope`'s optional profile admits either party, which is right for a read an
 * Attempt's owner and its sitter may both make. A write is not that: an override is a
 * decision only a parent takes, and a type that *could* carry a child's id would be a
 * type inviting a student route to call it. Absent is not "any child" — it is "any child
 * of this account", which is exactly what a parent may reach.
 */
export interface ParentScope {
  parentAccountId: string;
}

/** What one retry pass came to, for the read that triggered it. */
export interface UngradedResolution {
  /** Recomputed over the stored states, by FR-37's one denominator. */
  score: AttemptScore;
  /**
   * The Questions **this pass** turned into a verdict, in stored ordinal order.
   * Empty when nothing was outstanding and empty when the re-ask failed.
   */
  newlyGradedQuestionIds: string[];
}

/** A row this service is about to write or update. */
interface GradeRow {
  questionId: string;
  state: GradeState;
  /** Null for every state but a provider's own verdict. */
  rationale: string | null;
}

/** The two formats FR-21/FR-22 send to a provider. */
function isFreeText(question: GradingQuestionInput): boolean {
  return question.format === 'FillInTheBlank' || question.format === 'ShortAnswer';
}

/**
 * The `grading` module's service: sole owner and sole writer of `QuestionGrade`
 * (AD-6, AD-17).
 *
 * It reads `practicetest` through `PracticeTestService` and nothing reads it back:
 * the arrow is `grading -> practicetest`, one way, with no `forwardRef`. What that
 * arrow buys is the whole reason handing in lives here — closing an Attempt and
 * recording what its answers came to have to be one transaction (AD-4, AD-10), and
 * grade state may only be written by this module.
 *
 * All four of FR-37's literals are written here and nowhere else, each by one rule:
 * `Correct`/`Incorrect` from the deterministic Multiple Choice comparison and from
 * a provider's verdict on answered free text, `Incorrect` for a blank on an Attempt
 * the server judged expired, `Unanswered` for a blank on a manual hand-in, and
 * `Ungraded` only where grading *failed*.
 *
 * It is also the sole owner and sole writer of the canonical Topic tag and of stored
 * Mastery (`recomputeMastery` below). AD-10 is honoured literally: each of the three
 * statements that can change a grade — the hand-in's verdict write, a results read
 * that resolves an `Ungraded`, a parent's override — recomputes from the window inside
 * the very transaction that wrote the change, so the figure and the grades it is over
 * are one commit. Canonicalization is asked of `topics` and never performed here, and
 * it always runs outside a transaction.
 */
@Injectable()
export class GradingService {
  private readonly logger = new Logger(GradingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly practiceTests: PracticeTestService,
    private readonly ai: AiService,
    // `topics`' sole writer of `Topic`, and the only entry point the AD-11 cascade
    // has. The arrow is `grading -> topics`: canonicalization is asked for here and
    // is never performed here.
    private readonly topics: TopicService,
  ) {}

  /**
   * Hands one Attempt in and grades it: the child's raw answers, the instant it
   * closed, and a grade row for every Question the paper presented.
   *
   * **Two transactions with one provider call between them.** AD-4 makes
   * submission block on grading and AD-10 puts the recompute of whatever a grade
   * changes inside the transaction that changed it — and Mastery, the only thing
   * AD-10 would bind here, does not exist yet. Meanwhile `withTransaction`'s own
   * doc says Prisma's ceiling is five seconds, and one `Grading` call can retry
   * with backoff well past that. So the close and every verdict that needs no
   * network are one transaction, the call is made outside it, and what came back
   * is written in a short second one.
   *
   * A crash in between leaves those Questions **row-less on a submitted Attempt**,
   * which is why absence is still not a pending state and why `resolveUngraded`
   * scopes to row-less Questions as well as to stored `Ungraded` ones: the two are
   * the same fact.
   *
   * **The deterministic half, inside the closing transaction.** A blank grades
   * `Unanswered` when the server judged the Attempt unexpired and `Incorrect` when
   * it did not — FR-37's two readings of an empty answer field, decided by the
   * column rather than at display time. An answered Multiple Choice Question is
   * compared in code against the option flagged correct, with no AI call and no
   * network: an unparseable or unknown ordinal is `Incorrect`, never `Ungraded`,
   * because no provider was involved.
   *
   * **Which Questions are blank is the server's answer, never the browser's.** It
   * is the Questions on that Practice Test minus the answer rows this same
   * transaction wrote. A body that omitted `answers` entirely is a paper where
   * every Question is blank, and a body naming one of another test's Questions
   * makes no Question blank that was not already.
   *
   * **The AI half is one batched call**, for every answered Fill-in-the-Blank and
   * Short Answer Question together, and no call at all when there are none. A
   * blank is never named in it and consumes no model call. Every failure class —
   * an input fault, a provider refusal, an exhausted upstream retry, a payload the
   * post-hoc pass kept rejecting — writes `Ungraded` for the Questions it could
   * not judge and lets the hand-in stand. `Ungraded` is a failure and never a
   * queue: nothing polls it, and a later read is what re-asks.
   *
   * The answer is `AttemptSubmissionView` unchanged: the same three fields, the
   * same 200, the same shape this route had before grade state existed. Not a
   * grade, not a state, not a score, not a rationale — this surface tells a child
   * nothing about their work.
   */
  async submitAttempt(
    parentAccountId: string,
    studentProfileId: string,
    attemptId: string,
    answers: readonly { questionId: string; value: string }[],
  ): Promise<AttemptSubmissionView> {
    const { view, input } = await this.prisma.withTransaction(async (tx) => {
      const closure = await this.practiceTests.closeAttempt(
        tx,
        parentAccountId,
        studentProfileId,
        attemptId,
        answers,
      );

      // The answer key beside the child's raw answers, read in the same
      // transaction that wrote them, so nothing between the write and the grade
      // can change what is being graded.
      const graded = await this.practiceTests.gradingInputFor(
        tx,
        parentAccountId,
        studentProfileId,
        attemptId,
      );

      const rows = deterministicRows(graded, graded.questions);
      if (rows.length > 0) {
        // `createMany` rather than the guarded write below: this transaction just
        // closed the Attempt conditionally, so it is the only writer that can be
        // here and there is no row of its own to overwrite.
        await tx.questionGrade.createMany({
          data: rows.map((row) => ({ attemptId, ...row })),
        });
      }

      // `blankQuestionIds` stops here. It was the reason for the transaction, not
      // something the response carries.
      return {
        view: {
          submittedAt: closure.submittedAt,
          expired: closure.expired,
          gradeAt: closure.gradeAt,
        },
        input: graded,
      };
    });

    // Outside the transaction, and outside its failure domain — which is why
    // **nothing from here on may throw**. The hand-in is committed: an error
    // escaping now would answer a child 500 for work the server kept, and their
    // retry would meet the 409 the close already earned. `judge` swallows the
    // three Ai fault classes itself, but a lost race on the unique index, a
    // dropped connection or a fault class nobody anticipated would not be, so the
    // whole of it is guarded rather than the parts of it that were foreseen.
    try {
      // **Canonicalization sits here, beside the provider call and outside both
      // transactions**, which is the one region it can sit in: `normalize` makes
      // provider calls and may not run inside a transaction at all, and this region's
      // documented rule is that nothing may throw. It swallows every fault itself.
      await this.tagTopicsFor(parentAccountId, attemptId);

      const asked = input.questions.filter((question) => askable(question));
      if (asked.length > 0) {
        const verdicts = await this.judge(parentAccountId, attemptId, asked);
        await this.prisma.withTransaction(async (tx) => {
          await this.writeGuarded(tx, attemptId, rowsFromVerdicts(asked, verdicts));
          // **The recompute rides the last transaction that writes a grade for this
          // request** (AD-10), so the figure a parent can read is never newer than
          // the grades it is over — and a rollback here takes both.
          await this.recomputeMasteryForAttempt(tx, attemptId);
        });
      } else {
        // No free-text Question to ask about, so the last transaction that wrote a
        // grade was the one that closed the Attempt — and the tags did not exist yet
        // when it committed. Its own immediately-following transaction, therefore,
        // rather than a recompute inside a transaction that ran before the tags.
        await this.prisma.withTransaction((tx) => this.recomputeMasteryForAttempt(tx, attemptId));
      }
    } catch (cause) {
      // The Attempt and the class of fault. Never a Question, an answer, a
      // rationale or a word the model wrote (AD-20).
      //
      // Those Questions are left row-less on a submitted Attempt, which is exactly
      // the state `resolveUngraded` treats as a stored `Ungraded` — so the work is
      // not lost, it is outstanding.
      this.logger.error(
        `Grading after the hand-in of attempt ${attemptId} failed (${faultNameOf(cause)}); its answered free-text questions are left unjudged.`,
      );
    }

    return view;
  }

  /**
   * Re-asks for exactly the Questions nothing has judged, and reports what that
   * came to.
   *
   * FR-22 makes **viewing** the trigger: there is no background job, no queue, no
   * scheduled retry and nothing polling, so this is what a results read calls on
   * its way to answering. Its caller is `resultsFor`, which calls it **before** it
   * reads anything — the retry is not a step beside the read, it is the first half
   * of it. It has no route of its own and needs none: `GET
   * /api/student/attempts/:attemptId/results` is how it is reached.
   *
   * The scope is a stored `Ungraded` **or no row at all**. On a submitted Attempt
   * those are one fact — nothing has judged this — because the deterministic
   * verdicts are written by the transaction that closed the Attempt, so a row-less
   * Question is one the provider call never delivered or never reached.
   *
   * Nothing outstanding makes no AI call at all and reports nothing newly graded.
   * A failed re-ask leaves the rows exactly as they were and **still answers**: a
   * read that could not improve a score is not a read that should refuse.
   *
   * Either party reaches it — a parent by account, a child by both ids — and a
   * foreign Attempt, another profile's Attempt and one that is still open all
   * answer the one shared 404.
   */
  async resolveUngraded(scope: GradingScope, attemptId: string): Promise<UngradedResolution> {
    const { input, outstanding } = await this.prisma.withTransaction(async (tx) => {
      const graded = await this.practiceTests.gradingInputFor(
        tx,
        scope.parentAccountId,
        scope.studentProfileId ?? null,
        attemptId,
      );
      // An open Attempt has nothing to re-grade and is not a different kind of
      // refusal: it answers the same sentence a foreign id does (AD-18).
      if (graded.submittedAt === null) throw new NotFoundException(PRACTICE_TEST_NOT_FOUND);

      const stored = await tx.questionGrade.findMany({
        where: { attemptId },
        select: { questionId: true, state: true },
      });
      const byQuestion = new Map(stored.map((row) => [row.questionId, row.state]));
      const unjudged = graded.questions.filter((question) => {
        const state = byQuestion.get(question.questionId);
        return state === undefined || state === 'Ungraded';
      });

      // A row-less or `Ungraded` Question that needs no provider is decided here
      // and now, in code: a crash between the two transactions of a hand-in is
      // the only way one of these exists, and re-deciding it costs no call.
      const deterministic = deterministicRows(graded, unjudged);
      if (deterministic.length > 0) await this.writeGuarded(tx, attemptId, deterministic);

      return { input: graded, outstanding: unjudged.filter((question) => askable(question)) };
    });

    // A results read calls this, and its own doc promises it still answers even
    // when a re-ask fails — so, exactly as in `submitAttempt`, nothing from here on
    // may throw. `judge` swallows the three Ai fault classes itself, but a lost
    // race on the unique index, a dropped connection or a fault class nobody
    // anticipated would not be, so the whole of it is guarded rather than the parts
    // that were foreseen.
    // Canonicalization, outside every transaction and swallowing every fault, for the
    // reason `submitAttempt` states. It runs on **every** results read and not only
    // on the first: tagging is idempotent by its unique index, a label already
    // canonicalized is answered by stage 1 of the cascade with no provider call at
    // all, and a label whose normalization failed at hand-in has no other retry —
    // there is no queue and nothing polls, so the next read is the retry.
    await this.tagTopicsFor(scope.parentAccountId, attemptId);

    let newlyGradedQuestionIds: string[] = [];
    if (outstanding.length > 0) {
      try {
        const verdicts = await this.judge(scope.parentAccountId, attemptId, outstanding);
        const rows = rowsFromVerdicts(outstanding, verdicts);
        // Assigned from what the transaction *returns*, never pushed into from
        // inside its callback: a callback Prisma re-executes would append a second
        // copy of every id.
        //
        // Only what this pass actually turned into a verdict: a row it left
        // `Ungraded`, and a row it declined to overwrite, are neither of them newly
        // graded.
        newlyGradedQuestionIds = await this.prisma.withTransaction(async (tx) => {
          const written = await this.writeGuarded(tx, attemptId, rows);
          // The last transaction that writes a grade for this request, so the figure
          // and the verdicts it is over commit together (AD-10).
          await this.recomputeMasteryForAttempt(tx, attemptId);
          return written;
        });
      } catch (cause) {
        // The Attempt and the class of fault. Never a Question, an answer, a
        // rationale or a word the model wrote (AD-20). Those Questions are left
        // exactly as they were — outstanding, not lost — for the next read to try.
        this.logger.error(
          `resolveUngraded for attempt ${attemptId} failed (${faultNameOf(cause)}); its outstanding questions are left unjudged.`,
        );
      }
    } else {
      // Nothing outstanding to ask about, so the grades this Mastery is over were
      // written by an earlier request — but the tags may have only just arrived, or
      // this may be the read that first resolved a label. Its own transaction,
      // therefore, and guarded for the reason the branch above is: a results read
      // whose recompute failed must still answer.
      try {
        await this.prisma.withTransaction((tx) => this.recomputeMasteryForAttempt(tx, attemptId));
      } catch (cause) {
        this.logger.error(
          `The mastery recompute for attempt ${attemptId} failed (${faultNameOf(cause)}); its stored figures are left as they were.`,
        );
      }
    }

    // Read back rather than computed from what was just written: the score is a
    // statement about every presented Question, including the ones this pass never
    // touched.
    const score = await this.scoreFor(attemptId, input);
    return { score, newlyGradedQuestionIds };
  }

  /**
   * One handed-in Attempt's results: every presented Question, what the child put
   * down, what the answer was, and which of the four states it is in.
   *
   * **The read is FR-22's retry.** `resolveUngraded` runs first, so opening results
   * is what re-asks for anything nothing has judged — and it is also what refuses:
   * a foreign Attempt, a sibling's, an unknown id and an Attempt still open all
   * throw the one shared 404 from there, before this method reads a row. A re-ask
   * that fails does not fail the read; that promise is `resolveUngraded`'s own, and
   * this method answers with the rows exactly as they stand.
   *
   * **The score is recomputed here rather than taken from the resolution.**
   * `resolveUngraded` answers with a score of its own, but that one was computed
   * before this read and over the states as they were then — and the figure a
   * surface states must describe exactly the rows in the same response. So the
   * states are read once more and `scoreOf` is applied to the states of the rows
   * being returned. One `scoreOf`, one denominator, no second answer to FR-37.
   *
   * **`questionGrade` is selected for `questionId` and `state` only.** The rationale
   * is not read at all, so no mapper downstream of this can leak one onto a child's
   * screen (AD-20, AD-26), and `AnswerKeyRowView` has no field it could sit in.
   *
   * The signature admits either party — a parent by account, a child by both
   * ids — which is why the answer key read takes a nullable profile id, though
   * this story wires up only the student route; a parent-facing caller is not
   * implemented here.
   */
  async resultsFor(scope: GradingScope, attemptId: string): Promise<AttemptResultsView> {
    // First, and the whole reason this is a `GET` that writes: viewing is the
    // trigger. It is also where every refusal comes from.
    const resolution = await this.resolveUngraded(scope, attemptId);

    const key = await this.practiceTests.answerKeyFor(
      scope.parentAccountId,
      scope.studentProfileId ?? null,
      attemptId,
    );
    const stored = await this.prisma.questionGrade.findMany({
      where: { attemptId },
      // Four columns, and **still no rationale**. A rationale this never selects is a
      // rationale no mapper can put on a student response. `overrideState` is here
      // because it is what *counts* — the effective grade is the child's own grade —
      // and `overriddenAt` is deliberately **not**, because the instant a parent
      // decided is not a fact the child is told (AD-20, AD-26): `parentAdjusted` is a
      // boolean derived from the column being set, and a date would be somewhere for
      // the mechanics to travel.
      select: { questionId: true, state: true, overrideState: true },
    });
    // The child's own objections, off the pair. One statement, one column: which
    // Questions, and nothing about what anyone decided — there is no dispute
    // disposition in this system, and the adjustment itself is `parentAdjusted`.
    const disputes = await this.prisma.gradeDispute.findMany({
      where: { attemptId },
      select: { questionId: true },
    });

    // Indexed once, by Question. Every composition below reads this rather than
    // scanning the list again: an Attempt is up to a few dozen Questions, and a `find`
    // per Question inside a `map` over them is a quadratic pass for a lookup the
    // response already needs keyed.
    const byQuestion = new Map(stored.map((row) => [row.questionId, row]));

    // **Effective states, resolved in the one place a grade is "what counts".** A
    // parent's adjustment is the child's grade: a results screen that showed the
    // provider's verdict after an override would be telling a child their parent's
    // decision did not happen.
    const states = new Map(stored.map((row) => [row.questionId, effectiveStateOf(row)]));

    // Not `resolveUngraded`'s score: that one was computed before this read, and a
    // header must describe exactly the rows in the same response. One `scoreOf`,
    // so no surface can reach a second denominator.
    const rows = answerKeyRows(
      key,
      states,
      resolution.newlyGradedQuestionIds,
      stored.filter((row) => row.overrideState !== null).map((row) => row.questionId),
      disputes.map((row) => row.questionId),
    );
    const score = scoreOf(rows.map((row) => row.state));
    // **The same function a second time, over the stored verdicts.** The prior figure
    // is not stored and is not subtracted from anything: `scoreOf` decides both, so
    // "11 of 15 became 12 of 15" is one denominator rule stated twice rather than two
    // rules that agree today. Null where nothing was adjusted, which is what keeps a
    // surface from comparing two identical fractions and guessing whether that counts.
    const originalScore = originalScoreOf(
      stored.some((row) => row.overrideState !== null),
      // `null` for a Question with no grade row at all, and not `'Ungraded'`: `scoreOf`
      // treats a missing row and a stored `Ungraded` as one fact and excludes both, so
      // naming the absence honestly keeps the prior figure's denominator identical to
      // the adjusted one's — which is the whole point of computing them with one
      // function.
      scoreOf(key.questions.map((question) => byQuestion.get(question.questionId)?.state ?? null)),
    );

    return {
      attemptId: key.attemptId,
      practiceTestId: key.practiceTestId,
      subjectName: key.subjectName,
      questionCount: key.questionCount,
      score,
      originalScore,
      questions: rows,
    };
  }

  /**
   * Records that the **child** disagrees with the grade on one Question of their own
   * handed-in Attempt, and answers with that row as they now read it.
   *
   * **It writes no grade.** No `state`, no `overrideState`, no score, no Mastery figure
   * and no provider call: the only row this touches is the dispute's own. FR-25's remedy
   * is the parent's override, and a child who could move their own grade by objecting to
   * it would be a child marking their own paper.
   *
   * **It surfaces to the parent only**, through `gradeDisputesFor` and the parent's
   * Attempt detail. The child learns that their own objection exists and nothing else:
   * no rationale, no override mechanics, no AI-versus-parent wording and no cost, tier,
   * model or allowance figure (AD-20, AD-26) — and `AnswerKeyRowView` has no field any
   * of those could travel in.
   *
   * **The ownership proof runs first, through `resultsFor`.** A foreign Attempt, a
   * sibling's, an unknown id and one still open all become the single
   * `PRACTICE_TEST_NOT_FOUND` sentence before a dispute row is read (AD-18) — and, in
   * passing, the response the child gets back is the whole results view with their
   * objection on it, so the screen redraws from one answer rather than from a merge.
   * Reading the grade row by its two ids before proving the binding would answer a
   * stranger's id with a 404 for one reason and a row for another, which is the
   * difference an enumeration attack reads.
   *
   * **A Question with no grade row, and one not on this Practice Test, answer the same
   * 404.** There is no judgement there to object to, and spelling that apart from a
   * foreign Attempt would let the outside tell "nothing graded" from "not yours".
   *
   * **Idempotent per pair, by the index and not by a check** — the same upsert-plus-P2002
   * shape `flagExplanationAsStudent` makes, for the same reasons: a repeat press is the
   * same objection and keeps the first `createdAt`, and two first presses landing
   * together leave one row with the loser answering the winner's. There is **no
   * un-disputing** and no route that deletes one.
   */
  async disputeGrade(
    scope: StudentScope,
    attemptId: string,
    questionId: string,
  ): Promise<AttemptResultsView> {
    // **One read, and it is the proof, the re-ask and the response.** It refuses a
    // foreign, sibling, unknown or still-open Attempt before a dispute row is touched,
    // it runs FR-22's re-ask — which is what makes a dispute raised on a row that was
    // `Ungraded` a moment ago legible — and it is what this method answers with.
    //
    // A second pass afterwards would be a second ownership proof, a second
    // `resolveUngraded` and, on a paper with anything outstanding, a **second provider
    // call** — on a route a child may press once per Question. The one field below is
    // edited instead, for the reason stated there.
    const read = await this.resultsFor(scope, attemptId);
    // A Question of another Practice Test, and one that never existed, are both absent
    // from the answer key — which is the same sentence a foreign Attempt got above.
    const row = read.questions.find((question) => question.questionId === questionId);
    if (row === undefined) throw new NotFoundException(NO_GRADE_TO_DISPUTE);

    const key = { attemptId_questionId: { attemptId, questionId } };
    try {
      await this.prisma.gradeDispute.upsert({
        where: key,
        create: {
          attemptId,
          questionId,
          // The scope's own ids, which are the Attempt's by construction: `resultsFor`
          // refused above unless this child of this account owns it.
          studentProfileId: scope.studentProfileId,
          parentAccountId: scope.parentAccountId,
        },
        // Nothing. A child pressing again is the same objection, and an update arm that
        // touched anything would move the one instant this row holds.
        update: {},
        select: { id: true },
      });
    } catch (cause) {
      // Two first presses at once. An `upsert` reads and then writes, so both can find
      // no row and both attempt the insert; the unique key refuses the loser with
      // P2002, which is exactly the double-tap this absorbs. Nothing needs re-reading:
      // the winner's row is the row, and the response below is composed afresh.
      if (!isUniqueViolation(cause)) throw cause;
    }

    // The Attempt and the Question, and nothing else. Never the Question's content, the
    // child's answer or a rationale (AD-20).
    this.logger.log(
      `A grade dispute is recorded for question ${questionId} of attempt ${attemptId}.`,
    );

    // **The one field this write changed, and nothing else.** `disputed` is not this
    // method's opinion about what a later read would say — it is the outcome of the
    // statement above, which either inserted the row or found the one a previous press
    // left. Every other field is safe to carry over because a dispute writes **no
    // grade**: not `state`, not `overrideState`, not a score and not another row, which
    // is the invariant the integration cases pin from outside. So re-reading would cost
    // a second proof and a second re-ask to learn nothing this does not already know.
    return {
      ...read,
      questions: read.questions.map((question) =>
        question.questionId === questionId ? { ...question, disputed: true } : question,
      ),
    };
  }

  /**
   * One handed-in Attempt's results as the **parent** reads them: the effective grade,
   * the provider's own verdict beside it, the rationale it gave, and what the child
   * objected to.
   *
   * **Its own method rather than a widening of `resultsFor`, and that is the design.**
   * That method's comment — "a rationale this never selects is a rationale no mapper can
   * put on a student response" — is load-bearing. Widening it with a nullable rationale
   * and a scope check would make one read serve two audiences and one field's presence
   * depend on a runtime branch; a second method selecting more columns keeps the student
   * response's *shape* incapable of carrying the fact (`parent-results.ts` says the rest).
   *
   * **It is still FR-22's retry**, exactly as the child's read is: `resolveUngraded` runs
   * first, so a parent opening a run whose Questions nothing has judged re-asks for them.
   * The same trigger on the same rows, not a second one — and it is also where every
   * refusal comes from, so a foreign Attempt, an unknown id and one still open all throw
   * the one shared 404 before this method reads a row.
   *
   * **One `scoreOf`, called twice.** The adjusted figure is over effective states and the
   * prior one over stored verdicts, so the two fractions a parent reads as a change come
   * from one denominator rule. `originalScore` is null when no row carries an override.
   */
  async parentResultsFor(scope: ParentScope, attemptId: string): Promise<ParentAttemptResultsView> {
    const resolution = await this.resolveUngraded(scope, attemptId);

    // Which child sat it, resolved from the Attempt row. It is on the response because the
    // retained-override slot is keyed per Student Profile (FR-35), and it is read here
    // rather than taken from a path because a profile id in a URL is a profile id that can
    // be paired with another child's Attempt.
    const { studentProfileId } = await this.practiceTests.attemptProfileFor(
      scope.parentAccountId,
      attemptId,
    );
    const key = await this.practiceTests.answerKeyFor(scope.parentAccountId, null, attemptId);
    const stored = await this.prisma.questionGrade.findMany({
      where: { attemptId },
      // The parent's columns: the verdict, the sentence it gave, and the adjustment.
      // This is the one read in this module that selects a rationale, and its return
      // type is the one shape that can carry one.
      select: {
        questionId: true,
        state: true,
        rationale: true,
        overrideState: true,
        overriddenAt: true,
      },
    });
    const disputes = await this.prisma.gradeDispute.findMany({
      where: { attemptId },
      select: { questionId: true, createdAt: true },
    });
    const disputedAt = new Map(disputes.map((row) => [row.questionId, row.createdAt]));
    const byQuestion = new Map(stored.map((row) => [row.questionId, row]));

    // The child's rows first, composed by the one mapper both surfaces share, so the
    // effective state, the score and the two per-row facts cannot come to differ
    // between the two screens. Then the parent-scoped columns on top.
    const base = answerKeyRows(
      key,
      new Map(stored.map((row) => [row.questionId, effectiveStateOf(row)])),
      resolution.newlyGradedQuestionIds,
      stored.filter((row) => row.overrideState !== null).map((row) => row.questionId),
      disputes.map((row) => row.questionId),
    );
    const questions: ParentAnswerKeyRowView[] = base.map((row) => {
      const grade = byQuestion.get(row.questionId);
      return {
        ...row,
        rationale: grade?.rationale ?? null,
        // The stored verdict, and `Ungraded` for a Question with no row at all —
        // exactly as `answerKeyRows` flattens the same absence, so the two fields
        // agree about a row that does not exist.
        aiState: grade?.state ?? 'Ungraded',
        overriddenAt: grade?.overriddenAt?.toISOString() ?? null,
        disputedAt: disputedAt.get(row.questionId)?.toISOString() ?? null,
      };
    });

    const score = scoreOf(questions.map((row) => row.state));
    const originalScore = originalScoreOf(
      stored.some((row) => row.overrideState !== null),
      scoreOf(questions.map((row) => (byQuestion.has(row.questionId) ? row.aiState : null))),
    );

    return {
      attemptId: key.attemptId,
      practiceTestId: key.practiceTestId,
      studentProfileId,
      subjectName: key.subjectName,
      questionCount: key.questionCount,
      score,
      originalScore,
      questions,
    };
  }

  /**
   * Records what a **parent** says one Question is worth, and the score that follows
   * from it — in one transaction.
   *
   * **The flip and the figure commit together, or neither does** (AD-10,
   * `withTransaction`). A reader must never be able to see one without the other: an
   * Attempt whose row says `Correct` and whose header says the old fraction is a screen
   * contradicting itself, and a parent watching it would not know which half to believe.
   * The Mastery recompute seam is **inside** the same transaction, where every other
   * grade-changing trigger's is — there is nothing to recompute until Epic 7, exactly as
   * `mastery-eligibility.ts` records.
   *
   * **The original verdict and its rationale are never touched.** `state` and `rationale`
   * keep the provider's own words, because FR-25 requires both readable afterwards; the
   * override is its own column beside them and effective state is `overrideState ?? state`,
   * resolved in `grading-override.ts` and nowhere else.
   *
   * **`updateMany` on the pair, never a read-then-write.** Two simultaneous presses both
   * answer and the last statement wins — which is the honest outcome for a decision that
   * may legitimately be made again in the other direction. The guard in the `where` is
   * the *pair*, not the current value: guarding on `overrideState: null` would make a
   * parent's second, different decision silently do nothing.
   *
   * **An override needs no dispute.** A parent who spots a harsh grade themselves may fix
   * it, and requiring a child to object first would make the remedy depend on the child
   * having noticed — which is the opposite of FR-25's mitigation. A dispute, where there
   * is one, is resolved by this write.
   *
   * Two refusals, each a 409 with its own sentence and neither naming a child, a number
   * or a tier: the requested grade is already what counts, or the stored verdict is not a
   * judgement at all. A foreign, unknown or still-open Attempt is the shared 404 from the
   * proof above, never a 403.
   */
  async overrideGrade(
    scope: ParentScope,
    attemptId: string,
    questionId: string,
    requested: GradeState,
  ): Promise<ParentAttemptResultsView> {
    // The proof, first and outside the write: a foreign Attempt, an unknown id and one
    // still open all answer the one shared sentence before a grade row is read (AD-18).
    await this.practiceTests.attemptProfileFor(scope.parentAccountId, attemptId);

    // Canonicalization **before** the transaction opens and never inside it: it makes
    // provider calls, and a transaction held open around one is a row lock held for
    // the length of an outage. It swallows every fault itself, so a provider outage
    // costs the tags and never the parent's decision. Ordinarily there is nothing left
    // to do here — the hand-in tagged this paper — and stage 1 of the cascade answers
    // each label with a lookup and no call.
    await this.tagTopicsFor(scope.parentAccountId, attemptId);

    await this.prisma.withTransaction(async (tx) => {
      // Read inside the transaction, so the decision below is made against the row the
      // write lands on rather than against a snapshot from before it opened.
      const grade = await tx.questionGrade.findUnique({
        where: { attemptId_questionId: { attemptId, questionId } },
        select: { state: true, overrideState: true },
      });
      // No grade row at all: nothing has judged this, and there is nothing here to
      // adjust. The same sentence the Attempt's own refusals give, for the reason a
      // Question of another test gets it — the outside must not be able to tell
      // "nothing graded" from "not your Attempt".
      if (grade === null) throw new NotFoundException(NO_GRADE_TO_OVERRIDE);

      // The whole of the rule, decided by a pure function so it is assertable without a
      // database — and exhaustive, so a fourth outcome is a compile error rather than a
      // fall-through that writes.
      const decision = overrideDecision(grade, requested);
      switch (decision) {
        case 'already':
          throw new ConflictException(GRADE_ALREADY_RECORDED);
        case 'notJudged':
          throw new ConflictException(GRADE_NOT_JUDGED);
        case 'flip':
          break;
        default: {
          const unhandled: never = decision;
          throw new Error(`No override outcome is written for ${String(unhandled)}.`);
        }
      }

      // `updateMany` on the pair and never a read-then-write: the statement is the
      // guard, so two presses in flight both answer and the last one wins. `state` and
      // `rationale` are absent from `data` deliberately — the provider's verdict and the
      // sentence it gave are retained, and this is the statement that would overwrite
      // them if anything ever did.
      const adjusted = await tx.questionGrade.updateMany({
        where: { attemptId, questionId },
        // Both columns in one statement: an override with no instant beside it would be
        // a decision nobody can date.
        data: { overrideState: requested, overriddenAt: new Date() },
      });
      // **The count is read, not assumed.** The row was there a statement ago, but a
      // cascading delete of the Attempt or the Question between the read and here would
      // leave this matching nothing — and answering 200 for a write that landed on no
      // row would tell a parent their decision was recorded when the thing it was about
      // is gone. Thrown from **inside** the transaction, so the score read below never
      // runs and nothing commits.
      if (adjusted.count === 0) throw new NotFoundException(NO_GRADE_TO_OVERRIDE);

      // The score, read back **inside this transaction**, which is the whole reason
      // there is a transaction: the figure and the flip are one commit, so no reader
      // can see one without the other. The value is deliberately not returned — the
      // response is composed by `parentResultsFor` below, over the committed rows, so
      // there is one composition of a parent's view rather than two. What matters here
      // is that the read happened in the same unit of work as the write.
      const committed = await tx.questionGrade.findMany({
        where: { attemptId },
        select: { questionId: true, state: true, overrideState: true },
      });
      scoreOf(committed.map((row) => effectiveStateOf(row)));

      // **The Mastery recompute, and it is here on purpose.** AD-10 puts the recompute
      // of whatever a grade changes inside the transaction that changed it, and an
      // override changes a grade — so this is the second trigger, beside the hand-in.
      // The flip and the figure that follows from it commit together, so no reader can
      // see one without the other and a rollback takes both. Not on a queue, not on a
      // timer, and not derived at read time.
      //
      // It exits before any read on a retake: which run counts is still decided by
      // which run it is, and a parent adjusting a grade on a later run does not promote
      // that run to the one that counts.
      await this.recomputeMasteryForAttempt(tx, attemptId);
    });

    // The Attempt, the Question and which way. Never the Question's content, the child's
    // answer or the rationale (AD-20).
    this.logger.log(
      `The grade for question ${questionId} of attempt ${attemptId} is adjusted by a parent to ${requested}.`,
    );

    // Composed afresh over the committed rows, so the response a parent reads is the
    // response the next read would give. It re-runs FR-22's re-ask, which has nothing
    // left to do on an Attempt whose rows were just judged enough to be overridden.
    return this.parentResultsFor(scope, attemptId);
  }

  /**
   * Every grade one child has objected to, newest first — awaiting a decision and
   * resolved alike.
   *
   * **It exists because a dispute the parent cannot find is a dispute that did not
   * surface.** The Attempt-detail row shows an objection only to somebody who already
   * opened that Attempt; this is what makes a child's raised hand reachable at all.
   *
   * **It outlives the decision.** A resolved dispute is still listed and marked with its
   * outcome — `overriddenAt` — and one awaiting a decision is listed as awaiting, which
   * is the *absence* of an override rather than a value somebody wrote. A list that
   * dropped resolved entries would make a parent's own adjustment look like the
   * objection never happened.
   *
   * **A foreign or unknown profile answers `[]`**, not a refusal — the same answer a
   * child with no disputes gets, and the same answer `studentFlagsFor` and
   * `GET parent/students/:id/attempts` already give: a 404 for an unknown id would be a
   * confirmation for a known one (AD-18). This method does not try to tell the two apart,
   * because the rows carry `parentAccountId` denormalized and the `where` simply matches
   * nothing.
   *
   * The run and Question context arrives through one batched `PracticeTestService` read,
   * the same one the explanation-flag list uses, so the arrow stays `grading ->
   * practicetest`. A dispute whose context no longer resolves keeps its place and loses
   * its labels: whether an objection was raised is not contingent on being able to name
   * what it was about.
   *
   * No prose here — a rationale is read beside the Question it is about, on the
   * Attempt-detail screen — and no score, cost, tier, model name or Mastery figure
   * (AD-20, AD-26).
   */
  async gradeDisputesFor(
    scope: ParentScope,
    studentProfileId: string,
  ): Promise<GradeDisputeListEntry[]> {
    const rows = await this.prisma.gradeDispute.findMany({
      // Both denormalized ids. The account is the parent's entitlement; the profile is
      // which child. No origin arm, because a dispute has one origin and it is the child.
      where: { parentAccountId: scope.parentAccountId, studentProfileId },
      // Newest first, with the id behind it so two objections raised inside the same
      // millisecond still come back in a stable order.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { attemptId: true, questionId: true, createdAt: true },
    });
    if (rows.length === 0) return [];

    // The grades of exactly the disputed pairs. The recorded verdict is what the child
    // objected to and the override is the resolution, so both columns come back — and no
    // rationale, because a list is not where prose is read.
    const grades = await this.prisma.questionGrade.findMany({
      // **The disputed pairs themselves, not the cross-product of their two id sets.**
      // Two `in` arms would match every (Attempt, Question) combination those ids form —
      // so a child who disputed question 1 of run A and question 2 of run B would pull
      // back four rows for two disputes, and a busy list would read a quadratic slice of
      // the table to use a diagonal of it. `OR` over the pairs asks for exactly the rows
      // this list states, which is also what the unique key on the pair indexes.
      where: { OR: rows.map((row) => ({ attemptId: row.attemptId, questionId: row.questionId })) },
      select: {
        attemptId: true,
        questionId: true,
        state: true,
        overrideState: true,
        overriddenAt: true,
      },
    });
    const gradeByRef = new Map(
      grades.map((grade) => [refKey(grade.attemptId, grade.questionId), grade]),
    );

    const contexts = await this.practiceTests.flaggedQuestionContextsFor(
      scope.parentAccountId,
      rows.map((row) => ({ attemptId: row.attemptId, questionId: row.questionId })),
    );
    const contextByRef = new Map(
      contexts.map((context) => [refKey(context.attemptId, context.questionId), context]),
    );

    return rows.map((row) => {
      const ref = refKey(row.attemptId, row.questionId);
      const grade = gradeByRef.get(ref);
      const context = contextByRef.get(ref);
      // A dispute whose grade row is gone states `Ungraded` both ways rather than
      // dropping out of the list: the objection was raised, which is the fact, and
      // `Ungraded` is already how this module reads the absence of a row everywhere else.
      const recordedState = grade?.state ?? 'Ungraded';
      return {
        attemptId: row.attemptId,
        questionId: row.questionId,
        disputedAt: row.createdAt.toISOString(),
        recordedState,
        effectiveState: grade === undefined ? recordedState : effectiveStateOf(grade),
        // The resolution, derived from the override and from nothing else. Null is
        // awaiting.
        overriddenAt: grade?.overriddenAt?.toISOString() ?? null,
        practiceTestId: context?.practiceTestId ?? null,
        runOrdinal: context?.runOrdinal ?? null,
        questionOrdinal: context?.questionOrdinal ?? null,
        subjectName: context?.subjectName ?? null,
        submittedAt: context?.submittedAt ?? null,
      };
    });
  }

  /**
   * This child's run history: one entry per Practice Test they have finished at least
   * once, with the first run's figure, the latest run's figure and how many runs there
   * are.
   *
   * **`resolveUngraded` is deliberately not called here**, even though FR-22 makes
   * viewing the trigger. This is a **list** read over every test on Student Home: a
   * re-ask per row would spend a provider call per card on every visit to a child's
   * home screen, which is a bill that grows with how often they look rather than with
   * how much work there is. The trigger FR-22 names is the **results** screen, and
   * that is still exactly where it fires — one Attempt, one re-ask, on a read the
   * child navigated to. A run whose Questions nothing has judged is reported here as
   * what it is: a figure with them excluded.
   *
   * **Two round trips, and no more.** The runs come from `practicetest` — `Attempt`
   * is its entity, and this module reaches it only through `PracticeTestService`, so
   * the arrow stays `grading -> practicetest` — and the grade states come from one
   * `questionGrade.findMany` over **only the first and latest Attempt of each test**,
   * because those are the only two runs anything states. The runs in between are
   * counted and never scored.
   *
   * **`attemptId`, `state` and `overrideState` only.** A rationale never selected is a
   * rationale no mapper can leak onto a child's screen (AD-20, AD-26), and
   * `AttemptRunView` has no field one could sit in. The Attempt id is selected not to be
   * shown but so two runs of the same test cannot score each other: the states are
   * keyed by Attempt, and the count per Attempt is what `scoreOf` is given.
   *
   * **The states are the *effective* ones**, resolved by `effectiveStateOf` before
   * `runsOf` hands anything to `scoreOf` (Story 6.5). Scoring the provider's own verdict
   * here would make a child's home screen and their results screen state two different
   * figures for one run the moment a parent adjusted a mark — which is exactly the
   * second denominator FR-37 forbids, reached by a read that forgot the other column
   * rather than by a second implementation of the count.
   *
   * A child with nothing handed in answers `[]`, and never a 404: having finished
   * nothing yet is a state a home screen renders as rows with no figure on them.
   */
  async runHistoryFor(scope: StudentScope): Promise<PracticeTestRunsView[]> {
    const runs = await this.practiceTests.submittedRunsFor(
      scope.parentAccountId,
      scope.studentProfileId,
    );
    if (runs.length === 0) return [];

    // Exactly the runs that get a figure. A test with five finished runs contributes
    // two ids here, not five.
    const scored = new Set<string>();
    const byTest = new Map<string, typeof runs>();
    for (const run of runs) {
      const group = byTest.get(run.practiceTestId);
      if (group === undefined) byTest.set(run.practiceTestId, [run]);
      else group.push(run);
    }
    for (const group of byTest.values()) {
      scored.add(group[0]!.attemptId);
      scored.add(group[group.length - 1]!.attemptId);
    }

    const stored = await this.prisma.questionGrade.findMany({
      where: { attemptId: { in: [...scored] } },
      // Three columns. No rationale, so there is nothing here to leak — and no
      // `questionId` either: `scoreOf` tallies states and reads no Question, so the
      // run a verdict belongs to is the only thing that has to come back with it.
      // `overrideState` is selected because it is what *counts*, never to be shown.
      select: { attemptId: true, state: true, overrideState: true },
    });
    const statesByAttempt = new Map<string, GradeState[]>();
    for (const row of stored) {
      // Resolved here, through the one place a grade is "what counts", before anything
      // is counted: a parent's adjustment is the child's mark on every surface that
      // states one, the home screen included.
      const state = effectiveStateOf(row);
      const states = statesByAttempt.get(row.attemptId);
      if (states === undefined) statesByAttempt.set(row.attemptId, [state]);
      else states.push(state);
    }

    return runsOf(runs, statesByAttempt);
  }

  /**
   * Recomputes the stored Mastery of the given Topics for one child, from scratch,
   * inside the caller's transaction.
   *
   * **The one recompute path, and public on purpose.** Every trigger that can change
   * a grade calls exactly this — the hand-in's verdict write, a results read that
   * resolves an `Ungraded`, a parent's override — and AD-12 requires Story 7.6's
   * Topic merge to re-point tags and then reuse this same path rather than grow a
   * second one. A second implementation would be a second window definition and a
   * second formula, and the two would disagree the first time either was tuned.
   *
   * **From the window, never incremented** (AD-6). Nothing here reads the stored row
   * before writing it: every figure is recounted from the five most recent qualifying
   * Attempts that included the Topic, so a lost update, a replayed trigger and a
   * grade that changed twice all converge on the same answer. An increment would be a
   * running total that could only ever drift.
   *
   * **`tx` comes from the caller**, because AD-10 puts the recompute inside the
   * transaction that wrote the grade change: the flip and the figure that follows
   * from it commit together, so no reader can see one without the other and a
   * rollback takes both. It is a parameter and not a transaction opened here for
   * exactly that reason.
   *
   * Three reads and then pure arithmetic: the child's submitted Attempts, this
   * story's tags for the Topics in question, and — once the windows are settled and
   * can narrow it — the grades of the window's Attempts on the tagged Questions alone.
   * No `normalize` call and no provider call at all: the canonical tag was resolved
   * once, when the paper was handed in, which is what makes this safe inside a
   * transaction.
   *
   * A Topic left with no evidence — every tagged Question of its window `Ungraded` or
   * row-less, or no qualifying Attempt including it at all — has its row **deleted**
   * rather than stored as `0/0`, so Story 7.4's empty state stays distinguishable
   * from a real zero.
   */
  async recomputeMastery(
    tx: TransactionClient,
    studentProfileId: string,
    topicIds: readonly string[],
  ): Promise<void> {
    const topics = [...new Set(topicIds)];
    if (topics.length === 0) return;

    // Which of the child's runs count at all: handed in, and a first run. The
    // ordinal is judged by the one predicate rather than compared here — `1` never
    // appears as a literal on this path.
    const qualifying = (await this.practiceTests.submittedAttemptsFor(tx, studentProfileId)).filter(
      (attempt) => countsTowardMastery(attempt.ordinal),
    );

    // No qualifying run at all still runs the loop below: every Topic comes out with
    // no evidence, which is a delete, which is exactly right for a child whose only
    // graded work has since been removed.
    const tags =
      qualifying.length === 0
        ? []
        : await tx.questionTopic.findMany({
            where: {
              topicId: { in: topics },
              practiceTestId: { in: [...new Set(qualifying.map((a) => a.practiceTestId))] },
            },
            select: { topicId: true, questionId: true, practiceTestId: true },
          });

    // Tags grouped two ways, because the window rule and the counting rule ask two
    // different questions: "which papers mention this Topic" and "which Questions of
    // this paper are on it".
    const testIdsByTopic = new Map<string, Set<string>>();
    const questionIdsByTopicAndTest = new Map<string, string[]>();
    for (const tag of tags) {
      const testIds = testIdsByTopic.get(tag.topicId);
      if (testIds === undefined) testIdsByTopic.set(tag.topicId, new Set([tag.practiceTestId]));
      else testIds.add(tag.practiceTestId);

      const key = topicTestKey(tag.topicId, tag.practiceTestId);
      const questionIds = questionIdsByTopicAndTest.get(key);
      if (questionIds === undefined) questionIdsByTopicAndTest.set(key, [tag.questionId]);
      else questionIds.push(tag.questionId);
    }

    // **The windows are settled before a single grade is read**, because they are what
    // narrows that read. A child who has sat forty papers has forty qualifying
    // Attempts and at most five per Topic in scope, so reading grades by the
    // qualifying set would grow without bound as they work — inside a transaction
    // they are waiting on — to fetch rows the arithmetic then throws away.
    const windowByTopic = new Map<string, ReturnType<typeof masteryWindowOf>>();
    const windowAttemptIds = new Set<string>();
    const taggedQuestionIds = new Set<string>();
    for (const topicId of topics) {
      const window = masteryWindowOf(qualifying, testIdsByTopic.get(topicId) ?? new Set());
      windowByTopic.set(topicId, window);
      for (const attempt of window) {
        windowAttemptIds.add(attempt.attemptId);
        for (const questionId of questionIdsByTopicAndTest.get(
          topicTestKey(topicId, attempt.practiceTestId),
        ) ?? []) {
          taggedQuestionIds.add(questionId);
        }
      }
    }

    // One statement for every Topic rather than one per Topic: the Topics of one paper
    // overlap heavily, and a read per Topic would be N round trips in the same
    // transaction. Narrowed on **both** axes — the Attempts that survived the window,
    // and the Questions actually tagged with one of these Topics — so nothing comes
    // back that no count is over.
    const grades =
      windowAttemptIds.size === 0 || taggedQuestionIds.size === 0
        ? []
        : await tx.questionGrade.findMany({
            where: {
              attemptId: { in: [...windowAttemptIds] },
              questionId: { in: [...taggedQuestionIds] },
            },
            select: {
              attemptId: true,
              questionId: true,
              state: true,
              overrideState: true,
            },
          });
    const effectiveByRef = new Map(
      grades.map((row) => [refKey(row.attemptId, row.questionId), effectiveStateOf(row)]),
    );

    for (const topicId of topics) {
      const window = windowByTopic.get(topicId) ?? [];
      const states: (GradeState | null)[] = [];
      for (const attempt of window) {
        const questionIds =
          questionIdsByTopicAndTest.get(topicTestKey(topicId, attempt.practiceTestId)) ?? [];
        for (const questionId of questionIds) {
          // A Question with no row is pushed as null, which `masteryFrom` treats
          // exactly as `Ungraded`: the two are one fact, and a Mastery that told them
          // apart would count a different denominator than the retry path works from.
          states.push(effectiveByRef.get(refKey(attempt.attemptId, questionId)) ?? null);
        }
      }

      const counts = masteryFrom(states);
      if (!hasEvidence(counts)) {
        // `deleteMany` and not `delete`: there is nothing to delete for a Topic that
        // never had a row, and that is the ordinary case rather than an error.
        await tx.topicMastery.deleteMany({ where: { studentProfileId, topicId } });
        continue;
      }

      // An upsert on the unique pair, so no reader can observe the gap a
      // delete-then-insert would leave. `attemptsCounted` is how many Attempts the
      // window held: fewer than five is a child who has sat fewer, not a gap.
      const row = { ...counts, attemptsCounted: window.length };
      try {
        await tx.topicMastery.upsert({
          where: { studentProfileId_topicId: { studentProfileId, topicId } },
          create: { studentProfileId, topicId, ...row },
          update: row,
        });
      } catch (cause) {
        // **A concurrent first recompute is a loser on the index, and losing must not
        // abort a grade change.** Prisma's upsert is a read-then-write, so two
        // transactions computing this pair's first row both find nothing and both
        // insert — two parent tabs overriding two Questions of one paper is enough.
        // The loser's P2002 would otherwise take the parent's flip down with it, so it
        // falls through to the update the winner's row now admits. Every figure here
        // is recomputed from the window rather than incremented, so both statements
        // write the same values and the order they land in does not matter.
        if (!isUniqueViolation(cause)) throw cause;
        await tx.topicMastery.update({
          where: { studentProfileId_topicId: { studentProfileId, topicId } },
          data: row,
        });
      }
    }
  }

  /**
   * Every Topic this child has a stored Mastery figure for, each with its counts
   * and its Weak Area verdict.
   *
   * **The first reader of `topic_mastery`.** Story 7.2 writes the table and nothing
   * read it; this is where a row becomes an answer. It lives on `GradingService`
   * because `topic_mastery` is `grading`'s table (AD-6, AD-17) — not a repository in
   * `practicetest` and not a controller reaching for Prisma.
   *
   * **This method is deliberately unauthorized, and that is not an oversight.**
   * Every other read on this service — `resultsFor`, `runHistoryFor`,
   * `parentResultsFor`, `gradeDisputesFor` — takes a scope and filters on
   * `parentAccountId`. This one takes a bare `studentProfileId` and filters on
   * nothing else, so **it will happily read any child in the system, including one
   * belonging to another parent.** It is safe only because its caller has *already*
   * established that the asker may see this profile. Story 7.4 owns that: the route,
   * the parent scope check that the profile belongs to the requesting account, and
   * the elevation guard in front of it. Until then this has no caller but the
   * int-spec.
   *
   * **No controller may call this without that check.** A controller that passes a
   * `studentProfileId` straight off the request into this method is an IDOR: one
   * parent reading another child's Mastery by guessing an id. If a caller cannot
   * point at the check it made first, it is not allowed to call this. The signature
   * does not enforce it because the story fixes the signature; the rule is stated
   * here instead, and it is a hard rule.
   *
   * **Classification happens here, once.** `isWeakArea` is called on the counts as
   * they are read, so no surface downstream of this compares a percentage of its own
   * and no two surfaces can disagree about what a Weak Area is. Retuning either
   * figure changes every answer at once, because nothing stored says `weakArea`.
   *
   * Ordered by `topicId` so the answer is stable across calls. It is **not** a
   * presentation order: ranking weak Topics first, filtering by Subject and naming
   * the Topics are Story 7.4's, on top of this view.
   *
   * A profile with no history answers `[]`. That is not an error and it is not a row
   * of zeros: a child who has answered nothing has no Mastery, and Story 7.4's empty
   * state needs that to stay distinguishable from a real zero.
   */
  async masteryFor(studentProfileId: string): Promise<TopicMasteryView[]> {
    const rows = await this.prisma.topicMastery.findMany({
      where: { studentProfileId },
      orderBy: { topicId: 'asc' },
      select: {
        topicId: true,
        correct: true,
        incorrect: true,
        unanswered: true,
        attemptsCounted: true,
        value: true,
      },
    });
    return rows.map((row) => ({
      ...row,
      answered: answeredOf(row),
      isWeakArea: isWeakArea(row),
    }));
  }

  // --- Internals ---------------------------------------------------------

  /**
   * Resolves the canonical Topic of every label on one Attempt's paper, and writes
   * the tags.
   *
   * **It runs outside every transaction and it never throws.** `normalize` makes
   * provider calls — an embedding, then possibly a structured-output call — which
   * take seconds and are retried; a transaction held open around one is a row lock
   * held for the length of an outage, which is why `topic.service.ts`'s own doc
   * forbids it. And the region it runs in is the region whose documented rule is that
   * nothing may throw: the hand-in is already committed and a parent's override is
   * about to be, so a provider outage must cost the tags and never the answer. Every
   * fault class is swallowed, per label and again around the whole of it.
   *
   * **A partial result is kept.** The labels that did resolve are tagged even when a
   * sibling label's normalization failed, because a later results read calls this
   * again and completes what is missing — there is no queue and nothing polls, so the
   * next read *is* the retry.
   *
   * Two early exits, and both are silent about content. A Practice Test behind an
   * unclassified Source Test has no Subject to scope a canonical set by, so nothing
   * is tagged and one log line names the Practice Test. A retake is excluded by
   * `countsTowardMastery`, so its labels are never resolved at all — a run that can
   * never contribute to Mastery must not spend a provider call.
   *
   * Idempotent by the unique index rather than by a check: `createMany` with
   * `skipDuplicates` means a second read, a concurrent one, and two labels on one
   * Question that canonicalize to the same Topic all come to one row.
   */
  private async tagTopicsFor(parentAccountId: string, attemptId: string): Promise<void> {
    try {
      // `this.prisma` and not a transaction client, deliberately: there is no
      // transaction here, and there must not be one.
      const context = await this.practiceTests.masteryContextFor(this.prisma, attemptId);
      // An Attempt that no longer resolves. Nothing to tag, and not a fault worth a
      // line: the caller is running beside work that is already committed.
      if (context === null) return;
      // A retake's labels are never resolved: it can never contribute to Mastery, so
      // canonicalizing its paper would be provider calls spent on nothing.
      if (!countsTowardMastery(context.ordinal)) return;
      if (context.subjectId === null) {
        // The Practice Test id and the class of fault, and nothing else — never a
        // label, a Topic name or a Question (AD-20).
        this.logger.warn(
          `Practice test ${context.practiceTestId} sits behind an unclassified source test; its topics are not canonicalized.`,
        );
        return;
      }
      const { subjectId } = context;

      // **Distinct labels, resolved once each.** A paper of twenty Questions on four
      // Topics spells the same four labels twenty times, and normalizing per
      // occurrence would be sixteen provider calls bought for nothing.
      const labels = [...new Set(context.questions.flatMap((question) => question.labels))];
      const topicIdByLabel = new Map<string, string>();
      for (const label of labels) {
        try {
          topicIdByLabel.set(
            label,
            await this.topics.normalize({ label, subjectId, parentAccountId }),
          );
        } catch (cause) {
          // The class of fault alone. Never the label — a generated Topic name is
          // content (AD-20) — and never a throw: the labels that did resolve are
          // still worth tagging, and the next results read re-asks for this one.
          this.logger.warn(
            `A topic label of attempt ${attemptId} could not be canonicalized (${faultNameOf(cause)}); it is left untagged.`,
          );
        }
      }

      const rows = context.questions.flatMap((question) =>
        [...new Set(question.labels)]
          .map((label) => topicIdByLabel.get(label))
          .filter((topicId): topicId is string => topicId !== undefined)
          .map((topicId) => ({
            questionId: question.questionId,
            practiceTestId: context.practiceTestId,
            topicId,
          })),
      );
      if (rows.length === 0) return;
      // `skipDuplicates` rather than a read-then-write: the unique index is the
      // guard, so a second pass over the same paper writes nothing and two labels
      // that canonicalized to one Topic come to one row. Duplicates within `rows`
      // are absorbed by the same index.
      await this.prisma.questionTopic.createMany({ data: rows, skipDuplicates: true });
    } catch (cause) {
      // The Attempt and the class of fault. The whole of it is guarded rather than
      // the parts that were foreseen, for the reason `submitAttempt`'s own guard
      // states: a lost race, a dropped connection or a fault class nobody
      // anticipated must not answer a child 500 for work the server kept.
      this.logger.error(
        `Canonicalizing the topics of attempt ${attemptId} failed (${faultNameOf(cause)}); no tag was written for it.`,
      );
    }
  }

  /**
   * Recomputes the Mastery every Topic of one Attempt's paper feeds, inside the
   * caller's transaction.
   *
   * The adapter between "a grade on this Attempt changed" and `recomputeMastery`'s
   * "these Topics of this child": it resolves whose run it is, which run it is, and
   * which Topics the paper is tagged with, and then calls the one path.
   *
   * **It exits before any read on a retake**, which is the whole of the retake rule:
   * a later run is excluded by `countsTowardMastery` rather than by a filter at each
   * call site, so handing in a retake, resolving one of its `Ungraded` rows and
   * overriding one of its grades all change no Mastery row at all.
   *
   * Reads the tags of the paper rather than being told them, because what a Question
   * is about is a stored fact and a caller that passed a list would be a second place
   * that list could be wrong. A paper with no tags — nothing generated a label, or
   * every label's normalization failed — recomputes nothing, which is correct: there
   * is no Topic for the evidence to be about.
   *
   * **`attemptMasteryKeyFor` and not `masteryContextFor`**: this runs inside the
   * caller's transaction, and that read would take a second pooled connection through
   * `sourcetest` while this one holds locks, for a Subject nothing here reads.
   */
  private async recomputeMasteryForAttempt(
    tx: TransactionClient,
    attemptId: string,
  ): Promise<void> {
    const key = await this.practiceTests.attemptMasteryKeyFor(tx, attemptId);
    if (key === null) return;
    if (!countsTowardMastery(key.ordinal)) return;

    const tagged = await tx.questionTopic.findMany({
      where: { practiceTestId: key.practiceTestId },
      select: { topicId: true },
      distinct: ['topicId'],
    });
    if (tagged.length === 0) return;

    await this.recomputeMastery(
      tx,
      key.studentProfileId,
      tagged.map((tag) => tag.topicId),
    );
  }

  /**
   * One batched `Grading` call, re-issued while the post-hoc pass keeps rejecting
   * what came back, degrading to nothing rather than to a guess.
   *
   * The retry is the point, and it is the one `produceDraft` makes for the same
   * reason: a verdict list that does not answer exactly the ordinals asked is the
   * provider's fault (AD-31), and `AiService`'s own loop cannot see it because the
   * payload parsed and the call returned. Bounded by `AI_MAX_ATTEMPTS`, the same
   * figure upstream faults are retried under.
   *
   * **Every failure class ends the same way**: `null`, which the caller writes as
   * `Ungraded`. An `AiInputError` and an `AiRejectedError` escape `AiService`'s own
   * loop immediately and are caught here; an exhausted `AiUpstreamError` and an
   * exhausted rejection arrive here too. Grading is **never gated by an allowance**
   * and never blocked by one — an unaffordable grade would be a child punished for
   * a billing state — so there is no third outcome to distinguish.
   */
  private async judge(
    parentAccountId: string,
    attemptId: string,
    questions: readonly GradingQuestionInput[],
  ): Promise<Map<number, NormalizedVerdict> | null> {
    const asked: GradingPromptQuestion[] = questions.map((question) => ({
      ordinal: question.ordinal,
      format: question.format,
      prompt: plainTextOf(question.prompt),
      correctAnswer: correctAnswerOf(question),
      answerValue: question.answerValue ?? '',
      topics: question.topics,
    }));
    const askedOrdinals = asked.map((question) => question.ordinal);
    const maxAttempts = this.ai.config.maxAttempts;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let payload: GradingPayload;
      try {
        ({ payload } = await this.ai.run({
          callClass: 'Grading',
          parentAccountId,
          // Text in, text out: this call reads stored answers, never a photograph.
          // Stated rather than inferred from an empty array.
          modality: 'text',
          images: [],
          prompt: buildGradingPrompt(asked),
          schema: GradingPayload,
          schemaName: GRADING_SCHEMA_NAME,
          fakePayload: ({ failure }) =>
            fakeGradingPayload({
              questions: asked.map((question) => ({
                ordinal: question.ordinal,
                correctAnswer: question.correctAnswer,
                answerValue: question.answerValue,
              })),
              failure,
            }),
        }));
      } catch (cause) {
        // The three fault classes, and all of them end here. The Attempt id and
        // the class of fault; never a Question, an answer or a word the model
        // wrote (AD-20).
        if (
          cause instanceof AiInputError ||
          cause instanceof AiRejectedError ||
          cause instanceof AiUpstreamError
        ) {
          this.logger.warn(
            `Grading for attempt ${attemptId} could not be completed (${cause.name}); ${questions.length} questions are left ungraded.`,
          );
          return null;
        }
        throw cause;
      }

      try {
        const verdicts = validateGradingPayload(payload, askedOrdinals);
        return new Map(verdicts.map((verdict) => [verdict.ordinal, verdict]));
      } catch (cause) {
        // Only a post-hoc rejection is worth asking again for. Anything else is
        // this module's own fault and is not made better by repetition.
        if (!(cause instanceof GradingPayloadInvalid)) throw cause;
        // The Attempt and the attempt number. Never the rule that was broken in
        // the model's own words, and never a fragment of what it wrote (AD-20).
        this.logger.warn(
          `A Grading payload for attempt ${attemptId} was rejected after parsing on attempt ${attempt} of ${maxAttempts}.`,
        );
      }
    }
    this.logger.warn(
      `Grading for attempt ${attemptId} was rejected on every attempt; ${questions.length} questions are left ungraded.`,
    );
    return null;
  }

  /**
   * Writes rows without ever overwriting a judgement that already stands, and
   * without a read-then-write anybody can lose.
   *
   * The read tells this pass what is worth attempting; **the writes are what make
   * it safe**. An insert is a `createMany` with `skipDuplicates`, so a row that
   * appeared between the read and the write is skipped rather than surfacing a
   * P2002 out of a path — a results view — whose own doc promises it still
   * answers. An update is an `updateMany` carrying `state: 'Ungraded'` in its
   * `where`, so the guard is the statement rather than a decision made off a stale
   * snapshot. Two concurrent passes therefore both answer, and the loser writes
   * nothing.
   *
   * A stored `Unanswered`, `Correct` or `Incorrect` is left exactly as it was, down
   * to its `updatedAt` — the first two verdicts are facts a later pass has no new
   * information about, and `Unanswered` is the one state only the hand-in itself
   * can know. `Ungraded` over an already-`Ungraded` row is skipped too: it changes
   * nothing, and a Question nothing can ever judge would otherwise have its
   * `updatedAt` bumped by every results view for the rest of its life.
   *
   * Returns the Questions it actually wrote a verdict for, **from what the writes
   * reported** rather than from the read alone, in the order given — which is what
   * `newlyGradedQuestionIds` is honest about.
   */
  private async writeGuarded(
    tx: TransactionClient,
    attemptId: string,
    rows: readonly GradeRow[],
  ): Promise<string[]> {
    if (rows.length === 0) return [];
    const stored = await tx.questionGrade.findMany({
      where: { attemptId, questionId: { in: rows.map((row) => row.questionId) } },
      select: { questionId: true, state: true },
    });
    const byQuestion = new Map(stored.map((row) => [row.questionId, row.state]));

    const written: string[] = [];
    for (const row of rows) {
      const existing = byQuestion.get(row.questionId);
      // A verdict that already stands, or a blank the hand-in already named, is
      // never reconsidered.
      if (existing !== undefined && existing !== 'Ungraded') continue;
      // Nothing to say, so nothing to write.
      if (existing === 'Ungraded' && row.state === 'Ungraded') continue;

      if (existing === undefined) {
        const inserted = await tx.questionGrade.createMany({
          data: [
            {
              attemptId,
              questionId: row.questionId,
              state: row.state,
              rationale: row.rationale,
            },
          ],
          skipDuplicates: true,
        });
        if (inserted.count === 1) {
          // `Ungraded` is not a verdict, so writing one is not grading anything.
          if (row.state !== 'Ungraded') written.push(row.questionId);
          continue;
        }
        // Somebody inserted between the read and here. A row now exists, so writing
        // `Ungraded` over it could only either churn an identical row or undo a
        // verdict the winner reached; a real verdict falls through to the guarded
        // update, which lands only on an `Ungraded` row.
        if (row.state === 'Ungraded') continue;
      }

      const updated = await tx.questionGrade.updateMany({
        where: { attemptId, questionId: row.questionId, state: 'Ungraded' },
        data: { state: row.state, rationale: row.rationale },
      });
      if (updated.count === 1 && row.state !== 'Ungraded') written.push(row.questionId);
    }
    return written;
  }

  /** FR-37's denominator, over one entry per presented Question. */
  private async scoreFor(attemptId: string, input: AttemptGradingInput): Promise<AttemptScore> {
    const stored = await this.prisma.questionGrade.findMany({
      where: { attemptId },
      select: { questionId: true, state: true },
    });
    const byQuestion = new Map(stored.map((row) => [row.questionId, row.state]));
    return scoreOf(input.questions.map((question) => byQuestion.get(question.questionId) ?? null));
  }
}

/**
 * Plain text of the stored correct answer.
 *
 * There is no options branch, because `askable` is the only gate `judge` lets a
 * Question through and it requires a readable stored free-text answer — a Multiple
 * Choice Question never reaches a provider at all.
 */
function correctAnswerOf(question: GradingQuestionInput): string {
  return question.answer === null ? '' : plainTextOf(question.answer);
}

/** One `(Attempt, Question)` pair as a single map key. Two ids, one lookup. */
function refKey(attemptId: string, questionId: string): string {
  return `${attemptId}:${questionId}`;
}

/**
 * One `(Topic, Practice Test)` pair as a single map key.
 *
 * Its own function beside `refKey` rather than that one reused: the two compose
 * different pairs, and a single "two ids, one string" helper would let a key built
 * from one pair be looked up in a map keyed by the other without a word of
 * complaint from the compiler.
 */
function topicTestKey(topicId: string, practiceTestId: string): string {
  return `${topicId}:${practiceTestId}`;
}

/**
 * Whether a write lost a race on a unique index.
 *
 * The same two-line predicate `explanation.service.ts` and `practice-test.service.ts`
 * each keep file-locally, and file-local here for their reason: it is a fact about a
 * Prisma error code, and a shared helper would be a module boundary crossed for two
 * lines.
 */
function isUniqueViolation(cause: unknown): boolean {
  return (
    typeof cause === 'object' && cause !== null && (cause as { code?: unknown }).code === 'P2002'
  );
}

/** A fault's class, for a log line that may carry nothing else (AD-20). */
function faultNameOf(cause: unknown): string {
  return cause instanceof Error ? cause.name : 'unknown fault';
}

/**
 * Whether this Question is one a provider is asked about: answered, free-text,
 * and with a stored correct answer to judge against.
 *
 * A Question whose stored answer cannot be read back is not sent — there is
 * nothing to compare with, so the call would be money spent on a guess — and it
 * falls through to `Ungraded`, which is exactly what that state is for.
 */
function askable(question: GradingQuestionInput): boolean {
  if (!isFreeText(question)) return false;
  if (question.answerValue === null || question.answerValue.trim().length === 0) return false;
  return question.answer !== null && plainTextOf(question.answer).trim().length > 0;
}

/**
 * Every verdict that needs no network, for the Questions given.
 *
 * The deterministic verdict, in one place. A blank is `Unanswered` on a manual
 * hand-in and `Incorrect` on an expired one; an answered Multiple Choice Question
 * is an **ordinal comparison, not a text one** — the browser submits the chosen
 * choice's ordinal as a string. Unparseable or unknown is `Incorrect`; `Ungraded`
 * would claim a provider was asked and could not answer.
 *
 * A Question this cannot decide without a provider gets no row here: either the
 * call will answer for it, or `Ungraded` will.
 */
function deterministicRows(
  input: AttemptGradingInput,
  questions: readonly GradingQuestionInput[],
): GradeRow[] {
  const rows: GradeRow[] = [];
  for (const question of questions) {
    // A blank is a Question with no answer row at all, or one whose value was
    // whitespace — which the write path never stored as an answer.
    if (question.answerValue === null || question.answerValue.trim().length === 0) {
      rows.push({
        questionId: question.questionId,
        // FR-37's two readings of an empty field, told apart by the column the
        // server wrote at submit rather than by anything a browser sent.
        state: input.expired ? 'Incorrect' : 'Unanswered',
        rationale: null,
      });
      continue;
    }
    if (question.format === 'MultipleChoice') {
      const raw = question.answerValue.trim();
      // **Digits and nothing else.** `Number.parseInt` reads `1abc`, `1.9` and `+1`
      // all as 1, so on a paper whose first option is the right one every one of
      // them would be credited `Correct` — and none of them is an ordinal the screen
      // could have submitted. The rule is that an unparseable or unknown ordinal is
      // `Incorrect`, so what is not an ordinal is refused before it is compared.
      const chosen = /^\d+$/u.test(raw) ? Number.parseInt(raw, 10) : null;
      rows.push({
        questionId: question.questionId,
        state:
          chosen !== null &&
          question.correctChoiceOrdinal !== null &&
          chosen === question.correctChoiceOrdinal
            ? 'Correct'
            : 'Incorrect',
        // No rationale: nothing explained this, a comparison decided it.
        rationale: null,
      });
      continue;
    }
    // Answered free text. Either the provider answers for it or `Ungraded` does,
    // and neither is this function's to write.
    if (!askable(question)) {
      rows.push({ questionId: question.questionId, state: 'Ungraded', rationale: null });
    }
  }
  return rows;
}

/**
 * The rows one batch's outcome comes to: a verdict where the call delivered one,
 * `Ungraded` where it did not.
 *
 * `null` verdicts — every failure class — makes every Question in the batch
 * `Ungraded` together. That is the cost of batching, and it is a state the retry
 * path already exists for.
 */
function rowsFromVerdicts(
  questions: readonly GradingQuestionInput[],
  verdicts: Map<number, NormalizedVerdict> | null,
): GradeRow[] {
  return questions.map((question) => {
    const verdict = verdicts?.get(question.ordinal);
    if (verdict === undefined) {
      return { questionId: question.questionId, state: 'Ungraded' as const, rationale: null };
    }
    return {
      questionId: question.questionId,
      state: verdict.correct ? ('Correct' as const) : ('Incorrect' as const),
      rationale: verdict.rationale,
    };
  });
}
