import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { StudentModeGuard, type StudentRequest } from '../identity/student-mode.guard.js';
import {
  PracticeTestService,
  type PracticeTestReleasedSummary,
  type StudentPracticeTestView,
} from './practice-test.service.js';

/**
 * The student-scoped reads of a Practice Test: the list a child chooses from and
 * the one they work through, both mounted at `/api/student`.
 *
 * Shaped after `StudentModeController` and holding to the same claims. There is
 * **still no student-scoped write** — a child authors nothing here, and the
 * binding itself is changed only through the elevation-guarded parent routes.
 * Story 5.2 adds no Attempt, no Answer and no persistence of any kind: a child's
 * answers live in the browser for the page's lifetime and reach nothing here.
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
   * The practice tests this child can see, most recently made first.
   *
   * Made, not released: there is no `releasedAt` column and this story adds none,
   * so `createdAt` — generation time — is the only stable order available. The
   * service says why at length.
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
}
