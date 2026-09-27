import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AiModule } from '../ai/ai.module.js';
import { AllowanceModule } from '../allowance/allowance.module.js';
import { requireParentJwtSecret } from '../common/env.js';
import { IdentityModule } from '../identity/identity.module.js';
import { StudentModeGuard } from '../identity/student-mode.guard.js';
import { PracticeTestModule } from '../practicetest/practice-test.module.js';
import { ExplanationService } from './explanation.service.js';
import { StudentExplanationController } from './student-explanation.controller.js';

/**
 * The `explanation` module: sole owner and sole writer of `Explanation` (AD-17).
 *
 * **Every arrow points out of it, and none points back.** `PracticeTestModule` for
 * the one read that crosses the boundary — `explanationInputFor`, which brings the
 * ownership proof, the Question, both answers and the Practice Test's Grade Level
 * in a single call, so nothing here holds a `practiceTest`, `attempt`, `answer`,
 * `sourceTest` or taxonomy delegate. `AiModule` for the one thing this module may
 * not do itself, make a provider call; it never writes `ai_call`. `AllowanceModule`
 * for the tier limit and the period window, which are `allowance`'s and nobody
 * else's (AD-14).
 *
 * **`allowance` does not import this module**, and must not: it counts charged
 * `explanation` rows through its own injected `PrismaService`, exactly as it counts
 * `practice_test` rows. Reaching for `ExplanationService` instead would make the
 * module every surface reads depend on one that depends on it — a cycle bought for
 * nothing, since what is counted is a column and not a behaviour. So there is no
 * `forwardRef` anywhere here.
 *
 * `StudentModeGuard` is constructed here because Nest builds a controller's
 * enhancers in that controller's injector: `IdentityModule` exports the two
 * services the guard needs, and the `JwtModule` below registers the parent secret
 * the binding cookie is signed with, resolved in this injector through
 * `requireParentJwtSecret()` (AD-25). The same arrangement `grading.module.ts`
 * makes, for the same reason.
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({ secret: requireParentJwtSecret() }),
    }),
    IdentityModule,
    PracticeTestModule,
    AllowanceModule,
    AiModule,
  ],
  controllers: [StudentExplanationController],
  providers: [ExplanationService, StudentModeGuard],
  exports: [ExplanationService],
})
export class ExplanationModule {}
