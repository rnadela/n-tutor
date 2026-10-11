'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import Typography from '@mui/material/Typography';
import { ChevronRight, Clock, Mail, ShieldCheck, type LucideIcon } from 'lucide-react';
import type { Route } from 'next';
import NextLink from 'next/link';
import { NAV_GROUPS } from './_components/ParentSidebarChrome';
import { parentCopy } from '@/copy/parent';
import { useElevation } from '@/lib/elevation';
import { NETWORK_STATUS, ParentApiError, parentApi, type ElevatedSession } from '@/lib/parent-api';
import { density, rounded } from '@/theme/tokens';

/**
 * The minimal elevation-gated landing. It exists to make the gate observable —
 * real Parent View content belongs to later epics — and it is the page that
 * proves the token is memory-only: with nothing in context it sends the parent
 * back to the PIN, which is what a reload does.
 *
 * Leaving Parent View is not this page's control any more: `BackToStudentMode`
 * in the layout is the one exit, on every Parent View surface, because leaving
 * means handing the device to a child rather than merely closing a screen.
 */
export default function ParentViewPage() {
  const router = useRouter();
  const { elevation, clearElevation } = useElevation();
  const [session, setSession] = useState<ElevatedSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const token = elevation?.token ?? null;
  // Bumped on every load() call; a response is applied only if it is still the
  // most recent request. Without this, a stale in-flight request superseded by
  // Retry could resolve after the fact and overwrite fresher state.
  const requestId = useRef(0);

  const load = useCallback(() => {
    const thisRequest = (requestId.current += 1);
    if (token === null) {
      // No token in memory: a reload, a new tab, or a parent who has left.
      router.replace('/parent/pin');
      return;
    }
    setLoading(true);
    setError(null);
    parentApi.parentSession(token).then(
      (value) => {
        if (requestId.current !== thisRequest) return;
        setSession(value);
        setLoading(false);
      },
      (cause: unknown) => {
        if (requestId.current !== thisRequest) return;
        if (cause instanceof ParentApiError && cause.status !== NETWORK_STATUS) {
          clearElevation();
          router.replace('/parent/pin');
          return;
        }
        setLoading(false);
        setError(cause instanceof Error ? cause.message : parentCopy.errors.generic);
      },
    );
  }, [token, router, clearElevation]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Box sx={{ maxWidth: 840, mx: 'auto', display: 'grid', gap: `${density.sectionMargin}px` }}>
      <Box component="header" sx={{ display: 'grid', gap: `${density.gap / 2}px` }}>
        <Typography component="h1" sx={{ fontSize: 20, fontWeight: 700 }}>
          {parentCopy.parentView.title}
        </Typography>
        <Typography sx={{ color: 'text.secondary' }}>{parentCopy.parentView.intro}</Typography>
      </Box>

      {loading || !session ? (
        error === null ? (
          <Alert severity="info" role="status" variant="outlined">
            {parentCopy.parentView.loading}
          </Alert>
        ) : (
          <Alert
            severity="error"
            role="alert"
            variant="outlined"
            action={<Button onClick={load}>{parentCopy.errors.retry}</Button>}
          >
            {error}
          </Alert>
        )
      ) : (
        <Box
          component="dl"
          sx={{
            m: 0,
            display: 'grid',
            gap: `${density.gap}px`,
            gridTemplateColumns: {
              xs: '1fr',
              sm: 'repeat(2, minmax(0, 1fr))',
              lg: 'minmax(0, 1fr) auto auto',
            },
          }}
        >
          <SessionFact icon={Mail} label={parentCopy.parentView.emailLabel} wide>
            {session.email}
          </SessionFact>
          <SessionFact icon={Clock} label={parentCopy.parentView.expiresLabel}>
            {formatMoment(session.expiresAt)}
          </SessionFact>
          <SessionFact icon={ShieldCheck} label={parentCopy.parentView.ceilingLabel}>
            {formatMoment(session.ceilingAt)}
          </SessionFact>
        </Box>
      )}

      <Box
        component="section"
        aria-labelledby="parent-destinations"
        sx={{ display: 'grid', gap: `${density.gap * 2}px` }}
      >
        <Typography id="parent-destinations" component="h2" variant="cardTitle">
          {parentCopy.parentView.destinationsTitle}
        </Typography>
        {/* The sidebar's own groups, so this list and the nav never drift.
            Home is skipped: it is the screen being read. */}
        {NAV_GROUPS.filter((group) => group.label !== undefined).map((group) => (
          <Box key={group.label} sx={{ display: 'grid', gap: `${density.gap}px` }}>
            <Typography
              component="h3"
              sx={{
                fontSize: '0.6875rem',
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'text.secondary',
              }}
            >
              {group.label}
            </Typography>
            <Box
              component="ul"
              sx={{
                listStyle: 'none',
                m: 0,
                p: 0,
                display: 'grid',
                gap: `${density.gap}px`,
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
              }}
            >
              {group.items.map((item) => (
                <Box component="li" key={item.href}>
                  <DestinationTile href={item.href} label={item.label} icon={item.icon} />
                </Box>
              ))}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

/** A session moment, to the minute: the seconds are noise to a parent. */
function formatMoment(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** One fact about the elevated session, as a `<dt>`/`<dd>` pair. */
function SessionFact({
  icon: Icon,
  label,
  wide = false,
  children,
}: {
  icon: LucideIcon;
  label: string;
  /** Takes a whole row until the screen is wide enough to sit beside the rest. */
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Box
      sx={{
        gridColumn: wide ? { sm: '1 / -1', lg: 'auto' } : undefined,
        display: 'grid',
        alignContent: 'start',
        gridTemplateColumns: 'auto 1fr',
        columnGap: `${density.gap * 1.5}px`,
        alignItems: 'start',
        padding: `${density.cardPadding}px`,
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: `${rounded.control}px`,
      }}
    >
      <Box sx={{ gridRow: 'span 2', display: 'inline-flex', color: 'text.secondary', pt: '2px' }}>
        <Icon size={18} aria-hidden="true" />
      </Box>
      <Typography component="dt" variant="caption" sx={{ color: 'text.secondary' }}>
        {label}
      </Typography>
      <Typography component="dd" sx={{ m: 0, fontWeight: 600, overflowWrap: 'anywhere' }}>
        {children}
      </Typography>
    </Box>
  );
}

/**
 * A clickable card for one destination. A client-side `<Link>`, never a plain
 * anchor: a full load would unmount `ElevationProvider` and drop the token.
 */
function DestinationTile({
  href,
  label,
  icon: Icon,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
}) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardActionArea
        component={NextLink}
        href={href as Route}
        sx={{
          height: '100%',
          minHeight: density.tapTarget + density.gap * 2,
          display: 'flex',
          alignItems: 'center',
          gap: `${density.gap * 1.5}px`,
          px: `${density.cardPadding}px`,
          '& .tile-chevron': {
            transition: (theme) => theme.transitions.create('transform'),
          },
          '&:hover .tile-chevron, &:focus-visible .tile-chevron': {
            transform: 'translateX(2px)',
          },
        }}
      >
        <Box
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 36,
            height: 36,
            flexShrink: 0,
            borderRadius: `${rounded.control}px`,
            bgcolor: 'action.selected',
            color: 'primary.main',
          }}
        >
          <Icon size={18} aria-hidden="true" />
        </Box>
        <Typography sx={{ flexGrow: 1, fontWeight: 600 }}>{label}</Typography>
        <Box className="tile-chevron" sx={{ display: 'inline-flex', color: 'text.secondary' }}>
          <ChevronRight size={18} aria-hidden="true" />
        </Box>
      </CardActionArea>
    </Card>
  );
}
