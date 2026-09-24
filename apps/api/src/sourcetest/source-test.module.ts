import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { requireParentJwtSecret } from '../common/env.js';
import { TaxonomyModule } from '../admin/taxonomy.module.js';
import { ExtractionModule } from '../extraction/extraction.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { ParentElevationGuard } from '../identity/parent-elevation.guard.js';
import { PageIngestService } from './page-ingest.service.js';
import { SourceTestController } from './source-test.controller.js';
import { SourceTestService } from './source-test.service.js';
import { sourceTestRuntime } from './source-test-policy.js';
import { SOURCE_TEST_READER } from './source-test-reader.js';

/**
 * The `sourcetest` module: sole owner and sole writer of SourceTest and
 * PageImage, and sole owner of image ingest (AD-17).
 *
 * Ingest lives here rather than in a module of its own precisely because a
 * second writer of `page_image` — or a second place that decides what a stored
 * page's format and path are — is the drift AD-17 and AD-15 exist to prevent.
 *
 * It imports `IdentityModule` for one thing and reaches for nothing else:
 * `StudentProfileService`, which is how the child a draft is opened under is
 * resolved. It never touches `identity`'s Prisma delegates.
 *
 * `ParentElevationGuard` is `identity`'s class, constructed here because Nest
 * builds a controller's enhancers in that controller's own injector. The rules
 * are therefore stated exactly once — in the guard — while the credential it
 * verifies is resolved by `requireParentJwtSecret()`, the same function
 * `IdentityModule` uses and the one that refuses to return a secret shared with
 * the Admin surface (AD-25). Registering a `JwtModule` here rather than having
 * `identity` export its own is what keeps that secret out of the injector of
 * `admin`, which imports `identity` and signs with the *other* secret.
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({ secret: requireParentJwtSecret() }),
    }),
    IdentityModule,
    // The taxonomy read this module classifies through. Imported directly, the
    // way `IdentityModule` imports it — `identity` does not re-export it, and a
    // second reader of `subject` / `grade_level` / `subject_grade_level` is
    // exactly the drift AD-17 exists to prevent. No write ever goes this way.
    TaxonomyModule,
    // A genuine cycle, expressed honestly: `submit` enqueues the Extraction
    // job inside its own transaction (AD-5), and the job reads this module's
    // page bytes back. The alternatives — a Prisma delegate reach-across, or
    // the bytes copied into the job row — each break a decision (AD-17,
    // AD-20), so `forwardRef` on both module declarations is the honest
    // expression of it.
    forwardRef(() => ExtractionModule),
  ],
  controllers: [SourceTestController],
  providers: [
    SourceTestService,
    PageIngestService,
    ParentElevationGuard,
    // The same instance under the token `extraction` injects it by. Binding it
    // here rather than letting `extraction` import the class is what keeps the
    // ESM cycle from being a boot failure; `source-test-reader.ts` states why.
    { provide: SOURCE_TEST_READER, useExisting: SourceTestService },
  ],
  exports: [SourceTestService, SOURCE_TEST_READER],
})
export class SourceTestModule {
  constructor() {
    // Resolved and checked as the module is constructed, so a mistyped upload
    // root or size ceiling is a process that refuses to start rather than a 500
    // the first parent to photograph a page discovers.
    sourceTestRuntime();
  }
}
