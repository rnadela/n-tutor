import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidationArguments,
  registerDecorator,
} from 'class-validator';
import { PASSWORD_MAX_LENGTH } from '../auth-policy.js';
import { PIN_LENGTH, PIN_PATTERN } from '../pin-policy.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

const PIN_SHAPE = `The PIN must be exactly ${PIN_LENGTH} digits.`;

/** The longest string an entered PIN may be before it stops being one at all. */
const PIN_INPUT_MAX = 64;

/**
 * Exactly one of `currentPin` and `password`. Declared on `newPin` rather than
 * as a virtual property, because `whitelist: true` strips anything that is not
 * a real field off the payload before validation could see it.
 */
function ExactlyOneCredential() {
  return function (target: object, propertyName: string): void {
    registerDecorator({
      name: 'exactlyOneCredential',
      target: target.constructor,
      propertyName,
      validator: {
        validate(_value: unknown, args: ValidationArguments): boolean {
          const dto = args.object as ChangePinDto;
          const given = [dto.currentPin, dto.password].filter(
            (value) => typeof value === 'string' && value.length > 0,
          );
          return given.length === 1;
        },
        defaultMessage(): string {
          return 'Give either the current PIN or the account password, not both.';
        },
      },
    });
  };
}

export class SetPinDto {
  @Transform(trim)
  @IsString()
  @Matches(PIN_PATTERN, { message: PIN_SHAPE })
  pin!: string;
}

/**
 * No shape check here on purpose: a mistyped length must fail as a wrong PIN —
 * one generic message, one spent attempt — not as a validation error that
 * describes the secret's shape to whoever is guessing at it.
 */
export class VerifyPinDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(PIN_INPUT_MAX)
  pin!: string;
}

export class ChangePinDto {
  @Transform(trim)
  @IsString()
  @Matches(PIN_PATTERN, { message: PIN_SHAPE })
  @ExactlyOneCredential()
  newPin!: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(PIN_INPUT_MAX)
  currentPin?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password?: string;
}
