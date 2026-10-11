'use client';

import { useEffect } from 'react';
import { captureInstallPrompt } from '@/lib/install-prompt';

/**
 * Catches the browser's deferred `beforeinstallprompt` event, mounted once by
 * the root layout because that is the only place early enough: the event fires
 * once per page load, before any screen-level component can be guaranteed
 * mounted, and a missed event means no one-tap install anywhere in the app.
 *
 * It renders nothing and says nothing, exactly like `ServiceWorkerRegistration`
 * beside it: the whole of the behaviour lives in `@/lib/install-prompt`, which
 * takes the window as an argument and is therefore drivable from a plain node
 * spec. This file is only the mount point.
 *
 * The effect has an empty dependency list, so it runs once per mount. React
 * Strict Mode runs mount effects twice in development — and here, unlike a
 * service-worker registration, a second call would not be a no-op, so
 * `captureInstallPrompt` is idempotent per window rather than this component
 * guarding it.
 */
export function InstallPromptCapture() {
  useEffect(() => {
    captureInstallPrompt(window);
  }, []);

  return null;
}
