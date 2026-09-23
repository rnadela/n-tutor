import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../auth-policy.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class SignUpDto {
  @Transform(trim)
  @IsEmail()
  @MaxLength(320)
  email!: string;

  // The bounds are the policy's, read from the one place that states them.
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;

  /** The device's IANA zone; an unrecognised one is rejected by name. */
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  timezone!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  termsVersion!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  noticeVersion!: string;
}
