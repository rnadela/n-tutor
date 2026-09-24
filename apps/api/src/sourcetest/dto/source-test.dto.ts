import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';
import { MAX_PAGES, PAGE_ORDER_MISMATCH } from '../source-test-policy.js';

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
