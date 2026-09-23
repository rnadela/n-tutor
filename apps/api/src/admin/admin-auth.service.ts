import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  ADMIN_JWT_AUDIENCE,
  ADMIN_JWT_ISSUER,
  ADMIN_SIGN_IN_FAILED,
} from './admin-auth.constants.js';
import { AdminAuditService, ANONYMOUS_ACTOR } from './admin-audit.service.js';

/**
 * A real argon2 hash verified when the email is unknown, so an unknown email
 * and a wrong password cost the same and take the same path.
 */
export const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$c29tZS1zdGF0aWMtZHVtbXktc2FsdA$8kPvZkBw7C1LEIOsWMLA3cLTSbn0OcaXJAsnJ4npvHc';

export interface AdminSession {
  token: string;
  email: string;
}

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AdminAuditService,
  ) {}

  static normaliseEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  async signIn(email: string, password: string): Promise<AdminSession> {
    const normalised = AdminAuthService.normaliseEmail(email);
    const operator = await this.prisma.adminUser.findUnique({ where: { email: normalised } });

    const hash = operator?.passwordHash ?? DUMMY_HASH;
    let verified = false;
    try {
      verified = await argon2.verify(hash, password);
    } catch {
      verified = false;
    }

    if (!operator || !verified) {
      // A failed sign-in is accountable too; the response still says nothing.
      // The audit write is best-effort here: it records no data of its own to
      // roll back, so a transient failure must not turn this 401 into a 500.
      try {
        await this.audit.record(
          this.prisma,
          operator?.id ?? ANONYMOUS_ACTOR,
          'auth.signIn.failed',
          'AdminUser',
          operator?.id ?? ANONYMOUS_ACTOR,
          { reason: 'invalid_credentials' },
        );
      } catch {
        // Swallowed: sign-in must still fail with 401, not 500.
      }
      throw new UnauthorizedException(ADMIN_SIGN_IN_FAILED);
    }

    const token = await this.jwt.signAsync(
      { email: operator.email, scope: ADMIN_JWT_AUDIENCE },
      { subject: operator.id, audience: ADMIN_JWT_AUDIENCE, issuer: ADMIN_JWT_ISSUER },
    );
    return { token, email: operator.email };
  }
}
