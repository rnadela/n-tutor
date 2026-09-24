import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AiModule } from '../ai/ai.module.js';
import { requireParentJwtSecret } from '../common/env.js';
import { IdentityModule } from '../identity/identity.module.js';
import { ParentElevationGuard } from '../identity/parent-elevation.guard.js';
import { SourceTestModule } from '../sourcetest/source-test.module.js';
import { ExtractionController } from './extraction.controller.js';
import { ExtractionRunner } from './extraction.runner.js';
import { ExtractionService } from './extraction.service.js';
import { extractionRuntime } from './extraction-policy.js';

/**
 * The `extraction` module: sole owner and sole writer of every extraction
 * table, and the owner of the extraction prompt (AD-17).
 *
 * It imports `AiModule` for the one thing it may not do itself — make a
 * provider call — and `SourceTestModule` for the other: reading Page Image
 * bytes back. `forwardRef` in both directions because the dependency really is
 * mutual (submit enqueues; the job reads pages), and that is Nest's sanctioned
 * expression of a genuine cycle rather than a workaround for an accidental one.
 *
 * `ParentElevationGuard` is constructed here for the same reason
 * `SourceTestModule` constructs its own: Nest builds a controller's enhancers
 * in that controller's injector, so the parent secret is resolved here through
 * `requireParentJwtSecret()` and stays out of `admin`'s injector entirely
 * (AD-25).
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({ secret: requireParentJwtSecret() }),
    }),
    IdentityModule,
    AiModule,
    forwardRef(() => SourceTestModule),
  ],
  controllers: [ExtractionController],
  providers: [ExtractionService, ExtractionRunner, ParentElevationGuard],
  exports: [ExtractionService, ExtractionRunner],
})
export class ExtractionModule {
  constructor() {
    // Resolved and checked as the module is constructed, so a mistyped poll
    // interval is a process that refuses to start rather than a worker that
    // silently never claims anything.
    extractionRuntime();
  }
}
