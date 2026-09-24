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
  imports: [IdentityModule, PrismaModule],
  providers: [AllowanceService],
  exports: [AllowanceService],
})
export class AllowanceModule {}
