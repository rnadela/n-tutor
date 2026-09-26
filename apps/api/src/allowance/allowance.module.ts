import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SourceTestModule } from '../sourcetest/source-test.module.js';
import { AllowanceService } from './allowance.service.js';

/**
 * The `allowance` policy module: owns no entity (AD-14, AD-17), holds the one
 * tiers table and the one period-window computation, and exposes no controller.
 * Every surface that shows an allowance reads it from here.
 */
@Module({
  // `SourceTestModule` for the Upload count alone, which is read through its
  // service and never through a delegate here (AD-17). The dependency runs one
  // way — `sourcetest` knows nothing about allowances — so it needs no
  // `forwardRef` and no token indirection.
  imports: [IdentityModule, PrismaModule, SourceTestModule],
  providers: [AllowanceService],
  exports: [AllowanceService],
})
export class AllowanceModule {}
