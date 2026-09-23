import { Module } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { requireParentJwtSecret } from '../common/env.js';
import { TaxonomyModule } from '../admin/taxonomy.module.js';
import { MailModule } from '../mail/mail.module.js';
import { PARENT_JWT } from './auth-policy.js';
import { ParentAccountService } from './parent-account.service.js';
import { ParentAuthController } from './parent-auth.controller.js';
import { ParentAuthService } from './parent-auth.service.js';
import { ParentElevationGuard } from './parent-elevation.guard.js';
import { ParentPinController } from './parent-pin.controller.js';
import { ParentPinService } from './parent-pin.service.js';
import { pinRuntime } from './pin-policy.js';
import { ParentSessionGuard } from './parent-session.guard.js';
import { StudentProfileController } from './student-profile.controller.js';
import { StudentProfileService } from './student-profile.service.js';

/**
 * The `identity` module: sole owner and sole writer of ParentAccount,
 * AccountTimezone, AccountConsent, PasswordReset and StudentProfile (AD-17).
 * The credential
 * half lives here rather than in an `auth` module of its own precisely because
 * a second writer of `parent_account` is the drift AD-17 exists to prevent.
 *
 * Its own JwtModule is registered on `PARENT_JWT_SECRET`, so an admin token is
 * not merely rejected by the parent guard — it cannot be verified by it at all
 * (AD-25).
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({ secret: requireParentJwtSecret() }),
    }),
    MailModule,
    // A shared taxonomy read, not a dependency on `admin`: AdminModule imports
    // this module, so importing it back would close a cycle.
    TaxonomyModule,
  ],
  controllers: [ParentAuthController, ParentPinController, StudentProfileController],
  providers: [
    { provide: PARENT_JWT, useExisting: JwtService },
    ParentAccountService,
    ParentAuthService,
    ParentPinService,
    ParentSessionGuard,
    ParentElevationGuard,
    StudentProfileService,
  ],
  // StudentProfileService is exported for Story 1.4's device binding.
  exports: [ParentAccountService, StudentProfileService],
})
export class IdentityModule {
  constructor() {
    // Resolved and checked as the module is constructed, so a mistyped PIN or
    // elevation override fails the process at boot rather than turning the
    // first request that touches the gate into a 500.
    pinRuntime();
  }
}
