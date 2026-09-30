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
  BookOpen,
  Flag,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Tags,
  Users,
  type LucideIcon,
} from 'lucide-react';
import NextLink from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { adminCopy } from '@/copy/admin';
import { clearToken } from '@/lib/admin-api';
import { density } from '@/theme/tokens';

const SIDEBAR_WIDTH = 240;
/** Wide enough for the 44px tap target plus its own breathing room, narrow
 * enough to read as a rail rather than a half-collapsed sidebar. Same figure
 * Parent View's sidebar uses (AD-look-alike), so the two consoles' chrome
 * collapses to the same width. */
const RAIL_WIDTH = 72;
/** Whether the desktop rail remembers being collapsed across visits. Scoped
 * to the Admin console alone, not shared with Parent View's own key. */
const COLLAPSE_STORAGE_KEY = 'n-tutor:admin-sidebar-collapsed';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/**
 * Every destination an operator can reach from the Admin console, in the
 * order the header falls back to for a page title lookup.
 */
const NAV_ITEMS: NavItem[] = [
  { href: '/admin/taxonomy', label: adminCopy.nav.taxonomy, icon: BookOpen },
  { href: '/admin/accounts', label: adminCopy.nav.accounts, icon: Users },
  { href: '/admin/flagged-explanations', label: adminCopy.nav.flaggedExplanations, icon: Flag },
  { href: '/admin/topics', label: adminCopy.nav.topics, icon: Tags },
];

/** The current screen's own name, for the header's left side. Falls back to
 * the app name for a destination the sidebar does not list. */
function pageTitle(pathname: string): string {
  return NAV_ITEMS.find((item) => item.href === pathname)?.label ?? adminCopy.appName;
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
    <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {NAV_ITEMS.map((item) => {
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
  );
}

/**
 * The Admin console's own shell: a fixed sidebar naming every destination,
 * and a header above the content with Sign out at its top-right corner. Same
 * structure as Parent View's `ParentSidebarChrome` — a permanent, collapsible
 * rail at `md` and above, a drawer opened from the header below it — so the
 * two operator-facing consoles read as one family of chrome rather than two
 * unrelated ones.
 *
 * Every route change is a client-side `<Link>`, so navigating between Admin
 * screens never drops back to a full page load.
 */
export function AdminChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const theme = useTheme();
  const onLoginScreen = pathname === '/admin/login';
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

  // The sign-in screen itself: nothing is authenticated yet, so a sidebar
  // naming every Admin destination has no business being on screen before
  // credentials are entered.
  if (onLoginScreen) {
    return (
      <Box
        component="main"
        sx={{
          minHeight: '100vh',
          bgcolor: 'background.default',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          paddingBlock: `${density.sectionMargin}px`,
          paddingInline: `${density.cardPadding}px`,
        }}
      >
        <Box sx={{ width: '100%' }}>{children}</Box>
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
          aria-label={adminCopy.appName}
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
              {adminCopy.appName}
            </Typography>
            <NavList pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
          </Box>
        </Drawer>
      ) : (
        <Box
          component="nav"
          aria-label={adminCopy.appName}
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
            {railCollapsed ? adminCopy.appName.slice(0, 1) : adminCopy.appName}
          </Typography>
          <Box sx={{ flexGrow: 1 }}>
            <NavList pathname={pathname} collapsed={railCollapsed} />
          </Box>
          {/* The rail's own toggle, pinned under the destinations rather than
              inside them — it changes how the nav looks, not where it goes. */}
          <Tooltip
            title={collapsed ? adminCopy.nav.expandSidebar : adminCopy.nav.collapseSidebar}
            placement="right"
          >
            <IconButton
              onClick={toggleCollapsed}
              aria-label={collapsed ? adminCopy.nav.expandSidebar : adminCopy.nav.collapseSidebar}
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
                aria-label={adminCopy.nav.menuToggle}
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
          <Button
            type="button"
            onClick={() => {
              clearToken();
              router.replace('/admin/login');
            }}
          >
            {adminCopy.nav.signOut}
          </Button>
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
