'use client';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
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
                  fullWidth
                  sx={{ justifyContent: 'flex-start', textAlign: 'left', mb: '4px' }}
                >
                  {item.label}
                </Button>
              </Box>
            );
          })}
        </Box>
      </Box>
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
          <Typography component="p" sx={{ fontWeight: 700 }}>
            {pageTitle(pathname)}
          </Typography>
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
