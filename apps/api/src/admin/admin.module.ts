import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AllowanceModule } from '../allowance/allowance.module.js';
import { requireIntEnv, requireJwtSecret } from '../common/env.js';
import { IdentityModule } from '../identity/identity.module.js';
import { AdminAuditService } from './admin-audit.service.js';
import { AdminAuthController } from './admin-auth.controller.js';
import { AdminAuthGuard } from './admin-auth.guard.js';
import { AdminAuthService } from './admin-auth.service.js';
import { ParentAccountAdminService } from './parent-account-admin.service.js';
import { ParentAccountController } from './parent-account.controller.js';
import { TaxonomyController } from './taxonomy.controller.js';
import { TaxonomyService } from './taxonomy.service.js';

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
  ],
  controllers: [AdminAuthController, TaxonomyController, ParentAccountController],
  providers: [
    AdminAuthService,
    AdminAuthGuard,
    AdminAuditService,
    TaxonomyService,
    ParentAccountAdminService,
  ],
  exports: [TaxonomyService, ParentAccountAdminService],
})
export class AdminModule {}
