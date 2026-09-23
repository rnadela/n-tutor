'use client';

import TextField from '@mui/material/TextField';
import { adminCopy } from '@/copy/admin';
import { ACCOUNT_TIERS, type AccountTier, type ParentAccountSummary } from '@/lib/admin-api';
import { density } from '@/theme/tokens';

export interface TierSelectProps {
  account: ParentAccountSummary;
  disabled: boolean;
  /** Resolves `true` only when the assignment succeeded. */
  onAssign: (tier: AccountTier) => Promise<boolean>;
}

/**
 * The only control that changes an Account Tier — and Internal is reachable
 * only from here. A **native** `<select>`, so it is a real focusable element in
 * the tab order, carries the platform's own keyboard behaviour, and takes an
 * accessible name naming the account (the column header alone cannot tell rows
 * apart for a screen reader).
 */
export function TierSelect({ account, disabled, onAssign }: TierSelectProps) {
  return (
    <TextField
      select
      size="small"
      slotProps={{
        select: { native: true },
        // The column header reads "Account Tier"; the per-row accessible name
        // has to name the account, or a screen reader cannot tell rows apart.
        htmlInput: { 'aria-label': adminCopy.tierSelectLabel(account.email) },
      }}
      value={account.tier}
      disabled={disabled}
      onChange={(event) => {
        void onAssign(event.target.value as AccountTier);
      }}
      sx={{
        minWidth: 140,
        '& .MuiInputBase-root': { minHeight: density.tapTarget },
        '& select': { minHeight: density.tapTarget, display: 'flex', alignItems: 'center' },
      }}
    >
      {ACCOUNT_TIERS.map((tier) => (
        <option key={tier} value={tier}>
          {adminCopy.accounts.tiers[tier]}
        </option>
      ))}
    </TextField>
  );
}
