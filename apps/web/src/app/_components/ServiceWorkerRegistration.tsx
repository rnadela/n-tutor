'use client';

import { useEffect } from 'react';
import { registerServiceWorker } from '@/lib/service-worker';

/**
 * Registers n-tutor's installability-only service worker, mounted once by the
 * root layout so every surface is covered by the same registration (AD-35).
 *
 * It renders nothing and says nothing, like `ParentIdleExpiry`: the whole of
 * the behaviour lives in `@/lib/service-worker`, which takes the navigator as
 * an argument and is therefore drivable from a plain node spec. This file is
 * only the mount point.
 *
 * The effect has an empty dependency list, so it runs once per mount. React
 * Strict Mode runs mount effects twice in development, which means two
 * `register` calls for the same URL and scope — the browser treats the second
 * as a no-op on an already-registered worker, so there is nothing to guard.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    registerServiceWorker(navigator);
  }, []);

  return null;
}
