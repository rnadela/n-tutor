import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * The installability surface, asserted where a browser actually meets it.
 *
 * Every other spec for this story reads a module's return value, which proves
 * what the code says and not what is served: a manifest route can be perfect
 * and still reach nobody if the head carries no link to it, and a worker file
 * can be perfect and still never register. These are the only assertions that
 * run against the built app over HTTP.
 *
 * Nothing here signs in or seeds a row — installability is decided before any
 * account exists, and the whole file runs against the unauthenticated root.
 */

/**
 * The two design tokens the manifest is required to carry, read out of
 * `tokens.ts` itself rather than restated here.
 *
 * Read by regex rather than imported: the token module's own imports use the
 * web app's `@/` alias, which does not resolve under the E2E tsconfig. A
 * literal would have been the third copy of a colour this story exists to keep
 * in one place, so the file is parsed instead.
 */
function colorToken(name: string, scheme: 'light' | 'dark'): string {
  // `__dirname`, like `e2e/database.ts`: Playwright loads these specs as
  // CommonJS, where `import.meta` is a syntax error.
  const source = readFileSync(
    path.resolve(__dirname, '../../apps/web/src/theme/tokens.ts'),
    'utf8',
  );
  const pair = new RegExp(
    `${name}:\\s*\\{\\s*light:\\s*'(#[0-9A-Fa-f]{6})',\\s*dark:\\s*'(#[0-9A-Fa-f]{6})'`,
    'u',
  ).exec(source);
  expect(pair, `tokens.ts must declare ${name}`).not.toBeNull();
  return scheme === 'light' ? pair![1] : pair![2];
}

/** Every value served under a header name — one entry per line sent. */
function valuesFor(headers: { name: string; value: string }[], name: string): string[] {
  return headers.filter((header) => header.name.toLowerCase() === name).map((h) => h.value);
}

async function fetchManifest(request: APIRequestContext) {
  const response = await request.get('/manifest.webmanifest');
  expect(response.status()).toBe(200);
  return response.json();
}

test.describe('the service worker file', () => {
  test('is served uncacheable and as JavaScript, exactly once each', async ({ request }) => {
    const response = await request.get('/sw.js');
    expect(response.status()).toBe(200);

    const headers = response.headersArray();
    const cacheControl = valuesFor(headers, 'cache-control');
    const contentType = valuesFor(headers, 'content-type');

    // One line each, not two. A static file already carries a type of its own,
    // and a config that appended rather than replaced would send two — which
    // some browsers resolve by refusing the registration outright.
    expect(cacheControl).toEqual(['no-cache, no-store, must-revalidate']);
    expect(contentType).toHaveLength(1);
    expect(contentType[0]).toMatch(/^(application|text)\/javascript\b/u);
  });
});

test.describe('the web app manifest', () => {
  test('states what the browser needs to offer an install', async ({ request }) => {
    const manifest = await fetchManifest(request);

    expect(manifest.name).toBe('n-tutor');
    expect(manifest.short_name).toBe('n-tutor');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toBe(colorToken('primaryStudent', 'light'));
    expect(manifest.background_color).toBe(colorToken('backgroundDefault', 'light'));
  });

  test('offers 192, 512 and a maskable 512, every one of them downloadable', async ({
    request,
  }) => {
    const manifest = await fetchManifest(request);
    const icons: { src: string; sizes: string; type: string; purpose?: string }[] = manifest.icons;

    expect(icons).toHaveLength(3);
    expect(icons.map((icon) => `${icon.sizes}/${icon.purpose ?? 'any'}`).sort()).toEqual([
      '192x192/any',
      '512x512/any',
      '512x512/maskable',
    ]);

    // A declared icon that 404s is an install prompt a browser silently
    // declines to offer, and nothing short of fetching them catches it.
    for (const icon of icons) {
      const response = await request.get(icon.src);
      expect(response.status(), `${icon.src} must be served`).toBe(200);
      expect(response.headers()['content-type']).toContain('image/png');
    }
  });
});

test.describe('what a loaded page carries', () => {
  test('links the manifest, the iOS icon, and a theme colour per scheme', async ({
    page,
    request,
  }) => {
    await page.goto('/');

    await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);

    // iOS reads none of the manifest: the label under the icon comes from this
    // meta, and with none it falls back to `<title>` — which on this app is
    // the Admin console's own window title.
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute(
      'content',
      'n-tutor',
    );

    // The home-screen icon comes from this link alone.
    const appleIcon = page.locator('link[rel="apple-touch-icon"]');
    await expect(appleIcon).toHaveCount(1);
    await expect(appleIcon).toHaveAttribute('sizes', '180x180');
    const appleIconHref = await appleIcon.getAttribute('href');
    const appleIconResponse = await request.get(appleIconHref!);
    expect(appleIconResponse.status()).toBe(200);
    expect(appleIconResponse.headers()['content-type']).toContain('image/png');

    // Two metas, differing by scheme — the browser chooses between them before
    // any stylesheet applies, so one value would leave dark mode mismatched.
    const themeColors = await page.locator('meta[name="theme-color"]').evaluateAll((metas) =>
      metas.map((meta) => ({
        media: meta.getAttribute('media'),
        content: meta.getAttribute('content'),
      })),
    );
    expect(themeColors).toEqual([
      { media: '(prefers-color-scheme: light)', content: colorToken('primaryStudent', 'light') },
      { media: '(prefers-color-scheme: dark)', content: colorToken('primaryStudent', 'dark') },
    ]);
  });

  test('registers the worker at the app root', async ({ page, baseURL }) => {
    await page.goto('/');

    // The one assertion that proves the root layout's mount does anything. The
    // scope has to be the app root, or an installed window would drop back out
    // to a browser tab on the first link followed.
    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            const registration = await navigator.serviceWorker?.getRegistration('/');
            return registration?.scope ?? null;
          }),
        { timeout: 15_000, message: 'the root layout must register /sw.js at scope /' },
      )
      .toBe(new URL('/', baseURL).href);
  });
});
