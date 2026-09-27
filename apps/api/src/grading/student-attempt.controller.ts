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
import type { AttemptSubmissionView } from '../practicetest/practice-test.service.js';
import { SubmitAttemptDto } from './dto/attempt-submit.dto.js';
import type { PracticeTestRunsView } from './grading-history.js';
import type { AttemptResultsView } from './grading-results.js';
import { GradingService } from './grading.service.js';

/**
 * The student-scoped grade endpoints `grading` mounts: handing an Attempt in,
 * reading what it came to, and reading how a child's runs at each practice test
 * stand.
 *
 * **Same path, same body, same answers as before Story 5.4.**
 * `POST /api/student/attempts/:attemptId/submit`, the same `StudentModeGuard`, the
 * same `@SkipThrottle({ login: true })`, the same 200, the same single
 * `PRACTICE_TEST_NOT_FOUND` sentence and the same 409. It moved modules; it is not
 * a new contract, which is why every case written against the old home still pins
 * it from outside.
 *
 * **Why it is mounted here.** Handing in is the transaction a grade is written in
 * (AD-4, AD-10): the Attempt closes and its blanks are recorded together, or
 * neither happens. Grade state is `grading`'s entity and `grading`'s sole write
 * (AD-6, AD-17), and a controller in `practicetest` reaching for a grading service
 * would reverse the module arrow into a `forwardRef` cycle. So the endpoint lives
 * with the entity, and the half of it `practicetest` owns is called inward as
 * `closeAttempt`.
 *
 * **Whether the deadline had passed is decided in that transaction, on the server's
 * clock, against the server's own column.** Nothing in the body says anything about
 * time, and a claim about it would not be read if it did — the browser decides only
 * when it dispatches, which is what makes a submission that crossed a network
 * outage still judged at the instant the time ran out.
 *
 * The Attempt id in the path names *which* Attempt. Both ids come off
 * `req.student`, so an Attempt of another profile or another account answers the
 * one shared 404 with everything else. A second submission is the single exception
 * to one-sentence refusal on this surface and answers **409** with its own stated
 * reason: "already handed in" is a rule the child is entitled to know about, where
 * a 404 would make a successful hand-in look like a lost one and invite the screen
 * to send it again.
 *
 * **No `ParseUUIDPipe`**, for the reason the student reads carry none: a 400 on
 * shape would be a second kind of refusal on a surface whose whole discipline is
 * that every refusal is one sentence. A malformed id finds no row and gets the 404.
 *
 * **200, not Nest's `POST` default of 201.** Nothing is created here from the
 * child's point of view: the Attempt already existed and this closes it.
 *
 * The body is the **only student-authored input the API accepts anywhere**, which
 * is why its bounds are stated in a DTO of its own rather than assumed. It carries
 * answers and only answers: no grade, no state, no count of blanks and no claim
 * about time. And the response carries none of those either.
 */
@Controller('student')
@SkipThrottle({ login: true })
@UseGuards(StudentModeGuard)
export class StudentAttemptController {
  constructor(private readonly grading: GradingService) {}

  @Post('attempts/:attemptId/submit')
  @HttpCode(HttpStatus.OK)
  submitAttempt(
    @Req() req: StudentRequest,
    @Param('attemptId') attemptId: string,
    @Body() body: SubmitAttemptDto,
  ): Promise<AttemptSubmissionView> {
    return this.grading.submitAttempt(
      req.student!.parentAccountId,
      req.student!.studentProfileId,
      attemptId,
      body.answers,
    );
  }

  /**
   * One handed-in Attempt's answer key, and the one read on this controller that
   * writes.
   *
   * **A `GET` that legitimately writes grades.** FR-22 makes viewing the trigger,
   * so the read *is* the retry: `resultsFor` calls `resolveUngraded` before it reads
   * anything. A `POST` would be honest about the write and wrong about everything
   * else — a screen navigating to its own results would either fire it twice or skip
   * it, and nothing about opening results is a thing the child is asking to change.
   * Nothing polls it, nothing queues behind it and no route retries on a timer.
   *
   * It carries **no grading rationale, no Topic label and no cost, tier, allowance
   * or model name** (AD-20, AD-26). The rationale is not selected by the read at
   * all, and `AttemptResultsView` has no field one could travel in.
   *
   * Both ids come off `req.student`, so a foreign Attempt, a sibling's Attempt, an
   * unknown id and an Attempt that is still open all answer the one shared
   * `PRACTICE_TEST_NOT_FOUND` 404 — by construction rather than by a check somebody
   * has to remember. **No `ParseUUIDPipe`**, for the reason the submit route carries
   * none: a 400 on shape would be a second kind of refusal on a surface whose whole
   * discipline is that every refusal is one sentence.
   */
  @Get('attempts/:attemptId/results')
  attemptResults(
    @Req() req: StudentRequest,
    @Param('attemptId') attemptId: string,
  ): Promise<AttemptResultsView> {
    return this.grading.resultsFor(
      {
        parentAccountId: req.student!.parentAccountId,
        studentProfileId: req.student!.studentProfileId,
      },
      attemptId,
    );
  }

  /**
   * This child's run history: one entry per practice test they have finished at least
   * once, with the first run's figure, the latest run's figure and the run count.
   *
   * **Mounted here and not beside the practice-test list**, because a score is a grade
   * fact and `grading` is its sole reader (AD-6, AD-17). A `practicetest` controller
   * reaching for a grading service to annotate its own list would reverse the module
   * arrow into the `forwardRef` cycle both modules say they have no reason to have.
   * So the list stays `practicetest`'s, the figures are their own read, and Student
   * Home composes the two — which is also why one of them failing cannot blank the
   * other.
   *
   * **`GET /api/student/practice-test-runs`, a sibling path and not
   * `practice-tests/runs`.** `practicetest` mounts `GET student/practice-tests/:id`,
   * and Nest registers that controller's routes *before* this one's because
   * `GradingModule` depends on `PracticeTestModule` — so a literal `runs` segment
   * under `practice-tests` is swallowed by the parameter and answers the detail
   * read's 404. A sibling path is the only arrangement whose reachability does not
   * depend on module registration order.
   *
   * **No re-ask, unlike the results read.** FR-22's trigger is the results screen,
   * one Attempt at a time; this is a list read over every test on a child's home
   * screen, and a re-ask per row would spend a provider call per card on every visit.
   * Nothing here writes, nothing polls it and nothing retries it on a timer.
   *
   * It carries **no grading rationale, no Topic label and no cost, tier, allowance or
   * model name** (AD-20, AD-26): the read does not select the first at all and the
   * view has no field any of them could travel in. No path parameter either — both
   * ids come off `req.student`, so there is nothing here to name whose history it is.
   *
   * A child with nothing handed in answers `[]` and never a 404: having finished
   * nothing yet is a state the rows render without a figure, not a refusal.
   */
  @Get('practice-test-runs')
  practiceTestRuns(@Req() req: StudentRequest): Promise<PracticeTestRunsView[]> {
    return this.grading.runHistoryFor({
      parentAccountId: req.student!.parentAccountId,
      studentProfileId: req.student!.studentProfileId,
    });
  }
}
