import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { metadata, viewport } from './layout';
import { commonCopy } from '@/copy/common';
import { colorTokens } from '@/theme/tokens';

const SOURCE = readFileSync(path.resolve(import.meta.dirname, 'layout.tsx'), 'utf8');

/**
 * The source with its comments stripped, the pattern
 * `ParentIdleExpiry.spec.tsx` set: the comments here name the very things the
 * assertions below look for, so they have to read code rather than prose.
 */
const CODE = SOURCE.split('\n')
  .filter((line) => !/^\s*(\*|\/\/|\/\*|\{\/\*)/u.test(line))
  .join('\n');

describe('the colour the browser paints its own chrome', () => {
  it('states one theme colour per scheme, both from the tokens', () => {
    // A single value would leave a dark-mode device wearing the light accent,
    // and this is the one piece of theming CSS cannot reach: the browser picks
    // a `theme-color` from the head before any stylesheet applies.
    expect(viewport.themeColor).toEqual([
      { media: '(prefers-color-scheme: light)', color: colorTokens.primaryStudent.light },
      { media: '(prefers-color-scheme: dark)', color: colorTokens.primaryStudent.dark },
    ]);
  });

  it('hardcodes neither value', () => {
    expect(CODE).not.toContain(colorTokens.primaryStudent.light);
    expect(CODE).not.toContain(colorTokens.primaryStudent.dark);
  });
});

describe('what iOS reads, since it reads no manifest', () => {
  it('asks for a standalone window and labels it with the app name', () => {
    // Safari's Add to Home Screen takes the label from
    // `apple-mobile-web-app-title`, and with none falls back to `<title>` —
    // which on this app is the Admin console's own window title.
    expect(metadata.appleWebApp).toMatchObject({
      capable: true,
      title: commonCopy.appName,
    });
  });

  it('leaves the document title alone', () => {
    // The rest of the product's branding is not this story's to change.
    expect(metadata.title).not.toBe(commonCopy.appName);
  });
});

describe('where the service worker is registered', () => {
  it('mounts the registration exactly once, in the root layout', () => {
    // Once, because the root layout wraps every surface: a second mount
    // anywhere would be a second place to keep in step with this one.
    const mounts = CODE.match(/<ServiceWorkerRegistration\s*\/>/gu) ?? [];
    expect(mounts).toHaveLength(1);
    expect(CODE).toContain("from './_components/ServiceWorkerRegistration'");
  });

  it('keeps the colour-scheme script and the theme providers in their order', () => {
    // The registration renders nothing, so it must not have been threaded
    // between the pieces whose order decides what the first paint looks like.
    const order = ['InitColorSchemeScript', 'AppRouterCacheProvider', 'ThemeRegistry'].map((name) =>
      CODE.indexOf(`<${name}`),
    );
    expect(order.every((at) => at > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});
