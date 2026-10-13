'use client';

import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import {
  BookOpen,
  Flag,
  LayoutGrid,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  Tags,
  Users,
  type LucideIcon,
} from 'lucide-react';
import NextLink from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { BottomNav, type BottomNavItem } from '@/components/BottomNav';
import { ColorModeSwitch } from '@/components/ColorModeSwitch';
import { adminCopy } from '@/copy/admin';
import { clearToken } from '@/lib/admin-api';
import { barOffsetCss, bottomNavShown } from '@/lib/bottom-nav';
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

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/**
 * Every destination an operator can reach from the Admin console, in the
 * order the header falls back to for a page title lookup.
 */
/**
 * Every Admin destination, in one list the sidebar and the `/admin` landing both
 * read — so the two can never offer different ways in.
 */
export const NAV_ITEMS = [
  { href: '/admin/taxonomy', label: adminCopy.nav.taxonomy, icon: BookOpen },
  { href: '/admin/accounts', label: adminCopy.nav.accounts, icon: Users },
  { href: '/admin/flagged-explanations', label: adminCopy.nav.flaggedExplanations, icon: Flag },
  { href: '/admin/topics', label: adminCopy.nav.topics, icon: Tags },
] as const satisfies readonly NavItem[];

/** The current screen's own name, for the header's left side. Falls back to
 * the app name for a destination the sidebar does not list. */
/** The landing, ahead of the destinations it links to. */
const OVERVIEW_ITEM = {
  href: '/admin',
  label: adminCopy.nav.overview,
  icon: LayoutGrid,
} as const satisfies NavItem;
export const SIDEBAR_ITEMS = [OVERVIEW_ITEM, ...NAV_ITEMS] as const satisfies readonly NavItem[];

/**
 * Every href the sidebar names, as a type.
 *
 * Derived from `SIDEBAR_ITEMS` rather than written out, so the label table
 * below is checked against the destinations that actually exist.
 */
type AdminHref = (typeof SIDEBAR_ITEMS)[number]['href'];

/**
 * Each destination's short tab word, keyed by the href the sidebar already
 * names it with.
 *
 * The bar is a second *view* of `SIDEBAR_ITEMS` and not a second list: order,
 * hrefs and icons all come from there, and only the word is new — "Subjects"
 * where a 240px column has room for "Subjects & Grade Levels".
 *
 * Keyed by `AdminHref`, so a destination added to or renamed in the sidebar
 * with no word here fails `typecheck` — a missing key and, for the old href,
 * an excess one. The throw below stays as the backstop behind that, for the
 * case the compiler cannot see: it fires during module evaluation, so it blanks
 * the console rather than failing a build.
 */
const ADMIN_TAB_LABELS = {
  '/admin': adminCopy.bottomNav.overview,
  '/admin/taxonomy': adminCopy.bottomNav.taxonomy,
  '/admin/accounts': adminCopy.bottomNav.accounts,
  '/admin/flagged-explanations': adminCopy.bottomNav.flaggedExplanations,
  '/admin/topics': adminCopy.bottomNav.topics,
} as const satisfies Record<AdminHref, string>;

/**
 * The five tabs: every `SIDEBAR_ITEMS` entry, in its order, and no overflow
 * action — five destinations fit across a phone, so a "More" would hide nothing
 * and the drawer behind it would be dead code.
 *
 * `/admin` is `exact`; as a prefix the Overview tab would be current on every
 * Admin screen there is.
 */
export const ADMIN_TABS: readonly BottomNavItem[] = SIDEBAR_ITEMS.map((item) => {
  const label: string | undefined = ADMIN_TAB_LABELS[item.href];
  if (label === undefined) {
    throw new Error(`No bottom-navigation label for the Admin destination ${item.href}.`);
  }
  return {
    href: item.href,
    icon: item.icon,
    label,
    match: item.href === '/admin' ? 'exact' : 'prefix',
  };
});

function pageTitle(pathname: string): string {
  return SIDEBAR_ITEMS.find((item) => item.href === pathname)?.label ?? adminCopy.appName;
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
      {SIDEBAR_ITEMS.map((item) => {
        const current = pathname === item.href;
        const Icon = item.icon;
        const link = (
          <Button
            component={NextLink}
            href={item.href}
            variant="text"
            aria-current={current ? 'page' : undefined}
            aria-label={collapsed ? item.label : undefined}
            onClick={onNavigate}
            fullWidth
            startIcon={collapsed ? undefined : <Icon size={18} aria-hidden="true" />}
            sx={{
              position: 'relative',
              justifyContent: collapsed ? 'center' : 'flex-start',
              textAlign: 'left',
              mb: '2px',
              minHeight: density.tapTarget,
              minWidth: 0,
              px: collapsed ? 0 : `${density.gap * 1.5}px`,
              py: `${density.gap * 0.75}px`,
              fontSize: '0.9375rem',
              lineHeight: 1.3,
              fontWeight: current ? 700 : 500,
              color: current ? 'primary.main' : 'text.primary',
              bgcolor: current ? 'action.selected' : 'transparent',
              '& .MuiButton-startIcon': { color: current ? 'primary.main' : 'text.secondary' },
              '&:hover': { bgcolor: current ? 'action.selected' : 'action.hover' },
              '&:hover .MuiButton-startIcon': { color: 'primary.main' },
              // The current page's accent bar: a second carrier beside the tint and the
              // weight, so where you are reads at a glance and not only by colour.
              '&::before': current
                ? {
                    content: '""',
                    position: 'absolute',
                    left: 0,
                    top: `${density.gap}px`,
                    bottom: `${density.gap}px`,
                    width: 3,
                    borderRadius: 2,
                    bgcolor: 'primary.main',
                  }
                : undefined,
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

  // No `isNarrow` term: below `lg` the sidebar is not on screen at all, so
  // there is no width at which a remembered collapse means nothing.
  const railCollapsed = collapsed;
  // Asked rather than re-decided: the sign-in branch has already returned
  // above, and deferring to the shared rule keeps the Admin console from
  // holding a second opinion about where the bar may appear.
  const routeCarriesBottomNav = bottomNavShown(pathname);

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <Box
        component="nav"
        aria-label={adminCopy.appName}
        sx={{
          // Hidden by a `display` breakpoint and never by a width hook: a hook
          // would draw the narrow layout first on every device and swap after
          // hydration, which is the reflow UX-DR44 exists to forbid.
          display: { xs: 'none', lg: 'flex' },
          width: railCollapsed ? RAIL_WIDTH : SIDEBAR_WIDTH,
          flexShrink: 0,
          // Pinned to the viewport, so the brand, every destination and the rail
          // toggle stay in view down a long page; its own list scrolls if it has to.
          position: 'sticky',
          top: 0,
          height: '100vh',
          alignSelf: 'flex-start',
          flexDirection: 'column',
          borderRight: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          px: `${density.cardPadding}px`,
          py: `${density.sectionMargin}px`,
          transition: theme.transitions.create('width', {
            duration: theme.transitions.duration.shortest,
          }),
          overflowX: 'hidden',
          overflowY: 'auto',
        }}
      >
        <Typography
          component="p"
          sx={{
            fontWeight: 700,
            fontSize: '0.875rem',
            px: railCollapsed ? 0 : `${density.gap}px`,
            pb: `${density.gap * 1.5}px`,
            mb: `${density.gap * 1.5}px`,
            borderBottom: '1px solid',
            borderColor: 'divider',
            display: 'flex',
            justifyContent: railCollapsed ? 'center' : 'flex-start',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {railCollapsed ? (
            <ShieldCheck size={20} aria-label={adminCopy.appName} />
          ) : (
            <Box
              component="span"
              sx={{ display: 'inline-flex', alignItems: 'center', gap: `${density.gap}px` }}
            >
              <ShieldCheck size={18} aria-hidden="true" style={{ flexShrink: 0 }} />
              {adminCopy.appName}
            </Box>
          )}
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
      <Box
        component="main"
        sx={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}
      >
        <Box
          component="header"
          sx={{
            // Pinned, so Sign out stays reachable down a long table.
            position: 'sticky',
            top: 0,
            zIndex: theme.zIndex.appBar,
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
          {/* The same corner as Parent View's, in the same order: the
              light/dark switch, then the consequential control (UX-DR45). An
              operator gets the identical button a family does. */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: `${density.gap}px` }}>
            <ColorModeSwitch />
            <Button
              type="button"
              variant="text"
              color="inherit"
              startIcon={<LogOut size={18} aria-hidden="true" />}
              onClick={() => {
                clearToken();
                router.replace('/admin/login');
              }}
            >
              {adminCopy.nav.signOut}
            </Button>
          </Box>
        </Box>
        <Box
          sx={{
            flexGrow: 1,
            bgcolor: 'background.default',
            paddingBlock: `${density.sectionMargin}px`,
            paddingInline: `${density.cardPadding}px`,
            // Room under the last row of a long table for the fixed bar, the
            // device's own bottom inset, and a gutter between the two.
            paddingBottom: routeCarriesBottomNav
              ? { xs: barOffsetCss, lg: `${density.sectionMargin}px` }
              : `${density.sectionMargin}px`,
          }}
        >
          {children}
        </Box>
      </Box>
      {/* No `more`: the five tabs are every Admin destination there is. */}
      {routeCarriesBottomNav ? (
        <BottomNav
          pathname={pathname}
          items={ADMIN_TABS}
          ariaLabel={adminCopy.bottomNav.label}
          density={density}
        />
      ) : null}
    </Box>
  );
}
