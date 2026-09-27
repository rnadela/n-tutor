import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  MAX_ANSWERS_PER_SUBMISSION,
  MAX_ANSWER_LENGTH,
  MAX_QUESTION_ID_LENGTH,
} from '../practice-test-policy.js';

/**
 * One answer as the child's browser restates it: which Question, and exactly
 * what they typed or chose.
 *
 * `questionId` is a string and nothing stronger. **No `@IsUUID`, deliberately**,
 * for the reason the student detail route carries no `ParseUUIDPipe`: a 400 on
 * shape would be a second kind of refusal on a surface whose whole discipline is
 * one sentence, and an id that names no Question on this Practice Test is
 * already ignored by the write path. A malformed id simply matches nothing.
 *
 * Its length ceiling is **its own** — `MAX_QUESTION_ID_LENGTH`, not the answer's.
 * Bounding an id by the figure written for Short Answer prose is two uses of one
 * constant that disagree the first time either is tuned.
 *
 * `value` is raw text and stays raw: no fraction is parsed, normalized or judged
 * here or anywhere downstream in this story. A blank is allowed through the
 * shape check and dropped by the service, so a browser that sends an emptied
 * field is not a 400 — it is a Question the child left blank.
 */
export class SubmitAnswerDto {
  @IsString()
  @MaxLength(MAX_QUESTION_ID_LENGTH)
  questionId!: string;

  @IsString()
  @MaxLength(MAX_ANSWER_LENGTH)
  value!: string;
}

/**
 * The body of a hand-in: every answer the child holds, in one request.
 *
 * **This is the only student-authored input the API accepts anywhere**, so its
 * bounds are stated rather than assumed. Shape and ceilings only, exactly as
 * `RequestPracticeTestsDto` and `EditDraftQuestionDto` are: how many answers,
 * and how long each may be. Every row-dependent rule — which Questions are on
 * this Practice Test, whether this Attempt is open, whether the deadline has
 * passed — stays in the service, inside the transaction that writes.
 *
 * The array bound is the real maximum number of Questions a Practice Test can hold,
 * and `MAX_JSON_BODY_BYTES` is computed from these two ceilings so that the largest
 * body this DTO accepts is a body the transport accepts too. A submission the
 * transport refuses is a 413 the screen can only read as a generic failure — and a
 * child re-pressing Hand in forever on work that will never be taken.
 *
 * `@IsDefined()` on the array is what keeps a body that said nothing from
 * reading as "hand in a blank paper by accident": an absent `answers` is a
 * malformed request, while `[]` is a legitimate one — a child may hand in with
 * nothing filled, and Story 5.4 owns whether they are asked about it first.
 */
export class SubmitAttemptDto {
  @IsDefined()
  @IsArray()
  @ArrayMaxSize(MAX_ANSWERS_PER_SUBMISSION)
  @ValidateNested({ each: true })
  @Type(() => SubmitAnswerDto)
  answers!: SubmitAnswerDto[];
}
