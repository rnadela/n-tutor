import { Module } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { requireParentJwtSecret } from '../common/env.js';
import { MailModule } from '../mail/mail.module.js';
import { PARENT_JWT } from './auth-policy.js';
import { ParentAccountService } from './parent-account.service.js';
import { ParentAuthController } from './parent-auth.controller.js';
import { ParentAuthService } from './parent-auth.service.js';
import { ParentSessionGuard } from './parent-session.guard.js';

/**
 * The `identity` module: sole owner and sole writer of ParentAccount,
 * AccountTimezone, AccountConsent and PasswordReset (AD-17). The credential
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
  ],
  controllers: [ParentAuthController],
  providers: [
    { provide: PARENT_JWT, useExisting: JwtService },
    ParentAccountService,
    ParentAuthService,
    ParentSessionGuard,
  ],
  exports: [ParentAccountService],
})
export class IdentityModule {}
