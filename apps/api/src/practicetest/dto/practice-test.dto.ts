import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { MAX_TOPIC_LABEL_LENGTH } from '../practice-test-policy.js';

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
