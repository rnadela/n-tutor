import { IsIn } from 'class-validator';
import type { GradeState } from '../../generated/prisma/enums.js';
import { OVERRIDABLE_STATES } from '../grading-override.js';

/**
 * What a parent says one Question is worth.
 *
 * One field and a closed set of **two**, validated here rather than in the service, for
 * the reason `DisposeFlagDto` validates a disposition here: the set is two values and no
 * third, and the validation pipe is where a third one dies — before an ownership read,
 * before a grade row is found, and before any statement could write it.
 *
 * **`@IsIn(OVERRIDABLE_STATES)` and not `@IsEnum(GradeState)`**, which is the one place
 * this departs from `DisposeFlagDto`'s shape. `GradeState` has four members and an
 * override may only ever be two of them: `Unanswered` is the one state only the hand-in
 * itself can know, and `Ungraded` means nothing has judged this yet. An `@IsEnum` would
 * accept both and leave the refusal to the service, where it would be a 409 about a body
 * that was never legal — and the constant is `grading-override.ts`'s own, read here rather
 * than restated, so the shape a parent may send and the rule the service applies cannot
 * come apart.
 *
 * There is deliberately no `reason` field, no free text and no id of any kind. The ids are
 * the path's, and a column for a typed reason does not exist — a body field with no writer
 * is a promise the next reader believes.
 */
export class GradeOverrideDto {
  /** `Correct` or `Incorrect`. Anything else is rejected before any write happens. */
  @IsIn(OVERRIDABLE_STATES as GradeState[])
  state!: GradeState;
}
