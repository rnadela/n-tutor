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
  type PracticeTestDraftSummary,
  type PracticeTestDraftView,
} from './practice-test.service.js';

/**
 * The generate step's four routes — what is left to spend, the Topics a request
 * may be weighted on, the request itself, and where the job stands — and draft
 * review's two: the drafts this account is holding, and one of them whole.
 *
 * Until Story 4.3 there was deliberately no route here that returned a
 * generated Question: an endpoint serving content before there was a screen to
 * review it on would have been the first half of shipping generation without
 * the human quality gate the epic exists for. The two reads below are the
 * *other* half — they exist because the gate is being built, and they are
 * parent-only, elevation-guarded and `Draft`-scoped precisely so that building
 * it cannot amount to bypassing it. Nothing student-scoped reaches them.
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

  /**
   * Every draft this account is still holding — Pending drafts' whole answer.
   *
   * Declared **above** `practice-tests/:id` on purpose: Nest matches in
   * declaration order, and the other way round `drafts` would be handed to
   * `ParseUUIDPipe` as an id and refused with a 400 that describes nothing a
   * parent did.
   *
   * An account with no drafts reads an empty list, never a 404: having nothing
   * yet is a state the screen renders, not a refusal.
   */
  @Get('practice-tests/drafts')
  drafts(@Req() req: ElevatedRequest): Promise<PracticeTestDraftSummary[]> {
    return this.practiceTests.draftsFor(req.elevated!.parentAccountId);
  }

  /**
   * One draft, whole: every Question in stored order with its correct answer,
   * its options and its Topics.
   *
   * The id is the review position. A parent who reloads, returns to the URL
   * days later, or is put back through the PIN by an idle expiry resumes on the
   * same draft, because the address bar is the only thing holding where they
   * were — no stored slot, no restore path.
   *
   * Same guard and same account as everything else here, and the same
   * 404-not-403 rule (AD-18) — with one addition: a `Released` or `Discarded`
   * id answers that identical 404 too. Those are Story 4.5's states, and this
   * story does not own a surface for them.
   */
  @Get('practice-tests/:id')
  draft(
    @Req() req: ElevatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PracticeTestDraftView> {
    return this.practiceTests.draftFor(req.elevated!.parentAccountId, id);
  }
}
