import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  registerDecorator,
} from 'class-validator';
import { UncommittedStateKind } from '../../generated/prisma/enums.js';
import {
  PAYLOAD_NOT_AN_OBJECT,
  SCOPE_MAX_LENGTH,
  isWithinPayloadLimit,
  payloadTooLarge,
} from '../uncommitted-state-policy.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * The size rule, stated once against the policy and never against a literal.
 *
 * It quotes the limit and nothing about the content (AD-20): a message that
 * echoed the payload back would put a child's half-written answer into a log
 * line the whole of this mechanism exists to keep it out of.
 */
function WithinPayloadLimit() {
  return function (target: object, propertyName: string): void {
    registerDecorator({
      name: 'withinPayloadLimit',
      target: target.constructor,
      propertyName,
      validator: {
        validate(value: unknown): boolean {
          // Anything that is not an object at all is `@IsObject`'s rejection to
          // make; reporting it as oversized would name the wrong fault.
          if (typeof value !== 'object' || value === null) return true;
          return isWithinPayloadLimit(value);
        },
        defaultMessage(): string {
          return payloadTooLarge();
        },
      },
    });
  };
}

export class SaveUncommittedStateDto {
  /** The profile this work was done under. Keyed to it, never inferred (AD-33). */
  @IsUUID()
  studentProfileId!: string;

  /**
   * A declared list, not a free string: the extension point later epics add a
   * value to. An unknown kind is a 400 from validation.
   */
  @IsEnum(UncommittedStateKind)
  kind!: UncommittedStateKind;

  /**
   * Opaque, and defaulted rather than nullable so the slot's unique index stays
   * total — SQL does not compare NULLs, so a nullable column would let two rows
   * silently occupy one slot.
   */
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(SCOPE_MAX_LENGTH)
  scope?: string = '';

  /**
   * Opaque JSON. It carries no bytes: Page Images are `PageImage` rows under
   * AD-15, referenced by id when Epic 3 lands.
   */
  @IsObject({ message: PAYLOAD_NOT_AN_OBJECT })
  @WithinPayloadLimit()
  payload!: object;
}

/** The `GET`'s query: which profile's retained work is being asked for. */
export class UncommittedStateQueryDto {
  @IsUUID()
  studentProfileId!: string;
}
