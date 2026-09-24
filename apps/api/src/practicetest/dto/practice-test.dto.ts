import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_TOPIC_LABEL_LENGTH } from '../practice-test-policy.js';
import { MAX_CHOICES, MAX_TEXT_LENGTH } from '../practice-test-payload.js';

/**
 * How many Practice Tests one request asks for.
 *
 * Shape only: a whole number of at least one. Deliberately **no upper bound
 * here** — a count above what the account can have is not a malformed request,
 * it is an overreach, and the product's answer to an overreach is to clamp it
 * silently and state the clamped figure back. A `@Max` would turn that into a
 * 400 and make the clamp unreachable, which is the one path the acceptance
 * criteria name explicitly.
 *
 * Whether the account can afford the count it asked for depends on rows, so it
 * is decided in the service inside the transaction that writes the job —
 * exactly as `ReorderPagesDto` leaves permutation-checking to the write path.
 */
export class RequestPracticeTestsDto {
  @IsInt()
  @Min(1)
  count!: number;

  /**
   * The one Topic to concentrate the drafts on, or absent for the even spread
   * Story 4.1 produces. Absent is the default and is exactly today's behaviour.
   *
   * Shape only, for the same reason `count` is: a non-empty string no longer
   * than any label an Extraction could hold. **Whether the Extraction carries
   * it is a row-dependent rule**, so the service resolves it against the
   * Extraction inside `request()` and answers 409 for one it does not carry —
   * a 400 here would be this file claiming to know what is on a parent's page.
   */
  @IsOptional()
  @IsString()
  // Trimmed **before** the length and emptiness rules rather than after, so
  // both judge the label itself. Padding is not content: a genuine label of
  // exactly `MAX_TOPIC_LABEL_LENGTH` characters that arrived with a leading
  // space would otherwise be a 400 for being one character too long, and a
  // value that is nothing but whitespace would pass the shape check and come
  // back as "that topic is not one this upload covers" — a sentence that
  // describes the wrong problem.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty()
  @MaxLength(MAX_TOPIC_LABEL_LENGTH)
  weightedTopic?: string;
}

/**
 * One option of a Multiple Choice question as an edit restates it.
 *
 * `ordinal` names which stored option this is — never an index into whatever
 * order the browser happened to render — and `body` is the plain text a parent
 * typed. It is text on the wire and structure in the column: the server owns
 * the one conversion (AD-32), so no browser ever decides what a fraction is.
 */
export class EditDraftChoiceDto {
  @IsInt()
  @Min(1)
  ordinal!: number;

  @IsString()
  @MaxLength(MAX_TEXT_LENGTH)
  body!: string;
}

/**
 * A parent's edit of one draft Question: its prompt, its free-text answer, its
 * option bodies and which option is correct.
 *
 * Shape and ceilings only. **Every row-dependent rule stays in the service** —
 * whether this question is Multiple Choice, whether the ordinals named are the
 * ones stored, whether the result leaves exactly one correct option — exactly
 * as `RequestPracticeTestsDto` leaves affordability to the write path. A rule
 * stated here would be this file claiming to know what is in a row it has not
 * read, and would have to be restated in the service anyway.
 *
 * `format` is absent on purpose and is not editable: changing it would change
 * which invariants the Question must satisfy, and a Multiple Choice question
 * that became a Short Answer one would leave its options behind as rows nothing
 * owns. Topics are absent for the same reason they are stored raw — Epic 7
 * (AD-11).
 */
export class EditDraftQuestionDto {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TEXT_LENGTH)
  prompt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_TEXT_LENGTH)
  answer?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CHOICES)
  @ValidateNested({ each: true })
  @Type(() => EditDraftChoiceDto)
  choices?: EditDraftChoiceDto[];

  /** Which option the edit leaves correct, by its stored ordinal. */
  @IsOptional()
  @IsInt()
  @Min(1)
  correctOrdinal?: number;
}
