import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { requireParentJwtSecret } from '../common/env.js';
import { IdentityModule } from '../identity/identity.module.js';
import { ParentElevationGuard } from '../identity/parent-elevation.guard.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AllowanceService } from './allowance.service.js';
import { ParentAllowanceController } from './parent-allowance.controller.js';

/**
 * The `allowance` policy module: owns no entity (AD-14, AD-17) and holds the one
 * tiers table and the one period-window computation. Every surface that shows an
 * allowance reads it from here.
 *
 * It now exposes **one read-only controller** — `GET parent/allowances`, the
 * parent's own readout of the payload the Admin console already reads. That
 * changes nothing about what this module owns: it still owns no entity, still
 * writes nothing anywhere, and still computes usage rather than storing it. The
 * controller is a projection of `consumptionFor` and holds no composition of its
 * own, which is what keeps the parent and admin views from being two answers.
 *
 * `ParentElevationGuard` is constructed here because Nest builds a controller's
 * enhancers in that controller's injector — `IdentityModule` exports the two
 * services the guard needs, and the `JwtModule` below registers the parent secret
 * the elevation bearer is signed with, resolved in this injector through
 * `requireParentJwtSecret()` (AD-25). The same arrangement `analytics.module.ts`
 * makes, for the same reason.
 */
@Module({
  // No `SourceTestModule`. The Upload count now reads `source_test` through
  // this module's own `PrismaService`, exactly as the Generation and
  // Explanation counts read theirs, and for the same reason: `sourcetest`
  // enforces the Upload cap against `AllowanceService`, so importing it back
  // would make `allowance` — the module every surface reads — depend on a
  // module that depends on it. What is read is a status and an instant, a
  // column and not a behaviour, so the AD-17 carve-out that already covers
  // `practicetest` and `explanation` covers this too, and no `forwardRef` and
  // no reader token is bought for it.
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({ secret: requireParentJwtSecret() }),
    }),
    IdentityModule,
    PrismaModule,
  ],
  controllers: [ParentAllowanceController],
  providers: [AllowanceService, ParentElevationGuard],
  exports: [AllowanceService],
})
export class AllowanceModule {}
