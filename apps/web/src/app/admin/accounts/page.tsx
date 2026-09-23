'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { adminCopy } from '@/copy/admin';
import {
  AdminApiError,
  adminApi,
  clearToken,
  readToken,
  type AccountConsumption,
  type AccountTier,
  type ParentAccountSummary,
} from '@/lib/admin-api';
import { density } from '@/theme/tokens';
import { ParentAccountTable } from '../_components/ParentAccountTable';

export default function ParentAccountsPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<ParentAccountSummary[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [consumption, setConsumption] = useState<AccountConsumption | null>(null);
  const [consumptionLoading, setConsumptionLoading] = useState(false);
  const [consumptionError, setConsumptionError] = useState<string | null>(null);
  /**
   * The account the consumption slot currently belongs to. `consumption` is one
   * shared slot, so without this a slow response for a row that has since been
   * collapsed (or replaced by another row) would render under the wrong
   * account. Every response checks this before it is allowed to land.
   */
  const expectedConsumptionId = useRef<string | null>(null);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const [announcement, setAnnouncement] = useState('');
  const [error, setError] = useState<string | null>(null);

  const toLogin = useCallback(() => {
    // Clear first, so the login screen's already-signed-in check cannot bounce
    // straight back here on a token the server has already rejected.
    clearToken();
    router.replace('/admin/login');
  }, [router]);

  const reload = useCallback(async () => {
    setAccounts(await adminApi.listParentAccounts());
  }, []);

  const load = useCallback(() => {
    if (!readToken()) {
      router.replace('/admin/login');
      return;
    }
    setError(null);
    reload().catch((cause: unknown) => {
      if (cause instanceof AdminApiError && cause.status === 401) {
        toLogin();
        return;
      }
      setError(adminCopy.errors.generic);
    });
  }, [reload, router, toLogin]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Reads consumption for one account. Any response that arrives after the
   * expanded row has changed is dropped — it describes an account the panel is
   * no longer showing.
   */
  const loadConsumption = useCallback(
    async (accountId: string) => {
      expectedConsumptionId.current = accountId;
      setConsumptionLoading(true);
      setConsumptionError(null);
      try {
        const detail = await adminApi.loadParentAccount(accountId);
        if (expectedConsumptionId.current !== accountId) return;
        setConsumption(detail.consumption);
      } catch (cause: unknown) {
        if (cause instanceof AdminApiError && cause.status === 401) {
          toLogin();
          return;
        }
        if (expectedConsumptionId.current !== accountId) return;
        setConsumption(null);
        setConsumptionError(
          cause instanceof AdminApiError ? cause.message : adminCopy.errors.generic,
        );
      } finally {
        // A stale response must not clear the spinner the current one owns.
        if (expectedConsumptionId.current === accountId) setConsumptionLoading(false);
      }
    },
    [toLogin],
  );

  const onToggleConsumption = useCallback(
    (account: ParentAccountSummary) => {
      setError(null);
      setConsumptionError(null);
      if (expandedId === account.id) {
        // Collapsing invalidates any read still in flight for this row.
        expectedConsumptionId.current = null;
        setExpandedId(null);
        setConsumption(null);
        setConsumptionLoading(false);
        setAnnouncement(adminCopy.announce.consumptionHidden(account.email));
        return;
      }
      setExpandedId(account.id);
      setConsumption(null);
      setAnnouncement(adminCopy.announce.consumptionShown(account.email));
      void loadConsumption(account.id);
    },
    [expandedId, loadConsumption],
  );

  /**
   * One assignment at a time per row, so a fast double-change cannot issue two
   * writes whose responses land out of order. The list is reloaded either way,
   * so the select can never be left disagreeing with the server.
   */
  const onAssignTier = useCallback(
    async (account: ParentAccountSummary, tier: AccountTier): Promise<boolean> => {
      if (pendingIds.has(account.id)) return false;
      setPendingIds((current) => new Set(current).add(account.id));
      setError(null);
      const clearPending = () =>
        setPendingIds((current) => {
          const next = new Set(current);
          next.delete(account.id);
          return next;
        });
      try {
        await adminApi.assignTier(account.id, tier);
      } catch (cause: unknown) {
        clearPending();
        if (cause instanceof AdminApiError && cause.status === 401) {
          toLogin();
          return false;
        }
        setError(cause instanceof AdminApiError ? cause.message : adminCopy.errors.generic);
        await reload().catch((reloadCause: unknown) => {
          if (reloadCause instanceof AdminApiError && reloadCause.status === 401) toLogin();
        });
        return false;
      }
      try {
        // The write already succeeded; a failure here is a refresh problem,
        // never reported as the tier assignment itself having failed.
        await reload();
        // A tier change is immediate against the current period, so a panel
        // already open must show the new limits against the same window.
        if (expandedId === account.id) await loadConsumption(account.id);
        setAnnouncement(
          adminCopy.announce.tierChanged(
            account.email,
            adminCopy.accounts.tiers[account.tier],
            adminCopy.accounts.tiers[tier],
          ),
        );
      } catch (cause: unknown) {
        if (cause instanceof AdminApiError && cause.status === 401) toLogin();
      } finally {
        setPendingIds((current) => {
          const next = new Set(current);
          next.delete(account.id);
          return next;
        });
      }
      return true;
    },
    [expandedId, loadConsumption, pendingIds, reload, toLogin],
  );

  if (!accounts) {
    return error ? (
      <Box sx={{ display: 'grid', gap: `${density.gap}px`, justifyItems: 'start' }}>
        <Alert severity="error" role="alert" variant="outlined">
          {error}
        </Alert>
        <Button type="button" variant="contained" onClick={load}>
          {adminCopy.accounts.retry}
        </Button>
      </Box>
    ) : (
      <Typography component="p" role="status">
        {adminCopy.accounts.loading}
      </Typography>
    );
  }

  return (
    <Box sx={{ display: 'grid', gap: `${density.sectionMargin}px` }}>
      <Box>
        <Typography component="h1" sx={{ fontSize: 22, fontWeight: 700 }}>
          {adminCopy.accounts.title}
        </Typography>
        <Typography component="p" sx={{ color: 'text.secondary' }}>
          {adminCopy.accounts.intro}
        </Typography>
      </Box>

      {/* Every change is announced here. */}
      <Box aria-live="polite" role="status" sx={{ minHeight: density.gap * 2 }}>
        <Typography component="span">{announcement}</Typography>
      </Box>

      {error && (
        <Alert severity="error" role="alert" variant="outlined">
          {error}
        </Alert>
      )}

      <ParentAccountTable
        accounts={accounts}
        expandedId={expandedId}
        consumption={consumption}
        consumptionLoading={consumptionLoading}
        consumptionError={consumptionError}
        pendingIds={pendingIds}
        onToggleConsumption={onToggleConsumption}
        onRetryConsumption={(account) => void loadConsumption(account.id)}
        onAssignTier={onAssignTier}
      />
    </Box>
  );
}
