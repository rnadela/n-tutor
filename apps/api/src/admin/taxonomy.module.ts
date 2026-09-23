import { Module } from '@nestjs/common';
import { AdminAuditService } from './admin-audit.service.js';
import { TaxonomyService } from './taxonomy.service.js';

/**
 * The taxonomy as a shared read.
 *
 * `AdminModule` already imports `IdentityModule` — it writes tiers through
 * `ParentAccountService` — so `identity` importing `AdminModule` back, merely to
 * read a Grade Level, would close a cycle. `forwardRef` would compile and hide
 * that rather than resolve it.
 *
 * Lifting the two providers `identity` actually needs — `TaxonomyService` and
 * the `AdminAuditService` it depends on — into a module both import states the
 * real shape instead: the taxonomy is a shared read, and `admin` is still its
 * only writer (AD-17, AD-25). Only `admin` mounts the write routes.
 */
@Module({
  providers: [AdminAuditService, TaxonomyService],
  exports: [AdminAuditService, TaxonomyService],
})
export class TaxonomyModule {}
