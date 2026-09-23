import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AdminAuthService, type AdminSession } from './admin-auth.service.js';
import { AdminAuthGuard, type AdminRequest } from './admin-auth.guard.js';
import { SignInDto } from './dto/sign-in.dto.js';

@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  /**
   * The only `/api/admin/*` route reachable without an admin-scoped token, and
   * the tightest rate limit in the app: argon2 is expensive enough that a login
   * flood is a CPU denial of service (AD-23).
   */
  @SkipThrottle({ default: true })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  signIn(@Body() dto: SignInDto): Promise<AdminSession> {
    return this.auth.signIn(dto.email, dto.password);
  }

  @Get('me')
  @SkipThrottle({ login: true })
  @UseGuards(AdminAuthGuard)
  me(@Req() req: AdminRequest): { email: string } {
    return { email: req.admin!.email };
  }
}
