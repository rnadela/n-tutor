// Both families are self-hosted and bundled — no runtime fetch to a font CDN
// (UX-DR5). Literata carries generated content; Source Sans 3 carries chrome.
import '@fontsource-variable/literata';
import '@fontsource-variable/source-sans-3';
import type { Metadata } from 'next';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v16-appRouter';
import InitColorSchemeScript from '@mui/material/InitColorSchemeScript';
import { ThemeRegistry } from '@/theme/ThemeRegistry';
import { adminCopy } from '@/copy/admin';

export const metadata: Metadata = {
  title: adminCopy.appName,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <InitColorSchemeScript attribute="data" />
        <AppRouterCacheProvider options={{ enableCssLayer: true }}>
          <ThemeRegistry>{children}</ThemeRegistry>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
