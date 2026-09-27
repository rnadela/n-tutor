import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AiModule } from '../ai/ai.module.js';
import { requireParentJwtSecret } from '../common/env.js';
import { IdentityModule } from '../identity/identity.module.js';
import { ParentElevationGuard } from '../identity/parent-elevation.guard.js';
import { StudentModeGuard } from '../identity/student-mode.guard.js';
import { PracticeTestModule } from '../practicetest/practice-test.module.js';
import { GradingService } from './grading.service.js';
import { ParentAttemptController } from './parent-attempt.controller.js';
import { StudentAttemptController } from './student-attempt.controller.js';

/**
 * The `grading` module: sole owner and sole writer of `QuestionGrade` (AD-6,
 * AD-17).
 *
 * **One arrow, one way: `grading -> practicetest`.** It imports
 * `PracticeTestModule` for `PracticeTestService`, whose `closeAttempt` is the half
 * of handing in that `practicetest` owns, and for the submission ceilings its DTO
 * reads out of that module's policy. Nothing in `practicetest` imports this module
 * and nothing there reads or writes a grade, so there is **no `forwardRef`** here
 * and no reversed edge — which is the whole reason the submit route moved in rather
 * than a grading service being called out of `practicetest`.
 *
 * `StudentModeGuard` and `ParentElevationGuard` are both constructed here because
 * Nest builds a controller's enhancers in that controller's injector: `IdentityModule` exports the two
 * services the guard needs, and the `JwtModule` below registers the parent secret
 * the binding cookie is signed with, resolved in this injector through
 * `requireParentJwtSecret()` (AD-25). The same arrangement `practice-test.module.ts`
 * makes, for the same reason.
 *
 * **`AiModule` and no allowance module.** A provider call is made here now, as its
 * own call class (`Grading`), with its own pin and its own price — and it is
 * **never gated by an allowance**: an unaffordable grade would be a child punished
 * for a billing state, handing work in and being told nothing about it. So the cost
 * row is written, as it is for every call class, and nothing is ever refused for
 * want of headroom.
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({ secret: requireParentJwtSecret() }),
    }),
    IdentityModule,
    PracticeTestModule,
    AiModule,
  ],
  controllers: [StudentAttemptController, ParentAttemptController],
  providers: [GradingService, StudentModeGuard, ParentElevationGuard],
  exports: [GradingService],
})
export class GradingModule {}
