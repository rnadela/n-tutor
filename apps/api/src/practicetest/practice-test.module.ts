import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AiModule } from '../ai/ai.module.js';
import { AllowanceModule } from '../allowance/allowance.module.js';
import { requireParentJwtSecret } from '../common/env.js';
import { ExtractionModule } from '../extraction/extraction.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { ParentElevationGuard } from '../identity/parent-elevation.guard.js';
import { StudentModeGuard } from '../identity/student-mode.guard.js';
import { SourceTestModule } from '../sourcetest/source-test.module.js';
import { PracticeTestController } from './practice-test.controller.js';
import { StudentPracticeTestController } from './student-practice-test.controller.js';
import { PracticeTestRunner } from './practice-test.runner.js';
import { PracticeTestService } from './practice-test.service.js';
import { practiceTestRuntime } from './practice-test-policy.js';

/**
 * The `practicetest` module: sole owner and sole writer of every Practice Test
 * table, and the owner of the generation prompt (AD-17).
 *
 * It imports four modules and reaches for nothing else. `AiModule` for the one
 * thing it may not do itself — make a provider call. `ExtractionModule` for the
 * source material, read through `EXTRACTION_READER` and never through a Prisma
 * delegate. `SourceTestModule` for the ownership proof, read through
 * `SOURCE_TEST_READER` for the same reason. `AllowanceModule` for the tier
 * limits and the period window, which are `allowance`'s and nobody else's
 * (AD-14).
 *
 * No `forwardRef` anywhere: unlike `sourcetest` and `extraction`, the
 * dependencies here genuinely run one way. Nothing upstream enqueues a
 * generation job — a parent does, over HTTP — so there is no cycle to express.
 *
 * `ParentElevationGuard` is constructed here for the same reason the other two
 * parent-facing modules construct their own: Nest builds a controller's
 * enhancers in that controller's injector, so the parent secret is resolved
 * here through `requireParentJwtSecret()` and stays out of `admin`'s injector
 * entirely (AD-25).
 *
 * `StudentModeGuard` is constructed here for exactly that reason too, since Story
 * 4.5 added the first student-scoped **read** of a Practice Test. Its three
 * dependencies are already in reach with nothing new imported: `IdentityModule`
 * exports `ParentAccountService` and `StudentProfileService`, and the `JwtModule`
 * above already registers the parent secret the binding cookie is signed with.
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({ secret: requireParentJwtSecret() }),
    }),
    IdentityModule,
    AiModule,
    AllowanceModule,
    SourceTestModule,
    ExtractionModule,
  ],
  controllers: [PracticeTestController, StudentPracticeTestController],
  providers: [PracticeTestService, PracticeTestRunner, ParentElevationGuard, StudentModeGuard],
  exports: [PracticeTestService, PracticeTestRunner],
})
export class PracticeTestModule {
  constructor() {
    // Resolved and checked as the module is constructed, so a mistyped poll
    // interval — or a claim timeout too short for the sequence of AI calls one
    // job makes — is a process that refuses to start rather than an account
    // billed twice for one request.
    practiceTestRuntime();
  }
}
