import { IsInt, Min } from 'class-validator';

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
}
