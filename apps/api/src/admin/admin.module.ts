import { Module } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { AllowanceModule } from '../allowance/allowance.module.js';
import { requireIntEnv, requireJwtSecret } from '../common/env.js';
import { ExplanationModule } from '../explanation/explanation.module.js';
import { GradingModule } from '../grading/grading.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { TopicsModule } from '../topics/topics.module.js';
import { ADMIN_JWT } from './admin-auth.constants.js';
import { AdminAuthController } from './admin-auth.controller.js';
import { AdminAuthGuard } from './admin-auth.guard.js';
import { AdminAuthService } from './admin-auth.service.js';
import { FlaggedExplanationController } from './flagged-explanation.controller.js';
import { ParentAccountAdminService } from './parent-account-admin.service.js';
import { ParentAccountController } from './parent-account.controller.js';
import { TaxonomyController } from './taxonomy.controller.js';
import { TaxonomyModule } from './taxonomy.module.js';
import { TopicCurationController } from './topic-curation.controller.js';
import { TopicCurationService } from './topic-curation.service.js';

/**
 * The `admin` module: its own credential store, its own route namespace, and
 * sole ownership of Subject, GradeLevel, SubjectGradeLevel and AdminAudit
 * (AD-17, AD-25).
 *
 * It imports `identity` and `allowance` and never touches their Prisma
 * delegates: a tier change is written through ParentAccountService, and every
 * allowance figure is read through AllowanceService.
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: requireJwtSecret('ADMIN_JWT_SECRET'),
        signOptions: { expiresIn: requireIntEnv('ADMIN_JWT_TTL_SECONDS', 28_800) },
      }),
    }),
    IdentityModule,
    AllowanceModule,
    // The taxonomy providers live in their own module so `identity` can read
    // them without importing this one, which already imports `identity`.
    TaxonomyModule,
    // The Flagged Explanations queue reads through `ExplanationService`, the sole
    // owner and sole writer of `explanation` and `explanation_flag` (AD-17) -- this
    // module acquires no delegate of either. The arrow points this way because
    // `AdminAuthGuard` is constructed here and not exported, so an admin-guarded
    // controller has to live in this injector; and because `admin` is imported by
    // nothing but `app.module.ts`, which is what makes this direction the acyclic one.
    ExplanationModule,
    // Story 7.6's Topic curation. `topics` is the sole writer of `Topic` and
    // `grading` the sole writer of `QuestionTopic` and `TopicMastery` (AD-17), so
    // this module acquires no delegate of any of the three: `TopicCurationService`
    // holds the transaction and calls the two owners. Both arrows point out of
    // `admin` for the reason `ExplanationModule`'s comment gives -- `admin` is
    // imported by nothing but `app.module.ts`. `grading -> topics` already exists
    // and is untouched, so neither arrow closes a cycle. They are imported here
    // rather than reached for lazily so that a missing provider or a cycle fails at
    // boot rather than on the first curation request.
    TopicsModule,
    GradingModule,
  ],
  controllers: [
    AdminAuthController,
    TaxonomyController,
    ParentAccountController,
    FlaggedExplanationController,
    TopicCurationController,
  ],
  providers: [
    { provide: ADMIN_JWT, useExisting: JwtService },
    AdminAuthService,
    AdminAuthGuard,
    ParentAccountAdminService,
    TopicCurationService,
  ],
  exports: [TaxonomyModule, ParentAccountAdminService],
})
export class AdminModule {}
