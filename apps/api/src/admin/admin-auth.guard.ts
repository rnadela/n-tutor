import {
  CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { ADMIN_JWT_AUDIENCE, ADMIN_JWT_ISSUER } from './admin-auth.constants.js';

export interface AdminPrincipal {
  adminUserId: string;
  email: string;
}

export interface AdminRequest extends Request {
  admin?: AdminPrincipal;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Accepts only tokens minted for the admin audience, with the claims the
 * handlers and the audit trail depend on actually present. A parent-scoped
 * token can never satisfy this guard, and an admin token can never satisfy a
 * parent guard (AD-25).
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const header = request.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Not authorised.');
    }

    let payload: Record<string, unknown>;
    try {
      payload = await this.jwt.verifyAsync<Record<string, unknown>>(
        header.slice('Bearer '.length),
        { audience: ADMIN_JWT_AUDIENCE, issuer: ADMIN_JWT_ISSUER },
      );
    } catch {
      throw new UnauthorizedException('Not authorised.');
    }

    if (
      payload.scope !== ADMIN_JWT_AUDIENCE ||
      !nonEmptyString(payload.sub) ||
      !nonEmptyString(payload.email)
    ) {
      throw new UnauthorizedException('Not authorised.');
    }

    request.admin = { adminUserId: payload.sub, email: payload.email };
    return true;
  }
}
