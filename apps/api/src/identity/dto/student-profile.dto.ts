import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidationArguments,
  registerDecorator,
} from 'class-validator';
import {
  DISPLAY_NAME_MAX_LENGTH,
  NAME_SHAPE,
  NOTHING_TO_CHANGE,
  normaliseDisplayName,
} from '../student-profile-policy.js';

/**
 * Normalised at the edge with the same rule the service stores by, so the
 * length bound is applied to the string that would actually be written — a name
 * of nothing but spaces is empty here, not sixty characters long.
 */
const normalise = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? normaliseDisplayName(value) : value;

/** `changes` is a carrier, not a field: a payload that names it is malformed. */
export const CHANGES_IS_NOT_A_FIELD = 'property changes should not exist';

/**
 * At least one field present.
 *
 * It cannot hang off `displayName` or `gradeLevelId` the way `ChangePinDto`'s
 * rule hangs off `newPin`: both are `@IsOptional()`, and `IsOptional` skips
 * every validator on a property that is absent — which is precisely the case
 * this rule exists to catch. So it hangs off a property of its own, which no
 * payload carries and nothing reads; its only job is to be validated always.
 *
 * Carrying validation metadata is also what puts `changes` on the whitelist, so
 * `forbidNonWhitelisted` would no longer refuse a body that names it. This
 * validator refuses it instead, with the message that pipe would have used.
 */
function AtLeastOneChange() {
  return function (target: object, propertyName: string): void {
    registerDecorator({
      name: 'atLeastOneChange',
      target: target.constructor,
      propertyName,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          if (value !== undefined) return false;
          const dto = args.object as UpdateStudentProfileDto;
          return dto.displayName !== undefined || dto.gradeLevelId !== undefined;
        },
        defaultMessage(args: ValidationArguments): string {
          return args.value !== undefined ? CHANGES_IS_NOT_A_FIELD : NOTHING_TO_CHANGE;
        },
      },
    });
  };
}

export class CreateStudentProfileDto {
  @Transform(normalise)
  @IsString({ message: NAME_SHAPE })
  @MinLength(1, { message: NAME_SHAPE })
  @MaxLength(DISPLAY_NAME_MAX_LENGTH, { message: NAME_SHAPE })
  displayName!: string;

  /** Exactly one Grade Level, always. It may never be absent and never null. */
  @IsUUID()
  gradeLevelId!: string;
}

export class UpdateStudentProfileDto {
  @Transform(normalise)
  @IsOptional()
  @IsString({ message: NAME_SHAPE })
  @MinLength(1, { message: NAME_SHAPE })
  @MaxLength(DISPLAY_NAME_MAX_LENGTH, { message: NAME_SHAPE })
  displayName?: string;

  @IsOptional()
  @IsUUID()
  gradeLevelId?: string;

  /** Never sent, never read: the carrier for the cross-field rule above. */
  @AtLeastOneChange()
  readonly changes?: never;
}
