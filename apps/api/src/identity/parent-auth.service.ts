import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { requireIntEnv, requireWebOrigin } from '../common/env.js';
import { MailDispatchError, MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CHILD_DATA_CONSENT_VERSION,
  DEFAULT_PARENT_SESSION_TTL_SECONDS,
  PARENT_SESSION_AUDIENCE,
  PARENT_SESSION_ISSUER,
  RESET_EMAIL_SUBJECT,
  RESET_FAILED,
  SIGN_IN_FAILED,
  SIGN_UP_FAILED,
  TERMS_VERSION,
  acceptsCurrentVersions,
  isAcceptablePassword,
  resetEmailText,
  resetLinkFor,
  resetTokenExpiryFrom,
} from './auth-policy.js';
import { ParentAccountService } from './parent-account.service.js';

/**
 * A real argon2id hash, verified when the email is unknown so that an unknown
 * email and a wrong password cost the same and take the same path. Deliberately
 * local: `admin` must never become a dependency of `identity` (AD-17).
 */
export const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$c29tZS1zdGF0aWMtZHVtbXktc2FsdA$8kPvZkBw7C1LEIOsWMLA3cLTSbn0OcaXJAsnJ4npvHc';

export interface ParentSession {
  token: string;
  /** Seconds; the cookie's `maxAge` matches it exactly. */
  ttlSeconds: number;
  parentAccountId: string;
  email: string;
}

export interface ParentSessionView {
  id: string;
  email: string;
  timezone: string;
}

/** 32 random bytes, base64url. The plaintext exists only in the emailed link. */
export function generateResetToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Tokens are stored hashed; a leaked table yields no usable link. */
export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

export function parentSessionTtlSeconds(): number {
  return requireIntEnv('PARENT_SESSION_TTL_SECONDS', DEFAULT_PARENT_SESSION_TTL_SECONDS);
}

@Injectable()
export class ParentAuthService {
  private readonly logger = new Logger(ParentAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: ParentAccountService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
  ) {}

  // --- Sessions ----------------------------------------------------------

  /**
   * Mints the session credential: audience `parent-session`, carrying the
   * account's current session epoch so a password reset can revoke it.
   */
  async mintSession(account: {
    id: string;
    email: string;
    sessionEpoch: number;
  }): Promise<ParentSession> {
    const ttlSeconds = parentSessionTtlSeconds();
    const token = await this.jwt.signAsync(
      { email: account.email, scope: PARENT_SESSION_AUDIENCE, epoch: account.sessionEpoch },
      {
        subject: account.id,
        audience: PARENT_SESSION_AUDIENCE,
        issuer: PARENT_SESSION_ISSUER,
        expiresIn: ttlSeconds,
      },
    );
    return { token, ttlSeconds, parentAccountId: account.id, email: account.email };
  }

  /** The `GET /api/auth/me` body: identity plus the zone in force right now. */
  async sessionFor(parentAccountId: string): Promise<ParentSessionView> {
    const account = await this.accounts.findSessionSubject(parentAccountId);
    if (!account) throw new UnauthorizedException(SIGN_IN_FAILED);
    return {
      id: account.id,
      email: account.email,
      timezone: await this.accounts.effectiveTimezoneAt(account.id, new Date()),
    };
  }

  // --- Credentials -------------------------------------------------------

  async signUp(input: {
    email: string;
    password: string;
    timezone: string;
    termsVersion: string;
    noticeVersion: string;
  }): Promise<ParentSession> {
    // A stale acceptance and a weak password are both generic sign-up failures:
    // the endpoint has exactly one rejection message so a duplicate email is
    // indistinguishable from any other reason.
    if (!isAcceptablePassword(input.password)) throw new BadRequestException(SIGN_UP_FAILED);
    if (!acceptsCurrentVersions(input)) throw new BadRequestException(SIGN_UP_FAILED);

    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    const acceptedAt = new Date();

    let account: { id: string; email: string };
    try {
      // The zone check inside `create` throws its own named 400 before the
      // transaction opens; only the duplicate-email conflict is flattened.
      account = await this.accounts.create({
        email: input.email,
        timezone: input.timezone,
        effectiveFrom: acceptedAt,
        passwordHash,
        consent: {
          termsVersion: TERMS_VERSION,
          noticeVersion: CHILD_DATA_CONSENT_VERSION,
          acceptedAt,
        },
      });
    } catch (cause) {
      // `identity`'s conflict names the email; this surface must not.
      if (cause instanceof ConflictException) throw new BadRequestException(SIGN_UP_FAILED);
      throw cause;
    }

    return this.mintSession({ ...account, sessionEpoch: 0 });
  }

  async signIn(email: string, password: string): Promise<ParentSession> {
    const account = await this.accounts.findCredentialByEmail(email);

    // An account with no credential is treated exactly as an unknown email:
    // same hash verification, same cost, same message.
    const hash = account?.passwordHash ?? DUMMY_HASH;
    let verified = false;
    try {
      verified = await argon2.verify(hash, password);
    } catch {
      verified = false;
    }

    if (!account?.passwordHash || !verified) {
      throw new UnauthorizedException(SIGN_IN_FAILED);
    }

    // The epoch comes from the same read as the credential: a second query
    // could find the row gone and turn this endpoint's single rejection shape
    // into a 404.
    return this.mintSession({
      id: account.id,
      email: account.email,
      sessionEpoch: account.sessionEpoch,
    });
  }

  // --- Password reset ----------------------------------------------------

  /**
   * Always resolves, whatever the email is: the response must be identical for
   * a registered and an unregistered address. An account with no credential is
   * served nothing either — reset must not become the sign-in path `signIn`
   * refuses it.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const account = await this.accounts.findCredentialByEmail(email);
    if (!account?.passwordHash) return;

    const token = generateResetToken();
    const now = new Date();

    await this.prisma.withTransaction(async (tx) => {
      // At most one live link per account: a new request retires the rest.
      await tx.passwordReset.updateMany({
        where: { parentAccountId: account.id, usedAt: null },
        data: { usedAt: now },
      });
      await tx.passwordReset.create({
        data: {
          parentAccountId: account.id,
          tokenHash: hashResetToken(token),
          expiresAt: resetTokenExpiryFrom(now),
        },
      });
    });

    const link = resetLinkFor(requireWebOrigin(), token);
    try {
      await this.mail.send({
        to: account.email,
        subject: RESET_EMAIL_SUBJECT,
        text: resetEmailText(link),
      });
    } catch (cause) {
      // A transport failure is logged, never surfaced: the response must stay
      // identical to the unregistered case.
      if (cause instanceof MailDispatchError) {
        this.logger.error(`Password-reset mail could not be dispatched: ${cause.message}`);
        return;
      }
      throw cause;
    }
  }

  /**
   * Claims the token inside a transaction, guarded on `usedAt: null`, so two
   * concurrent confirmations cannot both succeed. Sets the new credential and
   * bumps the session epoch, ending every session minted before the reset.
   */
  async confirmPasswordReset(token: string, password: string): Promise<void> {
    if (!isAcceptablePassword(password)) throw new BadRequestException(RESET_FAILED);

    const tokenHash = hashResetToken(token);
    const now = new Date();

    await this.prisma.withTransaction(async (tx) => {
      const claimed = await tx.passwordReset.updateMany({
        where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count === 0) throw new BadRequestException(RESET_FAILED);

      const row = await tx.passwordReset.findUnique({
        where: { tokenHash },
        select: { parentAccountId: true },
      });
      if (!row) throw new BadRequestException(RESET_FAILED);

      // Hashed only once the token is claimed: argon2id is expensive enough
      // that paying it for a bogus token is a denial of service of its own.
      const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
      await this.accounts.setPasswordHash(tx, row.parentAccountId, passwordHash);
      // Any other link that was still live is retired with this one.
      await tx.passwordReset.updateMany({
        where: { parentAccountId: row.parentAccountId, usedAt: null },
        data: { usedAt: now },
      });
    });
  }
}
