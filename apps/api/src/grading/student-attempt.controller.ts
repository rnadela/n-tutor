import {
  Body,
  Controller,
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
import { GradingService } from './grading.service.js';

/**
 * The one student-scoped write `grading` mounts: handing an Attempt in.
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
}
