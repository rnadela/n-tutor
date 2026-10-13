// Both families are self-hosted and bundled — no runtime fetch to a font CDN
// (UX-DR5). Literata carries generated content; Source Sans 3 carries chrome.
import '@fontsource-variable/literata';
import '@fontsource-variable/source-sans-3';
import type { Metadata, Viewport } from 'next';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v16-appRouter';
import InitColorSchemeScript from '@mui/material/InitColorSchemeScript';
import { ThemeRegistry } from '@/theme/ThemeRegistry';
import { InstallPromptCapture } from './_components/InstallPromptCapture';
import { ServiceWorkerRegistration } from './_components/ServiceWorkerRegistration';
import { adminCopy } from '@/copy/admin';
import { commonCopy } from '@/copy/common';
import { colorTokens } from '@/theme/tokens';

export const metadata: Metadata = {
  title: adminCopy.appName,
  /**
   * iOS/iPadOS reads none of the manifest. Safari's Add to Home Screen takes
   * the standalone window from `apple-mobile-web-app-capable` and the label
   * under the icon from `apple-mobile-web-app-title` — and with no title meta
   * it falls back to `<title>`, which on this app is the Admin console's own
   * window title. Without these three lines an iPad home screen reads
   * "n-test-reviewer Admin" and opens in a browser chrome.
   *
   * `metadata.title` is deliberately left alone: the rest of the product's
   * branding is not this story's to change.
   */
  appleWebApp: {
    capable: true,
    title: commonCopy.appName,
    // The status bar carries the page's own background rather than a tinted or
    // translucent overlay, so the installed window starts where the browser tab
    // ends — this story changes how the app is opened, not how it looks.
    statusBarStyle: 'default',
  },
};

/**
 * The colour the browser paints its own chrome — an address bar, or the status
 * bar above an installed window.
 *
 * The icon's ink colour (`brandInk`), so the installed window's chrome matches
 * the icon the family tapped. Kept as one entry per colour scheme, both from
 * the design tokens: the browser picks a `theme-color` from the media queries
 * in the head before any stylesheet applies, and the token's dark value is the
 * one to change if the chrome ever needs to follow the device's preference.
 *
 * The manifest carries the same light value — a manifest has room for one
 * colour and is read before the device's preference is known.
 *
 * This pair is the *device's* answer, and it is only the first answer. It is
 * server-evaluated and not reactive, so once a family has chosen a mode in-app
 * `ColorModeMeta` — mounted inside `ThemeRegistry` — rewrites both of these
 * tags' `content` to the chosen scheme's ink. Both, rather than appending a
 * third media-less tag: a browser applies the first `theme-color` whose `media`
 * matches, and these two are emitted at the top of the head.
 */
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: colorTokens.brandInk.light },
    { media: '(prefers-color-scheme: dark)', color: colorTokens.brandInk.dark },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <InitColorSchemeScript attribute="data" />
        {/*
          Renders nothing, so it sits outside the theme providers: it has no
          markup to style and no reason to re-render when the theme changes.
        */}
        <ServiceWorkerRegistration />
        {/*
          Here for the same reason, and for one more: the install event fires
          once per page load, so the listener has to be attached by the one
          component every surface mounts.
        */}
        <InstallPromptCapture />
        <AppRouterCacheProvider options={{ enableCssLayer: true }}>
          <ThemeRegistry>{children}</ThemeRegistry>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
