'use client';

import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import {
  BarChart3,
  CheckCircle2,
  Clock,
  Flag,
  Home,
  KeyRound,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Scale,
  Settings,
  Upload,
  Users,
  type LucideIcon,
} from 'lucide-react';
import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import { BackToStudentMode } from './BackToStudentMode';
import { parentCopy } from '@/copy/parent';
import { density } from '@/theme/tokens';

const SIDEBAR_WIDTH = 240;
/** Wide enough for the 44px tap target plus its own breathing room, narrow
 * enough to read as a rail rather than a half-collapsed sidebar. */
const RAIL_WIDTH = 72;
/** Whether the desktop rail remembers being collapsed across visits. Scoped
 * to Parent View alone, not shared with any other collapsible chrome. */
const COLLAPSE_STORAGE_KEY = 'n-tutor:parent-sidebar-collapsed';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

interface NavGroup {
  /** Omitted for the single top-level destination, which needs no heading
   * above it. */
  label?: string;
  items: NavItem[];
}

/**
 * Every destination a signed-in parent can reach from Parent View, grouped by
 * what they're about rather than listed flat — one list rather than one
 * `<Link>` per screen, so the sidebar and any future "what's in Parent View"
 * surface read from the same data instead of drifting apart.
 */
const NAV_GROUPS: NavGroup[] = [
  { items: [{ href: '/parent', label: parentCopy.parentView.title, icon: Home }] },
  {
    label: parentCopy.parentView.navGroups.students,
    items: [{ href: '/parent/students', label: parentCopy.parentView.students, icon: Users }],
  },
  {
    label: parentCopy.parentView.navGroups.practiceTests,
    items: [
      { href: '/parent/capture', label: parentCopy.parentView.capture, icon: Upload },
      { href: '/parent/drafts', label: parentCopy.parentView.drafts, icon: Clock },
      { href: '/parent/attempts', label: parentCopy.parentView.attempts, icon: CheckCircle2 },
    ],
  },
  {
    label: parentCopy.parentView.navGroups.reports,
    items: [
      {
        href: '/parent/explanation-flags',
        label: parentCopy.parentView.explanationFlags,
        icon: Flag,
      },
      { href: '/parent/grade-disputes', label: parentCopy.parentView.gradeDisputes, icon: Scale },
    ],
  },
  {
    label: parentCopy.parentView.navGroups.insights,
    items: [{ href: '/parent/analytics', label: parentCopy.parentView.analytics, icon: BarChart3 }],
  },
  {
    label: parentCopy.parentView.navGroups.account,
    items: [
      { href: '/parent/pin/change', label: parentCopy.parentView.changePin, icon: KeyRound },
      { href: '/parent/settings', label: parentCopy.parentView.settings, icon: Settings },
    ],
  },
];

const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

/** The current screen's own name, for the header's left side. Falls back to
 * the app name for a destination the sidebar does not list (there is none
 * today, but a screen reached by drill-down is not impossible). */
function pageTitle(pathname: string): string {
  return NAV_ITEMS.find((item) => item.href === pathname)?.label ?? parentCopy.appName;
}

/**
 * The destination list, shared between the permanent desktop sidebar and the
 * mobile drawer so the two never drift into two different navigations.
 *
 * `collapsed` only ever applies on desktop — the drawer always renders it
 * `false`, since a drawer that opens to an icon-only strip would defeat the
 * point of opening it.
 */
function NavList({
  pathname,
  onNavigate,
  collapsed = false,
}: {
  pathname: string;
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  return (
    <>
      {NAV_GROUPS.map((group) => (
        <Box
          key={group.label ?? group.items[0]!.href}
          component="section"
          sx={{ mb: `${density.sectionMargin - density.gap}px` }}
        >
          {group.label !== undefined && !collapsed ? (
            <Typography
              component="p"
              sx={{
                fontSize: '0.6875rem',
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'text.secondary',
                px: `${density.gap}px`,
                mb: '4px',
              }}
            >
              {group.label}
            </Typography>
          ) : null}
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {group.items.map((item) => {
              const current = pathname === item.href;
              const Icon = item.icon;
              const link = (
                <Button
                  component={NextLink}
                  href={item.href}
                  variant={current ? 'contained' : 'text'}
                  aria-current={current ? 'page' : undefined}
                  aria-label={collapsed ? item.label : undefined}
                  onClick={onNavigate}
                  fullWidth
                  startIcon={collapsed ? undefined : <Icon size={18} aria-hidden="true" />}
                  sx={{
                    justifyContent: collapsed ? 'center' : 'flex-start',
                    textAlign: 'left',
                    mb: '4px',
                    minHeight: density.tapTarget,
                    minWidth: 0,
                    px: collapsed ? 0 : undefined,
                  }}
                >
                  {collapsed ? <Icon size={20} aria-hidden="true" /> : item.label}
                </Button>
              );
              return (
                <Box component="li" key={item.href}>
                  {collapsed ? (
                    <Tooltip title={item.label} placement="right">
                      {link}
                    </Tooltip>
                  ) : (
                    link
                  )}
                </Box>
              );
            })}
          </Box>
        </Box>
      ))}
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
 * Below `md` the sidebar becomes a drawer opened from the header. At `md` and
 * above it is a permanent rail the parent can collapse to an icon-only strip,
 * a preference remembered across visits the same device makes.
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
  const [collapsed, setCollapsed] = useState(false);

  // Read the remembered rail state after mount rather than from `useState`'s
  // initializer: `localStorage` does not exist during SSR, and reading it in
  // the initializer would make the server- and first client-render markup
  // disagree.
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === '1');
    } catch {
      // A blocked or absent store just means the rail starts expanded, same
      // as a first-ever visit.
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // Nothing to persist to; the preference just won't survive a reload.
      }
      return next;
    });
  }

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

  const railCollapsed = collapsed && !isNarrow;

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
            }}
          >
            <Typography
              component="p"
              sx={{ fontWeight: 700, mb: `${density.gap}px`, px: `${density.gap}px` }}
            >
              {parentCopy.appName}
            </Typography>
            <NavList pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
          </Box>
        </Drawer>
      ) : (
        <Box
          component="nav"
          aria-label={parentCopy.parentView.title}
          sx={{
            width: railCollapsed ? RAIL_WIDTH : SIDEBAR_WIDTH,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            borderRight: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.paper',
            px: `${density.cardPadding}px`,
            py: `${density.sectionMargin}px`,
            transition: theme.transitions.create('width', {
              duration: theme.transitions.duration.shortest,
            }),
            overflow: 'hidden',
          }}
        >
          <Typography
            component="p"
            sx={{
              fontWeight: 700,
              mb: `${density.gap}px`,
              px: `${density.gap}px`,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {railCollapsed ? parentCopy.appName.slice(0, 1) : parentCopy.appName}
          </Typography>
          <Box sx={{ flexGrow: 1 }}>
            <NavList pathname={pathname} collapsed={railCollapsed} />
          </Box>
          {/* The rail's own toggle, pinned under the destinations rather than
              inside them — it changes how the nav looks, not where it goes. */}
          <Tooltip
            title={
              collapsed
                ? parentCopy.parentView.expandSidebar
                : parentCopy.parentView.collapseSidebar
            }
            placement="right"
          >
            <IconButton
              onClick={toggleCollapsed}
              aria-label={
                collapsed
                  ? parentCopy.parentView.expandSidebar
                  : parentCopy.parentView.collapseSidebar
              }
              sx={{
                alignSelf: railCollapsed ? 'center' : 'flex-end',
                width: density.tapTarget,
                height: density.tapTarget,
              }}
            >
              {collapsed ? (
                <PanelLeftOpen size={20} aria-hidden="true" />
              ) : (
                <PanelLeftClose size={20} aria-hidden="true" />
              )}
            </IconButton>
          </Tooltip>
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
                <Menu size={20} aria-hidden="true" />
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
