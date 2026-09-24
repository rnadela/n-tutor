import { Controller, Get, Param, ParseUUIDPipe, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ParentElevationGuard } from '../identity/parent-elevation.guard.js';
import type { ElevatedRequest } from '../identity/parent-elevation.guard.js';
import { ExtractionService, type ExtractionStatusView } from './extraction.service.js';

/**
 * The Extraction's only read surface: job status plus counts.
 *
 * There is no route here that returns a question, a choice, a topic or a
 * passage, and that is the design rather than an omission — Extraction is not a
 * browsable product surface in v0, and one endpoint that returned content would
 * be the first half of making it one. Counts plus a status is exactly what
 * Story 3.6's thin-Extraction warning and Epic 4's generate step read.
 *
 * It sits on `parent/source-tests` beside `sourcetest`'s own routes because it
 * is a fact *about* a Source Test, and the id in the path is a Source Test's.
 * Behind `ParentElevationGuard`, with the account taken from `req.elevated`
 * (AD-18): a foreign id matches nothing and answers 404, never 403.
 */
@Controller('parent/source-tests')
@SkipThrottle({ login: true })
@UseGuards(ParentElevationGuard)
export class ExtractionController {
  constructor(private readonly extraction: ExtractionService) {}

  @Get(':id/extraction')
  read(
    @Req() req: ElevatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ExtractionStatusView> {
    return this.extraction.statusFor(req.elevated!.parentAccountId, id);
  }
}
