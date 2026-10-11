import type { MetadataRoute } from 'next';
import { commonCopy } from '@/copy/common';
import { colorTokens } from '@/theme/tokens';

/**
 * The web app manifest, served by Next at `/manifest.webmanifest`.
 *
 * A metadata route rather than a static file so the name and the two colours
 * come from the modules that already decide them — the copy module and the
 * design tokens — instead of being a third, silently drifting copy. Nothing
 * here is dynamic: the route is static-rendered at build time.
 *
 * `start_url` and `scope` are both `/` because the installed app is the whole
 * app: a family lands on the root and the browser treats every route as
 * in-scope, so following a link inside n-tutor stays in the standalone window.
 *
 * Every `src` is a path in this repo's `public/`. No icon is fetched from a CDN
 * at runtime (UX-DR5), and none is generated per request.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: commonCopy.appName,
    short_name: commonCopy.appName,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    // Student teal and the app background, light values: a manifest carries one
    // colour each, and the browser paints the splash and window chrome before
    // any CSS — and so before `prefers-color-scheme` can be consulted. The
    // per-scheme pair lives in the root layout's `viewport.themeColor`.
    theme_color: colorTokens.primaryStudent.light,
    background_color: colorTokens.backgroundDefault.light,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      // Separate from the 512 above rather than a second `purpose` on it: a
      // maskable icon is cropped to the platform's shape, so it is different
      // art — the glyph is inset into the safe zone — and an installer that
      // masked the un-inset one would clip the monogram.
      {
        src: '/icons/icon-512-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
