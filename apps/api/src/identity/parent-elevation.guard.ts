import {
  CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PARENT_SESSION_ISSUER } from './auth-policy.js';
import { ParentAccountService } from './parent-account.service.js';
import { NOT_ELEVATED, PARENT_ELEVATION_AUDIENCE, isWithinCeiling } from './pin-policy.js';

export interface ElevatedPrincipal {
  parentAccountId: string;
  email: string;
  /** The instant of the PIN crossing, from which the 8-hour ceiling runs. */
  elevatedAt: Date;
  /** This token's own expiry, so the parent-scoped read can state it. */
  expiresAt: Date;
}

export interface ElevatedRequest extends Request {
  elevated?: ElevatedPrincipal;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * The guard's one rejection, carrying `elevated: false`.
 *
 * The flag is what makes this 401 distinguishable from a wrong-credential 401
 * on the same route: without it the change screen cannot tell "your PIN is
 * wrong" from "your Parent View has ended", and would tell a parent whose
 * elevation expired that their PIN was incorrect instead of sending them back
 * to the gate. The same shape as the 423's `lockedUntil`.
 */
function notElevated(): UnauthorizedException {
  return new UnauthorizedException({
    statusCode: 401,
    message: NOT_ELEVATED,
    elevated: false,
  });
}

function bearerFrom(request: Request): string | null {
  const header = request.headers.authorization;
  if (!nonEmptyString(header)) return null;
  const [scheme, ...rest] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer') return null;
  const token = rest.join(' ').trim();
  return token.length > 0 ? token : null;
}

/**
 * The elevation guard: `Authorization: Bearer` only.
 *
 * It never reads a cookie, so the session credential cannot even be presented
 * to it, and the audiences differ so neither token verifies at the other's
 * guard (AD-18). It never re-mints either: the session guard refreshes itself
 * silently, but elevation is extended only by an explicit request the parent's
 * own activity drives.
 */
@Injectable()
export class ParentElevationGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly accounts: ParentAccountService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ElevatedRequest>();
    const token = bearerFrom(request);
    if (token === null) throw notElevated();

    let payload: Record<string, unknown>;
    try {
      payload = await this.jwt.verifyAsync<Record<string, unknown>>(token, {
        audience: PARENT_ELEVATION_AUDIENCE,
        issuer: PARENT_SESSION_ISSUER,
      });
    } catch {
      throw notElevated();
    }

    // Claim by claim, exactly as the session guard does: the separation must
    // not quietly decay into a single audience check.
    if (
      payload.scope !== PARENT_ELEVATION_AUDIENCE ||
      !nonEmptyString(payload.sub) ||
      !nonEmptyString(payload.email) ||
      typeof payload.epoch !== 'number' ||
      typeof payload.elevatedAt !== 'number' ||
      !Number.isFinite(payload.elevatedAt) ||
      // An elevation token without an expiry is not one: without this it would
      // live until the ceiling alone, and `expiresAt` would be a 1970 instant.
      typeof payload.exp !== 'number'
    ) {
      throw notElevated();
    }

    const elevatedAt = new Date(payload.elevatedAt);
    // Past the ceiling the PIN must be crossed again; no refresh reaches back.
    if (!isWithinCeiling(elevatedAt, new Date())) {
      throw notElevated();
    }

    const account = await this.accounts.findSessionSubject(payload.sub);
    // A completed password reset ends elevation too, by the same stale epoch
    // that ends the session.
    if (!account || account.sessionEpoch !== payload.epoch) {
      throw notElevated();
    }

    request.elevated = {
      parentAccountId: account.id,
      email: account.email,
      elevatedAt,
      expiresAt: new Date(payload.exp * 1000),
    };
    return true;
  }
}
