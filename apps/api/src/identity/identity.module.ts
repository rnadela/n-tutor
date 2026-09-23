import { Module } from '@nestjs/common';
import { ParentAccountService } from './parent-account.service.js';

/**
 * The `identity` module: sole owner and sole writer of ParentAccount and
 * AccountTimezone (AD-17). It exposes no controller — the Admin console reaches
 * it through `admin`'s route namespace, and parent-facing surfaces arrive with
 * Epic 1.
 */
@Module({
  providers: [ParentAccountService],
  exports: [ParentAccountService],
})
export class IdentityModule {}
