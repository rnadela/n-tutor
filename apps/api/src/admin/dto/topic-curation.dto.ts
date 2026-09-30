import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { MAX_TOPIC_LABEL_LENGTH } from '../../topics/topic-policy.js';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * The new name for one canonical Topic.
 *
 * Trimmed before it is measured, exactly as the taxonomy DTOs are, so a name of
 * spaces is a refusal rather than a stored blank.
 *
 * **Bounded by `MAX_TOPIC_LABEL_LENGTH` and not by the taxonomy's 80**, because a
 * Topic name is not a Subject name: it arrives as a model-written label, and that
 * constant is the bound every minted one is already held to. A tighter bound here
 * would make an existing Topic one this surface could not restate.
 *
 * **The constant itself and never a restated literal.** A decorator argument is an
 * ordinary expression evaluated at class-definition time, so the one bound
 * `boundedLabel` enforces is the one the wire check states — and cannot drift from it
 * to leave existing Topics unrenamable through the only surface that renames them.
 * `topics` still trims and bounds on the write; this is the wire check in front of it,
 * which is what makes an over-long name a 400 rather than a silent truncation.
 */
export class RenameTopicDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_TOPIC_LABEL_LENGTH)
  name!: string;
}

/**
 * Which Topic the one named in the path is being folded into.
 *
 * A uuid and nothing else. Whether it exists, whether it is the same Topic and
 * whether it belongs to the same Subject are all facts about rows, so they are
 * decided inside the merge's transaction rather than guessed at here.
 */
export class MergeTopicDto {
  @IsUUID()
  targetTopicId!: string;
}
