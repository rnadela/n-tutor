import { IsEnum } from 'class-validator';
import { ExplanationFlagDisposition } from '../../generated/prisma/enums.js';

/**
 * What a parent decided about the concern their child raised.
 *
 * One field and a closed set, validated here rather than in the service: a disposition
 * is two values and no third, and the validation pipe is where a third one dies — before
 * an ownership read, before a flag is found, and before any statement could write it.
 *
 * `@IsEnum` over the generated enum rather than an `@IsIn` over two literals, exactly as
 * `AssignTierDto` does it: the closed set is the schema's, and a hand-written list here
 * would be a second copy of it to keep in step.
 *
 * There is deliberately no `reason` field, no free text and no id of any kind. The ids
 * are the path's, and a column for a typed reason does not exist — a body field with no
 * writer is a promise the next reader believes.
 */
export class DisposeFlagDto {
  /** Anything outside the two dispositions is rejected before any write happens. */
  @IsEnum(ExplanationFlagDisposition)
  disposition!: ExplanationFlagDisposition;
}
