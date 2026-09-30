import { ParentIdleExpiry } from './_components/ParentIdleExpiry';
import { ParentSidebarChrome } from './_components/ParentSidebarChrome';
import { ParentThemeProvider } from './_components/ParentThemeProvider';
import { ElevationProvider } from '@/lib/elevation';

/**
 * The elevation token is held by a provider mounted here, so it lives exactly
 * as long as this route group stays mounted — a reload unmounts it and the PIN
 * is required again, which is the gate (AD-18).
 */
export default function ParentLayout({ children }: { children: React.ReactNode }) {
  return (
    <ParentThemeProvider>
      <ElevationProvider>
        {/* One clock for the whole of Parent View, inside the provider that
            holds the token it watches: mounting it here is what makes idle
            expiry the same on every Parent View surface (AD-13). It renders
            nothing. */}
        <ParentIdleExpiry />
        {/* The admin-dashboard shell: a sidebar naming every Parent View
            destination, with the way out of Parent View at its foot so it
            exists wherever the parent happens to be standing. It falls back
            to a bare surface on the PIN gate itself, before anything is
            elevated. */}
        <ParentSidebarChrome>{children}</ParentSidebarChrome>
      </ElevationProvider>
    </ParentThemeProvider>
  );
}
