import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ParentElevationGuard, type ElevatedRequest } from '../identity/parent-elevation.guard.js';
import { RequestPracticeTestsDto } from './dto/practice-test.dto.js';
import {
  PracticeTestService,
  type GenerationAllowanceView,
  type GenerationJobView,
  type GenerationTopicsView,
} from './practice-test.service.js';

/**
 * The generate step's four routes: what is left to spend, the Topics a request
 * may be weighted on, the request itself, and where the job stands.
 *
 * There is no route here that returns a generated Question, and that is the
 * design rather than an omission — draft review is Story 4.3's, and one
 * endpoint that returned content now would be the first half of shipping it
 * without the human quality gate the epic exists for.
 *
 * Every route is behind `ParentElevationGuard`, and the account is taken from
 * `req.elevated` and never from the path or the body (AD-18). A Source Test id
 * belonging to another account therefore matches nothing and answers 404, never
 * 403. Nothing here is reachable from a student-scoped surface: an allowance
 * figure, a tier label and a model name are parent-only facts.
 */
@Controller('parent')
@SkipThrottle({ login: true })
@UseGuards(ParentElevationGuard)
export class PracticeTestController {
  constructor(private readonly practiceTests: PracticeTestService) {}

  /** What this account has left, and the ceiling one request may ask for. */
  @Get('allowance/generation')
  allowance(@Req() req: ElevatedRequest): Promise<GenerationAllowanceView> {
    return this.practiceTests.allowanceFor(req.elevated!.parentAccountId);
  }

  /**
   * Asks for Practice Tests, and answers with the job as it was actually
   * accepted — the clamped count included, so the response is the only account
   * of what the parent is spending.
   *
   * 202 rather than 201: nothing has been created yet. The job outlives the
   * request that enqueued it (AD-5), and the progress read is what says when
   * something exists.
   */
  @Post('source-tests/:id/practice-tests')
  @HttpCode(HttpStatus.ACCEPTED)
  request(
    @Req() req: ElevatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestPracticeTestsDto,
  ): Promise<GenerationJobView> {
    return this.practiceTests.request(
      req.elevated!.parentAccountId,
      id,
      dto.count,
      dto.weightedTopic ?? null,
    );
  }

  /**
   * The Topics this upload's Extraction carries, which are the only Topics a
   * request may be weighted on.
   *
   * It exists because a parent cannot choose from a list the screen has no way
   * to show, and it reads the **same** Extraction the job will later read — so
   * the label the screen offers, the label that is persisted and the label the
   * post-hoc pass counts are one string with one spelling.
   *
   * Behind the same guard as everything else here, and a foreign or unknown id
   * answers 404 rather than 403 (AD-18).
   */
  @Get('source-tests/:id/practice-tests/topics')
  topics(
    @Req() req: ElevatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<GenerationTopicsView> {
    return this.practiceTests.topicsFor(req.elevated!.parentAccountId, id);
  }

  /**
   * Where the newest generation job for this Source Test stands.
   *
   * Read from the server on every poll and on every return to the screen, which
   * is what makes leaving and coming back work at all: the progress a parent
   * sees is the job's own state, never something the browser was holding.
   */
  @Get('source-tests/:id/practice-tests/job')
  job(
    @Req() req: ElevatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<GenerationJobView> {
    return this.practiceTests.statusFor(req.elevated!.parentAccountId, id);
  }
}
