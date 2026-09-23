export const ADMIN_JWT_AUDIENCE = 'admin';
export const ADMIN_JWT_ISSUER = 'n-test-reviewer';

/**
 * One message for both "no such operator" and "wrong password", so sign-in
 * never reveals whether an operator account exists.
 */
export const ADMIN_SIGN_IN_FAILED = 'Sign-in failed. Check the email and password and try again.';

/**
 * An alias for `admin`'s own JwtService instance. Two modules register a
 * JwtModule on two different secrets, so a bare `JwtService` lookup is
 * ambiguous; this names the one that signs with `ADMIN_JWT_SECRET`.
 */
export const ADMIN_JWT = 'ADMIN_JWT';
