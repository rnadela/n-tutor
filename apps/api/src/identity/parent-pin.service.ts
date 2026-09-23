import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service.js';
import { PARENT_SESSION_ISSUER } from './auth-policy.js';
import { ParentAccountService } from './parent-account.service.js';
import {
  PARENT_ELEVATION_AUDIENCE,
  PIN_ALREADY_SET,
  PIN_INCORRECT,
  PIN_LENGTH,
  PIN_LOCKED,
  PIN_NOT_SET,
  elevationCeilingFrom,
  elevationTtlSeconds,
  isLocked,
  isWellFormedPin,
  lockReachedAt,
} from './pin-policy.js';

/** What the gate screen needs, and nothing that is a secret. */
export interface PinStatus {
  pinSet: boolean;
  lockedUntil: string | null;
}

/** The elevation credential. The token exists only in the response body. */
export interface Elevation {
  token: string;
  /** ISO instants, so the client never does TTL arithmetic of its own. */
  expiresAt: string;
  ceilingAt: string;
}

const PIN_SHAPE = `The PIN must be exactly ${PIN_LENGTH} digits.`;

/**
 * 423 Locked, carrying when the lock lifts. The instant is the whole point of
 * the response: the copy states when the gate re-opens rather than how many
 * entries were spent.
 */
export class PinLockedException extends HttpException {
  constructor(lockedUntil: Date) {
    super(
      {
        statusCode: HttpStatus.LOCKED,
        message: PIN_LOCKED,
        lockedUntil: lockedUntil.toISOString(),
      },
      HttpStatus.LOCKED,
    );
  }
}

/**
 * The Parent PIN and the elevation it mints.
 *
 * Every column it touches is written through `ParentAccountService`, which stays
 * the sole writer of `parent_account` (AD-17). The lock is checked before
 * argon2 runs, so a locked account costs nothing and the time a rejection takes
 * cannot say whether the entered PIN was right.
 */
@Injectable()
export class ParentPinService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: ParentAccountService,
    private readonly jwt: JwtService,
  ) {}

  // --- Reads ---------------------------------------------------------------

  async status(parentAccountId: string, now: Date = new Date()): Promise<PinStatus> {
    const state = await this.requireState(parentAccountId);
    return {
      pinSet: state.pinHash !== null,
      // A lapsed lock is no lock: the status must not show one the next entry
      // would sail straight through.
      lockedUntil: isLocked(state, now) ? state.pinLockedUntil!.toISOString() : null,
    };
  }

  // --- Writes --------------------------------------------------------------

  /**
   * The first PIN. Takes only the session, exactly as the story states — there
   * is no second credential to take yet. Setting is not a change path: an
   * account that already has a PIN is refused here and sent to `changePin`.
   */
  async setPin(parentAccountId: string, pin: string): Promise<void> {
    if (!isWellFormedPin(pin)) throw new BadRequestException(PIN_SHAPE);
    const state = await this.requireState(parentAccountId);
    if (state.pinHash !== null) throw new ConflictException(PIN_ALREADY_SET);

    const pinHash = await argon2.hash(pin, { type: argon2.argon2id });
    // Conditional on there still being no PIN: the read above only saves the
    // hashing cost in the common case, it does not settle the race.
    const written = await this.prisma.withTransaction((tx) =>
      this.accounts.setFirstPin(tx, parentAccountId, pinHash),
    );
    if (!written) throw new ConflictException(PIN_ALREADY_SET);
  }

  /**
   * The PIN crossing. Mints elevation on success; on failure moves the counter
   * or closes the gate, both as a row rather than as memory, so a restart
   * changes nothing.
   */
  async verifyPin(
    account: { parentAccountId: string; email: string },
    pin: string,
    now: Date = new Date(),
  ): Promise<Elevation> {
    const state = await this.requireState(account.parentAccountId);
    if (state.pinHash === null) throw new ConflictException(PIN_NOT_SET);
    // Before argon2: a locked account pays for no hash, and the correct PIN
    // takes exactly as long to refuse as a wrong one.
    if (isLocked(state, now)) throw new PinLockedException(state.pinLockedUntil!);

    const verified = await this.verifyAgainst(state.pinHash, pin);
    if (!verified) {
      const lockedUntil = await this.countFailure(account.parentAccountId, now);
      if (lockedUntil !== null) throw new PinLockedException(lockedUntil);
      throw new UnauthorizedException(PIN_INCORRECT);
    }

    await this.prisma.withTransaction((tx) =>
      this.accounts.clearPinFailures(tx, account.parentAccountId),
    );
    // Minted only once the reset has committed: a token handed out beside a
    // failed write would outlive a counter that never moved.
    return this.mintElevation({
      parentAccountId: account.parentAccountId,
      email: account.email,
      sessionEpoch: state.sessionEpoch,
      elevatedAt: now,
    });
  }

  /**
   * Changes the PIN from inside Parent View, on the current PIN or on the
   * account password. A wrong PIN spends an attempt; a wrong password does not
   * — the counter guards the PIN secret, and the password has its own throttle
   * and its own reset path.
   */
  async changePin(
    account: { parentAccountId: string; email: string },
    input: { newPin: string; currentPin?: string; password?: string },
    now: Date = new Date(),
  ): Promise<void> {
    if (!isWellFormedPin(input.newPin)) throw new BadRequestException(PIN_SHAPE);

    const state = await this.requireState(account.parentAccountId);
    if (state.pinHash === null) throw new ConflictException(PIN_NOT_SET);

    if (input.currentPin !== undefined) {
      if (isLocked(state, now)) throw new PinLockedException(state.pinLockedUntil!);
      const verified = await this.verifyAgainst(state.pinHash, input.currentPin);
      if (!verified) {
        const lockedUntil = await this.countFailure(account.parentAccountId, now);
        if (lockedUntil !== null) throw new PinLockedException(lockedUntil);
        throw new UnauthorizedException(PIN_INCORRECT);
      }
    } else {
      // The password path is deliberately untouched by the lock: a parent
      // already inside Parent View must not be shut out of changing the PIN by
      // the very counter that guards it.
      //
      // Resolved by account id, never by the token's email claim: the guard has
      // already established which account this is, and that is the account
      // whose password must be the one verified.
      const credential = await this.accounts.findCredentialById(account.parentAccountId);
      const verified =
        credential?.passwordHash != null &&
        (await this.verifyAgainst(credential.passwordHash, input.password ?? ''));
      if (!verified) throw new UnauthorizedException(PIN_INCORRECT);
    }

    const pinHash = await argon2.hash(input.newPin, { type: argon2.argon2id });
    await this.prisma.withTransaction((tx) =>
      this.accounts.setPin(tx, account.parentAccountId, pinHash),
    );
  }

  // --- Elevation -----------------------------------------------------------

  /**
   * The elevation credential: audience `parent-elevation`, carrying both the
   * session epoch (so a password reset ends elevation too) and the instant of
   * the PIN crossing (so the ceiling is stateless and unforgeable — the client
   * holds the number but cannot change it without breaking the signature).
   */
  async mintElevation(input: {
    parentAccountId: string;
    email: string;
    sessionEpoch: number;
    elevatedAt: Date;
  }): Promise<Elevation> {
    const ttlSeconds = elevationTtlSeconds();
    const token = await this.jwt.signAsync(
      {
        email: input.email,
        scope: PARENT_ELEVATION_AUDIENCE,
        epoch: input.sessionEpoch,
        elevatedAt: input.elevatedAt.getTime(),
      },
      {
        subject: input.parentAccountId,
        audience: PARENT_ELEVATION_AUDIENCE,
        issuer: PARENT_SESSION_ISSUER,
        expiresIn: ttlSeconds,
      },
    );
    return {
      token,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
      ceilingAt: elevationCeilingFrom(input.elevatedAt).toISOString(),
    };
  }

  /**
   * A replacement token carrying the **original** `elevatedAt`. The client can
   * ask for one but can never extend the window: the guard has already refused
   * anything past the ceiling before this runs.
   */
  async refreshElevation(elevated: {
    parentAccountId: string;
    email: string;
    elevatedAt: Date;
  }): Promise<Elevation> {
    const state = await this.requireState(elevated.parentAccountId);
    return this.mintElevation({ ...elevated, sessionEpoch: state.sessionEpoch });
  }

  // --- Internals -----------------------------------------------------------

  /**
   * Counts one wrong entry and closes the gate if that entry reached the
   * ceiling. Returns the lock instant, or `null` while the allowance has room.
   *
   * The counter is incremented by the database and the decision is made on the
   * value that increment returned, so N wrong entries — however concurrent —
   * produce N distinct counts and the Nth reaches the ceiling. Both writes share
   * one transaction: a counter that hit the ceiling without the lock landing
   * beside it would leave the gate open on a spent allowance.
   */
  private async countFailure(parentAccountId: string, now: Date): Promise<Date | null> {
    return this.prisma.withTransaction(async (tx) => {
      const attempts = await this.accounts.recordPinFailure(tx, parentAccountId);
      const lockedUntil = lockReachedAt(attempts, now);
      if (lockedUntil !== null) await this.accounts.lockPin(tx, parentAccountId, lockedUntil);
      return lockedUntil;
    });
  }

  private async requireState(parentAccountId: string) {
    const state = await this.accounts.findPinState(parentAccountId);
    // The session guard has already resolved the account; a row gone between
    // the two reads is a dead session, not a 404.
    if (!state) throw new UnauthorizedException(PIN_INCORRECT);
    return state;
  }

  /** A malformed stored hash is a failed verification, never a 500. */
  private async verifyAgainst(hash: string, candidate: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, candidate);
    } catch {
      return false;
    }
  }
}
