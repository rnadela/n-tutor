import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { currentAuthPolicy, type AuthPolicy } from './auth-policy.js';
import { ConfirmPasswordResetDto, RequestPasswordResetDto } from './dto/password-reset.dto.js';
import { ParentSignInDto } from './dto/parent-sign-in.dto.js';
import { SignUpDto } from './dto/sign-up.dto.js';
import { ParentCredentialRoute } from './parent-credential-route.decorator.js';
import { ParentAuthService, type ParentSessionView } from './parent-auth.service.js';
import { ParentSessionGuard, type ParentRequest } from './parent-session.guard.js';
import { clearSessionCookie, setSessionCookie } from './parent-session.cookie.js';
import { clearStudentModeCookie } from './student-mode.cookie.js';

/**
 * The parent-facing credential surface, mounted at `/api/auth`. The session is
 * an httpOnly cookie: no token is ever handed to the browser's JavaScript.
 *
 * The four credential-touching POSTs — every route that runs argon2 or issues a
 * link — spend the `parent` throttler budget and skip the admin `login` bucket;
 * the rest skip the credential budget entirely.
 */
@Controller('auth')
export class ParentAuthController {
  constructor(private readonly auth: ParentAuthService) {}

  /** The single source of the password minimum and the current versions. */
  @Get('policy')
  @SkipThrottle({ login: true })
  policy(): AuthPolicy {
    return currentAuthPolicy();
  }

  @Post('sign-up')
  @ParentCredentialRoute()
  @SkipThrottle({ default: true, login: true })
  @HttpCode(HttpStatus.CREATED)
  async signUp(
    @Body() dto: SignUpDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ id: string; email: string }> {
    const session = await this.auth.signUp(dto);
    setSessionCookie(res, session.token, session.ttlSeconds);
    // A binding left by whoever used this device before belongs to another
    // account, and would still satisfy its own guard: a new account starts
    // unbound and binds when its first profile is created.
    clearStudentModeCookie(res);
    return { id: session.parentAccountId, email: session.email };
  }

  @Post('sign-in')
  @ParentCredentialRoute()
  @SkipThrottle({ default: true, login: true })
  @HttpCode(HttpStatus.OK)
  async signIn(
    @Body() dto: ParentSignInDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ id: string; email: string }> {
    const session = await this.auth.signIn(dto.email, dto.password);
    setSessionCookie(res, session.token, session.ttlSeconds);
    // Signing in is attaching this device to an account; whatever child it was
    // handed to under the previous one is not this account's to hand.
    clearStudentModeCookie(res);
    return { id: session.parentAccountId, email: session.email };
  }

  /**
   * Clearing the cookies is the whole of sign-out; there is no server session.
   *
   * Both of them: the device stops being attached to the account it was signed
   * out of, so it must not sit in a Student Mode belonging to that account.
   */
  @Post('sign-out')
  @SkipThrottle({ login: true })
  @HttpCode(HttpStatus.NO_CONTENT)
  signOut(@Res({ passthrough: true }) res: Response): void {
    clearSessionCookie(res);
    clearStudentModeCookie(res);
  }

  @Get('me')
  @SkipThrottle({ login: true })
  @UseGuards(ParentSessionGuard)
  me(@Req() req: ParentRequest): Promise<ParentSessionView> {
    return this.auth.sessionFor(req.parent!.parentAccountId);
  }

  /** 204 whether or not the email is registered, and whether or not mail sends. */
  @Post('password-reset/request')
  @ParentCredentialRoute()
  @SkipThrottle({ default: true, login: true })
  @HttpCode(HttpStatus.NO_CONTENT)
  async requestPasswordReset(@Body() dto: RequestPasswordResetDto): Promise<void> {
    await this.auth.requestPasswordReset(dto.email);
  }

  @Post('password-reset/confirm')
  @ParentCredentialRoute()
  @SkipThrottle({ default: true, login: true })
  @HttpCode(HttpStatus.NO_CONTENT)
  async confirmPasswordReset(@Body() dto: ConfirmPasswordResetDto): Promise<void> {
    await this.auth.confirmPasswordReset(dto.token, dto.password);
  }
}
