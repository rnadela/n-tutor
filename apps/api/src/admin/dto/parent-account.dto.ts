import { IsEnum } from 'class-validator';
import { AccountTier } from '../../generated/prisma/enums.js';

export class AssignTierDto {
  /** Anything outside the tier enum is rejected before any write happens. */
  @IsEnum(AccountTier)
  tier!: AccountTier;
}
