import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ParentElevationGuard, type ElevatedRequest } from '../identity/parent-elevation.guard.js';
import { EditDraftQuestionDto, RequestPracticeTestsDto } from './dto/practice-test.dto.js';
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
 * Since Story 4.4 the module also **writes** what a parent reviewed: one
 * Question edited, one Question deleted. A gate that could only be looked
 * through was not a gate, so the two mutations below are what make a bad
 * generated Question something a parent can do anything about — and they are
 * still the gate precisely because of the released-state write barrier they
 * carry. Both are scoped to `Draft` in the statement that reads or mutates, so
 * a `Released` or `Discarded` Practice Test refuses them with the same 404 an
 * unknown id gets, whatever any UI offered. A timer changed or a Question
 * rewritten after release would retroactively change how past Attempts were
 * graded, which is why the refusal is the API's and not a screen's.
 *
 * Since Story 4.5 the gate also **opens**. Release makes a draft visible to the
 * child it was made for; discard removes it from everywhere a child or a
 * downstream reader can see. Both are `Draft`-only in the statement that
 * mutates, which is what makes release irreversible: a second release matches no
 * row and answers the identical 404 an unknown id gets, so irreversibility is a
 * property of the statement rather than a promise beside it. There is
 * deliberately no `ALREADY_RELEASED` and no 409 — a second sentence for one rule
 * would let anything outside enumerate which of another account's ids exist by
 * reading which refusal came back. Neither transition touches `chargedAt`
 * (AD-14), and neither is reachable without a parent's confirmation, which the
 * screen states in words *before* it fires.
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
   * id answers that identical 404 too. A released Practice Test is read from the
   * student surface, as a summary with no content on it; there is no parent read
   * of one, and no path from either terminal state back to `Draft`.
   */
  @Get('practice-tests/:id')
  draft(
    @Req() req: ElevatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PracticeTestDraftView> {
    return this.practiceTests.draftFor(req.elevated!.parentAccountId, id);
  }

  /**
   * Rewrites one Question of a draft, and answers with the whole draft as it
   * now stands.
   *
   * The whole view rather than the one Question, so the screen re-renders from
   * the server's own account of what is stored rather than from what it hoped
   * it had just written — the same reason the progress read returns the job
   * rather than an acknowledgement.
   *
   * Both ids go through `ParseUUIDPipe`, so a malformed one is refused on shape
   * before a row is read; the pair must then match, and the Practice Test must
   * be this account's own `Draft`, or it is the one 404 (AD-18).
   */
  @Patch('practice-tests/:id/questions/:questionId')
  editQuestion(
    @Req() req: ElevatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('questionId', ParseUUIDPipe) questionId: string,
    @Body() dto: EditDraftQuestionDto,
  ): Promise<PracticeTestDraftView> {
    return this.practiceTests.editQuestion(req.elevated!.parentAccountId, id, questionId, dto);
  }

  /**
   * Deletes one Question of a draft, and answers with the draft as it now
   * stands — renumbered, and with its stored count rewritten.
   *
   * Deleting the **last** Question discards the Practice Test. That answer
   * carries `status: 'Discarded'` and no questions rather than a refusal — the
   * screen reads the status and goes back to Pending drafts — while a *later*
   * read of the same id gets the ordinary 404, because it is no longer a draft.
   * The confirmation said in words that this would happen and that the spent
   * Generation Allowance is not refunded (AD-14); nothing here refunds it.
   */
  @Delete('practice-tests/:id/questions/:questionId')
  deleteQuestion(
    @Req() req: ElevatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('questionId', ParseUUIDPipe) questionId: string,
  ): Promise<PracticeTestDraftView> {
    return this.practiceTests.deleteQuestion(req.elevated!.parentAccountId, id, questionId);
  }

  /**
   * Releases the draft: the child it was made for can see it from this moment,
   * and it can no longer be changed.
   *
   * **One-way.** A second call on the same id answers 404 with the module's one
   * sentence, identical to the one an unknown id gets, because `Draft` is in the
   * `where` of the statement that mutates. That identical refusal *is* the
   * irreversibility — there is no route, flag or parameter here that returns a
   * `Released` row to `Draft`, and after this call the draft read and both 4.4
   * mutations refuse the id too.
   *
   * 200 with the full view rather than a bare 204: the screen reads the new
   * `status` rather than inferring success from an empty answer. `chargedAt` is
   * untouched and no allowance figure is written (AD-14).
   */
  @Post('practice-tests/:id/release')
  // 200, not 201: nothing is created. A transition answers with the row as it now
  // stands, which is the same thing the read and both 4.4 mutations answer with.
  @HttpCode(HttpStatus.OK)
  release(
    @Req() req: ElevatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PracticeTestDraftView> {
    return this.practiceTests.release(req.elevated!.parentAccountId, id);
  }

  /**
   * Discards the draft: the child never sees it, and no downstream reader can
   * reach it.
   *
   * Scoped to `Draft` exactly as release is, so a `Released` id is refused with
   * that same 404 — release is terminal. Nothing is refunded (AD-14); the
   * confirmation said so in words before this was called.
   */
  @Post('practice-tests/:id/discard')
  // 200, not 201: nothing is created. A transition answers with the row as it now
  // stands, which is the same thing the read and both 4.4 mutations answer with.
  @HttpCode(HttpStatus.OK)
  discard(
    @Req() req: ElevatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PracticeTestDraftView> {
    return this.practiceTests.discard(req.elevated!.parentAccountId, id);
  }
}
