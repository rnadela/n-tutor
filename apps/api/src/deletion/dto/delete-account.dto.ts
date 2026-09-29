import { IsString, MaxLength } from 'class-validator';
import { PASSWORD_MAX_LENGTH } from '../../identity/auth-policy.js';

/**
 * The body of the account delete: the account password, and nothing else.
 *
 * No account id — the account is taken from the elevation the guard verified,
 * never from the payload (AD-18) — and no confirmation phrase: the gate is
 * re-authentication, and a typed word beside it would be a second gate that
 * proves nothing about who is holding the device.
 *
 * **Bounded, but not checked for emptiness**, exactly as the sibling DTO is
 * bounded and for the same two reasons: argon2 is deliberately expensive and must
 * never run against an unbounded body, and an *empty* password is simply a wrong
 * password — answered by the one sentence and the one status the contract gives a
 * wrong password. Refusing it here as a validation failure would answer the same
 * mistake with a 400 and a different wording, which is two refusals for one thing.
 */
export class DeleteAccountDto {
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}
