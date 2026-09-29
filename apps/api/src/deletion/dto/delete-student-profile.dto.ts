import { IsString, MaxLength } from 'class-validator';
import { PASSWORD_MAX_LENGTH } from '../../identity/auth-policy.js';

/**
 * The body of the delete: the account password, and nothing else.
 *
 * No profile id — the path carries it — and no account id: the account is taken
 * from the elevation the guard verified, never from the payload (AD-18).
 *
 * **Bounded, but not checked for emptiness.** The ceiling is the same one
 * sign-up and sign-in are bounded at, because argon2 is deliberately expensive
 * and a hash must never run against an unbounded body. An *empty* password is a
 * different matter: it is a wrong password, and the contract answers a wrong
 * password with one sentence and one status. Refusing it here as a validation
 * failure would answer the same mistake with a 400 and a different wording,
 * which is a second refusal for one thing — so it falls through to the
 * verifier, costs what a wrong password costs, and is refused as one.
 */
export class DeleteStudentProfileDto {
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}
