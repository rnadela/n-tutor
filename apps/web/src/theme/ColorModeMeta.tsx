'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useColorScheme } from '@mui/material/styles';
import { effectiveScheme, syncThemeColor } from '@/lib/color-mode';

/**
 * Keeps the colour the browser paints its own chrome in step with the chosen
 * mode. Renders nothing.
 *
 * It exists because `layout.tsx`'s `viewport.themeColor` export is static and
 * evaluated on the server: the two media-scoped metas it emits answer the
 * *device's* preference, which is the one thing Story 1.10 lets a family
 * override. Nothing else in the app is in a position to notice — this is the
 * only client component that sits inside the single colour-scheme context on
 * every surface, which is why it is mounted in `ThemeRegistry` and nowhere
 * else.
 *
 * In an effect rather than during render, because writing to `document` while
 * rendering is a side effect in the middle of a pure function, and because the
 * scheme is `undefined` until after hydration anyway.
 */
export function ColorModeMeta() {
  const { mode, systemMode } = useColorScheme();
  const scheme = effectiveScheme(mode, systemMode);
  /**
   * Not read, only depended on. A client-side navigation can re-emit the root
   * `viewport` metadata, which puts the device-scoped pair back in the head —
   * and with `scheme` alone in the dependency list there would be nothing to
   * notice, because the chosen mode did not change. The path did.
   */
  const pathname = usePathname();

  useEffect(() => {
    // Nothing to write until the mode resolves, and nothing to write to in a
    // non-browser render. Leaving the server-rendered metas alone in that
    // window is correct: they already carry the device's answer.
    if (scheme === null) return;
    if (typeof document === 'undefined') return;
    syncThemeColor(document, scheme);
  }, [scheme, pathname]);

  return null;
}
