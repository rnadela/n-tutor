import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { requireParentJwtSecret } from '../common/env.js';
import { IdentityModule } from '../identity/identity.module.js';
import { ParentElevationGuard } from '../identity/parent-elevation.guard.js';
import { PageIngestService } from './page-ingest.service.js';
import { SourceTestController } from './source-test.controller.js';
import { SourceTestService } from './source-test.service.js';
import { sourceTestRuntime } from './source-test-policy.js';

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
  ],
  controllers: [SourceTestController],
  providers: [SourceTestService, PageIngestService, ParentElevationGuard],
  exports: [SourceTestService],
})
export class SourceTestModule {
  constructor() {
    // Resolved and checked as the module is constructed, so a mistyped upload
    // root or size ceiling is a process that refuses to start rather than a 500
    // the first parent to photograph a page discovers.
    sourceTestRuntime();
  }
}
