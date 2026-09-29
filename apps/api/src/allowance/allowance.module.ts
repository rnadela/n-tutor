import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AllowanceService } from './allowance.service.js';

/**
 * The `allowance` policy module: owns no entity (AD-14, AD-17), holds the one
 * tiers table and the one period-window computation, and exposes no controller.
 * Every surface that shows an allowance reads it from here.
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
  imports: [IdentityModule, PrismaModule],
  providers: [AllowanceService],
  exports: [AllowanceService],
})
export class AllowanceModule {}
