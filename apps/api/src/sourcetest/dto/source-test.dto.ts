import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsUUID } from 'class-validator';
import {
  GRADE_LEVEL_ID_INVALID,
  MAX_PAGES,
  PAGE_ORDER_MISMATCH,
  SUBJECT_ID_INVALID,
} from '../source-test-policy.js';

/** Which child the draft is opened under. The account is never in a body. */
export class OpenSourceTestDto {
  @IsUUID()
  studentProfileId!: string;
}

/**
 * The explicit permutation reorder takes.
 *
 * Shape only: that the array is uuids, non-empty, and no longer than a Source
 * Test can hold. Whether it is a *permutation of these pages* is not a shape
 * question — it depends on rows — so it is checked by `reorderedOrThrow` in the
 * same transaction that would apply it, and answers the same message this
 * validator does.
 */
export class ReorderPagesDto {
  @IsArray({ message: PAGE_ORDER_MISMATCH })
  @ArrayMinSize(1, { message: PAGE_ORDER_MISMATCH })
  @ArrayMaxSize(MAX_PAGES, { message: PAGE_ORDER_MISMATCH })
  @IsUUID('4', { each: true, message: PAGE_ORDER_MISMATCH })
  pageIds!: string[];
}

/**
 * The classification patch. Either field alone, or both together.
 *
 * Shape only: that each value present is a uuid. Whether the *resulting* pair
 * is available depends on rows — the Subject's enablement, the Grade Level's,
 * and the join row's — so that is checked in the service beside the write,
 * exactly as `ReorderPagesDto` leaves permutation-checking to
 * `reorderedOrThrow`. An empty body is refused there too, with
 * `NOTHING_TO_CLASSIFY`: "neither field was sent" is a statement about the
 * patch as a whole and not about either property.
 */
export class ClassifySourceTestDto {
  @IsOptional()
  @IsUUID('4', { message: SUBJECT_ID_INVALID })
  subjectId?: string;

  @IsOptional()
  @IsUUID('4', { message: GRADE_LEVEL_ID_INVALID })
  gradeLevelId?: string;
}
