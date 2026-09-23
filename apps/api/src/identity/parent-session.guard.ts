import {
  CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import {
  PARENT_SESSION_AUDIENCE,
  PARENT_SESSION_COOKIE,
  PARENT_SESSION_ISSUER,
  SESSION_REMINT_AFTER_MS,
} from './auth-policy.js';
import { ParentAccountService } from './parent-account.service.js';
import { ParentAuthService } from './parent-auth.service.js';
import { setSessionCookie } from './parent-session.cookie.js';

export interface ParentPrincipal {
  parentAccountId: string;
  email: string;
}

export interface ParentRequest extends Request {
  parent?: ParentPrincipal;
  cookies: Record<string, string | undefined>;
}

const NOT_AUTHORISED = 'Not authorised.';

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * The parent session guard: cookie only. It never reads `Authorization`, so an
 * admin bearer token cannot even be presented to it — and because `identity`
 * registers its own JwtModule on `PARENT_JWT_SECRET`, an admin token would not
 * verify here even if it were (AD-25).
 */
@Injectable()
export class ParentSessionGuard implements CanActivate {
  private readonly logger = new Logger(ParentSessionGuard.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly accounts: ParentAccountService,
    private readonly auth: ParentAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ParentRequest>();
    const token = request.cookies?.[PARENT_SESSION_COOKIE];
    if (!nonEmptyString(token)) throw new UnauthorizedException(NOT_AUTHORISED);

    let payload: Record<string, unknown>;
    try {
      payload = await this.jwt.verifyAsync<Record<string, unknown>>(token, {
        audience: PARENT_SESSION_AUDIENCE,
        issuer: PARENT_SESSION_ISSUER,
      });
    } catch {
      throw new UnauthorizedException(NOT_AUTHORISED);
    }

    if (
      payload.scope !== PARENT_SESSION_AUDIENCE ||
      !nonEmptyString(payload.sub) ||
      !nonEmptyString(payload.email) ||
      typeof payload.epoch !== 'number'
    ) {
      throw new UnauthorizedException(NOT_AUTHORISED);
    }

    const account = await this.accounts.findSessionSubject(payload.sub);
    // A stale epoch is a session that a password reset has already ended.
    if (!account || account.sessionEpoch !== payload.epoch) {
      throw new UnauthorizedException(NOT_AUTHORISED);
    }

    request.parent = { parentAccountId: account.id, email: account.email };
    await this.remintIfStale(context, account, payload.iat);
    return true;
  }

  /**
   * The session ends at sign-out, not on the clock: a token older than a day
   * is replaced on the next authenticated request, so an active parent never
   * reaches the cookie's ceiling.
   */
  private async remintIfStale(
    context: ExecutionContext,
    account: { id: string; email: string; sessionEpoch: number },
    issuedAt: unknown,
  ): Promise<void> {
    if (typeof issuedAt !== 'number') return;
    if (Date.now() - issuedAt * 1000 < SESSION_REMINT_AFTER_MS) return;
    try {
      const session = await this.auth.mintSession(account);
      setSessionCookie(
        context.switchToHttp().getResponse<Response>(),
        session.token,
        session.ttlSeconds,
      );
    } catch (cause) {
      // A failed re-mint must not fail an otherwise-valid authenticated
      // request; the parent simply re-mints on a later request instead.
      this.logger.warn(
        `Session re-mint failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }
}
