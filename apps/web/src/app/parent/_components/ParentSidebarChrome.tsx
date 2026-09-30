'use client';

import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import { BackToStudentMode } from './BackToStudentMode';
import { parentCopy } from '@/copy/parent';
import { density } from '@/theme/tokens';

const SIDEBAR_WIDTH = 240;

/**
 * Every destination a signed-in parent can reach from Parent View, in the
 * same order `page.tsx` used to list them as links. One list rather than one
 * `<Link>` per screen: the sidebar and any future "what's in Parent View"
 * surface read from the same array instead of drifting apart.
 */
const NAV_ITEMS: { href: string; label: string }[] = [
  { href: '/parent', label: parentCopy.parentView.title },
  { href: '/parent/students', label: parentCopy.parentView.students },
  { href: '/parent/capture', label: parentCopy.parentView.capture },
  { href: '/parent/drafts', label: parentCopy.parentView.drafts },
  { href: '/parent/attempts', label: parentCopy.parentView.attempts },
  { href: '/parent/explanation-flags', label: parentCopy.parentView.explanationFlags },
  { href: '/parent/grade-disputes', label: parentCopy.parentView.gradeDisputes },
  { href: '/parent/analytics', label: parentCopy.parentView.analytics },
  { href: '/parent/pin/change', label: parentCopy.parentView.changePin },
  { href: '/parent/settings', label: parentCopy.parentView.settings },
];

/** The current screen's own name, for the header's left side. Falls back to
 * the app name for a destination the sidebar does not list (there is none
 * today, but a screen reached by drill-down is not impossible). */
function pageTitle(pathname: string): string {
  return NAV_ITEMS.find((item) => item.href === pathname)?.label ?? parentCopy.appName;
}

/** Three-bar glyph, drawn inline rather than pulling in an icon package for
 * one control. */
function MenuGlyph() {
  return (
    <Box
      component="svg"
      viewBox="0 0 24 24"
      aria-hidden="true"
      sx={{ width: 24, height: 24, fill: 'none', stroke: 'currentColor', strokeWidth: 2 }}
    >
      <line x1="4" y1="7" x2="20" y2="7" strokeLinecap="round" />
      <line x1="4" y1="12" x2="20" y2="12" strokeLinecap="round" />
      <line x1="4" y1="17" x2="20" y2="17" strokeLinecap="round" />
    </Box>
  );
}

/** The destination list, shared between the permanent desktop sidebar and the
 * mobile drawer so the two never drift into two different navigations. */
function NavList({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <>
      <Typography
        component="p"
        sx={{ fontWeight: 700, mb: `${density.gap}px`, px: `${density.gap}px` }}
      >
        {parentCopy.appName}
      </Typography>
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {NAV_ITEMS.map((item) => {
          const current = pathname === item.href;
          return (
            <Box component="li" key={item.href}>
              <Button
                component={NextLink}
                href={item.href}
                variant={current ? 'contained' : 'text'}
                aria-current={current ? 'page' : undefined}
                onClick={onNavigate}
                fullWidth
                sx={{
                  justifyContent: 'flex-start',
                  textAlign: 'left',
                  mb: '4px',
                  minHeight: density.tapTarget,
                }}
              >
                {item.label}
              </Button>
            </Box>
          );
        })}
      </Box>
    </>
  );
}

/**
 * The admin-dashboard shell for Parent View: a fixed sidebar naming every
 * destination, and a header above the content with the exit control at its
 * top-right corner — the same corner an admin console puts a sign-out
 * control in, and the one place it stays reachable without floating over
 * whichever screen the parent is reading.
 *
 * Every route change is a client-side `<Link>`, for the reason `page.tsx`'s
 * links already were: a full load would unmount `ElevationProvider` and the
 * next screen would find itself unelevated before it rendered.
 */
export function ParentSidebarChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const theme = useTheme();
  // Below `md` there is no room for a 240px sidebar beside any usable content
  // width, so the nav moves into a drawer opened from the header instead.
  const isNarrow = useMediaQuery(theme.breakpoints.down('md'));
  const [drawerOpen, setDrawerOpen] = useState(false);

  // A route change is the drawer's own job finishing — closing it here means
  // every nav link works as "navigate and close" without each one wiring that
  // up itself.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // The PIN gate itself: nothing is elevated yet, so a sidebar naming every
  // Parent View destination has no business being on screen before the PIN
  // is entered (AD-18's gate would otherwise be decoration).
  const onGate = pathname === '/parent/pin';

  if (onGate) {
    return (
      <Box
        component="main"
        sx={{
          minHeight: '100vh',
          bgcolor: 'background.default',
          paddingBlock: `${density.sectionMargin}px`,
          paddingInline: `${density.cardPadding}px`,
        }}
      >
        {children}
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      {isNarrow ? (
        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          aria-label={parentCopy.parentView.title}
          ModalProps={{ keepMounted: true }}
          sx={{ '& .MuiDrawer-paper': { width: SIDEBAR_WIDTH, boxSizing: 'border-box' } }}
        >
          <Box
            component="nav"
            sx={{
              display: 'flex',
              flexDirection: 'column',
              px: `${density.cardPadding}px`,
              py: `${density.sectionMargin}px`,
              gap: `${density.gap}px`,
            }}
          >
            <NavList pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
          </Box>
        </Drawer>
      ) : (
        <Box
          component="nav"
          aria-label={parentCopy.parentView.title}
          sx={{
            width: SIDEBAR_WIDTH,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            borderRight: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.paper',
            px: `${density.cardPadding}px`,
            py: `${density.sectionMargin}px`,
            gap: `${density.gap}px`,
          }}
        >
          <NavList pathname={pathname} />
        </Box>
      )}
      <Box
        component="main"
        sx={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}
      >
        <Box
          component="header"
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: `${density.gap}px`,
            minHeight: density.tapTarget + density.gap,
            px: `${density.cardPadding}px`,
            borderBottom: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.paper',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: `${density.gap}px`, minWidth: 0 }}>
            {isNarrow ? (
              <IconButton
                onClick={() => setDrawerOpen(true)}
                aria-label={parentCopy.parentView.menuToggle}
                sx={{ width: density.tapTarget, height: density.tapTarget }}
              >
                <MenuGlyph />
              </IconButton>
            ) : null}
            <Typography
              component="p"
              sx={{
                fontWeight: 700,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {pageTitle(pathname)}
            </Typography>
          </Box>
          {/* The toggle out of Parent View, at the header's top-right corner
              on every screen — never inside the nav list it sits above. */}
          <BackToStudentMode />
        </Box>
        <Box
          sx={{
            flexGrow: 1,
            bgcolor: 'background.default',
            paddingBlock: `${density.sectionMargin}px`,
            paddingInline: `${density.cardPadding}px`,
          }}
        >
          {children}
        </Box>
      </Box>
    </Box>
  );
}
