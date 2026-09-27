import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { StudentModeGuard, type StudentRequest } from '../identity/student-mode.guard.js';
import { SubmitAttemptDto } from './dto/attempt-submit.dto.js';
import {
  PracticeTestService,
  type AttemptSubmissionView,
  type AttemptView,
  type PracticeTestReleasedSummary,
  type StudentPracticeTestView,
} from './practice-test.service.js';

/**
 * The student-scoped reads of a Practice Test: the list a child chooses from and
 * the one they work through, both mounted at `/api/student`.
 *
 * Shaped after `StudentModeController` and holding to the same claims, with one
 * that has changed since Story 5.2: there **is** now a student-scoped write, and
 * it is exactly one kind. A child may open an Attempt on a test released to them
 * and hand that Attempt in. Nothing else. What those two writes touch is the
 * Attempt's own instants — written by the server, from the server's clock, once —
 * and the child's own raw answers. A child still authors nothing about a Practice
 * Test, nothing about a profile, nothing about an account and nothing about their
 * own binding, which is changed only through the elevation-guarded parent routes.
 *
 * Neither write carries a grade, a score or a verdict of any kind, and neither
 * accepts one: there is no body at all on the start route, and the submit body is
 * answers and only answers. What a blank means and whether an answer is right are
 * later stories', which extend these routes rather than replace them.
 *
 * The submit body is the **only student-authored input the API accepts anywhere**,
 * which is why its bounds are stated in a DTO of its own rather than assumed.
 *
 * Since Story 5.2 the detail read **does** carry generated content, because
 * taking a test requires it: prompts and option bodies, in stored ordinal order.
 * What it carries no trace of is the **answer key** — no `answer` column, no
 * `isCorrect` flag, no Topic label, and no allowance figure, tier or model name
 * (AD-20, AD-26). That is the line the human quality gate is drawn on: handing
 * the child the questions is the product, and handing them the answers before
 * anything exists to grade an Attempt against is the leak the gate exists to
 * prevent. It is structural rather than remembered — `STUDENT_TEST_SELECT`
 * never names those columns, so no mapper here could leak one.
 *
 * Both ids come from `req.student`, which the guard took from the binding cookie
 * — never from a parameter, a query, a body or a path. Both reads are scoped to
 * the bound profile *and* to `status: 'Released'`, so a `Draft`, a `Discarded`
 * row and a sibling's release are all simply absent from the list and answer one
 * indistinguishable 404 from the detail route.
 */
@Controller('student')
@SkipThrottle({ login: true })
@UseGuards(StudentModeGuard)
export class StudentPracticeTestController {
  constructor(private readonly practiceTests: PracticeTestService) {}

  /**
   * The practice tests this child can see: one flat list, never grouped, with
   * the Subject and the condition on every row.
   *
   * Server-ordered in two bands — everything there is still to do, then
   * everything finished — and the browser renders what it is given. Band 1 is
   * newest *made* first, because there is no `releasedAt` column; band 2 is
   * most recently submitted first. The service says why at length.
   *
   * The condition is `NotStarted`, `InProgress` or `Completed`, derived from
   * Attempts rather than stored: there is no fourth `PracticeTestStatus`.
   * Completed rows are returned unconditionally and forever — no cutoff, no
   * archive flag, no date filter anywhere on this path.
   *
   * Still no generated content of any kind, and still no `timerMinutes`: a
   * Subject label, a question count and a state word (AD-20, AD-26).
   *
   * An account with nothing released answers `[]` and never a 404: having nothing
   * yet is a state Student Home renders as a plain sentence, not a refusal.
   */
  @Get('practice-tests')
  released(@Req() req: StudentRequest): Promise<PracticeTestReleasedSummary[]> {
    return this.practiceTests.releasedFor(
      req.student!.parentAccountId,
      req.student!.studentProfileId,
    );
  }

  /**
   * One released practice test, whole: every Question in stored order, each with
   * its prompt, its format and — where it has them — its option bodies.
   *
   * **The id in the path names *which* test. It never names *whose*.** Both the
   * account and the profile come off `req.student`, which the guard took from the
   * binding cookie, and they sit in the same `where` as `status: 'Released'`. So a
   * draft, a discarded row, a sibling's test, another account's test and an id that
   * never existed are one indistinguishable 404 — there is no case here to get
   * wrong, because the statement cannot tell them apart either.
   *
   * And still not one correct answer: no `answer`, no `isCorrect`, no Topic label,
   * no allowance figure, no tier and no model name (AD-20, AD-26). Handing the
   * child the prompts is what taking a test requires; handing them the key is what
   * the whole quality gate exists to prevent.
   *
   * **No `ParseUUIDPipe`, deliberately** — the one place this route departs from
   * the parent ones. A 400 on shape would be a *second* kind of refusal on a
   * surface whose whole discipline is that every refusal is one sentence: an id a
   * child could only have reached by typing would answer differently from one that
   * simply is not theirs. A malformed id finds no row and gets the same 404 as
   * everything else.
   */
  @Get('practice-tests/:practiceTestId')
  releasedTest(
    @Req() req: StudentRequest,
    @Param('practiceTestId') practiceTestId: string,
  ): Promise<StudentPracticeTestView> {
    return this.practiceTests.releasedTestFor(
      req.student!.parentAccountId,
      req.student!.studentProfileId,
      practiceTestId,
    );
  }

  /**
   * Opens the Attempt this child works under, or returns the one already open.
   *
   * `POST` rather than `GET` because it may insert, and idempotent all the same:
   * a refresh, a second tab and a re-entry after a dropped connection all get the
   * **same** row back with its original `startedAt` and `expiresAt`. A reload that
   * handed out a fresh deadline would make the timer the parent configured mean
   * nothing.
   *
   * **No body, deliberately.** Both instants are the server's, written from the
   * server's clock at start, and there is nowhere for a browser to state a
   * duration, a start, an expiry or a clock of its own — not because a handler
   * ignores one, but because no body is read at all.
   *
   * The id in the path names *which* test and never *whose*: both ids come off
   * `req.student`. A draft, a discarded row, a sibling's release, another
   * account's test and an id that never existed are one indistinguishable 404 —
   * and **no `ParseUUIDPipe`**, for the reason the detail read states at length.
   */
  @Post('practice-tests/:practiceTestId/attempt')
  startAttempt(
    @Req() req: StudentRequest,
    @Param('practiceTestId') practiceTestId: string,
  ): Promise<AttemptView> {
    return this.practiceTests.startOrResumeAttempt(
      req.student!.parentAccountId,
      req.student!.studentProfileId,
      practiceTestId,
    );
  }

  /**
   * Hands one Attempt in: the child's raw answers, and the instant it closed.
   *
   * **Whether the deadline had passed is decided here, on the server's clock,
   * against the server's own column.** Nothing in the body says anything about
   * time, and a claim about it would not be read if it did — the browser decides
   * only when it dispatches, which is what makes a submission that crossed a
   * network outage still judged at the instant the time ran out.
   *
   * The Attempt id in the path names *which* Attempt. Both ids come off
   * `req.student`, so an Attempt of another profile or another account answers the
   * one shared 404 with everything else. A second submission is the single
   * exception to one-sentence refusal on this surface and answers **409** with its
   * own stated reason: "already handed in" is a rule the child is entitled to know
   * about, where a 404 would make a successful hand-in look like a lost one and
   * invite the screen to send it again.
   *
   * No `ParseUUIDPipe` here either, and for the same reason.
   *
   * **200, not Nest's `POST` default of 201.** Nothing is created here: the Attempt
   * already existed and this closes it. The start route above keeps its 201, because
   * that one may genuinely insert a row.
   */
  @Post('attempts/:attemptId/submit')
  @HttpCode(HttpStatus.OK)
  submitAttempt(
    @Req() req: StudentRequest,
    @Param('attemptId') attemptId: string,
    @Body() body: SubmitAttemptDto,
  ): Promise<AttemptSubmissionView> {
    return this.practiceTests.submitAttempt(
      req.student!.parentAccountId,
      req.student!.studentProfileId,
      attemptId,
      body.answers,
    );
  }
}
