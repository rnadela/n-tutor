import { IsBoolean, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateTaxonomyItemDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;
}

export class RenameTaxonomyItemDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;
}

export class SetEnabledDto {
  @IsBoolean()
  enabled!: boolean;
}

export class SetAvailabilityDto {
  @IsUUID()
  subjectId!: string;

  @IsUUID()
  gradeLevelId!: string;

  @IsBoolean()
  enabled!: boolean;
}
