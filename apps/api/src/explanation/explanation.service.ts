import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AiInputError, AiRejectedError, AiService, AiUpstreamError } from '../ai/ai.service.js';
import { AllowanceService } from '../allowance/allowance.service.js';
import type { RichText } from '../extraction/rich-text.js';
import {
  PracticeTestService,
  type ExplanationInput,
} from '../practicetest/practice-test.service.js';
import { remainingFor } from '../practicetest/practice-test-policy.js';
import { PrismaService, type TransactionClient } from '../prisma/prisma.service.js';
import type { ExplanationFlagDisposition } from '../generated/prisma/enums.js';
import { adminQueueEntries, type AdminFlaggedExplanationView } from './admin-flag-queue.js';
import {
  PARENT_FLAG_ORIGIN,
  QUEUED_FLAG_DISPOSITION,
  STUDENT_FLAG_ORIGIN,
  parentExplanationViews,
  type ParentExplanationView,
  type StudentExplanationFlagView,
} from './explanation-flag.js';
import { ExplanationPayloadInvalid, validateExplanationPayload } from './explanation-payload.js';
import {
  EXPLANATION_FAILED,
  FLAG_ALREADY_DISPOSED,
  NO_EXPLANATION_ALLOWANCE,
  NO_EXPLANATION_TO_FLAG,
  NO_EXPLANATION_TO_REGENERATE,
  NO_EXPLANATION_TO_SUPPRESS,
  NO_STUDENT_FLAG_TO_DISPOSE,
  NOTHING_TO_REGENERATE,
  SUPPRESSION_NEEDS_A_FLAG,
} from './explanation-policy.js';
import { suppressedQuestionIds, suppressionUnlocked } from './explanation-suppression.js';
import { buildExplanationPrompt } from './explanation-prompt.js';
import {
  EXPLANATION_SCHEMA_NAME,
  ExplanationPayload,
  fakeExplanationPayload,
} from './explanation-schema.js';

/**
 * A child asking about their own work, with **both** ids required.
 *
 * Both, and not optionally the profile: an Explanation is written for the child
 * who sat the Attempt and is cached under their id, so a caller without one has no
 * cache key to read and no register to pitch at. The parent-side reading surface
 * is Story 6.3's, and it will bring its own scope rather than widening this one.
 */
export interface StudentScope {
  parentAccountId: string;
  studentProfileId: string;
}

/**
 * A parent reading or flagging their child's Explanations, with **only** the
 * account.
 *
 * Only the account, and deliberately not an optional profile beside it: a parent's
 * entitlement *is* the account, and the child whose rows are read is resolved from
 * the Attempt row through `attemptProfileFor`. A profile id that could be passed
 * here is a profile id that could be paired with another child's Attempt, and the
 * way to make that unexpressible is for the scope to have nowhere to put one.
 *
 * `GradingScope` makes the same distinction with an optional field, because the same
 * method there serves both parties. These two paths serve only the parent, so the
 * type says so.
 */
export interface ParentScope {
  parentAccountId: string;
}

/**
 * One Explanation the child is being served, as they get it back.
 *
 * `studentFlaggedAt` is **the child's own flag and nothing else** — it is the one flag
 * fact a student-scoped response carries, by the shape of the type rather than by a
 * discipline at each call site. There is nowhere here for a parent flag, a disposition
 * or a count to travel, which is what makes "a student sees only their own flag's
 * existence" a property of the code (AD-20, AD-26). A dismissal in particular is
 * recorded and relayed to nobody.
 *
 * It rides on this response rather than having a read of its own: the panel unmounts on
 * collapse, so reopening it re-issues the same `POST`, which answers 200 from the
 * stored row — so the reported state survives a reload and a re-open with no second
 * request and no new endpoint.
 *
 * `replacement` is `generation > 1`, and it is the **second** of exactly two new facts a
 * student surface learned in Story 6.4: that the one they are being served is a new
 * explanation. A boolean and not the ordinal, because "which of four" is a fact about a
 * history the child has no business reading — and it names no parent, no reason and no
 * instant.
 */
export interface StudentExplanationServed extends StudentExplanationFlagView {
  attemptId: string;
  questionId: string;
  /** The discriminant. Always `false` here, so a `switch` over the union is exhaustive. */
  suppressed: false;
  /** The stored segments, exactly as stored (AD-32). */
  body: RichText;
  /** Whether this is a replacement for one a parent removed. Never which, and never why. */
  replacement: boolean;
}

/**
 * The whole of what a child is told about an Explanation a parent removed: that one did.
 *
 * Two ids and the discriminant, and **nowhere for anything else to sit**. No body, no
 * flag instant, no removal instant, no reason, no disposition and no hint of who decided
 * beyond "a parent", which is the web's own word and not a field here: the student
 * surface learns exactly one new fact, and a shape with no room for a second is what
 * makes that a property of the code rather than a discipline at each call site (AD-20,
 * AD-26).
 */
export interface StudentExplanationSuppressed {
  attemptId: string;
  questionId: string;
  /** The discriminant. Always `true` here. */
  suppressed: true;
}

/**
 * What a student-scoped Explanation read answers: the prose, or that a parent removed it.
 *
 * **A discriminated union rather than a nullable body plus a boolean.** A
 * `body: RichText | null` with a `suppressed` flag beside it would let one response say
 * "suppressed" and still carry prose, a flag instant or a reason — and the whole
 * discipline of this surface is that a student-scoped shape has nowhere for a
 * parent-scoped fact to sit. The union makes that guarantee the compiler's.
 */
export type StudentExplanationResponse = StudentExplanationServed | StudentExplanationSuppressed;

/**
 * One concern a child raised, as the parent's per-child list of them reads it.
 *
 * **It outlives the disposition**, which is why `disposition` is a field and not a
 * filter: a flag a parent dismissed stays listed, marked dismissed. A list that dropped
 * decided entries would make a parent's own decision look like the concern never
 * happened.
 *
 * The run and Question context arrives from `PracticeTestService`, so this module still
 * holds no `attempt`, `practiceTest` or `question` delegate (AD-17). Every context field
 * is nullable *together*: a ref whose Attempt no longer resolves keeps its place in the
 * list and loses its label, because the fact a concern was raised is not contingent on
 * being able to name what it was about.
 *
 * No prose, no grade, no score, no cost, no tier and no model name (AD-20, AD-26). The
 * prose is on the Attempt-detail screen, where it is read next to the Question it is
 * about.
 */
export interface StudentFlagListEntry {
  attemptId: string;
  questionId: string;
  /**
   * Which generation of that Question's Explanation this report is about.
   *
   * A suppression and a regeneration are what let one Question carry more than one
   * report now: the child can flag the removed generation and, later, its replacement,
   * and the two are different concerns about different rows. This is also what a list
   * of these entries keys itself by, so two reports about one Question render as two
   * entries rather than colliding on an id pair that stopped being unique.
   */
  generation: number;
  /** When the child raised it. */
  flaggedAt: string;
  /** What the parent decided, or null while it is awaiting a decision. */
  disposition: ExplanationFlagDisposition | null;
  /** When that decision was recorded, or null. */
  dispositionAt: string | null;
  practiceTestId: string | null;
  /** Which run of that Practice Test it was, or null for a context that no longer resolves. */
  runOrdinal: number | null;
  /** The number the child was shown, or null for a context that no longer resolves. */
  questionOrdinal: number | null;
  subjectName: string | null;
  submittedAt: string | null;
}

/** An Explanation or its absence, and whether this call is what produced it. */
export interface ExplanationOutcome {
  view: StudentExplanationResponse;
  /**
   * True only when this call generated and wrote the row. The controller turns
   * it into 201 against 200, which is the whole observable difference between a
   * call that billed a provider and one that read a row.
   *
   * **`false` on the suppressed arm**, so the split keeps meaning exactly what it means
   * today: a suppressed Question makes no provider call at all, so there is nothing for
   * a created-status to be honest about. A child is not shown a refusal for a decision a
   * grown-up made either — the suppressed answer is a 200.
   */
  generated: boolean;
}

/**
 * Every provider fault, absorbed into one sentence and one status.
 *
 * **503 rather than 500**, and rather than four statuses for four fault classes. A
 * timeout, a refusal on the merits, a request this service could not make and a
 * payload the post-hoc pass kept rejecting are four facts about a system, none of
 * them a fact about the Question or about the child — and 503 is the one that says
 * the honest thing to the only reader who matters here: not now, try again. It is
 * a `ServiceUnavailableException` rather than a plain error so nothing between here
 * and the wire has to remember to map it, and so no class of upstream fault can
 * survive into what a child reads (AD-20).
 *
 * Nothing retries it. The child pressing again is the retry.
 */
export class ExplanationUnavailable extends ServiceUnavailableException {
  constructor() {
    super(EXPLANATION_FAILED);
    this.name = 'ExplanationUnavailable';
  }
}

/**
 * The `explanation` module's one service: sole owner and sole writer of
 * `Explanation` (AD-17).
 *
 * Four rules hold every path here together.
 *
 * - **The stored row is read first, before `allowance` and before `ai`.** That is
 *   what makes "a re-read is free" a property of the code rather than a promise:
 *   a second ask for the same `(attemptId, questionId, studentProfileId)` cannot
 *   reach a provider call, because it returns two statements earlier.
 * - **Charging is the row.** There is no counter to debit and nothing to
 *   reconcile: `chargedAt` on the row *is* the charge, and counting rows in the
 *   period window is the usage (AD-14). Which is why the re-count and the insert
 *   share one transaction — outside it, two concurrent presses on a Free account
 *   with one unit left could each read "remaining = 1".
 * - **It holds no delegate of anybody else's tables.** Two reads cross the
 *   boundary — `PracticeTestService.explanationInputFor` for the student path,
 *   which brings the ownership proof, the Question, both answers and the Practice
 *   Test's Grade Level with it, and `attemptProfileFor` for the parent paths,
 *   which brings the ownership proof and which child sat the Attempt. There is no
 *   `practiceTest`, `attempt`, `answer`, `sourceTest` or taxonomy delegate here,
 *   and no `ai_call` write (AD-17).
 * - **Since Story 6.4 "the row" means the highest `generation`.** Every read path
 *   resolves it with `findFirst({ orderBy: { generation: 'desc' } })` and checks
 *   `suppressedAt` at serve time — never only by a cache key — so a suppressed Question
 *   returns before the allowance read and before `ai`, and the one free write on this
 *   surface reads no allowance at all.
 * - **Since Story 6.2 it also owns `explanation_flag`, and is its sole writer**
 *   (AD-17). The parent paths below are pure reads and one idempotent record:
 *   neither generates, neither consumes allowance, and a flag changes nothing —
 *   not the prose, not what the child is served, not a grade, not a score.
 * - **Nothing it logs or throws carries a fragment of generated content, a cost,
 *   a model name, a tier or an allowance figure** (AD-20, AD-26). Identifiers and
 *   counts only.
 */
@Injectable()
export class ExplanationService {
  private readonly logger = new Logger(ExplanationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly allowance: AllowanceService,
    private readonly practiceTests: PracticeTestService,
  ) {}

  /**
   * One Question's Explanation: the stored one if there is one, a new one if
   * there is allowance for it, and one refusal each for the two ways there is not.
   *
   * The ownership proof happens **first**, through `explanationInputFor`, even on
   * the cached path. It is what turns a foreign Attempt, a sibling's, an unknown
   * id, one still open and an alien Question into the single
   * `PRACTICE_TEST_NOT_FOUND` sentence (AD-18) — and reading a stored row by its
   * three ids before proving the binding would answer a stranger's id with a 404
   * for one reason and a row for another, which is exactly the difference an
   * enumeration attack reads.
   */
  async explanationFor(
    scope: StudentScope,
    attemptId: string,
    questionId: string,
  ): Promise<ExplanationOutcome> {
    const input = await this.practiceTests.explanationInputFor(
      scope.parentAccountId,
      scope.studentProfileId,
      attemptId,
      questionId,
    );

    // The read-through cache, and the reason a re-read is provably free: nothing
    // below this line runs for a Question that already has one.
    //
    // `findFirst` on the highest generation rather than `findUnique`, because since
    // Story 6.4 "the one that counts" is the newest generation and the key holds four
    // columns. Ordering by the ordinal and not by `createdAt`: two rows written inside
    // one millisecond have an unambiguous order by the column the writes maintain and
    // none by their instants.
    const stored = await this.prisma.explanation.findFirst({
      where: { attemptId, questionId, studentProfileId: scope.studentProfileId },
      orderBy: { generation: 'desc' },
      // The child's own flag, and only ever theirs: `STUDENT_FLAG_ORIGIN` in the `where`
      // is what makes a parent's flag and a disposition unreachable from this response
      // by the query rather than by a mapper's discipline (AD-20, AD-26). At most one
      // row by `@@unique([explanationId, origin])`.
      select: {
        body: true,
        generation: true,
        suppressedAt: true,
        flags: { where: { origin: STUDENT_FLAG_ORIGIN }, select: FLAG_INSTANT },
      },
    });
    // A parent settled this Question, so it can neither generate nor charge. **Before**
    // the allowance read and before `ai`, which is what makes "a suppressed Question is
    // free" a property of the code rather than a promise — and a 200 rather than a
    // refusal, because nothing failed and a child is not shown an error for a decision a
    // grown-up made.
    if (stored !== null && stored.suppressedAt !== null) {
      return { view: { attemptId, questionId, suppressed: true }, generated: false };
    }
    if (stored !== null) {
      return {
        view: {
          attemptId,
          questionId,
          suppressed: false,
          body: stored.body as RichText,
          studentFlaggedAt: studentFlaggedAtOf(stored.flags),
          replacement: stored.generation > 1,
        },
        generated: false,
      };
    }

    // Read before the provider call, so an account with nothing left is refused
    // without spending one. The authoritative check is the re-count inside the
    // write transaction below; this one exists so a capped account is told so
    // before a model is asked to write prose nobody will be given.
    const consumption = await this.allowance.consumptionFor(scope.parentAccountId);
    if (
      remainingFor(
        consumption.allowances.explanation.used,
        consumption.allowances.explanation.limit,
      ) === 0
    ) {
      throw new ConflictException(NO_EXPLANATION_ALLOWANCE);
    }

    // A Question whose stored prompt or correct answer could not be read degrades
    // to an empty span, and an explanation built around one is worse than none: it
    // would be invented, stored, charged and read by a child. Refused with the
    // same sentence every other fault gets, and nothing is charged for it. The
    // student's own answer is exempt — an empty string there is a real blank, not
    // a read failure.
    if (input.prompt.trim() === '' || input.correctAnswer.trim() === '') {
      this.logger.warn(
        `An explanation for question ${questionId} of attempt ${attemptId} was refused: the stored question or correct answer could not be read.`,
      );
      throw new ExplanationUnavailable();
    }

    const body = await this.write(scope.parentAccountId, input, attemptId, questionId);

    // Read again rather than reusing the figures above: a provider call takes
    // seconds to tens of seconds, and in that time the period can turn over or the
    // account's tier can change. Counting the window that was current when the
    // press started would charge a row into a period the count never measured.
    const authoritative = await this.allowance.consumptionFor(scope.parentAccountId);
    const limit = authoritative.allowances.explanation.limit;
    const windowStart = new Date(authoritative.periodStart);
    const windowEnd = new Date(authoritative.periodEnd);

    let row: { body: unknown };
    try {
      row = await this.prisma.withTransaction(async (tx) => {
        // Counted again, inside the transaction that writes the row. Derived from
        // charged rows — never a counter column, and never decremented (AD-14).
        // The same known, deferred gap `practicetest`'s own charging seam carries:
        // Postgres's default Read Committed isolation lets two concurrent requests
        // read the same pre-charge usage, so this narrows the window rather than
        // closing it.
        const charged = await tx.explanation.count({
          where: {
            parentAccountId: scope.parentAccountId,
            chargedAt: { gte: windowStart, lt: windowEnd },
          },
        });
        if (remainingFor(charged, limit) === 0) {
          throw new ConflictException(NO_EXPLANATION_ALLOWANCE);
        }
        return tx.explanation.create({
          data: {
            parentAccountId: scope.parentAccountId,
            studentProfileId: scope.studentProfileId,
            attemptId,
            questionId,
            body,
            // The child's own ask is always the first generation, and it is only ever
            // written into an empty (Attempt, Question, child) — the arm above returned
            // for every other case. That, plus the parent path only ever writing
            // `max + 1` over a suppressed row, is why at most one generation is ever
            // live and why no partial index states the rule a second time.
            generation: 1,
            // The durable marker the Explanation Allowance is counted from (AD-14).
            // Written here, in the transaction that writes the row, so a paid call
            // is never uncounted and a refused one never charges.
            chargedAt: new Date(),
          },
          select: { body: true },
        });
      });
    } catch (cause) {
      // Two first presses for the same Question at once: the unique key refuses
      // the loser, and the loser's answer is the winner's row. A child is never
      // shown a fault for having been quick, and this call's own body is dropped
      // rather than written as a second row. The re-read is outside the aborted
      // transaction, which cannot run another statement.
      if (!isUniqueViolation(cause)) throw cause;
      const winner = await this.prisma.explanation.findFirstOrThrow({
        where: { attemptId, questionId, studentProfileId: scope.studentProfileId },
        orderBy: { generation: 'desc' },
        select: {
          body: true,
          generation: true,
          suppressedAt: true,
          flags: { where: { origin: STUDENT_FLAG_ORIGIN }, select: FLAG_INSTANT },
        },
      });
      this.logger.log(
        `An explanation for question ${questionId} of attempt ${attemptId} was already written by a concurrent request.`,
      );
      // The winner's row can only be generation 1 here — the loser found nothing a
      // statement ago, so no generation existed to suppress or replace — but the
      // suppressed arm is stated rather than assumed away, because the one thing this
      // response must never do is carry prose for a Question a parent has settled.
      if (winner.suppressedAt !== null) {
        return { view: { attemptId, questionId, suppressed: true }, generated: false };
      }
      return {
        view: {
          attemptId,
          questionId,
          suppressed: false,
          body: winner.body as RichText,
          studentFlaggedAt: studentFlaggedAtOf(winner.flags),
          replacement: winner.generation > 1,
        },
        generated: false,
      };
    }

    // The Attempt, the Question, and nothing about what was written (AD-20).
    this.logger.log(
      `An explanation was written for question ${questionId} of attempt ${attemptId}.`,
    );
    return {
      // A row written one statement ago has no flag against it and cannot be suppressed:
      // `null` and `false` are stated rather than read back, because a second query for
      // facts that cannot be anything else would be a round trip bought for nothing. It
      // is generation 1 by the `create` above, so it is never a replacement.
      view: {
        attemptId,
        questionId,
        suppressed: false,
        body: row.body as RichText,
        studentFlaggedAt: null,
        replacement: false,
      },
      generated: true,
    };
  }

  /**
   * Every Explanation stored for one handed-in Attempt, as the parent reads them.
   *
   * **A pure read.** No provider call, no allowance read, no `Explanation` write and
   * no `chargedAt` touched. An Explanation the child never asked for does not exist
   * and is not generated here: a parent opening an Attempt with ten unexplained
   * Questions would otherwise bill ten provider calls against their own Explanation
   * Allowance for prose nobody asked for, and the child's own screen would then find
   * it already there. So this method is `findMany` and nothing else, and it shares no
   * code path with `explanationFor`.
   *
   * **The profile is resolved first, and never passed.** `attemptProfileFor` is both
   * the ownership proof and the answer to "which child's rows": a foreign Attempt, an
   * unknown id and one still open all throw the single `PRACTICE_TEST_NOT_FOUND`
   * sentence from there, before this method reads a row (AD-18). The `where` below is
   * then `(attemptId, studentProfileId)` with the profile off the Attempt itself,
   * which is what makes a sibling's Explanation of the same Practice Test
   * unreachable — a sibling sat a *different* Attempt, and their rows are keyed to it.
   *
   * A Question with no stored row is **absent**, not an empty entry: the screen is
   * what says nothing was explained, and an invented entry would be
   * indistinguishable from prose that came back blank.
   *
   * **Every generation, oldest first within a Question.** Since Story 6.4 a Question can
   * hold several rows — the one a parent removed and the replacement that followed it —
   * and both are here: the removed one because the parent who decided about it stays able
   * to read it, and the replacement because it is what the child is now being served. A
   * read that resolved only the highest one would hide exactly the prose an operator is
   * judging from the only person who can ask for it to be replaced again.
   */
  async explanationsForAttempt(
    scope: ParentScope,
    attemptId: string,
  ): Promise<ParentExplanationView[]> {
    const { studentProfileId } = await this.practiceTests.attemptProfileFor(
      scope.parentAccountId,
      attemptId,
    );

    const rows = await this.prisma.explanation.findMany({
      where: { attemptId, studentProfileId },
      // **Question id, then oldest generation first** — no longer "the order the child asked
      // in", which is what `createdAt` gave before Story 6.4 and which cannot group a
      // Question's generations together. Grouping is the point: the screen renders a
      // Question's history as one block, the removed explanation above the replacement that
      // followed it, and it looks entries up by Question id rather than reading this order.
      //
      // Neither key is meaningful on its own — the Question ids sort by uuid, not by the order
      // the child met them, and the screen keys these onto answer-key rows that already carry
      // that order. They are stated so the response is deterministic rather than whatever the
      // planner returns, and so a Question's generations arrive adjacent and in ordinal order.
      //
      // The second key is the ordinal the writes maintain and not `createdAt`, because two
      // rows written inside one millisecond have an unambiguous order by it and none by their
      // instants.
      orderBy: [{ questionId: 'asc' }, { generation: 'asc' }],
      select: {
        questionId: true,
        body: true,
        // The two columns suppression is, and the only new ones this read selects. They
        // are the whole of what makes a removed generation tellable from a live one, and
        // `canSuppress` is computed off them and the flags by the pure mapper.
        generation: true,
        suppressedAt: true,
        // **Both origins, unfiltered.** The parent reads their own concern and their
        // child's, so the `where` that pinned this to one origin is gone and the fold
        // moved into the pure mapper — where a row with two flags becomes two named
        // fields rather than an array a screen has to search. At most one row per
        // origin, by the unique key.
        //
        // `chargedAt` is still deliberately not selected: what an Explanation cost is
        // not a thing this response carries (AD-20, AD-26).
        flags: {
          select: { origin: true, createdAt: true, disposition: true, dispositionAt: true },
        },
      },
    });
    return parentExplanationViews(rows);
  }

  /**
   * Records that a parent has a concern about one Explanation, and answers with the
   * instant it was first recorded.
   *
   * **Idempotent per (Explanation, origin), by the index and not by a check.** The
   * write is an `upsert` on `[explanationId, origin]` whose update arm sets nothing
   * that matters, so a second press finds the first row, keeps its `createdAt` and
   * answers the same instant. A parent pressing twice raised one concern; a `create`
   * with a preceding existence check would race itself into a unique violation on
   * exactly the double-tap this is about.
   *
   * **And the upsert is not atomic either**, which is why there is a P2002 arm below
   * it. It reads and then writes, so two presses landing together can both find no row
   * and both attempt the insert; the index refuses the loser, and the loser's answer is
   * the winner's row, re-read by the same key. So idempotency holds under concurrency
   * as well as in sequence, and the one case this method exists for cannot be the one
   * case that 500s.
   *
   * **It changes nothing else.** Not the Explanation's body, not what the child is
   * served, not the grade state, the Attempt's score or Mastery. There is no
   * suppression here (Story 6.4), no disposition (Story 6.3) and no grade override
   * (Story 6.5) — and no write to any other table, which is why this needs no
   * transaction: there is one row to write and nothing anywhere that has to stay
   * consistent with it.
   *
   * **The ownership proof runs first**, through `attemptProfileFor`, then the
   * Explanation is found by `(attemptId, questionId, studentProfileId)` with the
   * profile off the Attempt row. A Question the child never asked about has no row and
   * answers the same `PRACTICE_TEST_NOT_FOUND` sentence a foreign Attempt gets: a
   * flag is a record *about an Explanation*, so there is nothing to record against,
   * and a second sentence would let the outside tell "no Explanation" from "not your
   * Attempt".
   *
   * The two denormalized ids on the flag row are the **Explanation's own**, read back
   * from the row this write is about — never the scope's account and never a
   * parameter. They are the same by construction here, and taking them from the row
   * means a future path that got the scoping wrong writes an inconsistent flag rather
   * than a consistent lie.
   */
  async flagExplanation(
    scope: ParentScope,
    attemptId: string,
    questionId: string,
  ): Promise<ParentExplanationView> {
    const { studentProfileId } = await this.practiceTests.attemptProfileFor(
      scope.parentAccountId,
      attemptId,
    );

    // The **highest** generation, which is the one the parent is reading and the one a
    // concern is about. A flag against the generation a child was served last week would
    // be a record nobody can act on: suppression and regeneration both work on the latest
    // one, and the queue's entry is the Explanation the flag names.
    const stored = await this.prisma.explanation.findFirst({
      where: { attemptId, questionId, studentProfileId },
      orderBy: { generation: 'desc' },
      select: {
        id: true,
        questionId: true,
        body: true,
        generation: true,
        suppressedAt: true,
        parentAccountId: true,
        studentProfileId: true,
        // The child's flag comes back with the row so the response this press answers
        // with still carries it. The parent's screen replaces its whole entry from this
        // view, so a response that dropped `studentFlaggedAt` would make reporting an
        // Explanation erase the child's own concern from the screen beside it.
        flags: {
          select: { origin: true, createdAt: true, disposition: true, dispositionAt: true },
        },
      },
    });
    // A Question nobody asked about, on an Attempt this parent may read. The same
    // sentence a foreign Attempt gets: there is no Explanation for a flag to be
    // about.
    if (stored === null) throw new NotFoundException(NO_EXPLANATION_TO_FLAG);

    const key = { explanationId: stored.id, origin: PARENT_FLAG_ORIGIN };
    let flag: { createdAt: Date };
    try {
      flag = await this.prisma.explanationFlag.upsert({
        where: { explanationId_origin: key },
        create: {
          explanationId: stored.id,
          // The Explanation's own columns, read back from the row above.
          parentAccountId: stored.parentAccountId,
          studentProfileId: stored.studentProfileId,
          origin: PARENT_FLAG_ORIGIN,
        },
        // Nothing. The second press is the same concern, and `createdAt` is the instant
        // it was first raised — an update arm that touched it would make a repeat press
        // rewrite the one fact this row holds. `updatedAt` moves, which is Prisma's and
        // is not read by anything.
        update: {},
        select: { createdAt: true },
      });
    } catch (cause) {
      // Two first presses at once. An `upsert` is a read and then a write, not one
      // atomic statement: both requests can find no row, both can attempt the insert,
      // and the unique key refuses the loser with P2002 — which is exactly the
      // double-tap this method exists to absorb, so answering 500 for it would be the
      // one case it was written for. The recovery is the same one `explanationFor`
      // makes for the same reason: the loser's answer is the winner's row.
      if (!isUniqueViolation(cause)) throw cause;
      flag = await this.prisma.explanationFlag.findUniqueOrThrow({
        where: { explanationId_origin: key },
        select: { createdAt: true },
      });
      this.logger.log(
        `A parent flag against the explanation of question ${questionId} of attempt ${attemptId} was already recorded by a concurrent request.`,
      );
    }

    // The Attempt, the Question and that a flag exists. Never a fragment of the
    // prose it is about, and never a cost, a tier or a model name (AD-20, AD-26).
    this.logger.log(
      `A parent flag is recorded against the explanation of question ${questionId} of attempt ${attemptId}.`,
    );

    const [view] = parentExplanationViews([
      {
        questionId: stored.questionId,
        body: stored.body,
        generation: stored.generation,
        suppressedAt: stored.suppressedAt,
        // The row's other flags as they were read, with this press's own put beside
        // them — composed rather than re-read, because a parent-origin flag's
        // disposition is null by definition and a second query would only confirm what
        // the write already decided. Any parent-origin row from the read is dropped: the
        // upsert above is the current state of that one.
        flags: [
          ...stored.flags.filter((held) => held.origin !== PARENT_FLAG_ORIGIN),
          {
            origin: PARENT_FLAG_ORIGIN,
            createdAt: flag.createdAt,
            // A parent-origin flag is their own judgement; there is nothing to decide.
            disposition: null,
            dispositionAt: null,
          },
        ],
      },
    ]);
    // One row in, one row out. Stated rather than asserted away, so a future change
    // to the mapper cannot make a non-null assertion quietly wrong.
    if (view === undefined) throw new ExplanationUnavailable();
    return view;
  }

  /**
   * Records that the **child** has a concern about the Explanation they are reading,
   * and answers with the same prose plus the instant it was recorded.
   *
   * **It changes nothing the child is reading or served.** No `Explanation.body` write,
   * no `chargedAt` touch, no allowance movement, no grade, score or Mastery write, and
   * no provider call: the response carries the stored segments byte-for-byte, so the
   * panel on screen has nothing to redraw but the flag's own state. Reporting is not a
   * retraction of what was said.
   *
   * **It surfaces to the parent only.** The row is written at `origin: Student` and the
   * reader is `explanationsForAttempt` and the parent's per-child list; nothing
   * student-scoped ever reads a parent flag or a disposition, and an *unconfirmed*
   * student flag has no Admin reader at all — `flaggedForAdmin` filters it out in the
   * query. So a child who reports something learns only that their own report exists,
   * and a parent's dismissal is recorded and relayed to nobody (AD-20, AD-26).
   *
   * **The ownership proof runs first, through `explanationInputFor`**, exactly as
   * `explanationFor` runs it first and for the same reason: a foreign Attempt, a
   * sibling's, an unknown id, one still open and a Question of another test all become
   * the single `PRACTICE_TEST_NOT_FOUND` sentence before a row is read (AD-18). Reading
   * the stored row by its three ids before proving the binding would answer a
   * stranger's id with a 404 for one reason and a row for another, which is the
   * difference an enumeration attack reads.
   *
   * **Idempotent per (Explanation, origin), by the index and not by a check** — the
   * same upsert-plus-P2002 shape `flagExplanation` makes, for the same reasons: a
   * repeat press is the same concern and answers the first `createdAt`, and two first
   * presses landing together leave one row with the loser answering the winner's.
   */
  async flagExplanationAsStudent(
    scope: StudentScope,
    attemptId: string,
    questionId: string,
  ): Promise<StudentExplanationResponse> {
    await this.practiceTests.explanationInputFor(
      scope.parentAccountId,
      scope.studentProfileId,
      attemptId,
      questionId,
    );

    // The **highest** generation, exactly as the read path resolves it: a report is about
    // the explanation on screen, and the one on screen is the newest.
    const stored = await this.prisma.explanation.findFirst({
      where: { attemptId, questionId, studentProfileId: scope.studentProfileId },
      orderBy: { generation: 'desc' },
      select: {
        id: true,
        body: true,
        generation: true,
        suppressedAt: true,
        parentAccountId: true,
        studentProfileId: true,
      },
    });
    // A Question this child never asked about. There is no Explanation for a report to
    // be about, and it is the same sentence a foreign Attempt gets: a second sentence
    // here would let the outside tell "nothing explained" from "not your Attempt".
    if (stored === null) throw new NotFoundException(NO_EXPLANATION_TO_FLAG);
    // A stale tab pressing report on prose a parent has since removed. The same 200 the
    // read path gives, nothing written, and — the point — **no body on the way out**: a
    // response that carried the prose would put an Explanation a parent settled back on a
    // child's screen, which is the one thing suppression exists to prevent. The panel
    // replaces the paragraph and the control with the two lines it draws for the
    // suppressed state.
    if (stored.suppressedAt !== null) {
      return { attemptId, questionId, suppressed: true };
    }

    const key = { explanationId: stored.id, origin: STUDENT_FLAG_ORIGIN };
    let flag: { createdAt: Date };
    try {
      flag = await this.prisma.explanationFlag.upsert({
        where: { explanationId_origin: key },
        create: {
          explanationId: stored.id,
          // The Explanation's own columns, read back from the row above — never the
          // scope's ids and never a parameter. They are the same by construction here,
          // and taking them from the row means a future path that got the scoping wrong
          // writes an inconsistent flag rather than a consistent lie.
          parentAccountId: stored.parentAccountId,
          studentProfileId: stored.studentProfileId,
          origin: STUDENT_FLAG_ORIGIN,
        },
        // Nothing, and `disposition` least of all: a child pressing again is the same
        // concern, and an update arm that touched the disposition would let a second
        // press erase a decision their parent already made.
        update: {},
        select: { createdAt: true },
      });
    } catch (cause) {
      // Two first presses at once. An `upsert` reads and then writes, so both can find
      // no row and both attempt the insert; the unique key refuses the loser with
      // P2002, which is exactly the double-tap this absorbs. The loser's answer is the
      // winner's row.
      if (!isUniqueViolation(cause)) throw cause;
      flag = await this.prisma.explanationFlag.findUniqueOrThrow({
        where: { explanationId_origin: key },
        select: { createdAt: true },
      });
      this.logger.log(
        `A student flag against the explanation of question ${questionId} of attempt ${attemptId} was already recorded by a concurrent request.`,
      );
    }

    // The Attempt, the Question and that a flag exists. Never a fragment of the prose
    // it is about, and never a cost, a tier or a model name (AD-20, AD-26).
    this.logger.log(
      `A student flag is recorded against the explanation of question ${questionId} of attempt ${attemptId}.`,
    );

    return {
      attemptId,
      questionId,
      suppressed: false,
      // The prose, unchanged. Reporting an Explanation does not retract it.
      body: stored.body as RichText,
      studentFlaggedAt: flag.createdAt.toISOString(),
      // The same fact the read path states, so a report does not make the panel forget
      // that what it is holding is a replacement.
      replacement: stored.generation > 1,
    };
  }

  /**
   * Records what the parent decided about their child's concern, once and finally.
   *
   * **The transition is decided by the statement, not by a prior read.**
   * `updateMany({ where: { id, disposition: null } })` is what makes "the first decision
   * stands" true under two simultaneous presses: a read-then-write could have both
   * requests see `null` and both write, and the second writer would silently overturn a
   * decision an operator may already have acted on. The count the update reports is
   * deliberately ignored — what happened is read back from the row, so a loser and a
   * repeat press are answered by the state rather than by an inference about it.
   *
   * **Two values and no third**, and the closed set dies at the validation pipe rather
   * than here: a disposition is a closed enum in the DTO, so a third value never
   * reaches this method.
   *
   * - The same value again answers **200** with the instant the decision was *first*
   *   recorded. A double-tap is one decision.
   * - A different value answers **409** with the one `FLAG_ALREADY_DISPOSED` sentence,
   *   and nothing is rewritten. Reversal is not in FR-38, and a reversible confirm would
   *   mean an Explanation entering and leaving an operator's queue underneath them.
   *
   * **A disposition applies only to a student-origin flag.** A parent-origin flag is
   * already the parent's own judgement, so there is nothing to decide about it and no
   * path here that could write one — the flag is found by `origin: Student` and a
   * Question whose only flag is the parent's own answers the shared 404.
   *
   * **Confirming still does not suppress.** Nothing here writes `Explanation.body`, a
   * `chargedAt`, a `suppressedAt`, a grade, a score or Mastery, and the child is served
   * exactly the same prose afterwards. What confirming does is put the Explanation in
   * front of an operator and — since Story 6.4 — *unlock* suppression as something the
   * parent may then choose: `suppressionUnlocked` reads this disposition. Unlocking an
   * action is not performing it, and the screen says so in words before either.
   *
   * **It looks across every generation of the Question.** A child can report a suppressed
   * explanation and its replacement, so the flag this decides is the oldest **undecided**
   * student flag — the one nobody has read — falling back to the newest decided one for
   * the 200 and 409 arms.
   *
   * The ownership proof runs first, through `attemptProfileFor`, and the profile is
   * resolved from the Attempt row rather than passed — so a child's id cannot be paired
   * with another child's Attempt because there is nowhere to put one.
   */
  async disposeStudentFlag(
    scope: ParentScope,
    attemptId: string,
    questionId: string,
    disposition: ExplanationFlagDisposition,
  ): Promise<ParentExplanationView> {
    const { studentProfileId } = await this.practiceTests.attemptProfileFor(
      scope.parentAccountId,
      attemptId,
    );

    // **Every generation of this Question, oldest first.** A child can report a suppressed
    // explanation and its replacement, so a Question can hold two student flags — and the
    // decision that is owed is on the one nobody has read. Ordered here so the pick below
    // is a scan and not a sort.
    const generations = await this.prisma.explanation.findMany({
      where: { attemptId, questionId, studentProfileId },
      orderBy: { generation: 'asc' },
      select: {
        id: true,
        questionId: true,
        body: true,
        generation: true,
        suppressedAt: true,
        flags: {
          select: {
            id: true,
            origin: true,
            createdAt: true,
            disposition: true,
            dispositionAt: true,
          },
        },
      },
    });
    // The oldest **undecided** student flag, and the newest decided one where there is
    // none. The first is the decision that is owed; the second is what the 200/409 arms
    // below read a repeat or a reversal against, so a parent pressing twice on a Question
    // whose every report is decided is answered by the most recent decision rather than
    // by the oldest one they made.
    const withStudentFlag = generations.filter((row) =>
      row.flags.some((flag) => flag.origin === STUDENT_FLAG_ORIGIN),
    );
    const stored =
      withStudentFlag.find((row) =>
        row.flags.some((flag) => flag.origin === STUDENT_FLAG_ORIGIN && flag.disposition === null),
      ) ?? withStudentFlag.at(-1);
    const studentFlag = stored?.flags.find((flag) => flag.origin === STUDENT_FLAG_ORIGIN);
    // No Explanation at all, and an Explanation the child never reported, answer the
    // same sentence — as does a foreign or still-open Attempt, which threw above. There
    // is nothing of the child's here to decide about either way (AD-18).
    if (stored === undefined || studentFlag === undefined) {
      throw new NotFoundException(NO_STUDENT_FLAG_TO_DISPOSE);
    }

    await this.prisma.explanationFlag.updateMany({
      // `disposition: null` in the `where` is the whole of the "first decision stands"
      // rule: the row transitions out of undecided exactly once, and the database is
      // what decides which press did it.
      where: { id: studentFlag.id, disposition: null },
      data: { disposition, dispositionAt: new Date() },
    });

    // Read back rather than trusted: this request may have written the decision, may
    // have lost a race to an identical one, or may have been refused by the `where`
    // because the other decision is already recorded. All three are told apart here.
    const decided = await this.prisma.explanationFlag.findUniqueOrThrow({
      where: { id: studentFlag.id },
      select: { createdAt: true, disposition: true, dispositionAt: true },
    });
    if (decided.disposition !== disposition) {
      // The one 409 this surface has, and nothing was rewritten to produce it.
      this.logger.log(
        `A second, different disposition of the student flag against the explanation of question ${questionId} of attempt ${attemptId} was refused.`,
      );
      throw new ConflictException(FLAG_ALREADY_DISPOSED);
    }

    // The Attempt, the Question and which decision. Never a fragment of the prose, and
    // never a cost, a tier or a model name (AD-20, AD-26).
    this.logger.log(
      `The student flag against the explanation of question ${questionId} of attempt ${attemptId} is ${decided.disposition}.`,
    );

    // Re-read every flag on this Explanation rather than reusing `stored.flags`: that
    // read predates the write above, so a parent flag landing in the gap between the
    // two would otherwise vanish from this response even though the row itself is
    // correct on the next read.
    const currentFlags = await this.prisma.explanationFlag.findMany({
      where: { explanationId: stored.id },
      select: { origin: true, createdAt: true, disposition: true, dispositionAt: true },
    });

    const [view] = parentExplanationViews([
      {
        questionId: stored.questionId,
        body: stored.body,
        generation: stored.generation,
        suppressedAt: stored.suppressedAt,
        flags: currentFlags,
      },
    ]);
    // One row in, one row out. Stated rather than asserted away, so a future change to
    // the mapper cannot make a non-null assertion quietly wrong.
    if (view === undefined) throw new ExplanationUnavailable();
    return view;
  }

  /**
   * Every concern one child raised, newest first — awaiting and decided alike.
   *
   * **A flag the parent cannot find is a flag that did not surface.** The
   * Attempt-detail region shows a concern only to somebody who already opened that
   * Attempt, so this is the list that makes a child's report reachable at all: it is
   * where "it is listed for that child as awaiting a decision" is true.
   *
   * **It outlives the disposition.** A dismissed flag stays listed, marked dismissed —
   * `disposition` is a field here and never a filter. A list that dropped decided
   * entries would make a parent's own decision look like the concern never happened.
   *
   * **A foreign or unknown profile answers `[]`**, which is the same answer a child with
   * no reports gets, and this method does not try to tell them apart: the flag rows
   * carry `parentAccountId` denormalized, so the `where` simply matches nothing. A 404
   * for an unknown id would be a confirmation for a known one (AD-18), which is exactly
   * how `parentSubmittedRunsFor` answers a foreign profile too.
   *
   * The run and Question context arrives through one batched `PracticeTestService` read,
   * so this module still holds no `attempt`, `practiceTest` or `question` delegate
   * (AD-17). A ref whose context no longer resolves keeps its place and loses its
   * labels: whether a concern was raised is not contingent on being able to name what
   * it was about.
   *
   * No prose here, and no grade, score, cost, tier or model name (AD-20, AD-26).
   */
  async studentFlagsFor(
    scope: ParentScope,
    studentProfileId: string,
  ): Promise<StudentFlagListEntry[]> {
    const rows = await this.prisma.explanationFlag.findMany({
      // Both denormalized ids and the origin. The account is the parent's entitlement;
      // the profile is which child; the origin is what makes this the child's own
      // concerns and never the parent's own flags read back at them.
      where: {
        parentAccountId: scope.parentAccountId,
        studentProfileId,
        origin: STUDENT_FLAG_ORIGIN,
      },
      // Newest first, with the id behind it so two reports raised inside the same
      // millisecond still come back in a stable order.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        createdAt: true,
        disposition: true,
        dispositionAt: true,
        explanation: { select: { attemptId: true, questionId: true, generation: true } },
      },
    });
    if (rows.length === 0) return [];

    const contexts = await this.practiceTests.flaggedQuestionContextsFor(
      scope.parentAccountId,
      rows.map((row) => ({
        attemptId: row.explanation.attemptId,
        questionId: row.explanation.questionId,
      })),
    );
    const byRef = new Map(
      contexts.map((context) => [refKey(context.attemptId, context.questionId), context]),
    );

    return rows.map((row) => {
      const context = byRef.get(refKey(row.explanation.attemptId, row.explanation.questionId));
      return {
        attemptId: row.explanation.attemptId,
        questionId: row.explanation.questionId,
        generation: row.explanation.generation,
        flaggedAt: row.createdAt.toISOString(),
        disposition: row.disposition,
        dispositionAt: row.dispositionAt?.toISOString() ?? null,
        practiceTestId: context?.practiceTestId ?? null,
        runOrdinal: context?.runOrdinal ?? null,
        questionOrdinal: context?.questionOrdinal ?? null,
        subjectName: context?.subjectName ?? null,
        submittedAt: context?.submittedAt ?? null,
      };
    });
  }

  /**
   * Which Questions of one Attempt this child may not be shown an explanation for.
   *
   * **Ids and nothing else.** Not a body, not an instant, not a reason and not who
   * decided: the results screen needs to know whether to draw a control, and everything
   * beyond the ids would be a parent-scoped fact on a student-scoped read (AD-20, AD-26).
   *
   * **It exists so a child is never offered a control that undoes their parent's
   * decision.** The panel is mounted per row, so learning suppression at press time would
   * mean either a control one tap from spending an allowance unit on a Question a parent
   * has settled, or one request per Question on load. One attempt-scoped read answers it
   * once, for the whole paper.
   *
   * **A foreign or unknown Attempt answers `[]`**, which is the same answer a child with
   * nothing suppressed gets, and this method does not try to tell them apart: the rows
   * carry both ids denormalized, so the `where` simply matches nothing. A 404 for an
   * unknown id would be a confirmation for a known one (AD-18) — the same answer
   * `studentFlagsFor` gives a foreign profile, and for the same reason.
   *
   * **It is not the guarantee, it is the courtesy.** The guarantee is the serve-time check
   * in `explanationFor`, which returns the suppressed answer before the allowance read and
   * before any provider call. If this read fails or is stale the screen draws the control,
   * a press answers 200 suppressed, and nothing is generated and nothing is charged —
   * which is exactly why the check is at serve time and not a cache key.
   */
  async suppressedQuestionsFor(scope: StudentScope, attemptId: string): Promise<string[]> {
    const rows = await this.prisma.explanation.findMany({
      where: {
        parentAccountId: scope.parentAccountId,
        studentProfileId: scope.studentProfileId,
        attemptId,
      },
      // Three columns, and deliberately no `body`: the list of Questions a child may not
      // read an explanation for is not a list of explanations.
      select: { questionId: true, generation: true, suppressedAt: true },
    });
    // The latest generation is the one that counts, so a Question whose generation 1 is
    // suppressed and whose generation 2 is live is **absent** from this list: the child is
    // being served the replacement.
    return suppressedQuestionIds(rows);
  }

  /**
   * Stops one Explanation being served to the one child it was written for, for good.
   *
   * **Scoped to one Student Profile, and checked at serve time on every read path.** The
   * row this writes belongs to one (Attempt, Question, child), so a sibling who sat their
   * own Attempt of the same Practice Test is untouched by construction — their rows are
   * keyed to a different Attempt. And the suppression is a *serving rule*: `explanationFor`
   * reads `suppressedAt` on the row it resolves, which is what makes this more than a
   * cache key that a new read path could forget to consult.
   *
   * **Only once a concern is recorded**, and the rule is `suppressionUnlocked` — the same
   * predicate the Admin queue's two `where` arms state and the same one `canSuppress` is
   * computed from. A parent-origin flag qualifies; a student-origin one only once the
   * parent confirmed it. A Question with no flag, one whose only report is awaiting a
   * decision and one the parent dismissed are each refused with `SUPPRESSION_NEEDS_A_FLAG`
   * and nothing is written. Never automatic, and never available in Student Mode — there
   * is no student route that reaches this method.
   *
   * **Idempotent, and there is no sentence for a repeat.** `updateMany({ where: { id,
   * suppressedAt: null } })` is the whole of "the first instant stands": the row leaves
   * the live state exactly once and the database decides which press did it, so a
   * double-tap answers 200 with the **first** instant rather than a 409 about a decision
   * the parent already made. A read-then-write could have both presses see `null` and
   * both write, and the second would move the one fact this column holds.
   *
   * **Nothing is deleted and nothing is un-suppressed.** The row keeps its body, stays
   * readable here, and stays in front of an operator. There is no route that clears
   * `suppressedAt` and no column that could be flipped back.
   *
   * **It changes one Explanation and nothing else**: no grade state, no `GradeRow`, no
   * Attempt score, no Mastery, no dispute flag, no other Question, no other generation
   * and no other child. One `updateMany` against one id is the whole write, which is why
   * this needs no transaction.
   *
   * The ownership proof runs first, through `attemptProfileFor`, and the profile is
   * resolved from the Attempt row rather than passed — so a child's id cannot be paired
   * with another child's Attempt because there is nowhere to put one.
   *
   * It answers **every** generation of that Question, oldest first, so a screen that must
   * show the removed one beside its replacement gets both from the write it made.
   */
  async suppressExplanation(
    scope: ParentScope,
    attemptId: string,
    questionId: string,
  ): Promise<ParentExplanationView[]> {
    const { studentProfileId } = await this.practiceTests.attemptProfileFor(
      scope.parentAccountId,
      attemptId,
    );

    const latest = await this.prisma.explanation.findFirst({
      where: { attemptId, questionId, studentProfileId },
      orderBy: { generation: 'desc' },
      select: {
        id: true,
        suppressedAt: true,
        flags: { select: { origin: true, disposition: true } },
      },
    });
    // A Question nobody asked about, on an Attempt this parent may read. The same
    // sentence a foreign Attempt gets: there is no Explanation here to stop serving, and
    // spelling the two apart would let the outside read which ids exist (AD-18).
    if (latest === null) throw new NotFoundException(NO_EXPLANATION_TO_SUPPRESS);

    // The one predicate, and the reason the control a parent is offered and the refusal
    // they would get cannot disagree. Checked before the write and never after it.
    if (!suppressionUnlocked(latest.flags)) {
      this.logger.log(
        `A suppression of the explanation of question ${questionId} of attempt ${attemptId} was refused: no concern is recorded against it.`,
      );
      throw new ConflictException(SUPPRESSION_NEEDS_A_FLAG);
    }

    // `suppressedAt: null` in the `where` is the whole of the "first instant stands"
    // rule. The count is deliberately ignored: what happened is read back below, so a
    // repeat press is answered by the state rather than by an inference about it.
    await this.prisma.explanation.updateMany({
      where: { id: latest.id, suppressedAt: null },
      data: { suppressedAt: new Date() },
    });

    // The Attempt and the Question. Never a fragment of the prose that was removed, and
    // never a cost, a tier or a model name (AD-20, AD-26).
    this.logger.log(
      `The explanation of question ${questionId} of attempt ${attemptId} is no longer served to the student.`,
    );

    return this.generationsOf(attemptId, questionId, studentProfileId);
  }

  /**
   * Writes a replacement for an Explanation a parent removed, as a further generation,
   * charging nothing.
   *
   * **No allowance is read anywhere on this path**, which is what makes "free at every
   * tier including Free" a property of the code rather than a promise: there is no
   * `consumptionFor` call, no re-count, no `remainingFor` and therefore nothing that
   * could refuse it. A Free account already at its cap gets its replacement, and the
   * counter does not move — because the row is written with `chargedAt: null` and
   * `allowance.service.ts` counts `chargedAt: { gte, lt }`. That is the whole of "free",
   * and it needs no second counter and no `excludedFromCount` column.
   *
   * **Only over a suppressed generation.** A live Explanation answers 409
   * `NOTHING_TO_REGENERATE` and nothing is written: a replacement is what follows a
   * removal, and an allowance-free write with no precondition is a free provider call
   * anybody could press in a loop.
   *
   * **A new generation, never an overwrite.** The suppressed row keeps its body, its
   * flags and its removal instant; the replacement is `generation + 1` with
   * `suppressedAt: null`, so both are readable and each can be flagged, decided about and
   * suppressed on its own terms with no ceiling.
   *
   * The Question is re-asked through the **same** `explanationInputFor` the child's own
   * ask goes through and written by the **same** `write` internal — so the prompt, the
   * post-hoc validation, the bounded retry and every fault ending as
   * `ExplanationUnavailable` are one code path and not two. A provider fault is a 503 and
   * writes nothing.
   *
   * **It changes one Explanation and nothing else**: no grade state, no score, no
   * Mastery, no other Question, no other generation and no other child.
   */
  async regenerateExplanation(
    scope: ParentScope,
    attemptId: string,
    questionId: string,
  ): Promise<ParentExplanationView[]> {
    const { studentProfileId } = await this.practiceTests.attemptProfileFor(
      scope.parentAccountId,
      attemptId,
    );

    const latest = await this.prisma.explanation.findFirst({
      where: { attemptId, questionId, studentProfileId },
      orderBy: { generation: 'desc' },
      select: { generation: true, suppressedAt: true },
    });
    // The same sentence a foreign Attempt gets, under its own name: there is nothing here to
    // put a replacement in place of, which is a different reason from there being nothing to
    // stop serving.
    if (latest === null) throw new NotFoundException(NO_EXPLANATION_TO_REGENERATE);
    if (latest.suppressedAt === null) {
      this.logger.log(
        `A regeneration of the explanation of question ${questionId} of attempt ${attemptId} was refused: the student is still being served it.`,
      );
      throw new ConflictException(NOTHING_TO_REGENERATE);
    }

    // The ownership proof again, and the Question, both answers and the Practice Test's
    // Grade Level with it — the same read the child's own ask goes through, with the
    // profile resolved off the Attempt rather than passed.
    const input = await this.practiceTests.explanationInputFor(
      scope.parentAccountId,
      studentProfileId,
      attemptId,
      questionId,
    );
    // The same refusal the child's path makes for the same state: an explanation built
    // around a prompt or a correct answer that could not be read would be invented, and
    // a free one is no better for being free.
    if (input.prompt.trim() === '' || input.correctAnswer.trim() === '') {
      this.logger.warn(
        `A replacement explanation for question ${questionId} of attempt ${attemptId} was refused: the stored question or correct answer could not be read.`,
      );
      throw new ExplanationUnavailable();
    }

    const body = await this.write(scope.parentAccountId, input, attemptId, questionId);

    try {
      await this.prisma.explanation.create({
        data: {
          parentAccountId: scope.parentAccountId,
          studentProfileId,
          attemptId,
          questionId,
          body,
          // The next generation, and the reason this is a replacement rather than an
          // overwrite. The widened unique key is what refuses a racing second one.
          generation: latest.generation + 1,
          // **The whole of "free".** No allowance was read on this path and none will be:
          // the counter excludes a null `chargedAt` by column, so there is nothing to
          // debit, nothing to reconcile and nothing that could refuse this row.
          chargedAt: null,
        },
        select: { id: true },
      });
    } catch (cause) {
      // Two regenerations for one Question at once: both computed the same `max + 1` and
      // the unique key refused the loser. The loser's answer is the winner's generations
      // — one row exists, and a parent is never shown a fault for having been quick. This
      // call's own body is dropped rather than written as a third row.
      if (!isUniqueViolation(cause)) throw cause;
      this.logger.log(
        `A replacement explanation for question ${questionId} of attempt ${attemptId} was already written by a concurrent request.`,
      );
      return this.generationsOf(attemptId, questionId, studentProfileId);
    }

    // The Attempt and the Question. Never a fragment of what was written, and never a
    // cost, a tier or a model name (AD-20, AD-26).
    this.logger.log(
      `A replacement explanation was written for question ${questionId} of attempt ${attemptId}.`,
    );

    return this.generationsOf(attemptId, questionId, studentProfileId);
  }

  /**
   * The Admin Flagged Explanations queue: one entry per Explanation an operator has to
   * judge.
   *
   * **The filter is here, in the service, and it is a `where`.** Not in a controller and
   * never in the browser: "no Admin response may carry an unconfirmed student flag" is
   * a guarantee only the query can make, because a filter applied after the read is a
   * filter one refactor can drop while every screen still looks right.
   *
   * Two arms and no third. A **parent-origin** flag qualifies outright — it is already
   * the parent's own judgement, and there is nothing further to ask them. A
   * **student-origin** flag qualifies only once it is `Confirmed`: an awaiting one is a
   * child's concern nobody has read yet, and a dismissed one is a parent having read
   * the same prose and judged it fine. Neither belongs in front of an operator.
   *
   * **The entry's identity is the Explanation, not the flag** — `adminQueueEntries`
   * folds the rows and the reasoning lives there. Account-scoped it is not: the whole
   * point of the queue is that an operator sees every family's, which is why it is
   * behind `AdminAuthGuard` and behind nothing else.
   *
   * **Suppression is deliberately absent from this `where`, and must stay absent.** A
   * suppressed Explanation is precisely the one an operator has to judge: the parent has
   * already decided it was bad enough to take away from their child, and a queue that
   * filtered those out would lose every case the strongest signal came from. So a
   * suppressed row stays in front of an operator, with its body, for as long as the flag
   * does — and a replacement that is later flagged is a **different Explanation**, so it
   * arrives as an entry of its own with no fold, no grouping and no change here at all.
   *
   * Nothing here generates, writes or suppresses anything. Reading the queue is a read.
   */
  async flaggedForAdmin(): Promise<AdminFlaggedExplanationView[]> {
    const rows = await this.prisma.explanationFlag.findMany({
      where: {
        OR: [
          { origin: PARENT_FLAG_ORIGIN },
          { origin: STUDENT_FLAG_ORIGIN, disposition: QUEUED_FLAG_DISPOSITION },
        ],
      },
      // Oldest qualifying first, which is the order an operator works in. The fold sorts
      // again on the *minimum* instant per Explanation, because an entry's position is
      // when either route first raised it.
      orderBy: { createdAt: 'asc' },
      select: {
        origin: true,
        createdAt: true,
        explanation: {
          select: {
            id: true,
            parentAccountId: true,
            studentProfileId: true,
            attemptId: true,
            questionId: true,
            body: true,
          },
        },
      },
    });

    const entries = adminQueueEntries(rows);
    // A count and nothing else. No identifier of a family, no fragment of prose and no
    // child's answer ever reaches a log line from this path (AD-20, AD-26).
    this.logger.log(`The flagged-explanation queue was read: ${entries.length} explanation(s).`);
    return entries;
  }

  // --- Story 8.3: what this module contributes to a profile deletion -------

  /**
   * When each of this child's charged Explanations was charged.
   *
   * The only thing this module hands a deletion. Explanations cascade from the
   * Student Profile and their flags cascade from them, so the rows need no purge
   * of their own — the Admin queue empties itself when the profile row goes, and
   * a flag about an Explanation that no longer exists is not a queue entry
   * anybody could act on.
   *
   * What *cannot* go with them is the charge: the Explanation Allowance is
   * derived from exactly these instants (AD-14), so they are collected inside
   * the deletion's own transaction and collapsed into tombstones. A row with a
   * null `chargedAt` — Story 6.4's free regeneration — is absent here, because it
   * cost nothing. Reading it outside the transaction would leave a window in
   * which an Explanation is charged, cascaded away and never tombstoned.
   */
  async chargedInstantsFor(studentProfileId: string, tx?: TransactionClient): Promise<Date[]> {
    const rows = await (tx ?? this.prisma).explanation.findMany({
      where: { ...deletionScope(studentProfileId), chargedAt: { not: null } },
      select: { chargedAt: true },
    });
    return rows.flatMap((row) => (row.chargedAt === null ? [] : [row.chargedAt]));
  }

  /** What this module would destroy, for the confirmation the parent reads. */
  async countsFor(studentProfileId: string): Promise<{ explanations: number }> {
    return {
      explanations: await this.prisma.explanation.count({
        where: deletionScope(studentProfileId),
      }),
    };
  }

  /**
   * The same count for the whole account (Story 8.4), and the only thing this
   * module hands an account deletion.
   *
   * The rows still need no purge of their own: an Explanation cascades from its
   * Student Profile and its flags cascade from it, so every one of them goes when
   * the children go — and the Admin queue empties itself. And no charging instant
   * is collected, because an account deletion writes no tombstone: `UsageTombstone`
   * cascades from the account row, so a usage figure written here would be a
   * statement about an account the same transaction is removing.
   *
   * Matched on the row's own `parentAccountId`, which needs none of the widening
   * the profile scope needs: every Explanation of the account is in scope by
   * definition. That column is a plain one with no foreign key, for the reason the
   * schema states — it carries no edge and blocks nothing.
   */
  async countsForAccount(parentAccountId: string): Promise<{ explanations: number }> {
    return {
      explanations: await this.prisma.explanation.count({ where: { parentAccountId } }),
    };
  }

  // --- Internals ---------------------------------------------------------

  /**
   * Every generation of one Question, oldest first, as the parent reads them.
   *
   * The answer both parent writes give, and one read rather than a composed response:
   * suppression and regeneration each change one row, but the screen has to redraw the
   * Question's whole history — the removed explanation beside its replacement — and a
   * response composed from the row that was written would leave the other generation to
   * be fetched or guessed at.
   *
   * Read **after** the write rather than composed from it, for the reason
   * `disposeStudentFlag` re-reads its flags: the pre-write read predates the write, so a
   * flag or a concurrent regeneration landing in the gap would otherwise vanish from this
   * response even though the rows themselves are correct on the next read.
   *
   * It takes the profile resolved off the Attempt and never one from a request, exactly as
   * the two callers resolved it.
   */
  private async generationsOf(
    attemptId: string,
    questionId: string,
    studentProfileId: string,
  ): Promise<ParentExplanationView[]> {
    const rows = await this.prisma.explanation.findMany({
      where: { attemptId, questionId, studentProfileId },
      // Oldest generation first, which is the order the screen renders a Question's
      // history in. The ordinal and not `createdAt`: two rows written inside one
      // millisecond have an unambiguous order by it and none by their instants.
      orderBy: { generation: 'asc' },
      select: {
        questionId: true,
        body: true,
        generation: true,
        suppressedAt: true,
        // Both origins, unfiltered, exactly as `explanationsForAttempt` reads them: the
        // parent reads their own concern and their child's, and `canSuppress` is computed
        // off them by the pure mapper. `chargedAt` is still deliberately not selected —
        // what an Explanation cost is not a thing this response carries (AD-20, AD-26),
        // and that holds for the free one too.
        flags: {
          select: { origin: true, createdAt: true, disposition: true, dispositionAt: true },
        },
      },
    });
    return parentExplanationViews(rows);
  }

  /**
   * One `Explanation` call, re-issued while the post-hoc pass keeps rejecting what
   * came back, degrading to a refusal rather than to a guess.
   *
   * The retry is the same one `GradingService.judge` makes, for the same reason: a
   * body that holds no segments, or one that runs to a wall of text, is the
   * provider's fault (AD-31) and `AiService`'s own loop cannot see it, because the
   * payload parsed and the call returned. Bounded by the same `maxAttempts` figure
   * upstream faults are retried under.
   *
   * **Every failure class ends the same way**: `ExplanationUnavailable`, which the
   * controller turns into the single `EXPLANATION_FAILED` sentence. An
   * `AiInputError` and an `AiRejectedError` escape `AiService`'s own loop
   * immediately and are caught here; an exhausted `AiUpstreamError` and an
   * exhausted rejection arrive here too. Nothing is written and nothing is charged
   * on any of them — the charge is the row, and there is no row.
   */
  private async write(
    parentAccountId: string,
    input: ExplanationInput,
    attemptId: string,
    questionId: string,
  ): Promise<RichText> {
    const asked = {
      ordinal: input.ordinal,
      format: input.format,
      prompt: input.prompt,
      studentAnswer: input.studentAnswer,
      correctAnswer: input.correctAnswer,
      gradeLevelName: input.gradeLevelName,
    };
    const maxAttempts = this.ai.config.maxAttempts;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let payload: ExplanationPayload;
      try {
        ({ payload } = await this.ai.run({
          callClass: 'Explanation',
          // Whose cost row this is. The account the binding named, never a claim
          // on the request — `ai` is the sole writer of `ai_call` and this module
          // never touches it (AD-17, AD-20).
          parentAccountId,
          // Text in, text out: this call reads stored text, never a photograph.
          // Stated rather than inferred from an empty array.
          modality: 'text',
          images: [],
          prompt: buildExplanationPrompt(asked),
          schema: ExplanationPayload,
          schemaName: EXPLANATION_SCHEMA_NAME,
          fakePayload: ({ failure }) => fakeExplanationPayload({ ordinal: asked.ordinal, failure }),
        }));
      } catch (cause) {
        // The three fault classes, and all of them end here. The Attempt, the
        // Question and the class of fault; never a word the model wrote (AD-20).
        if (
          cause instanceof AiInputError ||
          cause instanceof AiRejectedError ||
          cause instanceof AiUpstreamError
        ) {
          this.logger.warn(
            `An explanation for question ${questionId} of attempt ${attemptId} could not be written (${cause.name}).`,
          );
          throw new ExplanationUnavailable();
        }
        throw cause;
      }

      try {
        return validateExplanationPayload(payload);
      } catch (cause) {
        // Only a post-hoc rejection is worth asking again for. Anything else is
        // this module's own fault and is not made better by repetition.
        if (!(cause instanceof ExplanationPayloadInvalid)) throw cause;
        // The ids and the attempt number. Never the rule that was broken in the
        // model's own words, and never a fragment of what it wrote (AD-20).
        this.logger.warn(
          `An explanation payload for question ${questionId} of attempt ${attemptId} was rejected after parsing on attempt ${attempt} of ${maxAttempts}.`,
        );
      }
    }
    this.logger.warn(
      `An explanation for question ${questionId} of attempt ${attemptId} was rejected on every attempt.`,
    );
    throw new ExplanationUnavailable();
  }
}

/**
 * Postgres's unique-violation code, as Prisma reports it.
 *
 * Read off the error's shape rather than by importing the Prisma error class,
 * which is the house pattern for a check that only ever asks one question of it.
 */
/**
 * The one column a student-scoped flag read selects, spelled once.
 *
 * One constant rather than the same literal at three call sites, for the reason
 * `PARENT_FLAG_ORIGIN` is one constant: the guarantee is that a student-scoped response
 * carries the *instant* and nothing else, and three copies of a `select` is three
 * chances for a `disposition: true` to be added to one of them.
 */
const FLAG_INSTANT = { createdAt: true } as const;

/**
 * The child's own flag instant, out of a list the query already scoped to their origin.
 *
 * At most one row, by `@@unique([explanationId, origin])`. `?? null` rather than a
 * length check, so a reported Explanation and an unreported one differ in the value and
 * never in the shape.
 */
function studentFlaggedAtOf(flags: readonly { createdAt: Date }[]): string | null {
  return flags[0]?.createdAt.toISOString() ?? null;
}

/**
 * Every Explanation that goes when a Student Profile is deleted.
 *
 * An Explanation cascades from **three** directions: the child, the Attempt, and
 * the Question of a Practice Test. `practicetest` deliberately widens the set of
 * Practice Tests a deletion takes — a row whose own `studentProfileId` names
 * another child but whose Source Test is this one's goes too, because otherwise
 * it would block the Source Test delete on its `Restrict` edge — and this mirrors
 * that widening one table down.
 *
 * Unreachable today, because generation copies `studentProfileId` from the Source
 * Test and the two branches name the same rows. It is written anyway because the
 * consequence of the asymmetry is not a crash: a charged Explanation reached only
 * by the widened branch would cascade away with no tombstone, which is a silent
 * refund of the account's month and a preview that understated what would go.
 * The cost of stating it is one `OR`; the cost of discovering it later is a
 * billing figure nobody can reconstruct.
 */
function deletionScope(studentProfileId: string) {
  return {
    OR: [
      { studentProfileId },
      { question: { practiceTest: PracticeTestService.deletionScope(studentProfileId) } },
    ],
  };
}

/** One `(Attempt, Question)` pair as a single map key. Two ids, one lookup. */
function refKey(attemptId: string, questionId: string): string {
  return `${attemptId}:${questionId}`;
}

function isUniqueViolation(cause: unknown): boolean {
  return (
    typeof cause === 'object' && cause !== null && (cause as { code?: unknown }).code === 'P2002'
  );
}
