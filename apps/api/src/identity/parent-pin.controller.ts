import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ChangePinDto, SetPinDto, VerifyPinDto } from './dto/parent-pin.dto.js';
import { ParentCredentialRoute } from './parent-credential-route.decorator.js';
import { ParentElevationGuard, type ElevatedRequest } from './parent-elevation.guard.js';
import { ParentPinService, type Elevation, type PinStatus } from './parent-pin.service.js';
import { ParentSessionGuard, type ParentRequest } from './parent-session.guard.js';
import { elevationCeilingFrom } from './pin-policy.js';

/** The parent-scoped read that makes the gate observable. */
export interface ElevatedSessionView {
  id: string;
  email: string;
  expiresAt: string;
  ceilingAt: string;
}

/**
 * The Parent View surface, mounted at `/api/parent`.
 *
 * Two credentials, two guards: the PIN routes a signed-in parent needs before
 * elevation exists take the session cookie, and everything behind the gate
 * takes the elevation bearer, which the cookie alone can never satisfy (AD-18).
 *
 * Every POST that runs argon2 spends the `parent` throttler budget and skips
 * the admin `login` bucket; the status read and the refresh spend neither.
 */
@Controller('parent')
export class ParentPinController {
  constructor(private readonly pins: ParentPinService) {}

  @Get('pin/status')
  @SkipThrottle({ login: true })
  @UseGuards(ParentSessionGuard)
  status(@Req() req: ParentRequest): Promise<PinStatus> {
    return this.pins.status(req.parent!.parentAccountId);
  }

  @Post('pin')
  @ParentCredentialRoute()
  @SkipThrottle({ default: true, login: true })
  @UseGuards(ParentSessionGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async setPin(@Req() req: ParentRequest, @Body() dto: SetPinDto): Promise<void> {
    await this.pins.setPin(req.parent!.parentAccountId, dto.pin);
  }

  @Post('pin/verify')
  @ParentCredentialRoute()
  @SkipThrottle({ default: true, login: true })
  @UseGuards(ParentSessionGuard)
  @HttpCode(HttpStatus.OK)
  verifyPin(@Req() req: ParentRequest, @Body() dto: VerifyPinDto): Promise<Elevation> {
    return this.pins.verifyPin(req.parent!, dto.pin);
  }

  @Post('pin/change')
  @ParentCredentialRoute()
  @SkipThrottle({ default: true, login: true })
  @UseGuards(ParentElevationGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePin(@Req() req: ElevatedRequest, @Body() dto: ChangePinDto): Promise<void> {
    const elevated = req.elevated!;
    await this.pins.changePin(elevated, {
      newPin: dto.newPin,
      ...(dto.currentPin === undefined ? {} : { currentPin: dto.currentPin }),
      ...(dto.password === undefined ? {} : { password: dto.password }),
    });
  }

  /** A replacement token, never an extension: the ceiling comes along unchanged. */
  @Post('elevation/refresh')
  @SkipThrottle({ login: true })
  @UseGuards(ParentElevationGuard)
  @HttpCode(HttpStatus.OK)
  refresh(@Req() req: ElevatedRequest): Promise<Elevation> {
    const { parentAccountId, email, elevatedAt } = req.elevated!;
    return this.pins.refreshElevation({ parentAccountId, email, elevatedAt });
  }

  @Get('session')
  @SkipThrottle({ login: true })
  @UseGuards(ParentElevationGuard)
  session(@Req() req: ElevatedRequest): ElevatedSessionView {
    const elevated = req.elevated!;
    return {
      id: elevated.parentAccountId,
      email: elevated.email,
      expiresAt: elevated.expiresAt.toISOString(),
      ceilingAt: elevationCeilingFrom(elevated.elevatedAt).toISOString(),
    };
  }
}
