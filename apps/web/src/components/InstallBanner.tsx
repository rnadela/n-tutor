'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import type { Theme } from '@mui/material/styles';
import { X } from 'lucide-react';
import { PrimaryButton } from './Button';
import { commonCopy } from '@/copy/common';
import {
  browserInstallBannerStorage,
  installBannerDismissed,
  installBannerMode,
  rememberInstallBannerDismissed,
  type InstallBannerMode,
  type InstallBannerSurface,
} from '@/lib/install-banner';
import {
  deferredInstallPrompt,
  promptToInstall,
  subscribeInstallPrompt,
} from '@/lib/install-prompt';
import { density, rounded, typeRoles } from '@/theme/tokens';

/**
 * The one line the banner leads with: the iOS steps where there is no prompt
 * to call, and otherwise the surface's own sentence — a parent is told about
 * "this device", a child about "your home screen".
 */
function messageFor(surface: InstallBannerSurface, mode: InstallBannerMode): string {
  const copy = commonCopy.installBanner;
  // Keyed by the surface rather than branched on it: there is exactly one
  // sentence per surface, and the prop names which one.
  return mode === 'ios' ? copy.iosSteps : copy[surface];
}

export interface InstallBannerViewProps {
  surface: InstallBannerSurface;
  /** `null` renders nothing at all — see `installBannerMode`. */
  mode: InstallBannerMode | null;
  onInstall: () => void;
  onDismiss: () => void;
}

/**
 * The banner's markup, with every decision already made for it.
 *
 * Split out from the component below so the render is assertable: `apps/web`
 * runs its specs in `environment: 'node'`, where a component that reads
 * `window` in an effect renders as nothing, and the three variants' copy and
 * controls would go untested.
 *
 * It is a plain `role="region"` above the content — never a toast, a dialog or
 * an overlay. It takes no focus, blocks no interaction, animates nothing and
 * floats over nothing: the offer sits in the flow and the screen keeps working
 * around it.
 */
export function InstallBannerView({ surface, mode, onInstall, onDismiss }: InstallBannerViewProps) {
  if (mode === null) return null;

  const copy = commonCopy.installBanner;
  /**
   * The surface's density, read off the mounted theme the way `Screen` reads
   * its gutters — so the child's roomier set arrives with the theme rather than
   * being a figure this file chooses. The compact set is the floor for a theme
   * not built by `buildTheme`, which would otherwise resolve to `undefinedpx`.
   */
  const spacing = (theme: Theme) => theme.density ?? density;

  return (
    <Box
      role="region"
      aria-label={copy.regionName}
      sx={(theme) => {
        const d = spacing(theme);
        return {
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: `${d.gap}px`,
          padding: `${d.cardPadding}px`,
          // Parent View's content area is a plain block, so the banner states
          // its own gap below itself there. Student Home's outer grid already
          // spaces its children, and a margin would double it.
          marginBottom: surface === 'parent' ? `${d.sectionMargin}px` : undefined,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: `${rounded.control}px`,
          bgcolor: 'background.paper',
        };
      }}
    >
      <Box
        sx={(theme) => ({
          flexGrow: 1,
          minWidth: 0,
          display: 'grid',
          gap: `${spacing(theme).gap / 2}px`,
        })}
      >
        <Typography sx={{ ...typeRoles.dashboardBody }}>{messageFor(surface, mode)}</Typography>
        {/* Only iOS is told about the extra sign-in: it is a consequence of the
            home-screen window being a fresh place to the browser, which is the
            only install path that has it. */}
        {mode === 'ios' ? (
          <Typography sx={{ ...typeRoles.caption, color: 'text.secondary' }}>
            {copy.iosSignIn}
          </Typography>
        ) : null}
      </Box>
      {/* No Install control on iOS: there is no prompt to call, and a button
          that opened nothing would be worse than the steps beside it. */}
      {mode === 'prompt' ? (
        <PrimaryButton
          onClick={onInstall}
          sx={(theme) => ({ minHeight: spacing(theme).tapTarget })}
        >
          {copy.action}
        </PrimaryButton>
      ) : null}
      <IconButton
        type="button"
        onClick={onDismiss}
        aria-label={copy.dismiss}
        sx={(theme) => ({ width: spacing(theme).tapTarget, height: spacing(theme).tapTarget })}
      >
        <X size={18} aria-hidden="true" />
      </IconButton>
    </Box>
  );
}

/**
 * The one install banner, mounted on Student Mode Home and on Parent View.
 *
 * One component rather than one per surface, so the two cannot drift into two
 * banners saying two things — the surface is a prop, and it decides the copy
 * and the density and nothing else.
 *
 * Whether it may render at all is `installBannerMode`'s answer, not this file's:
 * the placement rule, the installed check, the iOS detection and the dismissal
 * are all pure functions with their own spec.
 */
export function InstallBanner({ surface }: { surface: InstallBannerSurface }) {
  const prompt = useSyncExternalStore(subscribeInstallPrompt, deferredInstallPrompt, () => null);
  const [dismissed, setDismissed] = useState(false);
  /**
   * Whether the browser's own answers have been read yet.
   *
   * `sessionStorage`, `matchMedia` and the user agent are all unavailable
   * server-side, and reading them in a `useState` initializer would make the
   * server's markup and the client's first render disagree. So the first render
   * is deliberately nothing, and the banner appears a tick later.
   */
  const [ready, setReady] = useState(false);
  /** Whether a `prompt()` call is still waiting on the person's answer. */
  const prompting = useRef(false);

  useEffect(() => {
    setDismissed(installBannerDismissed(browserInstallBannerStorage()));
    setReady(true);
  }, []);

  const mode = ready
    ? installBannerMode({
        surface,
        hasPrompt: prompt !== null,
        dismissed,
        windowLike: window,
        navigatorLike: navigator,
      })
    : null;

  function dismiss(): void {
    // State first, so the tap always does something: a blocked or absent store
    // means the banner stays gone for the page's life rather than not at all.
    setDismissed(true);
    rememberInstallBannerDismissed(browserInstallBannerStorage());
  }

  function install(): void {
    // One call per offer. The browser's dialog covers the page while it is
    // open, but a double tap or a stuck platform dialog would otherwise reach
    // `prompt()` twice on the same event — which the platform rejects,
    // `promptToInstall` swallows, and the person reads as two taps that did
    // nothing. A ref rather than state: this is a latch, not something the
    // banner draws.
    if (prompting.current) return;
    prompting.current = true;
    // Not awaited: the dialog is the person's to answer in their own time, and
    // nothing on the screen is waiting for it. A cancel, a rejection and a
    // throw all leave the banner exactly as it was, so the action can be taken
    // again once this call has settled.
    void promptToInstall().then((accepted) => {
      prompting.current = false;
      if (accepted) dismiss();
    });
  }

  return (
    <InstallBannerView surface={surface} mode={mode} onInstall={install} onDismiss={dismiss} />
  );
}
