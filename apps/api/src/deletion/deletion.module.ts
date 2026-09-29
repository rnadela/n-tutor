import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AiModule } from '../ai/ai.module.js';
import { AllowanceModule } from '../allowance/allowance.module.js';
import { requireParentJwtSecret } from '../common/env.js';
import { ExplanationModule } from '../explanation/explanation.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { ParentElevationGuard } from '../identity/parent-elevation.guard.js';
import { PracticeTestModule } from '../practicetest/practice-test.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SourceTestModule } from '../sourcetest/source-test.module.js';
import { AccountDeletionService } from './account-deletion.service.js';
import { ParentDeletionController } from './parent-deletion.controller.js';
import { ProfileDeletionService } from './profile-deletion.service.js';

/**
 * The `deletion` module: a **composition** that owns no entity of its own and
 * writes only the one table nobody else's cluster claims (AD-17).
 *
 * **Every arrow points out of it, and none points in.** That is why it exists at
 * all, and it is `AnalyticsModule`'s shape exactly. Deleting a child is a write
 * across five modules; hanging it on `identity` was impossible, because
 * `sourcetest`, `practicetest`, `explanation`, `grading` and `analytics` all
 * import `IdentityModule` for the elevation guard, so injecting any of their
 * services into `StudentProfileService` would make every one of them a cycle. A
 * module nothing imports can point at everything without any existing arrow
 * changing and without a cycle being expressible. No `forwardRef` anywhere.
 *
 * Each entity owner keeps its own delegates and exposes a narrow purge or count;
 * this module only decides the order they run in.
 *
 * `ParentElevationGuard` is constructed here because Nest builds a controller's
 * enhancers in that controller's injector — `IdentityModule` exports the two
 * services the guard needs, and the `JwtModule` below registers the parent secret
 * the elevation bearer is signed with, resolved in this injector through
 * `requireParentJwtSecret()` (AD-25). The same arrangement every other
 * parent-facing module makes, for the same reason.
 *
 * **It exports its two services and nothing else.** They are siblings rather than
 * one method with a flag: the profile path writes usage tombstones and refuses to
 * refund the month, and the account path erases the tombstones and has no
 * surviving account for a usage figure to be about. A second surface assembling
 * either order would be a second answer to what deletion means.
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({ secret: requireParentJwtSecret() }),
    }),
    // The profile itself: the ownership read and the one write of
    // `student_profile` this path makes, plus the account password verification.
    IdentityModule,
    // Source Tests, their pages, and the one routine that unlinks stored bytes.
    SourceTestModule,
    // Practice Tests and the Generation Jobs that produced them.
    PracticeTestModule,
    // The charged instants of the child's Explanations. Their rows cascade.
    ExplanationModule,
    // Period windows, so a past charging instant resolves to the period it fell
    // in through the one module that computes periods (AD-14). For
    // `ProfileDeletionService` alone: an account deletion writes no tombstone and
    // so resolves no window.
    AllowanceModule,
    // The sole writer of `ai_call` (AD-17), whose cost rows are the one thing an
    // account deletion erases that a profile deletion does not. `ai` imports
    // nothing at all, so the leaf orchestrator stays a leaf and no cycle is
    // expressible — no `forwardRef` here either.
    AiModule,
    // For the tombstone transaction, and for the one count `grading` owns.
    PrismaModule,
  ],
  controllers: [ParentDeletionController],
  providers: [ProfileDeletionService, AccountDeletionService, ParentElevationGuard],
  exports: [ProfileDeletionService, AccountDeletionService],
})
export class DeletionModule {}
