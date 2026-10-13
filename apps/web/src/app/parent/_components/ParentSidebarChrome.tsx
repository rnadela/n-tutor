'use client';

import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import {
  BarChart3,
  CheckCircle2,
  ChevronRight,
  Clock,
  Flag,
  GraduationCap,
  Home,
  KeyRound,
  MoreHorizontal,
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
import { BottomNav, type BottomNavItem } from '@/components/BottomNav';
import { ColorModeSwitch } from '@/components/ColorModeSwitch';
import { InstallBanner } from '@/components/InstallBanner';
import { parentCopy } from '@/copy/parent';
import { barOffsetCss, bottomNavShown } from '@/lib/bottom-nav';
import { CaptureOpenProvider, useCaptureOpen } from '@/lib/capture-open';
import { colorModeSwitchShown } from '@/lib/color-mode';
import { installBannerSurface } from '@/lib/install-banner';
import { density } from '@/theme/tokens';

const SIDEBAR_WIDTH = 240;
/** Wide enough for the 44px tap target plus its own breathing room, narrow
 * enough to read as a rail rather than a half-collapsed sidebar. */
const RAIL_WIDTH = 72;
/** Whether the desktop rail remembers being collapsed across visits. Scoped
 * to Parent View alone, not shared with any other collapsible chrome. */
const COLLAPSE_STORAGE_KEY = 'n-tutor:parent-sidebar-collapsed';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export interface NavGroup {
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
export const NAV_GROUPS: NavGroup[] = [
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

/**
 * The destination behind an href, or a thrown error naming the href that is no
 * longer there.
 *
 * The bottom bar is a second *view* of `NAV_GROUPS` and never a second list of
 * destinations, so each tab's icon and href are looked up rather than written
 * out. A route renamed in the sidebar and forgotten here is caught by
 * `ParentSidebarChrome.spec.tsx`, which resolves every tab against `NAV_GROUPS`
 * — the throw below is the backstop behind that, not the first line of defence:
 * `NAV_GROUPS` is built from `parentCopy` rather than from literal types, so
 * there is no union for the compiler to check an href against. It fires during
 * module evaluation, which blanks Parent View rather than failing a build.
 */
function navDestination(href: string): NavItem {
  const found = NAV_ITEMS.find((item) => item.href === href);
  if (found === undefined) {
    throw new Error(`No Parent View destination for the bottom-navigation tab ${href}.`);
  }
  return found;
}

/**
 * The four tabs, plus how each one claims a route.
 *
 * Home is `exact` — `/parent` as a prefix would be current on every Parent View
 * screen there is. The three lists are `prefix`, so reading one draft still
 * reads as standing in Drafts. Everything else in `NAV_GROUPS` is behind More.
 */
export const PARENT_TABS: readonly BottomNavItem[] = (
  [
    ['/parent', parentCopy.parentView.bottomNav.home, 'exact'],
    ['/parent/capture', parentCopy.parentView.bottomNav.upload, 'prefix'],
    ['/parent/drafts', parentCopy.parentView.bottomNav.drafts, 'prefix'],
    ['/parent/attempts', parentCopy.parentView.bottomNav.attempts, 'prefix'],
  ] as const
).map(([href, label, match]) => ({ href, label, match, icon: navDestination(href).icon }));

/**
 * Whether the bar is on screen below `lg`: the route carries it *and* no live
 * viewfinder is up.
 *
 * One rule, read by the bar and by the room the content leaves for it — two
 * opinions would be a camera screen with a bar's worth of dead space under it,
 * or a list whose last row sat behind a bar that was there after all.
 */
function barIsOnScreen(pathname: string, captureOpen: boolean): boolean {
  return bottomNavShown(pathname) && !captureOpen;
}

/**
 * Parent View's bar, mounted inside `CaptureOpenProvider` so it can hear
 * whether a live viewfinder is on screen — the one visibility input no pathname
 * carries. A separate component because a provider's own render cannot read it.
 */
function ParentBottomNav({ pathname, onMore }: { pathname: string; onMore: () => void }) {
  const captureOpen = useCaptureOpen();
  if (!barIsOnScreen(pathname, captureOpen)) return null;
  return (
    <BottomNav
      pathname={pathname}
      items={PARENT_TABS}
      ariaLabel={parentCopy.parentView.bottomNav.label}
      density={density}
      more={{
        label: parentCopy.parentView.bottomNav.more,
        icon: MoreHorizontal,
        onPress: onMore,
      }}
    />
  );
}

/**
 * The screen's own content box, and the room it leaves under its last row.
 *
 * Its own component for `ParentBottomNav`'s reason: the clearance follows
 * whether the bar is *on screen*, which includes the viewfinder's state, and
 * the shell that provides that state cannot read it in its own render.
 */
function ParentContent({ pathname, children }: { pathname: string; children: React.ReactNode }) {
  const captureOpen = useCaptureOpen();
  // Room under the last row for the fixed bar, the device's own bottom inset,
  // and a gutter between the two — only where the bar is actually on screen,
  // and only below `lg`, where it is.
  const clearance = barIsOnScreen(pathname, captureOpen)
    ? { xs: barOffsetCss, lg: `${density.sectionMargin}px` }
    : `${density.sectionMargin}px`;
  return (
    <Box
      sx={{
        flexGrow: 1,
        bgcolor: 'background.default',
        paddingBlock: `${density.sectionMargin}px`,
        paddingInline: `${density.cardPadding}px`,
        paddingBottom: clearance,
      }}
    >
      {children}
    </Box>
  );
}

/** The current screen's own name, for the header's left side. Falls back to
 * the app name for a destination the sidebar does not list (there is none
 * today, but a screen reached by drill-down is not impossible). */
function pageTitle(pathname: string): string {
  return NAV_ITEMS.find((item) => item.href === pathname)?.label ?? parentCopy.appName;
}

/**
 * Where the current screen sits: its group and the destination it belongs to.
 *
 * Matched on the longest destination the path starts with, so a drill-down such
 * as one draft or one finished run is placed under the list it was opened from
 * rather than falling back to the app's name. The header states this instead of
 * repeating the page's own `<h1>` word for word.
 */
/**
 * Screens reached from a destination rather than from the sidebar, placed under
 * the destination they belong to — generating continues an upload.
 */
const DRILL_DOWN_PARENTS: ReadonlyArray<[prefix: string, href: string]> = [
  ['/parent/generate/', '/parent/capture'],
];

function locate(pathname: string): { group?: string; label: string } {
  const parent = DRILL_DOWN_PARENTS.find(([prefix]) => pathname.startsWith(prefix));
  if (parent !== undefined) pathname = parent[1];
  let best: { group?: string; item: NavItem } | null = null;
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      const matches =
        pathname === item.href || (item.href !== '/parent' && pathname.startsWith(`${item.href}/`));
      if (matches && (best === null || item.href.length > best.item.href.length)) {
        best = { group: group.label, item };
      }
    }
  }
  return best === null
    ? { label: pageTitle(pathname) }
    : { group: best.group, label: best.item.label };
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
                    '& .MuiButton-startIcon': {
                      color: current ? 'primary.main' : 'text.secondary',
                    },
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

  // Whether this *route* may carry the banner — not whether this device can
  // install anything, which is `installBannerMode`'s answer inside the banner
  // itself. Asked rather than re-decided, so `/parent/capture` is excluded by
  // the shared rule and this shell never holds a second opinion.
  const routeCarriesInstallBanner = installBannerSurface(pathname) === 'parent';
  // One element, rendered by both branches below: the gate returns early, and
  // two copies of this line are two places to keep in step.
  const installBanner = routeCarriesInstallBanner ? <InstallBanner surface="parent" /> : null;

  if (onGate) {
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
        <Box sx={{ width: '100%' }}>
          {installBanner}
          {children}
        </Box>
      </Box>
    );
  }

  // No `isNarrow` term: below `lg` the sidebar is not on screen at all, so
  // there is no width at which a remembered collapse means nothing.
  const railCollapsed = collapsed;
  const place = locate(pathname);

  return (
    <CaptureOpenProvider>
      <Box sx={{ display: 'flex', minHeight: '100vh' }}>
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
              sx={{
                fontWeight: 700,
                fontSize: '0.9375rem',
                display: 'flex',
                alignItems: 'center',
                gap: `${density.gap}px`,
                px: `${density.gap}px`,
                pb: `${density.gap * 1.5}px`,
                mb: `${density.gap * 1.5}px`,
                borderBottom: '1px solid',
                borderColor: 'divider',
              }}
            >
              <GraduationCap size={18} aria-hidden="true" style={{ flexShrink: 0 }} />
              {parentCopy.appName}
            </Typography>
            <NavList pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
          </Box>
        </Drawer>
        {/*
          Rendered beside the drawer rather than instead of it, and hidden by a
          `display` breakpoint. A width hook would draw the narrow layout first
          on every device and swap after hydration — the reflow UX-DR44 exists
          to forbid. One hidden subtree buys a stable first paint.
        */}
        <Box
          component="nav"
          aria-label={parentCopy.parentView.title}
          sx={{
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
              fontSize: '0.9375rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: railCollapsed ? 'center' : 'flex-start',
              gap: `${density.gap}px`,
              px: railCollapsed ? 0 : `${density.gap}px`,
              pb: `${density.gap * 1.5}px`,
              mb: `${density.gap * 1.5}px`,
              borderBottom: '1px solid',
              borderColor: 'divider',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
            }}
          >
            <GraduationCap
              size={railCollapsed ? 20 : 18}
              aria-label={railCollapsed ? parentCopy.appName : undefined}
              aria-hidden={railCollapsed ? undefined : true}
              style={{ flexShrink: 0 }}
            />
            {railCollapsed ? null : (
              <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {parentCopy.appName}
              </Box>
            )}
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
        <Box
          component="main"
          sx={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}
        >
          <Box
            component="header"
            sx={{
              // Pinned, so the way out of Parent View at its right-hand end stays
              // reachable however far down a long screen the parent has read.
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
            <Box
              sx={{ display: 'flex', alignItems: 'center', gap: `${density.gap}px`, minWidth: 0 }}
            >
              <Typography
                component="p"
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: `${density.gap / 2}px`,
                  minWidth: 0,
                  whiteSpace: 'nowrap',
                }}
              >
                {place.group !== undefined && (
                  <>
                    <Box
                      component="span"
                      sx={{
                        color: 'text.secondary',
                        display: { xs: 'none', sm: 'inline' },
                      }}
                    >
                      {place.group}
                    </Box>
                    <Box
                      component="span"
                      aria-hidden="true"
                      sx={{
                        color: 'text.secondary',
                        display: { xs: 'none', sm: 'inline-flex' },
                      }}
                    >
                      <ChevronRight size={16} />
                    </Box>
                  </>
                )}
                <Box
                  component="span"
                  sx={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}
                >
                  {place.label}
                </Box>
              </Typography>
            </Box>
            {/* The header's top-right cluster: the light/dark switch, then the
              toggle out of Parent View — never inside the nav list it sits
              above. The switch comes first because the exit is the
              consequential one, and a consequential control belongs at the
              end (UX-DR45). The capture screen inherits this very header, so
              the switch is gated by route rather than left to leak over a
              live viewfinder. */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: `${density.gap}px` }}>
              {colorModeSwitchShown(pathname) ? <ColorModeSwitch /> : null}
              <BackToStudentMode />
            </Box>
          </Box>
          <ParentContent pathname={pathname}>
            {installBanner}
            {children}
          </ParentContent>
        </Box>
        <ParentBottomNav pathname={pathname} onMore={() => setDrawerOpen(true)} />
      </Box>
    </CaptureOpenProvider>
  );
}
