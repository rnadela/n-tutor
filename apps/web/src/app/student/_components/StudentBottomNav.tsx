'use client';

import Box from '@mui/material/Box';
import { GraduationCap, Lock } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { BottomNav, type BottomNavItem } from '@/components/BottomNav';
import { studentCopy } from '@/copy/student';
import { barOffsetCss, bottomNavShown } from '@/lib/bottom-nav';
import { attemptStorage, clearAll } from '@/lib/attempt-store';
import { comfortableDensity } from '@/theme/tokens';

/**
 * Student Mode's two tabs: where the practice is, and the way across to the
 * parent side.
 *
 * Home is `exact` — nothing else under `/student` carries the bar, but a prefix
 * would still be a claim this tab has no business making. The parent tab leads
 * to the PIN and never past it, exactly like the link it replaces on Home, and
 * clears the client-held answers on the way out for the same reason that link
 * does (AD-26): past that gate nobody is a child.
 *
 * There is no Results tab and no `/student/results` route — that is Story 10.5.
 */
export const STUDENT_TABS: readonly BottomNavItem[] = [
  {
    href: '/student',
    label: studentCopy.bottomNav.home,
    icon: GraduationCap,
    match: 'exact',
  },
  {
    href: '/parent/pin',
    label: studentCopy.bottomNav.parent,
    icon: Lock,
    match: 'exact',
    onPress: () => clearAll(attemptStorage()),
  },
];

/**
 * Student Mode's bottom bar.
 *
 * Its own client component because `student/layout.tsx` is a server component
 * and must stay one: `usePathname` cannot be read there, so the pathname read
 * lives down here instead of turning the whole shell into a client boundary.
 */
export function StudentBottomNav() {
  // `usePathname()` is `null` outside a router. Coalesced here the way
  // `Snackbar.tsx` guards its own read, so this mount never hands a non-string
  // on — and the empty string is a route nothing recognises, which is no bar.
  const pathname = usePathname() ?? '';
  if (!bottomNavShown(pathname)) return null;
  return (
    <>
      {/*
        The bar's own clearance, in the flow rather than as a padding on the
        server layout: it appears and disappears with the bar, so the Attempt —
        the one Student Mode screen with no bar — ends exactly where it always
        did. Decorative, so it is out of the accessibility tree.
      */}
      <Box
        aria-hidden="true"
        data-testid="bottom-nav-spacer"
        sx={{ height: { xs: barOffsetCss, lg: 0 } }}
      />
      <BottomNav
        pathname={pathname}
        items={STUDENT_TABS}
        ariaLabel={studentCopy.bottomNav.label}
        density={comfortableDensity}
      />
    </>
  );
}
