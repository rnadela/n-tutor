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
import { DisposeFlagDto } from './dto/dispose-flag.dto.js';
import type { ParentExplanationView } from './explanation-flag.js';
import { ExplanationService } from './explanation.service.js';

/**
 * The parent's Explanation routes: read what this Attempt's Explanations say, record
 * that one of them is bad, and decide about a concern the child raised.
 *
 * **A `GET` that writes nothing.** The student route beside it is a `POST` because
 * its first call bills a provider; this one is a read and stays one. Opening a
 * parent's Attempt detail generates nothing, consumes no Explanation Allowance and
 * touches no `chargedAt` — an Explanation the child never asked for does not exist
 * here, and a parent who opened a whole Attempt would otherwise be billed for every
 * Question on it.
 *
 * **The flag is a `POST` that answers 200, not 201.** The second press is not a
 * second flag and not a conflict: it is the same concern, made the same row by the
 * unique key `[explanationId, origin]`. So there is nothing for a created-status to
 * be honest about, and the response is the state — the Explanation and the instant a
 * parent first flagged it — rather than a receipt for this particular press.
 *
 * The account comes off `req.elevated` and never from the path or the body (AD-18),
 * and there is **no profile id anywhere in either path**: which child sat the
 * Attempt is resolved server-side from the Attempt row, so a profile id cannot be
 * paired with another child's Attempt because there is nowhere to put one. A foreign
 * Attempt, an unknown id, one still open and a Question with no stored Explanation
 * all answer the one shared `PRACTICE_TEST_NOT_FOUND` 404 — never a 403, and never
 * four sentences.
 *
 * **`ParseUUIDPipe` on both ids**, as every other parent route carries: a malformed
 * id on a parent surface is a fault in the caller and a 400 says so. The student
 * routes deliberately omit it, because a child's surface answers every refusal with
 * one sentence.
 *
 * **Since Story 6.4 there are two more writes: suppression and regeneration.** Neither
 * takes a body — there is no reason field, no scope option and no "also confirm the flag"
 * — and both answer **every** generation of that Question, so the screen can draw the
 * removed explanation beside its replacement from the write it made. The status split says
 * what each did: suppression is 200 because a repeat is the same decision, regeneration is
 * 201 because it billed a provider call.
 *
 * No response here carries a cost, a tier, a model name, an allowance figure or a grading
 * rationale (AD-20, AD-26). The rationale is Story 6.5's and `ParentExplanationView` has
 * nowhere for one to sit — and that holds for the free regeneration too: the row is free,
 * and the response says nothing about what anything cost.
 */
@Controller('parent')
@SkipThrottle({ login: true })
@UseGuards(ParentElevationGuard)
export class ParentExplanationController {
  constructor(private readonly explanations: ExplanationService) {}

  /**
   * Every Explanation stored for this Attempt — one entry per stored row, and
   * nothing for a Question the child never asked about.
   *
   * An Attempt whose Questions were all worked through unasked answers `[]`, which
   * is a state the screen renders and never a refusal: having asked for nothing is
   * not a fault.
   */
  @Get('attempts/:attemptId/explanations')
  attemptExplanations(
    @Req() req: ElevatedRequest,
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
  ): Promise<ParentExplanationView[]> {
    return this.explanations.explanationsForAttempt(
      { parentAccountId: req.elevated!.parentAccountId },
      attemptId,
    );
  }

  /**
   * Records a parent's concern about one Explanation, and answers with the state.
   *
   * 200 on the first press and on every later one, with the same
   * `parentFlaggedAt` each time: the instant the concern was **first** recorded.
   */
  @Post('attempts/:attemptId/questions/:questionId/explanation-flag')
  @HttpCode(HttpStatus.OK)
  flag(
    @Req() req: ElevatedRequest,
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @Param('questionId', ParseUUIDPipe) questionId: string,
  ): Promise<ParentExplanationView> {
    return this.explanations.flagExplanation(
      { parentAccountId: req.elevated!.parentAccountId },
      attemptId,
      questionId,
    );
  }

  /**
   * Records what the parent decided about the concern **their child** raised.
   *
   * 200 on the first decision and on a repeat of the same one, each time with the
   * instant the decision was first recorded: a double-tap is one decision. A *different*
   * decision answers 409 with the one `FLAG_ALREADY_DISPOSED` sentence and rewrites
   * nothing — the first decision stands, because reversal is not in FR-38 and a
   * reversible confirm would mean an Explanation entering and leaving an operator's
   * queue underneath them.
   *
   * **There is no un-flag, no undo and no toggle here**, and no route that could become
   * one: the only body field is a member of a closed two-value enum, which the validation
   * pipe checks before anything is read.
   *
   * A Question with no Explanation, one whose Explanation the child never reported, a
   * foreign Attempt, an unknown id and one still open all answer the one shared 404. A
   * parent's *own* flag has no disposition and needs none, so an Explanation carrying
   * only that answers the same 404 as well.
   *
   * **Confirming does not suppress.** The child is served exactly the same prose
   * afterwards; what confirming does is put the Explanation in front of an operator, and
   * the screen says so in words.
   */
  @Post('attempts/:attemptId/questions/:questionId/explanation-flag/disposition')
  @HttpCode(HttpStatus.OK)
  disposeFlag(
    @Req() req: ElevatedRequest,
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @Param('questionId', ParseUUIDPipe) questionId: string,
    @Body() dto: DisposeFlagDto,
  ): Promise<ParentExplanationView> {
    return this.explanations.disposeStudentFlag(
      { parentAccountId: req.elevated!.parentAccountId },
      attemptId,
      questionId,
      dto.disposition,
    );
  }

  /**
   * Stops this Explanation being served to the child it was written for, for good.
   *
   * **200 and never 201**, because a repeat is the same decision and not a second one: the
   * write is `updateMany({ where: { id, suppressedAt: null } })`, so a double-tap answers
   * 200 with the **first** instant exactly as a repeat flag press answers the first flag's.
   * There is no sentence for a repeat and no 409 for one — a parent pressing twice made one
   * decision, and telling them they already did it would be a refusal for nothing.
   *
   * **No body, and no field for one.** There is no reason to record, no scope to choose and
   * no "also confirm the flag" to bundle in: each route does one thing, and a body field
   * with no column behind it is a promise the next reader believes.
   *
   * **It is refused until a concern is recorded.** A 409 `SUPPRESSION_NEEDS_A_FLAG` for a
   * Question with no flag, one whose only report is awaiting a decision, and one the parent
   * dismissed — the same predicate `canSuppress` is computed from, so this refusal is what
   * a stale tab gets and not a dead end the screen offers. A Question with no Explanation,
   * a foreign Attempt, an unknown id and one still open all answer the one shared 404.
   *
   * **There is no un-suppress route here and there will not be one.** Suppression is not
   * reversible, the confirmation says so in words before it fires, and the API has no
   * column to clear.
   *
   * It answers **every** generation of that Question, oldest first, so the screen can draw
   * the removed explanation beside its replacement from the write it made.
   */
  @Post('attempts/:attemptId/questions/:questionId/explanation-suppression')
  @HttpCode(HttpStatus.OK)
  suppress(
    @Req() req: ElevatedRequest,
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @Param('questionId', ParseUUIDPipe) questionId: string,
  ): Promise<ParentExplanationView[]> {
    return this.explanations.suppressExplanation(
      { parentAccountId: req.elevated!.parentAccountId },
      attemptId,
      questionId,
    );
  }

  /**
   * Writes a replacement for an Explanation this parent removed, charging nothing.
   *
   * **201, because it billed a provider call** — even though it charged no Explanation
   * Allowance. The status is about what happened, and what happened is that a new
   * Explanation was written; the row's `chargedAt: null` is what makes it free, and the
   * allowance counter excludes it by column. **No allowance is read on this path at all**,
   * which is why a Free account already at its cap cannot be refused one.
   *
   * **No body here either**, for the same reason the route above has none: there is nothing
   * to configure about a replacement, and a field with no column behind it is a promise.
   *
   * **Only over a suppressed one.** A live Explanation answers 409 `NOTHING_TO_REGENERATE`
   * and nothing is written: the child is still being served that one, so there is nothing to
   * replace — and an allowance-free write with no precondition would be a free provider call
   * anybody could press in a loop. A provider fault is the module's one 503.
   *
   * The suppressed Explanation is retained, stays readable here and stays in front of an
   * operator. The replacement is a further generation, so it can itself be reported,
   * decided about and removed on the same terms with no ceiling.
   */
  @Post('attempts/:attemptId/questions/:questionId/explanation-regeneration')
  regenerate(
    @Req() req: ElevatedRequest,
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @Param('questionId', ParseUUIDPipe) questionId: string,
  ): Promise<ParentExplanationView[]> {
    return this.explanations.regenerateExplanation(
      { parentAccountId: req.elevated!.parentAccountId },
      attemptId,
      questionId,
    );
  }
}
