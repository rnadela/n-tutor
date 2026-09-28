import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AllowanceModule } from '../allowance/allowance.module.js';
import { requireParentJwtSecret } from '../common/env.js';
import { ExplanationModule } from '../explanation/explanation.module.js';
import { GradingModule } from '../grading/grading.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { ParentElevationGuard } from '../identity/parent-elevation.guard.js';
import { PracticeTestModule } from '../practicetest/practice-test.module.js';
import { TopicsModule } from '../topics/topics.module.js';
import { AnalyticsService } from './analytics.service.js';
import { ParentAnalyticsController } from './parent-analytics.controller.js';

/**
 * The `analytics` module: a **composition** module that owns no entity and writes
 * nothing (AD-17).
 *
 * **Every arrow points out of it, and none points in.** That is why it exists at
 * all. The dashboard is a read across five modules, and hanging it on `grading`
 * would have given the sole owner of `QuestionGrade` new edges to `explanation`
 * and `allowance` for a read that is not about grades — `grading`'s edges are
 * narrow on purpose. A module nothing imports can point at everything without any
 * existing arrow changing and without a cycle being expressible.
 *
 * Registered last in `AppModule` for the same reason `TopicsModule` is: nothing
 * above it imports it.
 *
 * `ParentElevationGuard` is constructed here because Nest builds a controller's
 * enhancers in that controller's injector — `IdentityModule` exports the two
 * services the guard needs, and the `JwtModule` below registers the parent secret
 * the elevation bearer is signed with, resolved in this injector through
 * `requireParentJwtSecret()` (AD-25). The same arrangement `grading.module.ts` and
 * `practice-test.module.ts` make, for the same reason.
 *
 * **It exports nothing.** A composition is not a dependency: a module that wanted
 * `AnalyticsService` would be a second surface assembling the dashboard, which is
 * the thing having one composition is meant to prevent.
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({ secret: requireParentJwtSecret() }),
    }),
    IdentityModule,
    // Mastery, the qualifying-Attempt scores and the disputes — every figure that
    // is a grade or is counted from one, from the module that owns the rows.
    GradingModule,
    // The released list the activity summary tallies, and the Attempt source the
    // trend is over.
    PracticeTestModule,
    // The child's reported Explanations, for the digest's second count.
    ExplanationModule,
    // The Explanation Allowance, which is an account figure and is read from the
    // one module that computes it (AD-14).
    AllowanceModule,
    // Topic names. `topics` is the sole owner of `Topic` (AD-11, AD-17), so the
    // dashboard's labels come from its reader rather than from a delegate here.
    TopicsModule,
  ],
  controllers: [ParentAnalyticsController],
  providers: [AnalyticsService, ParentElevationGuard],
})
export class AnalyticsModule {}
