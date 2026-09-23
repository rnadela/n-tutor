import { SetMetadata, type CustomDecorator } from '@nestjs/common';

export const PARENT_CREDENTIAL_ROUTE = 'parent-credential-route';

/**
 * Marks a handler as spending the parent credential budget.
 *
 * The `parent` throttler skips every route that is not marked, which is what
 * keeps the two surfaces' budgets separate: an admin login flood cannot
 * exhaust a parent's allowance and vice versa. Metadata rather than a name
 * check so the rule is stated on the handler it governs.
 */
export function ParentCredentialRoute(): CustomDecorator<string> {
  return SetMetadata(PARENT_CREDENTIAL_ROUTE, true);
}
