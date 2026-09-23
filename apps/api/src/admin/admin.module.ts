import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { requireIntEnv, requireJwtSecret } from '../common/env.js';
import { AdminAuditService } from './admin-audit.service.js';
import { AdminAuthController } from './admin-auth.controller.js';
import { AdminAuthGuard } from './admin-auth.guard.js';
import { AdminAuthService } from './admin-auth.service.js';
import { TaxonomyController } from './taxonomy.controller.js';
import { TaxonomyService } from './taxonomy.service.js';

/**
 * The `admin` module: its own credential store, its own route namespace, and
 * sole ownership of Subject, GradeLevel, SubjectGradeLevel and AdminAudit
 * (AD-17, AD-25).
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: requireJwtSecret('ADMIN_JWT_SECRET'),
        signOptions: { expiresIn: requireIntEnv('ADMIN_JWT_TTL_SECONDS', 28_800) },
      }),
    }),
  ],
  controllers: [AdminAuthController, TaxonomyController],
  providers: [AdminAuthService, AdminAuthGuard, AdminAuditService, TaxonomyService],
  exports: [TaxonomyService],
})
export class AdminModule {}
