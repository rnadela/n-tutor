import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { ParentAccountSummary } from '../identity/parent-account.service.js';
import { AdminAuthGuard, type AdminRequest } from './admin-auth.guard.js';
import { AssignTierDto } from './dto/parent-account.dto.js';
import {
  ParentAccountAdminService,
  type ParentAccountDetail,
} from './parent-account-admin.service.js';

/**
 * The only route namespace that reads or writes an Account Tier. There is no
 * self-serve path of any kind in v0, and no enforcement here — this surface is
 * view-and-assign only (Epic 9 owns blocking at cap).
 */
@Controller('admin/parent-accounts')
@UseGuards(AdminAuthGuard)
@SkipThrottle({ login: true })
export class ParentAccountController {
  constructor(private readonly accounts: ParentAccountAdminService) {}

  @Get()
  list(): Promise<ParentAccountSummary[]> {
    return this.accounts.list();
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string): Promise<ParentAccountDetail> {
    return this.accounts.detail(id);
  }

  /** Returns the same summary shape the list does, so the client has one type. */
  @Patch(':id/tier')
  assignTier(
    @Req() req: AdminRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignTierDto,
  ): Promise<ParentAccountSummary> {
    return this.accounts.assignTier(actor(req), id, dto.tier);
  }
}

function actor(req: AdminRequest): string {
  return req.admin!.adminUserId;
}
