import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { StudentModeGuard, type StudentRequest } from '../identity/student-mode.guard.js';
import { PracticeTestService, type PracticeTestReleasedSummary } from './practice-test.service.js';

/**
 * The first student-scoped read of a Practice Test: one route, mounted at
 * `/api/student`.
 *
 * Shaped after `StudentModeController` and holding to the same two claims. There
 * is **still no student-scoped write** — a child authors nothing here, and the
 * binding itself is changed only through the elevation-guarded parent routes. And
 * there is **still not one word of generated content**: a row is an identifier
 * and a question count, with no prompt, no answer, no option body, no Topic
 * label, no allowance figure, no tier and no model name (AD-20, AD-26).
 *
 * That is deliberate rather than minimal for its own sake. "Becomes visible in
 * Student Mode" is a claim about visibility, and this epic ends there: taking the
 * test is Epic 5. A read that already carried prompts, options and *correct
 * answers* would hand a child the answer key before any surface existed to grade
 * an Attempt against — the exact leak the whole human quality gate exists to
 * prevent.
 *
 * Both ids come from `req.student`, which the guard took from the binding cookie
 * — never from a parameter, a query, a body or a path. The list is scoped to the
 * bound profile *and* to `status: 'Released'`, so a `Draft`, a `Discarded` row and
 * a sibling's release are all simply absent.
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
}
